/**
 * 终端试玩的词库入口 —— 直接复用小程序内置词库，避免两份数据漂移。
 * 保留这个文件是为了 tools/ 的 import 路径稳定。
 */
export { WORDS as SEED_WORDS, WORD_BY_ID, wordsUpToLevel } from '../miniprogram/data/words.js';
