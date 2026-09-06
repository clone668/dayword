/**
 * 虚拟时钟 —— **仅开发期**。
 *
 * 间隔重复的全部价值都在跨天之后：第 1 天只有新词，第 2 天才看得见"该复习哪些",
 * 第 9 天才看得见第 3 层。真等几天没法测，所以给一个可推进的日期偏移，
 * 和 `tools/play.ts` 的 `--advance` 是同一个手法。
 *
 * 上线前把 TIME_TRAVEL 改成 false —— 否则孩子自己拨表就能刷出连续打卡和护盾。
 */
import { addDays, startOfDay } from '../core/time.js';

export const TIME_TRAVEL = true;

const KEY = 'dw:devDayOffset';

export function dayOffset(): number {
  if (!TIME_TRAVEL) return 0;
  const v = wx.getStorageSync(KEY) as unknown;
  return typeof v === 'number' ? v : 0;
}

export function advance(days: number): void {
  if (!TIME_TRAVEL) return;
  wx.setStorageSync(KEY, dayOffset() + days);
}

/**
 * "现在"。整个应用只能从这里取时间，不要直接调 Date.now()，
 * 否则一半逻辑活在虚拟日期、一半活在真实日期，到期判断会自相矛盾。
 *
 * 日期按偏移挪，时刻保持真实；用 addDays 而不是加毫秒，跨夏令时不漂（见 core/time.ts）。
 */
export function now(): number {
  const real = Date.now();
  const off = dayOffset();
  return off === 0 ? real : addDays(real, off) + (real - startOfDay(real));
}
