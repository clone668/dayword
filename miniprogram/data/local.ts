/** 微信 Storage API 到纯 TypeScript Repository 的薄适配层。 */
import type { Level } from '../core/types.js';
import {
  LocalRepository as DriverRepository,
  type StorageDriver,
} from './local-repository.js';

/** 默认起点等级。做过定级测试后会被覆盖。 */
export const DEFAULT_LEVEL: Level = 2;

export const wxStorageDriver: StorageDriver = {
  get(key) {
    return wx.getStorageSync(key) as unknown;
  },
  set(key, value) {
    wx.setStorageSync(key, value);
  },
  remove(key) {
    wx.removeStorageSync(key);
  },
  keys() {
    return wx.getStorageInfoSync().keys;
  },
};

/** 页面使用的默认本地 Repository；领域逻辑均在可注入驱动的基类中。 */
export class LocalRepository extends DriverRepository {
  constructor(startLevel: Level = DEFAULT_LEVEL) {
    super(wxStorageDriver, startLevel);
  }
}
