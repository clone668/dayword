import type { LevelConfig } from './config.js';
import type { Answer, WordState } from './types.js';

/**
 * 调度分两层，不要混在一起：
 * - **日级**（planDay）：跨天的 Leitner 间隔重复，决定今天该复习哪些词。
 * - **会话级**（startSession/submit）：当次答错的词插回队尾，当天就要再见一次。
 *
 * 只有日级会持久化。会话级状态是内存里的，退出即弃（下次进来按日级重算）。
 */

/** 开场先出几个已学过的词热身 */
export const WARMUP_REVIEWS = 2;
/** 每 N 个位置插一个新词，避免新词连续出现 */
export const NEW_EVERY = 3;
/** 答错的词至少隔几题再出现 —— 立刻重出等于让孩子照抄刚看到的答案 */
export const RETRY_GAP = 2;
/** 同一会话内单个词的最大重试次数，防止一个词把孩子卡死 */
export const MAX_RETRY = 3;

export interface DailyPlan {
  /** 今天要复习的词，已按优先级排序 */
  reviewIds: string[];
  /** 今天允许发放的新词数量 */
  newQuota: number;
  /** 到期但今天排不下的数量（积压） */
  backlog: number;
  /** 是否因积压过多而暂停发新词 */
  newPaused: boolean;
}

/**
 * 队列优先级：顽固词 → 逾期最久 → 盒子最低 → wordId。
 * 最后一项保证是全序，测试结果才可复现。
 */
export function compareReviewPriority(a: WordState, b: WordState): number {
  if (a.lapses !== b.lapses) return b.lapses - a.lapses;
  if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
  if (a.box !== b.box) return a.box - b.box;
  return a.wordId < b.wordId ? -1 : a.wordId > b.wordId ? 1 : 0;
}

/**
 * 编排今天的任务量。
 *
 * 两行关键防护：复习量硬封顶，且**只要有积压就暂停发新词**（先还旧账）。
 * 没有这两条，断签几天回来队列会爆掉，是儿童学习产品最常见的流失点。
 *
 * `backlog > 0` 而不是某个宽松阈值，是让系统**自我调速**：
 * 新词是复习量的唯一来源（每个新词最终会带来约 6 次复习），
 * 所以"复习排不下 ⇒ 停止进货"构成负反馈闭环，稳定在 reviewCap 附近。
 * 于是 reviewCap 是唯一真正的旋钮（每日投入预算），newPerDay 只是上限。
 */
export function planDay(
  states: readonly WordState[],
  cfg: Pick<LevelConfig, 'newPerDay' | 'reviewCap'>,
  now: number,
): DailyPlan {
  const due = states.filter((s) => s.dueAt <= now).sort(compareReviewPriority);
  const reviewIds = due.slice(0, cfg.reviewCap).map((s) => s.wordId);
  const backlog = due.length - reviewIds.length;
  const newPaused = backlog > 0;
  return { reviewIds, newQuota: newPaused ? 0 : cfg.newPerDay, backlog, newPaused };
}

export interface QueueItem {
  wordId: string;
  /** 新词的第一张卡是"教"（图+音+词+义），不是"测" */
  isNew: boolean;
}

export interface SessionState {
  queue: QueueItem[];
  /** 本次会话内已了结的词（答对，或用完重试次数） */
  done: string[];
  /** 本次会话内每个词答错了几次 */
  misses: Record<string, number>;
  answers: Answer[];
  /** 开场题数，用于进度条分母（重试不改变分母，否则进度会倒退） */
  plannedTotal: number;
}

/**
 * 新词与复习词交错。
 *
 * 先用 2 个已学过的词热身：一上来就是新词，孩子面对的是最陌生的内容，
 * 开场体验最差。之后新词靠前但不连续 —— 注意力最好时学新东西，
 * 尾段留给纯复习。
 */
export function interleave(reviewIds: readonly string[], newIds: readonly string[]): QueueItem[] {
  const out: QueueItem[] = [];
  let ri = 0;
  let ni = 0;
  const warmup = Math.min(WARMUP_REVIEWS, reviewIds.length);
  for (; ri < warmup; ri++) out.push({ wordId: reviewIds[ri]!, isNew: false });

  while (ni < newIds.length || ri < reviewIds.length) {
    const slot = out.length - warmup;
    const wantNew = ni < newIds.length && (slot % NEW_EVERY === 0 || ri >= reviewIds.length);
    if (wantNew) out.push({ wordId: newIds[ni++]!, isNew: true });
    else out.push({ wordId: reviewIds[ri++]!, isNew: false });
  }
  return out;
}

export function startSession(reviewIds: readonly string[], newIds: readonly string[]): SessionState {
  const queue = interleave(reviewIds, newIds);
  return { queue, done: [], misses: {}, answers: [], plannedTotal: queue.length };
}

export function current(s: SessionState): QueueItem | null {
  return s.queue[0] ?? null;
}

export function isFinished(s: SessionState): boolean {
  return s.queue.length === 0;
}

export function progress(s: SessionState): { done: number; total: number } {
  return { done: s.done.length, total: s.plannedTotal };
}

/**
 * 提交一次作答，返回新的会话状态（纯函数）。
 * 只更新会话级队列 —— 调用方需自行对 WordState 应用 srs.review。
 */
export function submit(s: SessionState, a: Answer): SessionState {
  const idx = s.queue.findIndex((q) => q.wordId === a.wordId);
  if (idx < 0) throw new Error(`submit: "${a.wordId}" 不在当前会话队列中`);
  const item = s.queue[idx]!;

  const queue = s.queue.slice();
  queue.splice(idx, 1);
  const misses = { ...s.misses };
  const done = s.done.slice();

  if (a.correct) {
    done.push(item.wordId);
  } else {
    const n = (misses[item.wordId] ?? 0) + 1;
    misses[item.wordId] = n;
    if (n <= MAX_RETRY) {
      // 隔几题再来；队尾不足时就放最后
      queue.splice(Math.min(RETRY_GAP, queue.length), 0, { ...item, isNew: false });
    } else {
      done.push(item.wordId); // 今天放过，明天 SRS 会重新安排
    }
  }

  return { ...s, queue, done, misses, answers: [...s.answers, a] };
}

/** 本次会话的有效正确率（首次作答口径，重试不计入分母）。 */
export function firstTryAccuracy(s: SessionState): number {
  const seen = new Set<string>();
  let correct = 0;
  let total = 0;
  for (const a of s.answers) {
    if (seen.has(a.wordId)) continue;
    seen.add(a.wordId);
    total++;
    if (a.correct) correct++;
  }
  return total === 0 ? 0 : correct / total;
}
