import type { Level } from './types.js';

/** 每个等级的每日任务参数。对应产品文档里的分级表。 */
export interface LevelConfig {
  /**
   * 每日新词**上限**（不是保证值）。
   * 有积压时会自动降到 0，所以实际速度是系统自适应的，见 session.planDay。
   */
  newPerDay: number;
  /**
   * 每日复习硬封顶 —— 这是真正的控制旋钮（孩子每天的作业预算）。
   *
   * 数值不能随手改。稳态复习量由 Little's law 决定：
   *   每日复习量 ≈ 每日新词 × 爬升层数(4) ÷ 首答正确率(≈0.7) ≈ 新词 × 6
   * 所以 reviewCap 必须 ≳ newPerDay × 6，否则积压永远清不掉、
   * 新词会被永久暂停 —— 系统不会报错，只会静静地停止教新东西。
   */
  reviewCap: number;
  /** 单次会话建议时长（秒），家长中心的默认值 */
  sessionSeconds: number;
}

export const LEVEL_CONFIG: Record<Level, LevelConfig> = {
  1: { newPerDay: 2, reviewCap: 12, sessionSeconds: 240 },
  2: { newPerDay: 3, reviewCap: 18, sessionSeconds: 300 },
  3: { newPerDay: 4, reviewCap: 24, sessionSeconds: 420 },
  4: { newPerDay: 5, reviewCap: 30, sessionSeconds: 480 },
  5: { newPerDay: 6, reviewCap: 36, sessionSeconds: 600 },
  6: { newPerDay: 8, reviewCap: 44, sessionSeconds: 660 },
};

/**
 * 主题皮肤。跨 3–12 岁不可能用同一套视觉和奖励语言：
 * 给 11 岁孩子发小动物贴纸他会觉得幼稚并拒绝使用。
 * 皮肤跟等级自动切换，也允许家长手动指定。
 */
export type ThemeId = 'farm' | 'explorer' | 'agent';

export const LEVEL_THEME: Record<Level, ThemeId> = {
  1: 'farm',
  2: 'farm',
  3: 'explorer',
  4: 'explorer',
  5: 'agent',
  6: 'agent',
};

export function configFor(level: Level): LevelConfig {
  return LEVEL_CONFIG[level];
}
