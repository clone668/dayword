import { describe, expect, it } from 'vitest';
import {
  PASS_RATIO,
  probesLeft,
  PROBE_SIZE,
  startPlacement,
  START_LEVEL,
  submitProbe,
  type PlacementState,
} from '../miniprogram/core/placement.js';
import type { Level } from '../miniprogram/core/types.js';

const LEVELS: Level[] = [1, 2, 3, 4, 5, 6];

/** 模拟一个"真实等级为 trueLevel"的孩子：probe <= trueLevel 就通过（非满分）。 */
function runPlacement(trueLevel: Level, perfect = false, max?: Level): PlacementState {
  let s = max === undefined ? startPlacement() : startPlacement(max);
  let guard = 0;
  while (!s.finished) {
    if (guard++ > 10) throw new Error('定级测试未收敛');
    const pass = s.probe! <= trueLevel;
    const correct = pass ? (perfect ? PROBE_SIZE : Math.ceil(PROBE_SIZE * PASS_RATIO)) : 0;
    s = submitProbe(s, correct);
  }
  return s;
}

describe('startPlacement', () => {
  it('从区间中点起测，而不是从 L1 顺序爬', () => {
    const s = startPlacement();
    expect(s.probe).toBe(START_LEVEL);
    expect(s.finished).toBe(false);
    expect(s.result).toBeNull();
  });
});

describe('二分定级', () => {
  it.each(LEVELS)('真实等级 L%i 能被准确定位', (trueLevel) => {
    const s = runPlacement(trueLevel);
    expect(s.finished).toBe(true);
    expect(s.result).toBe(trueLevel);
  });

  it.each(LEVELS)('L%i 最多 3 轮收敛（≤ 9 题，孩子不会烦）', (trueLevel) => {
    const s = runPlacement(trueLevel);
    expect(s.history.length).toBeLessThanOrEqual(3);
    expect(s.history.length * PROBE_SIZE).toBeLessThanOrEqual(9);
  });

  it('满分通过时上浮一级 —— 说明还有余量', () => {
    expect(runPlacement(3, true).result).toBe(4);
    expect(runPlacement(3, false).result).toBe(3);
  });

  it('满分通过 L6 也不会越界', () => {
    expect(runPlacement(6, true).result).toBe(6);
  });

  it('全错兜底到 L1，不会给出非法等级', () => {
    let s = startPlacement();
    while (!s.finished) s = submitProbe(s, 0);
    expect(s.result).toBe(1);
  });

  it('finished 后再提交无效，状态不变', () => {
    const s = runPlacement(4);
    expect(submitProbe(s, PROBE_SIZE)).toBe(s);
  });

  it('是纯函数，不改入参', () => {
    const s = startPlacement();
    const snapshot = JSON.stringify(s);
    submitProbe(s, PROBE_SIZE);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('剩余轮数单调不增，可以直接驱动进度条', () => {
    let s = startPlacement();
    let prev = probesLeft(s);
    expect(prev).toBeGreaterThan(0);
    while (!s.finished) {
      s = submitProbe(s, s.probe! <= 4 ? PROBE_SIZE - 1 : 0);
      const now = probesLeft(s);
      expect(now).toBeLessThanOrEqual(prev);
      prev = now;
    }
    expect(probesLeft(s)).toBe(0);
  });

  it('通过线是 2/3，答对 1 题不算通过', () => {
    const s = submitProbe(startPlacement(), 1);
    expect(s.history[0]!.level).toBe(START_LEVEL);
    expect(s.probe).toBeLessThan(START_LEVEL);
  });
});

/**
 * 上限收窄。词库只铺到 L4 时探 L5/L6 抽不出题，
 * 定到 L5 的孩子每天会领到 0 个新词 —— 不报错，只是安静地什么都不教。
 */
describe('等级上限', () => {
  it('起测点是收窄后区间的中点', () => {
    expect(startPlacement(4).probe).toBe(2);
    expect(startPlacement(1).probe).toBe(1);
  });

  it('上限以下的等级照样定得准', () => {
    expect(runPlacement(1, false, 4).result).toBe(1);
    expect(runPlacement(2, false, 4).result).toBe(2);
    expect(runPlacement(3, false, 4).result).toBe(3);
  });

  it('封顶等级满分也不上浮 —— 上面没有词可教', () => {
    expect(runPlacement(4, true, 4).result).toBe(4);
    expect(runPlacement(6, true, 4).result).toBe(4);
  });

  it('探测等级永远不越过上限', () => {
    let s = startPlacement(4);
    while (!s.finished) {
      expect(s.probe!).toBeLessThanOrEqual(4);
      s = submitProbe(s, PROBE_SIZE);
    }
    expect(s.result!).toBeLessThanOrEqual(4);
  });

  it('区间更小，收敛更快', () => {
    expect(probesLeft(startPlacement(4))).toBeLessThanOrEqual(probesLeft(startPlacement()));
    expect(runPlacement(3, false, 4).history.length).toBeLessThanOrEqual(3);
  });

  it('上限为 L1 时一轮就结束，且不会给出 L0', () => {
    const s = submitProbe(startPlacement(1), 0);
    expect(s.finished).toBe(true);
    expect(s.result).toBe(1);
  });
});
