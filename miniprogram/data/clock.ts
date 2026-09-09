/** 仅 develop 环境启用的虚拟时钟；trial/release 无条件使用真实日期。 */
import { addDays, startOfDay } from '../core/time.js';
import { DEV_DAY_KEY } from './local-repository.js';

function envVersion(): string {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch {
    return 'release';
  }
}

export const TIME_TRAVEL = envVersion() === 'develop';

export function dayOffset(): number {
  if (!TIME_TRAVEL) return 0;
  const value = wx.getStorageSync(DEV_DAY_KEY) as unknown;
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

export function advance(days: number): void {
  if (!TIME_TRAVEL || !Number.isFinite(days)) return;
  wx.setStorageSync(DEV_DAY_KEY, dayOffset() + Math.trunc(days));
}

/** 日期按自然日挪，时刻保持真实；addDays 避免跨夏令时时按毫秒偏移。 */
export function now(): number {
  const real = Date.now();
  const offset = dayOffset();
  return offset === 0 ? real : addDays(startOfDay(real), offset) + (real - startOfDay(real));
}
