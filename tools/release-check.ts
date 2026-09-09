import { readFileSync } from 'node:fs';
import { MAX_PROBE_LEVEL } from '../miniprogram/data/probe.js';

interface ReleaseApproval {
  educationCredentials?: boolean;
  privacyReview?: boolean;
  developerToolsUpload?: boolean;
  realDeviceMatrix?: boolean;
}

const project = JSON.parse(readFileSync('project.config.json', 'utf8')) as {
  appid?: string;
  setting?: { urlCheck?: boolean; minified?: boolean; uploadWithSourceMap?: boolean };
};
const cdnSource = readFileSync('miniprogram/data/cdn.ts', 'utf8');
let approval: ReleaseApproval = {};
try {
  approval = JSON.parse(readFileSync('release-approval.json', 'utf8')) as ReleaseApproval;
} catch {
  // 人工验收尚未形成可提交记录时保持全部未确认。
}
const blockers: string[] = [];

if (!project.appid || project.appid === 'touristappid') blockers.push('正式 AppID 尚未配置（当前是 touristappid）');
if (/export const CDN_BASE = ''/.test(cdnSource)) blockers.push('CDN_BASE 为空，图片与预生成发音资源尚未部署');
if (MAX_PROBE_LEVEL < 6) blockers.push(`审定词库只覆盖到 L${MAX_PROBE_LEVEL}，L5/L6 内容缺失`);
if (project.setting?.urlCheck !== true) blockers.push('开发者工具未开启合法域名校验');
if (project.setting?.minified !== true) blockers.push('上传代码压缩未开启');
if (project.setting?.uploadWithSourceMap !== false) blockers.push('上传源码映射未关闭');
if (!approval.educationCredentials) blockers.push('教育类目资质尚未由发布主体确认');
if (!approval.privacyReview) blockers.push('隐私说明与微信审核材料尚未完成最终确认');
if (!approval.developerToolsUpload) blockers.push('微信开发者工具上传检查尚未确认');
if (!approval.realDeviceMatrix) blockers.push('iOS/Android 真机弱网与缓存矩阵尚未确认');

if (blockers.length === 0) {
  console.info('发布预检通过');
} else {
  console.error('发布预检未通过：');
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
}
