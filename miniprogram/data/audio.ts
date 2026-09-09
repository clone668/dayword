/**
 * 单实例发音播放器。下载合并与有界持久缓存都集中在这里，页面只关心成功/失败。
 */
import { assetUrl } from './cdn.js';

const CACHE_KEY = 'dw:audioCache';
const MAX_FILES = 40;

interface CacheEntry {
  key: string;
  path: string;
  usedAt: number;
}

let player: WechatMiniprogram.InnerAudioContext | null = null;
let cancelPlayer: (() => void) | null = null;
const downloads = new Map<string, Promise<string | null>>();

function readCache(): CacheEntry[] {
  try {
    const raw = wx.getStorageSync(CACHE_KEY) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((value) => {
      if (typeof value !== 'object' || value === null) return [];
      const item = value as Partial<CacheEntry>;
      return typeof item.key === 'string' && typeof item.path === 'string' && typeof item.usedAt === 'number'
        ? [{ key: item.key, path: item.path, usedAt: item.usedAt }]
        : [];
    });
  } catch {
    return [];
  }
}

function writeCache(entries: CacheEntry[]): void {
  try {
    wx.setStorageSync(CACHE_KEY, entries.slice(-MAX_FILES));
  } catch {
    // 元数据写满不能阻断临时文件播放；下次只会重新下载。
  }
}

function remember(key: string, path: string): void {
  const entries = readCache().filter((entry) => entry.key !== key);
  entries.push({ key, path, usedAt: Date.now() });
  const removed = entries.splice(0, Math.max(0, entries.length - MAX_FILES));
  writeCache(entries);
  try {
    const fs = wx.getFileSystemManager();
    for (const entry of removed) fs.unlink({ filePath: entry.path, fail: () => undefined });
  } catch {
    // 删除旧缓存失败只会暂时多占一点空间，不影响当前发音。
  }
}

function download(key: string, remote: string): Promise<string | null> {
  const pending = downloads.get(key);
  if (pending !== undefined) return pending;
  const task = new Promise<string | null>((resolve) => {
    wx.downloadFile({
      url: remote,
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          resolve(null);
          return;
        }
        wx.getFileSystemManager().saveFile({
          tempFilePath: res.tempFilePath,
          success: (saved) => {
            remember(key, saved.savedFilePath);
            resolve(saved.savedFilePath);
          },
          fail: () => resolve(res.tempFilePath),
        });
      },
      fail: () => resolve(null),
    });
  }).finally(() => downloads.delete(key));
  downloads.set(key, task);
  return task;
}

function play(src: string): Promise<boolean> {
  stopAudio();
  return new Promise((resolve) => {
    const ctx = wx.createInnerAudioContext({ useWebAudioImplement: false });
    player = ctx;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (player === ctx) {
        player = null;
        cancelPlayer = null;
      }
      ctx.destroy();
      resolve(ok);
    };
    cancelPlayer = () => finish(false);
    ctx.onEnded(() => finish(true));
    ctx.onError(() => finish(false));
    ctx.src = src;
    ctx.play();
  });
}

export async function playAudio(key: string): Promise<boolean> {
  const remote = assetUrl(key);
  if (remote === null) return false;
  const cached = readCache().find((entry) => entry.key === key);
  if (cached !== undefined) {
    remember(key, cached.path);
    if (await play(cached.path)) return true;
    writeCache(readCache().filter((entry) => entry.key !== key));
  }
  const path = await download(key, remote);
  return path === null ? false : play(path);
}

export function stopAudio(): void {
  const cancel = cancelPlayer;
  cancelPlayer = null;
  if (cancel !== null) {
    cancel();
    return;
  }
  const ctx = player;
  player = null;
  if (ctx === null) return;
  ctx.stop();
  ctx.destroy();
}
