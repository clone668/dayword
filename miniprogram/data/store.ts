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
import type { Profile, Repository } from './repository.js';
import { WORD_BY_ID } from './words.js';

export const repo: Repository = new LocalRepository();

export interface Snapshot {
  profile: Profile;
  /** 全部等级的词状态 */
  states: WordState[];
  logs: DailyLog[];
}

const ALL_LEVELS: Level[] = [1, 2, 3, 4, 5, 6];

export async function loadSnapshot(): Promise<Snapshot> {
  const [profile, logs, ...perLevel] = await Promise.all([
    repo.loadProfile(),
    repo.loadLogs(),
    ...ALL_LEVELS.map((l) => repo.loadStates(l)),
  ]);
  return { profile, logs, states: perLevel.flat() };
}

/** 词状态归到它所属词条的等级下，而不是孩子当前的等级 —— 否则升级后旧词会搬家。 */
function levelOf(s: WordState): Level {
  return WORD_BY_ID.get(s.wordId)?.level ?? 1;
}

export async function saveSnapshot(snap: Snapshot): Promise<void> {
  const byLevel = new Map<Level, WordState[]>(ALL_LEVELS.map((l) => [l, []]));
  for (const s of snap.states) byLevel.get(levelOf(s))!.push(s);

  await Promise.all([
    repo.saveProfile(snap.profile),
    repo.saveLogs(snap.logs),
    // 只写非空的等级，省掉五六次无用的 setStorage
    ...[...byLevel].filter(([, v]) => v.length > 0).map(([l, v]) => repo.saveStates(l, v)),
  ]);
}
