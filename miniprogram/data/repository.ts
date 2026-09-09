/**
 * 持久化边界。
 *
 * 定下的产品决策是"先本地，预留云同步接口" —— 所以页面只依赖这个接口，
 * 不直接调 `wx.getStorage`。将来接云开发时新写一个实现即可，页面一行不改。
 *
 * 接口刻意做成异步：本地实现虽然是同步的，但如果签名是同步的，
 * 换云端时每个调用点都要改成 await，那时"预留接口"就白留了。
 */
import type { DailyLog } from '../core/stats.js';
import type { FirstTry, LevelState } from '../core/level.js';
import type { SessionState } from '../core/session.js';
import type { StreakState } from '../core/streak.js';
import type { Level, WordState } from '../core/types.js';

/** 跨等级的用户档案。数据量恒定，单 key 存放。 */
export interface Profile {
  level: LevelState;
  streak: StreakState;
  /** 是否做过定级测试。false 时用默认起点等级。 */
  placed: boolean;
}

/**
 * 学习页的可恢复断点。只存领域状态，不存 QuizView、计时器或音频上下文。
 * `activeSeconds` 只累计页面实际打开时间，关闭小程序期间不会继续走表。
 */
export interface LearningDraft {
  id: string;
  at: number;
  session: SessionState;
  states: WordState[];
  firstTry: FirstTry[];
  seen: string[];
  asked: number;
  guesses: number;
  newCount: number;
  reviewCount: number;
  activeSeconds: number;
  updatedAt: number;
}

export interface SnapshotData {
  profile: Profile;
  states: WordState[];
  logs: DailyLog[];
}

export interface Repository {
  loadProfile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<void>;

  /**
   * 按等级分 key 读写词状态。
   *
   * 不是过度设计：`wx.setStorage` 单 key 上限 1MB，
   * 4000 词 × ~120B ≈ 480KB 已经过半，一次 JSON 序列化全量写入也会卡顿。
   */
  loadStates(level: Level): Promise<WordState[]>;
  saveStates(level: Level, states: readonly WordState[]): Promise<void>;
  /** 可选扩展：本地实现用它保留已从当前词库移除的状态。 */
  loadOrphanStates?(): Promise<WordState[]>;

  loadLogs(): Promise<DailyLog[]>;
  saveLogs(logs: readonly DailyLog[]): Promise<void>;

  loadDraft(): Promise<LearningDraft | null>;
  saveDraft(draft: LearningDraft): Promise<void>;
  removeDraft(): Promise<void>;

  /** profile/logs/六级状态作为一个可恢复事务提交；可同时删掉已结算草稿。 */
  commitSnapshot(snapshot: SnapshotData, clearDraft?: boolean): Promise<void>;

  clear(): Promise<void>;
}
