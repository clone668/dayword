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
import { playAudio, stopAudio } from '../../data/audio.js';
import { hasMedia, imageUrl } from '../../data/cdn.js';
import { now } from '../../data/clock.js';
import { planToday } from '../../data/plan.js';
import { MAX_PROBE_LEVEL } from '../../data/probe.js';
import { viewOf, type QuizView } from '../../data/quizview.js';
import type { LearningDraft } from '../../data/repository.js';
import {
  loadDraft,
  loadSnapshot,
  removeDraft,
  saveDraft,
  saveSnapshot,
  type Snapshot,
} from '../../data/store.js';
import { onSystemChange, pageClass } from '../../data/theme.js';
import { WORD_BY_ID, wordsUpToLevel } from '../../data/words.js';

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

type RetryAction = 'none' | 'begin' | 'teach' | 'answer' | 'settle';

interface Data {
  statusBar: number;
  /** 根节点的配色 class：'' 或 'dark'（见 data/theme.ts） */
  themeCls: string;
  phase: 'loading' | 'teach' | 'quiz' | 'done' | 'error';
  hasMedia: boolean;
  busy: boolean;
  errorText: string;
  retryAction: RetryAction;
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
  busy: false,
  errorText: '',
  retryAction: 'none',
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
  /** 这节课启动时已有的全量状态；草稿只需保存之后改动过的词。 */
  baseStates: new Map<string, WordState>(),
  /** wordId → 这节课改动过的最新状态。 */
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
  activeSeconds: 0,
  visibleAt: 0,
  answeredDraft: null as LearningDraft | null,
  settleRetry: null as (() => Promise<void>) | null,
  settleSummary: null as Summary | null,
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
    this.visibleAt = Date.now();
  },

  onHide() {
    this.captureActiveTime();
    void this.checkpointOnHide();
  },

  async checkpointOnHide() {
    if (this.session === null || this.settleRetry !== null || isFinished(this.session)) return;
    const draft = this.draftData(false);
    try {
      await saveDraft(draft);
      this.answeredDraft = null;
    } catch (error) {
      console.error('[dayword] 后台断点保存失败', error);
    }
  },

  onUnload() {
    this.captureActiveTime();
    this.offTheme?.();
    this.offTheme = null;
    stopAudio();
    if (this.timer !== 0) clearTimeout(this.timer);
  },

  captureActiveTime() {
    if (this.visibleAt === 0) return;
    this.activeSeconds += Math.max(0, (Date.now() - this.visibleAt) / 1000);
    this.visibleAt = 0;
  },

  draftData(resumeTimer = true): LearningDraft {
    this.captureActiveTime();
    if (resumeTimer) this.visibleAt = Date.now();
    return {
      id: `${this.at}`,
      at: this.at,
      session: this.session!,
      states: [...this.states.values()],
      firstTry: this.firstTry,
      seen: this.seen,
      asked: this.asked,
      guesses: this.guesses,
      newCount: this.newCount,
      reviewCount: this.reviewCount,
      activeSeconds: Math.round(this.activeSeconds),
      updatedAt: Date.now(),
    };
  },

  restoreDraft(draft: LearningDraft) {
    this.at = draft.at;
    this.session = draft.session;
    this.baseStates = new Map(this.snap!.states.map((state) => [state.wordId, state]));
    this.states = new Map(draft.states.map((state) => [state.wordId, state]));
    this.firstTry = draft.firstTry;
    this.seen = draft.seen;
    this.asked = draft.asked;
    this.guesses = draft.guesses;
    this.newCount = draft.newCount;
    this.reviewCount = draft.reviewCount;
    this.activeSeconds = draft.activeSeconds;
  },

  async begin() {
    if (this.data.busy) return;
    this.setData({ phase: 'loading', busy: true, errorText: '', retryAction: 'none' });
    try {
      const [snap, draft] = await Promise.all([loadSnapshot(), loadDraft()]);
      this.snap = snap;
      this.wordPool = wordsUpToLevel(snap.profile.level.level);
      if (draft !== null && draft.session.queue.every((item) => WORD_BY_ID.has(item.wordId))) {
        this.restoreDraft(draft);
      } else {
        if (draft !== null) await removeDraft();
        this.at = now();
        this.baseStates = new Map(snap.states.map((state) => [state.wordId, state]));
        this.states = new Map();
        const plan = planToday(snap, this.at);
        this.session = startSession(plan.reviewIds, plan.newIds);
        this.newCount = plan.newIds.length;
        this.reviewCount = plan.reviewIds.length;
        this.firstTry = [];
        this.seen = [];
        this.asked = 0;
        this.guesses = 0;
        this.activeSeconds = 0;
        await saveDraft(this.draftData());
      }
      this.setData({ busy: false });
      this.step();
    } catch (error) {
      console.error('[dayword] 学习会话加载失败', error);
      this.setData({
        phase: 'error',
        busy: false,
        errorText: '功课暂时打不开，进度没有丢。请重试。',
        retryAction: 'begin',
      });
    }
  },

  retryBegin() {
    void this.begin();
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
      errorText: '',
      retryAction: 'none',
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

  async learned() {
    if (this.data.busy) return;
    this.setData({ busy: true, errorText: '', retryAction: 'none' });
    try {
      await saveDraft(this.draftData());
      this.setData({ busy: false });
      this.ask(current(this.session!)!.wordId);
    } catch (error) {
      console.error('[dayword] 教学卡断点保存失败', error);
      this.setData({ busy: false, errorText: '断点保存失败，请重试后继续。', retryAction: 'teach' });
    }
  },

  ask(wordId: string) {
    const word = wordOf(wordId);
    const st = this.states.get(wordId) ?? this.baseStates.get(wordId) ?? newWordState(wordId, this.at);
    // 先定题型再出题：题型决定难度，这是等级唯一的作用通道（core/questions.ts）
    const kind = pickKind(
      this.snap!.profile.level.level,
      st.box,
      Math.random,
      (candidate) => hasMedia || (candidate !== 'audio2image' && candidate !== 'dictation'),
    );
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
      errorText: '',
      retryAction: 'none',
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

  async playWord() {
    const w = this.currentWord;
    if (w === null) return;
    if (!hasMedia) {
      wx.showToast({ title: '发音还没接入（CDN 未配置）', icon: 'none' });
      return;
    }
    const ok = await playAudio(w.audioKey);
    if (!ok) wx.showToast({ title: `发音加载失败，先按音标读 ${w.phonetic}`, icon: 'none' });
  },

  /* ---- 三种作答方式，最后都汇到 judge() ---- */

  pick(e: WechatMiniprogram.TouchEvent) {
    if (this.data.feedback !== 'none' || this.data.busy) return;
    this.judge(Number(e.currentTarget.dataset.i));
  },

  spell(e: WechatMiniprogram.TouchEvent) {
    if (this.data.feedback !== 'none' || this.data.busy) return;
    const i = Number(e.currentTarget.dataset.i);
    const chip = this.data.pool[i];
    if (chip === undefined || chip.used) return;
    const pool = this.data.pool.map((c, j) => (j === i ? { ...c, used: true } : c));
    this.setData({ pool, spelled: [...this.data.spelled, { key: chip.key, ch: chip.ch }] });
  },

  unspell(e: WechatMiniprogram.TouchEvent) {
    if (this.data.feedback !== 'none' || this.data.busy) return;
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
    if (this.data.feedback !== 'none' || this.data.busy) return;
    const q = this.question!;
    const input = q.kind === 'dragSpell' ? this.data.spelled.map((s) => s.ch).join('') : this.data.typed;
    this.judge(input);
  },

  /** 判分后先落草稿；写成功前不会翻题，失败重试也不会重复计分。 */
  async judge(input: number | string) {
    if (this.data.feedback !== 'none' || this.data.busy) return;
    const q = this.question!;
    const rtMs = Date.now() - this.shownAt;
    const correct = checkAnswer(q, input);
    const a: Answer = { wordId: q.wordId, correct, rtMs, kind: q.kind, at: this.at };
    const guessed = isGuess(a);

    if (!this.seen.includes(q.wordId)) {
      this.seen.push(q.wordId);
      this.firstTry.push({ correct, isNew: this.currentIsNew });
    }
    if (guessed) this.guesses++;
    this.asked++;
    this.states.set(q.wordId, review(this.currentState!, a, this.at));
    this.session = submit(this.session!, a);
    this.answeredDraft = this.draftData();

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

    this.setData({
      optCls,
      feedback,
      fbText,
      busy: true,
      errorText: '',
      retryAction: 'none',
      ...this.progressData(),
    });
    await this.persistAnswer(feedback === 'right');
  },

  async persistAnswer(autoNext: boolean) {
    if (this.answeredDraft === null) return;
    try {
      await saveDraft(this.answeredDraft);
      this.answeredDraft = null;
      this.setData({ busy: false, errorText: '', retryAction: 'none' });
      if (autoNext) this.timer = setTimeout(() => this.next(), RIGHT_PAUSE_MS);
    } catch (error) {
      console.error('[dayword] 答题断点保存失败', error);
      this.setData({
        busy: false,
        errorText: '答案已保留在本页，但还没写入存档。请重试保存。',
        retryAction: 'answer',
      });
    }
  },

  retry() {
    if (this.data.busy) return;
    switch (this.data.retryAction) {
      case 'begin':
        void this.begin();
        break;
      case 'teach':
        void this.learned();
        break;
      case 'answer':
        this.retrySave();
        break;
      case 'settle':
        void this.retrySettle();
        break;
      case 'none':
        break;
    }
  },

  retrySave() {
    if (this.data.busy || this.answeredDraft === null) return;
    this.setData({ busy: true, errorText: '', retryAction: 'none' });
    void this.persistAnswer(this.data.feedback === 'right');
  },

  /** 答对自动调用；答错和疑似瞎猜要孩子自己点"继续"—— 强迫他看一眼正确答案 */
  next() {
    if (this.data.busy || this.answeredDraft !== null) return;
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
    if (this.data.busy) return;
    this.setData({ busy: true, errorText: '', retryAction: 'none' });
    const snap = this.snap!;
    const at = this.at;
    const level = snap.profile.level.level;

    // 空会话不打卡、不写日志：点进来看一眼不应该算完成一天
    if (this.asked === 0) {
      try {
        await removeDraft();
      } catch (error) {
        console.error('[dayword] 空课程断点清理失败', error);
        this.setData({
          busy: false,
          errorText: '课程状态还没保存，请重试。',
          retryAction: 'settle',
        });
        this.settleRetry = () => removeDraft();
        this.settleSummary = { title: '今天没有到期的词 🎈', rows: [], levelUp: false, level };
        return;
      }
      this.setData({
        phase: 'done',
        busy: false,
        errorText: '',
        retryAction: 'none',
        summary: { title: '今天没有到期的词 🎈', rows: [], levelUp: false, level },
      });
      return;
    }

    const reviewed = this.firstTry.filter((t) => !t.isNew);
    const evaluated = evaluateDaily(
      recordAnswers(snap.profile.level, this.firstTry),
      at,
      MAX_PROBE_LEVEL,
    );
    const check = checkIn(snap.profile.streak, at);
    const mergedStates = new Map(this.baseStates);
    for (const [wordId, state] of this.states) mergedStates.set(wordId, state);
    const states = [...mergedStates.values()];
    const logs = upsertLog(snap.logs, {
      day: startOfDay(at),
      newCount: this.newCount,
      reviewCount: this.reviewCount,
      firstTryCorrect: reviewed.filter((t) => t.correct).length,
      firstTryTotal: reviewed.length,
      answerCount: this.asked,
      guessCount: this.guesses,
      seconds: Math.round(this.activeSeconds + Math.max(0, (Date.now() - this.visibleAt) / 1000)),
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
    this.settleSummary = {
      title: '今天完成啦',
      rows,
      levelUp: evaluated.changed === 1,
      level: evaluated.state.level,
    };

    const commit = () =>
      saveSnapshot(
        {
          profile: { level: evaluated.state, streak: check.state, placed: snap.profile.placed },
          states,
          logs,
        },
        true,
      );
    this.settleRetry = commit;
    try {
      await commit();
      this.settleRetry = null;
    } catch (error) {
      console.error('[dayword] 课程结算失败', error);
      this.setData({
        busy: false,
        errorText: '结算还没写入存档，请重试。当前课程断点仍然保留。',
        retryAction: 'settle',
      });
      return;
    }

    this.setData({
      phase: 'done',
      busy: false,
      errorText: '',
      retryAction: 'none',
      summary: this.settleSummary,
    });
  },

  async retrySettle() {
    if (this.data.busy || this.settleRetry === null) return;
    this.setData({ busy: true, errorText: '', retryAction: 'none' });
    try {
      await this.settleRetry();
      this.settleRetry = null;
      this.setData({ phase: 'done', busy: false, errorText: '', retryAction: 'none', summary: this.settleSummary });
    } catch (error) {
      console.error('[dayword] 课程结算重试失败', error);
      this.setData({ busy: false, errorText: '结算仍未写入，请稍后再重试。', retryAction: 'settle' });
    }
  },

  imageError(e: WechatMiniprogram.CustomEvent) {
    const kind = String(e.currentTarget.dataset.kind ?? '');
    const index = Number(e.currentTarget.dataset.i);
    if (kind === 'teach' && this.data.teach !== null) {
      this.setData({ teach: { ...this.data.teach, image: '' } });
      return;
    }
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

  quit() {
    wx.navigateBack({
      // 直接以学习页启动（开发者工具里指定了编译入口）时没有上一页可退
      fail: () => wx.reLaunch({ url: '/pages/home/index' }),
    });
  },
});
