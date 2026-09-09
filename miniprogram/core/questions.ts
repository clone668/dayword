import type { Box, KindTier, Level, QuestionKind } from './types.js';

/** 题型解锁等级。低龄段不出需要打字的题。 */
export const KIND_MIN_LEVEL: Record<QuestionKind, Level> = {
  audio2image: 1,
  image2word: 1,
  en2zh: 2,
  zh2en: 2,
  dragSpell: 3,
  clozeSentence: 4,
  typeSpell: 5,
  dictation: 5,
};

export const KIND_TIER: Record<QuestionKind, KindTier> = {
  audio2image: 'recognize',
  image2word: 'recognize',
  en2zh: 'translate',
  zh2en: 'translate',
  clozeSentence: 'translate',
  dragSpell: 'produce',
  typeSpell: 'produce',
  dictation: 'produce',
};

/**
 * 有限选项、可以闭着眼睛蒙中的题型。
 * srs.isGuess 只对这些题型做反应时间判定 —— 拼写题蒙不出来，不需要防。
 */
export const CHOICE_KINDS: ReadonlySet<QuestionKind> = new Set<QuestionKind>([
  'audio2image',
  'image2word',
  'en2zh',
  'zh2en',
  'clozeSentence',
]);

/** 由难到易的回退顺序。等级低时高层级题型不可用，逐级回退。 */
const TIER_FALLBACK: Record<KindTier, KindTier[]> = {
  produce: ['produce', 'translate', 'recognize'],
  translate: ['translate', 'recognize', 'produce'],
  recognize: ['recognize', 'translate', 'produce'],
};

const ALL_KINDS = Object.keys(KIND_MIN_LEVEL) as QuestionKind[];

export function isChoiceKind(kind: QuestionKind): boolean {
  return CHOICE_KINDS.has(kind);
}

/** 当前等级已解锁的题型。 */
export function kindsForLevel(level: Level): QuestionKind[] {
  return ALL_KINDS.filter((k) => KIND_MIN_LEVEL[k] <= level);
}

/**
 * 盒子高度 → 认知层级。
 *
 * 同一个词在不同盒子用不同题型，复习就不是简单重复，难度随掌握度递增。
 * 刚学会的词只要求"认得出"，快毕业的词要求"写得出"。
 */
export function tierForBox(box: Box): KindTier {
  if (box <= 2) return 'recognize';
  if (box <= 4) return 'translate';
  return 'produce';
}

/**
 * 为某个词选一道题。
 * @param rand 注入随机源，测试时传固定值以保证确定性
 */
export function pickKind(
  level: Level,
  box: Box,
  rand: () => number = Math.random,
  available: (kind: QuestionKind) => boolean = () => true,
): QuestionKind {
  const unlocked = kindsForLevel(level).filter(available);
  for (const tier of TIER_FALLBACK[tierForBox(box)]) {
    const candidates = unlocked.filter((k) => KIND_TIER[k] === tier);
    if (candidates.length > 0) {
      const idx = Math.min(candidates.length - 1, Math.floor(rand() * candidates.length));
      return candidates[idx]!;
    }
  }
  // 正常的 L1 一定有 recognize 题型；若调用方把媒体题全过滤掉，仍回退到可答的图词题。
  return unlocked[0] ?? 'image2word';
}
