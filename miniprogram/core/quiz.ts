/**
 * 出题：把「词 + 题型」变成一道可判分的题（纯数据，不含任何渲染）。
 *
 * 干扰项生成放在 core 而不是页面里，是因为它直接决定题目难度 ——
 * 「哪个是食物」和「哪个水果是黄的」根本不是同一道题，而难度是
 * 等级控制器的输入信号（见 level.ts）。放在页面里会变成没人测的隐形旋钮。
 */
import { isChoiceKind } from './questions.js';
import type { KindTier, QuestionKind, Word } from './types.js';
import { KIND_TIER } from './questions.js';

/** 每道选择题的选项数 */
export const OPTION_COUNT = 4;

export interface Question {
  wordId: string;
  kind: QuestionKind;
  tier: KindTier;
  isChoice: boolean;
  /** 选择题候选词 id（含正确项），已混洗；产出题为空 */
  optionIds: string[];
  /** 正确选项下标；产出题为 -1 */
  answerIndex: number;
  /** 正确拼写。产出题判分用，选择题也留着做反馈。 */
  answer: string;
  /** dragSpell 用：打乱后的字母 */
  letters: string[];
  /** clozeSentence 用：挖空后的句子。没有例句或没有挖空信息时为 null。 */
  cloze: string | null;
}

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * 干扰项：同标签 → 同等级 → 任意，逐层补足。
 *
 * 同标签的最难：孩子不能靠"哪个看起来像食物"排除，必须真的认识这个词。
 * 词池太小时会退化到跨标签，这是可接受的降级，但不能重复也不能包含正确项。
 */
export function pickDistractors(
  target: Word,
  pool: readonly Word[],
  n: number,
  rand: () => number,
): Word[] {
  const others = pool.filter((w) => w.id !== target.id);
  const tiers = [
    others.filter((w) => w.tags.some((t) => target.tags.includes(t))),
    others.filter((w) => w.level === target.level),
    others,
  ];

  const out: Word[] = [];
  const taken = new Set<string>();
  for (const group of tiers) {
    for (const w of shuffle(group, rand)) {
      if (out.length >= n) return out;
      if (!taken.has(w.id)) {
        taken.add(w.id);
        out.push(w);
      }
    }
  }
  return out;
}

/** 例句挖空。没有 blank 下标时返回 null，调用方应换一种题型或整句显示。 */
export function clozeOf(word: Word): string | null {
  const ex = word.examples[0];
  if (!ex?.blank) return null;
  const [from, to] = ex.blank;
  return `${ex.en.slice(0, from)}______${ex.en.slice(to)}`;
}

export function buildQuestion(
  word: Word,
  kind: QuestionKind,
  pool: readonly Word[],
  rand: () => number,
): Question {
  const choice = isChoiceKind(kind);
  const base = {
    wordId: word.id,
    kind,
    tier: KIND_TIER[kind],
    isChoice: choice,
    answer: word.text,
    letters: kind === 'dragSpell' ? shuffle([...word.text], rand) : [],
    cloze: kind === 'clozeSentence' ? clozeOf(word) : null,
  };

  if (!choice) return { ...base, optionIds: [], answerIndex: -1 };

  const pack = shuffle([word, ...pickDistractors(word, pool, OPTION_COUNT - 1, rand)], rand);
  return {
    ...base,
    optionIds: pack.map((w) => w.id),
    answerIndex: pack.findIndex((w) => w.id === word.id),
  };
}

/**
 * 判分。
 * 选择题传下标，产出题传拼写 —— 拼写忽略大小写与首尾空格，
 * 孩子打字不该被格式坑（但拼错就是拼错，不做模糊匹配）。
 */
export function checkAnswer(q: Question, input: number | string): boolean {
  if (q.isChoice) return typeof input === 'number' && input === q.answerIndex;
  return typeof input === 'string' && input.trim().toLowerCase() === q.answer.toLowerCase();
}
