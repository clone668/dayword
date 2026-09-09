import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetManifest, validateContent } from './content.js';

const issues = validateContent();
if (issues.length > 0) {
  for (const issue of issues) console.error(`- ${issue.wordId === undefined ? '' : `${issue.wordId}: `}${issue.message}`);
  process.exitCode = 1;
} else {
  const out = resolve('dist/content/asset-manifest.json');
  mkdirSync(resolve('dist/content'), { recursive: true });
  writeFileSync(out, `${JSON.stringify(assetManifest(), null, 2)}\n`);
  console.info(`内容检查通过；资源清单已生成：${out}`);
}
