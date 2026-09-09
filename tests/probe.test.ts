/**
 * 定级题源。这一层的 bug 都是"静默"的 —— 出得出题、不报错，
 * 只是把二分查找变成掷硬币，或者把孩子定到一个没有词可教的等级上。
 * 所以这里测的主要是"抽自哪一级"和"排除了哪些题型"。
 */
import { describe, expect, it } from 'vitest';
import { PROBE_SIZE, startPlacement, submitProbe } from '../miniprogram/core/placement.js';
import { KIND_TIER } from '../miniprogram/core/questions.js';
import { checkAnswer } from '../miniprogram/core/quiz.js';
import type { Level } from '../miniprogram/core/types.js';
import { hasMedia } from '../miniprogram/data/cdn.js';
import {
  buildProbe,
  MAX_PROBE_LEVEL,
  PROBE_CAPPED,
  probeKinds,
  PROBE_TOTAL,
} from '../miniprogram/data/probe.js';
import { viewOf } from '../miniprogram/data/quizview.js';
import { WORDS, WORD_BY_ID } from '../miniprogram/data/words.js';

const TESTABLE: Level[] = [1, 2, 3, 4];

/** 确定性随机源（LCG）。传固定种子才能断言"同种子出同一套题" */
function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

describe('MAX_PROBE_LEVEL', () => {
  it('等于词库里凑得出一轮题的最高等级', () => {
    const levels = [...new Set(WORDS.map((w) => w.level))].sort((a, b) => b - a);
    const expected = levels.find((l) => WORDS.filter((w) => w.level === l).length >= PROBE_SIZE);
    expect(MAX_PROBE_LEVEL).toBe(expected);
  });

  it('该等级本身确实凑得满一轮', () => {
    expect(WORDS.filter((w) => w.level === MAX_PROBE_LEVEL).length).toBeGreaterThanOrEqual(PROBE_SIZE);
  });

  it('更高的等级都凑不满 —— 否则上限就该更高', () => {
    for (let l = MAX_PROBE_LEVEL + 1; l <= 6; l++) {
      expect(WORDS.filter((w) => w.level === l).length).toBeLessThan(PROBE_SIZE);
    }
  });

  it('词库还没铺到 L6，PROBE_CAPPED 要如实报告', () => {
    expect(PROBE_CAPPED).toBe(MAX_PROBE_LEVEL < 6);
  });

  it('PROBE_TOTAL 是给文案用的题数上界', () => {
    expect(PROBE_TOTAL % PROBE_SIZE).toBe(0);
    expect(PROBE_TOTAL).toBeGreaterThanOrEqual(PROBE_SIZE);
  });
});

describe('probeKinds', () => {
  it.each(TESTABLE)('L%i 不出产出层题型（认识但拼不出的孩子会被压到 L1）', (level) => {
    for (const k of probeKinds(level)) expect(KIND_TIER[k]).not.toBe('produce');
  });

  it.each(TESTABLE)('L%i 一定有题型可用，不会返回空数组', (level) => {
    expect(probeKinds(level).length).toBeGreaterThan(0);
  });

  it('没接 CDN 时排除 audio2image —— 那道题降级后无解', () => {
    expect(hasMedia).toBe(false); // 前提：CDN_BASE 为空
    for (const level of TESTABLE) expect(probeKinds(level)).not.toContain('audio2image');
  });

  it('等级越高可用题型不减少', () => {
    for (let i = 1; i < TESTABLE.length; i++) {
      expect(probeKinds(TESTABLE[i]!).length).toBeGreaterThanOrEqual(probeKinds(TESTABLE[i - 1]!).length);
    }
  });
});

describe('buildProbe', () => {
  it.each(TESTABLE)('L%i 凑出整整一轮题', (level) => {
    expect(buildProbe(level, seeded(7)).length).toBe(PROBE_SIZE);
  });

  it.each(TESTABLE)('L%i 的题目词**只**抽自该等级本身', (level) => {
    // 抽自 wordsUpToLevel(level) 的话，L4 探测和 L1 探测难度一样，二分退化成掷硬币
    for (const q of buildProbe(level, seeded(level * 31))) {
      expect(WORD_BY_ID.get(q.wordId)!.level).toBe(level);
    }
  });

  it.each(TESTABLE)('L%i 一轮里不重复考同一个词', (level) => {
    const ids = buildProbe(level, seeded(99)).map((q) => q.wordId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(TESTABLE)('L%i 出的都是选择题，页面只渲染选项列', (level) => {
    // 定级页的 WXML 没有 mode 分支，出了拼写题会变成一道点不了的死题
    for (const q of buildProbe(level, seeded(5))) {
      expect(q.isChoice).toBe(true);
      expect(q.optionIds.length).toBeGreaterThan(1);
      expect(q.answerIndex).toBeGreaterThanOrEqual(0);
      expect(q.answerIndex).toBeLessThan(q.optionIds.length);
    }
  });

  it('同一个随机种子出同一套题', () => {
    const a = buildProbe(3, seeded(42)).map((q) => `${q.wordId}:${q.kind}`);
    const b = buildProbe(3, seeded(42)).map((q) => `${q.wordId}:${q.kind}`);
    expect(a).toEqual(b);
  });

  it('不同种子会抽到不同的词 —— 重测不是同一张卷子', () => {
    const runs = [1, 2, 3, 4, 5].map((s) => buildProbe(2, seeded(s * 977)).map((q) => q.wordId).join(','));
    expect(new Set(runs).size).toBeGreaterThan(1);
  });
});

/**
 * 全流程。把定级页的控制流（buildProbe → checkAnswer → submitProbe → 下一轮）
 * 用真词库跑一遍，顺便让 viewOf 渲染每一道题 ——
 * 页面里出现的 bug 大多不在算法上，而在"这道题渲染不出来"。
 */
describe('定级全流程（真词库）', () => {
  const wordOf = (id: string) => WORD_BY_ID.get(id)!;
  const PASS_HITS = Math.ceil(PROBE_SIZE * (2 / 3)); // 刚好压线通过，不满分

  /** 模拟真实等级为 trueLevel 的孩子，走一遍页面的循环 */
  function play(trueLevel: Level, seed: number) {
    let s = startPlacement(MAX_PROBE_LEVEL);
    let asked = 0;
    const rand = seeded(seed);
    let guard = 0;
    while (!s.finished && s.probe !== null) {
      if (guard++ > 10) throw new Error('未收敛');
      const queue = buildProbe(s.probe, rand);
      expect(queue.length).toBe(PROBE_SIZE);
      let hits = 0;
      queue.forEach((q, i) => {
        const view = viewOf(q, wordOf); // 渲染层不能在任何题型上抛
        expect(view.options.length).toBe(q.optionIds.length);
        expect(view.mode).toBe('choice');
        const answerRight = s.probe! <= trueLevel && i < PASS_HITS;
        if (checkAnswer(q, answerRight ? q.answerIndex : -1)) hits++;
        asked++;
      });
      expect(hits).toBe(s.probe <= trueLevel ? PASS_HITS : 0);
      s = submitProbe(s, hits, queue.length);
    }
    return { result: s.result, asked, rounds: s.history.length };
  }

  it.each(TESTABLE)('真实等级 L%i 能被定准', (level) => {
    expect(play(level, level * 13 + 1).result).toBe(level);
  });

  it('超出词库上限的孩子被定在上限，而不是定到没有词的等级', () => {
    expect(play(6, 77).result).toBe(MAX_PROBE_LEVEL);
  });

  it.each(TESTABLE)('L%i 的总题数不超过 PROBE_TOTAL —— 进度条分母才可信', (level) => {
    const { asked, rounds } = play(level, level * 101);
    expect(asked).toBeLessThanOrEqual(PROBE_TOTAL);
    expect(rounds * PROBE_SIZE).toBe(asked);
  });

  it('「不认识」永远判错，不会被当成蒙对', () => {
    for (const q of buildProbe(3, seeded(3))) expect(checkAnswer(q, -1)).toBe(false);
  });
});
