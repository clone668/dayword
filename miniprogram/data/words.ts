/**
 * 内置词库（42 词，L1–L4）。
 *
 * 词条**文本**打包进主包（42 词 ≈ 8KB，可忽略）；
 * **音频与配图一律走 CDN**，`audioKey` / `imageKey` 只存相对路径 ——
 * 主包上限 2MB，几千个 mp3 和 webp 装不进来。见 data/media.ts。
 *
 * 这是 MVP 词库。正式词库要按等级拆分包（`subpackages`）按需加载。
 */
import type { Level, Word, WordExample } from '../core/types.js';

/** [词, 音标, 中文, 词性, 等级, 标签(空格分隔), 例句, 例句中文] */
type Row = [string, string, string, string, Level, string, string, string];

const ROWS: Row[] = [
  // ---- L1 学前：看得见摸得着的东西 ----
  ['apple', '/ˈæpl/', '苹果', 'n.', 1, 'food fruit', 'I eat an apple every day.', '我每天吃一个苹果。'],
  ['banana', '/bəˈnɑːnə/', '香蕉', 'n.', 1, 'food fruit', 'The banana is yellow.', '香蕉是黄色的。'],
  ['dog', '/dɒɡ/', '狗', 'n.', 1, 'animal pet', 'My dog can run fast.', '我的狗跑得很快。'],
  ['cat', '/kæt/', '猫', 'n.', 1, 'animal pet', 'The cat is on the bed.', '猫在床上。'],
  ['red', '/red/', '红色的', 'adj.', 1, 'color', 'I have a red ball.', '我有一个红色的球。'],
  ['blue', '/bluː/', '蓝色的', 'adj.', 1, 'color', 'The sky is blue.', '天空是蓝色的。'],
  ['one', '/wʌn/', '一', 'num.', 1, 'number', 'I see one bird.', '我看见一只鸟。'],
  ['two', '/tuː/', '二', 'num.', 1, 'number', 'She has two hands.', '她有两只手。'],
  ['mom', '/mɒm/', '妈妈', 'n.', 1, 'family', 'My mom is happy.', '我妈妈很开心。'],
  ['dad', '/dæd/', '爸爸', 'n.', 1, 'family', 'Dad is at home.', '爸爸在家。'],
  ['water', '/ˈwɔːtə/', '水', 'n.', 1, 'food drink', 'I drink water.', '我喝水。'],
  ['milk', '/mɪlk/', '牛奶', 'n.', 1, 'food drink', 'The milk is cold.', '牛奶是凉的。'],

  // ---- L2 幼小衔接：日常事物 + 基础动作 ----
  ['bread', '/bred/', '面包', 'n.', 2, 'food', 'I want some bread.', '我想要一些面包。'],
  ['egg', '/eɡ/', '鸡蛋', 'n.', 2, 'food', 'The egg is in the box.', '鸡蛋在盒子里。'],
  ['bird', '/bɜːd/', '鸟', 'n.', 2, 'animal', 'A bird can fly.', '鸟会飞。'],
  ['fish', '/fɪʃ/', '鱼', 'n.', 2, 'animal', 'The fish swims in the water.', '鱼在水里游。'],
  ['green', '/ɡriːn/', '绿色的', 'adj.', 2, 'color', 'The leaf is green.', '叶子是绿色的。'],
  ['three', '/θriː/', '三', 'num.', 2, 'number', 'I have three pens.', '我有三支笔。'],
  ['book', '/bʊk/', '书', 'n.', 2, 'school', 'This book is new.', '这本书是新的。'],
  ['pen', '/pen/', '钢笔', 'n.', 2, 'school', 'Give me your pen.', '把你的钢笔给我。'],
  ['hand', '/hænd/', '手', 'n.', 2, 'body', 'Wash your hand.', '洗手。'],
  ['foot', '/fʊt/', '脚', 'n.', 2, 'body', 'My foot hurts.', '我的脚疼。'],
  ['run', '/rʌn/', '跑', 'v.', 2, 'action', 'Let us run together.', '我们一起跑吧。'],
  ['jump', '/dʒʌmp/', '跳', 'v.', 2, 'action', 'Can you jump high?', '你能跳高吗？'],

  // ---- L3 一二年级：多音节词 + 职业场所 ----
  ['elephant', '/ˈelɪfənt/', '大象', 'n.', 3, 'animal', 'The elephant is very big.', '大象非常大。'],
  ['monkey', '/ˈmʌŋki/', '猴子', 'n.', 3, 'animal', 'The monkey likes bananas.', '猴子喜欢香蕉。'],
  ['yellow', '/ˈjeləʊ/', '黄色的', 'adj.', 3, 'color', 'She wears a yellow hat.', '她戴着一顶黄帽子。'],
  ['purple', '/ˈpɜːpl/', '紫色的', 'adj.', 3, 'color', 'I like the purple flower.', '我喜欢那朵紫色的花。'],
  ['teacher', '/ˈtiːtʃə/', '老师', 'n.', 3, 'job school', 'Our teacher is kind.', '我们的老师很和善。'],
  ['doctor', '/ˈdɒktə/', '医生', 'n.', 3, 'job', 'The doctor helps sick people.', '医生帮助生病的人。'],
  ['kitchen', '/ˈkɪtʃɪn/', '厨房', 'n.', 3, 'place home', 'Mom is in the kitchen.', '妈妈在厨房里。'],
  ['garden', '/ˈɡɑːdn/', '花园', 'n.', 3, 'place home', 'We play in the garden.', '我们在花园里玩。'],
  ['swim', '/swɪm/', '游泳', 'v.', 3, 'action sport', 'I can swim in the sea.', '我能在海里游泳。'],
  ['climb', '/klaɪm/', '爬，攀登', 'v.', 3, 'action sport', 'They climb the tree.', '他们爬上树。'],

  // ---- L4 三四年级：抽象词 + 长词 ----
  ['umbrella', '/ʌmˈbrelə/', '雨伞', 'n.', 4, 'object weather', 'Take an umbrella with you.', '带把雨伞。'],
  ['mountain', '/ˈmaʊntɪn/', '山', 'n.', 4, 'place nature', 'The mountain is far away.', '那座山很远。'],
  ['hospital', '/ˈhɒspɪtl/', '医院', 'n.', 4, 'place job', 'She works in a hospital.', '她在医院工作。'],
  ['library', '/ˈlaɪbrəri/', '图书馆', 'n.', 4, 'place school', 'Be quiet in the library.', '在图书馆要安静。'],
  ['delicious', '/dɪˈlɪʃəs/', '美味的', 'adj.', 4, 'food feeling', 'This soup is delicious.', '这汤很美味。'],
  ['careful', '/ˈkeəfl/', '小心的', 'adj.', 4, 'feeling', 'Be careful on the road.', '在路上要小心。'],
  ['borrow', '/ˈbɒrəʊ/', '借（进）', 'v.', 4, 'action school', 'May I borrow your book?', '我可以借你的书吗？'],
  ['invite', '/ɪnˈvaɪt/', '邀请', 'v.', 4, 'action', 'I invite you to my party.', '我邀请你来我的派对。'],
];

/** 从例句里算出挖空位置，手写下标太容易错 —— clozeSentence 题型要用。 */
function example(en: string, zh: string, target: string): WordExample {
  const i = en.toLowerCase().indexOf(target.toLowerCase());
  return {
    en,
    zh,
    audioKey: `audio/ex/${target}.mp3`,
    ...(i >= 0 ? { blank: [i, i + target.length] as [number, number] } : {}),
  };
}

/**
 * 词条 id 用 `w-<text>`。
 * 真实词库应改用与拼写无关的稳定 id（见 core/types.ts 的 Word.id 注释）：
 * 同形词和拼写修订会让老用户的历史进度对不上。
 */
export const WORDS: Word[] = ROWS.map(([text, phonetic, zh, pos, level, tags, en, enZh]) => ({
  id: `w-${text}`,
  text,
  phonetic,
  meaningZh: [zh],
  level,
  pos,
  tags: tags.split(' '),
  audioKey: `audio/word/${text}.mp3`,
  imageKey: `image/word/${text}.webp`,
  examples: [example(en, enZh, text)],
}));

export const WORD_BY_ID = new Map(WORDS.map((w) => [w.id, w]));

/** 某等级孩子可见的全部词（含更低等级 —— 低等级词要继续复习）。 */
export function wordsUpToLevel(level: Level): Word[] {
  return WORDS.filter((w) => w.level <= level);
}
