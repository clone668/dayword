/**
 * 可注入 Storage 驱动的本地 Repository。
 * 这里没有 `wx.*`，所以迁移和故障恢复能在 Node 里逐个中断点测试。
 */
import { initLevel } from '../core/level.js';
import type { DailyLog } from '../core/stats.js';
import { initStreak } from '../core/streak.js';
import type { Level, WordState } from '../core/types.js';
import type { LearningDraft, Profile, Repository, SnapshotData } from './repository.js';
import { normalizeDraft, normalizeLogs, normalizeProfile, normalizeStates } from './schema.js';
import { WORD_BY_ID } from './words.js';

export interface StorageDriver {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  keys(): string[];
}

export const STORAGE_PREFIX = 'dw:';
export const SCHEMA_VERSION = 2;
export const VERSION_KEY = `${STORAGE_PREFIX}schema`;
export const PROFILE_KEY = `${STORAGE_PREFIX}profile`;
export const LOGS_KEY = `${STORAGE_PREFIX}logs`;
export const DRAFT_KEY = `${STORAGE_PREFIX}draft`;
export const ORPHAN_STATES_KEY = `${STORAGE_PREFIX}states:orphan`;
export const DEV_DAY_KEY = `${STORAGE_PREFIX}devDayOffset`;
const TX_KEY = `${STORAGE_PREFIX}tx`;
const TX_PREFIX = `${STORAGE_PREFIX}tx:`;
const LEVELS: readonly Level[] = [1, 2, 3, 4, 5, 6];
export const statesKey = (level: Level) => `${STORAGE_PREFIX}states:L${level}`;

interface Transaction {
  id: string;
  entries: { target: string; staged: string }[];
  removes: string[];
}

export class UnsupportedSchemaError extends Error {
  constructor(readonly storedVersion: number) {
    super(`存档来自更高版本（schema ${storedVersion}），当前版本不能安全打开`);
    this.name = 'UnsupportedSchemaError';
  }
}

const missing = (v: unknown): boolean => v === '' || v === null || v === undefined;
const versionOf = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
const txOf = (value: unknown): Transaction | null => {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Partial<Transaction>;
  if (typeof v.id !== 'string' || !Array.isArray(v.entries) || !Array.isArray(v.removes)) return null;
  if (!v.entries.every((e) => typeof e?.target === 'string' && typeof e.staged === 'string')) return null;
  if (!v.removes.every((k) => typeof k === 'string')) return null;
  return { id: v.id, entries: v.entries, removes: v.removes };
};

export class LocalRepository implements Repository {
  private ready = false;
  private serial: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: StorageDriver,
    private readonly startLevel: Level = 2,
  ) {}

  private enqueue<T>(work: () => T): Promise<T> {
    const run = this.serial.then(work, work);
    this.serial = run.then(() => undefined, () => undefined);
    return run;
  }

  private ensureReady(): void {
    if (this.ready) {
      this.recoverTransaction();
      return;
    }
    const stored = versionOf(this.storage.get(VERSION_KEY));
    if (stored > SCHEMA_VERSION) throw new UnsupportedSchemaError(stored);
    this.recoverTransaction();
    if (stored < SCHEMA_VERSION) this.migrate(stored);
    this.ready = true;
  }

  private migrate(from: number): void {
    if (from <= 1) {
      const profile = normalizeProfile(this.storage.get(PROFILE_KEY), this.startLevel);
      this.storage.set(PROFILE_KEY, profile);
      this.storage.set(LOGS_KEY, normalizeLogs(this.storage.get(LOGS_KEY)));
      for (const level of LEVELS) {
        this.storage.set(statesKey(level), normalizeStates(this.storage.get(statesKey(level))));
      }
      this.storage.set(ORPHAN_STATES_KEY, normalizeStates(this.storage.get(ORPHAN_STATES_KEY)));
      const draft = normalizeDraft(this.storage.get(DRAFT_KEY));
      if (draft === null) this.storage.remove(DRAFT_KEY);
      else this.storage.set(DRAFT_KEY, draft);
    }
    this.storage.set(VERSION_KEY, SCHEMA_VERSION);
  }

  private cleanUnreferencedStaging(keep: ReadonlySet<string> = new Set()): void {
    for (const key of this.storage.keys()) {
      if (key.startsWith(TX_PREFIX) && !keep.has(key)) this.storage.remove(key);
    }
  }

  private recoverTransaction(): void {
    const raw = this.storage.get(TX_KEY);
    const tx = txOf(raw);
    if (tx === null) {
      if (!missing(raw)) this.storage.remove(TX_KEY);
      this.cleanUnreferencedStaging();
      return;
    }
    const staged = tx.entries.map((entry) => this.storage.get(entry.staged));
    if (staged.some(missing)) throw new Error('学习存档事务不完整，无法安全恢复');
    this.cleanUnreferencedStaging(new Set(tx.entries.map((entry) => entry.staged)));

    tx.entries.forEach((entry, index) => this.storage.set(entry.target, staged[index]));
    for (const key of tx.removes) this.storage.remove(key);
    for (const entry of tx.entries) this.storage.remove(entry.staged);
    this.storage.remove(TX_KEY);
  }

  async loadProfile(): Promise<Profile> {
    return this.enqueue(() => {
      this.ensureReady();
      return normalizeProfile(this.storage.get(PROFILE_KEY), this.startLevel);
    });
  }

  async saveProfile(profile: Profile): Promise<void> {
    return this.enqueue(() => {
      this.ensureReady();
      this.storage.set(PROFILE_KEY, normalizeProfile(profile, this.startLevel));
    });
  }

  async loadStates(level: Level): Promise<WordState[]> {
    return this.enqueue(() => {
      this.ensureReady();
      return normalizeStates(this.storage.get(statesKey(level)));
    });
  }

  /** 不参与排期，但必须随全量快照继续保存的退役词状态。 */
  async loadOrphanStates(): Promise<WordState[]> {
    return this.enqueue(() => {
      this.ensureReady();
      return normalizeStates(this.storage.get(ORPHAN_STATES_KEY));
    });
  }

  async saveStates(level: Level, states: readonly WordState[]): Promise<void> {
    return this.enqueue(() => {
      this.ensureReady();
      this.storage.set(statesKey(level), normalizeStates(states));
    });
  }

  async loadLogs(): Promise<DailyLog[]> {
    return this.enqueue(() => {
      this.ensureReady();
      return normalizeLogs(this.storage.get(LOGS_KEY));
    });
  }

  async saveLogs(logs: readonly DailyLog[]): Promise<void> {
    return this.enqueue(() => {
      this.ensureReady();
      this.storage.set(LOGS_KEY, normalizeLogs(logs));
    });
  }

  async loadDraft(): Promise<LearningDraft | null> {
    return this.enqueue(() => {
      this.ensureReady();
      return normalizeDraft(this.storage.get(DRAFT_KEY));
    });
  }

  async saveDraft(draft: LearningDraft): Promise<void> {
    return this.enqueue(() => {
      this.ensureReady();
      const clean = normalizeDraft(draft);
      if (clean === null) throw new Error('学习断点数据无效');
      this.storage.set(DRAFT_KEY, clean);
    });
  }

  async removeDraft(): Promise<void> {
    return this.enqueue(() => {
      this.ensureReady();
      this.storage.remove(DRAFT_KEY);
    });
  }

  async commitSnapshot(snapshot: SnapshotData, clearDraft = false): Promise<void> {
    return this.enqueue(() => {
      this.ensureReady();
      const byLevel = new Map<Level, WordState[]>(LEVELS.map((level) => [level, []]));
      const orphans: WordState[] = [];
      for (const state of normalizeStates(snapshot.states)) {
        const level = WORD_BY_ID.get(state.wordId)?.level;
        if (level === undefined) orphans.push(state);
        else byLevel.get(level)!.push(state);
      }
      const values = new Map<string, unknown>([
        [PROFILE_KEY, normalizeProfile(snapshot.profile, this.startLevel)],
        [LOGS_KEY, normalizeLogs(snapshot.logs)],
        [ORPHAN_STATES_KEY, orphans],
        ...LEVELS.map((level) => [statesKey(level), byLevel.get(level)!] as const),
      ]);
      this.commit(values, clearDraft ? [DRAFT_KEY] : []);
    });
  }

  private commit(values: ReadonlyMap<string, unknown>, removes: string[]): void {
    const id = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const entries = [...values].map(([target], index) => ({ target, staged: `${TX_PREFIX}${id}:${index}` }));

    // manifest 出现前，任何失败都没有触碰正式数据；清理已写 staging 后把错误抛给页面。
    try {
      entries.forEach((entry) => this.storage.set(entry.staged, values.get(entry.target)));
    } catch (error) {
      entries.forEach((entry) => {
        try {
          this.storage.remove(entry.staged);
        } catch {
          // 清理失败也不能盖掉原始写入错误；残留 staging 没有 manifest，不会触碰正式数据。
        }
      });
      throw error;
    }

    const tx: Transaction = { id, entries, removes };
    this.storage.set(TX_KEY, tx);
    this.recoverTransaction();
  }

  async clear(): Promise<void> {
    return this.enqueue(() => {
      // 只清 dayword 自己的进度；主题偏好是设置，不是学习数据，应保留。
      for (const key of this.storage.keys()) {
        if (key === `${STORAGE_PREFIX}theme`) continue;
        if (key.startsWith(STORAGE_PREFIX)) this.storage.remove(key);
      }
      this.storage.set(VERSION_KEY, SCHEMA_VERSION);
      this.ready = true;
    });
  }
}