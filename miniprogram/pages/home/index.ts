/**
 * 首页 —— 孩子端主画面 + 家长周报的简版。
 *
 * 页面只做两件事：把 core 算出来的东西摊平成可渲染的数据，把点击转成一次跳转。
 * 任何"今天该学什么"的判断都不在这里（见 data/plan.ts）——
 * 首页和学习页各算一遍的话，两边显示不一致，而且不会报错。
 */
import { LEVEL_THEME, THEME_NAME } from '../../core/config.js';
import { MASTERED_BOX } from '../../core/srs.js';
import { stairsView, weekReport } from '../../core/stats.js';
import { startOfDay } from '../../core/time.js';
import { advance as advanceDays, dayOffset, now, TIME_TRAVEL } from '../../data/clock.js';
import { planToday } from '../../data/plan.js';
import { MAX_PROBE_LEVEL, PROBE_TOTAL } from '../../data/probe.js';
import { loadSnapshot, repo } from '../../data/store.js';
import {
  cycle as cycleTheme,
  MODE_GLYPH,
  MODE_LABEL,
  mode as themeMode,
  onSystemChange,
  pageClass,
  scheme,
} from '../../data/theme.js';
import { WORD_BY_ID } from '../../data/words.js';

/**
 * 每个词平均要花的秒数（含会话内重试）。
 * 11 秒是终端试玩里拍的粗略值，等真实日志攒够了应该换成实测中位数。
 */
const SECONDS_PER_WORD = 11;

interface FloorView {
  box: number;
  name: string;
  count: number;
  /** 相对最高层的宽度百分比 */
  pct: number;
  sample: string;
}

interface KV {
  k: string;
  v: string;
}

interface Data {
  statusBar: number;
  /** 根节点的配色 class：'' 或 'dark' */
  themeCls: string;
  themeGlyph: string;
  /** 已做过定级测试。false 时首页顶上挂一张定级卡 */
  placed: boolean;
  /** 定级能测到的最高等级（受词库限制），只用于定级卡的文案 */
  maxProbeLevel: number;
  /** 定级大约多少题，同样只是文案 */
  probeTotal: number;
  level: number;
  /** 等级对应的关卡主题名（农场/探险/特工），和明暗主题无关 */
  levelTheme: string;
  newCount: number;
  reviewCount: number;
  minutes: number;
  total: number;
  doneToday: boolean;
  newPaused: boolean;
  backlog: number;
  starved: boolean;
  poolSize: number;
  floors: FloorView[];
  mastered: number;
  streakCurrent: number;
  streakBest: number;
  shields: string;
  report: KV[];
  stubborn: string;
  todayText: string;
  dayOffset: number;
  timeTravel: boolean;
  loading: boolean;
  errorText: string;
}

const initial: Data = {
  statusBar: 20,
  themeCls: pageClass(),
  themeGlyph: MODE_GLYPH[themeMode()],
  // 默认 true：refresh() 之前先不要闪出定级卡。已定级的人占绝大多数，
  // "闪一下又消失"比"晚半帧出现"扎眼得多
  placed: true,
  maxProbeLevel: MAX_PROBE_LEVEL,
  probeTotal: PROBE_TOTAL,
  level: 1,
  levelTheme: '',
  newCount: 0,
  reviewCount: 0,
  minutes: 0,
  total: 0,
  doneToday: false,
  newPaused: false,
  backlog: 0,
  starved: false,
  poolSize: 0,
  floors: [],
  mastered: 0,
  streakCurrent: 0,
  streakBest: 0,
  shields: '无',
  report: [],
  stubborn: '',
  todayText: '',
  dayOffset: 0,
  timeTravel: TIME_TRAVEL,
  loading: true,
  errorText: '',
};

const textOf = (wordId: string) => WORD_BY_ID.get(wordId)?.text ?? wordId;
const pct = (x: number) => `${Math.round(x * 100)}%`;

function floorsOf(states: Parameters<typeof stairsView>[0]): FloorView[] {
  const raw = stairsView(states, 6);
  const max = Math.max(1, ...raw.map((f) => f.count));
  return raw
    .map((f) => ({
      box: f.box,
      name: f.box === MASTERED_BOX ? '🏆 已掌握' : `第 ${f.box} 层`,
      count: f.count,
      pct: Math.round((f.count / max) * 100),
      sample: f.sample.map(textOf).join(' '),
    }))
    .reverse(); // 楼梯从上往下画
}

Page({
  data: { ...initial },

  /** wx.onThemeChange 的取消函数。全局注册，不取消就会越积越多 */
  offTheme: null as (() => void) | null,
  refreshId: 0,

  onLoad() {
    this.setData({ statusBar: wx.getWindowInfo().statusBarHeight });
    // 只有「跟随系统」模式下系统切换才需要跟着走；注册与否不看模式，
    // 因为模式随时会被用户改，取消订阅的成本比判断更高
    this.offTheme = onSystemChange(() => {
      this.applyTheme();
    });
  },

  onUnload() {
    this.offTheme?.();
    this.offTheme = null;
  },

  applyTheme() {
    this.setData({ themeCls: pageClass(), themeGlyph: MODE_GLYPH[themeMode()] });
  },

  /** 跟随系统 → 浅色 → 深色 → 跟随系统 */
  toggleTheme() {
    const next = cycleTheme();
    this.applyTheme();
    wx.showToast({ title: MODE_LABEL[next], icon: 'none', duration: 900 });
  },

  /**
   * 用 onShow 而不是 onLoad：从学习页返回时页面实例还在，
   * 只有 onShow 会再跑一次 —— 否则打完一整节课回来，首页还显示"复习 12"。
   */
  onShow() {
    this.applyTheme();
    void this.refresh();
  },

  async refresh() {
    const request = ++this.refreshId;
    this.setData({ loading: true, errorText: '' });
    try {
      const snap = await loadSnapshot();
      if (request !== this.refreshId) return;
      const at = now();
    const plan = planToday(snap, at);
    const w = weekReport(snap.logs, snap.states, at);
    // 分母为 0 时 weekReport 返回 0，渲染成 "0%" 会让家长以为孩子全错，
    // 而真相是"今天只学了新词，还没有复习题可考"。
    const hasReview = snap.logs.some((l) => l.firstTryTotal > 0);

    this.setData({
      placed: snap.profile.placed,
      level: snap.profile.level.level,
      levelTheme: THEME_NAME[LEVEL_THEME[snap.profile.level.level]],
      newCount: plan.newIds.length,
      reviewCount: plan.reviewIds.length,
      minutes: Math.max(1, Math.round((plan.total * SECONDS_PER_WORD) / 60)),
      total: plan.total,
      doneToday: snap.logs.some((l) => l.day === startOfDay(at)),
      newPaused: plan.newPaused,
      backlog: plan.backlog,
      starved: plan.starved && !plan.newPaused,
      poolSize: plan.poolSize,
      floors: floorsOf(snap.states),
      mastered: w.masteredTotal,
      streakCurrent: snap.profile.streak.current,
      streakBest: snap.profile.streak.best,
      shields: snap.profile.streak.shields > 0 ? '🛡'.repeat(snap.profile.streak.shields) : '无',
      report: [
        { k: '出勤', v: `${w.activeDays}/7 天` },
        { k: '新学', v: `${w.newLearned} 词` },
        { k: '累计掌握', v: `${w.masteredTotal} 词` },
        { k: '记忆保持率', v: hasReview ? `${pct(w.firstTryAccuracy)}（健康 70–90%）` : '暂无（还没有复习题）' },
        { k: '有效作答率', v: pct(w.effectiveRate) },
        { k: '用时', v: `${w.totalMinutes} 分钟` },
      ],
      stubborn: w.stubborn.map((s) => `${textOf(s.wordId)}(错${s.lapses}次)`).join('、'),
      todayText: new Date(at).toLocaleDateString('zh-CN'),
      dayOffset: dayOffset(),
      loading: false,
      errorText: '',
    });
    } catch (error) {
      if (request !== this.refreshId) return;
      console.error('[dayword] 首页加载失败', error);
      this.setData({ loading: false, errorText: '学习数据暂时读不到，请重试。原有进度不会被清空。' });
    }
  },

  retry() {
    void this.refresh();
  },

  start() {
    if (this.data.loading || this.data.errorText !== '') return;
    void wx.navigateTo({ url: '/pages/learn/index' });
  },

  /**
   * 去定级。用 navigateTo 而不是 reLaunch：中途退出要能原样退回首页。
   * 测完由定级页自己 reLaunch 回来（首页得拿新等级重算今日任务）。
   * 开发者工具里的「重新定级」走的也是这里 —— 重测对家长不是需求，
   * 等级漂移由 core/level.ts 的控制器自己纠。
   */
  place() {
    if (this.data.loading || this.data.errorText !== '') return;
    void wx.navigateTo({ url: '/pages/placement/index' });
  },

  advance(e: WechatMiniprogram.TouchEvent) {
    if (this.data.loading) return;
    advanceDays(Number(e.currentTarget.dataset.days) || 1);
    void this.refresh();
  },

  reset() {
    if (this.data.loading) return;
    wx.showModal({
      title: '清空进度',
      content: '所有学习记录、连续打卡和日期偏移都会删掉，无法恢复。',
      // 原生弹窗吃不到 CSS 变量，只能自己按主题挑一个。
      // 注意：弹窗底色是微信按**系统**深色模式决定的，用户手动强制的浅/深管不到它
      confirmColor: scheme() === 'dark' ? '#e0895f' : '#ad5228',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ loading: true });
        void repo.clear().then(
          () => this.refresh(),
          (error) => {
            console.error('[dayword] 清空进度失败', error);
            this.setData({ loading: false });
            wx.showToast({ title: '清空失败，原进度仍保留', icon: 'none' });
          },
        );
      },
    });
  },
});
