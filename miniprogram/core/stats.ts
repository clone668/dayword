import { isStubborn, MASTERED_BOX } from './srs.js';
import { addDays, daysBetween, startOfDay } from './time.js';
import type { Box, WordState } from './types.js';

/** 每日聚合日志。只存聚合不存明细 —— 明细会线性增长撑爆 10MB 的 Storage 上限。 */
export interface DailyLog {
  /** 本地 00:00 时间戳 */
  day: number;
  newCount: number;
  reviewCount: number;
  /**
   * 首答口径只统计**复习题** —— 也就是记忆保持率。
   * 新词第一次见本来就该答错，混进来会把正常孩子的正确率压到 60% 出头，
   * 家长看到会以为孩子学不动。等级控制器用的是同一口径（见 level.recordAnswers）。
   */
  firstTryCorrect: number;
  firstTryTotal: number;
  /**
   * 当日全部作答次数，含新词与会话内重试。
   *
   * 存在的唯一理由是给 guessCount 一个口径一致的分母：
   * 瞎猜可能发生在任何一次作答上，而 firstTryTotal 只数复习题首答，
   * 两者相除会算出负数的"有效作答率"（曾经真的出过 −133%）。
   */
  answerCount: number;
  /** 疑似瞎猜次数。家长报告展示"有效作答率"而不只是正确率。 */
  guessCount: number;
  seconds: number;
}

export const ALL_BOXES: readonly Box[] = [1, 2, 3, 4, 5];

/**
 * 合并同一天的两份日志。
 *
 * 孩子一天可能进来两次（早上做完，晚上又想练）。第二次会话如果直接覆盖当天日志，
 * 早上那 20 题就凭空消失了 —— 家长看到"今天只做了 3 题"。
 * 全部字段都是累加量，所以合并就是逐项相加；`day` 必须相同，否则是调用方搞错了。
 */
export function mergeLog(prev: DailyLog, add: DailyLog): DailyLog {
  if (prev.day !== add.day) throw new Error('mergeLog: 只能合并同一天的日志');
  return {
    day: prev.day,
    newCount: prev.newCount + add.newCount,
    reviewCount: prev.reviewCount + add.reviewCount,
    firstTryCorrect: prev.firstTryCorrect + add.firstTryCorrect,
    firstTryTotal: prev.firstTryTotal + add.firstTryTotal,
    answerCount: prev.answerCount + add.answerCount,
    guessCount: prev.guessCount + add.guessCount,
    seconds: prev.seconds + add.seconds,
  };
}

/** 把一份日志写进列表：同一天就合并，否则追加，最后按天排序。 */
export function upsertLog(logs: readonly DailyLog[], add: DailyLog): DailyLog[] {
  const prev = logs.find((l) => l.day === add.day);
  return [...logs.filter((l) => l.day !== add.day), prev === undefined ? add : mergeLog(prev, add)].sort(
    (a, b) => a.day - b.day,
  );
}

export function boxDistribution(states: readonly WordState[]): Record<Box, number> {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<Box, number>;
  for (const s of states) dist[s.box]++;
  return dist;
}

export function masteredCount(states: readonly WordState[]): number {
  return states.filter((s) => s.box === MASTERED_BOX).length;
}

export function learningCount(states: readonly WordState[]): number {
  return states.filter((s) => s.box < MASTERED_BOX).length;
}

export function dueCount(states: readonly WordState[], now: number): number {
  return states.filter((s) => s.dueAt <= now).length;
}

/** 顽固词，错得最多的排前面。家长周报的核心内容。 */
export function stubbornWords(states: readonly WordState[], limit = 10): WordState[] {
  return states
    .filter(isStubborn)
    .sort((a, b) => b.lapses - a.lapses || a.box - b.box)
    .slice(0, limit);
}

/** 未来 n 天每天的到期量，给家长端做负载预览（"周末会不会突然很多"）。 */
export function dueForecast(states: readonly WordState[], now: number, days = 7): number[] {
  const out = new Array<number>(days).fill(0);
  const today = startOfDay(now);
  for (const s of states) {
    const offset = daysBetween(today, s.dueAt);
    if (offset < 0) out[0]!++; // 已逾期的算今天
    else if (offset < days) out[offset]!++;
  }
  return out;
}

/**
 * 爬楼梯视图模型 —— 4 层学习层 + 第 5 层毕业区。
 *
 * 这个视图的意义在于让**调度算法本身可见**：孩子看得懂规则，
 * 就会自己生成目标（"那三只总往下掉的，我要把它们治好"）。
 */
export interface StairsFloor {
  box: Box;
  count: number;
  /** 展示用的样本词（每层不必全画出来） */
  sample: string[];
}

export function stairsView(states: readonly WordState[], samplePerFloor = 8): StairsFloor[] {
  const byBox = new Map<Box, WordState[]>();
  for (const b of ALL_BOXES) byBox.set(b, []);
  for (const s of states) byBox.get(s.box)!.push(s);

  return ALL_BOXES.map((box) => {
    const group = byBox.get(box)!;
    return {
      box,
      count: group.length,
      sample: group
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, samplePerFloor)
        .map((s) => s.wordId),
    };
  });
}

export interface WeekReport {
  /** 这 7 天里有几天完成了任务 */
  activeDays: number;
  newLearned: number;
  /** 报告生成时的累计掌握词数 */
  masteredTotal: number;
  /** 复习题首答正确率（记忆保持率）。健康区间 0.7–0.9，见 level 的调级阈值。 */
  firstTryAccuracy: number;
  /**
   * 有效作答率 = 1 − 瞎猜占**全部作答**的比例。低于 0.8 说明孩子在敷衍。
   * 分母是 answerCount 而不是 firstTryTotal —— 口径不一致会算出负数（见 DailyLog）。
   */
  effectiveRate: number;
  totalMinutes: number;
  stubborn: WordState[];
}

export function weekReport(
  logs: readonly DailyLog[],
  states: readonly WordState[],
  now: number,
): WeekReport {
  const from = addDays(now, -6);
  const week = logs.filter((l) => l.day >= from && l.day <= startOfDay(now));

  const sum = (pick: (l: DailyLog) => number) => week.reduce((n, l) => n + pick(l), 0);
  const firstTryTotal = sum((l) => l.firstTryTotal);
  const firstTryCorrect = sum((l) => l.firstTryCorrect);
  const answers = sum((l) => l.answerCount);
  const guesses = sum((l) => l.guessCount);

  return {
    // 首日只有新词、没有复习题，所以不能用 firstTryTotal 判断"今天学了没"
    activeDays: week.filter((l) => l.newCount + l.reviewCount > 0).length,
    newLearned: sum((l) => l.newCount),
    masteredTotal: masteredCount(states),
    firstTryAccuracy: firstTryTotal === 0 ? 0 : firstTryCorrect / firstTryTotal,
    effectiveRate: answers === 0 ? 1 : 1 - guesses / answers,
    totalMinutes: Math.round(sum((l) => l.seconds) / 60),
    stubborn: stubbornWords(states, 5),
  };
}
