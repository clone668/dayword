/**
 * 资源寻址 —— 词条的 `imageKey`/`audioKey` → CDN URL。
 *
 * 为什么不打包：主包上限 2MB，几千个 mp3/webp 一定装不下。
 * 为什么词条只存 key 而不是完整 URL：换 CDN 域名时不用动数据。
 *
 * **CDN 还没上线**，所以 `CDN_BASE` 为空。此时 `imageUrl()` 返回 null，
 * 页面必须能降级显示（文字卡代替图、音标代替发音）—— 这样界面今天就能跑，
 * 等构建期 TTS 管线（Azure Neural TTS，见项目决策）产出资源后填上域名即可。
 *
 * 这一半刻意不碰 `wx.*`：`data/probe.ts` 和 `data/quizview.ts` 都要用 `hasMedia`，
 * 而它们的单测跑在 node 里 —— 一旦这个文件引入 wx，整条依赖链就没法在 node 侧
 * 通过类型检查了（两边的全局类型是分开的，见 tsconfig.miniprogram.json）。
 * 播放要用 wx，所以 playAudio 单独放在 data/audio.ts。
 */

/** 上线时填成 `https://<你的域名>/dayword/v1/`，并加入小程序 downloadFile 合法域名。 */
export const CDN_BASE = '';

export const hasMedia = CDN_BASE.length > 0;

/** key → URL，没接 CDN 时返回 null（调用方据此走降级路径）。 */
export function assetUrl(key: string): string | null {
  return hasMedia ? CDN_BASE + key : null;
}

export const imageUrl = assetUrl;
