/**
 * 定级测试的题目来源 —— 「测哪个等级、抽哪些词、出哪种题」都在这里。
 *
 * 和 `data/plan.ts` 是同一个角色：core 只管算法（二分收敛），
 * 这一层负责把算法要的"某个等级的 3 道题"从真实词库里凑出来。
 *
 * 三条约束都不是可选的：
 *
 * 1. **词必须抽自 probe 这一级本身**，不是 `wordsUpToLevel(probe)`。
 *    抽"≤ probe 的所有词"的话，L4 探测和 L1 探测的题目难度一模一样，
 *    二分查找就退化成了掷硬币 —— 而且不会报错。
 *
 * 2. **不出 produce 层题型**（拼写/听写）。定级要测的是词汇量，
 *    混进拼写会把"认识但拼不出"的孩子压到 L1。
 *
 * 3. **没接 CDN 时排除 audio2image**。那道题的题干只有音频，
 *    降级路径里既没有音频也没有配图，四个中文选项摆在那儿是道无解题。
 *    image2word 的降级是"中文题干 + 英文选项"，仍然答得出来，所以可以留。
 */
import { probesLeft, PROBE_SIZE, startPlacement } from '../core/placement.js';
import { KIND_TIER, kindsForLevel } from '../core/questions.js';
import { buildQuestion, type Question } from '../core/quiz.js';
import type { Level, QuestionKind } from '../core/types.js';
import { hasMedia } from './cdn.js';
import { WORDS, wordsUpToLevel } from './words.js';

/** 定级可用的认知层级：认得出 + 会翻译，不含产出。 */
const PROBE_TIERS = new Set(['recognize', 'translate']);

const atLevel = (level: Level) => WORDS.filter((w) => w.level === level);

/**
 * 词库真正能测到的最高等级。
 *
 * 目前内置词库只到 L4，所以这个值是 4；等词库铺到 L6 会自动变成 6，
 * 不需要改任何调用点。凑不满 PROBE_SIZE 道题的等级不算"能测"——
 * 用 2 道题判 2/3 通过线，等于把通过条件悄悄改成了 100%。
 */
export const MAX_PROBE_LEVEL: Level = ([6, 5, 4, 3, 2, 1] as Level[]).find(
  (l) => atLevel(l).length >= PROBE_SIZE,
) ?? 1;

/** 词库没铺满 L1–L6 —— 结果页要如实告诉家长上限在哪 */
export const PROBE_CAPPED = MAX_PROBE_LEVEL < 6;

/**
 * 整场定级最多答多少题（上界）。
 * 首页的入口卡和定级页的开场都要报这个数，各算一遍必然有一天对不上。
 */
export const PROBE_TOTAL = probesLeft(startPlacement(MAX_PROBE_LEVEL)) * PROBE_SIZE;

function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 该等级下可用于定级的题型。level 至少有 image2word，不会返回空数组。 */
export function probeKinds(level: Level): QuestionKind[] {
  const usable = kindsForLevel(level).filter(
    (k) => PROBE_TIERS.has(KIND_TIER[k]) && (hasMedia || k !== 'audio2image'),
  );
  return usable.length > 0 ? usable : ['image2word'];
}

/**
 * 凑出一轮（PROBE_SIZE 道）题。
 *
 * 干扰项池取 `wordsUpToLevel(level)` 而不是全词库：pickDistractors 会优先挑
 * 同标签、再同等级的词，池子里混进更高等级的生词反而会让题变简单
 * （孩子能靠"这个词我没见过"排除）。
 */
export function buildProbe(level: Level, rand: () => number = Math.random): Question[] {
  const pool = wordsUpToLevel(level);
  return shuffled(atLevel(level), rand)
    .slice(0, PROBE_SIZE)
    .map((w) => {
      const kinds = probeKinds(level);
      const kind = kinds[Math.min(kinds.length - 1, Math.floor(rand() * kinds.length))]!;
      return buildQuestion(w, kind, pool, rand);
    });
}
