/**
 * 领域类型定义。
 *
 * 这一层刻意不引用任何 `wx.*` API —— core/ 全部是纯函数，
 * 可以在 Node 里跑单测（见 tests/），不需要小程序模拟器。
 */

/** 词库等级。L1 学前 → L6 剑桥 Flyers / CEFR A2。 */
export type Level = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Leitner 盒子层级 —— 爬楼梯 UI 的五层楼。
 * 1–4 是"学习中"的四层，5 = 顶层已掌握（间隔从 60 天起逐次翻倍）。
 * 用单一字段而不是 `box + graduated` 两个字段，避免出现两个进度真相源。
 *
 * 层数刻意不多：每多一层，每个词就多要一次复习，
 * 稳态复习量 = 每日新词 × 爬升层数（Little's law），层数直接决定孩子每天的负担。
 */
export type Box = 1 | 2 | 3 | 4 | 5;

/** 题型。低龄段只出选择型，避免打字。 */
export type QuestionKind =
  | 'audio2image' // 听音选图    L1+  识别
  | 'image2word' //  看图选词    L1+  识别
  | 'en2zh' //       英译中选择  L2+  翻译
  | 'zh2en' //       中译英选择  L2+  翻译
  | 'dragSpell' //   字母拖拽拼写 L3+ 产出
  | 'clozeSentence' // 例句填空  L4+  翻译
  | 'typeSpell' //   键盘拼写    L5+  产出
  | 'dictation'; //  听写        L5+  产出

/** 题型的认知层级。盒子越高，用越靠后的层级出题（desirable difficulty）。 */
export type KindTier = 'recognize' | 'translate' | 'produce';

/** 静态词条内容。只读，随小程序版本更新，不参与用户数据同步。 */
export interface Word {
  /** 稳定 ID。不要用单词字符串当主键：同形词和拼写修订会让历史进度对不上。 */
  id: string;
  text: string;
  /** 音标，如 "/ˈæpl/" */
  phonetic: string;
  meaningZh: string[];
  level: Level;
  /** 词性，如 "n." */
  pos: string;
  /** 主题标签，如 ["food","fruit"]。用于"让孩子选明天学什么主题"。 */
  tags: string[];
  /** CDN 相对路径。音频与图片一律不打包进小程序包（主包上限 2MB）。 */
  audioKey: string;
  imageKey: string;
  examples: WordExample[];
}

export interface WordExample {
  en: string;
  zh: string;
  audioKey: string;
  /** 挖空的词在 en 中的起止下标，用于 clozeSentence 题型 */
  blank?: [number, number];
}

/**
 * 单个词的学习状态。每个孩子一份，是唯一需要持久化 / 云同步的用户数据。
 * 字段刻意保持精简：4000 词 × ~120B ≈ 480KB，接近 wx.setStorage 单 key 1MB 上限，
 * 因此 data/ 层要按等级分 key 存储（见 data/local）。
 */
export interface WordState {
  wordId: string;
  box: Box;
  /** 下次到期时间，始终对齐到本地时区某天 00:00 */
  dueAt: number;
  /** 累计答错次数。用于识别"顽固词"并在队列中优先安排。 */
  lapses: number;
  /** 当前连续答对次数 */
  streak: number;
  /** 累计作答次数 */
  reps: number;
  firstSeenAt: number;
  /** 最后修改时间。云同步冲突用 per-word last-write-wins 比对此字段。 */
  updatedAt: number;
}

/** 一次作答的原始结果。 */
export interface Answer {
  wordId: string;
  correct: boolean;
  /** 反应时间（毫秒），从题目完全呈现（含音频播完）到提交。用于识别瞎猜。 */
  rtMs: number;
  kind: QuestionKind;
  at: number;
}
