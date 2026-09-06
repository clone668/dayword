import { isChoiceKind } from './questions.js';
import { addDays, daysBetween, startOfDay } from './time.js';
import type { Answer, Box, WordState } from './types.js';

/**
 * 每层楼梯的复习间隔（天）。第 5 层 = 已掌握，60 天起、每次答对翻倍。
 *
 * 间隔梯度约 ×2.7 递增。层数（4 次爬升）是刻意压低的：
 * 稳态复习量 ≈ 每日新词 × 爬升层数，层数每加一，孩子每天多做一批题。
 */
export const BOX_INTERVALS: Record<Box, number> = { 1: 1, 2: 3, 3: 8, 4: 21, 5: 60 };

export const MASTERED_BOX: Box = 5;

/**
 * 已掌握词的间隔上限（天）。
 *
 * 顶层间隔必须能一直增长，否则维护负担会随词汇量线性膨胀：
 * 顶层固定 30 天的话，1000 个已掌握的词就是每天 33 道抽查题，
 * 光维护旧词就把每日预算吃光了，新词永远发不出去。
 */
export const MASTERED_MAX_INTERVAL = 365;

/** 反应时间低于此值的选择题视为瞎猜。 */
export const GUESS_RT_MS = 400;

/**
 * 四选一题，闭眼点的期望正确率是 25%，孩子摸出规律后会闭眼刷完拿奖励。
 * 反应时间过短的选择题**计对但不升盒**，间隔也不延长 ——
 * 不惩罚（避免误判打击），但也不给进度。
 */
export function isGuess(a: Answer): boolean {
  return a.correct && a.rtMs < GUESS_RT_MS && isChoiceKind(a.kind);
}

/**
 * 当前生效的复习间隔（天）。
 * 直接从 `updatedAt → dueAt` 反推，不额外存字段 ——
 * WordState 每多一个字段，4000 词就多几 KB，而 Storage 单 key 上限是 1MB。
 */
export function currentInterval(s: WordState): number {
  return Math.max(1, daysBetween(s.updatedAt, s.dueAt));
}

export function newWordState(wordId: string, now: number): WordState {
  return {
    wordId,
    box: 1,
    dueAt: startOfDay(now), // 立即到期：今天就要学
    lapses: 0,
    streak: 0,
    reps: 0,
    firstSeenAt: now,
    updatedAt: now,
  };
}

/**
 * 盒子转移规则。
 *
 * 答错时 `ceil(box / 2)`，即"掉一半"，而不是标准 Leitner 的打回第 1 层：
 * - 从高层掉下来说明遗忘更严重，绝对下降层数更多（5→3），符合直觉；
 * - 低层只掉一点（2→1），永不清零。把辛苦爬到顶层的词一次打回底层，
 *   挫败感会直接劝退孩子；这里用略差的遗忘曲线拟合换留存，对儿童产品划算。
 */
export function nextBox(box: Box, correct: boolean, guessed: boolean): Box {
  if (!correct) return Math.max(1, Math.ceil(box / 2)) as Box;
  if (guessed) return box;
  return Math.min(MASTERED_BOX, box + 1) as Box;
}

/** 1–4 层间隔查表（可预测，和楼梯 UI 一致）；只有顶层的间隔会持续增长。 */
function nextIntervalDays(s: WordState, next: Box, guessed: boolean): number {
  if (next < MASTERED_BOX) return BOX_INTERVALS[next];
  if (s.box < MASTERED_BOX) return BOX_INTERVALS[MASTERED_BOX]; // 刚毕业
  if (guessed) return currentInterval(s);
  return Math.min(MASTERED_MAX_INTERVAL, currentInterval(s) * 2);
}

/**
 * 应用一次作答，返回新的学习状态（纯函数，不改入参）。
 *
 * 会话内答错又答对时会被调用两次，效果是"先掉一半再加一层"：
 * 顶层的词忘了 → 第 3 层（8 天后）→ 答对 → 第 4 层（21 天后）。
 * 间隔从 60 天缩到 21 天，且不需要为"重学"写任何特例分支。
 */
export function review(s: WordState, a: Answer, now: number): WordState {
  const guessed = isGuess(a);
  const box = nextBox(s.box, a.correct, guessed);
  return {
    ...s,
    box,
    dueAt: addDays(now, nextIntervalDays(s, box, guessed)),
    lapses: s.lapses + (a.correct ? 0 : 1),
    streak: a.correct ? s.streak + 1 : 0,
    reps: s.reps + 1,
    updatedAt: now,
  };
}

export function isMastered(s: WordState): boolean {
  return s.box === MASTERED_BOX;
}

export function isDue(s: WordState, now: number): boolean {
  return s.dueAt <= now;
}

/**
 * 顽固词：反复答错、迟迟爬不上去的词。
 * 家长周报的核心内容，也是队列排序的第一优先级。
 */
export function isStubborn(s: WordState): boolean {
  return s.lapses >= 3 && s.box <= 3;
}
