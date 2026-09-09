# Dayword 发布清单

当前工程可在开发环境运行，但在以下外部输入齐全并完成真机验收前，**不可提交正式发布**。

## 主体与微信配置

- [ ] 发布主体具备微信小程序教育类目所需证件，类目选择和实际功能一致。
- [ ] 将 `project.config.json` 的 `touristappid` 换成正式 AppID；个人本机配置继续放在被忽略的 `project.private.config.json`。
- [ ] 在微信公众平台配置合法 downloadFile 域名，并确认域名备案、HTTPS 证书和跨域响应正常。
- [ ] 完成隐私保护指引、儿童/监护人相关说明和最终合规审核。
- [ ] 复制 `release-approval.example.json` 为被忽略的 `release-approval.json`；只有完成下方对应人工验收后，才把各项改为 `true`。

## 内容与媒体

- [ ] L5/L6 词表、释义、例句经过版权与教研审核，且通过 `npm run content:check`。
- [ ] 构建期用 Azure Neural TTS `en-US-AnaNeural` 生成正式 MP3；免费 MVP 可用 edge-tts，不接 WechatSI 实时 TTS。
- [ ] 按 `dist/content/asset-manifest.json` 上传全部 word/ex 音频和 WebP 图片，保证无缺项、大小写一致。
- [ ] 在 `miniprogram/data/cdn.ts` 配置带版本目录的 HTTPS `CDN_BASE`，并执行全量 200/内容类型检查。

## 工程门禁

- [ ] `npm run check` 通过（含 WXML 图片降级和 Skyline 单类选择器/CSS 变量静态检查）。
- [ ] `npm run release:check` 不再报告 AppID、CDN、L5/L6 等阻塞项。
- [ ] 微信开发者工具上传检查通过；确认包体积、Skyline 和基础库版本。
- [ ] trial/release 中不显示日期穿越和重新定级开发工具。

## 开发者工具与真机矩阵

- [ ] 小屏 Skyline 滚动；浅色、深色、跟随系统三种主题。
- [ ] 连续点按、返回/重进、答题后立即杀进程、结算中断和恢复。
- [ ] Storage 配额不足、事务中途失败、离线、慢网、图片 404、音频下载/缓存/播放失败。
- [ ] iOS 与 Android 至少各一台真实设备，冷启动、后台恢复和弱网重试。
- [ ] 核对无答案、学习明细、个人信息或凭据被写入诊断日志或发送到第三方。
