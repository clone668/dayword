import { describe, expect, it } from 'vitest';
import {
  accuracy,
  COOLDOWN_DAYS,
  DOWN_DAYS,
  DOWN_RATIO,
  evaluateDaily,
  initLevel,
  MIN_SAMPLES,
  recordAnswers,
  UP_DAYS,
  UP_RATIO,
  WINDOW,
  type FirstTry,
  type LevelState,
} from '../miniprogram/core/level.js';
import { day } from './helpers.js';

/** 生成 total 次复习题首答，其中 correct 次答对 */
function mix(correct: number, total: number): FirstTry[] {
  return Array.from({ length: total }, (_, i) => ({ correct: i < correct, isNew: false }));
}

/** 连续评估 n 天，每天前先把窗口填成给定正确率 */
function evalDays(s: LevelState, n: number, correct: number, total: number) {
  let state = s;
  let last: 1 | 0 | -1 = 0;
  for (let d = 0; d < n; d++) {
    state = recordAnswers({ ...state, recent: [] }, mix(correct, total));
    const r = evaluateDaily(state, day(d));
    state = r.state;
    last = r.changed;
  }
  return { state, last };
}

describe('accuracy', () => {
  it('空窗口为 0，不会算出 NaN', () => {
    expect(accuracy(initLevel(3))).toBe(0);
  });

  it('滚动窗口只保留最近 WINDOW 次，最新在末尾', () => {
    const s = recordAnswers(initLevel(3), [...mix(0, 20), ...mix(20, 20)]);
    expect(s.recent).toHaveLength(WINDOW);
    expect(accuracy(s)).toBeCloseTo(20 / WINDOW);
  });
});

/**
 * 新词第一次见本来就该答错。把它混进能力评估，测的是"今天发了几个新词"，
 * 而不是"这个等级合不合适"—— 而且会让 newPerDay 悄悄变成降级旋钮。
 */
describe('新词不计入能力评估', () => {
  it('新词的首答被丢掉，只留复习题', () => {
    const s = recordAnswers(initLevel(3), [
      { correct: true, isNew: false },
      { correct: false, isNew: true },
      { correct: false, isNew: true },
    ]);
    expect(s.recent).toEqual([true]);
    expect(accuracy(s)).toBe(1);
  });

  it('全是新词时窗口不动，不会被误判降级', () => {
    const news: FirstTry[] = Array.from({ length: WINDOW }, () => ({
      correct: false,
      isNew: true,
    }));
    const s = recordAnswers(initLevel(3), news);
    expect(s.recent).toHaveLength(0);
    expect(evaluateDaily(s, day(0)).changed).toBe(0);
  });
});

describe('调级阈值对称性', () => {
  it('两条线大致对称地夹住目标保持率，控制器才能双向工作', () => {
    const target = 0.8;
    expect(UP_RATIO - target).toBeCloseTo(target - DOWN_RATIO, 2);
  });
});

/**
 * 冷静期：卡在两级之间的孩子会被噪声推着来回越线。
 * 没有冷静期，长期模拟里 L1↔L2 每 20 天跳一次 —— 词表一直在换。
 */
describe('调级冷静期', () => {
  /** 从第 from 天起连续评估 n 天，窗口每天填成给定正确率 */
  function run(s: LevelState, from: number, n: number, correct: number) {
    let state = s;
    const changes: number[] = [];
    for (let d = from; d < from + n; d++) {
      state = recordAnswers({ ...state, recent: [] }, mix(correct, WINDOW));
      const r = evaluateDaily(state, day(d));
      state = r.state;
      if (r.changed !== 0) changes.push(d);
    }
    return { state, changes };
  }

  it('刚调过级就不再连续调级，即使正确率一直越线', () => {
    const { state, changes } = run(initLevel(3), 0, UP_DAYS + COOLDOWN_DAYS - 1, WINDOW);
    expect(changes).toEqual([UP_DAYS - 1]); // 只有第一次生效
    expect(state.level).toBe(4);
  });

  it('冷静期结束后可以再次调级，两次间隔不短于冷静期', () => {
    const { state, changes } = run(initLevel(3), 0, 2 * (UP_DAYS + COOLDOWN_DAYS), WINDOW);
    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(state.level).toBeGreaterThan(4);
    expect(changes[1]! - changes[0]!).toBeGreaterThanOrEqual(COOLDOWN_DAYS);
  });

  it('冷静期内计数器归零，冷静期一到不会立刻触发', () => {
    let cursor = 0;
    let state = initLevel(3);
    const step = (n: number) => {
      const r = run(state, cursor, n, WINDOW);
      cursor += n;
      state = r.state;
      return r;
    };

    expect(step(UP_DAYS).state.level).toBe(4); // 第 0–2 天：正常升级

    const cooled = step(COOLDOWN_DAYS - 1); // 冷静期内一直越线
    expect(cooled.changes).toHaveLength(0);
    expect(cooled.state.level).toBe(4);
    expect(cooled.state.upDays).toBe(0); // 没有偷偷累计

    expect(step(UP_DAYS - 1).state.level).toBe(4); // 解冻后还要重新连续 UP_DAYS 天
    expect(step(1).state.level).toBe(5); // 第 UP_DAYS 天才生效
  });
});

describe('evaluateDaily', () => {
  it('样本不足时不做任何判断，头几天不会乱跳', () => {
    const s = recordAnswers(initLevel(3), mix(MIN_SAMPLES - 1, MIN_SAMPLES - 1));
    const r = evaluateDaily(s, day(0));
    expect(r.changed).toBe(0);
    expect(r.state.level).toBe(3);
    expect(r.state.upDays).toBe(0);
  });

  it(`连续 ${UP_DAYS} 天高正确率才升级，且升级后清空窗口重新观察`, () => {
    const { state, last } = evalDays(initLevel(3), UP_DAYS, WINDOW, WINDOW);
    expect(last).toBe(1);
    expect(state.level).toBe(4);
    expect(state.recent).toHaveLength(0);
    expect(state.upDays).toBe(0);
  });

  it(`不足 ${UP_DAYS} 天不升级`, () => {
    const { state, last } = evalDays(initLevel(3), UP_DAYS - 1, WINDOW, WINDOW);
    expect(last).toBe(0);
    expect(state.level).toBe(3);
    expect(state.upDays).toBe(UP_DAYS - 1);
  });

  it(`连续 ${DOWN_DAYS} 天低正确率降级（UI 需静默处理）`, () => {
    const { state, last } = evalDays(initLevel(3), DOWN_DAYS, 12, WINDOW);
    expect(last).toBe(-1);
    expect(state.level).toBe(2);
  });

  it('正确率回到中间区时计数器归零，避免抖动', () => {
    let st = evalDays(initLevel(3), UP_DAYS - 1, WINDOW, WINDOW).state;
    expect(st.upDays).toBe(UP_DAYS - 1);

    st = recordAnswers({ ...st, recent: [] }, mix(24, WINDOW)); // 80%，正好在目标带中间
    const r = evaluateDaily(st, day(UP_DAYS));
    expect(r.changed).toBe(0);
    expect(r.state.upDays).toBe(0);
    expect(r.state.level).toBe(3);
  });

  it('同一天重复评估是幂等的', () => {
    const s = recordAnswers(initLevel(3), mix(WINDOW, WINDOW));
    const first = evaluateDaily(s, day(0));
    const second = evaluateDaily(first.state, day(0, 22));
    expect(second.state).toBe(first.state);
    expect(second.changed).toBe(0);
  });

  it('L6 封顶不再升，L1 兜底不再降', () => {
    expect(evalDays(initLevel(6), UP_DAYS + 2, WINDOW, WINDOW).state.level).toBe(6);
    expect(evalDays(initLevel(1), DOWN_DAYS + 2, 0, WINDOW).state.level).toBe(1);
  });

  it('是纯函数，不改入参', () => {
    const s = recordAnswers(initLevel(3), mix(WINDOW, WINDOW));
    const snapshot = JSON.stringify(s);
    evaluateDaily(s, day(0));
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
