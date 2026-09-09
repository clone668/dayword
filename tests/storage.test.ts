import { beforeEach, describe, expect, it } from 'vitest';
import { initLevel } from '../miniprogram/core/level.js';
import { initStreak } from '../miniprogram/core/streak.js';
import type { Level, WordState } from '../miniprogram/core/types.js';
import {
  DRAFT_KEY,
  LocalRepository,
  LOGS_KEY,
  ORPHAN_STATES_KEY,
  PROFILE_KEY,
  SCHEMA_VERSION,
  statesKey,
  type StorageDriver,
  UnsupportedSchemaError,
  VERSION_KEY,
} from '../miniprogram/data/local-repository.js';
import type { LearningDraft, Profile, SnapshotData } from '../miniprogram/data/repository.js';
import { WORD_BY_TEXT } from '../miniprogram/data/words.js';
import { day } from './helpers.js';

class MemoryDriver implements StorageDriver {
  values = new Map<string, unknown>();
  writes = 0;
  failAt: number | null = null;

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.writes++;
    if (this.failAt === this.writes) throw new Error(`写入中断 ${this.writes}`);
    this.values.set(key, structuredClone(value));
  }

  remove(key: string): void {
    this.values.delete(key);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }
}

const id = (text: string) => WORD_BY_TEXT.get(text)!.id;
const profile = (level: Level = 2): Profile => ({ level: initLevel(level), streak: initStreak(), placed: true });
const state = (wordId: string, updatedAt = day(0)): WordState => ({
  wordId,
  box: 2,
  dueAt: day(3, 0),
  lapses: 1,
  streak: 2,
  reps: 3,
  firstSeenAt: day(-3),
  updatedAt,
});
const draft = (): LearningDraft => ({
  id: 'lesson-1',
  at: day(0),
  session: {
    queue: [{ wordId: id('apple'), isNew: true }],
    done: [],
    misses: {},
    answers: [],
    plannedTotal: 1,
  },
  states: [state(id('apple'))],
  firstTry: [],
  seen: [],
  asked: 0,
  guesses: 0,
  newCount: 1,
  reviewCount: 0,
  activeSeconds: 5,
  updatedAt: day(0),
});
const snapshot = (extraStates: WordState[] = []): SnapshotData => ({
  profile: profile(3),
  states: [state(id('apple')), state(id('elephant')), ...extraStates],
  logs: [
    {
      day: day(0, 0),
      newCount: 1,
      reviewCount: 2,
      firstTryCorrect: 1,
      firstTryTotal: 2,
      answerCount: 4,
      guessCount: 0,
      seconds: 30,
    },
  ],
});

describe('LocalRepository schema', () => {
  let storage: MemoryDriver;

  beforeEach(() => {
    storage = new MemoryDriver();
  });

  it('新安装初始化 v2，不清理同宿主其他数据', async () => {
    storage.values.set('other:token', 'keep');
    const repo = new LocalRepository(storage);

    expect((await repo.loadProfile()).placed).toBe(false);
    expect(storage.values.get(VERSION_KEY)).toBe(SCHEMA_VERSION);
    expect(storage.values.get('other:token')).toBe('keep');
  });

  it('v1 迁移稳定词 ID，并逐条丢弃损坏状态', async () => {
    storage.values.set(VERSION_KEY, 1);
    storage.values.set(statesKey(1), [
      { ...state('w-apple'), updatedAt: day(0) },
      { ...state('w-apple'), box: 4, updatedAt: day(1) },
      { wordId: 'w-dog', box: 99 },
    ]);
    const repo = new LocalRepository(storage);

    const states = await repo.loadStates(1);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ wordId: id('apple'), box: 4, updatedAt: day(1) });
    expect(storage.values.get(VERSION_KEY)).toBe(2);
  });

  it('未来 schema 只读拒绝，不迁移也不覆盖', async () => {
    storage.values.set(VERSION_KEY, SCHEMA_VERSION + 1);
    storage.values.set(PROFILE_KEY, { sentinel: true });
    const repo = new LocalRepository(storage);

    await expect(repo.loadProfile()).rejects.toBeInstanceOf(UnsupportedSchemaError);
    expect(storage.values.get(PROFILE_KEY)).toEqual({ sentinel: true });
    expect(storage.values.get(VERSION_KEY)).toBe(SCHEMA_VERSION + 1);
  });
});

describe('LocalRepository transactions', () => {
  it('快照覆盖全部等级、保留孤儿状态，并可在同一事务清草稿', async () => {
    const storage = new MemoryDriver();
    const repo = new LocalRepository(storage);
    const orphan = state('retired-word');
    await repo.loadProfile();
    await repo.saveStates(6, [state('orphan-l6')]);
    await repo.saveDraft(draft());

    await repo.commitSnapshot(snapshot([orphan]), true);

    expect(await repo.loadStates(1)).toEqual([state(id('apple'))]);
    expect(await repo.loadOrphanStates()).toEqual([orphan]);
    expect(await repo.loadStates(3)).toEqual([state(id('elephant'))]);
    expect(await repo.loadStates(6)).toEqual([]);
    expect(storage.values.get(ORPHAN_STATES_KEY)).toEqual([orphan]);
    expect(await repo.loadDraft()).toBeNull();
    expect(await repo.loadLogs()).toEqual(snapshot().logs);
  });

  it('启动时删除没有 manifest 的残留 staging，不触碰正式值', async () => {
    const storage = new MemoryDriver();
    const before = profile(1);
    storage.values.set(VERSION_KEY, SCHEMA_VERSION);
    storage.values.set(PROFILE_KEY, before);
    storage.values.set('dw:tx:abandoned:0', profile(6));
    storage.values.set('dw:tx:abandoned:1', [state(id('apple'))]);

    const repo = new LocalRepository(storage);

    expect(await repo.loadProfile()).toEqual(before);
    expect(storage.keys().some((key) => key.startsWith('dw:tx:'))).toBe(false);
  });

  it('manifest 前写满时正式数据完全不动', async () => {
    const storage = new MemoryDriver();
    const repo = new LocalRepository(storage);
    await repo.loadProfile();
    const before = profile(1);
    await repo.saveProfile(before);
    storage.failAt = storage.writes + 3;

    await expect(repo.commitSnapshot(snapshot())).rejects.toThrow('写入中断');
    storage.failAt = null;
    expect(await repo.loadProfile()).toEqual(before);
    expect(storage.keys().some((key) => key.startsWith('dw:tx:'))).toBe(false);
  });

  it('manifest 后任一正式写入中断，重启会幂等完成整份快照', async () => {
    const storage = new MemoryDriver();
    const repo = new LocalRepository(storage);
    await repo.loadProfile();
    await repo.saveDraft(draft());
    // 快照有 9 个 staged 值；manifest 是第 10 次写，随后第 3 个正式 key 写入失败。
    storage.failAt = storage.writes + 13;

    await expect(repo.commitSnapshot(snapshot(), true)).rejects.toThrow('写入中断');
    storage.failAt = null;
    const restarted = new LocalRepository(storage);

    expect(await restarted.loadProfile()).toEqual(snapshot().profile);
    expect(await restarted.loadStates(1)).toEqual([state(id('apple'))]);
    expect(await restarted.loadStates(3)).toEqual([state(id('elephant'))]);
    expect(await restarted.loadDraft()).toBeNull();
    expect(await restarted.loadLogs()).toEqual(snapshot().logs);
    expect(storage.keys().some((key) => key.startsWith('dw:tx'))).toBe(false);
  });

  it('clear 只清 dayword 学习数据，保留主题和宿主其他 key', async () => {
    const storage = new MemoryDriver();
    const repo = new LocalRepository(storage);
    await repo.loadProfile();
    storage.values.set('dw:theme', 'dark');
    storage.values.set('host:setting', 42);
    storage.values.set(LOGS_KEY, snapshot().logs);
    storage.values.set(DRAFT_KEY, draft());

    await repo.clear();

    expect(storage.values.get('dw:theme')).toBe('dark');
    expect(storage.values.get('host:setting')).toBe(42);
    expect(storage.values.get(LOGS_KEY)).toBeUndefined();
    expect(storage.values.get(DRAFT_KEY)).toBeUndefined();
    expect(storage.values.get(VERSION_KEY)).toBe(SCHEMA_VERSION);
  });
});
