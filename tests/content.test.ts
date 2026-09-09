import { describe, expect, it } from 'vitest';
import { OPTION_COUNT } from '../miniprogram/core/quiz.js';
import { assetManifest, validateContent } from '../tools/content.js';
import { WORDS } from '../miniprogram/data/words.js';

describe('内置内容契约', () => {
  it('稳定 ID、例句 blank、等级和资源 key 全部合法', () => {
    expect(validateContent()).toEqual([]);
  });

  it('资源清单确定、无重复，并覆盖每个词的三类资源', () => {
    const manifest = assetManifest();
    expect(manifest.assets).toEqual([...manifest.assets].sort());
    expect(new Set(manifest.assets).size).toBe(manifest.assets.length);
    expect(manifest.assets).toHaveLength(WORDS.length * 3);
  });

  it('每个已有内容等级都足够组成四选一', () => {
    for (const level of new Set(WORDS.map((word) => word.level))) {
      expect(WORDS.filter((word) => word.level === level).length).toBeGreaterThanOrEqual(OPTION_COUNT);
    }
  });
});
