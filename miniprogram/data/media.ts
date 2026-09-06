/**
 * 音频与配图的 CDN 寻址 + 本地缓存。
 *
 * 为什么不打包：主包上限 2MB，几千个 mp3/webp 一定装不下。
 * 为什么词条只存 `audioKey` 而不是完整 URL：换 CDN 域名时不用动数据。
 *
 * **CDN 还没上线**，所以 `CDN_BASE` 为空。此时 url() 返回 null，
 * 页面必须能降级显示（文字卡代替图、音标代替发音）—— 这样界面今天就能跑，
 * 等构建期 TTS 管线（Azure Neural TTS，见项目决策）产出资源后填上域名即可。
 */

/** 上线时填成 `https://<你的域名>/dayword/v1/`，并加入小程序 downloadFile 合法域名。 */
export const CDN_BASE = '';

export const hasMedia = CDN_BASE.length > 0;

function url(key: string): string | null {
  return hasMedia ? CDN_BASE + key : null;
}

export const imageUrl = url;

/** 本地缓存目录下已存好的文件路径，key → 本地路径 */
const cache = new Map<string, string>();

/**
 * 播放单词发音。
 *
 * 首次播放走 downloadFile + saveFile 落地到本地，之后直接读本地文件 ——
 * 孩子每天要听十几遍，每次都联网既慢又费流量。
 * 没有 CDN 时静默返回 false，调用方据此显示"音频待接入"。
 */
export function playAudio(key: string): boolean {
  const remote = url(key);
  if (remote === null) return false;

  const play = (src: string) => {
    const ctx = wx.createInnerAudioContext({ useWebAudioImplement: false });
    ctx.src = src;
    ctx.onEnded(() => ctx.destroy());
    ctx.onError(() => ctx.destroy());
    ctx.play();
  };

  const cached = cache.get(key);
  if (cached !== undefined) {
    play(cached);
    return true;
  }

  wx.downloadFile({
    url: remote,
    success: (res) => {
      if (res.statusCode !== 200) return;
      wx.getFileSystemManager().saveFile({
        tempFilePath: res.tempFilePath,
        success: (saved) => {
          cache.set(key, saved.savedFilePath);
          play(saved.savedFilePath);
        },
        fail: () => play(res.tempFilePath), // 存不下就先播临时文件
      });
    },
  });
  return true;
}
