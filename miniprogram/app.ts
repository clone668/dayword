/**
 * 应用入口。
 *
 * 这里刻意什么都不做：状态在 `data/store.ts`（存储）和各页面（会话）里，
 * 不放 globalData —— 小程序的 globalData 是隐式全局变量，
 * 页面之间靠它传状态时，"谁在什么时候改了它"很快就查不清了。
 */
App({
  onLaunch() {
    // 小程序里 console 是唯一可靠的排障手段（真机上没有 devtools）
    console.info('[dayword] 启动');
  },

  /** 兜底：未捕获的异常至少要能在控制台看到，不然表现就是白屏 */
  onError(err: string) {
    console.error('[dayword] 未捕获错误', err);
  },
});
