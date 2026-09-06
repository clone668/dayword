import { describe, expect, it } from 'vitest';
import {
  BOX_INTERVALS,
  currentInterval,
  GUESS_RT_MS,
  isDue,
  isGuess,
  isMastered,
  isStubborn,
  MASTERED_BOX,
  MASTERED_MAX_INTERVAL,
  newWordState,
  nextBox,
  review,
} from '../miniprogram/core/srs.js';
import { addDays, startOfDay } from '../miniprogram/core/time.js';
import type { Box, WordState } from '../miniprogram/core/types.js';
import { ans, day, T0 } from './helpers.js';

function at(box: Box, patch: Partial<WordState> = {}): WordState {
  return { ...newWordState('w1', T0), box, ...patch };
}

describe('newWordState', () => {
  it('新词立即到期，今天就该学', () => {
    const s = newWordState('w1', T0);
    expect(s.box).toBe(1);
    expect(s.dueAt).toBe(startOfDay(T0));
    expect(isDue(s, T0)).toBe(true);
    expect(s.reps).toBe(0);
  });
});

describe('nextBox', () => {
  it('答对升一层，到顶（已掌握）后不再升', () => {
    expect(nextBox(1, true, false)).toBe(2);
    expect(nextBox(4, true, false)).toBe(MASTERED_BOX);
    expect(nextBox(5, true, false)).toBe(MASTERED_BOX);
  });

  it('答错掉一半：高层掉得多，低层掉一点，永不清零', () => {
    expect(nextBox(5, false, false)).toBe(3);
    expect(nextBox(4, false, false)).toBe(2);
    expect(nextBox(3, false, false)).toBe(2);
    expect(nextBox(2, false, false)).toBe(1);
    expect(nextBox(1, false, false)).toBe(1);
  });

  it('疑似瞎猜：计对但不升盒', () => {
    expect(nextBox(3, true, true)).toBe(3);
  });
});

describe('isGuess', () => {
  it('选择题 + 秒答 + 答对 → 判为瞎猜', () => {
    expect(isGuess(ans('w1', true, { rtMs: GUESS_RT_MS - 1, kind: 'en2zh' }))).toBe(true);
  });

  it('拼写题蒙不出来，秒答也算真本事', () => {
    expect(isGuess(ans('w1', true, { rtMs: 100, kind: 'typeSpell' }))).toBe(false);
    expect(isGuess(ans('w1', true, { rtMs: 100, kind: 'dictation' }))).toBe(false);
  });

  it('答错的不算瞎猜，正常反应时间也不算', () => {
    expect(isGuess(ans('w1', false, { rtMs: 100, kind: 'en2zh' }))).toBe(false);
    expect(isGuess(ans('w1', true, { rtMs: 2000, kind: 'en2zh' }))).toBe(false);
  });
});

describe('review', () => {
  it('答对后按新盒子的间隔安排下次复习', () => {
    const s = review(at(2), ans('w1', true, { at: T0 }), T0);
    expect(s.box).toBe(3);
    expect(s.dueAt).toBe(addDays(T0, BOX_INTERVALS[3]));
    expect(s.streak).toBe(1);
    expect(s.reps).toBe(1);
    expect(s.lapses).toBe(0);
  });

  it('答错累计 lapses 并清零 streak', () => {
    const s = review(at(4, { streak: 5 }), ans('w1', false), T0);
    expect(s.box).toBe(2);
    expect(s.lapses).toBe(1);
    expect(s.streak).toBe(0);
  });

  it('瞎猜不推进盒子，间隔也不延长', () => {
    const before = at(3);
    const s = review(before, ans('w1', true, { rtMs: 100, kind: 'image2word' }), T0);
    expect(s.box).toBe(3);
    expect(s.dueAt).toBe(addDays(T0, BOX_INTERVALS[3]));
    expect(s.reps).toBe(1);
  });

  it('会话内先错后对：间隔从 60 天缩到 21 天，无需任何重学特例', () => {
    const mastered = at(MASTERED_BOX);
    expect(isMastered(mastered)).toBe(true);

    const wrong = review(mastered, ans('w1', false), T0);
    expect(wrong.box).toBe(3);
    expect(wrong.dueAt).toBe(addDays(T0, BOX_INTERVALS[3]));

    const right = review(wrong, ans('w1', true), T0);
    expect(right.box).toBe(4);
    expect(right.dueAt).toBe(addDays(T0, BOX_INTERVALS[4]));
    expect(right.lapses).toBe(1);
  });

  it('是纯函数，不改入参', () => {
    const before = at(3);
    const snapshot = JSON.stringify(before);
    review(before, ans('w1', false), T0);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('到期判断按自然日，当天任意时刻都算到期', () => {
    // 用答错驱动：留在第 1 层、间隔 1 天，明天才到期
    const s = review(at(1), ans('w1', false), day(0));
    expect(s.dueAt).toBe(addDays(day(0), 1));
    expect(isDue(s, day(0, 23))).toBe(false);
    expect(isDue(s, day(1, 0))).toBe(true);
    expect(isDue(s, day(1, 23))).toBe(true);
  });
});

/**
 * 顶层间隔必须持续增长，否则维护负担随词汇量线性膨胀 ——
 * 这是 90 天模拟里"积压清不掉"的两个根因之一，值得单独钉住。
 */
describe('已掌握词的间隔翻倍', () => {
  const graduated = (intervalDays: number) => at(MASTERED_BOX, { dueAt: addDays(T0, intervalDays) });

  it('刚毕业的词从 60 天起', () => {
    const s = review(at(4), ans('w1', true), T0);
    expect(s.box).toBe(MASTERED_BOX);
    expect(s.dueAt).toBe(addDays(T0, BOX_INTERVALS[MASTERED_BOX]));
  });

  it('每次答对翻倍：60 → 120 → 240', () => {
    expect(currentInterval(graduated(60))).toBe(60);
    expect(review(graduated(60), ans('w1', true), T0).dueAt).toBe(addDays(T0, 120));
    expect(review(graduated(120), ans('w1', true), T0).dueAt).toBe(addDays(T0, 240));
  });

  it('封顶 365 天：不会排到几年以后', () => {
    expect(review(graduated(300), ans('w1', true), T0).dueAt).toBe(
      addDays(T0, MASTERED_MAX_INTERVAL),
    );
    expect(review(graduated(MASTERED_MAX_INTERVAL), ans('w1', true), T0).dueAt).toBe(
      addDays(T0, MASTERED_MAX_INTERVAL),
    );
  });

  it('顶层瞎猜：保持原间隔，不奖励也不惩罚', () => {
    const s = review(graduated(120), ans('w1', true, { rtMs: 100, kind: 'en2zh' }), T0);
    expect(s.box).toBe(MASTERED_BOX);
    expect(s.dueAt).toBe(addDays(T0, 120));
  });

  it('间隔是从 updatedAt→dueAt 反推的，不额外占存储字段', () => {
    const s = graduated(90);
    expect(Object.keys(s)).not.toContain('interval');
    expect(currentInterval(s)).toBe(90);
  });
});

describe('isStubborn', () => {
  it('错得多又爬不上去的才算顽固词', () => {
    expect(isStubborn(at(2, { lapses: 3 }))).toBe(true);
    expect(isStubborn(at(2, { lapses: 2 }))).toBe(false);
    expect(isStubborn(at(5, { lapses: 9 }))).toBe(false);
  });
});
