import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

interface Issue {
  file: string;
  line: number;
  message: string;
}

const root = resolve('miniprogram');
const issues: Issue[] = [];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function report(file: string, source: string, index: number, message: string): void {
  issues.push({
    file: relative(process.cwd(), file).replace(/\\/g, '/'),
    line: source.slice(0, index).split('\n').length,
    message,
  });
}

function commentRanges(source: string): [number, number][] {
  return [...source.matchAll(/\/\*[\s\S]*?\*\//g)].map((match) => [match.index, match.index + match[0].length]);
}

function inComment(index: number, ranges: readonly [number, number][]): boolean {
  return ranges.some(([from, to]) => index >= from && index < to);
}

function checkWxss(file: string): void {
  const source = readFileSync(file, 'utf8');
  const ranges = commentRanges(source);
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const rules = clean.matchAll(/([^{}]+)\{/g);
  for (const match of rules) {
    const selector = match[1]!.trim();
    if (selector.startsWith('@')) {
      report(file, source, match.index, `Skyline 不允许 at-rule：${selector}`);
      continue;
    }
    for (const part of selector.split(',').map((value) => value.trim())) {
      if (!/^\.[a-zA-Z_][\w-]*$/.test(part)) {
        report(file, source, match.index, `Skyline 选择器必须是单类：${part}`);
      }
    }
  }
  for (const match of source.matchAll(/\bfloat\s*:/g)) {
    if (!inComment(match.index, ranges)) report(file, source, match.index, 'Skyline 不允许 float');
  }
  for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}|\b(?:rgb|hsl)a?\(/g)) {
    if (inComment(match.index, ranges)) continue;
    const before = source.slice(Math.max(0, match.index - 80), match.index);
    if (file.endsWith('app.wxss') && /--[\w-]+\s*:\s*$/.test(before)) continue;
    report(file, source, match.index, '颜色必须通过 app.wxss 的 CSS 变量');
  }
}

function checkWxml(file: string): void {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<scroll-view\b[^>]*\bscroll-y\b/g)) {
    if (!/class="[^"]*\bbody\b/.test(match[0])) report(file, source, match.index, '纵向 scroll-view 必须使用 .body');
  }
  for (const match of source.matchAll(/<image\b[^>]*>/g)) {
    if (!/\bbinderror=/.test(match[0])) report(file, source, match.index, '远程图片必须绑定失败降级');
  }
}

for (const file of filesUnder(root)) {
  if (file.endsWith('.wxss')) checkWxss(file);
  if (file.endsWith('.wxml')) checkWxml(file);
}

if (issues.length > 0) {
  for (const issue of issues) console.error(`${issue.file}:${issue.line} ${issue.message}`);
  process.exitCode = 1;
} else {
  console.info('小程序 Skyline/WXML 静态检查通过');
}
