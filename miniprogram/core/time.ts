/**
 * 日期工具。
 *
 * 全部用**本地时区**，不用 UTC：小程序跑在用户手机上，按 UTC 对齐会让
 * UTC+8 的用户每天有 8 小时被算成"昨天"，打卡和到期判断都会错。
 */

export const DAY_MS = 86_400_000;

/** 本地时区当天 00:00 的时间戳。 */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 在 ts 所在的当天 00:00 基础上加 n 天，返回本地时区的 00:00。
 * 用 Date.setDate 而不是 `+ n * DAY_MS`，这样跨夏令时（23/25 小时的一天）不会漂。
 */
export function addDays(ts: number, n: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** a、b 之间相隔几个自然日（b 晚于 a 时为正）。 */
export function daysBetween(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

/** 是否同一个自然日。 */
export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}
