/**
 * Repository 的本地实现，基于 `wx.*StorageSync`。
 *
 * 同步 API 包在 Promise 里：Storage 的同步版本在几百 KB 量级下比异步版稳，
 * 而对外保持异步签名，将来换云端不用改调用点（见 repository.ts）。
 */
import { initLevel } from '../core/level.js';
import type { DailyLog } from '../core/stats.js';
import { initStreak } from '../core/streak.js';
import type { Level, WordState } from '../core/types.js';
import type { Profile, Repository } from './repository.js';

/** 默认起点等级。做过定级测试后会被覆盖。 */
export const DEFAULT_LEVEL: Level = 2;

const PREFIX = 'dw:';
const VERSION_KEY = `${PREFIX}schema`;
const PROFILE_KEY = `${PREFIX}profile`;
const LOGS_KEY = `${PREFIX}logs`;
const statesKey = (level: Level) => `${PREFIX}states:L${level}`;

/**
 * 存储结构版本。
 *
 * 字段一变（今天就发生过一次：DailyLog 加了 answerCount），旧存档反序列化出来
 * 就会带 undefined，算出 NaN 的统计值。所以从第一版起就要带版本号。
 *
 * 现在的策略是"版本不符即清空"，只在没有真实用户时可以这样。
 * 上线后必须改成逐版迁移函数，否则一次升级会清掉孩子几个月的进度。
 */
export const SCHEMA_VERSION = 1;

function read<T>(key: string, fallback: T): T {
  const v = wx.getStorageSync(key) as T | '';
  return v === '' || v === null || v === undefined ? fallback : v;
}

export class LocalRepository implements Repository {
  constructor(private readonly startLevel: Level = DEFAULT_LEVEL) {
    const stored = read<number>(VERSION_KEY, 0);
    if (stored !== SCHEMA_VERSION) {
      wx.clearStorageSync();
      wx.setStorageSync(VERSION_KEY, SCHEMA_VERSION);
    }
  }

  async loadProfile(): Promise<Profile> {
    return read<Profile>(PROFILE_KEY, {
      level: initLevel(this.startLevel),
      streak: initStreak(),
      placed: false,
    });
  }

  async saveProfile(p: Profile): Promise<void> {
    wx.setStorageSync(PROFILE_KEY, p);
  }

  async loadStates(level: Level): Promise<WordState[]> {
    return read<WordState[]>(statesKey(level), []);
  }

  async saveStates(level: Level, states: readonly WordState[]): Promise<void> {
    wx.setStorageSync(statesKey(level), states);
  }

  async loadLogs(): Promise<DailyLog[]> {
    // 只留最近 60 天：日志按天线性增长，Storage 总量上限 10MB
    return read<DailyLog[]>(LOGS_KEY, []).slice(-60);
  }

  async saveLogs(logs: readonly DailyLog[]): Promise<void> {
    wx.setStorageSync(LOGS_KEY, logs.slice(-60));
  }

  async clear(): Promise<void> {
    wx.clearStorageSync();
    wx.setStorageSync(VERSION_KEY, SCHEMA_VERSION);
  }
}
