import type { Level } from './types.js';

/**
 * 入口定级测试。
 *
 * 用二分查找而不是从 L1 顺序出题：顺序出题要几十道才能定位到 L5 的孩子，
 * 他会在第 15 题时不耐烦。二分在 1–6 区间内最多 3 轮 × 3 题 = 9 题定级。
 */

/** 每个等级抽几道题 */
export const PROBE_SIZE = 3;
/** 答对比例达到多少算通过该等级 */
export const PASS_RATIO = 2 / 3;
/** 起测等级 = mid(1, 6) */
export const START_LEVEL: Level = 3;

export interface Probe {
  level: Level;
  correct: number;
  total: number;
}

export interface PlacementState {
  /** 候选区间下界（含）。可能 > 6，表示已探到顶。 */
  lo: number;
  /** 候选区间上界（含）。可能 < 1，表示已探到底。 */
  hi: number;
  /** 目前通过的最高等级 */
  best: Level;
  /** 当前待测等级；finished 时为 null */
  probe: Level | null;
  history: Probe[];
  finished: boolean;
  result: Level | null;
}

export function startPlacement(): PlacementState {
  return { lo: 1, hi: 6, best: 1, probe: START_LEVEL, history: [], finished: false, result: null };
}

/**
 * 定级结果取"通过的最高等级"，而不是它的下一级。
 *
 * 宁可略低不可略高：起点偏低只是浪费几天（已掌握的词会被 SRS 快速推到毕业），
 * 起点偏高会让孩子每天做一堆不会的题，直接放弃。
 * 唯一例外是该等级满分通过 —— 那说明确实还有余量，上浮一级。
 */
function finalLevel(best: Level, history: readonly Probe[]): Level {
  const atBest = history.find((h) => h.level === best);
  const perfect = atBest !== undefined && atBest.total > 0 && atBest.correct === atBest.total;
  return perfect ? (Math.min(6, best + 1) as Level) : best;
}

export function submitProbe(
  s: PlacementState,
  correct: number,
  total: number = PROBE_SIZE,
): PlacementState {
  if (s.finished || s.probe === null) return s;

  const passed = total > 0 && correct / total >= PASS_RATIO;
  const history: Probe[] = [...s.history, { level: s.probe, correct, total }];
  let lo = s.lo;
  let hi = s.hi;
  let best = s.best;

  if (passed) {
    best = s.probe;
    lo = s.probe + 1;
  } else {
    hi = s.probe - 1;
  }

  if (lo > hi) {
    return { lo, hi, best, probe: null, history, finished: true, result: finalLevel(best, history) };
  }
  return {
    lo,
    hi,
    best,
    probe: Math.floor((lo + hi) / 2) as Level,
    history,
    finished: false,
    result: null,
  };
}

/** 还需要几轮（上界），用于给孩子看进度条。 */
export function probesLeft(s: PlacementState): number {
  if (s.finished) return 0;
  return Math.ceil(Math.log2(s.hi - s.lo + 2));
}
