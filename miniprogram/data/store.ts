/**
 * 页面用的门面：把「按等级分 key 的存储」摊平成「一份全量状态」。
 *
 * 分 key 是存储层的约束（单 key 1MB），不该泄漏到页面里；
 * 反过来，页面也不该拿到整个 Repository —— 那样很容易在某个页面里
 * 只存了一半状态，出现"昨天学的词今天不见了"这种最难查的 bug。
 */
import type { DailyLog } from '../core/stats.js';
import type { Level, WordState } from '../core/types.js';
import { LocalRepository } from './local.js';
import type { LearningDraft, Profile, Repository } from './repository.js';

export const repo: Repository = new LocalRepository();

export interface Snapshot {
  profile: Profile;
  /** 全部等级的词状态 */
  states: WordState[];
  logs: DailyLog[];
}

const ALL_LEVELS: Level[] = [1, 2, 3, 4, 5, 6];

export async function loadSnapshot(): Promise<Snapshot> {
  const [profile, logs, draft, orphans, ...perLevel] = await Promise.all([
    repo.loadProfile(),
    repo.loadLogs(),
    repo.loadDraft(),
    repo.loadOrphanStates?.() ?? Promise.resolve([]),
    ...ALL_LEVELS.map((l) => repo.loadStates(l)),
  ]);
  const byId = new Map([...perLevel.flat(), ...orphans].map((state) => [state.wordId, state]));
  for (const state of draft?.states ?? []) {
    const saved = byId.get(state.wordId);
    if (saved === undefined || state.updatedAt >= saved.updatedAt) byId.set(state.wordId, state);
  }
  return { profile, logs, states: [...byId.values()] };
}

export function loadDraft(): Promise<LearningDraft | null> {
  return repo.loadDraft();
}

export function saveDraft(draft: LearningDraft): Promise<void> {
  return repo.saveDraft(draft);
}

export function removeDraft(): Promise<void> {
  return repo.removeDraft();
}

export function saveSnapshot(snap: Snapshot, clearDraft = false): Promise<void> {
  return repo.commitSnapshot(snap, clearDraft);
}
