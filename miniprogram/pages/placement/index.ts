/**
 * 定级页 —— 入口定级测试，只负责给出一个**起点**等级。
 *
 * 三个刻意的取舍，都和"这是测试而不是课"有关：
 *
 * 1. **不写任何词状态。** 定级答对 apple 不等于学过 apple ——
 *    写进 SRS 就等于凭一道选择题把它塞进第 2 层，孩子再也见不到那张教学卡。
 *    这里只动 profile（等级 + placed），word states 一个字节都不碰。
 *
 * 2. **不给逐题对错反馈。** 学习页要立刻纠错（那是教学），
 *    定级页不能 —— 被定到 L1 的孩子会在 9 题里看 7 次红色，
 *    而这恰好是他第一次打开这个 app 的时刻。只给一个"已选中"的中性反馈。
 *
 * 3. **有「不认识」按钮。** 通过线是 2/3，纯瞎猜（四选一）也有 15.6% 概率
 *    蒙过一轮，那会把孩子定高一级。给一个明确的"不会"出口比劝他别猜有用。
 *
 * 结果也不给孩子看分数 —— 只说"起点定在 L3"，把答对情况放在家长看的那几行里。
 */
import { configFor, LEVEL_THEME, THEME_NAME } from '../../core/config.js';
import { initLevel } from '../../core/level.js';
import {
  probesLeft,
  PROBE_SIZE,
  startPlacement,
  submitProbe,
  type PlacementState,
} from '../../core/placement.js';
import { checkAnswer, type Question } from '../../core/quiz.js';
import type { Level } from '../../core/types.js';
import { playAudio, stopAudio } from '../../data/audio.js';
import { hasMedia } from '../../data/cdn.js';
import { buildProbe, MAX_PROBE_LEVEL, PROBE_CAPPED, PROBE_TOTAL } from '../../data/probe.js';
import { viewOf, type QuizView } from '../../data/quizview.js';
import { repo } from '../../data/store.js';
import { onSystemChange, pageClass } from '../../data/theme.js';
import { WORD_BY_ID } from '../../data/words.js';

/** 点下选项后停留多久再翻到下一题。只是让"点到了"看得见，不是给判分留时间 */
const TAP_PAUSE_MS = 160;

/** 「不认识」提交的下标。选择题的 answerIndex 恒 >= 0，所以 -1 永远判错 */
const DUNNO = -1;

interface KV {
  k: string;
  v: string;
}

interface Result {
  level: Level;
  theme: string;
  newPerDay: number;
  reviewCap: number;
  minutes: number;
  rows: KV[];
}

interface Data {
  statusBar: number;
  themeCls: string;
  phase: 'intro' | 'quiz' | 'done';
  hasMedia: boolean;
  /** 词库测得到的最高等级 —— 小于 6 时要如实说明 */
  maxLevel: number;
  capped: boolean;
  estTotal: number;
  /** 屏幕上这道题是第几题（1 起）。不能直接用已答题数 +1 —— 答完到翻页之间
      有 160ms 停留，那段时间计数已经加了，题目还没换 */
  qNo: number;
  pctDone: number;
  quiz: QuizView | null;
  /** 选项的"已选中"样式类，下标与 quiz.options 对齐 */
  optCls: string[];
  result: Result | null;
  saving: boolean;
  errorText: string;
}

const initial: Data = {
  statusBar: 20,
  themeCls: pageClass(),
  phase: 'intro',
  hasMedia,
  maxLevel: MAX_PROBE_LEVEL,
  capped: PROBE_CAPPED,
  estTotal: PROBE_TOTAL,
  qNo: 1,
  pctDone: 0,
  quiz: null,
  optCls: [],
  result: null,
  saving: false,
  errorText: '',
};

const wordOf = (id: string) => WORD_BY_ID.get(id)!;

Page({
  data: { ...initial },

  /* ---- 不进 data 的测试状态 ---- */
  state: null as PlacementState | null,
  /** 当前这一轮的题（PROBE_SIZE 道） */
  queue: [] as Question[],
  idx: 0,
  /** 本轮答对数 */
  hits: 0,
  /** 整场已答题数。只喂进度条，不直接渲染，所以不进 data */
  asked: 0,
  timer: 0,
  offTheme: null as (() => void) | null,

  onLoad() {
    this.setData({ statusBar: wx.getWindowInfo().statusBarHeight });
    this.offTheme = onSystemChange(() => {
      this.setData({ themeCls: pageClass() });
    });
  },

  onShow() {
    this.setData({ themeCls: pageClass() });
  },

  onUnload() {
    this.offTheme?.();
    this.offTheme = null;
    stopAudio();
    if (this.timer !== 0) clearTimeout(this.timer);
  },

  begin() {
    this.state = startPlacement(MAX_PROBE_LEVEL);
    this.asked = 0;
    this.setData({ qNo: 1, pctDone: 0 });
    this.nextRound();
  },

  nextRound() {
    const s = this.state!;
    if (s.finished || s.probe === null) {
      void this.finish();
      return;
    }
    this.queue = buildProbe(s.probe, Math.random);
    this.idx = 0;
    this.hits = 0;

    // 该等级凑不出题（未来词库缺档时才会发生）——按"没通过"处理，
    // 继续往下二分，而不是卡在一个空白页面上
    if (this.queue.length === 0) {
      this.state = submitProbe(s, 0, 0);
      this.nextRound();
      return;
    }
    this.show();
  },

  show() {
    const view = viewOf(this.queue[this.idx]!, wordOf);
    this.setData({
      phase: 'quiz',
      quiz: view,
      optCls: view.options.map(() => ''),
      qNo: this.asked + 1,
      ...this.progressData(),
    });
  },

  /**
   * 进度条只升不降。估算总题数（(已答轮数 + 剩余轮数) × 每轮题数）会随二分收敛变小，
   * 分母一变，百分比就可能往回跳 —— 看着像出了 bug。
   */
  progressData() {
    const s = this.state!;
    const est = Math.max(PROBE_SIZE, (s.history.length + probesLeft(s)) * PROBE_SIZE);
    const pct = Math.min(100, Math.round((this.asked / est) * 100));
    return { estTotal: est, pctDone: Math.max(this.data.pctDone, pct) };
  },

  async playWord() {
    const w = WORD_BY_ID.get(this.queue[this.idx]?.wordId ?? '');
    if (w === undefined) return;
    if (!hasMedia) {
      wx.showToast({ title: '发音还没接入（CDN 未配置）', icon: 'none' });
      return;
    }
    if (!(await playAudio(w.audioKey))) {
      wx.showToast({ title: `发音加载失败，先按音标读 ${w.phonetic}`, icon: 'none' });
    }
  },

  pick(e: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) return;
    const i = Number(e.currentTarget.dataset.i);
    this.answer(i, this.data.optCls.map((_, j) => (j === i ? 'opt-picked' : '')));
  },

  dunno() {
    if (this.data.saving) return;
    this.answer(DUNNO, this.data.optCls);
  },

  /** 判分只累加本轮命中数，不落任何持久状态 */
  answer(input: number, optCls: string[]) {
    if (this.timer !== 0) return; // 上一次点击的停留还没走完，忽略连点
    if (checkAnswer(this.queue[this.idx]!, input)) this.hits++;
    this.asked++;

    this.setData({ optCls, ...this.progressData() });

    this.timer = setTimeout(() => {
      this.timer = 0;
      this.idx++;
      if (this.idx < this.queue.length) {
        this.show();
        return;
      }
      this.state = submitProbe(this.state!, this.hits, this.queue.length);
      this.nextRound();
    }, TAP_PAUSE_MS);
  },

  async finish() {
    if (this.data.saving) return;
    const s = this.state!;
    const level = s.result ?? 1;
    const cfg = configFor(level);

    this.setData({ saving: true, errorText: '' });
    try {
      // 只覆盖 profile 的等级和 placed。streak 保留（重测不该清掉连续打卡），
      // word states / logs 一个字都不写 —— 见文件头第 1 条
      const profile = await repo.loadProfile();
      await repo.saveProfile({ ...profile, level: initLevel(level), placed: true });
    } catch (error) {
      console.error('[dayword] 定级结果保存失败', error);
      this.setData({ saving: false, errorText: '定级结果还没保存，请重试。' });
      return;
    }

    this.setData({
      phase: 'done',
      saving: false,
      errorText: '',
      result: {
        level,
        theme: THEME_NAME[LEVEL_THEME[level]],
        newPerDay: cfg.newPerDay,
        reviewCap: cfg.reviewCap,
        minutes: Math.round(cfg.sessionSeconds / 60),
        rows: [
          ...s.history.map((h) => ({ k: `L${h.level} 测试`, v: `答对 ${h.correct}/${h.total}` })),
          { k: '每天新词上限', v: `${cfg.newPerDay} 个` },
          { k: '每天复习上限', v: `${cfg.reviewCap} 个` },
          { k: '每次大约', v: `${Math.round(cfg.sessionSeconds / 60)} 分钟` },
        ],
      },
    });
  },

  retryFinish() {
    void this.finish();
  },

  imageError(e: WechatMiniprogram.CustomEvent) {
    const kind = String(e.currentTarget.dataset.kind ?? '');
    const index = Number(e.currentTarget.dataset.i);
    if (this.data.quiz === null) return;
    if (kind === 'stem') {
      this.setData({ quiz: { ...this.data.quiz, stemImage: '' } });
      return;
    }
    if (kind === 'option' && this.data.quiz.options[index] !== undefined) {
      const options = this.data.quiz.options.map((option, i) => (i === index ? { ...option, image: '' } : option));
      this.setData({ quiz: { ...this.data.quiz, options } });
    }
  },

  /** 结果页出去用 reLaunch：首页要拿新等级重算今日任务，回退栈里的旧实例不该留着 */
  go() {
    void wx.reLaunch({ url: '/pages/home/index' });
  },

  /** 中途退出。placed 仍为 false，下次进首页还会看到定级入口 */
  quit() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/home/index' }),
    });
  },
});
