import type { Answer, QuestionKind } from '../miniprogram/core/types.js';

/**
 * mulberry32 —— 小巧的可复现 PRNG。
 * 测试里绝对不能用 Math.random：调度算法的回归靠的就是同一颗种子出同一条轨迹。
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 固定基准日 2026-03-02（周一）09:00 本地时间，避免测试结果随运行日期漂移。 */
export const T0 = day(0);

/** 基准日之后第 n 天的某个时刻（本地时间）。 */
export function day(n: number, hour = 9): number {
  return new Date(2026, 2, 2 + n, hour, 0, 0, 0).getTime();
}

export function ans(
  wordId: string,
  correct: boolean,
  opts: { rtMs?: number; kind?: QuestionKind; at?: number } = {},
): Answer {
  return {
    wordId,
    correct,
    rtMs: opts.rtMs ?? 3000,
    kind: opts.kind ?? 'en2zh',
    at: opts.at ?? T0,
  };
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
