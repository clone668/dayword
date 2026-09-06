import { describe, expect, it } from 'vitest';
import {
  checkIn,
  initStreak,
  MAX_SHIELDS,
  SHIELD_EVERY,
  type StreakState,
} from '../miniprogram/core/streak.js';
import { day } from './helpers.js';

/** 连续打卡 n 天（第 0 天到第 n-1 天） */
function runDays(n: number, s: StreakState = initStreak()): StreakState {
  let state = s;
  for (let d = 0; d < n; d++) state = checkIn(state, day(d)).state;
  return state;
}

describe('checkIn', () => {
  it('首次打卡从 1 开始', () => {
    const r = checkIn(initStreak(), day(0));
    expect(r.outcome).toBe('first');
    expect(r.state.current).toBe(1);
    expect(r.state.best).toBe(1);
  });

  it('同一天重复打卡幂等 —— 一天多次进入不能刷天数', () => {
    const s = checkIn(initStreak(), day(0, 9)).state;
    const r = checkIn(s, day(0, 22));
    expect(r.outcome).toBe('same-day');
    expect(r.state).toBe(s);
  });

  it('连续打卡逐日递增，best 同步更新', () => {
    const s = runDays(5);
    expect(s.current).toBe(5);
    expect(s.best).toBe(5);
  });

  it(`每连续 ${SHIELD_EVERY} 天赚一个护盾`, () => {
    const r = checkIn(runDays(SHIELD_EVERY - 1), day(SHIELD_EVERY - 1));
    expect(r.state.current).toBe(SHIELD_EVERY);
    expect(r.shieldEarned).toBe(true);
    expect(r.state.shields).toBe(1);
  });

  it('断签 1 天时护盾顶住，连续记录不清零', () => {
    const before = runDays(SHIELD_EVERY); // 7 天，攒到 1 个护盾
    expect(before.shields).toBe(1);

    // 跳过第 7 天，第 8 天回来
    const r = checkIn(before, day(SHIELD_EVERY + 1));
    expect(r.outcome).toBe('saved');
    expect(r.shieldsUsed).toBe(1);
    expect(r.state.shields).toBe(0);
    expect(r.state.current).toBe(SHIELD_EVERY + 1); // 被补的那天不计入
  });

  it('护盾不足时才真正断掉，且不白白消耗护盾', () => {
    const before = runDays(SHIELD_EVERY);
    expect(before.shields).toBe(1);

    const r = checkIn(before, day(SHIELD_EVERY + 3)); // 断了 3 天，只有 1 个护盾
    expect(r.outcome).toBe('broken');
    expect(r.shieldsUsed).toBe(0);
    expect(r.state.shields).toBe(1); // 留着下次用
    expect(r.state.current).toBe(1);
    expect(r.state.best).toBe(SHIELD_EVERY); // 历史最佳保留
  });

  it('无护盾时断签直接清零', () => {
    const before = runDays(3);
    expect(before.shields).toBe(0);
    const r = checkIn(before, day(5));
    expect(r.outcome).toBe('broken');
    expect(r.state.current).toBe(1);
    expect(r.state.best).toBe(3);
  });

  it(`护盾封顶 ${MAX_SHIELDS} 个 —— 攒到几十个打卡就没意义了`, () => {
    const s = runDays(SHIELD_EVERY * (MAX_SHIELDS + 2));
    expect(s.shields).toBe(MAX_SHIELDS);
  });

  it('隔天打卡正常延续，不消耗护盾', () => {
    const before = runDays(3);
    const r = checkIn(before, day(3));
    expect(r.outcome).toBe('continued');
    expect(r.shieldsUsed).toBe(0);
    expect(r.state.current).toBe(4);
  });

  it('是纯函数，不改入参', () => {
    const s = runDays(3);
    const snapshot = JSON.stringify(s);
    checkIn(s, day(4));
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
