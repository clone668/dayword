/**
 * 明暗主题。三态：跟随系统 / 强制浅色 / 强制深色，选择存本地。
 *
 * 落地方式是给页面根节点加一个 class（`''` 或 `'dark'`），配色由 app.wxss 里的
 * CSS 变量接管。三条都是被 Skyline 逼出来的，不是随便选的写法：
 * - 不能用 `@media (prefers-color-scheme: dark)` —— Skyline 不支持媒体查询。
 * - 不能用 `.dark .card { }` —— Skyline 只认单类选择器，后代选择器不生效。
 * - 所以变量只能定义在根节点上、靠继承往下传。这是两端都成立的唯一写法。
 *
 * 「跟随系统」依赖 app.json 里的 `darkmode: true`：没声明的话
 * `wx.getAppBaseInfo().theme` 根本不返回值，只能一直按浅色走。
 */
export type ThemeMode = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

const KEY = 'dw:theme';

/** 点按钮的循环顺序 */
const ORDER: readonly ThemeMode[] = ['system', 'light', 'dark'];

export const MODE_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

/** 顶栏那颗按钮上的字形。用文字符号而不是 emoji：emoji 在两端渲染大小不一致 */
export const MODE_GLYPH: Record<ThemeMode, string> = {
  system: '◐',
  light: '☀',
  dark: '☾',
};

export function mode(): ThemeMode {
  const v = wx.getStorageSync(KEY) as unknown;
  // 存了才算强制，其余（没存过、脏数据）都退回跟随系统
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function setMode(m: ThemeMode): void {
  if (m === 'system') wx.removeStorageSync(KEY);
  else wx.setStorageSync(KEY, m);
}

/** 点一下换下一个模式，返回新模式 */
export function cycle(): ThemeMode {
  const next = ORDER[(ORDER.indexOf(mode()) + 1) % ORDER.length]!;
  setMode(next);
  return next;
}

export function scheme(): Scheme {
  const m = mode();
  if (m !== 'system') return m;
  return wx.getAppBaseInfo().theme === 'dark' ? 'dark' : 'light';
}

/** 根节点要追加的 class */
export function pageClass(): string {
  return scheme() === 'dark' ? 'dark' : '';
}

/**
 * 监听系统主题切换，返回取消函数。
 * 页面必须在 onUnload 里调用它 —— wx.onThemeChange 是全局注册的，
 * 每次进页面注册一次而不取消，来回几趟之后一次切换会触发 N 个回调。
 */
export function onSystemChange(cb: () => void): () => void {
  const handler = () => {
    cb();
  };
  wx.onThemeChange(handler);
  return () => {
    wx.offThemeChange(handler);
  };
}
