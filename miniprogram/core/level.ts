import { daysBetween, startOfDay } from './time.js';
import type { Level } from './types.js';

/**
 * 等级动态微调。定级测试只给起点，之后靠滚动窗口持续校准。
 */

/** 滚动窗口大小（次首答） */
export const WINDOW = 30;
/** 样本不足时不做任何判断，避免头几天乱跳 */
export const MIN_SAMPLES = 20;

/**
 * 调级阈值。衡量的是**复习题的首答正确率**，也就是"记忆保持率"。
 *
 * 两条线必须大致对称地夹住目标保持率（≈0.8），否则控制器会变成单向棘轮：
 * 30 个样本下测得值的标准差约 0.073，0.7 / 0.9 各距目标 1.4σ，
 * 上下越线的概率都在 8% 左右，配合"连续 3 天"就是罕见但可达。
 * 若把下线设到 0.6（距 2.7σ）、上线留在 0.9，正常孩子只会被一路降到 L1 ——
 * 不会报错，只会安静地给 10 岁孩子出学前词。
 */
export const UP_RATIO = 0.9;
export const DOWN_RATIO = 0.7;
/** 需连续满足条件几天才真正调级，防止单日手滑造成抖动 */
export const UP_DAYS = 3;
export const DOWN_DAYS = 3;
/**
 * 调级后的冷静期（天）。
 *
 * 30 个样本下测得保持率的标准差约 0.073，而"恰好卡在两级之间"的孩子
 * 真实保持率就落在 0.7 或 0.9 附近 —— 光靠噪声就能反复越线。
 * 没有冷静期时长期模拟里会看到 L1↔L2 每 20 天来回跳一次：
 * 对孩子来说就是词表一直在换，比停在略低的等级糟糕得多。
 *
 * 冷静期不消除这种极限环，但把它的周期拉长到"一个月最多动一次"，
 * 并且配合下面的偏置（跨级时优先停在低的一级）收敛到"宁可略低不可略高"。
 */
export const COOLDOWN_DAYS = 14;

export const MIN_LEVEL: Level = 1;
export const MAX_LEVEL: Level = 6;

/** 1 = 升级，-1 = 降级，0 = 不变 */
export type LevelChange = 1 | 0 | -1;

/** 一次首答结果。带上 isNew 是为了让"新词不计入能力评估"由类型强制。 */
export interface FirstTry {
  correct: boolean;
  /** 是否是今天刚教的新词 */
  isNew: boolean;
}

export interface LevelState {
  level: Level;
  /** 最近 WINDOW 次**复习题首答**是否正确，最新在末尾。新词与重试都不计入。 */
  recent: boolean[];
  upDays: number;
  downDays: number;
  /** 已评估过的最后一天，防止同一天评估两次 */
  lastEvalDay: number | null;
  /** 最后一次真正调级的自然日，用于冷静期判断 */
  changedDay: number | null;
}

export function initLevel(level: Level): LevelState {
  return { level, recent: [], upDays: 0, downDays: 0, lastEvalDay: null, changedDay: null };
}

/**
 * 追加首答结果，保持滚动窗口长度。
 *
 * **新词会被丢掉**：新词第一次见本来就该答错，那衡量的是"今天发了几个新词"，
 * 不是"这个等级合不合适"。混进来还会造成隐性耦合 ——
 * 调大 newPerDay 会顺带把所有孩子往下压一级。
 */
export function recordAnswers(s: LevelState, results: readonly FirstTry[]): LevelState {
  const reviewed = results.filter((r) => !r.isNew).map((r) => r.correct);
  const recent = [...s.recent, ...reviewed].slice(-WINDOW);
  return { ...s, recent };
}

export function accuracy(s: LevelState): number {
  if (s.recent.length === 0) return 0;
  return s.recent.filter(Boolean).length / s.recent.length;
}

/**
 * 每天会话结束时调用一次。
 *
 * 返回的 `changed` 决定 UI 表现：升级要大张旗鼓庆祝；
 * **降级必须静默** —— 不给孩子任何"你退步了"的反馈，只在家长端记录。
 */
export function evaluateDaily(
  s: LevelState,
  now: number,
): { state: LevelState; changed: LevelChange } {
  const day = startOfDay(now);
  if (s.lastEvalDay === day) return { state: s, changed: 0 };
  const base: LevelState = { ...s, lastEvalDay: day };

  if (s.recent.length < MIN_SAMPLES) return { state: base, changed: 0 };

  // 冷静期内只观察不动手，计数器归零 —— 否则冷静期一到就会立刻触发
  if (s.changedDay !== null && daysBetween(s.changedDay, day) < COOLDOWN_DAYS) {
    return { state: { ...base, upDays: 0, downDays: 0 }, changed: 0 };
  }

  const changeTo = (level: Level, changed: LevelChange) => ({
    state: {
      ...base,
      level,
      recent: [] as boolean[],
      upDays: 0,
      downDays: 0,
      changedDay: day,
    },
    changed,
  });

  const acc = accuracy(s);

  if (acc >= UP_RATIO) {
    const upDays = Math.min(s.upDays + 1, UP_DAYS);
    if (upDays >= UP_DAYS && s.level < MAX_LEVEL) {
      return changeTo((s.level + 1) as Level, 1);
    }
    return { state: { ...base, upDays, downDays: 0 }, changed: 0 };
  }

  if (acc <= DOWN_RATIO) {
    const downDays = Math.min(s.downDays + 1, DOWN_DAYS);
    if (downDays >= DOWN_DAYS && s.level > MIN_LEVEL) {
      return changeTo((s.level - 1) as Level, -1);
    }
    return { state: { ...base, downDays, upDays: 0 }, changed: 0 };
  }

  return { state: { ...base, upDays: 0, downDays: 0 }, changed: 0 };
}
