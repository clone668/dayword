/**
 * 把 core 出的题渲染成终端能看的文字。
 *
 * 出题与判分都在 `core/quiz.ts`（有单测），这里只负责画 —— 和小程序页面
 * 是同一个关系。终端里的两处降级：
 * - 配图用中文释义顶替（`🖼 苹果`）
 * - 发音用音标顶替（`🔊 /ˈæpl/`）
 *
 * 所以听音题在终端里实际是"看音标选图"，比真机简单。别拿这里的正确率当基线。
 */
import type { Question } from '../miniprogram/core/quiz.js';
import type { Word } from '../miniprogram/core/types.js';

export { checkAnswer } from '../miniprogram/core/quiz.js';

export interface Rendered {
  prompt: string[];
  /** 选择题的选项文本；产出题为空 */
  options: string[];
  hint: string;
}

const zhOf = (w: Word) => w.meaningZh.join('；');

export function renderQuestion(q: Question, wordOf: (id: string) => Word): Rendered {
  const word = wordOf(q.wordId);
  const opts = q.optionIds.map(wordOf);

  switch (q.kind) {
    case 'audio2image':
      return {
        prompt: [`🔊 听发音，选对应的图： ${word.phonetic}`],
        options: opts.map((w) => `🖼 ${zhOf(w)}`),
        hint: `输入 1-${opts.length}`,
      };
    case 'image2word':
      return {
        prompt: [`🖼 看图选词： 【图：${zhOf(word)}】`],
        options: opts.map((w) => w.text),
        hint: `输入 1-${opts.length}`,
      };
    case 'en2zh':
      return {
        prompt: [`${word.text}  ${word.phonetic} (${word.pos})`, '   它是什么意思？'],
        options: opts.map(zhOf),
        hint: `输入 1-${opts.length}`,
      };
    case 'zh2en':
      return {
        prompt: [`${zhOf(word)} (${word.pos})`, '   用英语怎么说？'],
        options: opts.map((w) => w.text),
        hint: `输入 1-${opts.length}`,
      };
    case 'clozeSentence':
      return {
        prompt: ['📖 例句填空：', `   ${q.cloze ?? word.examples[0]?.en ?? word.text}`, `   (${word.examples[0]?.zh ?? ''})`],
        options: opts.map((w) => w.text),
        hint: `输入 1-${opts.length}`,
      };
    case 'dragSpell':
      return {
        prompt: [`🔤 字母打乱了： ${q.letters.join(' ')}`, `   意思：${zhOf(word)}`],
        options: [],
        hint: '拼出这个单词',
      };
    case 'typeSpell':
      return {
        prompt: [`✍ 把这个词写出来：${zhOf(word)} (${word.pos})`, `   ${word.phonetic}`],
        options: [],
        hint: '拼出这个单词',
      };
    case 'dictation':
      return {
        prompt: [`🔊 听写 ${word.phonetic}`],
        options: [],
        hint: '拼出这个单词',
      };
  }
}
