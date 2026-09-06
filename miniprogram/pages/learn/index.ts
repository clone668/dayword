/**
 * 学习页 —— 一整节课就在这一个页面里跑完。
 *
 * 它是 `tools/play.ts` 里 `runDay()` 的页面版：同一套 core 调用、同一个顺序。
 * 两者唯一的区别是"谁来答题"，所以终端里试出来的手感，在这里应当一模一样。
 *
 * 关键约定：
 * - 时间只从 `data/clock.now()` 取一次，整节课用同一个"现在"。跨零点也不会
 *   出现"前半节课记在昨天、后半节课记在今天"。
 * - `SessionState` / `Map` 这类不可序列化的东西挂在实例上，不进 `data`。
 *   `data` 里的每个字段都要过一遍渲染层桥接，塞进去只会白白拖慢 setData。
 */
import { evaluateDaily, recordAnswers, type FirstTry } from '../../core/level.js';
import { pickKind } from '../../core/questions.js';
import { buildQuestion, checkAnswer, type Question } from '../../core/quiz.js';
import {
  current,
  isFinished,
  progress,
  startSession,
  submit,
  type SessionState,
} from '../../core/session.js';
import { isGuess, MASTERED_BOX, newWordState, review } from '../../core/srs.js';
import { upsertLog } from '../../core/stats.js';
import { checkIn, type CheckInOutcome } from '../../core/streak.js';
import { addDays, startOfDay } from '../../core/time.js';
import type { Answer, Word, WordState } from '../../core/types.js';
import { now } from '../../data/clock.js';
import { hasMedia, imageUrl, playAudio } from '../../data/media.js';
import { planToday } from '../../data/plan.js';
import { loadSnapshot, saveSnapshot, type Snapshot } from '../../data/store.js';
import { onSystemChange, pageClass } from '../../data/theme.js';
import { WORD_BY_ID, wordsUpToLevel } from '../../data/words.js';
import { viewOf, type QuizView } from './view.js';

/** 答对后自动进入下一题的停留时间（毫秒）。答错不自动跳 —— 见 next() */
const RIGHT_PAUSE_MS = 700;

const OUTCOME_TEXT: Record<CheckInOutcome, string> = {
  first: '第一次打卡',
  continued: '连续记录 +1',
  saved: '🛡 护盾顶住了断签',
  broken: '连续记录重新开始',
  'same-day': '今天已经打过卡了',
};

interface TeachCard {
  text: string;
  phonetic: string;
  pos: string;
  zh: string;
  exEn: string;
  exZh: string;
  image: string;
}

interface Chip {
  key: string;
  ch: string;
  used: boolean;
}

interface Summary {
  title: string;
  rows: { k: string; v: string }[];
  levelUp: boolean;
  level: number;
}

interface Data {
  statusBar: number;
  /** 根节点的配色 class：'' 或 'dark'（见 data/theme.ts） */
  themeCls: string;
  phase: 'loading' | 'teach' | 'quiz' | 'done';
  hasMedia: boolean;
  done: number;
  total: number;
  pctDone: number;
  teach: TeachCard | null;
  quiz: QuizView | null;
  /** 每个选项的反馈样式类，下标与 quiz.options 对齐 */
  optCls: string[];
  spelled: { key: string; ch: string }[];
  pool: Chip[];
  typed: string;
  feedback: 'none' | 'right' | 'wrong' | 'guess';
  fbText: string;
  summary: Summary | null;
}

const initial: Data = {
  statusBar: 20,
  themeCls: pageClass(),
  phase: 'loading',
  hasMedia,
  done: 0,
  total: 0,
  pctDone: 0,
  teach: null,
  quiz: null,
  optCls: [],
  spelled: [],
  pool: [],
  typed: '',
  feedback: 'none',
  fbText: '',
  summary: null,
};

const wordOf = (id: string) => WORD_BY_ID.get(id)!;

Page({
  // 浅拷贝：initial 是模块级常量，而 onType 会直接改 this.data.typed，
  // 不拷贝的话第二次进页面会带着上次的残留
  data: { ...initial },

  /* ---- 不进 data 的会话状态 ---- */
  snap: null as Snapshot | null,
  /** 整节课固定的"现在"，只在 begin() 里取一次 */
  at: 0,
  session: null as SessionState | null,
  /** wordId → 最新学习状态，边答边改，结算时一次性写盘 */
  states: new Map<string, WordState>(),
  /** 干扰项词池 = 当前等级可见的全部词 */
  wordPool: [] as Word[],
  question: null as Question | null,
  currentWord: null as Word | null,
  currentState: null as WordState | null,
  currentIsNew: false,
  /** 每个词的首答结果，等级控制器和记忆保持率都用它 */
  firstTry: [] as FirstTry[],
  seen: [] as string[],
  asked: 0,
  guesses: 0,
  newCount: 0,
  reviewCount: 0,
  shownAt: 0,
  startedAt: 0,
  timer: 0,
  offTheme: null as (() => void) | null,

  onLoad() {
    this.setData({ statusBar: wx.getWindowInfo().statusBarHeight });
    this.offTheme = onSystemChange(() => {
      this.setData({ themeCls: pageClass() });
    });
    void this.begin();
  },

  onShow() {
    this.setData({ themeCls: pageClass() });
  },

  onUnload() {
    this.offTheme?.();
    this.offTheme = null;
    if (this.timer !== 0) clearTimeout(this.timer);
  },

  async begin() {
    const snap = await loadSnapshot();
    const at = now();
    const plan = planToday(snap, at);

    this.snap = snap;
    this.at = at;
    this.states = new Map(snap.states.map((s) => [s.wordId, s]));
    this.wordPool = wordsUpToLevel(snap.profile.level.level);
    this.session = startSession(plan.reviewIds, plan.newIds);
    this.newCount = plan.newIds.length;
    this.reviewCount = plan.reviewIds.length;
    this.startedAt = Date.now();

    this.step();
  },

  /** 走到队首那个词：新词先教，旧词直接考 */
  step() {
    const item = current(this.session!);
    if (item === null) {
      void this.settle();
      return;
    }
    this.currentIsNew = item.isNew;
    if (item.isNew) this.showTeach(item.wordId);
    else this.ask(item.wordId);
  },

  showTeach(wordId: string) {
    const w = wordOf(wordId);
    this.currentWord = w;
    const ex = w.examples[0];
    this.setData({
      phase: 'teach',
      quiz: null,
      teach: {
        text: w.text,
        phonetic: w.phonetic,
        pos: w.pos,
        zh: w.meaningZh.join('；'),
        exEn: ex?.en ?? '',
        exZh: ex?.zh ?? '',
        image: imageUrl(w.imageKey) ?? '',
      },
      ...this.progressData(),
    });
  },

  learned() {
    this.ask(current(this.session!)!.wordId);
  },

  ask(wordId: string) {
    const word = wordOf(wordId);
    const st = this.states.get(wordId) ?? newWordState(wordId, this.at);
    // 先定题型再出题：题型决定难度，这是等级唯一的作用通道（core/questions.ts）
    const kind = pickKind(this.snap!.profile.level.level, st.box, Math.random);
    const q = buildQuestion(word, kind, this.wordPool, Math.random);
    const view = viewOf(q, wordOf);

    this.question = q;
    this.currentWord = word;
    this.currentState = st;
    this.shownAt = Date.now();

    this.setData({
      phase: 'quiz',
      teach: null,
      quiz: view,
      optCls: view.options.map(() => ''),
      spelled: [],
      pool: q.letters.map((ch, i) => ({ key: `l${i}`, ch, used: false })),
      typed: '',
      feedback: 'none',
      fbText: '',
      ...this.progressData(),
    });
  },

  progressData() {
    const p = progress(this.session!);
    return {
      done: p.done,
      total: p.total,
      pctDone: p.total === 0 ? 0 : Math.round((p.done / p.total) * 100),
    };
  },

  playWord() {
    const w = this.currentWord;
    if (w === null) return;
    if (!playAudio(w.audioKey)) {
      wx.showToast({ title: '发音还没接入（CDN 未配置）', icon: 'none' });
    }
  },

  /* ---- 三种作答方式，最后都汇到 judge() ---- */

  pick(e: WechatMiniprogram.TouchEvent) {
    if (this.data.feedback !== 'none') return;
    this.judge(Number(e.currentTarget.dataset.i));
  },

  spell(e: WechatMiniprogram.TouchEvent) {
    if (this.data.feedback !== 'none') return;
    const i = Number(e.currentTarget.dataset.i);
    const chip = this.data.pool[i];
    if (chip === undefined || chip.used) return;
    const pool = this.data.pool.map((c, j) => (j === i ? { ...c, used: true } : c));
    this.setData({ pool, spelled: [...this.data.spelled, { key: chip.key, ch: chip.ch }] });
  },

  unspell(e: WechatMiniprogram.TouchEvent) {
    if (this.data.feedback !== 'none') return;
    const i = Number(e.currentTarget.dataset.i);
    const gone = this.data.spelled[i];
    if (gone === undefined) return;
    this.setData({
      spelled: this.data.spelled.filter((_, j) => j !== i),
      pool: this.data.pool.map((c) => (c.key === gone.key ? { ...c, used: false } : c)),
    });
  },

  onType(e: WechatMiniprogram.Input) {
    this.data.typed = e.detail.value; // 输入框自己持有文本，不必 setData 回灌
  },

  check() {
    if (this.data.feedback !== 'none') return;
    const q = this.question!;
    const input = q.kind === 'dragSpell' ? this.data.spelled.map((s) => s.ch).join('') : this.data.typed;
    this.judge(input);
  },

  /** 判分 + 落状态。选择题传下标，拼写题传字符串（core/quiz.checkAnswer 的口径） */
  judge(input: number | string) {
    const q = this.question!;
    const rtMs = Date.now() - this.shownAt;
    const correct = checkAnswer(q, input);
    const a: Answer = { wordId: q.wordId, correct, rtMs, kind: q.kind, at: this.at };
    const guessed = isGuess(a);

    // 首答只记一次。新词第一次见本来就该答错，isNew 让 core 把它排除在能力评估外
    if (!this.seen.includes(q.wordId)) {
      this.seen.push(q.wordId);
      this.firstTry.push({ correct, isNew: this.currentIsNew });
    }
    if (guessed) this.guesses++;
    this.asked++;
    this.states.set(q.wordId, review(this.currentState!, a, this.at));
    this.session = submit(this.session!, a);

    const optCls = q.isChoice
      ? this.data.quiz!.options.map((_, i) =>
          i === q.answerIndex ? 'opt-right' : typeof input === 'number' && i === input ? 'opt-wrong' : '',
        )
      : [];
    const feedback = correct ? (guessed ? 'guess' : 'right') : 'wrong';
    const fbText = correct
      ? guessed
        ? '这么快呀？算你答对，但楼层先不涨'
        : '对了！'
      : `正确答案是 ${q.answer}`;

    this.setData({ optCls, feedback, fbText, ...this.progressData() });
    if (feedback === 'right') this.timer = setTimeout(() => this.next(), RIGHT_PAUSE_MS);
  },

  /** 答对自动调用；答错和疑似瞎猜要孩子自己点"继续"—— 强迫他看一眼正确答案 */
  next() {
    if (this.timer !== 0) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
    if (isFinished(this.session!)) void this.settle();
    else this.step();
  },

  /**
   * 结算：评级 → 打卡 → 写日志 → 落盘。顺序不能换 ——
   * evaluateDaily 要吃这节课的首答结果，而 checkIn 必须在同一个"现在"下调用。
   */
  async settle() {
    const snap = this.snap!;
    const at = this.at;
    const level = snap.profile.level.level;

    // 空会话不打卡、不写日志：点进来看一眼不应该算完成一天
    if (this.asked === 0) {
      this.setData({
        phase: 'done',
        summary: { title: '今天没有到期的词 🎈', rows: [], levelUp: false, level },
      });
      return;
    }

    const reviewed = this.firstTry.filter((t) => !t.isNew);
    const evaluated = evaluateDaily(recordAnswers(snap.profile.level, this.firstTry), at);
    const check = checkIn(snap.profile.streak, at);
    const states = [...this.states.values()];
    const logs = upsertLog(snap.logs, {
      day: startOfDay(at),
      newCount: this.newCount,
      reviewCount: this.reviewCount,
      firstTryCorrect: reviewed.filter((t) => t.correct).length,
      firstTryTotal: reviewed.length,
      answerCount: this.asked,
      guessCount: this.guesses,
      seconds: Math.round((Date.now() - this.startedAt) / 1000),
    });

    await saveSnapshot({
      profile: { level: evaluated.state, streak: check.state, placed: snap.profile.placed },
      states,
      logs,
    });

    const tomorrow = addDays(at, 1);
    const rows = [
      { k: '做了', v: `${this.asked} 题 · ${this.newCount} 新 · ${this.reviewCount} 复习` },
      ...(reviewed.length > 0
        ? [
            {
              k: '复习题首答正确率',
              v: `${Math.round((reviewed.filter((t) => t.correct).length / reviewed.length) * 100)}%`,
            },
          ]
        : []),
      { k: '连续打卡', v: `${check.state.current} 天 · ${OUTCOME_TEXT[check.outcome]}` },
      { k: '住进顶层', v: `${states.filter((s) => s.box === MASTERED_BOX).length} 词` },
      { k: '明天要复习', v: `${states.filter((s) => s.dueAt <= tomorrow).length} 词` },
    ];

    this.setData({
      phase: 'done',
      summary: {
        title: '今天完成啦',
        rows,
        // 升级要庆祝，降级静默 —— 只有 changed === 1 才渲染
        levelUp: evaluated.changed === 1,
        level: evaluated.state.level,
      },
    });
  },

  quit() {
    wx.navigateBack({
      // 直接以学习页启动（开发者工具里指定了编译入口）时没有上一页可退
      fail: () => wx.reLaunch({ url: '/pages/home/index' }),
    });
  },
});
