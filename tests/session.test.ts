import { describe, expect, it } from 'vitest';
import {
  compareReviewPriority,
  current,
  firstTryAccuracy,
  interleave,
  isFinished,
  MAX_RETRY,
  NEW_EVERY,
  planDay,
  progress,
  RETRY_GAP,
  startSession,
  submit,
  WARMUP_REVIEWS,
} from '../miniprogram/core/session.js';
import { MASTERED_BOX, newWordState } from '../miniprogram/core/srs.js';
import { ALL_BOXES } from '../miniprogram/core/stats.js';
import { addDays } from '../miniprogram/core/time.js';
import type { WordState } from '../miniprogram/core/types.js';
import { ans, day, T0 } from './helpers.js';

function w(id: string, patch: Partial<WordState> = {}): WordState {
  return { ...newWordState(id, T0), ...patch };
}

const CFG = { newPerDay: 5, reviewCap: 3 };

describe('planDay', () => {
  it('只取已到期的词', () => {
    const states = [
      w('a', { dueAt: addDays(T0, 0) }),
      w('b', { dueAt: addDays(T0, 1) }),
      w('c', { dueAt: addDays(T0, -2) }),
    ];
    const plan = planDay(states, CFG, T0);
    expect(plan.reviewIds.sort()).toEqual(['a', 'c']);
    expect(plan.backlog).toBe(0);
    expect(plan.newQuota).toBe(5);
  });

  it('复习量硬封顶，溢出的算积压', () => {
    const states = Array.from({ length: 10 }, (_, i) => w(`w${i}`, { dueAt: addDays(T0, -1) }));
    const plan = planDay(states, CFG, T0);
    expect(plan.reviewIds).toHaveLength(3);
    expect(plan.backlog).toBe(7);
  });

  it('只要有一个词排不下就暂停发新词 —— reviewCap 才是真正的每日预算', () => {
    const exact = Array.from({ length: 3 }, (_, i) => w(`w${i}`, { dueAt: addDays(T0, -1) }));
    const fit = planDay(exact, CFG, T0);
    expect(fit.backlog).toBe(0); // 刚好排满，没积压
    expect(fit.newPaused).toBe(false);
    expect(fit.newQuota).toBe(5);

    const over = Array.from({ length: 4 }, (_, i) => w(`w${i}`, { dueAt: addDays(T0, -1) }));
    const plan = planDay(over, CFG, T0);
    expect(plan.backlog).toBe(1); // 只多一个，就已经停止进货
    expect(plan.newPaused).toBe(true);
    expect(plan.newQuota).toBe(0);
    expect(plan.reviewIds).toHaveLength(3);
  });

  it('新词只在复习有余量时才发，构成负反馈闭环（不会越学越堵）', () => {
    const flood = Array.from({ length: 40 }, (_, i) => w(`w${i}`, { dueAt: addDays(T0, -3) }));
    expect(planDay(flood, CFG, T0).newQuota).toBe(0);
    expect(planDay([], CFG, T0).newQuota).toBe(CFG.newPerDay);
  });

  it('顽固词排在最前，其次逾期最久', () => {
    const states = [
      w('easy', { dueAt: addDays(T0, -1), lapses: 0 }),
      w('old', { dueAt: addDays(T0, -9), lapses: 0 }),
      w('hard', { dueAt: addDays(T0, 0), lapses: 5 }),
    ];
    expect(planDay(states, { newPerDay: 1, reviewCap: 3 }, T0).reviewIds).toEqual([
      'hard',
      'old',
      'easy',
    ]);
  });

  it('排序是全序，结果可复现', () => {
    const a = w('a', { dueAt: addDays(T0, -1) });
    const b = w('b', { dueAt: addDays(T0, -1) });
    expect(compareReviewPriority(a, b)).toBeLessThan(0);
    expect(compareReviewPriority(b, a)).toBeGreaterThan(0);
    expect(compareReviewPriority(a, a)).toBe(0);
  });
});

describe('interleave', () => {
  it('先复习热身，再把新词靠前但不连续地插入', () => {
    const q = interleave(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'], ['n1', 'n2']);
    expect(q.map((i) => i.wordId)).toEqual(['r1', 'r2', 'n1', 'r3', 'r4', 'n2', 'r5', 'r6']);
    expect(q.filter((i) => i.isNew).map((i) => i.wordId)).toEqual(['n1', 'n2']);
  });

  it('开场不会是新词（有复习词可热身时）', () => {
    const q = interleave(['r1', 'r2', 'r3'], ['n1', 'n2', 'n3']);
    for (let i = 0; i < WARMUP_REVIEWS; i++) expect(q[i]!.isNew).toBe(false);
  });

  it('新词不会连续出现（只要还有复习词可插）', () => {
    const q = interleave(
      Array.from({ length: 12 }, (_, i) => `r${i}`),
      ['n1', 'n2', 'n3'],
    );
    for (let i = 1; i < q.length; i++) {
      if (q[i]!.isNew) expect(q[i - 1]!.isNew).toBe(false);
    }
    expect(NEW_EVERY).toBeGreaterThan(1);
  });

  it('首日无复习词时全是新词', () => {
    const q = interleave([], ['n1', 'n2', 'n3']);
    expect(q.map((i) => i.wordId)).toEqual(['n1', 'n2', 'n3']);
    expect(q.every((i) => i.isNew)).toBe(true);
  });

  it('无新词时全是复习词，且不丢词', () => {
    const q = interleave(['r1', 'r2', 'r3', 'r4'], []);
    expect(q.map((i) => i.wordId)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('不丢词也不重复', () => {
    const reviews = Array.from({ length: 7 }, (_, i) => `r${i}`);
    const news = ['n1', 'n2', 'n3'];
    const ids = interleave(reviews, news).map((i) => i.wordId);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });
});

describe('submit', () => {
  it('答对即出队', () => {
    let s = startSession(['a', 'b'], []);
    s = submit(s, ans('a', true));
    expect(s.queue.map((q) => q.wordId)).toEqual(['b']);
    expect(s.done).toEqual(['a']);
  });

  it('答错插回队列，隔几题再出现 —— 立刻重出等于抄答案', () => {
    let s = startSession(['a', 'b', 'c', 'd'], []);
    s = submit(s, ans('a', false));
    expect(s.queue.map((q) => q.wordId)).toEqual(['b', 'c', 'a', 'd']);
    expect(s.queue.findIndex((q) => q.wordId === 'a')).toBe(RETRY_GAP);
  });

  it('队尾不足时插到最后', () => {
    let s = startSession(['a', 'b'], []);
    s = submit(s, ans('a', false));
    expect(s.queue.map((q) => q.wordId)).toEqual(['b', 'a']);
  });

  it('重试用完就放过，明天交给 SRS，不把孩子卡死', () => {
    let s = startSession(['a', 'b', 'c'], []);
    for (let i = 0; i <= MAX_RETRY; i++) s = submit(s, ans('a', false));
    expect(s.misses['a']).toBe(MAX_RETRY + 1);
    expect(s.done).toContain('a');
    expect(s.queue.some((q) => q.wordId === 'a')).toBe(false);
  });

  it('重试卡不再标记为新词（教学卡只演一次）', () => {
    let s = startSession([], ['n1']);
    expect(current(s)!.isNew).toBe(true);
    s = submit(s, ans('n1', false));
    expect(s.queue[0]!.isNew).toBe(false);
  });

  it('提交队列里没有的词会明确报错', () => {
    const s = startSession(['a'], []);
    expect(() => submit(s, ans('zzz', true))).toThrow(/不在当前会话队列中/);
  });

  it('进度分母不因重试而变化，进度条不会倒退', () => {
    let s = startSession(['a', 'b', 'c'], []);
    expect(progress(s)).toEqual({ done: 0, total: 3 });
    s = submit(s, ans('a', false));
    expect(progress(s).total).toBe(3);
    s = submit(s, ans('b', true));
    expect(progress(s)).toEqual({ done: 1, total: 3 });
  });

  it('会话在所有词了结后结束', () => {
    let s = startSession(['a', 'b'], []);
    s = submit(s, ans('a', true));
    expect(isFinished(s)).toBe(false);
    s = submit(s, ans('b', true));
    expect(isFinished(s)).toBe(true);
    expect(current(s)).toBeNull();
  });
});

describe('firstTryAccuracy', () => {
  it('按首答口径统计，重试不进分母', () => {
    let s = startSession(['a', 'b', 'c', 'd'], []);
    s = submit(s, ans('a', false, { at: day(0) }));
    s = submit(s, ans('b', true));
    s = submit(s, ans('c', true));
    s = submit(s, ans('a', true)); // 重试答对，不改变首答口径
    s = submit(s, ans('d', true));
    expect(firstTryAccuracy(s)).toBeCloseTo(3 / 4);
  });

  it('无作答时为 0', () => {
    expect(firstTryAccuracy(startSession(['a'], []))).toBe(0);
  });
});

describe('盒子高度决定题型层级', () => {
  it('低盒只要求认得出，高盒要求写得出', async () => {
    const { pickKind, tierForBox, KIND_TIER } = await import('../miniprogram/core/questions.js');
    expect(tierForBox(1)).toBe('recognize');
    expect(tierForBox(3)).toBe('translate');
    expect(tierForBox(MASTERED_BOX)).toBe('produce');
    // L6 全部解锁时，盒子层级直接决定题型层级
    for (const box of ALL_BOXES) {
      expect(KIND_TIER[pickKind(6, box, () => 0)]).toBe(tierForBox(box));
    }
  });

  it('等级不够时回退到已解锁的较易题型，不会出无法作答的题', async () => {
    const { pickKind, KIND_MIN_LEVEL } = await import('../miniprogram/core/questions.js');
    for (const box of ALL_BOXES) {
      const kind = pickKind(1, box, () => 0.99);
      expect(KIND_MIN_LEVEL[kind]).toBeLessThanOrEqual(1);
    }
  });
});
