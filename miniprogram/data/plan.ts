/**
 * 「今天要做什么」的唯一算法入口。
 *
 * 首页要显示"新词 3 · 复习 12"，学习页要真的发这 15 个词。这两处必须同源：
 * 各算一遍的话，首页显示 3 个新词、学习页只发 2 个（因为词池被抽干了），
 * 而这种不一致不会报错，只会让人以为漏词了。
 */
import { configFor } from '../core/config.js';
import { planDay } from '../core/session.js';
import { wordsUpToLevel, WORD_BY_ID } from './words.js';
import type { Snapshot } from './store.js';

export interface TodayPlan {
  reviewIds: string[];
  newIds: string[];
  /** 到期但今天排不下的数量 */
  backlog: number;
  /** 因积压而暂停发新词 */
  newPaused: boolean;
  /** 想发新词但词池空了 —— 和"调度器决定不发"表象相同，必须分开告知用户 */
  starved: boolean;
  /** 当前等级可见的词总数 */
  poolSize: number;
  /** 今天要过的词数（= 进度条分母） */
  total: number;
}

export function planToday(snap: Snapshot, now: number): TodayPlan {
  const cfg = configFor(snap.profile.level.level);
  // 词库里已经没有的词不参与排期：改词表（改 id、删词）时旧存档里会留下孤儿状态，
  // 排进队列后页面拿不到词条内容会直接崩。孤儿状态本身保留，不在这里删。
  const known = snap.states.filter((s) => WORD_BY_ID.has(s.wordId));
  const plan = planDay(known, cfg, now);

  const learned = new Set(snap.states.map((s) => s.wordId));
  const pool = wordsUpToLevel(snap.profile.level.level);
  const newIds = pool
    .filter((w) => !learned.has(w.id))
    .slice(0, plan.newQuota)
    .map((w) => w.id);

  return {
    reviewIds: plan.reviewIds,
    newIds,
    backlog: plan.backlog,
    newPaused: plan.newPaused,
    starved: newIds.length < plan.newQuota,
    poolSize: pool.length,
    total: plan.reviewIds.length + newIds.length,
  };
}
