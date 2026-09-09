import { OPTION_COUNT } from '../miniprogram/core/quiz.js';
import type { Level } from '../miniprogram/core/types.js';
import { WORDS } from '../miniprogram/data/words.js';

export interface ContentIssue {
  wordId?: string;
  message: string;
}

const KEY = /^[a-z0-9][a-z0-9/_-]*\.(mp3|webp)$/;
const ID = /^dw\d{4,}$/;
const LEVELS: readonly Level[] = [1, 2, 3, 4, 5, 6];

export function validateContent(): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const ids = new Set<string>();
  const texts = new Set<string>();
  const assets = new Set<string>();

  for (const word of WORDS) {
    const add = (message: string) => issues.push({ wordId: word.id, message });
    if (!ID.test(word.id)) add('稳定 ID 格式无效');
    if (ids.has(word.id)) add('稳定 ID 重复');
    ids.add(word.id);
    const text = word.text.toLowerCase();
    if (texts.has(text)) add('单词文本重复');
    texts.add(text);
    if (!LEVELS.includes(word.level)) add('等级超出 L1–L6');

    for (const key of [word.audioKey, word.imageKey, ...word.examples.map((example) => example.audioKey)]) {
      if (!KEY.test(key)) add(`资源 key 无效：${key}`);
      if (assets.has(key)) add(`资源 key 重复：${key}`);
      assets.add(key);
    }
    if (word.examples.length === 0) add('缺少例句');
    for (const example of word.examples) {
      if (example.blank === undefined) {
        add('例句没有目标词 blank');
        continue;
      }
      const actual = example.en.slice(example.blank[0], example.blank[1]).toLowerCase();
      if (actual !== text) add(`例句 blank 指向 “${actual}” 而不是目标词`);
    }
  }

  for (const level of LEVELS) {
    const atLevel = WORDS.filter((word) => word.level === level);
    if (atLevel.length > 0 && atLevel.length < OPTION_COUNT) {
      issues.push({ message: `L${level} 只有 ${atLevel.length} 词，不足 ${OPTION_COUNT} 词选择题` });
    }
  }
  if (WORDS.length < OPTION_COUNT) issues.push({ message: `总词池不足 ${OPTION_COUNT} 个唯一选项` });
  return issues;
}

export interface AssetManifest {
  version: 1;
  generatedFrom: 'miniprogram/data/words.ts';
  assets: string[];
}

export function assetManifest(): AssetManifest {
  return {
    version: 1,
    generatedFrom: 'miniprogram/data/words.ts',
    assets: [...new Set(WORDS.flatMap((word) => [
      word.audioKey,
      word.imageKey,
      ...word.examples.map((example) => example.audioKey),
    ]))].sort(),
  };
}
