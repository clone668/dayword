import { daysBetween, startOfDay } from './time.js';

/**
 * 连续打卡 + 护盾。
 *
 * 连续打卡是双刃剑：断一次就彻底放弃是最常见的流失模式。
 * 护盾把"断签"从悬崖变成缓坡 —— 孩子回来看到的是
 * "你的护盾保住了连续 21 天"，而不是"连续天数已清零"。
 */

/** 每连续几天奖励一个护盾 */
export const SHIELD_EVERY = 7;
/** 护盾持有上限。不设上限的话长期用户会攒到几十个，打卡就失去意义了。 */
export const MAX_SHIELDS = 3;

export interface StreakState {
  current: number;
  best: number;
  shields: number;
  /** 最后一次完成每日任务的自然日（本地 00:00 时间戳） */
  lastDay: number | null;
}

export type CheckInOutcome =
  | 'first' //     首次打卡
  | 'same-day' //  今天已打过，无变化
  | 'continued' // 昨天也打了，正常延续
  | 'saved' //     断签但护盾顶住了
  | 'broken'; //   断签且护盾不足，重新开始

export interface CheckInResult {
  state: StreakState;
  outcome: CheckInOutcome;
  shieldsUsed: number;
  shieldEarned: boolean;
}

export function initStreak(): StreakState {
  return { current: 0, best: 0, shields: 0, lastDay: null };
}

/** 完成当日任务后调用。同一天重复调用是安全的（幂等）。 */
export function checkIn(s: StreakState, now: number): CheckInResult {
  const today = startOfDay(now);

  if (s.lastDay !== null && daysBetween(s.lastDay, today) <= 0) {
    return { state: s, outcome: 'same-day', shieldsUsed: 0, shieldEarned: false };
  }

  let outcome: CheckInOutcome;
  let shieldsUsed = 0;
  let current: number;
  let shields = s.shields;

  if (s.lastDay === null) {
    outcome = 'first';
    current = 1;
  } else {
    const missed = daysBetween(s.lastDay, today) - 1;
    if (missed === 0) {
      outcome = 'continued';
      current = s.current + 1;
    } else if (shields >= missed) {
      // 护盾只补断掉的那几天，被补的日子不计入连续天数
      outcome = 'saved';
      shieldsUsed = missed;
      shields -= missed;
      current = s.current + 1;
    } else {
      // 护盾不足时不消耗 —— 连续记录反正要断，留着下次用
      outcome = 'broken';
      current = 1;
    }
  }

  let shieldEarned = false;
  if (current % SHIELD_EVERY === 0 && shields < MAX_SHIELDS) {
    shields += 1;
    shieldEarned = true;
  }

  return {
    state: { current, best: Math.max(s.best, current), shields, lastDay: today },
    outcome,
    shieldsUsed,
    shieldEarned,
  };
}
