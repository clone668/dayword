import { configFor } from '../miniprogram/core/config.js';
import {
  evaluateDaily,
  initLevel,
  recordAnswers,
  type FirstTry,
  type LevelState,
} from '../miniprogram/core/level.js';
import { KIND_TIER, pickKind } from '../miniprogram/core/questions.js';
import {
  current,
  isFinished,
  planDay,
  startSession,
  submit,
  type DailyPlan,
} from '../miniprogram/core/session.js';
import { isGuess, newWordState, review } from '../miniprogram/core/srs.js';
import { masteredCount, type DailyLog } from '../miniprogram/core/stats.js';
import { checkIn, initStreak, type StreakState } from '../miniprogram/core/streak.js';
import { startOfDay } from '../miniprogram/core/time.js';
import type { Answer, KindTier, Level, WordState } from '../miniprogram/core/types.js';
import { clamp, day, rng } from './helpers.js';

/**
 * 虚拟孩子模拟器。
 *
 * 调度算法的 bug 不会崩溃，只会让复习安排慢慢变得不合理 —— 肉眼看不出来。
 * 唯一可靠的验证方式是跑几十个虚拟学习者、几十万次作答，然后断言不变量。
 * 这件事在小程序模拟器里点按钮永远做不到。
 */

export interface SimOptions {
  days: number;
  poolSize: number;
  seed: number;
  startLevel?: Level;
  /** 这一天是否打开 App。用来模拟断签。 */
  attends?: (d: number) => boolean;
  /** 学习者能力：1 = 基准，>1 学得快，<1 吃力 */
  ability?: number;
  /** 每次答对有多大概率是"秒答蒙中的" */
  guessRate?: number;
}

export interface DayRecord {
  d: number;
  attended: boolean;
  /** 当天用于排任务的等级 */
  level: Level;
  plan: DailyPlan;
  /** 当天实际出题数（含会话内重试） */
  asked: number;
  newIntroduced: number;
  /**
   * 想发新词但词池已空。
   * 词池耗尽的表象和"调度器决定不发新词"一模一样，必须能区分开，
   * 否则一个模拟器配置问题会被当成引擎的自适应行为读过去。
   */
  starved: boolean;
  mastered: number;
  streak: number;
}

export interface SimResult {
  records: DayRecord[];
  states: Map<string, WordState>;
  level: LevelState;
  streak: StreakState;
  logs: DailyLog[];
}

/**
 * 题型层级对答对率的影响。
 *
 * 等级唯一能改变的事情就是"出什么题"（见 questions.pickKind），
 * 所以模拟器必须把这一层建模进去。否则降级不会让正确率回升，
 * level.evaluateDaily 就成了开环控制器 —— 会把每个孩子一路压到 L1，
 * 而所有单测依然全绿。这正是模拟器存在的理由。
 */
const TIER_DELTA: Record<KindTier, number> = {
  recognize: 0.1, // 四选一，认得出就能选对
  translate: 0,
  produce: -0.18, // 要从零把拼写写出来
};

/**
 * 练习曲线：答对概率随作答次数上升，被词的固有难度压低，再按题型层级加减。
 * 大部分词最终会毕业，一小撮难词在中层反复震荡 —— 正是我们要观察的顽固词。
 */
function pCorrect(reps: number, difficulty: number, ability: number, tier: KindTier): number {
  const learned = 1 - Math.exp(-0.35 * ability * reps);
  return clamp(0.45 * ability + 0.5 * learned - 0.3 * difficulty + TIER_DELTA[tier], 0.05, 0.97);
}

export function runSim(opts: SimOptions): SimResult {
  const rand = rng(opts.seed);
  const attends = opts.attends ?? (() => true);
  const ability = opts.ability ?? 1;
  const guessRate = opts.guessRate ?? 0.05;

  const pool = Array.from({ length: opts.poolSize }, (_, i) => ({
    id: `w${String(i).padStart(4, '0')}`,
    level: ((i % 6) + 1) as Level,
  }));
  const difficulty = new Map(pool.map((w) => [w.id, rand() * 0.95] as const));

  const states = new Map<string, WordState>();
  let level = initLevel(opts.startLevel ?? 3);
  let streak = initStreak();
  const logs: DailyLog[] = [];
  const records: DayRecord[] = [];

  for (let d = 0; d < opts.days; d++) {
    const now = day(d);
    const all = [...states.values()];
    const levelToday = level.level;
    const cfg = configFor(levelToday);
    const plan = planDay(all, cfg, now);

    if (!attends(d)) {
      records.push({
        d,
        attended: false,
        level: levelToday,
        plan,
        asked: 0,
        newIntroduced: 0,
        starved: false,
        mastered: masteredCount(all),
        streak: streak.current,
      });
      continue;
    }

    const newIds = pool
      .filter((w) => w.level <= levelToday && !states.has(w.id))
      .slice(0, plan.newQuota)
      .map((w) => w.id);

    let sess = startSession(plan.reviewIds, newIds);
    const firstTry: FirstTry[] = [];
    const seen = new Set<string>();
    let asked = 0;
    let guesses = 0;
    let guard = 0;

    while (!isFinished(sess)) {
      if (guard++ > 500) throw new Error(`第 ${d} 天会话未收敛：队列里可能有环`);
      const item = current(sess)!;
      const st = states.get(item.wordId) ?? newWordState(item.wordId, now);
      // 先定题型，再算答对率 —— 题型决定难度，这是等级唯一的作用通道
      const kind = pickKind(levelToday, st.box, rand);
      const p = pCorrect(st.reps, difficulty.get(item.wordId) ?? 0.5, ability, KIND_TIER[kind]);
      const correct = rand() < p;
      const guessing = correct && rand() < guessRate;
      const a: Answer = {
        wordId: item.wordId,
        correct,
        rtMs: guessing ? 200 : 900 + Math.floor(rand() * 4000),
        kind,
        at: now,
      };

      if (!seen.has(item.wordId)) {
        seen.add(item.wordId);
        firstTry.push({ correct, isNew: item.isNew });
      }
      if (isGuess(a)) guesses++;

      states.set(item.wordId, review(st, a, now));
      sess = submit(sess, a);
      asked++;
    }

    level = evaluateDaily(recordAnswers(level, firstTry), now).state;
    streak = checkIn(streak, now).state;

    // 日志里的首答口径 = 复习题（记忆保持率），与等级控制器保持一致
    const reviewed = firstTry.filter((t) => !t.isNew);
    logs.push({
      day: startOfDay(now),
      newCount: newIds.length,
      reviewCount: plan.reviewIds.length,
      firstTryCorrect: reviewed.filter((t) => t.correct).length,
      firstTryTotal: reviewed.length,
      answerCount: asked,
      guessCount: guesses,
      seconds: asked * 8,
    });

    records.push({
      d,
      attended: true,
      level: levelToday,
      plan,
      asked,
      newIntroduced: newIds.length,
      starved: newIds.length < plan.newQuota,
      mastered: masteredCount([...states.values()]),
      streak: streak.current,
    });
  }

  return { records, states, level, streak, logs };
}
