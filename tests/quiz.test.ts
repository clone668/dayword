import { describe, expect, it } from 'vitest';
import {
  buildQuestion,
  checkAnswer,
  clozeOf,
  OPTION_COUNT,
  pickDistractors,
} from '../miniprogram/core/quiz.js';
import { WORDS, WORD_BY_ID } from '../miniprogram/data/words.js';
import { rng } from './helpers.js';

const word = (text: string) => WORD_BY_ID.get(`w-${text}`)!;
const textOf = (id: string) => WORD_BY_ID.get(id)!.text;

describe('pickDistractors', () => {
  it('不含正确项，不重复，数量足够', () => {
    const rand = rng(1);
    for (const target of WORDS) {
      const ds = pickDistractors(target, WORDS, OPTION_COUNT - 1, rand);
      expect(ds).toHaveLength(OPTION_COUNT - 1);
      expect(ds.some((d) => d.id === target.id)).toBe(false);
      expect(new Set(ds.map((d) => d.id)).size).toBe(ds.length);
    }
  });

  it('优先挑同标签的词 —— 否则孩子靠"哪个像食物"就能排除', () => {
    const apple = word('apple');
    const ds = pickDistractors(apple, WORDS, 3, rng(2));
    expect(ds.every((d) => d.tags.some((t) => apple.tags.includes(t)))).toBe(true);
  });

  it('词池不足时不会崩，只是给不满', () => {
    const tiny = [word('apple'), word('dog')];
    expect(pickDistractors(word('apple'), tiny, 3, rng(3))).toHaveLength(1);
    expect(pickDistractors(word('apple'), [word('apple')], 3, rng(3))).toHaveLength(0);
  });
});

describe('clozeOf', () => {
  it('把目标词从例句里挖掉，其余原样保留', () => {
    expect(clozeOf(word('apple'))).toBe('I eat an ______ every day.');
  });
});

describe('buildQuestion', () => {
  it('选择题：answerIndex 指向正确项，选项数为 OPTION_COUNT', () => {
    const rand = rng(7);
    for (const target of WORDS) {
      const q = buildQuestion(target, 'en2zh', WORDS, rand);
      expect(q.optionIds).toHaveLength(OPTION_COUNT);
      expect(q.optionIds[q.answerIndex]).toBe(target.id);
      expect(checkAnswer(q, q.answerIndex)).toBe(true);
      expect(checkAnswer(q, (q.answerIndex + 1) % OPTION_COUNT)).toBe(false);
    }
  });

  it('产出题没有选项，判分靠拼写', () => {
    const q = buildQuestion(word('banana'), 'typeSpell', WORDS, rng(4));
    expect(q.isChoice).toBe(false);
    expect(q.optionIds).toHaveLength(0);
    expect(q.answerIndex).toBe(-1);
    expect(checkAnswer(q, '  BaNaNa ')).toBe(true); // 大小写与空格不该坑孩子
    expect(checkAnswer(q, 'bananna')).toBe(false); // 但拼错就是拼错
  });

  it('拖拽拼写给出的字母正好能拼回原词', () => {
    const q = buildQuestion(word('elephant'), 'dragSpell', WORDS, rng(5));
    expect([...q.letters].sort().join('')).toBe([...'elephant'].sort().join(''));
  });

  it('选择题不会把正确答案的文本混进干扰项', () => {
    const q = buildQuestion(word('cat'), 'image2word', WORDS, rng(6));
    const others = q.optionIds.filter((_, i) => i !== q.answerIndex).map(textOf);
    expect(others).not.toContain('cat');
  });

  it('同一颗种子出同一道题，回归可复现', () => {
    const a = buildQuestion(word('dog'), 'zh2en', WORDS, rng(9));
    const b = buildQuestion(word('dog'), 'zh2en', WORDS, rng(9));
    expect(a).toEqual(b);
  });
});
