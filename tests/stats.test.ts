import { describe, expect, it } from 'vitest';
import { mergeLog, upsertLog, type DailyLog } from '../miniprogram/core/stats.js';
import { day } from './helpers.js';

const log = (d: number, over: Partial<DailyLog> = {}): DailyLog => ({
  day: day(d, 0), // DailyLog.day 恒为本地 00:00
  newCount: 0,
  reviewCount: 0,
  firstTryCorrect: 0,
  firstTryTotal: 0,
  answerCount: 0,
  guessCount: 0,
  seconds: 0,
  ...over,
});

describe('upsertLog', () => {
  it('同一天再来一次是累加，不是覆盖 —— 否则早上做的题会消失', () => {
    const morning = log(0, { newCount: 3, reviewCount: 9, answerCount: 15, seconds: 200 });
    const evening = log(0, { reviewCount: 4, answerCount: 5, seconds: 90 });
    const [merged, ...rest] = upsertLog([morning], evening);
    expect(rest).toHaveLength(0);
    expect(merged).toMatchObject({ newCount: 3, reviewCount: 13, answerCount: 20, seconds: 290 });
  });

  it('不同的天各自成行，并按天排序', () => {
    const logs = upsertLog(upsertLog([], log(2)), log(1));
    expect(logs.map((l) => l.day)).toEqual([day(1, 0), day(2, 0)]);
  });

  it('合并跨天的日志是调用方的 bug，直接抛错而不是悄悄算错', () => {
    expect(() => mergeLog(log(0), log(1))).toThrow();
  });
});
