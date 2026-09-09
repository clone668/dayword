/**
 * 把 core 出的题渲染成 WXML 能直接绑的数据。
 *
 * 和 `tools/quiz.ts` 是同一个角色的两个实现 —— 一个画到终端，一个画到页面。
 * 出题与判分都在 `core/quiz.ts`（有单测），这一层只决定"长什么样"，
 * 所以换 UI 不会动到难度，而难度是等级控制器的输入信号（见 core/level.ts）。
 *
 * 放在 data/ 而不是某个页面下：学习页和定级页都要用它。
 * 它依赖 `data/cdn`（要算图片 URL），所以本来就在 data 这一层，进不了 core。
 *
 * CDN 未接入时的两处降级：配图 → 中文文字卡，发音 → 显示音标。
 * 这不是临时补丁：真机上下载失败也会走同一条路径，界面必须永远有东西可显示。
 */
import type { Question } from '../core/quiz.js';
import type { QuestionKind, Word } from '../core/types.js';
import { imageUrl } from './cdn.js';

export interface OptionView {
  /** 选项文字。图片选项时它是配图缺失的替身 */
  text: string;
  /** 图片 URL；不是看图题或没有 CDN 时为 ''，WXML 用它做分支 */
  image: string;
}

export interface QuizView {
  kind: QuestionKind;
  /** 一行指令，如"听一听，选出对应的图片" */
  hint: string;
  /** 题干主体（单词 / 中文 / 挖空句）；纯听音题为 '' */
  title: string;
  subtitle: string;
  /** 题干配图 URL，'' 表示没有 */
  stemImage: string;
  /** 配图缺失时的文字替身 */
  stemText: string;
  /** 本题有该播的音频 */
  audio: boolean;
  phonetic: string;
  mode: 'choice' | 'letters' | 'input';
  options: OptionView[];
  letters: string[];
}

const zhOf = (w: Word) => w.meaningZh.join('；');
const imgOf = (w: Word) => imageUrl(w.imageKey) ?? '';
const asText = (ws: Word[]): OptionView[] => ws.map((w) => ({ text: w.text, image: '' }));
const asZh = (ws: Word[]): OptionView[] => ws.map((w) => ({ text: zhOf(w), image: '' }));
const asImage = (ws: Word[]): OptionView[] => ws.map((w) => ({ text: zhOf(w), image: imgOf(w) }));

export function viewOf(q: Question, wordOf: (id: string) => Word): QuizView {
  const word = wordOf(q.wordId);
  const opts = q.optionIds.map(wordOf);
  const ex = word.examples[0];
  const base = {
    kind: q.kind,
    title: '',
    subtitle: '',
    stemImage: '',
    stemText: '',
    audio: false,
    phonetic: word.phonetic,
    letters: q.letters,
  };

  switch (q.kind) {
    case 'audio2image':
      return { ...base, hint: '听一听，选出对应的图片', audio: true, mode: 'choice', options: asImage(opts) };
    case 'image2word':
      return {
        ...base,
        hint: '看图，选出对应的单词',
        stemImage: imgOf(word),
        stemText: zhOf(word),
        mode: 'choice',
        options: asText(opts),
      };
    case 'en2zh':
      return {
        ...base,
        hint: '它是什么意思？',
        title: word.text,
        subtitle: `${word.phonetic} ${word.pos}`,
        audio: true,
        mode: 'choice',
        options: asZh(opts),
      };
    case 'zh2en':
      return {
        ...base,
        hint: '用英语怎么说？',
        title: zhOf(word),
        subtitle: word.pos,
        mode: 'choice',
        options: asText(opts),
      };
    case 'clozeSentence':
      return {
        ...base,
        hint: '把句子补完整',
        title: q.cloze ?? ex?.en ?? word.text,
        subtitle: ex?.zh ?? '',
        mode: 'choice',
        options: asText(opts),
      };
    case 'dragSpell':
      return {
        ...base,
        hint: '按顺序点出字母',
        title: zhOf(word),
        subtitle: `${word.phonetic} ${word.pos}`,
        mode: 'letters',
        options: [],
      };
    case 'typeSpell':
      return {
        ...base,
        hint: '把这个词拼出来',
        title: zhOf(word),
        subtitle: `${word.phonetic} ${word.pos}`,
        mode: 'input',
        options: [],
      };
    case 'dictation':
      return { ...base, hint: '听一听，把这个词拼出来', audio: true, mode: 'input', options: [] };
  }
}
