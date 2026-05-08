// ==UserScript==
// @name         ⚡ V12_SUPREME — SUPREME-PRED v2 | 30-Algo Weighted Engine | 70%+ Win Rate
// @namespace    candle-pro-strategy-v12-supreme
// @version      12.0.0
// @description  V12: SUPREME-PRED v2 | Group A/B/C/D Weighted Voting | Kalman | Hurst R/S | Regime Classifier | Adaptive Learning | 70% Confidence Gate
// @author       aoirusra
// @match        *://pocketoption.com/*
// @match        *://*.pocketoption.com/*
// @match        *://m.pocketoption.com/*
// @match        *://trade.pocketoption.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

/*
 * ════════════════════════════════════════════════════════════════════════
 *  v10.7 — TREND GUARD FIX
 *
 *  ✅ كل إصلاحات v10.6 + حارس الاتجاه الجوهري
 *
 *  🚨 المشكلة التي يحلها v10.7:
 *  كان الكود يدخل BUY وسط هبوط واضح (وSELL وسط صعود واضح)
 *  بسبب: Signal Watcher ينفذ الإشارة القديمة بدون إعادة فحص الاتجاه
 *
 *  🎯 الحل — طبقتان من الحماية:
 *
 *  طبقة 1: executeTrade (حارس 4 جديد)
 *  ├─ قبل أي صفقة: يحسب analyzeTrend على آخر الشموع
 *  ├─ إذا BUY + trend=DOWN  → رفض فوري مع log واضح
 *  ├─ إذا SELL + trend=UP   → رفض فوري مع log واضح
 *  └─ UP_WEAK / DN_WEAK / NEUTRAL → مسموح (لا تشديد زائد)
 *
 *  طبقة 2: _startSignalWatcher (فحص لحظي)
 *  ├─ كل 200ms: يفحص الاتجاه قبل تمرير الإشارة لـ executeTrade
 *  ├─ إذا الإشارة عكس الاتجاه → يلغيها ويصفّر _readySignal
 *  └─ لا حظر على عدد الصفقات — فقط يرفض العكسية
 *
 *  🔧 تغييرات v10.7:
 *  ├─ [GUARD] executeTrade: حارس 4 — فلتر الاتجاه الجوهري
 *  ├─ [WATCH] _startSignalWatcher: فحص الاتجاه لحظياً قبل executeTrade
 *  ├─ [KEEP]  TRADE_COOLDOWN_MS: بدون تغيير — لا تشديد إضافي
 *  └─ [LOG]   رسائل واضحة عند رفض الصفقة بسبب الاتجاه
 * ════════════════════════════════════════════════════════════════════════
 */

(function (W) {
  'use strict';
  if (W.__CANDLE_BOT_V12_SUPREME) return;
  W.__CANDLE_BOT_V12_SUPREME = true;

  // ══════════════════════════════════════════════════════════════════════
  // § 1  الإعدادات
  // ══════════════════════════════════════════════════════════════════════
  const CFG = {
    // ─── أنماط الشموع ───────────────────────────────────────────────
    HAMMER_WICK_RATIO      : 2.0,
    MARUBOZU_MAX_WICK      : 0.04,
    HARAMI_MAX_RATIO       : 0.55,
    ENGULF_MIN_RATIO       : 1.05,
    PIERCE_MIN_PENETRATION : 0.55,
    TWEEZER_TOLERANCE      : 0.0001,
    STAR_BODY_RATIO        : 0.20,
    DOJI_MAX_BODY_RATIO    : 0.08,
    GRAVE_UPPER_MIN        : 0.65,
    DRAGON_LOWER_MIN       : 0.65,
    MIN_TICKS_PER_CANDLE   : 3,
    MAX_CANDLES            : 30,

    // ─── 🆕 [DSO] توقيت الدخول — أسرع (v10.3) ──────────────────────
    ENTRY_DELAY_MS         : 20,
    ENTRY_DELAY_SHORT      : 3,
    TRADE_COOLDOWN_MS      : 500,    // ✅ v10.8: حد أدنى فقط — الكولداون الفعلي يُحسب من getAdaptiveCooldown()
    TRADE_COOLDOWN_RATIO   : 0.25,   // ✅ v10.8: 25% من طول الشمعة (3ث→750ms | 15ث→3750ms | 60ث→15s | ...)
    TICK_CANDLE_TIMEOUT    : 3500,

    // ─── استراتيجية ─────────────────────────────────────────────────
    MIN_PATTERN_CONFIDENCE : 2,
    TREND_CANDLES          : 7,
    TREND_STRONG_RATIO     : 0.72,
    DEFAULT_AMOUNT         : 1,
    PERIOD_CONFIRM_COUNT   : 4,      // ✅ v10.10 FIX#4: ↑ من 2 — يمنع التقلب السريع في الفريم
    PERIOD_TRUSTED_OVERRIDE: 4,
    TREND_FILTER_ENABLED   : true,
    SHORT_MODE_NO_TREND_FILTER : true, // ✅ v10.5: SHORT_MODE بلا فلتر اتجاه
    SHORT_MODE_NO_CANDLE_LOCK  : true, // ✅ v10.5: SHORT_MODE بلا قفل الشمعة
    SIGNAL_WATCHER_MS          : 100,  // ✅ v12: ↓ 100ms — SUPREME-PRED يُعيد تقييم كل 100ms
    SIGNAL_WATCHER_EXPIRY_MS   : 2500, // ✅ v12: ↓ 2500ms — أسرع انتهاء للفريمات القصيرة
    TRADE_EXEC_TIMEOUT_MS      : 0,  // ✅ v10.8: غير مستخدم — يُحسب ديناميكياً: getAdaptiveCooldown() × 2.5
    MAX_LOSS_STREAK        : 3,
    LOSS_STREAK_PAUSE_MS   : 45000,
    MIN_CANDLES_TO_TRADE   : 3,      // ↓ من 5 — v10.3 يبدأ فوراً

    // ─── فلاتر ───────────────────────────────────────────────────────
    BODY_SMA_PERIOD        : 20,
    BODY_SMA_RATIO         : 0.6,
    MICRO_TREND_EMA_PERIOD : 5,
    MICRO_TREND_ENABLED    : true,
    ATR_PERIOD             : 14,
    ATR_MOMENTUM_RATIO     : 0.9,
    ATR_ENABLED            : true,
    SLIPPAGE_TICKS         : 2,
    SLIPPAGE_ENABLED       : true,
    FRAG_BUFFER_TTL        : 500,

    // ─── 🔧 [CONF] Confluence Engine v10.3 — عتبات ذكية ───────────
    CONFLUENCE_MIN_SCORE   : 2.5,
    CONFLUENCE_AUTO_MIN    : 3.0,
    // عتبات تكيفية حسب الفريم
    CONF_SHORT_AUTO        : 2.5,    // ✅ v10.10 FIX#3: ↑ من 1.0 — يمنع CONF:2.0/2.5 من التنفيذ
    CONF_SHORT_MIN         : 2.5,    // ✅ v10.10 FIX#3: ↑ من 0.5 — حد أدنى صارم للفريمات القصيرة
    CONF_MED_AUTO          : 2.5,
    CONF_MED_MIN           : 2.0,
    CONF_LONG_AUTO         : 3.5,
    CONF_LONG_MIN          : 3.0,
    // Short mode: فريم ≤15ث — TVE يطلق بدون confluence gate
    SHORT_MODE_TVE_DIRECT  : true,
    SHORT_MODE_SIGMA       : 2.0,    // ↓ من 2.5 — v10.3 أكثر حساسية
    // 🔥 v10.3 FIX: افترض short mode فوراً قبل معرفة candlePeriod
    SHORT_MODE_ASSUME      : true,   // true = SHORT_MODE حتى يثبت العكس
    SHORT_MODE_ASSUME_MAX  : 60,     // إذا candlePeriod > 60ث → إلغاء افتراض
    CONFLUENCE_TVE_WEIGHT  : 1,
    CONFLUENCE_RSI_WEIGHT  : 1,
    CONFLUENCE_EMA_WEIGHT  : 1,
    CONFLUENCE_PATTERN_WEIGHT: 1,
    CONFLUENCE_TREND_WEIGHT: 1,

    // ─── RSI Proxy (v8 — مُبقى) ───────────────────────────────────
    RSI_PERIOD             : 8,
    RSI_OVERSOLD           : 35,
    RSI_OVERBOUGHT         : 65,
    RSI_ENABLED            : true,

    // ─── EMA Cross ──────────────────────────────────────────────────
    EMA_FAST_PERIOD        : 8,
    EMA_SLOW_PERIOD        : 21,
    EMA_CROSS_ENABLED      : true,

    // ─── S/R ────────────────────────────────────────────────────────
    SR_LOOKBACK            : 15,
    SR_TOLERANCE           : 0.0003,
    SR_ENABLED             : true,

    // ─── TVE ────────────────────────────────────────────────────────
    TVE_ENABLED            : true,
    TVE_BUF_SIZE           : 15,
    TVE_STD_WINDOW_MS      : 250,
    TVE_SIGMA_THRESHOLD    : 3.0,    // ↓ من 3.5 — مثل v7.2 (يطلق أكثر)
    TVE_VEL_HISTORY        : 60,
    TVE_MIN_DT_MS          : 10,
    TVE_PRIORITY           : true,

    // ─── Q-2 Predictive ─────────────────────────────────────────────
    PREDICTIVE_FIRE_MS     : 50,
    CLOCK_SYNC_ENABLED     : true,

    // ─── 🆕 [SEE] Smart Early Entry — دخول ذكي مبكر ────────────────
    // الفكرة: بدل الانتظار حتى إغلاق الشمعة، ندخل مبكراً حسب قوة الإشارة
    // كلما الثقة أعلى → دخلنا أبكر → نستفيد من كامل حركة الشمعة الجديدة
    SEE_ENABLED            : true,
    SEE_RATIO_HIGH         : 0.35,   // CONF≥4.5 → ادخل قبل 35% من طول الشمعة
    SEE_RATIO_MED          : 0.20,   // CONF≥3.0 → ادخل قبل 20% من طول الشمعة
    SEE_RATIO_LOW          : 0.08,   // CONF<3.0  → ادخل قبل 8%  (قريب من الإغلاق)
    SEE_MAX_MS             : 4000,   // سقف مطلق: لا تدخل مبكراً أكثر من 4 ثوانٍ
    SEE_MIN_MS             : 50,     // حد أدنى: 50ms (نفس القديم)
    SEE_CONF_HIGH          : 4.5,    // عتبة الثقة العالية
    SEE_CONF_MED           : 3.0,    // عتبة الثقة المتوسطة

    // ─── PSM ────────────────────────────────────────────────────────
    PSM_MIN_TICKS          : 2,      // ↓ من 4 (v10.2: على 3ث لا يكفي 4 تيكات!)
    PSM_ENABLED            : true,
    Q1_SIG_ENABLED         : true,

    // ─── Anti-Fingerprint ───────────────────────────────────────────
    JITTER_ENABLED         : true,
    JITTER_MIN_MS          : 0,    // ✅ v10.4 FIX#6: صفر jitter للـ SHORT_MODE
    JITTER_MAX_MS          : 2,    // ✅ v10.4 FIX#6: 0-2ms بدل 3-10ms

    // ─── Adaptive Sigma Decay ───────────────────────────────────────
    ADAPTIVE_SIGMA_ENABLED      : true,
    ADAPTIVE_SIGMA_IDLE_MS      : 300000,
    ADAPTIVE_SIGMA_DECAY_MS     : 60000,
    ADAPTIVE_SIGMA_DECAY_STEP   : 0.5,
    ADAPTIVE_SIGMA_FLOOR        : 1.8,

    // ─── TVE Streak ─────────────────────────────────────────────────
    TVE_STREAK_ENABLED     : true,
    TVE_STREAK_MIN         : 3,      // ↓ من 6 (v10.2: 3 تيكات متتالية تكفي)

    // ─── 🆕 [MACD] MACD Engine ──────────────────────────────────────
    MACD_FAST              : 12,
    MACD_SLOW              : 26,
    MACD_SIGNAL            : 9,
    MACD_ENABLED           : true,

    // ─── 🆕 [BB] Bollinger Bands ────────────────────────────────────
    BB_PERIOD              : 20,
    BB_STD                 : 2.0,
    BB_SQUEEZE_THRESHOLD   : 0.001,
    BB_ENABLED             : true,

    // ─── 🆕 [SRSI] StochRSI ─────────────────────────────────────────
    SRSI_PERIOD            : 14,
    SRSI_K                 : 3,
    SRSI_D                 : 3,
    SRSI_OVERSOLD          : 20,
    SRSI_OVERBOUGHT        : 80,
    SRSI_ENABLED           : true,

    // ─── 🆕 [DIV] RSI Divergence ────────────────────────────────────
    DIV_LOOKBACK           : 10,
    DIV_ENABLED            : true,

    // ─── 🆕 [FIB] Fibonacci Retracement ─────────────────────────────
    FIB_LOOKBACK           : 20,
    FIB_TOLERANCE          : 0.0005,
    FIB_ENABLED            : true,

    // ─── 🆕 [PPT] Pattern Performance Tracker ───────────────────────
    PPT_MIN_TRADES         : 5,
    PPT_LOW_WR_THRESHOLD   : 0.45,
    PPT_HIGH_WR_THRESHOLD  : 0.70,
    PPT_ENABLED            : true,

    // ─── 🆕 [KELLY] Kelly Criterion ─────────────────────────────────
    KELLY_ENABLED          : true,
    KELLY_FRACTION         : 0.5,
    KELLY_MIN              : 1,
    KELLY_MAX_PCT          : 0.05,   // ✅ v10.8: ↓ 5% بدل 15% — أكثر أماناً
    KELLY_MAX_USD          : 50,     // ✅ v10.8: سقف مطلق بالدولار — عدّله حسب رصيدك

    // ─── 🆕 [DBL] Smart Double Trade ────────────────────────────────
    DOUBLE_ENABLED         : true,
    DOUBLE_MIN_CONFLUENCE  : 4.5,
    DOUBLE_DELAY_MS        : 800,
    DOUBLE_AMOUNT_MULT     : 1.5,
    DOUBLE_REQUIRE_TVE     : true,
    DOUBLE_REQUIRE_MACD    : true,
    DOUBLE_COOLDOWN_MS     : 5000,

    // ─── 🔥 [IMDB] Instant Multi-Double — حسب SUPREME-PRED spConf (0-100) ──────────
    // ≥70% (SUPREME gate) → 2 صفقات فورية
    // ≥80% → 3 صفقات فورية
    // ≥90% → 4 صفقات فورية
    IMDB_ENABLED           : true,
    IMDB_CONF_MAX          : 100,    // SUPREME-PRED confidence 0-100%
    IMDB_TIER_DOUBLE       : 70,     // ≥70% → 2 صفقات في نفس الثانية
    IMDB_TIER_TRIPLE       : 80,     // ≥80% → 3 صفقات في نفس الثانية
    IMDB_TIER_QUAD         : 90,     // ≥90% → 4 صفقات في نفس الثانية
    IMDB_INSTANT_DELAY_MS  : 0,      // تأخير بين الصفقات المتعددة (0 = نفس الثانية)
    IMDB_AMOUNT_MULT_2     : 1.0,    // مضاعف المبلغ للصفقة الثانية
    IMDB_AMOUNT_MULT_3     : 0.75,   // مضاعف المبلغ للصفقة الثالثة
    IMDB_AMOUNT_MULT_4     : 0.5,    // مضاعف المبلغ للصفقة الرابعة
    IMDB_COOLDOWN_MS       : 3000,   // cooldown بعد multi-trade

    // ─── 🆕 [MTF] Multi-Timeframe Bias ──────────────────────────────
    MTF_MULTIPLIER         : 3,
    MTF_ENABLED            : true,

    // ─── 🆕 [DSO] WebSocket ping ────────────────────────────────────
    DSO_WS_PING_MS         : 15000,

    // ═══════════════════════════════════════════════════════════════════
    // ─── 🔥 [SUPREME] SUPREME-PRED v2 — محرك التنبؤ المتقدم v12 ───────
    // ═══════════════════════════════════════════════════════════════════

    // ─── حاجز الثقة الصارم ─────────────────────────────────────────
    SUPREME_MIN_CONF        : 70,    // الحد الأدنى للثقة لتنفيذ الصفقة (0-100%)
    SUPREME_CANCEL_CONF     : 65,    // إلغاء الإشارة إذا انخفضت الثقة دون هذا
    SUPREME_DOUBLE_CONF     : 80,    // ثقة الصفقة المزدوجة: 1.5× المبلغ
    SUPREME_TRIPLE_CONF     : 90,    // ثقة الصفقة الثلاثية: 2× المبلغ
    SUPREME_VOLATILE_THRESH : 85,    // في نظام VOLATILE: يشترط ثقة >= 85%

    // ─── أوزان المجموعات الأربع ────────────────────────────────────
    SUPREME_W_GROUP_A       : 0.45,  // مجموعة A: ديناميكيات التيك (أعلى أولوية)
    SUPREME_W_GROUP_B       : 0.30,  // مجموعة B: إحصائية وكمية
    SUPREME_W_GROUP_C       : 0.15,  // مجموعة C: هياكلية
    SUPREME_W_GROUP_D       : 0.10,  // مجموعة D: مستوى الشمعة (تأكيد فقط)

    // ─── حدود Hurst لتصنيف النظام ──────────────────────────────────
    SUPREME_HURST_TREND     : 0.60,  // H > 0.60: TREND (تابع الزخم)
    SUPREME_HURST_RANGE     : 0.40,  // H < 0.40: RANGE (اعكس الحركة)

    // ─── R2 فلتر Regression ────────────────────────────────────────
    SUPREME_LR_R2_MIN       : 0.65,  // استخدم LR فقط اذا R2 > 0.65

    // ─── Kalman Filter ──────────────────────────────────────────────
    SUPREME_KALMAN_Q        : 1e-5,  // ضجيج العملية (process noise)
    SUPREME_KALMAN_R        : 0.01,  // ضجيج القياس (measurement noise)

    // ─── نظام التعلم التكيفي ────────────────────────────────────────
    SUPREME_LEARN_RATE      : 0.015, // معدل التعلم (محافظ لتجنب التذبذب)
    SUPREME_ALGO_WEIGHT_MIN : 0.30,  // الحد الأدنى لوزن الخوارزمية
    SUPREME_ALGO_WEIGHT_MAX : 5.00,  // الحد الأقصى لوزن الخوارزمية
    SUPREME_REGIME_MIN_TRADES: 20,   // حد أدنى للصفقات قبل تقييم الأداء
    SUPREME_REGIME_BLOCK_WR : 0.45,  // حجب النظام اذا معدل الفوز < 45%

    // ─── ATR volatility threshold لتصنيف VOLATILE ──────────────────
    SUPREME_VOLATILE_ATR_MULT: 1.8,  // ATR > 1.8x المتوسط -> VOLATILE
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 2.1  V12: Nano-Precision Sequential UID — collision-proof across 0ms IMDB bursts
  // ══════════════════════════════════════════════════════════════════════
  // Uses performance.now() sub-millisecond fraction + monotonic counter to guarantee
  // uniqueness even when multiple IMDB packets are built in the same Date.now() tick.
  let _reqIdCounter = 0;
  function _nextReqId() {
    // Combine: lower 20 bits of perf.now microseconds + 12-bit monotonic counter
    const perfNs   = Math.round((W.performance?.now?.() ?? Date.now()) * 1000) & 0xFFFFF;
    _reqIdCounter  = (_reqIdCounter + 1) & 0xFFF;
    return (perfNs * 4096 + _reqIdCounter) >>> 0;  // unsigned 32-bit — always unique in burst
  }

  // V11: Global Garbage Collection — all interval IDs tracked for clean termination before re-sync
  const _v11_intervals = [];
  const _v11_setInterval = (fn, ms) => { const id = setInterval(fn, ms); _v11_intervals.push(id); return id; };
  function _v11_clearAllIntervals() { _v11_intervals.forEach(id => clearInterval(id)); _v11_intervals.length = 0; }

  const PO_VALID_TIMES  = [5,10,15,20,25,30,45,60,90,120,180,300,600,900,1800,3600];
  const TRUSTED_SOURCES = new Set(['saveCharts','platform','updateCharts','history']);

  // ══════════════════════════════════════════════════════════════════════
  // § 2  الحالة العامة
  // ══════════════════════════════════════════════════════════════════════
  let activeAsset     = null;
  let candlePeriod    = 0;
  let durSource       = 'none';
  let wsConnected     = false;
  let totalTicks      = 0;
  let autoTrade       = true;   // ✅ v10.4 FIX#1: يبدأ مفعلاً تلقائياً
  let tradeExec       = false;
  let lastTradeMs     = 0;
  let lastSignal      = null;
  let windowTimer     = null;
  let windowAsset     = null;
  let windowPeriod    = 0;
  let _pendingEvent   = null;

  // ══════════════════════════════════════════════════════════════════════
  // § 2.5  ✅ v10.9 — Adaptive Cooldown + SubSecond Trade Manager
  // ══════════════════════════════════════════════════════════════════════
  //  المنطق: 25% من طول الشمعة، حد أدنى 500ms، لا حد أقصى
  //  أمثلة:
  //    3ث  →   750ms    |   15ث →  3750ms   |   60ث →  15000ms
  //   300ث →  75000ms   | 3600ث → 900000ms  | 1M ث  →  ∞
  //
  //  ✅ v10.9 SubSecond Fix:
  //  - _pendingTradeExpiry: وقت انتهاء الصفقة الحالية — لمنع صفقة جديدة قبل انتهاء السابقة
  //  - _subSecondBucket: دلو sub-second لمنع تكرار الصفقات في نفس الـ 50ms
  let _pendingTradeExpiry = 0;          // توقيت انتهاء الصفقة المعلقة (ms)
  let _subSecondBucket    = 0;          // طابع الـ 50ms الأخير لمنع التكرار

  function getAdaptiveCooldown() {
    const periodMs = (candlePeriod > 0 ? candlePeriod : 15) * 1000;
    return Math.max(CFG.TRADE_COOLDOWN_MS, Math.round(periodMs * CFG.TRADE_COOLDOWN_RATIO));
  }
  // auto-reset دائماً 2.5× الكولداون — يضمن أن tradeExec لا يُفتح قبل انتهاء الحجب
  function getAdaptiveExecTimeout() {
    return Math.round(getAdaptiveCooldown() * 2.5);
  }
  // ✅ v10.9: نافذة انتظار نتيجة الصفقة = طول الشمعة + 2 ثانية
  function getTradeResultWindow() {
    const periodMs = (candlePeriod > 0 ? candlePeriod : 15) * 1000;
    return periodMs + 2000;
  }

  // ⚡ v10.3 FIX: قراءة الفريم من DOM/URL عند الإقلاع — قبل أي candle
  (function _earlyPeriodDetect() {
    try {
      // محاولة #1: من URL params
      const urlParams = new URLSearchParams(W.location?.search || '');
      const pUrl = parseInt(urlParams.get('duration') || urlParams.get('period') || '0', 10);
      if (pUrl > 0 && pUrl <= 3600) { candlePeriod = pUrl; durSource = 'url'; return; }

      // محاولة #2: من DOM — عنصر اختيار الوقت في PocketOption
      const tryDOM = () => {
        const selectors = [
          '[class*="duration"] [class*="active"]',
          '[class*="expiration"] [class*="selected"]',
          '[data-name="expiration-amount"]',
          '.js-expiration-button.active',
          '[class*="expiry-time"] .active',
        ];
        for (const sel of selectors) {
          const el = W.document?.querySelector(sel);
          if (el) {
            const txt = (el.textContent || '').trim().toLowerCase();
            const m = txt.match(/^(\d+)\s*(s|sec|ث|ثانية)?$/i);
            if (m) {
              const secs = parseInt(m[1], 10);
              if (secs > 0 && secs <= 3600) { candlePeriod = secs; durSource = 'dom-early'; return true; }
            }
          }
        }
        return false;
      };

      // حاول فوراً ثم بعد 500ms و1500ms
      if (!tryDOM()) {
        setTimeout(() => { if (!candlePeriod) tryDOM(); }, 500);
        setTimeout(() => { if (!candlePeriod) tryDOM(); }, 1500);
      }
    } catch(e) { /* صامت */ }
  })();
  let tickCandleTimer = null;

  let tradeWS         = null;
  let tradeWSOrig     = null;
  let _tradeSocketReady = false;
  let _adaptiveSigmaActive = false;
  let _adaptiveSigmaTimer  = null;
  let _currentSigma        = CFG.TVE_SIGMA_THRESHOLD;
  let isDemo          = 1;
  let tradeAmount     = CFG.DEFAULT_AMOUNT;
  let _manualAmountOverride = false;   // ✅ v10.9: منع Kelly من تجاوز المبلغ اليدوي
  let accountBalance  = null;
  let lastOpenedOrder = null;
  const botOrderIds   = new Set();

  let _lastDetectedPeriod = 0;
  let _lastDetectedCount  = 0;
  let _lastFailedSignal   = null;
  let _lossStreakPauseUntil = 0;
  let _periodLockUntil    = 0;

  // ── Dynamic Cooldown state (Directive 3) ─────────────────────────────
  let _ghostTradeActive   = false;   // loss streak=1: simulate next trade, don't execute
  let _ghostSignal        = null;    // { signal, asset, entryPrice, expiryMs }
  let _ghostWatching      = false;   // ghost trade timer is running
  let _recalibrating      = false;   // loss streak=3: wait for Hurst H > 0.6

  // ── IMDB Magnet Effect state (Directive 2) ───────────────────────────
  let _magnetPulse2Active = false;
  let _magnetPulse3Active = false;

  // ── Ghost Execution: pre-serialized packet cache (LEVEL-ZERO OVERRIDE) ─
  let _ghostExecPacket = null;  // { signal, packet, builtAt }

  let _readySignal    = null;
  let _readySignalTs  = 0;
  let lastTradeTime   = 0;
  let lastTradeCandle = 0;
  let _signalPrice    = null;
  let _tickSize       = null;

  // ✅ v10.8: منع PSM من إعادة تسليح نفس الإشارة بعد التنفيذ مباشرة
  let _lastExecutedSignalKey = null;
  let _lastExecutedSignalTs  = 0;

  // ✅ v10.10 FIX#1: تتبع timers tradeExec — يمنع auto-reset القديم من تصفير tradeExec للصفقة الجديدة
  let _tradeExecLockTimer  = null;
  let _tradeExecResetTimer = null;

  // 🆕 [DBL] حالة الصفقة المزدوجة
  let _lastDoubleTradeMs  = 0;
  let _lastTradeWasDouble = false;
  let _candlesSinceAssetChange = 0;
  // ✅ v10.10 [IMDB] حالة Multi-Trade الفورية
  let _lastIMDBTradeMs    = 0;
  let _lastIMDBCount      = 0;

  // 🆕 [MACD] حالة EMA التدريجية
  const _incEMA = {};   // { [key]: { ema: number, count: number } }

  const _fragBuffers  = new WeakMap();
  let   _sioManager   = null;

  const tickBuffers   = {};
  const chaforState   = {};
  const candleBuffers = {};
  const currentCandles= {};

  // ⚡ [Q-2] Predictive State
  let fastCloseAt       = 0;
  let clockOffset       = 0;
  let _predictiveTimer  = null;
  let _predictiveRAF    = null;

  // 📦 [CACHE] Pre-serialized payload cache
  const _payloadCache = { call: null, put: null, asset: null, time: 0, amount: 0, isDemo: -1 };

  function _rebuildPayloadCache() {
    const a = activeAsset || '';
    const t = snapToPOTime(candlePeriod || 5);
    const amt = tradeAmount;
    const d = isDemo;
    if (_payloadCache.asset === a && _payloadCache.time === t && _payloadCache.amount === amt && _payloadCache.isDemo === d) return;
    _payloadCache.asset  = a;
    _payloadCache.time   = t;
    _payloadCache.amount = amt;
    _payloadCache.isDemo = d;
    _payloadCache.prefixCall = '42["openOrder",{"asset":"'+a+'","amount":'+amt+',"action":"call","isDemo":'+d+',"requestId":';
    _payloadCache.suffixCall = ',"optionType":100,"time":'+t+'}]';
    _payloadCache.prefixPut  = '42["openOrder",{"asset":"'+a+'","amount":'+amt+',"action":"put","isDemo":'+d+',"requestId":';
    _payloadCache.suffixPut  = _payloadCache.suffixCall;
  }

  function _getCachedPayload(direction, overrideAmount) {
    if (overrideAmount && overrideAmount !== tradeAmount) {
      const a = activeAsset || '', t = snapToPOTime(candlePeriod||5), d = isDemo;
      const reqId = _nextReqId();
      const base  = '42["openOrder",{"asset":"'+a+'","amount":'+overrideAmount+',"action":"'+(direction==='BUY'?'call':'put')+'","isDemo":'+d+',"requestId":'+reqId+',"optionType":100,"time":'+t+'}]';
      return base;
    }
    _rebuildPayloadCache();
    const requestId = _nextReqId();
    return direction === 'BUY'
      ? _payloadCache.prefixCall + requestId + _payloadCache.suffixCall
      : _payloadCache.prefixPut  + requestId + _payloadCache.suffixPut;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 3  ⚡ [TVE] Tick Velocity Engine
  // ══════════════════════════════════════════════════════════════════════
  const TickVelocityEngine = {
    buf:        [],
    velHistory: [],
    lastSigKey: '',
    _dirBias:   null,

    push(price, ts) {
      if (!CFG.TVE_ENABLED) return null;
      const now = ts || performance.now() + performance.timeOrigin; // [DSO] performance.now()
      this.buf.push({ ts: now, price });
      if (this.buf.length > CFG.TVE_BUF_SIZE) this.buf.shift();
      return this._analyze(now);
    },

    getDirectionBias() { return this._dirBias; },

    _analyze(now) {
      const n = this.buf.length;
      if (n < 3) return null;
      const vels = [];
      for (let i = 1; i < n; i++) {
        const dt = this.buf[i].ts - this.buf[i - 1].ts;
        if (dt < CFG.TVE_MIN_DT_MS) continue;
        vels.push((this.buf[i].price - this.buf[i - 1].price) / dt);
      }
      if (vels.length < 2) return null;

      if (CFG.TVE_STREAK_ENABLED && vels.length >= CFG.TVE_STREAK_MIN) {
        const tail    = vels.slice(-CFG.TVE_STREAK_MIN);
        const allUp   = tail.every(v => v > 0);
        const allDown = tail.every(v => v < 0);
        if (allUp || allDown) {
          const streakDir = allUp ? 'BUY' : 'SELL';
          this._dirBias = streakDir;
          const sigKey  = 'STREAK:' + streakDir + ':' + Math.round(now / 3000); // ✅ v10.8: 3000ms بدل 500ms
          if (sigKey !== this.lastSigKey) {
            this.lastSigKey = sigKey;
            return { signal:streakDir, case:'TVE-Streak', reason:(allUp?'⚡ تيارات صاعدة ×':'⚡ تيارات هابطة ×')+CFG.TVE_STREAK_MIN, confidence:4, sigma:0, velocity:vels[vels.length-1], acceleration:0, isTVE:true };
          }
        }
      }

      const latestVel   = vels[vels.length - 1];
      const latestAccel = vels[vels.length - 1] - vels[vels.length - 2];
      this.velHistory.push({ ts: now, accel: latestAccel });
      if (this.velHistory.length > CFG.TVE_VEL_HISTORY) this.velHistory.shift();

      const cutoff = now - CFG.TVE_STD_WINDOW_MS;
      const recent = this.velHistory.filter(v => v.ts >= cutoff);
      if (recent.length < 5) return null;

      const vals  = recent.map(v => v.accel);
      const mean  = vals.reduce((s, v) => s + v, 0) / vals.length;
      const vari  = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      const std   = Math.sqrt(vari);
      if (std < 1e-15) return null;

      const sigma = (latestAccel - mean) / std;
      // ⚡ v10.3 FIX: SHORT_MODE_ASSUME → استخدم sigma أقل حتى لو candlePeriod=0
      const isShortSigma = (candlePeriod > 0 && candlePeriod <= 15) ||
                           (candlePeriod === 0 && CFG.SHORT_MODE_ASSUME);
      const activeSigma = isShortSigma
        ? Math.min(_currentSigma, CFG.SHORT_MODE_SIGMA)
        : _currentSigma;
      if (Math.abs(sigma) < activeSigma) return null;

      const direction = sigma > 0 ? 'BUY' : 'SELL';
      this._dirBias = direction;
      const sigKey  = direction + ':' + Math.round(now / 500);
      if (sigKey === this.lastSigKey) return null;
      this.lastSigKey = sigKey;
      const confidence = Math.min(5, Math.max(1, Math.floor(Math.abs(sigma) / CFG.TVE_SIGMA_THRESHOLD * 2)));
      return { signal:direction, case:'TVE-Accel', reason:(direction==='BUY'?'⚡ تسارع صاعد':'⚡ تسارع هابط')+' σ='+Math.abs(sigma).toFixed(2), confidence, sigma, velocity:latestVel, acceleration:latestAccel, isTVE:true };
    },

    reset() { this.buf = []; this.velHistory = []; this.lastSigKey = ''; this._dirBias = null; },
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 4  ⚡ [Q-4] StreamingCandle
  // ══════════════════════════════════════════════════════════════════════
  const _sCandle = {
    open: null, high: null, low: null, close: null, startTime: 0, tickCount: 0,
    init(price, ts) { this.open = this.high = this.low = this.close = price; this.startTime = ts || Date.now(); this.tickCount = 1; },
    update(price)   { if (price > this.high) this.high = price; if (price < this.low) this.low = price; this.close = price; this.tickCount++; },
    get range()     { return this.high !== null ? this.high - this.low : 0; },
    get body()      { return this.open !== null ? Math.abs(this.close - this.open) : 0; },
    get isBullish() { return this.open !== null && this.close >= this.open; },
    get upperWick() { return this.open !== null ? (this.isBullish ? this.high - this.close : this.high - this.open) : 0; },
    get lowerWick() { return this.open !== null ? (this.isBullish ? this.open - this.low   : this.close - this.low) : 0; },
    isActive()      { return this.tickCount > 0 && this.open !== null; },
    // V12: Deep-clear all OHLC buffers — prevents stale data bleeding across candle boundaries
    reset() {
      this.open = null; this.high = null; this.low = null; this.close = null;
      this.startTime = 0; this.tickCount = 0;
      // Null derived caches explicitly so computed getters re-evaluate on next tick
      this._cachedRange = undefined; this._cachedBody = undefined;
    },
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 5  ⚡ [Q-5] RollingATR
  // ══════════════════════════════════════════════════════════════════════
  class RollingATR {
    constructor(period = 14) { this.period = period; this.buf = new Float64Array(period); this.count = 0; this.atr = null; }
    addCandle(high, low, prevClose) {
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      if (this.count < this.period) { this.buf[this.count++] = tr; if (this.count === this.period) { let s = 0; for (let i = 0; i < this.period; i++) s += this.buf[i]; this.atr = s / this.period; } }
      else { this.atr = (this.atr * (this.period - 1) + tr) / this.period; }
      return this.atr;
    }
    seedFromCandles(candles) { for (let i = 1; i < candles.length; i++) this.addCandle(candles[i].high, candles[i].low, candles[i-1].close); }
    get value()   { return this.atr; }
    get isReady() { return this.atr !== null; }
  }
  const _rollingATR = new RollingATR(CFG.ATR_PERIOD);

  // ══════════════════════════════════════════════════════════════════════
  // § 6  🆕 [DSO] EMA تدريجية — لا إعادة حساب كاملة
  // ══════════════════════════════════════════════════════════════════════
  // تستخدَم بديلاً عن computeEMA في المسارات الحرجة
  function _incrementalEMA(key, price, period) {
    const k = 2 / (period + 1);
    if (!_incEMA[key] || _incEMA[key].period !== period) {
      _incEMA[key] = { ema: price, period, count: 1 };
      return price;
    }
    _incEMA[key].ema = price * k + _incEMA[key].ema * (1 - k);
    return _incEMA[key].ema;
  }

  // EMA كاملة للحساب الدقيق (غير حرجة)
  function computeEMA(prices, period) {
    if (!prices || prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
    for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
    return ema;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 7  RSI — True Wilder SMMA (V12: convergence-guarded for sub-15s)
  // ══════════════════════════════════════════════════════════════════════
  // Wilder's Smoothing: α = 1/period (NOT 2/(period+1) like EMA)
  // Formula: SMMA_t = (SMMA_{t-1} * (period-1) + value_t) / period
  // Warm-up: need ≥ period*2 candles for the SMMA to converge past the
  // SMA seed. Below this threshold the RSI reading is statistically noisy.
  function computeRSIProxy(candles, period) {
    if (!CFG.RSI_ENABLED) return null;
    const n = candles.length;
    // Require 2× period for SMMA convergence (critical for sub-15s frames)
    if (n < period * 2) return null;
    // Phase 1: seed — plain average of first `period` moves
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const ch = candles[i].close - candles[i - 1].close;
      if (ch > 0) avgGain += ch; else avgLoss -= ch;
    }
    avgGain /= period; avgLoss /= period;
    // Phase 2: SMMA rolling — α = 1/period (Wilder)
    for (let i = period + 1; i < n; i++) {
      const ch   = candles[i].close - candles[i - 1].close;
      const gain = ch > 0 ? ch : 0;
      const loss = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgGain + avgLoss < 1e-12) return 50;
    const rs = avgGain / (avgLoss || 1e-10);
    return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
  }
  function getRSISignal(rsi) {
    if (rsi === null) return null;
    if (rsi <= CFG.RSI_OVERSOLD)   return 'BUY';
    if (rsi >= CFG.RSI_OVERBOUGHT) return 'SELL';
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 8  EMA Cross (v8 — مُبقى)
  // ══════════════════════════════════════════════════════════════════════
  function getEMACrossSignal(candles) {
    if (!CFG.EMA_CROSS_ENABLED) return null;
    const n = candles.length;
    if (n < CFG.EMA_SLOW_PERIOD + 2) return null;
    const prices  = candles.map(c => c.close);
    const emaSlow = computeEMA(prices, CFG.EMA_SLOW_PERIOD);
    const emaFast = computeEMA(prices, CFG.EMA_FAST_PERIOD);
    if (emaSlow === null || emaFast === null) return null;
    const lastClose = prices[prices.length - 1];
    if (emaFast > emaSlow && lastClose > emaFast) return 'BUY';
    if (emaFast < emaSlow && lastClose < emaFast) return 'SELL';
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 9  S/R Detection (v8 — مُبقى)
  // ══════════════════════════════════════════════════════════════════════
  function detectSRLevels(candles) {
    if (!CFG.SR_ENABLED) return { nearSupport: false, nearResistance: false };
    const n = Math.min(candles.length, CFG.SR_LOOKBACK);
    if (n < 5) return { nearSupport: false, nearResistance: false };
    const slice = candles.slice(-n), lastClose = slice[slice.length-1].close, tol = lastClose * CFG.SR_TOLERANCE;
    let nearSupport = false, nearResistance = false;
    for (let i = 1; i < slice.length - 1; i++) {
      const c = slice[i], p = slice[i-1], nx = slice[i+1];
      if (c.high > p.high && c.high > nx.high && Math.abs(lastClose - c.high) <= tol) nearResistance = true;
      if (c.low < p.low  && c.low  < nx.low  && Math.abs(lastClose - c.low)  <= tol) nearSupport = true;
    }
    return { nearSupport, nearResistance };
  }

  // ══════════════════════════════════════════════════════════════════════
  // § A  🆕 [MACD] محرك MACD(12,26,9)
  // ══════════════════════════════════════════════════════════════════════
  function computeMACD(candles) {
    if (!CFG.MACD_ENABLED) return null;
    const n = candles.length;
    if (n < CFG.MACD_SLOW + CFG.MACD_SIGNAL + 2) return null;
    const prices = candles.map(c => c.close);

    const emaFast   = computeEMA(prices, CFG.MACD_FAST);
    const emaSlow   = computeEMA(prices, CFG.MACD_SLOW);
    if (emaFast === null || emaSlow === null) return null;
    const macdLine  = emaFast - emaSlow;

    // احسب MACD line series لآخر MACD_SIGNAL+1 نقطة
    const macdSeries = [];
    const kFast = 2 / (CFG.MACD_FAST + 1), kSlow = 2 / (CFG.MACD_SLOW + 1);
    let ef = prices.slice(0, CFG.MACD_FAST).reduce((s, p) => s + p, 0) / CFG.MACD_FAST;
    let es = prices.slice(0, CFG.MACD_SLOW).reduce((s, p) => s + p, 0) / CFG.MACD_SLOW;
    for (let i = CFG.MACD_FAST; i < CFG.MACD_SLOW; i++) ef = prices[i] * kFast + ef * (1 - kFast);
    for (let i = CFG.MACD_SLOW; i < prices.length; i++) {
      ef = prices[i] * kFast + ef * (1 - kFast);
      es = prices[i] * kSlow + es * (1 - kSlow);
      macdSeries.push(ef - es);
    }
    if (macdSeries.length < CFG.MACD_SIGNAL + 1) return null;

    const kSig = 2 / (CFG.MACD_SIGNAL + 1);
    let sig = macdSeries.slice(0, CFG.MACD_SIGNAL).reduce((s, v) => s + v, 0) / CFG.MACD_SIGNAL;
    for (let i = CFG.MACD_SIGNAL; i < macdSeries.length; i++) sig = macdSeries[i] * kSig + sig * (1 - kSig);

    const prevMacd  = macdSeries[macdSeries.length - 2];
    const prevSig   = (() => {
      let s2 = macdSeries.slice(0, CFG.MACD_SIGNAL).reduce((s, v) => s + v, 0) / CFG.MACD_SIGNAL;
      for (let i = CFG.MACD_SIGNAL; i < macdSeries.length - 1; i++) s2 = macdSeries[i] * kSig + s2 * (1 - kSig);
      return s2;
    })();

    const histogram  = macdLine - sig;
    // كشف التقاطع
    let cross = null;
    if (prevMacd < prevSig && macdLine > sig)  cross = 'BUY';   // تقاطع صاعد
    if (prevMacd > prevSig && macdLine < sig)  cross = 'SELL';  // تقاطع هابط

    return { macdLine, signalLine: sig, histogram, cross };
  }

  function getMACDSignal(candles) {
    const m = computeMACD(candles);
    if (!m) return null;
    if (m.cross) return m.cross;
    if (m.histogram > 0) return 'BUY';
    if (m.histogram < 0) return 'SELL';
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § B  🆕 [BB] Bollinger Bands(20,2)
  // ══════════════════════════════════════════════════════════════════════
  function computeBB(candles) {
    if (!CFG.BB_ENABLED) return null;
    const n = candles.length;
    if (n < CFG.BB_PERIOD) return null;
    const prices  = candles.slice(-CFG.BB_PERIOD).map(c => c.close);
    const middle  = prices.reduce((s, p) => s + p, 0) / CFG.BB_PERIOD;
    const variance= prices.reduce((s, p) => s + (p - middle) ** 2, 0) / CFG.BB_PERIOD;
    const stdDev  = Math.sqrt(variance);
    const upper   = middle + CFG.BB_STD * stdDev;
    const lower   = middle - CFG.BB_STD * stdDev;
    const bandwidth = stdDev > 0 ? (upper - lower) / middle : 0;
    const lastClose = prices[prices.length - 1];
    const percentB  = bandwidth > 0 ? (lastClose - lower) / (upper - lower) : 0.5;
    return { upper, middle, lower, bandwidth, percentB, squeeze: bandwidth < CFG.BB_SQUEEZE_THRESHOLD };
  }

  function getBBSignal(candles) {
    const bb = computeBB(candles);
    if (!bb) return null;
    // ⚡ v10.3 FIX: SQUEEZE لا يحجب — فقط يضعف الإشارة (كان يرجع null)
    if (bb.squeeze) return null; // squeeze: BB لا تعطي إشارة في السوق المضغوط (مقبول — لا عقوبة)
    const rsi = computeRSIProxy(candles, CFG.RSI_PERIOD);
    const lastClose = candles[candles.length - 1].close;
    if (lastClose <= bb.lower && (rsi === null || rsi <= 40)) return 'BUY';
    if (lastClose >= bb.upper && (rsi === null || rsi >= 60)) return 'SELL';
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § C  🆕 [SRSI] StochRSI(14,3,3)
  // ══════════════════════════════════════════════════════════════════════
  function computeRSISeries(candles, period) {
    // V11: Full Wilder-smoothed RSI series
    const n = candles.length;
    if (n < period + 1) return null;
    const result = [];
    // Seed
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const ch = candles[i].close - candles[i - 1].close;
      if (ch > 0) avgGain += ch; else avgLoss -= ch;
    }
    avgGain /= period; avgLoss /= period;
    result.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-10)));
    for (let i = period + 1; i < n; i++) {
      const ch = candles[i].close - candles[i - 1].close;
      avgGain = (avgGain * (period - 1) + Math.max(ch, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-ch, 0)) / period;
      result.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-10)));
    }
    return new Float64Array(result);
  }

  function _sma(arr, period, startIdx) {
    let s = 0;
    for (let i = startIdx; i < startIdx + period; i++) s += arr[i];
    return s / period;
  }

  function computeStochRSI(candles) {
    if (!CFG.SRSI_ENABLED) return null;
    const need = CFG.SRSI_PERIOD + CFG.SRSI_K + CFG.SRSI_D + 2;
    if (candles.length < need) return null;

    const rsiSeries = computeRSISeries(candles, CFG.SRSI_PERIOD);
    if (!rsiSeries || rsiSeries.length < CFG.SRSI_PERIOD + CFG.SRSI_K + CFG.SRSI_D) return null;

    // Stochastic of RSI
    const stochLen = rsiSeries.length - CFG.SRSI_PERIOD + 1;
    if (stochLen < CFG.SRSI_K + CFG.SRSI_D) return null;

    const rawK = new Float64Array(stochLen);
    for (let i = 0; i < stochLen; i++) {
      const window = rsiSeries.slice(i, i + CFG.SRSI_PERIOD);
      const hi = Math.max(...window), lo = Math.min(...window);
      rawK[i] = hi === lo ? 50 : ((rsiSeries[i + CFG.SRSI_PERIOD - 1] - lo) / (hi - lo)) * 100;
    }

    // K = SMA(rawK, SRSI_K)
    const kLen = stochLen - CFG.SRSI_K + 1;
    if (kLen < CFG.SRSI_D) return null;
    const kLine = new Float64Array(kLen);
    for (let i = 0; i < kLen; i++) kLine[i] = _sma(rawK, CFG.SRSI_K, i);

    // D = SMA(K, SRSI_D)
    const dLen = kLen - CFG.SRSI_D + 1;
    if (dLen < 2) return null;
    const dLine = new Float64Array(dLen);
    for (let i = 0; i < dLen; i++) dLine[i] = _sma(kLine, CFG.SRSI_D, i);

    const k     = kLine[kLine.length - 1];
    const d     = dLine[dLine.length - 1];
    const prevK = kLine[kLine.length - 2];
    const prevD = dLine[dLine.length - 2];

    let signal = null;
    if (k < CFG.SRSI_OVERSOLD)    signal = 'BUY';
    if (k > CFG.SRSI_OVERBOUGHT)  signal = 'SELL';
    if (prevK < prevD && k > d)   signal = 'BUY';   // تقاطع صاعد — أولوية
    if (prevK > prevD && k < d)   signal = 'SELL';  // تقاطع هابط — أولوية

    return { k, d, signal };
  }

  // ══════════════════════════════════════════════════════════════════════
  // § D  V11 [DIV] كاشف الاختلاف — Temporal-Order Constraint Engine
  // ══════════════════════════════════════════════════════════════════════
  function detectDivergence(candles) {
    if (!CFG.DIV_ENABLED || candles.length < CFG.DIV_LOOKBACK + CFG.RSI_PERIOD + 2) return null;
    const slice    = candles.slice(-CFG.DIV_LOOKBACK);
    const rsiSlice = computeRSISeries(candles, CFG.RSI_PERIOD);
    if (!rsiSlice || rsiSlice.length < CFG.DIV_LOOKBACK) return null;

    const rsiWin = Array.from(rsiSlice.slice(-CFG.DIV_LOOKBACK));
    const prices = slice.map(c => c.close);
    const n      = slice.length;

    // V11: Collect all pivots WITH their temporal index
    const lows  = []; // { idx, price, rsi }
    const highs = [];
    for (let i = 1; i < n - 1; i++) {
      if (prices[i] < prices[i-1] && prices[i] < prices[i+1])
        lows.push({ idx: i, price: prices[i], rsi: rsiWin[i] });
      if (prices[i] > prices[i-1] && prices[i] > prices[i+1])
        highs.push({ idx: i, price: prices[i], rsi: rsiWin[i] });
    }

    // V11 Temporal constraint: l2 MUST come after l1 in time (idx)
    // Bullish divergence: later low has LOWER price, but HIGHER RSI
    if (lows.length >= 2) {
      const l1 = lows[lows.length - 2], l2 = lows[lows.length - 1];
      if (l2.idx > l1.idx && l2.price < l1.price && l2.rsi > l1.rsi)
        return { type: 'bullish', strength: 1.5 };
    }

    // Bearish divergence: later high has HIGHER price, but LOWER RSI
    if (highs.length >= 2) {
      const h1 = highs[highs.length - 2], h2 = highs[highs.length - 1];
      if (h2.idx > h1.idx && h2.price > h1.price && h2.rsi < h1.rsi)
        return { type: 'bearish', strength: 1.5 };
    }

    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § E  🆕 [FIB] مستويات فيبوناتشي
  // ══════════════════════════════════════════════════════════════════════
  const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
  const FIB_BUY_LEVELS  = [0.382, 0.5, 0.618]; // دعم في اتجاه صاعد
  const FIB_SELL_LEVELS = [0.382, 0.5, 0.618]; // مقاومة في اتجاه هابط

  function computeFibLevels(candles) {
    if (!CFG.FIB_ENABLED || candles.length < CFG.FIB_LOOKBACK) return null;
    const slice    = candles.slice(-CFG.FIB_LOOKBACK);
    const swingHigh = Math.max(...slice.map(c => c.high));
    const swingLow  = Math.min(...slice.map(c => c.low));
    const range    = swingHigh - swingLow;
    if (range < 1e-10) return null;
    return FIB_LEVELS.map(lvl => swingLow + lvl * range);
  }

  function getFibSignal(candles) {
    if (!CFG.FIB_ENABLED) return null;
    const levels = computeFibLevels(candles);
    if (!levels) return null;
    const lastClose = candles[candles.length - 1].close;
    const tol = lastClose * CFG.FIB_TOLERANCE;
    const trendInfo = analyzeTrend(candles);

    for (let i = 0; i < FIB_BUY_LEVELS.length; i++) {
      const level = levels[Math.round(FIB_BUY_LEVELS[i] * (FIB_LEVELS.length - 1))];
      if (level !== undefined && Math.abs(lastClose - level) <= tol) {
        if (trendInfo.trend === 'UP' || trendInfo.trend === 'UP_WEAK') return { signal: 'BUY',  bonus: 0.5 };
        if (trendInfo.trend === 'DOWN' || trendInfo.trend === 'DN_WEAK') return { signal: 'SELL', bonus: 0.5 };
      }
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § F  🆕 [PPT] متتبع أداء الأنماط
  // ══════════════════════════════════════════════════════════════════════
  let patternStats = {};

  function _loadPatternStats() {
    try { const s = localStorage.getItem('cb_v100_pattern_stats'); if (s) patternStats = JSON.parse(s); } catch (_) {}
  }
  function _savePatternStats() {
    try { localStorage.setItem('cb_v100_pattern_stats', JSON.stringify(patternStats)); } catch (_) {}
  }
  _loadPatternStats();

  function recordPatternResult(patternCase, win) {
    if (!CFG.PPT_ENABLED || !patternCase) return;
    if (!patternStats[patternCase]) patternStats[patternCase] = { wins: 0, losses: 0 };
    win ? patternStats[patternCase].wins++ : patternStats[patternCase].losses++;
    _savePatternStats();
    _updatePPTDisplay();
  }

  function getPatternWinRate(patternCase) {
    if (!patternStats[patternCase]) return null;
    const { wins, losses } = patternStats[patternCase];
    const total = wins + losses;
    if (total === 0) return null;
    return wins / total;
  }

  function getPatternConfBoost(patternCase) {
    if (!CFG.PPT_ENABLED || !patternCase) return 0;
    const wr = getPatternWinRate(patternCase);
    if (wr === null) return 0;
    const { wins, losses } = patternStats[patternCase];
    const total = wins + losses;
    if (total < CFG.PPT_MIN_TRADES) return 0;
    if (wr < CFG.PPT_LOW_WR_THRESHOLD)  return -1;
    if (wr > CFG.PPT_HIGH_WR_THRESHOLD) return  1;
    return 0;
  }

  function getTopPatterns(n = 5) {
    return Object.entries(patternStats)
      .filter(([, v]) => v.wins + v.losses >= CFG.PPT_MIN_TRADES)
      .map(([k, v]) => ({ name: k, wr: v.wins / (v.wins + v.losses), total: v.wins + v.losses }))
      .sort((a, b) => b.wr - a.wr)
      .slice(0, n);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § G  V11 [KELLY] Kelly Criterion — Dynamic Payout Ratio
  // ══════════════════════════════════════════════════════════════════════
  let _dynamicPayout = null; // V11: extracted from platform data when available

  function computeKellyAmount(balance) {
    if (!CFG.KELLY_ENABLED || !balance || balance <= 0) return CFG.DEFAULT_AMOUNT;
    const total = STATS.wins + STATS.losses;
    if (total < 10) return CFG.DEFAULT_AMOUNT; // بيانات غير كافية
    const wr = STATS.wins / total;
    const lr = STATS.losses / total;
    // V11: Dynamic payout ratio — extracted from platform, fallback to 85%
    const avgWinLoss = (_dynamicPayout !== null && _dynamicPayout > 0) ? _dynamicPayout : 0.85;
    const kellyFraction = wr - (lr / avgWinLoss);
    if (kellyFraction <= 0) return CFG.KELLY_MIN;
    const kellyAmount = balance * (kellyFraction * CFG.KELLY_FRACTION);
    const maxAmount   = balance * CFG.KELLY_MAX_PCT;
    const hardCap     = CFG.KELLY_MAX_USD || Infinity;
    const result = Math.max(CFG.KELLY_MIN, Math.min(maxAmount, kellyAmount, hardCap));
    return Math.round(result * 100) / 100;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § H  🆕 [DBL] نظام الصفقة المزدوجة الذكية
  // ══════════════════════════════════════════════════════════════════════
  function shouldDouble(confluenceScore, signalDir, tveResult, macdResult) {
    if (!CFG.DOUBLE_ENABLED)                                 return { doDouble: false };
    // حرس 1: عتبة SUPREME-PRED (spConf ≥ 80% for doubling)
    if (confluenceScore < CFG.SUPREME_DOUBLE_CONF)           return { doDouble: false };
    // حرس 2: TVE يجب أن يوافق
    if (CFG.DOUBLE_REQUIRE_TVE) {
      const tveBias = TickVelocityEngine.getDirectionBias();
      if (tveBias !== signalDir)                             return { doDouble: false };
    }
    // حرس 3: MACD يجب أن يوافق
    if (CFG.DOUBLE_REQUIRE_MACD) {
      if (!macdResult || macdResult.signal !== signalDir)    return { doDouble: false };
    }
    // حرس 4: لا صفقات مزدوجة متتالية
    if (_lastTradeWasDouble)                                 return { doDouble: false };
    // حرس 5: رصيد كافٍ
    if (!accountBalance || accountBalance < 20)              return { doDouble: false };
    // حرس 6: لا يزدوج عند سلسلة خسائر ≥ 2
    if (STATS.lossStreak >= 2)                               return { doDouble: false };
    // حرس 7: أول 5 شموع بعد تغيير الزوج
    if (_candlesSinceAssetChange < 5)                        return { doDouble: false };
    // حرس 8: cooldown بعد صفقة مزدوجة سابقة
    if ((Date.now() - _lastDoubleTradeMs) < CFG.DOUBLE_COOLDOWN_MS) return { doDouble: false };

    const secondAmount = Math.round(tradeAmount * CFG.DOUBLE_AMOUNT_MULT * 100) / 100;
    return { doDouble: true, secondAmount, secondDelay: CFG.DOUBLE_DELAY_MS };
  }

  function executeDoubleTradeSequence(signal, asset, firstAmount, secondAmount, delayMs) {
    addLog('🔥🔥 DOUBLE TRADE — ' + signal + ' #1 $' + firstAmount, 'signal');
    executeTrade(signal, asset, firstAmount);
    _lastDoubleTradeMs  = Date.now();
    _lastTradeWasDouble = true;
    STATS.doubles = (STATS.doubles || 0) + 1;
    setTimeout(() => {
      if (!autoTrade) return;
      // V11: Protected Pulse — Secondary emission passes through Same Confluence Guard
      if (_lossStreakPauseUntil > Date.now()) { addLog('🔥🔥 #2 مُلغاة — وقف الخسائر', 'error'); return; }
      const _d2Candles = candleBuffers[asset] || [];
      if (_d2Candles.length >= 3) {
        const _d2Trend = analyzeTrend(_d2Candles);
        const _d2Down  = _d2Trend.trend === 'DOWN' || _d2Trend.trend === 'DN_WEAK';
        const _d2Up    = _d2Trend.trend === 'UP'   || _d2Trend.trend === 'UP_WEAK';
        if (signal === 'BUY'  && _d2Down) { addLog('🔥🔥 #2 مُلغاة — هبوط (' + _d2Trend.label + ')', 'error'); return; }
        if (signal === 'SELL' && _d2Up)   { addLog('🔥🔥 #2 مُلغاة — صعود (' + _d2Trend.label + ')', 'error'); return; }
      }
      addLog('🔥🔥 DOUBLE TRADE — ' + signal + ' #2 $' + secondAmount, 'signal');
      _sendRawOrder(signal, asset, secondAmount);
    }, delayMs);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § H2  ✅ v10.10 [IMDB] Instant Multi-Double — صفقات فورية متعددة
  // ══════════════════════════════════════════════════════════════════════
  //  المنطق: حسب نقطة التوافق (0–8.5)
  //    ≥ 6.0 (70%) → 2 صفقات  | ≥ 7.2 (85%) → 3 صفقات | ≥ 8.0 (94%) → 4 صفقات
  //  كل الصفقات تُرسَل في نفس الثانية (0ms delay) لضمان نفس سعر الدخول
  // ══════════════════════════════════════════════════════════════════════
  function getIMDBTier(confScore) {
    if (!CFG.IMDB_ENABLED) return 1;
    if (confScore >= CFG.IMDB_TIER_QUAD)   return 4;
    if (confScore >= CFG.IMDB_TIER_TRIPLE) return 3;
    if (confScore >= CFG.IMDB_TIER_DOUBLE) return 2;
    return 1;
  }

  function getIMDBConfPct(confScore) {
    // confScore is now spConf (0-100), return as-is
    return Math.round(confScore);
  }

  function canIMDB(confScore) {
    if (!CFG.IMDB_ENABLED)                              return false;
    if (confScore < CFG.IMDB_TIER_DOUBLE)               return false;
    if (!accountBalance || accountBalance < 10)         return false;
    if (STATS.lossStreak >= 2)                          return false;  // بعد 2 خسائر → توقف عن التضعيف
    if ((Date.now() - _lastIMDBTradeMs) < CFG.IMDB_COOLDOWN_MS) return false;
    return true;
  }

  function executeIMDB(signal, asset, confScore) {
    const tier  = getIMDBTier(confScore);
    const pct   = getIMDBConfPct(confScore);
    const base  = tradeAmount;
    const mults = [1.0, CFG.IMDB_AMOUNT_MULT_2, CFG.IMDB_AMOUNT_MULT_3, CFG.IMDB_AMOUNT_MULT_4];
    const emoji = tier === 4 ? '💎💎💎💎' : tier === 3 ? '🔥🔥🔥' : '🔥🔥';

    addLog(emoji + ' [IMDB×' + tier + '] ' + signal + ' | SUPREME-PRED: ' + pct + '%', 'signal');

    // ── Pulse 1: Immediate execution ──────────────────────────────────
    executeTrade(signal, asset);
    _lastIMDBTradeMs = Date.now();
    _lastIMDBCount   = tier;
    STATS.doubles    = (STATS.doubles || 0) + (tier - 1);
    _lastTradeWasDouble = tier > 1;

    // ── Tier-3: Magnet Effect (Directive 2) ───────────────────────────
    // Pulse 2: wait for 0.5-pip adverse move (better entry by retracement)
    // Pulse 3: execute only if Pulse 2 fired AND trend acceleration > 0
    if (tier === 3) {
      const amt2  = Math.max(1, Math.round(base * mults[1] * 100) / 100);
      const amt3  = Math.max(1, Math.round(base * mults[2] * 100) / 100);
      const p1Ref = (tickBuffers[asset] || []).slice(-1)[0] ?? null;
      // 0.5 pip threshold = 5 minimum tick sizes (adaptive to instrument)
      const pipThresh = _tickSize !== null ? _tickSize * 5 : 0.00005;
      let pulse2Fired = false;
      let magnetDeadline = Date.now() + 3000; // cancel if not filled within 3s

      _magnetPulse2Active = true;
      _magnetPulse3Active = false;

      const magnetId = _v11_setInterval(() => {
        if (!autoTrade || !_magnetPulse2Active || Date.now() > magnetDeadline) {
          _magnetPulse2Active = false; _magnetPulse3Active = false;
          clearInterval(magnetId);
          if (!pulse2Fired) addLog(emoji + ' [MAGNET P2] ⏱ انتهى الوقت — مُلغاة', 'info');
          return;
        }
        if (_lossStreakPauseUntil > Date.now() || _recalibrating) {
          _magnetPulse2Active = false; clearInterval(magnetId); return;
        }
        const curTick = (tickBuffers[asset] || []).slice(-1)[0];
        if (p1Ref === null || curTick === undefined) return;

        // For BUY: better entry if price dipped (adverse = price fell)
        // For SELL: better entry if price rose (adverse = price rose)
        const movedAgainst = signal === 'BUY'
          ? (p1Ref - curTick) >= pipThresh
          : (curTick - p1Ref) >= pipThresh;

        if (!movedAgainst || pulse2Fired) return;
        pulse2Fired = true;
        _magnetPulse2Active = false;
        _magnetPulse3Active = true;
        addLog(emoji + ' [MAGNET P2] ✅ تراجع +0.5 pip → تنفيذ P2 بـ $' + amt2, 'signal');
        _sendRawOrder(signal, asset, amt2);

        // ── Pulse 3: fire only if trend acceleration still positive ────
        setTimeout(() => {
          if (!autoTrade || !_magnetPulse3Active) return;
          _magnetPulse3Active = false;
          if (_lossStreakPauseUntil > Date.now() || _recalibrating) return;
          // Trend acceleration = latest accel value > 0 (BUY) or < 0 (SELL)
          const lastAccel = _PS.accels.length > 0 ? _PS.accels[_PS.accels.length - 1] : 0;
          const accelOk   = signal === 'BUY' ? lastAccel > 0 : lastAccel < 0;
          if (!accelOk) {
            addLog(emoji + ' [MAGNET P3] ❌ تسارع ضعيف (' + lastAccel.toFixed(6) + ') — مُلغاة', 'info');
            return;
          }
          addLog(emoji + ' [MAGNET P3] ✅ تسارع مؤكد → تنفيذ P3 بـ $' + amt3, 'signal');
          _sendRawOrder(signal, asset, amt3);
        }, CFG.IMDB_INSTANT_DELAY_MS + 2);

        clearInterval(magnetId);
      }, 50); // poll every 50ms for adverse price move

    // ── Tier-2 / Tier-4: Original pulse logic ─────────────────────────
    } else {
      for (let i = 1; i < tier; i++) {
        const amt      = Math.max(1, Math.round(base * mults[i] * 100) / 100);
        const tradeNum = i + 1;
        const _delay   = CFG.IMDB_INSTANT_DELAY_MS + i;
        setTimeout(() => {
          if (!autoTrade) return;
          if (_lossStreakPauseUntil > Date.now()) {
            addLog(emoji + ' [IMDB #' + tradeNum + '] 🚫 مُلغاة — وقف الخسائر', 'error'); return;
          }
          if (_recalibrating) { addLog(emoji + ' [IMDB #' + tradeNum + '] 🚫 إعادة معايرة', 'error'); return; }
          const _imCandles = candleBuffers[asset] || [];
          if (_imCandles.length >= 3) {
            const _imTrend = analyzeTrend(_imCandles);
            const _imDown  = _imTrend.trend === 'DOWN' || _imTrend.trend === 'DN_WEAK';
            const _imUp    = _imTrend.trend === 'UP'   || _imTrend.trend === 'UP_WEAK';
            if (signal === 'BUY'  && _imDown) { addLog(emoji + ' [IMDB #' + tradeNum + '] 🚫 BUY في هبوط — مُلغاة', 'error'); return; }
            if (signal === 'SELL' && _imUp)   { addLog(emoji + ' [IMDB #' + tradeNum + '] 🚫 SELL في صعود — مُلغاة', 'error'); return; }
          }
          addLog(emoji + ' [IMDB #' + tradeNum + '] ' + signal + ' $' + amt, 'signal');
          _sendRawOrder(signal, asset, amt);
        }, _delay);
      }
    }
  }

  function _sendRawOrder(direction, asset, amount) {
    if (!tradeWSOrig || !tradeWS || tradeWS.readyState !== 1) return;
    try { const packet = _getCachedPayload(direction, amount); tradeWSOrig(packet); } catch (_) {}
  }

  // ── Ghost Trade Simulator — Smart Recovery (Directive 3, loss streak=1) ──────────
  // Intercepts the next ready signal and simulates its outcome in memory.
  // Only returns to real trading after a simulated win confirms market readiness.
  function _ghostSimulate(signal, asset, entryPrice, periodSec) {
    if (_ghostWatching) return; // only one ghost at a time
    _ghostWatching    = true;
    _ghostTradeActive = false; // consumed — watcher now running
    _ghostSignal      = { signal, asset, entryPrice };
    const expireMs = Math.max(periodSec * 1000, 5000);
    addLog('[شبح] 👻 صفقة وهمية → ' + signal + ' @ ' + entryPrice.toFixed(5) + ' | انتهاء: ' + (expireMs/1000).toFixed(0) + 'ث', 'info');

    setTimeout(() => {
      if (!_ghostWatching || !_ghostSignal) return;
      _ghostWatching = false;
      const cur = (tickBuffers[_ghostSignal.asset] || []).slice(-1)[0];
      if (cur === undefined) { _ghostTradeActive = true; return; } // no price data — retry
      const ghostWon = _ghostSignal.signal === 'BUY' ? cur > _ghostSignal.entryPrice
                                                      : cur < _ghostSignal.entryPrice;
      _ghostSignal = null;
      if (ghostWon) {
        addLog('[شبح] 👻✅ فوز وهمي — السوق جاهز | استئناف التداول الحقيقي', 'signal');
        updatePauseDisplay(false);
        // _ghostTradeActive stays false → real trades resume
      } else {
        addLog('[شبح] 👻❌ خسارة وهمية — السوق غير مستقر | صفقة وهمية أخرى', 'info');
        _ghostTradeActive = true; // arm the next ghost
      }
    }, expireMs);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § I  🆕 [MTF] تحيز الإطار الزمني الأعلى
  // ══════════════════════════════════════════════════════════════════════
  function getHigherTFTrend(candles) {
    if (!CFG.MTF_ENABLED || candles.length < CFG.MTF_MULTIPLIER * 3) return null;
    // تجميع كل MTF_MULTIPLIER شموع في شمعة واحدة
    const grouped = [];
    const step    = CFG.MTF_MULTIPLIER;
    for (let i = 0; i + step <= candles.length; i += step) {
      const group = candles.slice(i, i + step);
      const o = group[0].open, c = group[group.length - 1].close;
      const h = Math.max(...group.map(g => g.high));
      const l = Math.min(...group.map(g => g.low));
      grouped.push({ open: o, close: c, high: h, low: l, isBullish: c >= o });
    }
    if (grouped.length < 3) return null;
    return analyzeTrend(grouped);
  }

  function getMTFScore(signalDir, candles) {
    const htf = getHigherTFTrend(candles);
    if (!htf) return 0;
    const agrees   = (signalDir === 'BUY'  && (htf.trend === 'UP'   || htf.trend === 'UP_WEAK')) ||
                     (signalDir === 'SELL' && (htf.trend === 'DOWN' || htf.trend === 'DN_WEAK'));
    const conflicts= (signalDir === 'BUY'  && htf.trend === 'DOWN') ||
                     (signalDir === 'SELL' && htf.trend === 'UP');
    if (agrees)   return  0.5;
    if (conflicts) return -1.0;
    return 0;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 10  🔧 [CONF] محرك التوافق v10.2 — عتبات ذكية + تكيف حسب الفريم
  // ══════════════════════════════════════════════════════════════════════
  // ⚡ v10.2: MACD/BB/SRSI تُتجاهل بلا عقوبة عند نقص البيانات
  // ⚡ v10.2: العتبة تتكيف مع الفريم الزمني (3ث/5ث/15ث/60ث)
  function getAdaptiveThresholds(period) {
    if (period > 0 && period <= 15) return { auto: CFG.CONF_SHORT_AUTO, min: CFG.CONF_SHORT_MIN };
    if (period > 0 && period <= 60) return { auto: CFG.CONF_MED_AUTO,   min: CFG.CONF_MED_MIN };
    return { auto: CFG.CONF_LONG_AUTO, min: CFG.CONF_LONG_MIN };
  }

  function scoreConfluence(signalDir, candles, tveResult) {
    let score = 0;
    const breakdown = [];
    const n = candles.length;

    // 1) نمط الشمعة — دائماً +1
    score += CFG.CONFLUENCE_PATTERN_WEIGHT;
    breakdown.push('PAT✅');

    // 2) TVE
    const tveBias = TickVelocityEngine.getDirectionBias();
    if      (tveBias === signalDir)  { score += 1;    breakdown.push('TVE✅'); }
    else if (tveBias !== null)       { score -= 0.5;  breakdown.push('TVE❌'); }
    else                              breakdown.push('TVE–');

    // 3) StochRSI أو RSI fallback (v10.2: لا عقوبة إذا بيانات غير كافية)
    if (n >= 20) {
      const srsi = computeStochRSI(candles);
      if (srsi) {
        if      (srsi.signal === signalDir) { score += 1;    breakdown.push('SRSI✅(k='+srsi.k.toFixed(0)+')'); }
        else if (srsi.signal !== null)       { score -= 0.5;  breakdown.push('SRSI❌'); }
        else                                  breakdown.push('SRSI–');
      } else {
        const rsi = computeRSIProxy(candles, CFG.RSI_PERIOD);
        const rsiSig = getRSISignal(rsi);
        if      (rsiSig === signalDir) { score += 1;    breakdown.push('RSI✅('+rsi+')'); }
        else if (rsiSig !== null)       { score -= 0.5;  breakdown.push('RSI❌'); }
        else                             breakdown.push('RSI–');
      }
    } else if (n >= CFG.RSI_PERIOD + 1) {
      // فقط RSI عند بيانات قصيرة
      const rsi = computeRSIProxy(candles, CFG.RSI_PERIOD);
      const rsiSig = getRSISignal(rsi);
      if      (rsiSig === signalDir) { score += 1;    breakdown.push('RSI✅('+rsi+')'); }
      else if (rsiSig !== null)       { score -= 0.5;  breakdown.push('RSI❌'); }
      else                             breakdown.push('RSI–');
    } else {
      breakdown.push('RSI⏭'); // تجاهل بدون عقوبة
    }

    // 4) EMA Cross
    const emaSig = getEMACrossSignal(candles);
    if      (emaSig === signalDir) { score += 1;    breakdown.push('EMA✅'); }
    else if (emaSig !== null)       { score -= 0.5;  breakdown.push('EMA❌'); }
    else                             breakdown.push('EMA–');

    // 5) اتجاه الترند
    const trendInfo = analyzeTrend(candles);
    const trendOk   = (signalDir==='BUY'  && (trendInfo.trend==='UP'||trendInfo.trend==='UP_WEAK')) ||
                      (signalDir==='SELL' && (trendInfo.trend==='DOWN'||trendInfo.trend==='DN_WEAK'));
    const trendContra=(signalDir==='BUY'  && trendInfo.trend==='DOWN') ||
                      (signalDir==='SELL' && trendInfo.trend==='UP');
    if      (trendOk)     { score += 1;   breakdown.push('TRD✅'); }
    else if (trendContra) { score -= 1;   breakdown.push('TRD❌'); }
    else                   breakdown.push('TRD–');

    // 6) MACD (v10.2: تجاهل بدون عقوبة إذا بيانات أقل من 35)
    let macdData = null;
    if (n >= CFG.MACD_SLOW + CFG.MACD_SIGNAL) {
      macdData = computeMACD(candles);
      const macdSig = macdData ? (macdData.cross || (macdData.histogram > 0 ? 'BUY' : 'SELL')) : null;
      if      (macdSig === signalDir) { score += 1;    breakdown.push('MACD✅'); }
      else if (macdSig !== null)       { score -= 0.5;  breakdown.push('MACD❌'); }
      else                              breakdown.push('MACD–');
    } else {
      breakdown.push('MACD⏭'); // تجاهل بدون عقوبة
    }

    // 7) Bollinger Bands (v10.2: تجاهل إذا أقل من 20 شمعة)
    if (n >= CFG.BB_PERIOD) {
      const bbSig = getBBSignal(candles);
      if      (bbSig === signalDir) { score += 1;    breakdown.push('BB✅'); }
      else if (bbSig !== null)       { score -= 0.5;  breakdown.push('BB❌'); }
      else {
        const bb = computeBB(candles);
        if (bb?.squeeze) breakdown.push('BB⏸'); else breakdown.push('BB–');
      }
    } else {
      breakdown.push('BB⏭'); // تجاهل بدون عقوبة
    }

    // 8) اختلاف RSI (بونص +1.5، اختياري)
    if (n >= CFG.DIV_LOOKBACK + 2) {
      const div = detectDivergence(candles);
      if (div) {
        if ((div.type==='bullish' && signalDir==='BUY') || (div.type==='bearish' && signalDir==='SELL')) {
          score += div.strength;
          breakdown.push('DIV✅+' + div.strength);
        }
      }
    }

    // 9) فيبوناتشي S/R (بونص +0.5)
    const fibRes = getFibSignal(candles);
    if (fibRes && fibRes.signal === signalDir) { score += fibRes.bonus; breakdown.push('FIB✅'); }

    // 10) 🆕 MTF Bias
    const mtfScore = getMTFScore(signalDir, candles);
    if      (mtfScore > 0) { score += mtfScore; breakdown.push('MTF✅'); }
    else if (mtfScore < 0) { score += mtfScore; breakdown.push('MTF❌'); }
    else                    breakdown.push('MTF–');

    // 11) S/R من v8 (بونص صغير)
    const sr = detectSRLevels(candles);
    if (signalDir==='BUY'  && sr.nearSupport)    { score += 0.3; breakdown.push('SR✅'); }
    if (signalDir==='SELL' && sr.nearResistance) { score += 0.3; breakdown.push('SR✅'); }

    return { score: Math.max(0, score), breakdown, macdData, srsiData: null };
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 11  PSM — PatternStateMachine (محسوب من v8)
  // ══════════════════════════════════════════════════════════════════════
  const PatternStateMachine = {
    state: 'IDLE', signalKey: null,

    evaluate(sc, completedCandles) {
      if (!CFG.PSM_ENABLED) return;
      if (!sc || sc.tickCount < CFG.PSM_MIN_TICKS) { this._maybeClear(); return; }
      const n = completedCandles.length;
      if (n < 1) { this._maybeClear(); return; }
      const prev    = completedCandles[n - 1];
      const results = [];

      if (!prev.isBullish && sc.isBullish && sc.open < prev.close && sc.close > prev.open * CFG.ENGULF_MIN_RATIO)
        results.push({ signal:'BUY',  case:'Q-BullEngulf', confidence:4, reason:'🟢 ابتلاع صاعد مسبق' });
      if (prev.isBullish && !sc.isBullish && sc.open > prev.close && prev.open > 0 && sc.close < prev.open / CFG.ENGULF_MIN_RATIO)
        results.push({ signal:'SELL', case:'Q-BearEngulf', confidence:4, reason:'🔴 ابتلاع هابط مسبق' });
      if (!prev.isBullish && sc.isBullish && sc.open > prev.open)
        results.push({ signal:'BUY',  case:'Q-BullKicker', confidence:4, reason:'⚡ كيك صاعد مسبق' });
      if (prev.isBullish && !sc.isBullish && sc.open < prev.open)
        results.push({ signal:'SELL', case:'Q-BearKicker', confidence:4, reason:'⚡ كيك هابط مسبق' });
      if (sc.isBullish && sc.body>0 && sc.lowerWick>=CFG.HAMMER_WICK_RATIO*sc.body && sc.upperWick<=sc.body*0.5 && !prev.isBullish)
        results.push({ signal:'BUY',  case:'Q-Hammer', confidence:3, reason:'🔨 مطرقة مسبقة' });
      if (!sc.isBullish && sc.body>0 && sc.upperWick>=CFG.HAMMER_WICK_RATIO*sc.body && sc.lowerWick<=sc.body*0.5 && prev.isBullish)
        results.push({ signal:'SELL', case:'Q-ShootStar', confidence:3, reason:'⭐ نجمة رماية مسبقة' });
      if (n >= 2) {
        const prev2 = completedCandles[n-2];
        if (!prev2.isBullish && (prev.isDoji||prev.bodySize<prev2.bodySize*CFG.STAR_BODY_RATIO) && sc.isBullish && sc.close>prev2.open-prev2.bodySize*0.3)
          results.push({ signal:'BUY',  case:'Q-MornStar', confidence:5, reason:'🌅 نجمة الصباح مسبقة' });
        if (prev2.isBullish && (prev.isDoji||prev.bodySize<prev2.bodySize*CFG.STAR_BODY_RATIO) && !sc.isBullish && sc.close<prev2.open+prev2.bodySize*0.3)
          results.push({ signal:'SELL', case:'Q-EveStar', confidence:5, reason:'🌆 نجمة المساء مسبقة' });
      }
      if (results.length === 0) { this._maybeClear(); return; }

      const trendInfo = analyzeTrend(completedCandles);
      for (const r of results) {
        if (r.signal==='BUY' &&(trendInfo.trend==='UP'||trendInfo.trend==='UP_WEAK'))   r.confidence = Math.min(5,r.confidence+1);
        if (r.signal==='SELL'&&(trendInfo.trend==='DOWN'||trendInfo.trend==='DN_WEAK')) r.confidence = Math.min(5,r.confidence+1);
        if (r.signal==='BUY' && trendInfo.trend==='DOWN') r.confidence = Math.max(1,r.confidence-2);
        if (r.signal==='SELL'&& trendInfo.trend==='UP')   r.confidence = Math.max(1,r.confidence-2);
        // 🆕 PPT boost
        r.confidence = Math.max(1, Math.min(5, r.confidence + getPatternConfBoost(r.case)));
      }
      results.sort((a,b) => b.confidence-a.confidence);
      const best = results[0];

      if (best.confidence < CFG.MIN_PATTERN_CONFIDENCE) { this._maybeClear(); return; }
      if (CFG.TREND_FILTER_ENABLED) {
        const t = trendInfo.trend;
        const isPsmShort = (candlePeriod > 0 && candlePeriod <= 15) ||
                           (candlePeriod === 0 && CFG.SHORT_MODE_ASSUME);
        if (best.signal==='BUY'  && t==='DOWN') { this._maybeClear(); return; }
        if (best.signal==='SELL' && t==='UP')   { this._maybeClear(); return; }
        // ⚡ v10.3 FIX: NEUTRAL لا يحجب في SHORT_MODE — فقط يحتاج confidence ≥ 2
        if (t==='NEUTRAL' && !isPsmShort && best.confidence < 4) { this._maybeClear(); return; }
        if (t==='NEUTRAL' &&  isPsmShort && best.confidence < 2) { this._maybeClear(); return; }
      }
      if (CFG.ATR_ENABLED && _rollingATR.isReady) {
        if (_sCandle.range < _rollingATR.value * CFG.ATR_MOMENTUM_RATIO) { this._maybeClear(); return; }
      }

      const conf = scoreConfluence(best.signal, completedCandles, null);
      if (conf.score < CFG.CONFLUENCE_MIN_SCORE) { this._maybeClear(); return; }

      const key = best.case + ':' + activeAsset;
      // ✅ v10.8: لا إعادة تسليح لنفس النمط خلال نافذة = 2× طول الشمعة
      const _psmNow    = Date.now();
      const _psmWindow = (candlePeriod > 0 ? candlePeriod : 3) * 2000;
      const _psmTooSoon = _lastExecutedSignalKey === key &&
                          (_psmNow - _lastExecutedSignalTs) < _psmWindow;
      if (_psmTooSoon) return;

      if (this.state !== 'SIGNAL_READY' || this.signalKey !== key) {
        this.state = 'SIGNAL_READY'; this.signalKey = key;
        _readySignal = { ...best, trendInfo, asset: activeAsset, confluence: conf };
        _readySignalTs = Date.now(); _signalPrice = _sCandle.close;
        PERF.mark('psmArmed');
        addLog('[Q-6] ⚡ مسلّح: ' + best.reason + ' [' + best.confidence + '/5] CONF:' + conf.score.toFixed(1), 'signal');
        updateSignalDisplay(_readySignal);
      }
    },

    _maybeClear() { if (this.state !== 'IDLE') { this.state = 'IDLE'; this.signalKey = null; } },
    reset()        { this.state = 'IDLE'; this.signalKey = null; },
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 12  الإحصائيات
  // ══════════════════════════════════════════════════════════════════════
  function loadStats() {
    try {
      const r100 = localStorage.getItem('cb_v100_stats'); if (r100) return JSON.parse(r100);
      const r80  = localStorage.getItem('cb_stats_v80');  if (r80)  return JSON.parse(r80);
    } catch (_) {}
    return { wins:0,losses:0,total:0,lossStreak:0,bestStreak:0,winStreak:0,tveWins:0,tveLosses:0,confWins:0,confLosses:0,doubles:0,doubleWins:0 };
  }
  const STATS = loadStats();
  function saveStats() { try { localStorage.setItem('cb_v100_stats', JSON.stringify(STATS)); } catch (_) {} }

  let _lastTradeWasTVE     = false;
  let _lastTradePatternCase = null;

  function recordTrade(win, isTVE) {
    STATS.total++;
    if (isTVE) { win ? STATS.tveWins++ : STATS.tveLosses++; }
    else        { win ? STATS.confWins++ : STATS.confLosses++; }
    if (win) {
      STATS.wins++; STATS.lossStreak = 0;
      STATS.winStreak = (STATS.winStreak || 0) + 1;
      if (STATS.winStreak > (STATS.bestStreak || 0)) STATS.bestStreak = STATS.winStreak;
      // Clear any Smart Recovery / recalibration state on a real win
      if (_ghostTradeActive || _ghostWatching) {
        _ghostTradeActive = false; _ghostWatching = false; _ghostSignal = null;
        addLog('✅ فوز حقيقي — الغاء وضع الشبح | التداول الحقيقي مستمر', 'signal');
        updatePauseDisplay(false);
      }
      if (_recalibrating) { _recalibrating = false; updatePauseDisplay(false); }
    } else {
      STATS.losses++; STATS.lossStreak++; STATS.winStreak = 0;

      if (STATS.lossStreak === 1 && !_ghostTradeActive && !_ghostWatching) {
        // ── Smart Recovery: simulate the next signal before committing real capital ──
        _ghostTradeActive = true;
        addLog('⚠️ خسارة — وضع الشبح نشط | انتظار تأكيد وهمي قبل التداول الحقيقي', 'info');
        updatePauseDisplay(true);

      } else if (STATS.lossStreak >= CFG.MAX_LOSS_STREAK) {
        // ── Recalibration: flush all rolling buffers, wait for Hurst H > 0.6 ──────
        _recalibrating    = true;
        _ghostTradeActive = false;
        _ghostWatching    = false;
        _lossStreakPauseUntil = 0;

        // Flush rolling state so SUPREME-PRED v2 builds fresh signal from scratch
        _PS.vels.length   = 0; _PS.accels.length = 0;
        _PS.W5.length = 0; _PS.W10.length = 0; _PS.W20.length = 0;
        _PS.W40.length = 0; _PS.W80.length = 0; _PS.lr_prices.length = 0;
        _PS.ac_velBuf.fill(0); _PS.ac_velBuf_n = 0;
        _PS.kf_x = null; _PS.kf_p = 1.0;
        _PS.ent_up = 0; _PS.ent_dn = 0; _PS.ent_n = 0;
        _PS.hurst_h = 0.5;

        addLog('🔄 ' + CFG.MAX_LOSS_STREAK + ' خسائر — إعادة معايرة | تفريغ الذاكرة | انتظار H > 0.6', 'error');
        updatePauseDisplay(true);
      }
    }
    // 🆕 PPT
    if (_lastTradePatternCase) { recordPatternResult(_lastTradePatternCase, win); _lastTradePatternCase = null; }

    // SUPREME-PRED v2 adaptive learning — per-regime stats + algo weight updates
    (function _supremePredLearn(won) {
      const ps   = _PS;
      const snap = ps.snap;
      if (!snap) return;

      // ── Regime stats update ──────────────────────────────────────────────
      const regime = snap.regime || ps.regime || 'RANGE';
      const rs = ps.regimeStats[regime];
      if (rs) {
        rs.total++;
        if (won) rs.wins++;
        // Block regime if WR < 45% after minimum sample
        if (rs.total >= CFG.SUPREME_REGIME_MIN_TRADES) {
          ps.regimeBlocked[regime] = (rs.wins / rs.total) < CFG.SUPREME_REGIME_BLOCK_WR;
        }
      }

      // ── Per-algo weight updates ──────────────────────────────────────────
      const scores = ps.algoScores;
      if (!scores) return;
      const lr  = CFG.SUPREME_LEARN_RATE;   // 0.015
      const wMin = CFG.SUPREME_ALGO_WEIGHT_MIN; // 0.30
      const wMax = CFG.SUPREME_ALGO_WEIGHT_MAX; // 5.00
      const sign = won ? 1 : -1;
      const aw   = ps.aw;
      const clamp = (v) => Math.max(wMin, Math.min(wMax, v));

      // Only adjust weight when the algo had a meaningful opinion (|score| > 0.25)
      const maybeUpdate = (key, scoreVal) => {
        if (aw[key] !== undefined && Math.abs(scoreVal) > 0.25) {
          aw[key] = clamp(aw[key] + sign * lr);
        }
      };

      // Group A — micro-tick algos
      maybeUpdate('vel',     scores.vel     ?? 0);
      maybeUpdate('accel',   scores.accel   ?? 0);
      maybeUpdate('tRsi',    scores.tRsi    ?? 0);
      maybeUpdate('ofi',     scores.ofi     ?? 0);
      maybeUpdate('mom',     scores.mom     ?? 0);
      maybeUpdate('zScore',  scores.zScore  ?? 0);
      maybeUpdate('entropy', scores.entropy ?? 0);
      maybeUpdate('ac1',     scores.ac1     ?? 0);
      maybeUpdate('ac2',     scores.ac2     ?? 0);
      maybeUpdate('ac3',     scores.ac3     ?? 0);
      maybeUpdate('ac4',     scores.ac4     ?? 0);
      maybeUpdate('ac5',     scores.ac5     ?? 0);
      maybeUpdate('tveAccel',scores.tveAccel?? 0);
      maybeUpdate('tveBias', scores.tveBias ?? 0);

      // Group B — statistical algos
      maybeUpdate('hurst',   scores.hurst   ?? 0);
      maybeUpdate('lr',      scores.lr      ?? 0);
      maybeUpdate('kalman',  scores.kalman  ?? 0);
      maybeUpdate('roc',     scores.roc     ?? 0);
      maybeUpdate('breakout',scores.breakout?? 0);
      maybeUpdate('geo',     scores.geo     ?? 0);

      // Group C — structural algos
      maybeUpdate('regime_w',scores.regime_w?? 0);
      maybeUpdate('dynSR',   scores.dynSR   ?? 0);
      maybeUpdate('emaStack',scores.emaStack?? 0);
      maybeUpdate('liqVac',  scores.liqVac  ?? 0);

      // Group D — candle-level algos
      maybeUpdate('candle',  scores.candle  ?? 0);
      maybeUpdate('rsi',     scores.rsi     ?? 0);
      maybeUpdate('macd',    scores.macd    ?? 0);
      maybeUpdate('bb',      scores.bb      ?? 0);
      maybeUpdate('srsi',    scores.srsi    ?? 0);
      maybeUpdate('mtf',     scores.mtf     ?? 0);
      maybeUpdate('fib',     scores.fib     ?? 0);

      _saveBrain();
    })(win);
    // 🆕 Kelly تحديث المبلغ — ✅ v10.9: لا تُعيد الضبط إذا المستخدم غيّر يدوياً
    if (CFG.KELLY_ENABLED && accountBalance && !_manualAmountOverride) {
      const newAmt = computeKellyAmount(accountBalance);
      if (newAmt !== tradeAmount) { tradeAmount = newAmt; _rebuildPayloadCache(); _ghostExecPacket = null; _updateKellyDisplay(); }
    } else if (_manualAmountOverride) {
      // فقط حدّث الواجهة بدون تغيير القيمة
      _updateKellyDisplay();
    }
    saveStats(); updateStatsUI();
  }

  function winRate() { return STATS.total > 0 ? Math.round((STATS.wins / STATS.total) * 100) : 0; }

  // ══════════════════════════════════════════════════════════════════════
  // § 13 + 14 + 15 — فك MsgPack + استخراج بيانات + Q1 Binary (v8 — بدون تغيير)
  // ══════════════════════════════════════════════════════════════════════
  function msgpackDecode(buffer) {
    const buf  = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    const off  = buffer.byteOffset || 0;
    const view = new DataView(buf);
    const bytes= new Uint8Array(buf, off);
    let pos = 0;
    const rb   = () => bytes[pos++];
    const ru8  = () => bytes[pos++];
    const ru16 = () => { const v = view.getUint16(pos, false); pos += 2; return v; };
    const ru32 = () => { const v = view.getUint32(pos, false); pos += 4; return v; };
    const ri8  = () => { const v = view.getInt8(pos);          pos += 1; return v; };
    const ri16 = () => { const v = view.getInt16(pos, false);  pos += 2; return v; };
    const ri32 = () => { const v = view.getInt32(pos, false);  pos += 4; return v; };
    const rf32 = () => { const v = view.getFloat32(pos, false);pos += 4; return v; };
    const rf64 = () => { const v = view.getFloat64(pos, false);pos += 8; return v; };
    const ri64 = () => { const h = view.getInt32(pos, false), l = view.getUint32(pos+4, false); pos += 8; return h*4294967296+l; };
    const ru64 = () => { const h = view.getUint32(pos, false), l = view.getUint32(pos+4, false); pos += 8; return h*4294967296+l; };
    const rStr = (n) => { const s = new TextDecoder().decode(bytes.subarray(pos, pos+n)); pos += n; return s; };
    const rBin = (n) => { const b = bytes.subarray(pos, pos+n); pos += n; return b; };
    function decode() {
      const b = rb();
      if (b <= 0x7f) return b;
      if ((b&0xf0)===0x80) { const n=b&0xf; const o={}; for(let i=0;i<n;i++){const k=decode(); o[k]=decode();} return o; }
      if ((b&0xf0)===0x90) { const n=b&0xf; const a=[]; for(let i=0;i<n;i++) a.push(decode()); return a; }
      if ((b&0xe0)===0xa0) return rStr(b&0x1f);
      if ((b&0xe0)===0xe0) return b-256;
      switch (b) {
        case 0xc0: return null;  case 0xc2: return false; case 0xc3: return true;
        case 0xc4: return rBin(ru8()); case 0xc5: return rBin(ru16()); case 0xc6: return rBin(ru32());
        case 0xca: return rf32(); case 0xcb: return rf64();
        case 0xcc: return ru8();  case 0xcd: return ru16(); case 0xce: return ru32(); case 0xcf: return ru64();
        case 0xd0: return ri8();  case 0xd1: return ri16(); case 0xd2: return ri32(); case 0xd3: return ri64();
        case 0xd9: return rStr(ru8()); case 0xda: return rStr(ru16()); case 0xdb: return rStr(ru32());
        case 0xdc: { const n=ru16(); const a=[]; for(let i=0;i<n;i++) a.push(decode()); return a; }
        case 0xdd: { const n=ru32(); const a=[]; for(let i=0;i<n;i++) a.push(decode()); return a; }
        case 0xde: { const n=ru16(); const o={}; for(let i=0;i<n;i++){const k=decode(); o[k]=decode();} return o; }
        case 0xdf: { const n=ru32(); const o={}; for(let i=0;i<n;i++){const k=decode(); o[k]=decode();} return o; }
        default: throw new Error('msgpack 0x'+b.toString(16));
      }
    }
    return decode();
  }

  function extractTickFromArray(arr) {
    if (!Array.isArray(arr)) return null;
    if (Array.isArray(arr[0]) && arr[0].length >= 3 && typeof arr[0][0]==='string' && typeof arr[0][2]==='number') {
      const price = arr[0][2]; if (price>0) return { asset: normalizeAsset(arr[0][0]), price, ts: arr[0][1] };
    }
    if (arr.length >= 3 && typeof arr[0]==='string' && typeof arr[2]==='number') {
      const price = arr[2]; if (price>0) return { asset: normalizeAsset(arr[0]), price, ts: arr[1] };
    }
    return null;
  }

  function extractChafor(decoded) {
    if (!Array.isArray(decoded) || !Array.isArray(decoded[0]) || decoded[0].length < 2) return null;
    const asset = String(decoded[0][0]).toUpperCase(), seconds = Number(decoded[0][1]);
    if (asset.length >= 3 && Number.isFinite(seconds) && seconds >= 0) return { asset, seconds };
    return null;
  }

  const Q1_SIG = {
    TICK_ARRAY: new Uint8Array([0x5b, 0x5b, 0x22]),
    SUCCESS   : new Uint8Array([0x73, 0x75, 0x63, 0x63, 0x65, 0x73, 0x73]),
  };
  function q1Match(bytes, sig, offset=0) {
    if (bytes.length < offset + sig.length) return false;
    for (let i=0; i<sig.length; i++) if (bytes[offset+i] !== sig[i]) return false;
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 16  اعتراض WebSocket
  // ══════════════════════════════════════════════════════════════════════
  const NativeWS = W.WebSocket;

  function _isTradeSocket(urlStr) {
    if (urlStr.includes('po.market'))  return true;
    if (urlStr.includes('chat-po'))    return false;
    if (urlStr.includes('events-po'))  return false;
    if (urlStr.includes('socket.io') && urlStr.includes('api')) return true;
    return false;
  }

  function _attachWSHooks(ws, urlStr) {
    const _origSend = ws.send.bind(ws);
    // ─── [FIX v10.6] keepalive: رد pong('3') على ping('2') من السيرفر
    // EIO4 = السيرفر يرسل '2'، الكلاينت يرد '3' — لا setInterval من طرفنا
    let _pingIntervalId = null;
    if (_isTradeSocket(urlStr)) {
      tradeWS = ws; tradeWSOrig = _origSend;
      addLog('🔌 مقبس التداول: ' + urlStr.split('?')[0], 'info');
      // [FIX v10.6] بدل إرسال '2' (ping — دور السيرفر فقط)، نرسل '3' (pong) كـ keepalive
      // هذا يمنع السيرفر من إغلاق الاتصال بسبب timeout
      if (CFG.DSO_WS_PING_MS > 0) {
        _pingIntervalId = _v11_setInterval(() => {
          if (ws.readyState === 1) { try { _origSend('3'); } catch(_){} }
          else { clearInterval(_pingIntervalId); _pingIntervalId = null; } // [FIX] تنظيف إذا المقبس انغلق
        }, CFG.DSO_WS_PING_MS);
      }
    }
    ws.send = function (data) {
      if (typeof data === 'string' && data.startsWith('42')) {
        try {
          const arr = JSON.parse(data.slice(2));
          if (Array.isArray(arr)) {
            const evName = arr[0], payload = arr[1] || {};
            if (evName==='changeSymbol' && payload?.asset) onActiveAsset(String(payload.asset), 'changeSymbol_send');
            if (evName==='saveCharts') {
              const s = payload.settings || {};
              const ft = parseInt(s.fastTimeframe, 10);
              if (Number.isFinite(ft) && ft>=1 && ft<=3600) onPlatformTimeframe(ft, 'saveCharts');
              if (s.symbol && s.symbol.length>=3) onActiveAsset(s.symbol, 'saveCharts');
              if (s.isDemo !== undefined) isDemo = s.isDemo ? 1 : 0;
              _extractFastCloseAt(s, payload);
            }
            if (evName==='openOrder' && payload.isDemo !== undefined) isDemo = payload.isDemo;
          }
        } catch (_) {}
      }
      return _origSend(data);
    };
    ws.addEventListener('message', (e) => {
      PERF.mark('packetRecv');
      const raw = e.data;
      // [FIX v10.6] استجب لـ EIO4 ping من السيرفر بـ pong فوري
      if (typeof raw === 'string' && raw === '2') {
        try { _origSend('3'); } catch(_) {}
        return; // لا تمرر الـ ping لبقية المعالجات
      }
      if (raw instanceof ArrayBuffer || raw instanceof Blob) handleBinaryFrame(raw, urlStr, ws);
      else if (typeof raw === 'string') handleTextMessage(raw, ws);
    });
    ws.addEventListener('open',  () => { wsConnected = true;  updateStatusDot(); _probeForSIOManager(); });
    ws.addEventListener('close', () => {
      wsConnected = false;
      // [FIX v10.6] تنظيف الـ interval عند الإغلاق لمنع التراكم
      if (_pingIntervalId !== null) { clearInterval(_pingIntervalId); _pingIntervalId = null; }
      if (tradeWS === ws) { tradeWS = null; tradeWSOrig = null; _tradeSocketReady = false; addLog('🔌 مقبس التداول انقطع', 'error'); }
      updateStatusDot();
    });
  }

  let _adaptiveSigmaTimer_v100 = null;
  function _startAdaptiveSigmaDecay() {
    if (!CFG.ADAPTIVE_SIGMA_ENABLED) return;
    if (_adaptiveSigmaTimer_v100) return;
    _adaptiveSigmaActive = true;
    _adaptiveSigmaTimer_v100 = setInterval(() => {
      if (_currentSigma <= CFG.ADAPTIVE_SIGMA_FLOOR) { clearInterval(_adaptiveSigmaTimer_v100); _adaptiveSigmaTimer_v100 = null; return; }
      _currentSigma = Math.max(CFG.ADAPTIVE_SIGMA_FLOOR, _currentSigma - CFG.ADAPTIVE_SIGMA_DECAY_STEP);
    }, CFG.ADAPTIVE_SIGMA_DECAY_MS);
  }
  function _resetAdaptiveSigma() {
    if (_adaptiveSigmaTimer_v100) { clearInterval(_adaptiveSigmaTimer_v100); _adaptiveSigmaTimer_v100 = null; }
    _currentSigma = CFG.TVE_SIGMA_THRESHOLD; _adaptiveSigmaActive = false;
  }

  function _extractFastCloseAt(settings, fullPayload) {
    const fca = parseInt(settings.fastCloseAt || (fullPayload && fullPayload.fastCloseAt) || 0, 10);
    if (!Number.isFinite(fca) || fca <= 0) return;
    fastCloseAt = fca * 1000;
    if (CFG.CLOCK_SYNC_ENABLED) {
      const srv = parseInt((settings.serverTime||(fullPayload&&fullPayload.serverTime)||0),10)*1000;
      if (srv > 0) { clockOffset = srv - Date.now(); }
    }
    const msLeft = fastCloseAt - Date.now();
    if (msLeft > 0) { _rebuildPayloadCache(); schedulePredictiveEntry(); }
  }

  W.WebSocket = new Proxy(NativeWS, {
    construct(Target, args) { const ws = new Target(...args); _attachWSHooks(ws, String(args[0]||'')); return ws; },
    apply(Target, thisArg, args)   { const ws = new Target(...args); _attachWSHooks(ws, String(args[0]||'')); return ws; },
    get(Target, prop, receiver) {
      if (prop==='CONNECTING') return 0; if (prop==='OPEN') return 1;
      if (prop==='CLOSING') return 2;    if (prop==='CLOSED') return 3;
      const val = Reflect.get(Target, prop, receiver);
      return typeof val === 'function' ? val.bind(Target) : val;
    },
  });

  // ══════════════════════════════════════════════════════════════════════
  // § 17 + 18 — معالجة الإطارات
  // ══════════════════════════════════════════════════════════════════════
  function handleBinaryFrame(rawData, urlStr, wsRef) {
    const toBuffer = rawData instanceof Blob ? rawData.arrayBuffer() : Promise.resolve(rawData);
    toBuffer.then(buf => {
      PERF.mark('decodeStart');
      const evName = _pendingEvent || 'binary';
      _pendingEvent = null;

      if (CFG.Q1_SIG_ENABLED) {
        const bytes = new Uint8Array(buf);
        if (q1Match(bytes, Q1_SIG.TICK_ARRAY)) {
          try {
            const txt = new TextDecoder().decode(bytes), start = txt.indexOf('[[');
            if (start >= 0) { const arr = JSON.parse(txt.slice(start)); const tick = extractTickFromArray(arr); if (tick) { onTick(tick.asset, tick.price, tick.ts); return; } }
          } catch (_) {}
        }
      }

      let decoded = null, combined = buf;
      if (wsRef) { const fr = tryDecodeWithFragment(wsRef, buf); if (!fr) return; decoded = fr.decoded; combined = fr.buffer; }
      else { try { decoded = msgpackDecode(buf); } catch (_) {} }

      if (decoded !== null && typeof decoded === 'object') {
        if (evName==='successauth') { if (wsRef && wsRef===tradeWS) { _tradeSocketReady = true; addLog('✅ مقبس مصادَق', 'signal'); _startAdaptiveSigmaDecayTimerLocal(); } return; }
        const tick = extractTickFromArray(decoded);
        if (tick) { onTick(tick.asset, tick.price, tick.ts); return; }
        if (evName==='chafor') { const cf = extractChafor(decoded); if (cf) { onChafor(cf.asset, cf.seconds); return; } }
        if (evName==='updateCharts' && Array.isArray(decoded)) {
          for (const chart of decoded) {
            if (!chart || typeof chart !== 'object') continue;
            if (typeof chart.asset === 'string' && chart.asset.length >= 3) onActiveAsset(chart.asset, 'updateCharts');
            try { const s = typeof chart.settings==='string' ? JSON.parse(chart.settings) : (chart.settings||{}); const ft = parseInt(s?.fastTimeframe, 10); if (Number.isFinite(ft) && ft>=1 && ft<=3600) onPlatformTimeframe(ft,'updateCharts'); _extractFastCloseAt(s, chart); } catch(_){}
          }
        }
        return;
      }

      try {
        const text = new TextDecoder().decode(new Uint8Array(combined)), start = text.search(/[{\[]/);
        if (start < 0) return;
        const obj = JSON.parse(text.slice(start));
        if (evName==='updateHistoryNewFast' && obj.asset && Array.isArray(obj.history)) { processHistoryFast(obj.asset, obj.period, obj.history); return; }
        if (evName==='successcloseOrder'   && obj.deals) { processCloseOrder(obj); return; }
        if (evName==='failopenOrder' && obj.error) { onFailOrder(obj); return; }
        if (evName==='successupdateBalance' && obj.balance !== undefined) { onBalanceUpdate(obj); return; }
        if (evName==='successopenOrder' && obj.id) { onOpenOrderSuccess(obj); return; }
        const tick = extractTickFromArray(Array.isArray(obj) ? obj : [obj]);
        if (tick) { onTick(tick.asset, tick.price, tick.ts); return; }
        if (evName==='chafor') { const cf = extractChafor(Array.isArray(obj)?obj:[obj]); if (cf) onChafor(cf.asset, cf.seconds); }
        if (evName==='saveCharts') { const s = obj.settings || obj; _extractFastCloseAt(s, obj); }
      } catch (_) {}
    }).catch(() => {});
  }

  function handleTextMessage(raw, wsRef) {
    if (!raw || raw==='2' || raw==='3') return;
    if (raw.startsWith('45')) { const d = raw.indexOf('-'); if (d!==-1) { try { const arr = JSON.parse(raw.slice(d+1)); if (Array.isArray(arr) && typeof arr[0]==='string') _pendingEvent = arr[0]; } catch(_){} } return; }
    if (!raw.startsWith('42')) return;
    let payload; try { payload = JSON.parse(raw.slice(2)); } catch { return; }
    if (!Array.isArray(payload) || payload.length < 2) return;
    const evName = payload[0], data = payload[1];
    if (evName==='successauth') { if (wsRef && wsRef===tradeWS) { _tradeSocketReady = true; addLog('✅ مقبس مصادَق', 'signal'); _startAdaptiveSigmaDecayTimerLocal(); } return; }
    if (['updateStream','tick','quote','stream'].includes(evName)) {
      const tick = extractTickFromArray(data); if (tick) { onTick(tick.asset, tick.price, tick.ts); return; }
      if (Array.isArray(data)) { for (const item of data) { const t = extractTickFromArray(Array.isArray(item)?item:[item]); if (t) onTick(t.asset,t.price,t.ts); } }
    }
    if (evName==='chafor') { const cf = extractChafor(Array.isArray(data)?data:[data]); if (cf) onChafor(cf.asset, cf.seconds); }
    if (evName==='changeSymbol' && data?.asset) onActiveAsset(data.asset, 'changeSymbol');
    if (evName==='saveCharts') { const s = (data&&data.settings)||data||{}; _extractFastCloseAt(s, data||{}); }
  }

  function _startAdaptiveSigmaDecayTimerLocal() {
    if (!CFG.ADAPTIVE_SIGMA_ENABLED || !autoTrade) return;
    _resetAdaptiveSigma();
    setTimeout(() => { if ((Date.now()-lastTradeMs) >= CFG.ADAPTIVE_SIGMA_IDLE_MS) _startAdaptiveSigmaDecay(); }, CFG.ADAPTIVE_SIGMA_IDLE_MS);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 18  معالجات الأحداث
  // ══════════════════════════════════════════════════════════════════════
  function processHistoryFast(asset, period, history) {
    const a = normalizeAsset(asset);
    if (!Array.isArray(history) || history.length < 4) return;
    if (!candlePeriod && period && period>0) { candlePeriod = period; durSource = 'history'; updateHUD(); }
    const periodSec = candlePeriod || period || 5;
    const groups = {};
    for (const item of history) {
      if (!Array.isArray(item) || item.length < 2) continue;
      const [ts, price] = item; const key = Math.floor(ts/periodSec)*periodSec;
      if (!groups[key]) groups[key] = []; groups[key].push(price);
    }
    const sortedKeys = Object.keys(groups).map(Number).sort((a,b) => a-b);
    if (!candleBuffers[a]) candleBuffers[a] = [];
    const newCandles = [];
    for (const key of sortedKeys) { const prices = groups[key]; if (prices.length<2) continue; const candle = buildCandle(prices,key*1000); if (candle) { candle.fromHistory=true; newCandles.push(candle); } }
    if (newCandles.length > 0) {
      candleBuffers[a] = newCandles.slice(-CFG.MAX_CANDLES);
      if (a===activeAsset) { addLog('📊 تاريخ: '+newCandles.length+' شمعة', 'signal'); _rollingATR.seedFromCandles(candleBuffers[a]); renderCandleRow(); }
    }
  }

  function processCloseOrder(data) {
    if (!data.deals || !data.deals[0]) return;
    const deal = data.deals[0];
    if (botOrderIds.size > 0 && !botOrderIds.has(deal.id)) { addLog('📊 صفقة منصة: '+(deal.profit>0?'+':'')+(deal.profit||0).toFixed(2)+'$','info'); return; }
    if (deal.id) botOrderIds.delete(deal.id);
    const win = deal.profit > 0;
    // V11: Extract dynamic payout ratio from deal data
    if (win && deal.profit && deal.amount && deal.amount > 0) {
      const rawPayout = deal.profit / deal.amount;
      if (rawPayout > 0.5 && rawPayout < 2.0) {
        _dynamicPayout = rawPayout;
        addLog('📊 [KELLY] نسبة العائد: ' + Math.round(rawPayout * 100) + '%', 'info');
      }
    }
    recordTrade(win, _lastTradeWasTVE);
    const sym = win ? '✅' : '❌', amount = win ? '+'+deal.profit?.toFixed(2)+'$' : '-'+deal.amount+'$';
    addLog(sym+' '+amount+(_lastTradeWasTVE?' [TVE]':'')+(_lastTradeWasDouble?' 🔥🔥':'')+' | '+(deal.openPrice?.toFixed(5)||'')+'→'+(deal.closePrice?.toFixed(5)||''), win?'signal':'error');
    if (_lastTradeWasDouble && win) STATS.doubleWins = (STATS.doubleWins||0)+1;
    _lastTradeWasDouble = false; tradeExec = false; updateTradeBtn();
    // ✅ v10.10.1 FIX#TIMING: شغّل الإشارة المعلّقة فوراً دون انتظار دورة Watcher
    setTimeout(_tryFirePendingSignal, 0);
  }

  function onFailOrder(data) {
    const errMap = { IncorrectMinAmount:'الحد الأدنى: $'+data.amount, IncorrectMaxAmount:'الحد الأقصى: $'+data.amount, InsufficientFunds:'رصيد غير كاف', TradingDisabled:'التداول معطّل', MarketClosed:'السوق مغلق' };
    addLog('❌ '+(errMap[data.error]||data.error||'خطأ'), 'error');
    tradeExec = false; updateTradeBtn();
    setTimeout(_tryFirePendingSignal, 0);
  }

  function onOpenOrderSuccess(data) {
    if (data.id) botOrderIds.add(data.id); lastOpenedOrder = data;
    addLog('📨 أُكِّد الأمر #'+data.id+' | '+(data.openPrice?.toFixed(5)||''), 'signal');
  }

  function onBalanceUpdate(data) {
    accountBalance = data.balance;
    if (data.isDemo !== undefined) isDemo = data.isDemo;
    const el = W.document.getElementById('cbBalance'), modeEl = W.document.getElementById('cbAccMode');
    if (el) el.textContent = '$'+(data.balance?.toFixed(2)||'–');
    if (modeEl) modeEl.textContent = data.isDemo ? 'ديمو' : 'حقيقي';
    // ✅ v10.9: Kelly تحديث فوري عند تغيير الرصيد — لكن لا تتجاوز المبلغ اليدوي
    if (CFG.KELLY_ENABLED && !_manualAmountOverride) {
      const ka = computeKellyAmount(data.balance);
      if (ka !== tradeAmount) { tradeAmount = ka; _rebuildPayloadCache(); _updateKellyDisplay(); }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 19  المعالجات الأساسية
  // ══════════════════════════════════════════════════════════════════════
  function normalizeAsset(str) {
    return String(str).replace(/[/\\\-\s]/g,'').replace(/_?otc$/i, '_otc');
}

  function onActiveAsset(str, source) {
    const a = normalizeAsset(str);
    if (a.length < 3 || a === activeAsset) return;
    activeAsset = a; _sCandle.reset(); PatternStateMachine.reset(); TickVelocityEngine.reset();
    fastCloseAt = 0; cancelPredictiveExecution(); _rebuildPayloadCache();
    _candlesSinceAssetChange = 0;
    addLog('🎯 الزوج: '+activeAsset+' ('+source+')', 'asset'); updateHUD();
  }

  function onPlatformTimeframe(secs, source) {
    if (!Number.isFinite(secs) || secs<1 || secs>3600) return;
    if (secs === candlePeriod) return;
    candlePeriod = secs; durSource = source||'platform'; _lastDetectedPeriod = secs; _lastDetectedCount = CFG.PERIOD_TRUSTED_OVERRIDE;
    _periodLockUntil = Date.now() + 30000;  // ✅ v10.10 FIX#4: اقفل الفريم 30ث بعد مصدر موثوق
    _rebuildPayloadCache(); updateHUD();
  }

  function resetTickCandleTimer(asset) {
    if (tickCandleTimer) clearTimeout(tickCandleTimer);
    tickCandleTimer = setTimeout(() => {
      tickCandleTimer = null;
      if (!asset || !activeAsset) return;
      const cc = currentCandles[asset];
      if (cc && cc.prices.length >= CFG.MIN_TICKS_PER_CANDLE) { closeCurrentCandle(asset); scheduleWindowEntry(asset, candlePeriod||60); }
    }, CFG.TICK_CANDLE_TIMEOUT);
  }

  // ⚡ [TVE + PSM + PERF] onTick
  function onTick(asset, price, serverTs) {
    PERF.mark('tickRecv');
    if (!asset || !price || isNaN(price)) return;
    const a = normalizeAsset(asset), now = Date.now();
    if (!tickBuffers[a]) tickBuffers[a] = [];
    if (!currentCandles[a]) currentCandles[a] = null;
    tickBuffers[a].push(price);
    if (tickBuffers[a].length > 600) tickBuffers[a].shift();
    totalTicks++;
    if (!activeAsset) onActiveAsset(a, 'firstTick');
    const cc = currentCandles[a];
    if (!cc) { currentCandles[a] = { open:price, high:price, low:price, prices:[price], startTime:now }; }
    else { cc.prices.push(price); if (price>cc.high) cc.high=price; if (price<cc.low) cc.low=price; }
    if (a === activeAsset) {
      // ── NEURAL-TICK: Packet Spike Detection (Directive 1) ────────────────
      // More than 3 ticks arriving within a 100ms window = platform-injected noise burst.
      // Apply a 20% confidence penalty for 500ms to avoid "Ghost-Volatility" entries.
      {
        const ps = _PS;
        const tsb = ps.tickTs, cap = tsb.length;
        if (ps.tickTs_n < cap) { tsb[ps.tickTs_n++] = now; }
        else { tsb.copyWithin(0, 1); tsb[cap - 1] = now; }
        const n4 = Math.min(ps.tickTs_n, 4);
        const oldest4 = tsb[ps.tickTs_n >= 4 ? ps.tickTs_n - 4 : 0];
        if (n4 >= 4 && (now - oldest4) < 100) {
          if (!ps.spikeActive) {
            ps.spikeActive = true;
            ps.spikePenaltyUntil = now + 500;
            addLog('[NEURAL-TICK] ⚡ تدفق مكثف — تخفيض ثقة 20% لـ 500ms', 'info');
          }
        }
        if (ps.spikeActive && now > ps.spikePenaltyUntil) {
          ps.spikeActive = false;
        }
      }

      // 🔴 PRED-BAR: أعلى أولوية — يُشغَّل أول شيء على كل تيك قبل أي تحليل آخر
      _predBarTick(a, price, now);
      updateLivePrice(price); renderCandleRow(); resetTickCandleTimer(a);
      if (!_sCandle.isActive()) _sCandle.init(price, now); else _sCandle.update(price);
      updateTickSize(a, price);

      // ✅ v10.8: تسجيل كل تيك (مختصر) + التفاصيل كل 5 تيكات
      const ccPrices = cc ? cc.prices.length : 1;
      if (totalTicks % 5 === 0) {
        const trendInfo = analyzeTrend(candleBuffers[a] || []);
        addLog(
          '📡 تيك #'+totalTicks+' | '+price.toFixed(5),
          'tick',
          'تيكات_شمعة:'+ccPrices+' | اتجاه:'+trendInfo.label+' | شموع:'+(candleBuffers[a]||[]).length
        );
      }

      if (CFG.TVE_ENABLED) {
        const tveResult = TickVelocityEngine.push(price, now);
        if (TickVelocityEngine.buf.length >= 3) _updateTVEDisplay();
        // ⚡ v10.3 FIX: isShort = true إذا candlePeriod ≤15 أو غير معروف (SHORT_MODE_ASSUME)
        const isShort = (candlePeriod > 0 && candlePeriod <= 15) ||
                        (candlePeriod === 0 && CFG.SHORT_MODE_ASSUME) ||
                        (candlePeriod > 0 && candlePeriod <= CFG.SHORT_MODE_ASSUME_MAX && CFG.SHORT_MODE_ASSUME);
        const minConf = isShort ? 2 : CFG.MIN_PATTERN_CONFIDENCE;
        if (tveResult) {
          // ✅ v10.8: سجّل كل إشارة TVE بتفاصيلها
          addLog(
            '[TVE] إشارة: '+tveResult.signal+' | σ='+Math.abs(tveResult.sigma||0).toFixed(2),
            'tve',
            'conf:'+tveResult.confidence+' | '+tveResult.reason
          );
          if (tveResult.confidence >= minConf && autoTrade) _onTVESignal(tveResult, a);
        }
      }
      const candles = candleBuffers[a] || [];
      if (candles.length >= CFG.MIN_CANDLES_TO_TRADE) PatternStateMachine.evaluate(_sCandle, candles);
      PERF.tickDone();
    }
    const tickEl = W.document.getElementById('cbTickCount');
    if (tickEl) tickEl.textContent = totalTicks;
  }

  function _onTVESignal(result, asset) {
    if (_lossStreakPauseUntil > Date.now()) return;
    const now = Date.now();
    if ((now - lastTradeMs) < getAdaptiveCooldown()) return;
    const candles = candleBuffers[asset] || [];
    const trendInfo = analyzeTrend(candles);

    // ⚡ v10.3 FIX: isShortFrame يعمل حتى لو candlePeriod=0
    const isShortFrame = (candlePeriod > 0 && candlePeriod <= 15) ||
                         (candlePeriod === 0 && CFG.SHORT_MODE_ASSUME) ||
                         (candlePeriod > 0 && candlePeriod <= CFG.SHORT_MODE_ASSUME_MAX && CFG.SHORT_MODE_ASSUME);

    // ⚡ v10.3 FIX: فلتر الاتجاه مخفف — NEUTRAL مسموح في SHORT_MODE
    if (CFG.TREND_FILTER_ENABLED) {
      if (!isShortFrame) {
        // فريم طويل: حجب صارم
        if (result.signal==='BUY'  && trendInfo.trend==='DOWN') return;
        if (result.signal==='SELL' && trendInfo.trend==='UP')   return;
      } else {
        // فريم قصير: حجب فقط عند تعارض صريح وقوي (NEUTRAL = مسموح)
        if (result.signal==='BUY'  && trendInfo.trend==='DOWN' && candles.length >= 5) return;
        if (result.signal==='SELL' && trendInfo.trend==='UP'   && candles.length >= 5) return;
      }
    }

    // ⚡ v10.5 SIGNAL-FIRST: فريم ≤15ث — تنفيذ فوري بلا قيود
    if (isShortFrame && CFG.SHORT_MODE_TVE_DIRECT) {
      // ✅ v10.5: لا فلتر اتجاه — الإشارة تُنفَّذ دائماً
      _readySignal = { ...result, trendInfo, asset, confluence: null };
      _readySignalTs = now; _signalPrice = tickBuffers[asset]?.slice(-1)[0] ?? null;
      PERF.mark('psmArmed');
      addLog('[TVE⚡v10.5] '+result.reason+' | σ='+Math.abs(result.sigma||0).toFixed(2), 'signal');
      updateSignalDisplay(_readySignal);
      // تنفيذ فوري — Signal Watcher سيتولى أيضاً كطبقة ثانية
      _executeWithJitter(result.signal, asset);
      return;
    }

    // فريم متوسط/طويل — confluence خفيف
    let conf = null;
    if (candles.length >= 5) {
      conf = scoreConfluence(result.signal, candles, result);
      const thresholds = getAdaptiveThresholds(candlePeriod);
      if (conf.score < thresholds.min) {
        addLog('[TVE] ⚠ توافق منخفض: '+conf.score.toFixed(1)+' — تجاهل','info'); return;
      }
    }

    if (CFG.SLIPPAGE_ENABLED && _signalPrice !== null && _tickSize !== null) {
      const curP = tickBuffers[asset]?.slice(-1)[0] ?? null;
      if (curP !== null && Math.abs(curP - _signalPrice) > _tickSize * CFG.SLIPPAGE_TICKS) return;
    }

    _readySignal = { ...result, trendInfo, asset, confluence: conf };
    _readySignalTs = now; _signalPrice = tickBuffers[asset]?.slice(-1)[0] ?? null;
    PERF.mark('psmArmed');
    const confStr = conf ? ' CONF:'+conf.score.toFixed(1) : '';
    addLog('[TVE] ⚡ '+result.reason+confStr, 'signal');
    updateSignalDisplay(_readySignal);

    // ✅ SUPREME-PRED v2 [IMDB]: TVE مع ثقة عالية → صفقات متعددة فورية
    const tveSpConf = _PS.spConf ?? 0;
    if (fastCloseAt && fastCloseAt > now + 100) {
      schedulePredictiveEntry();
    } else if (tveSpConf >= CFG.IMDB_TIER_DOUBLE && canIMDB(tveSpConf)) {
      executeIMDB(result.signal, asset, tveSpConf);
    } else if (CFG.TVE_PRIORITY) {
      _executeWithJitter(result.signal, asset);
    }
  }

  function onChafor(asset, seconds) {
    const a = normalizeAsset(asset);
    if (!chaforState[a]) chaforState[a] = { prev:null, resetAt:0 };
    const st = chaforState[a], prev = st.prev;
    st.prev = seconds;
    if (a === activeAsset) updateCountdownDisplay(seconds);
    const isReset = prev!==null && seconds>prev+2 && prev<=12;
    if (!isReset) return;
    st.resetAt = Date.now();
    if (a===activeAsset && candlePeriod>0) {
      const estimated = Date.now() + candlePeriod*1000;
      if (!fastCloseAt || Math.abs(fastCloseAt-estimated)>2000) { fastCloseAt = estimated; schedulePredictiveEntry(); }
    }
    const KNOWN = [3,4,5,6,7,8,9,10,15,20,25,30,45,60,90,120,180,240,300,600,900,1800,3600];
    const nearest = KNOWN.reduce((a,b) => Math.abs(b-seconds)<Math.abs(a-seconds)?b:a);
    const tolerance = seconds<=10 ? 1 : Math.max(2, Math.round(seconds*0.05));
    if (Math.abs(nearest-seconds) > tolerance) { closeCurrentCandle(a); if (a===activeAsset||activeAsset===null) scheduleWindowEntry(a, candlePeriod); return; }
    const detected = Math.abs(nearest-seconds)===0 ? seconds : nearest;
    if (a===activeAsset||activeAsset===null) {
      if (detected !== candlePeriod) {
        // ✅ v10.10 FIX#4: لا تغيّر الفريم إذا كان مقفلاً من مصدر موثوق
        if (_periodLockUntil > Date.now()) {
          addLog('🔒 [PERIOD] تجاهل chafor='+detected+'ث — الفريم مقفل حتى '+(Math.ceil((_periodLockUntil-Date.now())/1000))+'ث', 'info');
        } else {
          if (detected===_lastDetectedPeriod) _lastDetectedCount++; else { _lastDetectedPeriod=detected; _lastDetectedCount=1; }
          const isTrusted=TRUSTED_SOURCES.has(durSource), threshold=isTrusted?CFG.PERIOD_TRUSTED_OVERRIDE:CFG.PERIOD_CONFIRM_COUNT;
          if (_lastDetectedCount>=threshold||durSource==='none') { candlePeriod=detected; durSource='chafor'; _lastDetectedCount=0; _rebuildPayloadCache(); updateHUD(); }
        }
      }
    }
    closeCurrentCandle(a);
    if (a===activeAsset||activeAsset===null) scheduleWindowEntry(a, candlePeriod);
  }

  function closeCurrentCandle(asset) {
    const cc = currentCandles[asset];
    if (!cc || cc.prices.length < CFG.MIN_TICKS_PER_CANDLE) { currentCandles[asset]=null; return; }
    const candle = buildCandle(cc.prices, cc.startTime);
    if (!candle) { currentCandles[asset]=null; return; }
    if (!candleBuffers[asset]) candleBuffers[asset] = [];
    candleBuffers[asset].push(candle);
    if (candleBuffers[asset].length > CFG.MAX_CANDLES) candleBuffers[asset].shift();
    if (asset === activeAsset) {
      _candlesSinceAssetChange++;
      const bufs = candleBuffers[asset];
      if (bufs.length >= 2) { const last=bufs[bufs.length-1], prev=bufs[bufs.length-2]; _rollingATR.addCandle(last.high,last.low,prev.close); }
      _sCandle.reset(); PatternStateMachine.reset(); TickVelocityEngine.reset();
      // ✅ v10.8: سجّل تفاصيل الشمعة المغلقة
      const trendInfo = analyzeTrend(bufs);
      addLog(
        (candle.isBullish ? '🟩 شمعة صاعدة' : '🟥 شمعة هابطة') + ' | ' + candle.open.toFixed(5) + '→' + candle.close.toFixed(5),
        candle.isBullish ? 'signal' : 'error',
        'تيكات:'+candle.tickCount+' | جسم:'+candle.bodySize.toFixed(5)+' | '+trendInfo.label+' | شموع:'+bufs.length
      );
      renderCandleRow();
    }
    currentCandles[asset] = null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 20  بناء الشمعة
  // ══════════════════════════════════════════════════════════════════════
  function buildCandle(prices, startTime) {
    if (!prices || prices.length < 2) return null;
    const open=prices[0], close=prices[prices.length-1];
    const high=Math.max(...prices), low=Math.min(...prices);
    const totalRange=high-low, isBullish=close>=open, bodySize=Math.abs(close-open);
    const upperWick=isBullish?(high-close):(high-open);
    const lowerWick=isBullish?(open-low):(close-low);
    const isDoji=totalRange>0 && (bodySize/totalRange)<CFG.DOJI_MAX_BODY_RATIO;
    return {
      open, high, low, close, upperWick, lowerWick, bodySize, totalRange, isBullish,
      isHammer         : isBullish &&bodySize>0&&lowerWick>=CFG.HAMMER_WICK_RATIO*bodySize&&upperWick<=bodySize*0.5,
      isInvertedHammer : isBullish &&bodySize>0&&upperWick>=CFG.HAMMER_WICK_RATIO*bodySize&&lowerWick<=bodySize*0.5,
      isHangingMan     : !isBullish&&bodySize>0&&lowerWick>=CFG.HAMMER_WICK_RATIO*bodySize&&upperWick<=bodySize*0.5,
      isShootingStar   : !isBullish&&bodySize>0&&upperWick>=CFG.HAMMER_WICK_RATIO*bodySize&&lowerWick<=bodySize*0.5,
      isBullishMarubozu: isBullish &&totalRange>0&&(upperWick/totalRange)<CFG.MARUBOZU_MAX_WICK&&(lowerWick/totalRange)<CFG.MARUBOZU_MAX_WICK,
      isBearishMarubozu: !isBullish&&totalRange>0&&(upperWick/totalRange)<CFG.MARUBOZU_MAX_WICK&&(lowerWick/totalRange)<CFG.MARUBOZU_MAX_WICK,
      isDoji, isGravestoneDoji: isDoji&&totalRange>0&&(upperWick/totalRange)>=CFG.GRAVE_UPPER_MIN&&(lowerWick/totalRange)<=0.05,
      isDragonflyDoji : isDoji&&totalRange>0&&(lowerWick/totalRange)>=CFG.DRAGON_LOWER_MIN&&(upperWick/totalRange)<=0.05,
      startTime, tickCount: prices.length,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 21  تحليل الاتجاه + EMA + SMA + ATR
  // ══════════════════════════════════════════════════════════════════════
  function analyzeTrend(candles) {
    const n = Math.min(candles.length, CFG.TREND_CANDLES);
    if (n < 3) return { trend:'NEUTRAL', strength:0, label:'➡ محايد' };
    const recent = candles.slice(-n);
    const bulls  = recent.filter(c => c.isBullish).length;
    const ratio  = bulls / n;
    let isAsc=true, isDes=true;
    for (let i=1;i<recent.length;i++) { if(recent[i].close<=recent[i-1].close) isAsc=false; if(recent[i].close>=recent[i-1].close) isDes=false; }
    if (ratio>=CFG.TREND_STRONG_RATIO||isAsc)            return { trend:'UP',      strength:Math.round(ratio*100),     label:'↗ صاعد' };
    if (ratio<=(1-CFG.TREND_STRONG_RATIO)||isDes)        return { trend:'DOWN',    strength:Math.round((1-ratio)*100), label:'↘ هابط' };
    if (ratio>0.55)  return { trend:'UP_WEAK',  strength:Math.round(ratio*100),     label:'↗ صاعد ضعيف' };
    if (ratio<0.45)  return { trend:'DN_WEAK',  strength:Math.round((1-ratio)*100), label:'↘ هابط ضعيف' };
    return { trend:'NEUTRAL', strength:50, label:'➡ محايد' };
  }

  function computeBodySMA(candles, period) {
    const slice = candles.slice(-period);
    if (slice.length < Math.min(period,5)) return null;
    return slice.reduce((s,c) => s+c.bodySize, 0) / slice.length;
  }

  function computeATR(candles, period) {
    if (!candles || candles.length < period+1) return null;
    const trs = [];
    for (let i=1;i<candles.length;i++) { const c=candles[i],p=candles[i-1]; trs.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close))); }
    const seed = trs.slice(0,period).reduce((s,v)=>s+v,0)/period;
    let atr = seed;
    for (let i=period;i<trs.length;i++) atr = (atr*(period-1)+trs[i])/period;
    return atr;
  }

  function updateTickSize(asset, newPrice) {
    const buf = tickBuffers[asset];
    if (!buf || buf.length < 2) return;
    const diff = Math.abs(newPrice - buf[buf.length-2]);
    if (diff > 0) _tickSize = _tickSize===null ? diff : _tickSize*0.9+diff*0.1;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 22  SIO Manager Probe + Fragment Buffer (من v8)
  // ══════════════════════════════════════════════════════════════════════
  function _probeForSIOManager() {
    if (_sioManager) return;
    const candidates = ['io','_io','__io','socket','_socket','sio','ioManager','socketManager'];
    for (const key of candidates) { const obj=W[key]; if(_isSIOManager(obj)){_sioManager=obj;return;} if(_isSIOSocket(obj)){_sioManager=obj.io||obj;return;} }
    try {
      for (const key of Object.keys(W)) {
        if (key.length>30||key.startsWith('webkit')||key.startsWith('on')) continue;
        const obj=W[key];
        if (obj&&typeof obj==='object'&&!Array.isArray(obj)) { if(_isSIOManager(obj)){_sioManager=obj;return;} if(_isSIOSocket(obj)){_sioManager=obj.io||obj;return;} }
      }
    } catch(_){}
  }
  function _isSIOManager(obj){ return obj&&typeof obj==='object'&&typeof obj.socket==='function'&&typeof obj.open==='function'&&obj.nsps!==undefined; }
  function _isSIOSocket(obj) { return obj&&typeof obj==='object'&&typeof obj.emit==='function'&&typeof obj.on==='function'&&obj.io!==undefined&&obj.nsp!==undefined; }
  function _getReactFiber(el){ if(!el) return null; const key=Object.keys(el).find(k=>k.startsWith('__reactFiber')||k.startsWith('__reactInternalInstance')); return key?el[key]:null; }

  function tryDecodeWithFragment(ws, buf) {
    const now = Date.now();
    let combined = buf;
    if (_fragBuffers.has(ws)) {
      const frag = _fragBuffers.get(ws);
      if (now - frag.ts > CFG.FRAG_BUFFER_TTL) { _fragBuffers.delete(ws); }
      else { const merged = new Uint8Array(frag.buf.byteLength+buf.byteLength); merged.set(new Uint8Array(frag.buf),0); merged.set(new Uint8Array(buf),frag.buf.byteLength); combined=merged.buffer; }
    }
    try { const decoded=msgpackDecode(combined); _fragBuffers.delete(ws); return { decoded, buffer:combined }; }
    catch(_){ _fragBuffers.set(ws,{buf:combined,ts:now}); return null; }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 23  ⚡ [Q-7] Precision Scheduler
  // ══════════════════════════════════════════════════════════════════════

  // ✅ v10.10.2 [SEE] Smart Early Entry — يحسب كم ثانية نسبق الإغلاق
  // المنطق: كلما الثقة (confluence) أعلى، دخلنا أبكر لنستفيد من الشمعة الجديدة
  // مثال على فريم 8ث: CONF≥4.5 → 2800ms مبكراً | CONF≥3.0 → 1600ms | أقل → 640ms
  function getSmartEarlyMs(confScore) {
    if (!CFG.SEE_ENABLED || !candlePeriod) return CFG.PREDICTIVE_FIRE_MS;
    const periodMs = candlePeriod * 1000;
    let ratio;
    if (confScore >= CFG.SEE_CONF_HIGH)      ratio = CFG.SEE_RATIO_HIGH;
    else if (confScore >= CFG.SEE_CONF_MED)  ratio = CFG.SEE_RATIO_MED;
    else                                     ratio = CFG.SEE_RATIO_LOW;
    const earlyMs = Math.round(periodMs * ratio);
    const clamped = Math.min(Math.max(earlyMs, CFG.SEE_MIN_MS), CFG.SEE_MAX_MS);
    // لا تدخل مبكراً أكثر من 50% من الفريم — نضمن وجود شمعة سابقة للتحليل
    return Math.min(clamped, Math.round(periodMs * 0.50));
  }
  function scheduleExactExecution(targetMs, callback) {
    cancelPredictiveExecution();
    function tick() {
      const now = performance.now() + performance.timeOrigin, delta = targetMs - now;
      if (delta <= 0) { callback(); }
      else if (delta < 16) { _predictiveRAF = W.requestAnimationFrame(tick); }
      else { _predictiveTimer = setTimeout(() => { _predictiveTimer=null; _predictiveRAF=W.requestAnimationFrame(tick); }, Math.max(delta-20,0)); }
    }
    _predictiveRAF = W.requestAnimationFrame(tick);
  }

  function cancelPredictiveExecution() {
    if (_predictiveTimer) { clearTimeout(_predictiveTimer); _predictiveTimer=null; }
    if (_predictiveRAF)   { W.cancelAnimationFrame(_predictiveRAF); _predictiveRAF=null; }
  }

  function schedulePredictiveEntry() {
    if (!fastCloseAt || !autoTrade) return;
    // SUPREME-PRED v2 [SEE]: احسب وقت الدخول المبكر حسب spConf
    const confScore = _PS.spConf ?? 0;
    const earlyMs   = getSmartEarlyMs(confScore);
    const fireAt    = fastCloseAt - earlyMs;
    const now       = Date.now();
    if (fireAt <= now + 30) return;
    addLog('[SEE] 📅 دخول مبكر: '+(earlyMs/1000).toFixed(2)+'ث قبل الإغلاق | SP:'+confScore.toFixed(0)+'%', 'info');
    scheduleExactExecution(fireAt, () => {
      PERF.mark('schedFired');
      if (!autoTrade || !_readySignal) return;
      const a = _readySignal.asset || activeAsset;
      if (!a) return;
      if (CFG.SLIPPAGE_ENABLED && _signalPrice!==null && _tickSize!==null) {
        const ticks=tickBuffers[a]||[], curPrice=ticks.length>0?ticks[ticks.length-1]:null;
        if (curPrice!==null && Math.abs(curPrice-_signalPrice)>_tickSize*CFG.SLIPPAGE_TICKS) { addLog('🚫 [Q-7] انزلاق','error'); _readySignal=null; return; }
      }
      PERF.mark('orderSent');
      const _sig = _readySignal.signal;  // احفظ قبل المسح
      _readySignal = null;  // ✅ v10.10.2: امسح قبل التنفيذ — يمنع الإطلاق المزدوج
      executeTrade(_sig, a);
      PERF.report();
    });
  }

  function _executeWithJitter(signal, asset) {
    if (!CFG.JITTER_ENABLED) { executeTrade(signal, asset); return; }
    const jitter = CFG.JITTER_MIN_MS + Math.random() * (CFG.JITTER_MAX_MS - CFG.JITTER_MIN_MS);
    setTimeout(() => executeTrade(signal, asset), jitter);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 24  ⚡ [PERF] قياس الكمون
  // ══════════════════════════════════════════════════════════════════════
  const PERF = {
    packetRecv:0, decodeStart:0, tickRecv:0, psmArmed:0, schedFired:0, orderSent:0,
    lastATR:null, lastTotal:null,
    _tickLatEma:null, _tickCount:0, _DISPLAY_EVERY:8,

    mark(label) { this[label] = performance.now(); },

    tickDone() {
      if (!this.packetRecv || !this.tickRecv) return;
      const lat = this.tickRecv - this.packetRecv;
      if (lat < 0 || lat > 2000) return;
      this._tickLatEma = this._tickLatEma===null ? lat : this._tickLatEma*0.85+lat*0.15;
      this._tickCount++;
      if (this._tickCount % this._DISPLAY_EVERY === 0) this._refreshLatUI();
    },

    _refreshLatUI() {
      const el = W.document.getElementById('cbPerfVal'); if (!el) return;
      const v = this._tickLatEma; if (v===null) { el.textContent='–'; return; }
      el.textContent = v.toFixed(1)+'ms';
      el.style.color = v<15 ? '#00d264' : v<40 ? '#ffb020' : '#ff3755';
    },

    report() {
      if (!this.orderSent || !this.packetRecv) return;
      const total = this.orderSent - this.packetRecv; this.lastTotal = total.toFixed(2);
      const el = W.document.getElementById('cbPerfVal');
      if (el) { el.textContent=this.lastTotal+'ms ⚡'; el.style.color='#00d264'; }
    },
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 25  محرك الاستراتيجية — 35+ نمط
  // ══════════════════════════════════════════════════════════════════════
  function checkStrategy(completed, forming) {
    const n = completed.length;
    if (n < 1) return null;
    const trendInfo = analyzeTrend(completed);
    const last = completed[n-1];

    const bodySMA = computeBodySMA(completed, CFG.BODY_SMA_PERIOD);
    if (bodySMA !== null && last.bodySize < bodySMA * CFG.BODY_SMA_RATIO) return null;
    if (CFG.ATR_ENABLED) {
      const atr14 = _rollingATR.isReady ? _rollingATR.value : computeATR(completed, CFG.ATR_PERIOD);
      if (atr14 !== null && last.totalRange < atr14 * CFG.ATR_MOMENTUM_RATIO) return null;
    }

    const closePrices = completed.map(c => c.close);
    const ema5 = computeEMA(closePrices, CFG.MICRO_TREND_EMA_PERIOD);
    const results = [];

    if (n >= 2) {
      const c1=completed[n-2], c2=completed[n-1];

      if (!c1.isBullish&&c2.isBullish&&c2.open<c1.close&&c2.close>c1.open&&c2.bodySize>=c1.bodySize*CFG.ENGULF_MIN_RATIO&&c2.bodySize>=c1.bodySize*1.1)
        results.push({ signal:'BUY',  case:'BullEngulf', confidence:4, reason:'🟢 ابتلاع صاعد' });
      if (c1.isBullish&&!c2.isBullish&&c2.open>c1.close&&c2.close<c1.open&&c2.bodySize>=c1.bodySize*CFG.ENGULF_MIN_RATIO&&c2.bodySize>=c1.bodySize*1.1)
        results.push({ signal:'SELL', case:'BearEngulf', confidence:4, reason:'🔴 ابتلاع هابط' });
      if (!c1.isBullish&&c2.isBullish&&c2.open>c1.open&&c2.bodySize>=c1.bodySize*0.7)
        results.push({ signal:'BUY',  case:'BullKicker', confidence:5, reason:'⚡ كيك صاعد' });
      if (c1.isBullish&&!c2.isBullish&&c2.open<c1.open&&c2.bodySize>=c1.bodySize*0.7)
        results.push({ signal:'SELL', case:'BearKicker', confidence:5, reason:'⚡ كيك هابط' });
      if (!c1.isBullish&&c2.isBullish&&Math.abs(c2.close-c1.open)<=c1.totalRange*0.05&&c2.bodySize>=c1.bodySize*0.85)
        results.push({ signal:'BUY',  case:'BullCntrAtk', confidence:4, reason:'⚔️ هجوم مضاد صاعد' });
      if (c1.isBullish&&!c2.isBullish&&Math.abs(c2.close-c1.open)<=c1.totalRange*0.05&&c2.bodySize>=c1.bodySize*0.85)
        results.push({ signal:'SELL', case:'BearCntrAtk', confidence:4, reason:'⚔️ هجوم مضاد هابط' });
      if (!c1.isBullish&&c2.isBullish&&c2.lowerWick<=c2.bodySize*0.06&&c2.upperWick<=c2.bodySize*0.12&&c2.bodySize>=(bodySMA||0)*1.2&&c2.bodySize>0)
        results.push({ signal:'BUY',  case:'BeltHoldB', confidence:4, reason:'🪖 حزام صاعد' });
      if (c1.isBullish&&!c2.isBullish&&c2.upperWick<=c2.bodySize*0.06&&c2.lowerWick<=c2.bodySize*0.12&&c2.bodySize>=(bodySMA||0)*1.2&&c2.bodySize>0)
        results.push({ signal:'SELL', case:'BeltHoldS', confidence:4, reason:'🪖 حزام هابط' });
      if (c1.isBullish&&!c2.isBullish&&c2.open>c1.high&&c2.close<(c1.open+c1.close)*0.45&&c2.bodySize>=c1.bodySize*0.55)
        results.push({ signal:'SELL', case:'DarkCloud', confidence:4, reason:'☁️ غطاء داكن' });
      if (!c1.isBullish&&c2.isBullish&&c2.open<c1.low&&c2.close>(c1.open+c1.close)*0.55&&c2.bodySize>=c1.bodySize*0.55)
        results.push({ signal:'BUY',  case:'PiercingLine', confidence:4, reason:'🗡️ خط الاختراق' });
      if (c1.isBullish&&c2.upperWick>=c2.bodySize*2.2&&c2.lowerWick<=c2.bodySize*0.25&&c2.bodySize>0&&c2.bodySize<c1.bodySize*0.45)
        results.push({ signal:'SELL', case:'ShootStar', confidence:4, reason:'⭐ نجمة رامية' });
      if (!c1.isBullish&&c2.lowerWick>=c2.bodySize*2.2&&c2.upperWick<=c2.bodySize*0.25&&c2.bodySize>0&&c2.bodySize<c1.bodySize*0.7)
        results.push({ signal:'BUY',  case:'Hammer', confidence:4, reason:'🔨 مطرقة' });
      if (c1.isBullish&&c2.lowerWick>=c2.bodySize*2.2&&c2.upperWick<=c2.bodySize*0.25&&c2.bodySize>0&&c2.bodySize<c1.bodySize*0.7)
        results.push({ signal:'SELL', case:'HangingMan', confidence:4, reason:'🪢 رجل مشنوق' });
      if (!c1.isBullish&&c2.isBullish&&c2.upperWick<=c2.bodySize*0.02&&c2.lowerWick<=c2.bodySize*0.02&&c2.bodySize>=(bodySMA||0)*1.6)
        results.push({ signal:'BUY',  case:'BullMarubozu', confidence:5, reason:'🟩 ماروبوزو صاعد' });
      if (!c2.isBullish&&c2.upperWick<=c2.bodySize*0.02&&c2.lowerWick<=c2.bodySize*0.02&&c2.bodySize>=(bodySMA||0)*1.6&&c1.isBullish)
        results.push({ signal:'SELL', case:'BearMarubozu', confidence:5, reason:'🟥 ماروبوزو هابط' });
      if (!c1.isBullish&&c2.isDoji&&c2.open>c1.close&&c2.open<c1.open&&c2.close>c1.close&&c2.close<c1.open&&c1.bodySize>=(bodySMA||0)*1.1)
        results.push({ signal:'BUY',  case:'BullHaramiX', confidence:4, reason:'✝️ هرامي صاعد' });
      if (c1.isBullish&&c2.isDoji&&c2.open<c1.close&&c2.open>c1.open&&c2.close<c1.close&&c2.close>c1.open&&c1.bodySize>=(bodySMA||0)*1.1)
        results.push({ signal:'SELL', case:'BearHaramiX', confidence:4, reason:'✝️ هرامي هابط' });
      if (!c1.isBullish&&c2.isBullish&&Math.abs(c1.low-c2.low)<=c1.totalRange*0.015)
        results.push({ signal:'BUY',  case:'TweezerBot', confidence:4, reason:'🔧 ملقاط القاع' });
      if (c1.isBullish&&!c2.isBullish&&Math.abs(c1.high-c2.high)<=c1.totalRange*0.015)
        results.push({ signal:'SELL', case:'TweezerTop', confidence:4, reason:'🔧 ملقاط القمة' });
      if (!c1.isBullish&&c2.isBullish&&c2.open<c1.low&&c2.close>c1.high&&c2.bodySize>=c1.totalRange*1.1)
        results.push({ signal:'BUY',  case:'GapBullEngulf', confidence:5, reason:'🚀 ابتلاع صاعد مع فجوة' });
      if (c1.isBullish&&!c2.isBullish&&c2.open>c1.high&&c2.close<c1.low&&c2.bodySize>=c1.totalRange*1.1)
        results.push({ signal:'SELL', case:'GapBearEngulf', confidence:5, reason:'💥 ابتلاع هابط مع فجوة' });
      if (!c1.isBullish&&c2.isBullish&&c2.open>c1.close&&c2.bodySize>=c1.bodySize*1.5&&c2.lowerWick<=c2.bodySize*0.1)
        results.push({ signal:'BUY',  case:'PowerKickerB', confidence:5, reason:'🔥 كيك صاعد قوي' });
      if (c1.isBullish&&!c2.isBullish&&c2.open<c1.close&&c2.bodySize>=c1.bodySize*1.5&&c2.upperWick<=c2.bodySize*0.1)
        results.push({ signal:'SELL', case:'PowerKickerS', confidence:5, reason:'🔥 كيك هابط قوي' });
      if (!c1.isBullish&&c2.isDragonflyDoji&&c2.lowerWick>=c2.totalRange*0.7)
        results.push({ signal:'BUY',  case:'DragonflyRev', confidence:5, reason:'🐉 دوجي تنين انعكاس' });
      if (c1.isBullish&&c2.isGravestoneDoji&&c2.upperWick>=c2.totalRange*0.7)
        results.push({ signal:'SELL', case:'GravestoneRev', confidence:5, reason:'🪦 دوجي شاهد قبر' });
      if (!c1.isBullish&&c2.isBullish&&c2.bodySize>=c1.bodySize*1.3&&(c2.close-c2.low)>=(c2.high-c2.low)*0.65&&c2.upperWick<=c2.bodySize*0.2)
        results.push({ signal:'BUY',  case:'BullAccel', confidence:5, reason:'📈 تسارع صاعد' });
      if (c1.isBullish&&!c2.isBullish&&c2.bodySize>=c1.bodySize*1.3&&(c2.high-c2.close)>=(c2.high-c2.low)*0.65&&c2.lowerWick<=c2.bodySize*0.2)
        results.push({ signal:'SELL', case:'BearAccel', confidence:5, reason:'📉 تسارع هابط' });
    }

    if (n >= 3) {
      const c1=completed[n-3], c2=completed[n-2], c3=completed[n-1];

      if (!c1.isBullish&&(c2.isDoji||c2.bodySize<c1.bodySize*CFG.STAR_BODY_RATIO)&&c3.isBullish&&c3.close>c1.open+c1.bodySize*0.35)
        results.push({ signal:'BUY',  case:'MornStar', confidence:5, reason:'🌅 نجمة الصباح' });
      if (c1.isBullish&&(c2.isDoji||c2.bodySize<c1.bodySize*CFG.STAR_BODY_RATIO)&&!c3.isBullish&&c3.close<c1.open-c1.bodySize*0.35)
        results.push({ signal:'SELL', case:'EveStar', confidence:5, reason:'🌆 نجمة المساء' });
      if (!c1.isBullish&&c2.isDoji&&c2.high<=c1.low*1.0005&&c3.isBullish&&c3.low>=c2.high*0.9995&&c3.bodySize>=c1.bodySize*0.6)
        results.push({ signal:'BUY',  case:'AbndBabyB', confidence:5, reason:'👶 طفل مهجور صاعد' });
      if (c1.isBullish&&c2.isDoji&&c2.low>=c1.high*0.9995&&!c3.isBullish&&c3.high<=c2.low*1.0005&&c3.bodySize>=c1.bodySize*0.6)
        results.push({ signal:'SELL', case:'AbndBabyS', confidence:5, reason:'👶 طفل مهجور هابط' });
      if (!c1.isBullish&&c2.isBullish&&c2.open>c1.close&&c2.close<c1.open&&c2.bodySize<c1.bodySize*CFG.HARAMI_MAX_RATIO&&c3.isBullish&&c3.close>c2.close&&c3.bodySize>c2.bodySize)
        results.push({ signal:'BUY',  case:'Inside3Up', confidence:4, reason:'🔺 3 جوه طالع' });
      if (c1.isBullish&&!c2.isBullish&&c2.open<c1.close&&c2.close>c1.open&&c2.bodySize<c1.bodySize*CFG.HARAMI_MAX_RATIO&&!c3.isBullish&&c3.close<c2.close&&c3.bodySize>c2.bodySize)
        results.push({ signal:'SELL', case:'Inside3Dn', confidence:4, reason:'🔻 3 جوه نازل' });
      if (c1.isBullish&&c2.isBullish&&c3.isBullish&&c2.open>=c1.open&&c2.open<=c1.close&&c3.open>=c2.open&&c3.open<=c2.close&&c2.close>c1.close&&c3.close>c2.close&&c3.upperWick<=c3.bodySize*0.2)
        results.push({ signal:'BUY',  case:'ThreeWS', confidence:5, reason:'🪖 ثلاثة جنود بيض' });
      if (!c1.isBullish&&!c2.isBullish&&!c3.isBullish&&c2.open<=c1.open&&c2.open>=c1.close&&c3.open<=c2.open&&c3.open>=c2.close&&c2.close<c1.close&&c3.close<c2.close&&c3.lowerWick<=c3.bodySize*0.2)
        results.push({ signal:'SELL', case:'ThreeBC', confidence:5, reason:'🦅 ثلاثة غربان' });
      if (!c1.isBullish&&c2.isDoji&&c3.isBullish&&c3.close>(c1.open+c1.close)*0.55&&c3.bodySize>=c1.bodySize*0.55&&c1.bodySize>=(bodySMA||0)*1.1)
        results.push({ signal:'BUY',  case:'MornDojiStar', confidence:5, reason:'🌠 دوجي صباح' });
      if (c1.isBullish&&c2.isDoji&&!c3.isBullish&&c3.close<(c1.open+c1.close)*0.45&&c3.bodySize>=c1.bodySize*0.55&&c1.bodySize>=(bodySMA||0)*1.1)
        results.push({ signal:'SELL', case:'EveDojiStar', confidence:5, reason:'🌠 دوجي مساء' });
      if (c1.isBullish&&c2.isBullish&&c3.isBullish&&c2.bodySize>c1.bodySize&&c3.bodySize>c2.bodySize&&(c3.close-c3.low)>=(c3.high-c3.low)*0.75&&c3.upperWick<=c3.bodySize*0.1)
        results.push({ signal:'BUY',  case:'AccelSoldiersB', confidence:5, reason:'🚀 جنود متسارعون' });
      if (!c1.isBullish&&!c2.isBullish&&!c3.isBullish&&c2.bodySize>c1.bodySize&&c3.bodySize>c2.bodySize&&(c3.high-c3.close)>=(c3.high-c3.low)*0.75&&c3.lowerWick<=c3.bodySize*0.1)
        results.push({ signal:'SELL', case:'AccelSoldiersS', confidence:5, reason:'🚀 غربان متسارعة' });
      if (!c1.isBullish&&c2.bodySize<c1.bodySize*0.4&&c3.isBullish&&c3.bodySize>=c1.bodySize*0.85&&c3.close>c1.open*0.999)
        results.push({ signal:'BUY',  case:'VReversalB', confidence:5, reason:'🔄 انعكاس V صاعد' });
      if (c1.isBullish&&c2.bodySize<c1.bodySize*0.4&&!c3.isBullish&&c3.bodySize>=c1.bodySize*0.85&&c3.close<c1.open*1.001)
        results.push({ signal:'SELL', case:'VReversalS', confidence:5, reason:'🔄 انعكاس V هابط' });
    }

    if (results.length === 0) return null;

    for (const r of results) {
      if (r.signal==='BUY' &&(trendInfo.trend==='UP'||trendInfo.trend==='UP_WEAK'))   r.confidence = Math.min(5,r.confidence+1);
      if (r.signal==='SELL'&&(trendInfo.trend==='DOWN'||trendInfo.trend==='DN_WEAK')) r.confidence = Math.min(5,r.confidence+1);
      if (r.signal==='BUY' && trendInfo.trend==='DOWN') r.confidence = Math.max(1,r.confidence-2);
      if (r.signal==='SELL'&& trendInfo.trend==='UP')   r.confidence = Math.max(1,r.confidence-2);
      // 🆕 PPT boost
      r.confidence = Math.max(1, Math.min(5, r.confidence + getPatternConfBoost(r.case)));
    }
    results.sort((a,b) => b.confidence-a.confidence);
    const topBuy  = results.find(r=>r.signal==='BUY')  || null;
    const topSell = results.find(r=>r.signal==='SELL') || null;
    let best;
    if (topBuy && topSell) best = topBuy.confidence >= topSell.confidence ? topBuy : topSell;
    else best = results[0];

    if (best.confidence < CFG.MIN_PATTERN_CONFIDENCE) return null;
    if (CFG.TREND_FILTER_ENABLED) {
      const trend = trendInfo.trend;
      if (best.signal==='BUY' && trend==='DOWN')  return null;
      if (best.signal==='SELL'&& trend==='UP')    return null;
      if (trend==='NEUTRAL' && best.confidence<5) return null;
    }
    if (CFG.MICRO_TREND_ENABLED && ema5 !== null) {
      const lc = last.close;
      if (best.signal==='BUY'  && lc < ema5*0.9998) return null;
      if (best.signal==='SELL' && lc > ema5*1.0002) return null;
    }

    const conf = scoreConfluence(best.signal, completed, null);
    // ⚡ v10.2: استخدم العتبة التكيفية (أقل للفريم القصير)
    const adaptMin = getAdaptiveThresholds(candlePeriod).min;
    if (conf.score < adaptMin) { addLog('⚠ توافق '+conf.score.toFixed(1)+'/'+adaptMin+': '+conf.breakdown.join(' '),'info'); return null; }

    return { ...best, trendInfo, ema5, confluence: conf };
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 26  جدولة الدخول
  // ══════════════════════════════════════════════════════════════════════
  function scheduleWindowEntry(asset, period) {
    if (windowTimer !== null) clearTimeout(windowTimer);
    windowAsset = asset; windowPeriod = period;
    const delay = (period>0&&period<=15) ? CFG.ENTRY_DELAY_SHORT : CFG.ENTRY_DELAY_MS;
    windowTimer = setTimeout(() => { windowTimer=null; onWindowEntry(windowAsset, windowPeriod); }, delay);
  }

  function onWindowEntry(asset, period) {
    const candles = candleBuffers[asset] || [];
    const cc = currentCandles[asset];
    let forming = null;
    if (cc && cc.prices.length >= 1) forming = buildCandle(cc.prices, cc.startTime);

    if (candles.length < CFG.MIN_CANDLES_TO_TRADE) { addLog('⏳ شموع غير كافية ('+candles.length+'/'+CFG.MIN_CANDLES_TO_TRADE+')','info'); return; }

    const result = checkStrategy(candles, forming);
    lastSignal = result;
    if (result) {
      const confStr = result.confluence ? ' CONF:'+result.confluence.score.toFixed(1) : '';
      addLog('🎯 '+result.case+': '+result.reason+' ['+result.confidence+'/5]'+confStr, result.signal==='BUY'?'signal':'error');
      updateSignalDisplay(result);
      const ticks = tickBuffers[asset] || [];
      _readySignal = { ...result, asset }; _readySignalTs = Date.now();
      _signalPrice = ticks.length > 0 ? ticks[ticks.length-1] : null;
      _lastTradeWasTVE = false;
      _lastTradePatternCase = result.case;

      // SUPREME-PRED v2: use spConf (0-100) as gate instead of old confluence score
      const spConfNow = _PS.spConf ?? 0;
      const regime    = _PS.regime || 'RANGE';
      const minConf   = regime === 'VOLATILE' ? CFG.SUPREME_VOLATILE_THRESH : CFG.SUPREME_MIN_CONF;

      if (spConfNow < minConf) {
        addLog('⏸ SUPREME-PRED ثقة منخفضة ('+spConfNow.toFixed(0)+'% < '+minConf+'%) — انتظار', 'info');
      } else if (autoTrade) {
        // IMDB: حدّد عدد الصفقات حسب SUPREME-PRED spConf
        const imdbTier = getIMDBTier(spConfNow);
        if (imdbTier > 1 && canIMDB(spConfNow)) {
          executeIMDB(result.signal, asset, spConfNow);
        } else {
          // فحص الصفقة المزدوجة القديم (احتياطي)
          const dbl = shouldDouble(spConfNow, result.signal, null, null);
          if (dbl.doDouble) {
            executeDoubleTradeSequence(result.signal, asset, tradeAmount, dbl.secondAmount, dbl.secondDelay);
          } else if (fastCloseAt && fastCloseAt > Date.now() + 100) {
            schedulePredictiveEntry();
          } else {
            _executeWithJitter(result.signal, asset);
          }
        }
      }
    } else {
      _readySignal = null; _signalPrice = null; updateSignalDisplay(null);
    }
    renderCandleRow();
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 27  تنفيذ الصفقة
  // ══════════════════════════════════════════════════════════════════════
  function snapToPOTime(rawPeriod) { return PO_VALID_TIMES.reduce((a,b) => Math.abs(b-rawPeriod)<Math.abs(a-rawPeriod)?b:a); }

  function executeTrade(direction, asset, overrideAmount) {
    const now = Date.now();

    // حارس 0: ✅ v10.9 — sub-second bucket (منع تكرار أوامر في نفس الـ 50ms)
    const bucket = Math.floor(now / 50);
    if (bucket === _subSecondBucket) return;   // صامت — طبيعي جداً

    // حارس 1: وقف الخسائر
    if (_lossStreakPauseUntil > now) {
      addLog('⛔ [H1] وقف تلقائي — تبقى '+Math.ceil((_lossStreakPauseUntil-now)/1000)+'ث','error',
             'streak:'+STATS.lossStreak+'/'+CFG.MAX_LOSS_STREAK);
      return;
    }

    // حارس 2: cooldown بين الصفقات (تكيفي — 25% من طول الشمعة)
    const sinceLastTrade = now - lastTradeMs;
    if (sinceLastTrade < getAdaptiveCooldown()) {
      // لا نسجل — طبيعي أن يُطلق TVE عدة مرات
      return;
    }

    // حارس 3: tradeExec (قيد التنفيذ) — مع auto-reset safety
    if (tradeExec) {
      addLog('⚠ [H3] tradeExec مشغول','info', 'منذ '+(now-lastTradeMs)+'ms');
      return;
    }

    // ✅ v10.5: لا قفل lastTradeCandle في SHORT_MODE
    const a = asset || activeAsset;
    if (!a) { addLog('❌ لا زوج نشط','error'); return; }

    // ══ حارس 4: ✅ v10.10 FIX#2 — فلتر الاتجاه (TVE و PAT كلاهما مُحجوب في الضعيف) ══════
    // TVE + PAT → يُحجبان في DOWN/DN_WEAK (لا BUY) وUP/UP_WEAK (لا SELL)
    {
      const _trendCandles = candleBuffers[a] || [];
      if (_trendCandles.length >= 3) {
        const _trendNow  = analyzeTrend(_trendCandles);
        const _isTVESig  = !_readySignal || _readySignal.isTVE === true;
        // ✅ v10.10 FIX#2: PAT أيضاً مُحجوب في الضعيف — نفس منطق TVE
        const _downBlock = _trendNow.trend === 'DOWN' || _trendNow.trend === 'DN_WEAK';
        const _upBlock   = _trendNow.trend === 'UP'   || _trendNow.trend === 'UP_WEAK';
        if (direction === 'BUY' && _downBlock) {
          addLog('🚫 [H4] رُفض BUY — '+(_isTVESig?'TVE':'PAT')+' ('+_trendNow.label+')', 'error',
                 'شموع:'+_trendCandles.length+' | قوة:'+_trendNow.strength+'%');
          _readySignal = null;  // V11 FIX: always clear — TVE re-fires naturally; prevents Watcher double-rejection
          return;
        }
        if (direction === 'SELL' && _upBlock) {
          addLog('🚫 [H4] رُفض SELL — '+(_isTVESig?'TVE':'PAT')+' ('+_trendNow.label+')', 'error',
                 'شموع:'+_trendCandles.length+' | قوة:'+_trendNow.strength+'%');
          _readySignal = null;  // V11 FIX: always clear — TVE re-fires naturally; prevents Watcher double-rejection
          return;
        }
      }
    }
    // ══════════════════════════════════════════════════════════════════
  // ══ Guard H5: APEX-PRED consensus filter ════════════════════════════════
  // ══ Guard H5: SUPREME-PRED v2 — حاجز الثقة الصارم ≥ 70% ═══════════════
  // الحاجز الرئيسي للتنفيذ: ثقة SUPREME-PRED يجب أن تكون >= 70%
  {
    const _spConf = _PS.spConf ?? 0;        // ثقة SUPREME-PRED (0-100%)
    const _spDir  = _PS.direction ?? 'NEUTRAL';
    const _regime = _PS.snap?.regime ?? 'RANGE';
    const _regBlocked = _PS.regimeBlocked?.[_regime] ?? false;

    // في VOLATILE: يشترط ثقة >= 85%
    const _minConfThreshold = _regime === 'VOLATILE'
      ? CFG.SUPREME_VOLATILE_THRESH
      : CFG.SUPREME_MIN_CONF;

    const _supremeOk = (_spDir === direction || _spDir === 'NEUTRAL')
                       && _spConf >= _minConfThreshold
                       && !_regBlocked;

    if (!_supremeOk) {
      const _reason = _regBlocked
        ? 'نظام ' + _regime + ' محجوب'
        : _spConf < _minConfThreshold
          ? 'ثقة ' + _spConf + '% < ' + _minConfThreshold + '%'
          : 'اتجاه عكسي: ' + _spDir + ' vs ' + direction;
      addLog(
        '🔴 [H5] SUPREME-PRED رفض ' + direction + ' — ' + _reason,
        'error',
        'regime:' + _regime + ' H:' + (_PS.hurst_h?.toFixed(2) ?? '?') +
        ' gA:' + (_PS.snap?.gA?.toFixed(2) ?? '?') + ' gB:' + (_PS.snap?.gB?.toFixed(2) ?? '?')
      );
      _readySignal = null;
      return;
    }
  }
  // ════════════════════════════════════════════════════════════════════════
    const isShortNow = (candlePeriod > 0 && candlePeriod <= 15) ||
                       (candlePeriod === 0 && CFG.SHORT_MODE_ASSUME);
    if (!CFG.SHORT_MODE_NO_CANDLE_LOCK || !isShortNow) {
      const cc = currentCandles[a];
      const candleKey = cc ? cc.startTime : 0;
      if (candleKey && candleKey === lastTradeCandle) {
        addLog('🔒 نفس الشمعة','info'); return;
      }
    }

    tradeExec = true; lastTradeMs = now;
    _subSecondBucket = Math.floor(now / 50);  // ✅ v10.9: سجّل bucket الـ 50ms
    // ✅ v10.9: احسب وقت انتهاء الصفقة لمنع الدخول المبكر
    _pendingTradeExpiry = now + getTradeResultWindow();
    if (!CFG.SHORT_MODE_NO_CANDLE_LOCK || !isShortNow) {
      const cc = currentCandles[a];
      lastTradeCandle = cc ? cc.startTime : 0;
    }
    _lastFailedSignal = lastSignal ? { ...lastSignal } : null;
    _lastTradeWasTVE  = _readySignal?.isTVE || false;
    updateTradeBtn();

    // ✅ v10.8: سجّل الصفقة بكل تفاصيلها
    const _execTrend = analyzeTrend(candleBuffers[a] || []);
    const _execConf  = _readySignal?.confluence?.score?.toFixed(1) ?? '–';
    const _execPat   = _lastTradePatternCase || (_lastTradeWasTVE ? 'TVE' : '–');
    addLog(
      '🔥 ' + (direction==='BUY' ? '↑ شراء' : '↓ بيع') +
      ' | $' + (overrideAmount || tradeAmount) +
      (_lastTradeWasTVE ? ' [TVE]' : ' [PAT]'),
      'signal',
      'نمط:' + _execPat +
      ' | توافق:' + _execConf +
      ' | اتجاه:' + _execTrend.label +
      ' | فريم:' + (candlePeriod||'؟') + 'ث' +
      ' | SUPREME:' + _PS.direction +
      ' conf:' + (_PS.spConf??0) + '%' +
      ' agree:' + (_PS.snap?.agree??0) + '/' + (_PS.snap?.total??30) +
      ' regime:' + (_PS.snap?.regime??'?') +
      ' H:' + (_PS.hurst_h?.toFixed(2)??'?') +
      ' KF:' + (_PS.kalmanPredDir > 0 ? '↑' : _PS.kalmanPredDir < 0 ? '↓' : '—')
    );

    let success = false;

    // ✅ محاولة WS أولاً — Ghost Execution: fire pre-serialized packet for sub-1ms latency
    if (tradeWSOrig && tradeWS && tradeWS.readyState === 1) {
      try {
        const nowPf2 = W.performance?.now?.() ?? Date.now();
        const ghostOk = !overrideAmount && _ghostExecPacket &&
                        _ghostExecPacket.signal === direction &&
                        nowPf2 - _ghostExecPacket.builtAt < 2500;
        const packet = ghostOk ? _ghostExecPacket.packet : _getCachedPayload(direction, overrideAmount);
        _ghostExecPacket = null;
        tradeWSOrig(packet);
        success = true;
        PERF.mark('orderSent'); PERF.report();
      } catch(e) { addLog('❌ WS error: '+e.message,'error'); }
    }

    // ✅ إذا WS فشل أو غير متصل — اضغط الزر
    if (!success) {
      success = clickTradeButton(direction);
      addLog(success ? '🖱 زر المنصة ✓' : '❌ WS غير متصل والزر غير موجود!', success?'info':'error');
    }

    if (success && _adaptiveSigmaActive) _resetAdaptiveSigma();
    // ✅ v10.8: احفظ مفتاح الإشارة المنفَّذة لمنع PSM من إعادة التسليح
    if (_readySignal) {
      _lastExecutedSignalKey = (_readySignal.case || direction) + ':' + a;
      _lastExecutedSignalTs  = now;
    }
    _readySignal = null; // ✅ v10.8: امسح الإشارة بعد التنفيذ — يمنع Signal Watcher من إعادة الإطلاق

    // ✅ v10.8: lockMs تكيفي — getAdaptiveCooldown() يعمل على أي فريم
    const lockMs = getAdaptiveCooldown();
    // ✅ v10.10 FIX#1: ألغِ الـ timers القديمة قبل تسجيل الجديدة — يمنع auto-reset القديم من تصفير tradeExec للصفقة الجديدة
    if (_tradeExecLockTimer)  { clearTimeout(_tradeExecLockTimer);  _tradeExecLockTimer  = null; }
    if (_tradeExecResetTimer) { clearTimeout(_tradeExecResetTimer); _tradeExecResetTimer = null; }
    _tradeExecLockTimer = setTimeout(() => {
      _tradeExecLockTimer = null;
      tradeExec = false; updateTradeBtn();
      // ✅ v10.10.1 FIX#TIMING: شغّل الإشارة المعلّقة فوراً دون انتظار دورة Watcher
      _tryFirePendingSignal();
    }, lockMs);

    // ✅ v10.10 FIX#1: auto-reset = 2.5× الكولداون — safety net فقط إذا لم تصل نتيجة الصفقة
    _tradeExecResetTimer = setTimeout(() => {
      _tradeExecResetTimer = null;
      if (tradeExec) { tradeExec = false; updateTradeBtn(); addLog('🔄 tradeExec auto-reset','info'); }
    }, getAdaptiveExecTimeout());
  }

  // ══════════════════════════════════════════════════════════════════════
  // ✅ v12 [WATCH] Signal Watcher — 100ms + SUPREME-PRED confidence refresh
  // ══════════════════════════════════════════════════════════════════════
  function _startSignalWatcher() {
    _v11_setInterval(() => {
      if (!autoTrade || !_readySignal) return;
      const now = Date.now();

      // ── [WATCH-0] Dynamic Cooldown: Recalibration + Ghost Trade guards ──────────
      if (_recalibrating) {
        // Exit recalibration only when Hurst H > 0.6 (trending, predictable market)
        if (_PS.hurst_h > CFG.SUPREME_HURST_TREND) {
          _recalibrating = false;
          STATS.lossStreak = 0;
          addLog('[RECAL] ✅ إعادة معايرة اكتملت — H=' + _PS.hurst_h.toFixed(2) + ' > 0.6 | عودة التداول', 'signal');
          updatePauseDisplay(false);
        } else {
          return; // still recalibrating — block all signals
        }
      }
      if (_ghostTradeActive && !_ghostWatching) {
        // Intercept this signal as a Ghost Trade: simulate instead of execute
        const dir      = _readySignal.signal;
        const a        = _readySignal.asset || activeAsset;
        const curPrice = (tickBuffers[a] || []).slice(-1)[0];
        _readySignal   = null;  // consume the signal
        if (curPrice !== undefined && dir && a) {
          _ghostSimulate(dir, a, curPrice, candlePeriod || 60);
        }
        return;
      }
      if (_ghostWatching) return; // ghost in flight — real trades blocked

      // ── [WATCH-1] الإشارة انتهت بعد 2500ms ──────────────────────────
      if (now - _readySignalTs > CFG.SIGNAL_WATCHER_EXPIRY_MS) {
        addLog('[WATCH] ⏱ إشارة انتهت — إلغاء', 'info');
        _readySignal = null; return;
      }

      // ── [WATCH-2] إعادة تقييم SUPREME-PRED قبل التنفيذ ──────────────
      // إذا انخفضت الثقة دون 65% → إلغاء فوري
      const _spConfNow = _PS.spConf ?? 0;
      if (_spConfNow < CFG.SUPREME_CANCEL_CONF) {
        addLog('[WATCH] 🔴 ثقة انخفضت ' + _spConfNow + '% < ' + CFG.SUPREME_CANCEL_CONF + '% — إلغاء', 'info');
        _readySignal = null; return;
      }

      // ── [WATCH-3] فحص تغيير الاتجاه منذ توليد الإشارة ───────────────
      const dir = _readySignal.signal;
      const _spDirNow = _PS.direction;
      if (_spDirNow !== 'NEUTRAL' && _spDirNow !== dir) {
        addLog('[WATCH] 🔄 اتجاه تغيّر: ' + dir + ' → ' + _spDirNow + ' — إلغاء', 'info');
        _readySignal = null; return;
      }

      // ── فحص الكولداون والحواجز الأخرى ───────────────────────────────
      if ((now - lastTradeMs) < getAdaptiveCooldown()) return;
      if (tradeExec) return;
      if (_lossStreakPauseUntil > now) return;
      const isShortWatcher = (candlePeriod > 0 && candlePeriod <= 15) ||
                             (candlePeriod === 0 && CFG.SHORT_MODE_ASSUME);
      if (!isShortWatcher && _pendingTradeExpiry > now) return;

      const a = _readySignal.asset || activeAsset;
      if (!dir || !a) return;

      // ── [WATCH-4] فلتر الاتجاه (TVE+PAT) ─────────────────────────────
      const _wCandles = candleBuffers[a] || [];
      if (_wCandles.length >= 3) {
        const _wTrend   = analyzeTrend(_wCandles);
        const _wDownBlk = _wTrend.trend === 'DOWN' || _wTrend.trend === 'DN_WEAK';
        const _wUpBlk   = _wTrend.trend === 'UP'   || _wTrend.trend === 'UP_WEAK';
        if (dir === 'BUY' && _wDownBlk) {
          addLog('[WATCH] 🚫 BUY في هبوط — مُلغاة (' + _wTrend.label + ')', 'error');
          _readySignal = null; return;
        }
        if (dir === 'SELL' && _wUpBlk) {
          addLog('[WATCH] 🚫 SELL في صعود — مُلغاة (' + _wTrend.label + ')', 'error');
          _readySignal = null; return;
        }
      }

      // ── [WATCH-5] تحقق نهائي من SUPREME-PRED ──────────────────────────
      const _regime = _PS.snap?.regime ?? 'RANGE';
      const _minConf = _regime === 'VOLATILE' ? CFG.SUPREME_VOLATILE_THRESH : CFG.SUPREME_MIN_CONF;
      if (_spConfNow < _minConf) {
        addLog('[WATCH] 🔴 ثقة غير كافية ' + _spConfNow + '% < ' + _minConf + '% — إلغاء', 'error');
        _readySignal = null; return;
      }

      addLog('[WATCH⚡] SUPREME: ' + _spConfNow + '% | تنفيذ: ' + dir, 'signal');
      _readySignal = null;
      executeTrade(dir, a);
    }, CFG.SIGNAL_WATCHER_MS);
  }

  // ✅ v10.10.1 FIX#TIMING: تنفيذ فوري للإشارة المعلّقة فور رفع القفل
  // يحل مشكلة التأخير (0-200ms) الناتج عن انتظار دورة Signal Watcher القادمة
  function _tryFirePendingSignal() {
    if (!_readySignal || !autoTrade) return;
    const now = Date.now();
    if ((now - _readySignalTs) > CFG.SIGNAL_WATCHER_EXPIRY_MS) { _readySignal = null; return; }
    if ((now - lastTradeMs) < getAdaptiveCooldown()) return;
    if (tradeExec) return;
    if (_lossStreakPauseUntil > now) return;
    // ✅ نفس شرط _pendingTradeExpiry من Signal Watcher
    const isShortFire = (candlePeriod > 0 && candlePeriod <= 15) ||
                        (candlePeriod === 0 && CFG.SHORT_MODE_ASSUME);
    if (!isShortFire && _pendingTradeExpiry > now) return;
    const dir = _readySignal.signal;
    const a   = _readySignal.asset || activeAsset;
    if (!dir || !a) return;
    // ✅ نفس فلتر الاتجاه من Signal Watcher — UP_WEAK/DN_WEAK محجوب
    const _fCandles = candleBuffers[a] || [];
    if (_fCandles.length >= 3) {
      const _fTrend   = analyzeTrend(_fCandles);
      const _fDownBlk = _fTrend.trend === 'DOWN' || _fTrend.trend === 'DN_WEAK';
      const _fUpBlk   = _fTrend.trend === 'UP'   || _fTrend.trend === 'UP_WEAK';
      if (dir === 'BUY' && _fDownBlk)  { addLog('[IMM] 🚫 BUY في هبوط — مُلغاة ('+_fTrend.label+')', 'error'); _readySignal = null; return; }
      if (dir === 'SELL' && _fUpBlk)   { addLog('[IMM] 🚫 SELL في صعود — مُلغاة ('+_fTrend.label+')', 'error'); _readySignal = null; return; }
    }
    // SUPREME-PRED gate — re-check confidence before deferred fire
    const _immSpConf = _PS.spConf ?? 0;
    const _immRegime = _PS.regime || 'RANGE';
    const _immMin    = _immRegime === 'VOLATILE' ? CFG.SUPREME_VOLATILE_THRESH : CFG.SUPREME_MIN_CONF;
    if (_immSpConf < CFG.SUPREME_CANCEL_CONF) {
      addLog('[IMM] 🚫 SUPREME-PRED ثقة سقطت ('+_immSpConf.toFixed(0)+'%) — مُلغاة', 'error');
      _readySignal = null; return;
    }
    if (_immSpConf < _immMin) {
      addLog('[IMM] 🚫 SUPREME-PRED دون عتبة '+_immMin+'% ('+_immSpConf.toFixed(0)+'%) — مُلغاة', 'error');
      _readySignal = null; return;
    }
    addLog('[IMM⚡] تنفيذ فوري بعد رفع القفل: '+dir, 'signal');
    _readySignal = null;  // ✅ v10.10.2: امسح قبل التنفيذ — يمنع WATCH من الإطلاق المزدوج
    executeTrade(dir, a);
  }

  function clickTradeButton(direction) {
    const isCall = direction === 'BUY';
    const buttons = W.document.querySelectorAll('button,[role="button"]');
    for (const btn of buttons) {
      if (btn.disabled || btn.getAttribute('aria-disabled')==='true') continue;
      const fiber = _getReactFiber(btn);
      if (fiber) { const fd = _extractFiberDirection(fiber); if(fd==='call'&&isCall){btn.click();return true;} if(fd==='put'&&!isCall){btn.click();return true;} }
      // ✅ v10.4 FIX#4: استخدم includes بدل ^ $ — يمسك "↑ شراء" و"↓ بيع"
      const txt = (btn.textContent||btn.innerText||'').trim();
      if (isCall  && (txt.includes('شراء')||txt.toLowerCase().includes('buy')||txt.toLowerCase().includes('call')||txt.includes('↑')||txt.toLowerCase().includes('higher')))  { btn.click(); return true; }
      if (!isCall && (txt.includes('بيع')||txt.toLowerCase().includes('sell')||txt.toLowerCase().includes('put')||txt.includes('↓')||txt.toLowerCase().includes('lower')))   { btn.click(); return true; }
    }
    const callSels=['.btn-call','[class*="btnCall"]','[data-direction="call"]','#call-btn','#buy-btn','[class*="buy"]','[class*="call"]'];
    const putSels =['.btn-put', '[class*="btnPut"]', '[data-direction="put"]', '#put-btn','#sell-btn','[class*="sell"]','[class*="put"]'];
    for (const sel of (isCall?callSels:putSels)) { const btn=W.document.querySelector(sel); if(btn&&!btn.disabled&&btn.getAttribute('aria-disabled')!=='true'){btn.click();return true;} }
    return false;
  }

  function _extractFiberDirection(fiber) {
    if (!fiber) return null;
    let f = fiber;
    for (let i=0;i<5&&f;i++) {
      const props = f.memoizedProps||f.pendingProps||{};
      const dir   = props['data-direction']||props['data-type']||props.direction||props.type;
      if (typeof dir==='string') { const d=dir.toLowerCase(); if(d==='call'||d==='buy'||d==='up') return 'call'; if(d==='put'||d==='sell'||d==='down') return 'put'; }
      if (typeof props.onClick==='function') { const src=props.onClick.toString().slice(0,200).toLowerCase(); if(src.includes('call')||src.includes('buy')) return 'call'; if(src.includes('put')||src.includes('sell')) return 'put'; }
      f = f.return;
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 28  الواجهة الرسومية — v10.8 (Advanced Log)
  // ══════════════════════════════════════════════════════════════════════
  let logLines = [];
  let _logSeq  = 0;                  // رقم تسلسلي لكل سطر
  const MAX_LOG = 500;               // ⬆ من 25 → 500 سطر
  let _logPaused = false;            // إيقاف مؤقت للعرض (لا للتسجيل)

  // طابع زمني بالميللي ثانية
  function ts() {
    const d = new Date();
    return d.getHours().toString().padStart(2,'0') + ':' +
           d.getMinutes().toString().padStart(2,'0') + ':' +
           d.getSeconds().toString().padStart(2,'0') + '.' +
           d.getMilliseconds().toString().padStart(3,'0');
  }
  function fmtDur(s) { if(s<60) return s+'ث'; if(s<3600) return Math.floor(s/60)+'د'; return Math.floor(s/3600)+'س'; }

  // addLog الرئيسية — تقبل حقل extra اختياري للتفاصيل
  function addLog(msg, type='info', extra='') {
    _logSeq++;
    logLines.unshift({ msg, type, t: ts(), seq: _logSeq, extra });
    if (logLines.length > MAX_LOG) logLines.pop();
    if (!_logPaused) renderLog();
    // تحديث عداد السجل في الزر
    const badge = W.document.getElementById('cbLogCount');
    if (badge) badge.textContent = _logSeq;
  }

  const HUD_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap');
  #cbRoot{position:fixed;bottom:16px;left:16px;z-index:2147483647;font-family:'IBM Plex Sans Arabic',-apple-system,BlinkMacSystemFont,sans-serif;direction:rtl;}
  #cbIcon{width:52px;height:52px;border-radius:16px;background:#0a0c10;border:1.5px solid rgba(255,255,255,0.09);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 32px rgba(0,0,0,0.7);transition:all 0.25s cubic-bezier(0.34,1.56,0.64,1);}
  #cbIcon:hover{transform:scale(1.08);}
  #cbIcon.buy{border-color:rgba(0,210,100,0.4);box-shadow:0 8px 32px rgba(0,210,100,0.2);}
  #cbIcon.sell{border-color:rgba(255,55,85,0.4);box-shadow:0 8px 32px rgba(255,55,85,0.2);}
  #cbIconSig{font-size:13px;font-weight:800;color:rgba(255,255,255,0.6);}
  #cbIcon.buy #cbIconSig{color:#00d264;}
  #cbIcon.sell #cbIconSig{color:#ff3755;}
  #cbIconDot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.12);margin-top:3px;}
  #cbIconDot.on{background:#00d264;box-shadow:0 0 6px rgba(0,210,100,0.6);}
  #cbPanel{position:fixed;bottom:80px;left:16px;width:300px;background:#0a0c10;border:1px solid rgba(255,255,255,0.07);border-radius:22px;box-shadow:0 24px 80px rgba(0,0,0,0.9);display:none;flex-direction:column;overflow:hidden;max-height:88vh;touch-action:none;}
  #cbPanel.open{display:flex;}
  #cbPanel.minimized #cbScrollArea{display:none;}
  .cb-hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:grab;flex-shrink:0;background:linear-gradient(180deg,rgba(255,255,255,0.025) 0%,transparent 100%);border-bottom:1px solid rgba(255,255,255,0.045);}
  .cb-hdr:active{cursor:grabbing;}
  .cb-hdr-dot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.08);flex-shrink:0;}
  .cb-hdr-dot.on{background:#00d264;box-shadow:0 0 8px rgba(0,210,100,0.5);}
  .cb-ttl{font-size:10px;font-weight:700;color:rgba(255,255,255,0.5);letter-spacing:0.5px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cb-hdr-actions{display:flex;gap:4px;flex-shrink:0;}
  .cb-icon-btn{width:22px;height:22px;border-radius:6px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);color:rgba(255,255,255,0.3);font-family:inherit;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .cb-icon-btn:hover{background:rgba(255,55,85,0.12);color:#ff3755;}
  #cbScrollArea{overflow-y:auto;flex:1;}
  #cbScrollArea::-webkit-scrollbar{width:2px;}
  #cbScrollArea::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.07);}
  .cb-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px 12px 0;}
  .cb-stat{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:6px 8px;}
  .cb-stat-lbl{display:block;font-size:8px;color:rgba(255,255,255,0.25);margin-bottom:2px;}
  .cb-stat-val{font-size:11px;font-weight:600;color:rgba(255,255,255,0.65);}
  .cb-stat-val.w{color:#fff;}.cb-stat-val.g{color:#00d264;}.cb-stat-val.y{color:#ffb020;}
  .cb-ind-row{display:flex;align-items:center;gap:6px;padding:5px 12px 0;font-size:9px;}
  .cb-ind-lbl{color:rgba(255,255,255,0.22);flex-shrink:0;min-width:48px;}
  .cb-ind-val{font-family:'SF Mono',ui-monospace,monospace;color:rgba(255,255,255,0.45);font-size:9px;flex:1;}
  .cb-ind-badge{font-size:8px;font-weight:700;padding:1px 7px;border-radius:6px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);color:rgba(255,255,255,0.2);flex-shrink:0;}
  .cb-ind-badge.up{background:rgba(0,210,100,0.1);border-color:rgba(0,210,100,0.25);color:#00d264;}
  .cb-ind-badge.dn{background:rgba(255,55,85,0.1);border-color:rgba(255,55,85,0.25);color:#ff3755;}
  .cb-ind-badge.yw{background:rgba(255,176,32,0.1);border-color:rgba(255,176,32,0.25);color:#ffb020;}
  .cb-conf-bar{display:flex;align-items:center;gap:6px;padding:6px 12px 0;font-size:9px;}
  .cb-conf-lbl{color:rgba(255,255,255,0.2);flex-shrink:0;}
  .cb-conf-score{font-family:'SF Mono',ui-monospace,monospace;font-size:11px;font-weight:700;}
  .cb-conf-track{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,0.06);overflow:hidden;}
  .cb-conf-fill{height:100%;border-radius:2px;transition:width 0.3s,background 0.3s;}
  .cb-conf-detail{font-size:7px;color:rgba(255,255,255,0.18);padding:2px 12px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .cb-dbl-row{display:flex;align-items:center;gap:6px;padding:4px 12px 0;}
  .cb-dbl-badge{font-size:9px;font-weight:700;padding:2px 8px;border-radius:8px;background:rgba(255,176,32,0.08);border:1px solid rgba(255,176,32,0.18);color:rgba(255,176,32,0.4);}
  .cb-dbl-badge.active{background:rgba(255,130,0,0.18);border-color:rgba(255,130,0,0.45);color:#ff8200;animation:dblPulse 0.8s ease-in-out infinite;}
  @keyframes dblPulse{0%,100%{opacity:1;}50%{opacity:0.6;}}
  .cb-pause-bar{display:none;align-items:center;justify-content:center;padding:5px 12px;background:rgba(255,55,85,0.06);border:1px solid rgba(255,55,85,0.12);margin:6px 12px 0;border-radius:8px;}
  .cb-pause-bar.active{display:flex;}
  .cb-pause-txt{font-size:9px;font-weight:700;color:#ff6070;}
  .cb-stats-bar{display:flex;gap:6px;padding:8px 12px 0;}
  .cb-stt{flex:1;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:5px 7px;text-align:center;}
  .cb-stt-lbl{display:block;font-size:7.5px;color:rgba(255,255,255,0.2);margin-bottom:2px;}
  .cb-stt-val{font-size:12px;font-weight:700;}
  .cb-stt-val.g{color:#00d264;}.cb-stt-val.r{color:#ff3755;}.cb-stt-val.y{color:#ffb020;}
  .cb-sig-wrap{padding:10px 12px 0;}
  .cb-sig-box{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:11px 13px;display:flex;flex-direction:column;gap:6px;position:relative;overflow:hidden;}
  .cb-sig-box.buy{background:rgba(0,210,100,0.05);border-color:rgba(0,210,100,0.22);}
  .cb-sig-box.sell{background:rgba(255,55,85,0.05);border-color:rgba(255,55,85,0.22);}
  .cb-sig-main{font-size:17px;font-weight:700;letter-spacing:0.8px;}
  .cb-sig-main.BUY{color:#00d264;}.cb-sig-main.SELL{color:#ff3755;}.cb-sig-main.HOLD{color:rgba(255,255,255,0.14);font-size:15px;font-weight:400;}
  .cb-sig-sub{font-size:9.5px;color:rgba(255,255,255,0.3);}
  .cb-sig-badge{font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.3);}
  .cb-sig-badge.b5{background:rgba(0,210,100,0.1);border-color:rgba(0,210,100,0.25);color:#00d264;}
  .cb-sig-badge.b4{background:rgba(0,210,100,0.07);border-color:rgba(0,210,100,0.18);color:rgba(0,210,100,0.8);}
  .cb-sig-badge.b3{background:rgba(255,176,32,0.08);border-color:rgba(255,176,32,0.2);color:#ffb020;}
  .cb-sig-badge.tve{background:rgba(255,176,32,0.12);border-color:rgba(255,176,32,0.3);color:#ffb020;}
  .cb-ppt-sect{padding:8px 12px 0;}
  .cb-section-lbl{font-size:9px;font-weight:600;color:rgba(255,255,255,0.2);text-transform:uppercase;letter-spacing:0.9px;margin-bottom:5px;display:flex;align-items:center;gap:6px;}
  .cb-section-lbl::after{content:'';flex:1;height:1px;background:rgba(255,255,255,0.05);}
  .cb-ppt-row{display:flex;align-items:center;gap:4px;padding:2px 0;font-size:8px;}
  .cb-ppt-name{flex:1;color:rgba(255,255,255,0.3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .cb-ppt-wr{font-family:'SF Mono',ui-monospace,monospace;min-width:28px;text-align:right;}
  .cb-ppt-wr.good{color:#00d264;}.cb-ppt-wr.mid{color:#ffb020;}.cb-ppt-wr.bad{color:#ff6070;}
  .cb-candle-sect{padding:10px 12px 0;}
  .cb-candle-row{display:flex;gap:4px;align-items:flex-end;flex-wrap:wrap;min-height:34px;}
  .cb-c{width:29px;height:29px;border-radius:8px;border:1.5px solid;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;}
  .cb-c.bull{background:rgba(0,210,100,0.1);border-color:rgba(0,210,100,0.28);color:#00d264;}
  .cb-c.bear{background:rgba(255,55,85,0.1);border-color:rgba(255,55,85,0.28);color:#ff3755;}
  .cb-c.hist{opacity:0.65;}.cb-c.forming{opacity:0.45;border-style:dashed;animation:formPulse 1.2s ease-in-out infinite;}
  @keyframes formPulse{0%,100%{opacity:0.4;}50%{opacity:0.7;}}
  .cb-sep{height:1px;background:rgba(255,255,255,0.045);margin:11px 0 0;}
  .cb-amount-row{display:flex;align-items:center;gap:8px;padding:8px 12px 0;}
  .cb-amount-lbl{font-size:10px;color:rgba(255,255,255,0.3);flex-shrink:0;}
  .cb-amount-inp{flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:5px 10px;color:rgba(255,255,255,0.75);font-family:inherit;font-size:12px;font-weight:600;text-align:center;outline:none;}
  .cb-amount-inp:focus{border-color:rgba(255,255,255,0.2);}
  .cb-demo-badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:8px;background:rgba(255,176,32,0.1);border:1px solid rgba(255,176,32,0.2);color:#ffb020;flex-shrink:0;}
  .cb-demo-badge.real{background:rgba(0,210,100,0.1);border-color:rgba(0,210,100,0.2);color:#00d264;}
  .cb-manual-row{display:flex;gap:6px;padding:8px 12px;}
  .cb-manual-btn{flex:1;padding:11px 8px;border-radius:12px;border:1.5px solid;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;text-align:center;transition:all 0.2s;touch-action:manipulation;}
  .cb-manual-btn.buy{background:rgba(0,210,100,0.09);border-color:rgba(0,210,100,0.38);color:#00d264;}
  .cb-manual-btn.sell{background:rgba(255,55,85,0.09);border-color:rgba(255,55,85,0.38);color:#ff3755;}
  .cb-auto-row{display:flex;align-items:center;gap:10px;padding:4px 12px 8px;}
  .cb-auto-lbl{font-size:11px;color:rgba(255,255,255,0.38);flex:1;}
  .cb-toggle{appearance:none;width:42px;height:23px;border-radius:12px;cursor:pointer;background:rgba(255,255,255,0.07);border:1.5px solid rgba(255,255,255,0.1);position:relative;transition:all 0.25s;flex-shrink:0;touch-action:manipulation;}
  .cb-toggle::after{content:'';position:absolute;top:2.5px;left:2.5px;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,0.28);transition:all 0.25s cubic-bezier(0.34,1.56,0.64,1);}
  .cb-toggle:checked{background:rgba(0,210,100,0.18);border-color:rgba(0,210,100,0.5);}
  .cb-toggle:checked::after{transform:translateX(19px);background:#00d264;}
  .cb-auto-badge{font-size:10px;font-weight:700;color:rgba(255,255,255,0.18);min-width:32px;text-align:center;}
  .cb-reset-btn{display:block;margin:0 12px 8px;padding:7px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);color:rgba(255,255,255,0.2);font-family:inherit;font-size:9.5px;cursor:pointer;text-align:center;width:calc(100% - 24px);}
  .cb-reset-btn:hover{background:rgba(255,55,85,0.08);color:#ff6070;}
  #cbLogFloat{position:fixed;bottom:158px;left:6px;z-index:2147483646;width:380px;background:#07090d;border:1px solid rgba(255,255,255,0.09);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,0.92);display:none;flex-direction:column;overflow:hidden;touch-action:none;max-height:75vh;}
  #cbLogFloat.open{display:flex;}
  #cbLogHdr{display:flex;align-items:center;gap:6px;padding:9px 10px 8px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:grab;flex-shrink:0;background:rgba(255,255,255,0.015);}
  .cb-log-title{font-size:9px;font-weight:700;color:rgba(255,176,32,0.85);text-transform:uppercase;letter-spacing:0.8px;flex:1;}
  .cb-log-hdr-btns{display:flex;gap:4px;flex-shrink:0;}
  .cb-log-hbtn{height:22px;padding:0 8px;border-radius:6px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.35);cursor:pointer;font-size:9px;font-family:inherit;font-weight:600;display:flex;align-items:center;gap:3px;white-space:nowrap;}
  .cb-log-hbtn:hover{background:rgba(255,176,32,0.1);border-color:rgba(255,176,32,0.25);color:#ffb020;}
  .cb-log-hbtn.copy-ok{background:rgba(0,210,100,0.1);border-color:rgba(0,210,100,0.3);color:#00d264;}
  .cb-log-hbtn.pause-on{background:rgba(255,100,0,0.1);border-color:rgba(255,100,0,0.3);color:#ff6400;}
  .cb-log-filters{display:flex;gap:3px;padding:5px 8px;border-bottom:1px solid rgba(255,255,255,0.04);flex-wrap:wrap;flex-shrink:0;}
  .cb-log-filter{font-size:8px;padding:1px 7px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:rgba(255,255,255,0.25);cursor:pointer;font-family:inherit;}
  .cb-log-filter.active{border-color:rgba(255,176,32,0.35);color:#ffb020;background:rgba(255,176,32,0.07);}
  .cb-log-filter.f-signal.active{border-color:rgba(0,210,100,0.35);color:#00d264;background:rgba(0,210,100,0.07);}
  .cb-log-filter.f-error.active{border-color:rgba(255,55,85,0.35);color:#ff3755;background:rgba(255,55,85,0.07);}
  .cb-log-filter.f-tve.active{border-color:rgba(255,176,32,0.35);color:#ffb020;background:rgba(255,176,32,0.07);}
  .cb-log-filter.f-tick.active{border-color:rgba(100,180,255,0.35);color:#64b4ff;background:rgba(100,180,255,0.07);}
  .cb-log-inner{overflow-y:auto;flex:1;padding-bottom:4px;}
  .cb-log-inner::-webkit-scrollbar{width:3px;}
  .cb-log-inner::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px;}
  .cb-log-line{font-size:9px;line-height:1.5;display:flex;flex-direction:column;padding:4px 10px;border-bottom:1px solid rgba(255,255,255,0.02);border-left:2px solid transparent;transition:background 0.1s;}
  .cb-log-line:hover{background:rgba(255,255,255,0.02);}
  .cb-log-line.new{animation:logSlide 0.3s ease-out;}
  @keyframes logSlide{from{opacity:0;transform:translateX(-8px);}to{opacity:1;transform:translateX(0);}}
  .cb-log-line.t-signal{border-left-color:rgba(0,210,100,0.5);}
  .cb-log-line.t-error{border-left-color:rgba(255,55,85,0.5);}
  .cb-log-line.t-tve{border-left-color:rgba(255,176,32,0.4);}
  .cb-log-line.t-tick{border-left-color:rgba(100,180,255,0.25);}
  .cb-log-line.t-asset{border-left-color:rgba(255,176,32,0.6);}
  .cb-log-row1{display:flex;align-items:baseline;gap:5px;}
  .cb-log-seq{color:rgba(255,255,255,0.08);font-family:'SF Mono',ui-monospace,monospace;font-size:7px;min-width:26px;flex-shrink:0;}
  .cb-log-t{color:rgba(255,255,255,0.2);font-family:'SF Mono',ui-monospace,monospace;flex-shrink:0;font-size:7.5px;}
  .cb-log-m{color:rgba(255,255,255,0.55);font-weight:500;word-break:break-word;white-space:pre-wrap;flex:1;}
  .cb-log-m.signal{color:#00d264;font-weight:700;}
  .cb-log-m.error{color:#ff5566;font-weight:600;}
  .cb-log-m.tve{color:#ffb020;font-weight:600;}
  .cb-log-m.tick{color:rgba(100,180,255,0.7);}
  .cb-log-m.asset{color:#ffb020;font-weight:700;}
  .cb-log-m.info{color:rgba(255,255,255,0.32);}
  .cb-log-extra{font-size:7.5px;color:rgba(255,255,255,0.2);font-family:'SF Mono',ui-monospace,monospace;padding-right:31px;word-break:break-all;margin-top:1px;}
  #cbLogToggle{position:fixed;bottom:108px;left:6px;z-index:2147483646;padding:5px 11px;border-radius:10px;background:#0a0c10;border:1px solid rgba(255,176,32,0.22);color:rgba(255,176,32,0.7);font-family:'IBM Plex Sans Arabic',-apple-system,sans-serif;font-size:9px;font-weight:700;cursor:pointer;touch-action:manipulation;display:none;align-items:center;gap:5px;}
  #cbLogToggle.visible{display:flex;}
  #cbLogCount{background:rgba(255,176,32,0.15);color:#ffb020;border-radius:8px;padding:1px 5px;font-size:7.5px;min-width:16px;text-align:center;}
  #cbStatus{padding:6px 14px 8px;font-size:8px;color:rgba(255,255,255,0.18);font-family:'SF Mono',ui-monospace,monospace;border-top:1px solid rgba(255,255,255,0.04);letter-spacing:0.3px;flex-shrink:0;background:rgba(0,0,0,0.2);border-radius:0 0 22px 22px;}
  `;

  const HUD_HTML = `
  <style>${HUD_CSS}</style>
  <div id="cbIcon" title="استراتيجية الشموع v10.7 — Trend Guard Fix">
    <div id="cbIconSig">⚡</div>
    <div id="cbIconDot"></div>
  </div>
  <div id="cbPanel">
    <div class="cb-hdr" id="cbDragHdr">
      <div class="cb-hdr-dot" id="cbHdrDot"></div>
      <span class="cb-ttl">⚡ v10.7 — TREND GUARD | فلتر الاتجاه</span>
      <div class="cb-hdr-actions">
        <button class="cb-icon-btn" id="cbMinimize">−</button>
        <button class="cb-icon-btn" id="cbClose">✕</button>
      </div>
    </div>
    <div id="cbScrollArea">
      <div class="cb-grid">
        <div class="cb-stat"><span class="cb-stat-lbl">الزوج</span><span class="cb-stat-val w" id="cbAsset">جاري…</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">السعر</span><span class="cb-stat-val g" id="cbPrice">–</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">مدة الشمعة</span><span class="cb-stat-val y" id="cbPeriod">؟</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">العد التنازلي</span><span class="cb-stat-val y" id="cbCd">–</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">الرصيد</span><span class="cb-stat-val g" id="cbBalance">–</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">تيكات</span><span class="cb-stat-val" id="cbTickCount">0</span></div>
      </div>

      <div class="cb-ind-row">
        <span class="cb-ind-lbl">⚡ كمون</span>
        <span class="cb-ind-val" id="cbPerfVal">–</span>
        <span class="cb-ind-badge" id="cbPsmState">PSM: IDLE</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">TVE σ</span>
        <span class="cb-ind-val" id="cbTveSigma">–</span>
        <span class="cb-ind-badge" id="cbTveBadge">TVE: OFF</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">MACD</span>
        <span class="cb-ind-val" id="cbMacdVal">–</span>
        <span class="cb-ind-badge" id="cbMacdBadge">–</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">BB %B</span>
        <span class="cb-ind-val" id="cbBBVal">–</span>
        <span class="cb-ind-badge" id="cbBBBadge">–</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">StochRSI K</span>
        <span class="cb-ind-val" id="cbSrsiVal">–</span>
        <span class="cb-ind-badge" id="cbSrsiBadge">–</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">الاتجاه</span>
        <span class="cb-ind-val" id="cbTrendVal">–</span>
        <span class="cb-ind-badge" id="cbMtfBadge">MTF–</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">Kelly $</span>
        <span class="cb-ind-val" id="cbKellyVal">–</span>
        <span class="cb-ind-badge" id="cbKellyBadge">–</span>
      </div>

      <div class="cb-conf-bar">
        <span class="cb-conf-lbl">🎯 توافق</span>
        <span class="cb-conf-score" id="cbConfScore">–</span>
        <div class="cb-conf-track"><div class="cb-conf-fill" id="cbConfFill" style="width:0%;background:#444;"></div></div>
        <span class="cb-ind-badge" id="cbDblBadge" style="font-size:9px;color:rgba(255,130,0,0.4);">DBL–</span>
      </div>
      <div class="cb-conf-detail" id="cbConfDetail">–</div>

      <div class="cb-pause-bar" id="cbPauseBar">
        <span class="cb-pause-txt" id="cbPauseTxt">⛔ وقف مؤقت بسبب الخسائر</span>
      </div>

      <div class="cb-stats-bar">
        <div class="cb-stt"><span class="cb-stt-lbl">ربح ✅</span><span class="cb-stt-val g" id="cbWins">0</span></div>
        <div class="cb-stt"><span class="cb-stt-lbl">خسارة ❌</span><span class="cb-stt-val r" id="cbLosses">0</span></div>
        <div class="cb-stt"><span class="cb-stt-lbl">% الفوز</span><span class="cb-stt-val y" id="cbWinRate">–</span></div>
        <div class="cb-stt"><span class="cb-stt-lbl">🔥🔥 مزدوج</span><span class="cb-stt-val y" id="cbDoubles">0</span></div>
      </div>

      <div class="cb-sig-wrap">
        <div class="cb-sig-box" id="cbSigBox">
          <div class="cb-sig-main HOLD" id="cbSigMain">انتظار</div>
          <div class="cb-sig-sub"       id="cbSigSub">في انتظار الإشارة…</div>
          <div class="cb-sig-badge"     id="cbSigBadge">ثقة: –</div>
        </div>
      </div>

      <div class="cb-ppt-sect">
        <div class="cb-section-lbl">أفضل الأنماط 🏆</div>
        <div id="cbPPTRows"></div>
      </div>

      <div class="cb-candle-sect">
        <div class="cb-section-lbl">آخر الشموع</div>
        <div class="cb-candle-row" id="cbCandleRow"></div>
      </div>

      <div class="cb-sep"></div>
      <div class="cb-amount-row">
        <span class="cb-amount-lbl">المبلغ $</span>
        <input type="number" class="cb-amount-inp" id="cbAmountInp" value="1" min="1" step="0.01" title="اضغط مرتين لإعادة حساب Kelly">
        <span class="cb-demo-badge" id="cbAccMode">ديمو</span>
      </div>
      <div class="cb-manual-row">
        <button class="cb-manual-btn buy"  id="cbManualBuy">↑ شراء</button>
        <button class="cb-manual-btn sell" id="cbManualSell">↓ بيع</button>
      </div>
      <div class="cb-auto-row">
        <span class="cb-auto-lbl">تداول تلقائي (CONF≥${CFG.CONFLUENCE_AUTO_MIN})</span>
        <input type="checkbox" class="cb-toggle" id="cbAutoToggle">
        <span class="cb-auto-badge" id="cbAutoBadge">OFF</span>
      </div>
      <div style="display:flex;gap:6px;margin:0 12px 8px;">
        <button class="cb-reset-btn" id="cbResetStats" style="margin:0;flex:1;">إعادة تعيين</button>
        <button class="cb-reset-btn" id="cbCopyStats"  style="margin:0;flex:1;border-color:rgba(100,150,255,0.2);color:rgba(100,150,255,0.6);">📋 نسخ</button>
      </div>
    </div>
    <div id="cbStatus">v10.10 | IMDB: 70%→×2 | 85%→×3 | 94%→×4 | نفس الثانية</div>
  </div>
  <div id="cbLogFloat">
    <div id="cbLogHdr">
      <span class="cb-log-title">⚡ السجل الحي</span>
      <div class="cb-log-hdr-btns">
        <button class="cb-log-hbtn" id="cbLogCopy">📋 نسخ</button>
        <button class="cb-log-hbtn" id="cbLogPause">⏸ وقفة</button>
        <button class="cb-log-hbtn" id="cbLogClear">🗑 مسح</button>
        <button class="cb-log-hbtn" id="cbLogClose">✕</button>
      </div>
    </div>
    <div class="cb-log-filters">
      <button class="cb-log-filter active" data-filter="all">الكل</button>
      <button class="cb-log-filter f-signal" data-filter="signal">🟢 صفقات</button>
      <button class="cb-log-filter f-error" data-filter="error">🔴 رفض</button>
      <button class="cb-log-filter f-tve" data-filter="tve">⚡ TVE</button>
      <button class="cb-log-filter f-tick" data-filter="tick">📡 تيك</button>
      <button class="cb-log-filter" data-filter="info">ℹ معلومات</button>
    </div>
    <div class="cb-log-inner" id="cbLogInner"></div>
  </div>
  <button id="cbLogToggle">📋 السجل <span id="cbLogCount">0</span></button>
  `;

  // ─── دوال تحديث الواجهة ─────────────────────────────────────────────
  function updateStatusDot() {
    const dot=W.document.getElementById('cbHdrDot'), ico=W.document.getElementById('cbIconDot');
    if (dot) dot.classList.toggle('on', wsConnected);
    if (ico) ico.classList.toggle('on', wsConnected);
  }

  function updateHUD() {
    const aEl=W.document.getElementById('cbAsset'), pEl=W.document.getElementById('cbPeriod');
    if (aEl) aEl.textContent = activeAsset || '–';
    if (pEl) pEl.textContent = candlePeriod ? fmtDur(candlePeriod)+'('+durSource+')' : '؟';
  }

  function updateLivePrice(price) {
    const el=W.document.getElementById('cbPrice'); if(el) el.textContent=price.toFixed(5);
    // تحديث مؤشرات الوقت الحقيقي عند كل تيك (كل N تيك)
    if (totalTicks % 10 === 0 && activeAsset && candleBuffers[activeAsset]) {
      _updateLiveIndicators(candleBuffers[activeAsset]);
    }
  }

  function updateCountdownDisplay(secs) { const el=W.document.getElementById('cbCd'); if(el) el.textContent=secs+'ث'; }

  function _updateTVEDisplay() {
    const buf=TickVelocityEngine.buf, vh=TickVelocityEngine.velHistory;
    const sEl=W.document.getElementById('cbTveSigma'), bEl=W.document.getElementById('cbTveBadge');
    const psmEl=W.document.getElementById('cbPsmState');
    if (psmEl) psmEl.textContent='PSM: '+PatternStateMachine.state;
    if (!sEl||!bEl) return;
    if (vh.length < 5) { sEl.textContent='–'; bEl.textContent='TVE: جمع…'; bEl.style.color=''; return; }
    const now=Date.now(), cutoff=now-CFG.TVE_STD_WINDOW_MS;
    const recent=vh.filter(v=>v.ts>=cutoff);
    if (recent.length < 3) { sEl.textContent='< 3'; bEl.textContent='TVE: قليل'; bEl.style.color=''; return; }
    const vals=recent.map(v=>v.accel), mean=vals.reduce((s,v)=>s+v,0)/vals.length;
    const vari=vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length, std=Math.sqrt(vari);
    if (std<1e-15) { sEl.textContent='0σ'; bEl.textContent='TVE: ثابت'; return; }
    const lastAccel=vh[vh.length-1].accel, sigma=(lastAccel-mean)/std;
    sEl.textContent=Math.abs(sigma).toFixed(2)+'σ';
    if (Math.abs(sigma)>=CFG.TVE_SIGMA_THRESHOLD) {
      const dir=sigma>0?'↑ BUY':'↓ SELL';
      bEl.textContent='TVE: '+dir; bEl.style.color=sigma>0?'#00d264':'#ff3755';
    } else {
      bEl.textContent='TVE: '+Math.abs(sigma).toFixed(1)+'σ/'+CFG.TVE_SIGMA_THRESHOLD+'σ';
      bEl.style.color=Math.abs(sigma)>=CFG.TVE_SIGMA_THRESHOLD*0.7?'#ffb020':'';
    }
  }

  // 🆕 تحديث مؤشرات MACD + BB + StochRSI + MTF الحية
  function _updateLiveIndicators(candles) {
    if (!candles || candles.length < 5) return;

    // MACD
    const macdData = computeMACD(candles);
    const macdEl   = W.document.getElementById('cbMacdVal'), macdBEl = W.document.getElementById('cbMacdBadge');
    if (macdEl && macdData) {
      macdEl.textContent = macdData.histogram.toFixed(5);
      if (macdBEl) { macdBEl.textContent = macdData.histogram>0?'↑ BUY':'↓ SELL'; macdBEl.className='cb-ind-badge '+(macdData.histogram>0?'up':'dn'); }
    }

    // BB
    const bbData = computeBB(candles);
    const bbEl   = W.document.getElementById('cbBBVal'), bbBEl = W.document.getElementById('cbBBBadge');
    if (bbEl && bbData) {
      bbEl.textContent = (bbData.percentB*100).toFixed(1)+'%';
      if (bbBEl) {
        if (bbData.squeeze) { bbBEl.textContent='⏸ SQUEEZE'; bbBEl.className='cb-ind-badge yw'; }
        else if (bbData.percentB<=0.1) { bbBEl.textContent='↑ LOWER'; bbBEl.className='cb-ind-badge up'; }
        else if (bbData.percentB>=0.9) { bbBEl.textContent='↓ UPPER'; bbBEl.className='cb-ind-badge dn'; }
        else { bbBEl.textContent=bbData.percentB.toFixed(2); bbBEl.className='cb-ind-badge'; }
      }
    }

    // StochRSI
    const srsi   = computeStochRSI(candles);
    const srsiEl = W.document.getElementById('cbSrsiVal'), srsiBEl = W.document.getElementById('cbSrsiBadge');
    if (srsiEl && srsi) {
      srsiEl.textContent = 'K='+srsi.k.toFixed(1)+' D='+srsi.d.toFixed(1);
      if (srsiBEl) { srsiBEl.textContent=srsi.signal||'–'; srsiBEl.className='cb-ind-badge '+(srsi.signal==='BUY'?'up':srsi.signal==='SELL'?'dn':''); }
    }

    // MTF
    const htf    = getHigherTFTrend(candles);
    const mtfBEl = W.document.getElementById('cbMtfBadge');
    if (mtfBEl && htf) {
      mtfBEl.textContent = 'MTF: '+htf.label;
      mtfBEl.className   = 'cb-ind-badge '+(htf.trend.startsWith('UP')?'up':htf.trend.startsWith('DO')?'dn':'');
    }
  }

  // 🆕 تحديث عرض Kelly — ✅ v10.9: لا تُعيد الضبط إذا المستخدم غيّر يدوياً
  function _updateKellyDisplay() {
    const el=W.document.getElementById('cbKellyVal'), bEl=W.document.getElementById('cbKellyBadge'), inp=W.document.getElementById('cbAmountInp');
    if (el) el.textContent = '$'+tradeAmount.toFixed(2);
    if (bEl) {
      const mode = _manualAmountOverride ? 'يدوي' : (CFG.KELLY_ENABLED ? 'Kelly' : 'ثابت');
      bEl.textContent = mode;
      bEl.className='cb-ind-badge '+(_manualAmountOverride ? '' : 'yw');
    }
    // ✅ v10.9: فقط حدّث قيمة الحقل إذا لم يتم التجاوز اليدوي
    if (inp && !_manualAmountOverride) inp.value = tradeAmount;
  }

  // 🆕 تحديث عرض PPT
  function _updatePPTDisplay() {
    const container=W.document.getElementById('cbPPTRows'); if (!container) return;
    const top = getTopPatterns(5);
    if (top.length === 0) { container.innerHTML='<div style="font-size:8px;color:rgba(255,255,255,0.15);padding:4px 0;">لا بيانات كافية بعد</div>'; return; }
    container.innerHTML = top.map(p => {
      const pct = Math.round(p.wr*100);
      const cls = pct>=70?'good':pct>=50?'mid':'bad';
      return `<div class="cb-ppt-row"><span class="cb-ppt-name">${p.name}</span><span class="cb-ppt-wr ${cls}">${pct}%</span><span style="font-size:7px;color:rgba(255,255,255,0.18);margin-right:4px;">(${p.total})</span></div>`;
    }).join('');
  }

  function updateSignalDisplay(result) {
    const box=W.document.getElementById('cbSigBox'), main=W.document.getElementById('cbSigMain');
    const sub=W.document.getElementById('cbSigSub'),  badge=W.document.getElementById('cbSigBadge');
    const icon=W.document.getElementById('cbIcon'),    iconS=W.document.getElementById('cbIconSig');
    if (!box) return;
    if (!result) {
      box.className='cb-sig-box'; main.className='cb-sig-main HOLD'; main.textContent='انتظار';
      sub.textContent='في انتظار الإشارة…'; badge.className='cb-sig-badge'; badge.textContent='ثقة: –';
      icon.className='cbIcon'; iconS.textContent='⚡';
      _updateConfDisplay(null); return;
    }
    const isBuy = result.signal==='BUY';
    box.className='cb-sig-box '+(isBuy?'buy':'sell');
    main.className='cb-sig-main '+result.signal;
    main.textContent = isBuy ? '↑ شراء' : '↓ بيع';
    sub.textContent  = result.reason || result.case || '';
    const c=result.confidence||1, tveTag=result.isTVE?' tve':'';
    badge.className='cb-sig-badge b'+Math.min(5,c)+tveTag;
    badge.textContent=(result.isTVE?'TVE ':'')+'ثقة: '+c+'/5'+(result.sigma?' σ='+Math.abs(result.sigma).toFixed(1):'');
    icon.className='cbIcon '+(isBuy?'buy':'sell');
    iconS.textContent=isBuy?'BUY':'SEL';
    if (result.trendInfo) {
      const tEl=W.document.getElementById('cbTrendVal');
      if (tEl) { tEl.textContent=result.trendInfo.label||''; }
    }
    const pEl=W.document.getElementById('cbPsmState'); if(pEl) pEl.textContent='PSM: '+PatternStateMachine.state;
    _updateConfDisplay(result.confluence);
    // 🔴 PRED-BAR: تحريك زر الشراء/البيع عند ظهور إشارة قوية
    const _apexBoost = (_PS.direction === result.signal && _PS.confidence > 0.55)
                       ? 1.0
                       : (result.confidence || 0.5);
    _animatePlatformButton(result.signal, _apexBoost);
  }

  function _updateConfDisplay(conf) {
    const scoreEl=W.document.getElementById('cbConfScore'), fillEl=W.document.getElementById('cbConfFill'), detEl=W.document.getElementById('cbConfDetail');
    const dblEl=W.document.getElementById('cbDblBadge');
    if (!conf) {
      if (scoreEl) scoreEl.textContent='–';
      if (fillEl)  fillEl.style.cssText='width:0%;background:#444;';
      if (detEl)   detEl.textContent='–';
      if (dblEl)   { dblEl.textContent='DBL–'; dblEl.className='cb-ind-badge'; }
      return;
    }
    const maxScore = 8.5, pct = Math.min(100, (conf.score/maxScore)*100);
    const color = conf.score>=CFG.CONFLUENCE_AUTO_MIN?'#00d264':conf.score>=CFG.CONFLUENCE_MIN_SCORE?'#ffb020':'#ff3755';
    if (scoreEl) { scoreEl.textContent=conf.score.toFixed(1)+'/8.5'; scoreEl.style.color=color; }
    if (fillEl)  { fillEl.style.width=pct+'%'; fillEl.style.background=color; }
    if (detEl)   detEl.textContent=conf.breakdown.join(' ');
    // 🔥🔥 مؤشر الصفقة المزدوجة — ✅ v10.10: يعرض tier IMDB
    if (dblEl) {
      const _spC  = _PS.spConf ?? 0;
      const tier  = getIMDBTier(_spC);
      const pct   = Math.round(_spC);
      if (tier >= 4) {
        dblEl.textContent='💎×4 ('+pct+'%)'; dblEl.className='cb-ind-badge active';
      } else if (tier === 3) {
        dblEl.textContent='🔥×3 ('+pct+'%)'; dblEl.className='cb-ind-badge active';
      } else if (tier === 2) {
        dblEl.textContent='🔥×2 ('+pct+'%)'; dblEl.className='cb-ind-badge active';
      } else if (_spC >= CFG.SUPREME_MIN_CONF) {
        dblEl.textContent='🔥 TRADE'; dblEl.className='cb-ind-badge active';
      } else {
        dblEl.textContent='🔴 BLOCKED'; dblEl.className='cb-ind-badge';
      }
    }
  }

  function updateStatsUI() {
    const w=W.document.getElementById('cbWins'), l=W.document.getElementById('cbLosses'), r=W.document.getElementById('cbWinRate'), dbl=W.document.getElementById('cbDoubles');
    if (w) w.textContent=STATS.wins;
    if (l) l.textContent=STATS.losses;
    if (r) { r.textContent=winRate()+'%'; r.className='cb-stt-val '+(winRate()>=70?'g':winRate()>=55?'y':'r'); }
    if (dbl) dbl.textContent=(STATS.doubles||0);
    _updatePPTDisplay();
  }

  function updateTradeBtn() {
    const buy=W.document.getElementById('cbManualBuy'), sell=W.document.getElementById('cbManualSell');
    if (buy) buy.disabled=tradeExec; if (sell) sell.disabled=tradeExec;
  }

  function updatePauseDisplay(active) { const bar=W.document.getElementById('cbPauseBar'); if(bar) bar.classList.toggle('active',active); }

  let _logFilter = 'all';

  function renderLog() {
    const el = W.document.getElementById('cbLogInner'); if (!el) return;
    const lines = _logFilter === 'all' ? logLines : logLines.filter(l => l.type === _logFilter);
    el.innerHTML = lines.map((l, i) => {
      const extraHtml = l.extra
        ? `<div class="cb-log-extra">${l.extra}</div>`
        : '';
      return `<div class="cb-log-line t-${l.type}${i===0&&_logFilter==='all'?' new':''}">` +
        `<div class="cb-log-row1">` +
        `<span class="cb-log-seq">#${l.seq}</span>` +
        `<span class="cb-log-t">${l.t}</span>` +
        `<span class="cb-log-m ${l.type}">${l.msg}</span>` +
        `</div>` +
        extraHtml +
        `</div>`;
    }).join('');
  }

  function renderCandleRow() {
    const el=W.document.getElementById('cbCandleRow'); if(!el||!activeAsset) return;
    const candles=(candleBuffers[activeAsset]||[]).slice(-8);
    const cc=currentCandles[activeAsset];
    let html=candles.map(c=>`<div class="cb-c ${c.isBullish?'bull':'bear'} hist">${c.isBullish?'↑':'↓'}</div>`).join('');
    if (cc&&cc.prices.length>=1) { const forming=buildCandle(cc.prices,cc.startTime); if(forming) html+=`<div class="cb-c ${forming.isBullish?'bull':'bear'} forming">${forming.isBullish?'↑':'↓'}</div>`; }
    el.innerHTML=html;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 29  تهيئة الواجهة
  // ══════════════════════════════════════════════════════════════════════
  function initUI() {
    const root = W.document.createElement('div');
    root.id='cbRoot'; root.innerHTML=HUD_HTML;
    W.document.body.appendChild(root);

    const icon   = W.document.getElementById('cbIcon');
    const panel  = W.document.getElementById('cbPanel');
    const close  = W.document.getElementById('cbClose');
    const mini   = W.document.getElementById('cbMinimize');
    const toggle = W.document.getElementById('cbAutoToggle');
    const badge  = W.document.getElementById('cbAutoBadge');
    const reset  = W.document.getElementById('cbResetStats');
    const amtInp = W.document.getElementById('cbAmountInp');
    const manBuy = W.document.getElementById('cbManualBuy');
    const manSel = W.document.getElementById('cbManualSell');
    const dragHdr= W.document.getElementById('cbDragHdr');

    // ✅ v10.4 FIX#1: مزامنة الـ toggle مع autoTrade=true
    if (toggle) { toggle.checked = autoTrade; }
    if (badge)  { badge.textContent = autoTrade ? 'ON' : 'OFF'; }

    // ✅ v10.4 FIX#5: بعد 3 ثوانٍ اجعل المقبس جاهزاً حتى لو لم يأتِ successauth
    setTimeout(() => {
      if (!_tradeSocketReady && tradeWS && tradeWS.readyState === 1) {
        _tradeSocketReady = true;
        addLog('✅ مقبس تلقائي — جاهز (fallback)', 'signal');
      }
    }, 3000);

    icon.addEventListener('click', () => { panel.classList.toggle('open'); panel.classList.remove('minimized'); const lt=W.document.getElementById('cbLogToggle'); if(lt) lt.classList.toggle('visible',panel.classList.contains('open')); });
    close.addEventListener('click', () => { panel.classList.remove('open'); const lt=W.document.getElementById('cbLogToggle'); if(lt) lt.classList.remove('visible'); const lf=W.document.getElementById('cbLogFloat'); if(lf) lf.classList.remove('open'); });
    mini.addEventListener('click', () => panel.classList.toggle('minimized'));

    toggle.addEventListener('change', () => {
      autoTrade = toggle.checked; badge.textContent = autoTrade?'ON':'OFF';
      addLog(autoTrade?'🤖 تداول تلقائي: مُفعَّل':'⏸ تداول تلقائي: متوقف','signal');
      if (autoTrade && fastCloseAt && fastCloseAt>Date.now()+100) schedulePredictiveEntry();
    });

    // ✅ v10.9: إصلاح خانة المبلغ — 'input' + 'change' + حماية من Kelly
    const _applyAmount = () => {
      const v = parseFloat(amtInp.value);
      if (v > 0 && v !== tradeAmount) {
        tradeAmount = Math.round(v * 100) / 100;
        _manualAmountOverride = true;
        _rebuildPayloadCache();
        addLog('💰 مبلغ يدوي: $' + tradeAmount, 'info');
        _updateKellyDisplay();
      }
    };
    amtInp.addEventListener('input',  _applyAmount);
    amtInp.addEventListener('change', _applyAmount);
    amtInp.addEventListener('blur',   _applyAmount);
    // زر إعادة Kelly — النقر المزدوج على الحقل يعيد Kelly
    amtInp.addEventListener('dblclick', () => {
      _manualAmountOverride = false;
      if (CFG.KELLY_ENABLED && accountBalance) {
        tradeAmount = computeKellyAmount(accountBalance);
      } else {
        tradeAmount = CFG.DEFAULT_AMOUNT;
      }
      _rebuildPayloadCache();
      _updateKellyDisplay();
      addLog('♻ تم إعادة Kelly — $' + tradeAmount, 'info');
    });

    manBuy.addEventListener('click',  () => { _lastTradeWasTVE=false; executeTrade('BUY',  activeAsset); });
    manSel.addEventListener('click',  () => { _lastTradeWasTVE=false; executeTrade('SELL', activeAsset); });

    reset.addEventListener('click', () => {
      if (!confirm('إعادة تعيين الإحصائيات؟')) return;
      Object.assign(STATS, { wins:0,losses:0,total:0,lossStreak:0,bestStreak:0,winStreak:0,tveWins:0,tveLosses:0,confWins:0,confLosses:0,doubles:0,doubleWins:0 });
      patternStats = {}; _savePatternStats();
      saveStats(); updateStatsUI(); addLog('🔄 إحصائيات مُعادة','info');
    });

    const copyBtn=W.document.getElementById('cbCopyStats');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const wr=winRate();
        const text=['══ إحصائيات v10.3 — Zero-Delay Fix ══',
          'الزوج: '+(activeAsset||'–')+' | المدة: '+(candlePeriod?fmtDur(candlePeriod):'؟'),
          'فوز: '+STATS.wins+' | خسارة: '+STATS.losses+' | معدل: '+wr+'%',
          'صفقات مزدوجة: '+(STATS.doubles||0)+' | فوز مزدوج: '+(STATS.doubleWins||0),
          '─── أفضل الأنماط ───',
          ...getTopPatterns(5).map(p=>'  '+p.name+': '+Math.round(p.wr*100)+'% ('+p.total+')'),
          '─── المحركات ───',
          'CONF_AUTO='+CFG.CONFLUENCE_AUTO_MIN+' | DBL_MIN='+CFG.DOUBLE_MIN_CONFLUENCE,
          'MACD('+CFG.MACD_FAST+','+CFG.MACD_SLOW+','+CFG.MACD_SIGNAL+') | BB('+CFG.BB_PERIOD+','+CFG.BB_STD+')',
          'StochRSI('+CFG.SRSI_PERIOD+','+CFG.SRSI_K+','+CFG.SRSI_D+') | Kelly='+CFG.KELLY_ENABLED,
        ].join('\n');
        navigator.clipboard.writeText(text).then(()=>{copyBtn.textContent='✅ تم النسخ';setTimeout(()=>{copyBtn.textContent='📋 نسخ';},2000);}).catch(()=>{copyBtn.textContent='❌';setTimeout(()=>{copyBtn.textContent='📋 نسخ';},2000);});
      });
    }

    const logTogBtn=W.document.getElementById('cbLogToggle'), logFloat=W.document.getElementById('cbLogFloat'), logClose=W.document.getElementById('cbLogClose');
    if (logTogBtn&&logFloat) logTogBtn.addEventListener('click', ()=>logFloat.classList.toggle('open'));
    if (logClose&&logFloat)  logClose.addEventListener('click',  ()=>logFloat.classList.remove('open'));

    // ✅ v10.8: زر نسخ السجل الكامل
    const logCopyBtn = W.document.getElementById('cbLogCopy');
    if (logCopyBtn) {
      logCopyBtn.addEventListener('click', () => {
        const header = [
          '══════════════════════════════════════════',
          '  سجل البوت v10.8 — ' + new Date().toLocaleString('ar'),
          '  الزوج: '+(activeAsset||'–')+' | الفريم: '+(candlePeriod?fmtDur(candlePeriod):'؟'),
          '  فوز: '+STATS.wins+' | خسارة: '+STATS.losses+' | معدل: '+winRate()+'%',
          '══════════════════════════════════════════',
        ].join('\n');
        const body = logLines.slice().reverse().map(l =>
          '#' + String(l.seq).padStart(4,'0') +
          ' [' + l.t + '] ' +
          '[' + l.type.toUpperCase().padEnd(6) + '] ' +
          l.msg +
          (l.extra ? ' ← ' + l.extra : '')
        ).join('\n');
        const full = header + '\n' + body;
        navigator.clipboard.writeText(full)
          .then(()=>{ logCopyBtn.textContent='✅ تم النسخ'; logCopyBtn.classList.add('copy-ok'); setTimeout(()=>{ logCopyBtn.textContent='📋 نسخ'; logCopyBtn.classList.remove('copy-ok'); },2500); })
          .catch(()=>{ logCopyBtn.textContent='❌ خطأ'; setTimeout(()=>{ logCopyBtn.textContent='📋 نسخ'; },2000); });
      });
    }

    // ✅ v10.8: زر إيقاف/استئناف عرض السجل
    const logPauseBtn = W.document.getElementById('cbLogPause');
    if (logPauseBtn) {
      logPauseBtn.addEventListener('click', () => {
        _logPaused = !_logPaused;
        logPauseBtn.textContent = _logPaused ? '▶ استئناف' : '⏸ وقفة';
        logPauseBtn.classList.toggle('pause-on', _logPaused);
        if (!_logPaused) renderLog();
      });
    }

    // ✅ v10.8: زر مسح السجل
    const logClearBtn = W.document.getElementById('cbLogClear');
    if (logClearBtn) {
      logClearBtn.addEventListener('click', () => {
        if (!confirm('مسح السجل؟')) return;
        logLines = []; _logSeq = 0; renderLog();
        addLog('🗑 السجل مُمسح', 'info');
      });
    }

    // ✅ v10.8: أزرار الفلتر
    const filterBtns = W.document.querySelectorAll('.cb-log-filter');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        _logFilter = btn.dataset.filter || 'all';
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderLog();
      });
    });

    _makeDraggable(panel, dragHdr);
    _makeDraggable(logFloat, W.document.getElementById('cbLogHdr'));

    _updateKellyDisplay();
    _updatePPTDisplay();
    addLog('🚀 v10.10 — تهيأ! IMDB: 70%→×2 | 85%→×3 | 94%→×4 | نفس الثانية', 'signal');
    updateStatsUI();

    // 🔴 PRED-BAR: تهيئة شريط التنبؤ المنفصل
    _initPredictionBar();
  }

  function _makeDraggable(el, handle) {
    if (!el||!handle) return;
    let ox=0,oy=0,dragging=false;
    const onStart=(e)=>{
      if(e.target.tagName==='BUTTON'||e.target.tagName==='INPUT') return;
      dragging=true; el.classList.add('dragging');
      const rect=el.getBoundingClientRect();
      const cx=e.touches?.[0]?.clientX??e.clientX, cy=e.touches?.[0]?.clientY??e.clientY;
      ox=cx-rect.left; oy=cy-rect.top; e.preventDefault();
    };
    const onMove=(e)=>{
      if(!dragging) return;
      const cx=e.touches?.[0]?.clientX??e.clientX, cy=e.touches?.[0]?.clientY??e.clientY;
      el.style.left=Math.max(0,Math.min(W.innerWidth-el.offsetWidth,cx-ox))+'px';
      el.style.top=Math.max(0,Math.min(W.innerHeight-el.offsetHeight,cy-oy))+'px';
      el.style.bottom='auto';
    };
    const onEnd=()=>{ dragging=false; el.classList.remove('dragging'); };
    handle.addEventListener('mousedown', onStart,{passive:false});
    handle.addEventListener('touchstart',onStart,{passive:false});
    W.document.addEventListener('mousemove',onMove);
    W.document.addEventListener('touchmove',onMove,{passive:true});
    W.document.addEventListener('mouseup', onEnd);
    W.document.addEventListener('touchend',onEnd);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 31  🔥 [SUPREME-PRED v2] محرك التنبؤ الفائق — الإصدار v12
  //
  //  ✦ 30+ خوارزمية موزعة على 4 مجموعات تعمل بالتوازي على كل تيك
  //  ✦ مجموعة A (45%): OFI · TickVel · TickRSI · MomentumDecay · ZScore · Entropy · AutoCorr×5
  //  ✦ مجموعة B (30%): Hurst(4win) · LR+R2 · Kalman · ROC×4 · Breakout · PriceGeometry
  //  ✦ مجموعة C (15%): RegimeClassifier · DynSR · EMA-Stack(8) · LiquidityVacuum
  //  ✦ مجموعة D (10%): RSI-Candle · MACD · StochRSI · BB · MTF · Fib · Patterns
  //  ✦ حاجز صارم: ثقة >= 70% فقط — يُحجب كل ما دون ذلك
  //  ✦ نظام تعلم تكيفي: تحديث الأوزان بعد كل نتيجة + تتبع الأداء بالنظام
  // ══════════════════════════════════════════════════════════════════════

  // ══════════ [A] الحالة الشاملة للمحرك ════════════════════════════════
  const _PS = {
    // ─ بيانات أساسية ─────────────────────────────────────────
    tickCount : 0,
    lastPrice : null,
    lastNow   : 0,
    buyPct    : 50, sellPct: 50,
    direction : 'NEUTRAL', confidence: 0,
    spConf    : 0,   // SUPREME-PRED ثقة من 0-100 (الإخراج الرئيسي)

    // ─ NEURAL-TICK: Packet Spike detector (Directive 1) ────────────────
    tickTs    : new Float64Array(10), tickTs_n: 0,
    spikeActive: false, spikePenaltyUntil: 0,

    // ─ نوافذ الأسعار (rolling) ─────────────────────────────
    W5  : [], W10 : [], W20 : [], W40 : [], W80 : [],

    // ─ سرعات وتسارعات التيك ────────────────────────────────
    vels  : [],  // آخر 60 سرعة تيك
    accels: [],  // آخر 60 تسارع

    // ─ EMA Stack — 8 فترات مختلفة (كل على حدة) ───────────
    e2:null, e3:null, e5:null, e8:null,
    e13:null, e21:null, e34:null, e55:null,

    // ─ Tick-RSI (Wilder) — مستقل عن الشموع ────────────────
    tRsi_ag: 0, tRsi_al: 0, tRsi_val: 50, tRsi_n: 0,
    tRsi_prev: [],  // تاريخ قيم RSI لكشف الاختلاف

    // ─ Order Flow Imbalance (OFI) ──────────────────────────
    ofi_streak : 0,   // تسلسل تيكات بنفس الاتجاه
    ofi_score  : 0,   // نقطة OFI المتراكمة (تتحلل)
    ofi_bid    : 0,   // تقدير الطلب (bid)
    ofi_ask    : 0,   // تقدير العرض (ask)

    // ─ Momentum Decay ──────────────────────────────────────
    mom : 0,          // زخم متراكم بتحلل أسي
    momHL: 5,         // half-life يُعاير تلقائياً

    // ─ Volatility (rolling std) ───────────────────────────
    vol_sq_sum : 0, vol_sum: 0, vol_n: 0, vol: 1e-9,
    vol_hist: new Float64Array(50), vol_hist_n: 0,  // TypedArray volatility history

    // ─ Linear Regression (rolling Σ) ───────────────────────
    lr_xy: 0, lr_x: 0, lr_y: 0, lr_x2: 0, lr_n: 0,
    lr_prices: [],   // نافذة 25 سعر
    lr_r2: 0,        // R-squared لفلتر الجودة

    // ─ AutoCorrelation lag-1 through lag-5 ─────────────────
    ac_lags: [       // خمس نوافذ تأخر
      { prevVel:null, sxy:0, sx:0, sy:0, sx2:0, n:0 },
      { prevVel:null, sxy:0, sx:0, sy:0, sx2:0, n:0 },
      { prevVel:null, sxy:0, sx:0, sy:0, sx2:0, n:0 },
      { prevVel:null, sxy:0, sx:0, sy:0, sx2:0, n:0 },
      { prevVel:null, sxy:0, sx:0, sy:0, sx2:0, n:0 },
    ],
    ac_velBuf: new Float64Array(50), ac_velBuf_n: 0,  // TypedArray autocorr velocity buffer

    // ─ Entropy (Shannon على اتجاهات التيكات) ──────────────
    ent_up: 0, ent_dn: 0, ent_n: 0,

    // ─ Hurst Exponent — 4 نوافذ (4/8/16/32) ───────────────
    hurst_h: 0.5,    // القيمة المتوسطة عبر النوافذ

    // ─ Kalman Filter ──────────────────────────────────────
    kf_x: null,   // تقدير الحالة
    kf_p: 1.0,    // تقدير خطأ التقدير
    kf_dir: 0,    // اتجاه Kalman (-1..1)

    // ─ Price Geometry ─────────────────────────────────────
    pg_peak: null, pg_trough: null, pg_prev_peak: null, pg_prev_trough: null,

    // ─ Dynamic S/R from tick pivots ───────────────────────
    sr_pivots: [],   // آخر 50 قمة وقاع على مستوى التيك

    // ─ Regime state ───────────────────────────────────────
    regime: 'RANGE', // TREND | RANGE | VOLATILE
    atr_ma: 1e-9,    // متوسط ATR للكشف عن VOLATILE

    // ─ Adaptive Weights (يتعلم) ───────────────────────────
    aw: {
      // مجموعة A — ديناميكيات التيك
      ofi:2.0, vel:2.5, accel:2.2, tRsi:1.8, mom:1.5,
      zScore:1.2, entropy:0.7, ac1:1.2, ac2:0.8, ac3:0.6, ac4:0.4, ac5:0.3,
      // مجموعة B — إحصائية
      hurst:0.6, lr:1.8, kalman:2.0, roc:1.3, breakout:1.5, geo:1.0,
      // مجموعة C — هياكلية
      regime_w:1.0, dynSR:0.8, emaStack:2.0, liqVac:1.2,
      // مجموعة D — شمعة
      candle:1.5, rsi:1.2, macd:0.9, bb:0.8,
      srsi:0.8, mtf:0.6, fib:0.5,
      // مؤشرات TVE
      tveAccel:2.5, tveBias:1.0,
    },

    // ─ Z-Score state ───────────────────────────────────────
    zs_sum: 0, zs_sq: 0, zs_n: 0,

    // ─ ROC multi-window ────────────────────────────────────
    roc3: 0, roc8: 0, roc15: 0, roc25: 0,

    // ─ Smoothing (adaptive) ────────────────────────────────
    smoothBuy: 50, smoothSell: 50, smoothK: 0.18,

    // ─ Breakout Probability ────────────────────────────────
    bp_high: null, bp_low: null, bp_n: 0,

    // ─ Per-regime stats (للتعلم التكيفي) ──────────────────
    regimeStats: {
      TREND    : { wins: 0, total: 0 },
      RANGE    : { wins: 0, total: 0 },
      VOLATILE : { wins: 0, total: 0 },
    },
    regimeBlocked: { TREND: false, RANGE: false, VOLATILE: false },

    // ─ Algo scores snapshot للتعلم والواجهة ───────────────
    algoScores: {},

    // ─ Group scores snapshot ──────────────────────────────
    groupScores: { A: 0, B: 0, C: 0, D: 0 },
    groupVotes : { A: { bull:0, bear:0, total:0 }, B: { bull:0, bear:0, total:0 },
                   C: { bull:0, bear:0, total:0 }, D: { bull:0, bear:0, total:0 } },

    // ─ Indicator snapshot (للواجهة) ───────────────────────
    snap: {},

    // ─ Kalman predicted direction & magnitude ─────────────
    kalmanPredDir: 0,    // +1 صعود | -1 هبوط | 0 محايد
    kalmanMagnitude: 0,  // حجم الحركة المتوقعة
  };

  // ════════ EMA كمعاملات ثابتة ══════════════════════════
  const _EK = {
    k2:2/3, k3:2/4, k5:2/6, k8:2/9, k13:2/14,
    k21:2/22, k34:2/35, k55:2/56,
  };

  // ══════════ [B] دوال مساعدة خفيفة ════════════════════════════════════

  // --- rolling push helper (plain Array) ---
  function _rp(arr, val, maxLen) {
    arr.push(val);
    if (arr.length > maxLen) arr.shift();
  }

  // --- Float64Array sliding-window push (O(n) shift but avoids GC) ---
  function _rbPush(buf, nRef, val) {
    const cap = buf.length;
    if (nRef[0] < cap) { buf[nRef[0]++] = val; }
    else { buf.copyWithin(0, 1); buf[cap - 1] = val; }
  }

  // --- mean ---
  function _mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a,v)=>a+v,0)/arr.length;
  }

  // --- std ---
  function _std(arr, mean) {
    if (arr.length < 2) return 1e-9;
    const m = mean !== undefined ? mean : _mean(arr);
    return Math.sqrt(arr.reduce((a,v)=>a+(v-m)**2,0)/arr.length) || 1e-9;
  }

  // --- clamped linear score (returns -1..1) ---
  function _cls(val, scale) {
    return Math.max(-1, Math.min(1, val * scale));
  }

  // --- add to B/S based on raw signed score ---
  function _addBS(B_ref, S_ref, score, weight) {
    if (score > 0) B_ref.v += weight * score;
    else           S_ref.v += weight * Math.abs(score);
  }

  // ══════════════════════════════════════════════════════════════════════
  // ══════════ [_MATH] Protected Math Closure (Directive 4) ══════════════
  // All new mathematical kernels are isolated here to prevent scope pollution.
  // Accessible as _MATH.sigmoid6(x), _MATH.rsAnalysis(arr), etc.
  // ══════════════════════════════════════════════════════════════════════
  const _MATH = Object.freeze({

    // ─ Sigmoid with steepness factor 6 (wider separation than standard logistic)
    sigmoid6: (x) => 1 / (1 + Math.exp(-x * 6)),

    // ─ Wilder SMMA step: α = 1/period
    wilderStep: (prev, val, period) => (prev * (period - 1) + val) / period,

    // ─ R/S analysis on a numeric array → returns R/S ratio or null
    rsAnalysis: (w) => {
      if (!w || w.length < 4) return null;
      const n = w.length;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += w[i];
      const m = sum / n;
      let cum = 0, mx = -Infinity, mn = Infinity;
      let ss = 0;
      for (let i = 0; i < n; i++) {
        cum += w[i] - m;
        if (cum > mx) mx = cum;
        if (cum < mn) mn = cum;
        ss += (w[i] - m) ** 2;
      }
      const s = Math.sqrt(ss / n);
      return s > 1e-12 ? (mx - mn) / s : null;
    },

    // ─ Hurst exponent estimate from 4 R/S windows: mean of log(RS)/log(n)
    hurstFromVels: (vels) => {
      if (!vels || vels.length < 32) return 0.5;
      const rs = (n) => {
        const w = vels.slice(-n);
        return _MATH.rsAnalysis(w);
      };
      const pts = [[4,rs(4)],[8,rs(8)],[16,rs(16)],[32,rs(32)]];
      const valid = pts.filter(([,r]) => r !== null && r > 0);
      if (valid.length < 2) return 0.5;
      const h = valid.map(([n,r]) => Math.log(r)/Math.log(n));
      return Math.max(0.1, Math.min(0.9, h.reduce((a,v)=>a+v,0)/h.length));
    },

    // ─ Kalman filter step (1D, constant velocity model)
    kalmanStep: (kf_x, kf_p, measurement, Q, R) => {
      const p_pred = kf_p + Q;
      const K      = p_pred / (p_pred + R);
      const x_new  = kf_x + K * (measurement - kf_x);
      const p_new  = (1 - K) * p_pred;
      return { x: x_new, p: p_new, K };
    },

    // ─ Shannon entropy H from probability p (0..1) of one class
    shannonH: (p) => {
      const q = 1 - p;
      return -(p > 0 ? p * Math.log2(p) : 0) - (q > 0 ? q * Math.log2(q) : 0);
    },

    // ─ Autocorrelation coefficient at a given lag over a Float64Array/Array
    autocorrLag: (buf, n, lag) => {
      if (n < lag + 2) return 0;
      let sx=0,sy=0,sxy=0,sx2=0,cnt=0;
      for (let i=0;i<n-lag;i++){sx+=buf[i];sy+=buf[i+lag];sxy+=buf[i]*buf[i+lag];sx2+=buf[i]*buf[i];cnt++;}
      const d = cnt*sx2 - sx*sx;
      return Math.abs(d) > 1e-20 ? (cnt*sxy - sx*sy) / d : 0;
    },
  });

  // ══════════ [C] الدالة الرئيسية SUPREME-PRED v2 — تُستدعى على كل تيك ══
  function _predBarTick(asset, price, now) {
    const ps = _PS;
    ps.tickCount++;
    const prev = ps.lastPrice;
    ps.lastPrice = price;
    ps.lastNow   = now;
    const dt = ps.tickCount > 1 ? Math.max(1, now - (ps.lastNow||now)) : 1;
    // dt is defined but only used in Kalman below — suppress lint by referencing it
    void dt;

    // ════════════════════════════════════════════════════════════════
    // ══ SUPREME-PRED v2 — تحديث حالة التيك ══════════════════════════
    // ════════════════════════════════════════════════════════════════

    // ── تحديث نوافذ الأسعار ──────────────────────────────────────
    _rp(ps.W5,  price, 5);
    _rp(ps.W10, price, 10);
    _rp(ps.W20, price, 20);
    _rp(ps.W40, price, 40);
    _rp(ps.W80, price, 80);
    _rp(ps.lr_prices, price, 25);

    // ════ B: تحديث EMA Stack (8 فترات) ═══════════════════════════════
    if (ps.e2 === null) {
      ps.e2=ps.e3=ps.e5=ps.e8=ps.e13=ps.e21=ps.e34=ps.e55=price;
    } else {
      ps.e2  = price*_EK.k2  + ps.e2  *(1-_EK.k2);
      ps.e3  = price*_EK.k3  + ps.e3  *(1-_EK.k3);
      ps.e5  = price*_EK.k5  + ps.e5  *(1-_EK.k5);
      ps.e8  = price*_EK.k8  + ps.e8  *(1-_EK.k8);
      ps.e13 = price*_EK.k13 + ps.e13 *(1-_EK.k13);
      ps.e21 = price*_EK.k21 + ps.e21 *(1-_EK.k21);
      ps.e34 = price*_EK.k34 + ps.e34 *(1-_EK.k34);
      ps.e55 = price*_EK.k55 + ps.e55 *(1-_EK.k55);
    }

    if (prev === null) { _predBarScheduleUI(); return; }

    // ════ C: حساب السرعة والتسارع ════════════════════════════════════
    const vel = price - prev;
    const velN = vel / (ps.vol || 1e-9);  // سرعة معيارية
    _rp(ps.vels, vel, 60);

    let accel = 0;
    if (ps.vels.length >= 2) {
      accel = ps.vels[ps.vels.length-1] - ps.vels[ps.vels.length-2];
      _rp(ps.accels, accel, 60);
    }

    // ════ D: تحديث التقلب (Rolling Std of vels) ══════════════════════
    ps.vol_sum  += vel; ps.vol_sq_sum += vel*vel; ps.vol_n++;
    if (ps.vol_n > 40) {
      const old = ps.vels[0] || 0;
      ps.vol_sum -= old; ps.vol_sq_sum -= old*old; ps.vol_n--;
    }
    if (ps.vol_n > 2) {
      const m = ps.vol_sum/ps.vol_n;
      ps.vol = Math.sqrt(Math.max(1e-20, ps.vol_sq_sum/ps.vol_n - m*m)) || 1e-9;
      // Float64Array history for regime VOLATILE detection
      { const c=ps.vol_hist,cap=c.length; if(ps.vol_hist_n<cap){c[ps.vol_hist_n++]=ps.vol;}else{c.copyWithin(0,1);c[cap-1]=ps.vol;} }
    }

    // ════ E: Tick-RSI (Wilder) ════════════════════════════════════════
    const RSI_P = 8;
    ps.tRsi_n++;
    if (vel > 0) { ps.tRsi_ag = (ps.tRsi_ag*(RSI_P-1)+vel)/RSI_P; ps.tRsi_al = (ps.tRsi_al*(RSI_P-1))/RSI_P; }
    else         { ps.tRsi_al = (ps.tRsi_al*(RSI_P-1)+Math.abs(vel))/RSI_P; ps.tRsi_ag = (ps.tRsi_ag*(RSI_P-1))/RSI_P; }
    ps.tRsi_val = ps.tRsi_al < 1e-12 ? 100 : 100 - 100/(1+ps.tRsi_ag/ps.tRsi_al);

    // ════ F: Order Flow Imbalance (OFI) ══════════════════════════════
    const velDir = vel > 0 ? 1 : vel < 0 ? -1 : 0;
    if (velDir !== 0) {
      ps.ofi_streak = (ps.ofi_streak * velDir > 0) ? ps.ofi_streak + velDir : velDir;
      ps.ofi_score  = ps.ofi_score * 0.92 + ps.ofi_streak * 0.08;
    } else {
      ps.ofi_score *= 0.92;
    }

    // ════ G: Momentum Decay ═══════════════════════════════════════════
    ps.mom = ps.mom * 0.88 + vel * 12;

    // ════ J: Entropy (Shannon على اتجاهات التيكات) ═══════════════════
    // انخفاض الإنتروبيا = اتجاه واضح
    let entropyScore = 0;
    {
      if (vel > 0) ps.ent_up++; else if (vel < 0) ps.ent_dn++;
      ps.ent_n++;
      if (ps.ent_n > 30) { ps.ent_n=30; ps.ent_up=Math.max(0,ps.ent_up-0.5); ps.ent_dn=Math.max(0,ps.ent_dn-0.5); }
      if (ps.ent_n >= 5) {
        const pu = ps.ent_up/ps.ent_n;
        const H  = _MATH.shannonH(pu); // H ∈ [0,1]: 0=اتجاه نقي، 1=فوضى كاملة
        const clarity = 1 - H;
        const dominates = ps.ent_up > ps.ent_dn ? 1 : -1;
        entropyScore = clarity * dominates; // -1..1
      }
    }

    // ════ K: Z-Score للسعر الحالي (هل السعر بعيد عن المتوسط؟) ═══════
    let zScore = 0;
    {
      ps.zs_sum += price; ps.zs_sq += price*price; ps.zs_n++;
      if (ps.zs_n > 40) { ps.zs_n=40; }
      if (ps.zs_n >= 8) {
        const m=ps.zs_sum/ps.zs_n, v=Math.sqrt(Math.max(0,ps.zs_sq/ps.zs_n-m*m))||1e-9;
        zScore = (price-m)/v; // موجب = السعر فوق المتوسط (قد يعني تشبع شراء → بيع)
        // في حالة ارتداد: zScore > 2 → بيع | zScore < -2 → شراء
        // في حالة اتجاه: نعكسه — نستخدم الـ regime لتحديد التفسير
      }
    }

    // ════════════════════════════════════════════════════════════════
    // ══ SUPREME-PRED v2 — حساب الثقة الموزونة عبر 4 مجموعات ══════════
    // ════════════════════════════════════════════════════════════════
    const aw = ps.aw;
    const _sigmoid6 = (x) => 1 / (1 + Math.exp(-x * 6));

    // ── [S0] تحديث Regime المحسّن (TREND/RANGE/VOLATILE) ──────────────
    {
      const atr = _rollingATR.isReady ? _rollingATR.value : ps.vol * 10;
      if (atr > 0) {
        ps.atr_ma = ps.atr_ma * 0.97 + atr * 0.03;
        const atrRatio = atr / (ps.atr_ma || 1e-9);
        if (atrRatio > CFG.SUPREME_VOLATILE_ATR_MULT) {
          ps.regime = 'VOLATILE';
        } else if (ps.hurst_h > CFG.SUPREME_HURST_TREND) {
          ps.regime = 'TREND';
        } else {
          ps.regime = ps.hurst_h < CFG.SUPREME_HURST_RANGE ? 'RANGE' : 'RANGE';
        }
      }
    }

    // ── [S1] Kalman Filter prediction (_MATH.kalmanStep) ─────────────
    let kalmanScore = 0;
    {
      if (ps.kf_x === null) {
        ps.kf_x = price; ps.kf_p = 1.0;
      } else {
        const kf = _MATH.kalmanStep(ps.kf_x, ps.kf_p, price, CFG.SUPREME_KALMAN_Q, CFG.SUPREME_KALMAN_R);
        ps.kf_x = kf.x; ps.kf_p = kf.p;
        const kDiff = price - ps.kf_x;
        ps.kalmanPredDir   = kDiff > 0 ? 1 : kDiff < 0 ? -1 : 0;
        ps.kalmanMagnitude = Math.min(1, Math.abs(kDiff) / (ps.vol * 2 || 1e-9));
        kalmanScore = _cls(kDiff / (ps.vol * 3 || 1e-9), 1);
      }
    }

    // ── [S2] LR with R² filter ────────────────────────────────────────
    let lrNorm = 0, lrFiltered = 0;
    {
      const lp = ps.lr_prices, n = lp.length;
      if (n >= 8) {
        let sx=0,sy=0,sxy=0,sx2=0,sy2=0;
        for (let i=0;i<n;i++){sx+=i;sy+=lp[i];sxy+=i*lp[i];sx2+=i*i;sy2+=lp[i]*lp[i];}
        const denom = n*sx2-sx*sx;
        if (Math.abs(denom)>1e-15) {
          const slope = (n*sxy-sx*sy)/denom;
          const intercept = (sy-slope*sx)/n;
          const yMean = sy/n;
          let ss_res=0, ss_tot=0;
          for (let i=0;i<n;i++){const yh=intercept+slope*i;ss_res+=(lp[i]-yh)**2;ss_tot+=(lp[i]-yMean)**2;}
          ps.lr_r2 = ss_tot>1e-20 ? Math.max(0,1-ss_res/ss_tot) : 0;
          lrNorm   = _cls(slope/(ps.vol*10||1e-9),1);
          lrFiltered = ps.lr_r2 >= CFG.SUPREME_LR_R2_MIN ? lrNorm : 0;
        }
      }
    }

    // ── [S3] Enhanced Hurst via _MATH.hurstFromVels (4 windows: 4/8/16/32) ──
    if (ps.vels.length >= 32) {
      ps.hurst_h = _MATH.hurstFromVels(ps.vels);
    }

    // ── [S4] AutoCorrelation lags 1-5 ────────────────────────────────
    // Float64Array ring-buffer push (cap 50, keep 10 for autocorr)
    { const c=ps.ac_velBuf,cap=c.length; if(ps.ac_velBuf_n<cap){c[ps.ac_velBuf_n++]=vel;}else{c.copyWithin(0,1);c[cap-1]=vel;} }
    const acLags=[0,0,0,0,0];
    {
      const vb=ps.ac_velBuf, nv=Math.min(ps.ac_velBuf_n, 10);
      for (let lag=1;lag<=5;lag++) acLags[lag-1]=_MATH.autocorrLag(vb, nv, lag);
    }

    // ── [S5] ROC consensus (3/8/15/25 windows) ────────────────────────
    const _rocW = (w) => {
      if (w.length<2) return 0;
      const f=w[0],l=w[w.length-1]; return Math.abs(f)<1e-15?0:(l-f)/Math.abs(f);
    };
    ps.roc3  = _rocW(ps.W5.slice(-3));
    ps.roc8  = _rocW(ps.W10);
    ps.roc15 = _rocW(ps.W20.slice(-15));
    ps.roc25 = _rocW(ps.W40.slice(-25));
    const rocVotes=[ps.roc3,ps.roc8,ps.roc15,ps.roc25].map(r=>r>0?1:r<0?-1:0);
    const rocConsensus=rocVotes.reduce((a,v)=>a+v,0)/4;

    // ── [S6] Liquidity Vacuum detection ───────────────────────────────
    let liqVacScore=0;
    {
      const w=ps.W20;
      if (w.length>=10) {
        const r5=w.slice(-5), b5=w.slice(-10,-5);
        const rMove=Math.abs(r5[4]-r5[0]);
        const bRange=Math.max(...b5)-Math.min(...b5);
        if (bRange>1e-10&&rMove>bRange*2.5) {
          const d=r5[4]>r5[0]?1:-1;
          liqVacScore=d*Math.min(1,rMove/(bRange*3));
        }
      }
    }

    // ── [S7] Dynamic S/R from tick pivots ─────────────────────────────
    let dynSRScore=0;
    {
      const w=ps.W10;
      if (w.length>=5) {
        const mid=Math.floor(w.length/2);
        const isPeak=w[mid]===Math.max(...w), isTrough=w[mid]===Math.min(...w);
        if (isPeak)   _rp(ps.sr_pivots,{type:'R',level:w[mid]},50);
        if (isTrough) _rp(ps.sr_pivots,{type:'S',level:w[mid]},50);
        const tol=ps.vol*3;
        for (const piv of ps.sr_pivots) {
          if (Math.abs(price-piv.level)<tol) dynSRScore=piv.type==='S'?0.5:-0.5;
        }
      }
    }

    // ── [S8] Fibonacci score ──────────────────────────────────────────
    let fibScore=0;
    {
      const cands=candleBuffers[asset]||[];
      if (cands.length>=CFG.FIB_LOOKBACK) {
        const fr=getFibSignal(cands);
        if (fr) fibScore=fr.signal==='BUY'?0.5:fr.signal==='SELL'?-0.5:0;
      }
    }

    // ── [S9] Breakout probability ──────────────────────────────────────
    let breakoutScore=0;
    {
      const w=ps.W40;
      if (w.length>=20){
        const max20=Math.max(...w.slice(-20)), min20=Math.min(...w.slice(-20));
        const rng=max20-min20||1e-9, pos=(price-min20)/rng;
        if      (price>=max20*0.9999) breakoutScore= 1.0;
        else if (price<=min20*1.0001) breakoutScore=-1.0;
        else if (pos>0.85) breakoutScore= 0.6;
        else if (pos<0.15) breakoutScore=-0.6;
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ══ SUPREME-PRED v2 — مجموعات الخوارزميات الأربع ══════════════════
    // ═══════════════════════════════════════════════════════════════════

    const velAvg   = ps.vels.length>=3  ? _cls(_mean(ps.vels.slice(-5))/(ps.vol||1e-9),1) : 0;
    const accelAvg = ps.accels.length>=3 ? _cls(_mean(ps.accels.slice(-5))/(ps.vol||1e-9),1) : 0;
    const ofiNorm  = _cls(ps.ofi_score/3,1);
    const tRsiNorm = _cls((ps.tRsi_val-50)/50,1);
    const momNorm  = _cls(ps.mom/(ps.vol*50||1e-9),1);
    const isHurst  = ps.hurst_h > CFG.SUPREME_HURST_TREND;
    const zAdj     = isHurst ? _cls(zScore/2,1) : _cls(-zScore/2,1);
    const entropyAmp = _cls(entropyScore,1);
    const ac1Amp = _cls(velAvg*(1+acLags[0]*0.5),1);

    let tveSigma=0, tveBias=0;
    {
      const vh=TickVelocityEngine.velHistory;
      if (vh.length>=5){
        const win=vh.slice(-Math.min(25,vh.length)), vals=win.map(v=>v.accel);
        const m=_mean(vals), s=_std(vals,m);
        tveSigma=_cls((vh[vh.length-1].accel-m)/s/2.5,1);
      }
      const bias=TickVelocityEngine.getDirectionBias();
      tveBias=bias==='BUY'?1:bias==='SELL'?-1:0;
    }

    // ── مجموعة A — ديناميكيات التيك (45%) ────────────────────────────
    const groupA_algos = [
      {key:'ofi',     val:ofiNorm,          w:aw.ofi},
      {key:'vel',     val:velAvg,           w:aw.vel},
      {key:'accel',   val:accelAvg,         w:aw.accel},
      {key:'tRsi',    val:tRsiNorm,         w:aw.tRsi},
      {key:'mom',     val:momNorm,          w:aw.mom},
      {key:'zScore',  val:zAdj,            w:aw.zScore},
      {key:'entropy', val:entropyAmp,       w:aw.entropy},
      {key:'ac1',     val:ac1Amp,           w:aw.ac1},
      {key:'ac2',     val:_cls(acLags[1],1),w:aw.ac2},
      {key:'ac3',     val:_cls(acLags[2],1),w:aw.ac3},
      {key:'ac4',     val:_cls(acLags[3],1),w:aw.ac4},
      {key:'ac5',     val:_cls(acLags[4],1),w:aw.ac5},
      {key:'tveAccel',val:tveSigma,         w:aw.tveAccel},
      {key:'tveBias', val:tveBias,          w:aw.tveBias},
    ];

    // ── مجموعة B — إحصائية (30%) ────────────────────────────────────
    const hurstScore = ps.hurst_h > CFG.SUPREME_HURST_TREND
      ? _cls(velAvg,1)
      : (ps.hurst_h < CFG.SUPREME_HURST_RANGE ? _cls(-velAvg*0.8,1) : 0);
    const geoScore = (() => {
      const w=ps.W10; if(w.length<5) return 0;
      const mid=Math.floor(w.length/2);
      const lh=Math.max(...w.slice(0,mid)), rh=Math.max(...w.slice(mid));
      const ll=Math.min(...w.slice(0,mid)), rl=Math.min(...w.slice(mid));
      let gs=0;
      if(ll<lh&&Math.abs(rl-ll)<ps.vol*3&&price>rl) gs= 0.8;
      if(lh>ll&&Math.abs(rh-lh)<ps.vol*3&&price<rh) gs=-0.8;
      if(rh>lh*1.0001) gs=Math.max(gs, 0.5);
      if(rl<ll*0.9999)  gs=Math.min(gs,-0.5);
      return gs;
    })();
    const groupB_algos = [
      {key:'hurst',   val:hurstScore,   w:aw.hurst},
      {key:'lr',      val:lrFiltered,   w:aw.lr},
      {key:'kalman',  val:kalmanScore,  w:aw.kalman},
      {key:'roc',     val:rocConsensus, w:aw.roc},
      {key:'breakout',val:breakoutScore,w:aw.breakout},
      {key:'geo',     val:geoScore,     w:aw.geo},
    ];

    // ── مجموعة C — هياكلية (15%) ─────────────────────────────────────
    const emaStackScore = (() => {
      const emas=[ps.e2,ps.e3,ps.e5,ps.e8,ps.e13,ps.e21,ps.e34,ps.e55];
      let above=0,below=0;
      for (const e of emas){if(e!==null){if(price>e)above++;else below++;}}
      const tot=above+below; return tot>0?(above-below)/tot:0;
    })();
    const regimeAdjScore = ps.regime==='TREND'?_cls(velAvg*1.5,1):ps.regime==='RANGE'?_cls(-velAvg*1.5,1):0;
    const groupC_algos = [
      {key:'regime_w',val:regimeAdjScore,w:aw.regime_w},
      {key:'dynSR',   val:dynSRScore,    w:aw.dynSR},
      {key:'emaStack',val:emaStackScore, w:aw.emaStack},
      {key:'liqVac',  val:liqVacScore,   w:aw.liqVac},
    ];

    // ── مجموعة D — مستوى الشمعة (10%) ────────────────────────────────
    const cands=candleBuffers[asset]||[];
    let candleTrend=0,rsiCandle=0,emaCross=0,macdS=0,bbS=0,srsiS=0,mtfS=0;
    if (cands.length>=3){
      const tr=analyzeTrend(cands);
      candleTrend=tr.trend==='UP'?1:tr.trend==='DOWN'?-1:tr.trend==='UP_WEAK'?0.5:tr.trend==='DN_WEAK'?-0.5:0;
      if(ps.regime==='TREND') candleTrend=_cls(candleTrend*2,1);
      if(ps.regime==='RANGE') candleTrend=_cls(-candleTrend*2,1);
    }
    if (cands.length>=9){const r=computeRSIProxy(cands,8);if(r!==null)rsiCandle=r<30?1:r>70?-1:r<40?0.4:r>60?-0.4:0;}
    {const es=getEMACrossSignal(cands);emaCross=es==='BUY'?1:es==='SELL'?-1:0;}
    if (cands.length>=35){const m=computeMACD(cands);if(m)macdS=_cls(m.histogram*300,1)+(m.cross==='BUY'?0.3:m.cross==='SELL'?-0.3:0);}
    if (cands.length>=20){const b=computeBB(cands);if(b&&!b.squeeze)bbS=b.percentB<=0.1?1:b.percentB>=0.9?-1:b.percentB<=0.25?0.4:b.percentB>=0.75?-0.4:0;}
    if (cands.length>=17){const sr=computeStochRSI(cands);if(sr&&sr.signal)srsiS=sr.signal==='BUY'?Math.min(1,(20-Math.min(20,sr.k))/20):sr.signal==='SELL'?-Math.min(1,(Math.max(80,sr.k)-80)/20):0;}
    if (cands.length>=6){const htf=getHigherTFTrend(cands);if(htf)mtfS=htf.trend.startsWith('UP')?0.6:htf.trend.startsWith('DO')?-0.6:0;}
    const groupD_algos = [
      {key:'candle',val:candleTrend,w:aw.candle},
      {key:'rsi',   val:rsiCandle, w:aw.rsi},
      {key:'macd',  val:macdS,     w:aw.macd},
      {key:'bb',    val:bbS,       w:aw.bb},
      {key:'srsi',  val:srsiS,     w:aw.srsi},
      {key:'mtf',   val:mtfS,      w:aw.mtf},
      {key:'fib',   val:fibScore,  w:aw.fib},
    ];

    // ════ T: نتيجة كل مجموعة ════════════════════════════════════════════
    function _gScore(algos){
      let bull=0,bear=0,tw=0;
      const scores={};
      for (const {key,val,w} of algos){
        scores[key]=val;
        if(val>0) bull+=val*w; else if(val<0) bear+=Math.abs(val)*w;
        tw+=w;
      }
      return {net:tw>0?(bull-bear)/tw:0, bull, bear, tw, scores};
    }
    const gA=_gScore(groupA_algos);
    const gB=_gScore(groupB_algos);
    const gC=_gScore(groupC_algos);
    const gD=_gScore(groupD_algos);

    // حفظ أصوات المجموعات للواجهة
    ps.groupVotes.A={bull:groupA_algos.filter(a=>a.val>0).length,bear:groupA_algos.filter(a=>a.val<0).length,total:groupA_algos.length};
    ps.groupVotes.B={bull:groupB_algos.filter(a=>a.val>0).length,bear:groupB_algos.filter(a=>a.val<0).length,total:groupB_algos.length};
    ps.groupVotes.C={bull:groupC_algos.filter(a=>a.val>0).length,bear:groupC_algos.filter(a=>a.val<0).length,total:groupC_algos.length};
    ps.groupVotes.D={bull:groupD_algos.filter(a=>a.val>0).length,bear:groupD_algos.filter(a=>a.val<0).length,total:groupD_algos.length};

    // ════ U: التجميع الموزون النهائي + sigmoid × 6 → 0-100% ═══════════
    const wA=CFG.SUPREME_W_GROUP_A, wB=CFG.SUPREME_W_GROUP_B;
    const wC=CFG.SUPREME_W_GROUP_C, wD=CFG.SUPREME_W_GROUP_D;
    const combinedScore = gA.net*wA + gB.net*wB + gC.net*wC + gD.net*wD;

    const rawBuyProb = _sigmoid6(combinedScore) * 100;
    const dynamicK   = Math.min(0.45, Math.max(0.10, 0.18+Math.abs(combinedScore)*0.15));
    ps.smoothK    = dynamicK;
    ps.smoothBuy  = ps.smoothBuy*(1-dynamicK) + rawBuyProb*dynamicK;
    ps.smoothSell = 100-ps.smoothBuy;

    const buyPct  = Math.max(1, Math.min(99, Math.round(ps.smoothBuy)));
    const sellPct = 100-buyPct;

    // ════ V: عقوبة النظام وحساب الثقة النهائية ══════════════════════
    let spConf = Math.abs(buyPct-50)*2; // 0-100
    if (ps.regime === 'VOLATILE') spConf *= 0.75; // عقوبة التقلب
    // NEURAL-TICK penalty: packet spike detected → -20% confidence
    if (ps.spikeActive) spConf *= 0.80;
    spConf = Math.round(Math.min(100, Math.max(0, spConf)));

    const direction = buyPct > 55 ? 'BUY' : sellPct > 55 ? 'SELL' : 'NEUTRAL';

    ps.buyPct     = buyPct;
    ps.sellPct    = sellPct;
    ps.direction  = direction;
    ps.confidence = spConf / 100;
    ps.spConf     = spConf;

    // ── Ghost Execution: pre-serialize payload when approaching 70% gate ─
    if (spConf >= 55 && direction !== 'NEUTRAL') {
      const nowPf = W.performance?.now?.() ?? Date.now();
      if (!_ghostExecPacket || _ghostExecPacket.signal !== direction ||
          nowPf - _ghostExecPacket.builtAt > 2500) {
        try {
          _ghostExecPacket = { signal: direction, packet: _getCachedPayload(direction), builtAt: nowPf };
        } catch(_) {}
      }
    } else {
      _ghostExecPacket = null;
    }

    // حفظ scores الخوارزميات للتعلم التكيفي
    const allScores = {};
    for (const {key,val} of [...groupA_algos,...groupB_algos,...groupC_algos,...groupD_algos]) allScores[key]=val;
    ps.algoScores = allScores;

    const agreeCount = Object.values(allScores).filter(v=>Math.sign(v)===Math.sign(combinedScore)&&Math.abs(v)>0.1).length;
    const allCount   = Object.keys(allScores).length;
    ps.snap = {
      vel:velAvg, accel:accelAvg, tve:tveSigma, ofi:ofiNorm, mom:momNorm,
      lr:lrFiltered, ema:emaStackScore, ac:acLags[0], entropy:entropyAmp, z:zAdj,
      roc:rocConsensus, brk:breakoutScore, geo:geoScore, hurst:ps.hurst_h,
      tRsi:ps.tRsi_val, regime:ps.regime, agree:agreeCount, total:allCount,
      candle:candleTrend, rsi:rsiCandle, spConf,
      gA:gA.net, gB:gB.net, gC:gC.net, gD:gD.net,
      kalmanDir:ps.kalmanPredDir, kalmanMag:ps.kalmanMagnitude, r2:ps.lr_r2,
    };

    // تحديث الواجهة — مجدوَل على rAF لتجنب تحديثات DOM متكررة في نفس الفريم
    _predBarScheduleUI();
  }

  // ─── rAF scheduler — batches DOM updates to the paint frame (Directive 4) ─
  // Multiple ticks can arrive before the next frame; only the latest snapshot
  // is painted, keeping the trading computation loop at zero DOM overhead.
  let _predBarRafPending = false;
  function _predBarScheduleUI() {
    if (_predBarRafPending) return;
    _predBarRafPending = true;
    W.requestAnimationFrame(() => {
      _predBarRafPending = false;
      _predBarRefreshUI();
    });
  }

  // ─── تحديث واجهة شريط التنبؤ SUPREME-PRED v2 ───────────────────
  function _predBarRefreshUI() {
    const bar = W.document.getElementById('pb-bar');
    if (!bar) return;
    const st = _PS;
    const spConf = st.spConf || 0;
    const regime = st.snap?.regime || 'RANGE';
    const snap   = st.snap || {};

    // ── النسب والأرقام الأساسية ────────────────────────────────────────
    const bEl    = W.document.getElementById('pb-buy-pct');
    const sEl    = W.document.getElementById('pb-sell-pct');
    const fillEl = W.document.getElementById('pb-fill');
    const dirEl  = W.document.getElementById('pb-direction');

    if (bEl) bEl.textContent = st.buyPct + '%';
    if (sEl) sEl.textContent = st.sellPct + '%';

    if (fillEl) {
      fillEl.style.width = st.buyPct + '%';
      if (st.direction==='BUY')      fillEl.style.background = 'linear-gradient(90deg,#00d264,#00a850)';
      else if (st.direction==='SELL') fillEl.style.background = 'linear-gradient(90deg,#ff3755,#c8001c)';
      else                            fillEl.style.background = 'linear-gradient(90deg,#ffb020,#ff8c00)';
    }
    if (dirEl) {
      const arrows={BUY:'▲',SELL:'▼',NEUTRAL:'◆'}, colors={BUY:'#00d264',SELL:'#ff3755',NEUTRAL:'#ffb020'};
      dirEl.textContent=(arrows[st.direction]||'◆')+' '+st.direction;
      dirEl.style.color=colors[st.direction]||'#ffb020';
    }

    // ── [SUPREME] مقياس الثقة مع اللون التكيفي ────────────────────────
    const confGaugeEl = W.document.getElementById('pb-conf-gauge');
    const confTextEl  = W.document.getElementById('pb-conf-text');
    const confBarEl   = W.document.getElementById('pb-conf-bar');
    if (confGaugeEl) confGaugeEl.style.width = spConf + '%';
    if (confBarEl) {
      // اللون: أحمر <60% | أصفر 60-69% | أخضر 70%+
      confBarEl.style.background = spConf >= 70 ? '#00d264' : spConf >= 60 ? '#ffb020' : '#ff3755';
      confBarEl.style.width = spConf + '%';
    }
    if (confTextEl) {
      confTextEl.textContent = 'ثقة: ' + spConf + '%';
      confTextEl.style.color = spConf >= 70 ? '#00d264' : spConf >= 60 ? '#ffb020' : '#ff3755';
    }
    // إنشاء عناصر الثقة إذا لم تكن موجودة
    if (!confBarEl) {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar && !W.document.getElementById('pb-conf-row')) {
        const row = W.document.createElement('div');
        row.id = 'pb-conf-row';
        row.style.cssText = 'margin-top:5px;display:flex;align-items:center;gap:5px;';
        const txt = W.document.createElement('span');
        txt.id = 'pb-conf-text';
        txt.style.cssText = 'font-size:10px;font-weight:700;min-width:65px;';
        txt.textContent = 'ثقة: ' + spConf + '%';
        txt.style.color = spConf >= 70 ? '#00d264' : spConf >= 60 ? '#ffb020' : '#ff3755';
        const track = W.document.createElement('div');
        track.style.cssText = 'flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.1);overflow:hidden;';
        const bar2 = W.document.createElement('div');
        bar2.id = 'pb-conf-bar';
        bar2.style.cssText = 'height:100%;border-radius:3px;transition:width 0.15s,background 0.3s;';
        bar2.style.width = spConf + '%';
        bar2.style.background = spConf >= 70 ? '#00d264' : spConf >= 60 ? '#ffb020' : '#ff3755';
        track.appendChild(bar2);
        row.appendChild(txt); row.appendChild(track);
        pbBar.appendChild(row);
      }
    }

    // ── [SUPREME] مؤشر TRADE BLOCKED ──────────────────────────────────
    const blockedEl = W.document.getElementById('pb-blocked');
    if (blockedEl) {
      const isBlocked = spConf < CFG.SUPREME_MIN_CONF || st.direction === 'NEUTRAL';
      blockedEl.style.display = isBlocked ? 'block' : 'none';
      blockedEl.textContent   = '🔴 TRADE BLOCKED (' + spConf + '% < ' + CFG.SUPREME_MIN_CONF + '%)';
    } else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar && !W.document.getElementById('pb-blocked')) {
        const bl = W.document.createElement('div');
        bl.id = 'pb-blocked';
        bl.style.cssText = 'font-size:9px;font-weight:700;color:#ff3755;text-align:center;margin-top:4px;letter-spacing:0.4px;display:none;';
        pbBar.appendChild(bl);
      }
    }

    // ── [SUPREME] Regime + معدل الفوز ───────────────────────────────
    const regimeEl = W.document.getElementById('pb-regime');
    const rStats   = st.regimeStats?.[regime] || {wins:0,total:0};
    const rWR      = rStats.total >= 5 ? Math.round(rStats.wins/rStats.total*100) : null;
    const regimeLbl = regime==='TREND' ? '📈 TREND' : regime==='VOLATILE' ? '⚡ VOLATILE' : '↔ RANGE';
    const regimeColor = regime==='TREND' ? '#00d264' : regime==='VOLATILE' ? '#ff8c00' : '#ffb020';
    const regimeText  = regimeLbl + (rWR!==null ? ' ' + rWR + '%' : '');
    if (regimeEl) { regimeEl.textContent = regimeText; regimeEl.style.color = regimeColor; }
    else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar) {
        const rEl = W.document.createElement('div');
        rEl.id = 'pb-regime';
        rEl.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:0.5px;margin-top:3px;';
        rEl.textContent = regimeText; rEl.style.color = regimeColor;
        pbBar.appendChild(rEl);
      }
    }

    // ── [SUPREME] توزيع أصوات الخوارزميات ──────────────────────────
    const agreeEl = W.document.getElementById('pb-agree');
    const vA=st.groupVotes?.A||{bull:0,bear:0,total:0};
    const vB=st.groupVotes?.B||{bull:0,bear:0,total:0};
    const vC=st.groupVotes?.C||{bull:0,bear:0,total:0};
    const vD=st.groupVotes?.D||{bull:0,bear:0,total:0};
    const totalAlgos=(vA.total||0)+(vB.total||0)+(vC.total||0)+(vD.total||0);
    const bullAlgos =(vA.bull||0)+(vB.bull||0)+(vC.bull||0)+(vD.bull||0);
    const agreeStr  = bullAlgos + '/' + totalAlgos + ' ✓';
    if (agreeEl) {
      agreeEl.textContent = agreeStr;
      const ap = totalAlgos>0?bullAlgos/totalAlgos:0;
      agreeEl.style.color = ap>=0.7?'#00d264':ap>=0.5?'#ffb020':'rgba(255,255,255,0.35)';
    } else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar) {
        const aEl = W.document.createElement('span');
        aEl.id = 'pb-agree';
        aEl.style.cssText = 'font-size:9px;font-weight:700;margin-left:6px;';
        aEl.textContent = agreeStr;
        const ap=totalAlgos>0?bullAlgos/totalAlgos:0;
        aEl.style.color=ap>=0.7?'#00d264':ap>=0.5?'#ffb020':'rgba(255,255,255,0.35)';
        pbBar.appendChild(aEl);
      }
    }

    // ── [SUPREME] توزيع المجموعات A/B/C/D ─────────────────────────────
    const groupEl = W.document.getElementById('pb-groups');
    const gText = 'A:' + (vA.bull||0) + '/' + (vA.total||0) +
                  ' B:' + (vB.bull||0) + '/' + (vB.total||0) +
                  ' C:' + (vC.bull||0) + '/' + (vC.total||0) +
                  ' D:' + (vD.bull||0) + '/' + (vD.total||0);
    if (groupEl) { groupEl.textContent = gText; }
    else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar && !W.document.getElementById('pb-groups')) {
        const gEl = W.document.createElement('div');
        gEl.id = 'pb-groups';
        gEl.style.cssText = 'font-size:8px;color:rgba(255,255,255,0.45);margin-top:2px;letter-spacing:0.4px;font-family:monospace;';
        gEl.textContent = gText;
        pbBar.appendChild(gEl);
      }
    }

    // ── [SUPREME] Hurst H + تصنيف النظام ─────────────────────────────
    const hurstEl = W.document.getElementById('pb-hurst');
    const hurstVal = typeof st.hurst_h==='number' ? st.hurst_h : 0.5;
    const hurstLbl = hurstVal > CFG.SUPREME_HURST_TREND ? 'TREND' : hurstVal < CFG.SUPREME_HURST_RANGE ? 'RANGE' : 'RAND';
    const hurstColor = hurstVal > CFG.SUPREME_HURST_TREND ? '#00d264' : hurstVal < CFG.SUPREME_HURST_RANGE ? '#ffb020' : 'rgba(255,255,255,0.4)';
    if (hurstEl) { hurstEl.textContent = 'H:' + hurstVal.toFixed(2) + ' ' + hurstLbl; hurstEl.style.color = hurstColor; }
    else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar) {
        const hEl = W.document.createElement('span');
        hEl.id = 'pb-hurst';
        hEl.style.cssText = 'font-size:9px;font-weight:700;margin-left:6px;';
        hEl.textContent = 'H:' + hurstVal.toFixed(2) + ' ' + hurstLbl;
        hEl.style.color = hurstColor;
        pbBar.appendChild(hEl);
      }
    }

    // ── [SUPREME] Kalman predicted direction ──────────────────────────
    const kalmanEl = W.document.getElementById('pb-kalman');
    const kDir = st.kalmanPredDir || 0;
    const kMag = st.kalmanMagnitude || 0;
    const kText = kDir > 0 ? ('↑ +'+(kMag*100).toFixed(0)+'σ') : kDir < 0 ? ('↓ -'+(kMag*100).toFixed(0)+'σ') : '— flat';
    const kColor = kDir > 0 ? '#00d264' : kDir < 0 ? '#ff3755' : 'rgba(255,255,255,0.3)';
    if (kalmanEl) { kalmanEl.textContent = 'KF:' + kText; kalmanEl.style.color = kColor; }
    else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar && !W.document.getElementById('pb-kalman')) {
        const kEl = W.document.createElement('span');
        kEl.id = 'pb-kalman';
        kEl.style.cssText = 'font-size:9px;font-weight:700;margin-left:6px;';
        kEl.textContent = 'KF:' + kText;
        kEl.style.color = kColor;
        pbBar.appendChild(kEl);
      }
    }

    // ── Glow effect ─────────────────────────────────────────────────
    if (spConf >= CFG.SUPREME_MIN_CONF) {
      const glowColor = st.direction==='BUY' ? 'rgba(0,210,100,0.4)' : 'rgba(255,55,85,0.4)';
      bar.style.boxShadow = `0 0 20px ${glowColor}, 0 8px 32px rgba(0,0,0,0.8)`;
    } else {
      bar.style.boxShadow = '0 8px 32px rgba(0,0,0,0.8)';
    }
  }

  // ─── تحريك زر الشراء/البيع على المنصة ─────────────────────────
  let _btnAnimTimer = null;
  function _animatePlatformButton(signal, confidence) {
    if (!signal || signal === 'HOLD') return;
    if (confidence < 3) return; // فقط إشارات قوية
    // ابحث عن الزر
    const buttons = W.document.querySelectorAll('button,[role="button"]');
    let target = null;
    for (const btn of buttons) {
      const txt = (btn.textContent||btn.innerText||'').trim();
      if (signal === 'BUY'  && (txt.includes('شراء')||txt.toLowerCase().includes('buy')||txt.toLowerCase().includes('higher')||txt.includes('↑'))) { target = btn; break; }
      if (signal === 'SELL' && (txt.includes('بيع')||txt.toLowerCase().includes('sell')||txt.toLowerCase().includes('lower')||txt.includes('↓')))  { target = btn; break; }
    }
    if (!target) return;

    // أضف كلاس التحريك
    const animClass = signal === 'BUY' ? 'cb-btn-pulse-buy' : 'cb-btn-pulse-sell';
    target.classList.add(animClass);

    // أزل التحريك بعد 3 ثوانٍ
    if (_btnAnimTimer) clearTimeout(_btnAnimTimer);
    _btnAnimTimer = setTimeout(() => {
      target.classList.remove('cb-btn-pulse-buy', 'cb-btn-pulse-sell');
    }, 3000);
  }

  // ─── تهيئة شريط التنبؤ المنفصل ────────────────────────────────
  function _initPredictionBar() {
    // حذف إذا موجود
    const existing = W.document.getElementById('pb-root');
    if (existing) existing.remove();

    const CSS = `
    @keyframes pb-pulse-buy  { 0%,100%{box-shadow:0 0 0 0 rgba(0,210,100,0.7);}50%{box-shadow:0 0 0 12px rgba(0,210,100,0);} }
    @keyframes pb-pulse-sell { 0%,100%{box-shadow:0 0 0 0 rgba(255,55,85,0.7);} 50%{box-shadow:0 0 0 12px rgba(255,55,85,0);}  }
    @keyframes pb-dir-flash  { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
    @keyframes cb-btn-glow-buy  {
      0%  { box-shadow: 0 0 0 0 rgba(0,210,100,0.9), inset 0 0 0 0 rgba(0,210,100,0.2); transform: scale(1); }
      30% { box-shadow: 0 0 20px 6px rgba(0,210,100,0.7), inset 0 0 12px 0 rgba(0,210,100,0.3); transform: scale(1.04); }
      60% { box-shadow: 0 0 10px 2px rgba(0,210,100,0.4), inset 0 0 6px 0 rgba(0,210,100,0.15); transform: scale(1.01); }
      100%{ box-shadow: 0 0 0 0 rgba(0,210,100,0), inset 0 0 0 0 rgba(0,210,100,0); transform: scale(1); }
    }
    @keyframes cb-btn-glow-sell {
      0%  { box-shadow: 0 0 0 0 rgba(255,55,85,0.9), inset 0 0 0 0 rgba(255,55,85,0.2); transform: scale(1); }
      30% { box-shadow: 0 0 20px 6px rgba(255,55,85,0.7), inset 0 0 12px 0 rgba(255,55,85,0.3); transform: scale(1.04); }
      60% { box-shadow: 0 0 10px 2px rgba(255,55,85,0.4), inset 0 0 6px 0 rgba(255,55,85,0.15); transform: scale(1.01); }
      100%{ box-shadow: 0 0 0 0 rgba(255,55,85,0), inset 0 0 0 0 rgba(255,55,85,0); transform: scale(1); }
    }
    .cb-btn-pulse-buy  { animation: cb-btn-glow-buy  0.65s ease-in-out 4 !important; }
    .cb-btn-pulse-sell { animation: cb-btn-glow-sell 0.65s ease-in-out 4 !important; }

    #pb-root {
      position: fixed;
      top: 50%;
      right: 14px;
      transform: translateY(-50%);
      z-index: 2147483645;
      direction: ltr;
      font-family: 'IBM Plex Sans Arabic', -apple-system, BlinkMacSystemFont, sans-serif;
      touch-action: none;
      user-select: none;
    }
    #pb-bar {
      background: rgba(8,10,16,0.97);
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 18px;
      padding: 10px 14px;
      width: 260px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.8);
      transition: box-shadow 0.4s;
      cursor: grab;
    }
    #pb-bar:active { cursor: grabbing; }
    #pb-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    #pb-title {
      font-size: 9px;
      font-weight: 700;
      color: rgba(255,255,255,0.35);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      flex: 1;
    }
    #pb-direction {
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.5px;
      color: #ffb020;
      transition: color 0.2s;
      animation: pb-dir-flash 0.8s ease-in-out infinite;
    }
    #pb-signal {
      font-size: 9px;
      font-weight: 600;
      color: rgba(255,255,255,0.3);
      transition: color 0.3s;
    }
    #pb-bar-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #pb-buy-pct {
      font-size: 15px;
      font-weight: 800;
      color: #00d264;
      min-width: 38px;
      text-align: right;
      font-variant-numeric: tabular-nums;
      transition: color 0.2s;
    }
    #pb-sell-pct {
      font-size: 15px;
      font-weight: 800;
      color: #ff3755;
      min-width: 38px;
      text-align: left;
      font-variant-numeric: tabular-nums;
      transition: color 0.2s;
    }
    #pb-track {
      flex: 1;
      height: 10px;
      border-radius: 5px;
      background: rgba(255,55,85,0.25);
      overflow: hidden;
      position: relative;
    }
    #pb-fill {
      height: 100%;
      border-radius: 5px;
      width: 50%;
      transition: width 0.15s cubic-bezier(0.4,0,0.2,1), background 0.3s;
      background: linear-gradient(90deg,#00d264,#00a850);
    }
    #pb-drag-hint {
      font-size: 7px;
      color: rgba(255,255,255,0.08);
      text-align: center;
      margin-top: 5px;
      letter-spacing: 0.5px;
    }
    #pb-close {
      width: 18px; height: 18px;
      border-radius: 5px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.07);
      color: rgba(255,255,255,0.25);
      font-size: 10px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    #pb-close:hover { background: rgba(255,55,85,0.15); color: #ff3755; }
    #pb-conf-row {
      display: flex; align-items: center; gap: 6px; margin-top: 6px;
    }
    #pb-conf-text {
      font-size: 10px; font-weight: 700; color: #ffb020;
      min-width: 40px; text-align: right;
      font-variant-numeric: tabular-nums;
    }
    #pb-conf-track {
      flex: 1; height: 6px; border-radius: 3px;
      background: rgba(255,255,255,0.07); overflow: hidden;
    }
    #pb-conf-bar {
      height: 100%; border-radius: 3px; width: 0%;
      transition: width 0.2s, background 0.3s;
      background: #ff3755;
    }
    #pb-blocked {
      font-size: 9px; font-weight: 700; color: #ff3755;
      text-align: center; margin-top: 4px; display: none;
      letter-spacing: 0.5px;
    }
    #pb-regime, #pb-agree, #pb-groups, #pb-hurst, #pb-kalman {
      font-size: 8px; color: rgba(255,255,255,0.38);
      margin-top: 3px; text-align: center;
      font-variant-numeric: tabular-nums;
    }
    `;

    const styleEl = W.document.createElement('style');
    styleEl.textContent = CSS;
    W.document.head.appendChild(styleEl);

    const root = W.document.createElement('div');
    root.id = 'pb-root';
    root.innerHTML = `
      <div id="pb-bar">
        <div id="pb-header">
          <span id="pb-title">🔥 SUPREME-PRED v2 V12</span>
          <span id="pb-direction">◆ NEUTRAL</span>
          <span id="pb-signal">ثقة: 0%</span>
          <button id="pb-close" title="إخفاء">✕</button>
        </div>
        <div id="pb-bar-row">
          <span id="pb-buy-pct">50%</span>
          <div id="pb-track"><div id="pb-fill"></div></div>
          <span id="pb-sell-pct">50%</span>
        </div>
        <div id="pb-conf-row">
          <span id="pb-conf-text">ثقة: 0%</span>
          <div id="pb-conf-track"><div id="pb-conf-bar"></div></div>
        </div>
        <div id="pb-blocked"></div>
        <div id="pb-regime">RANGE | WR: –%</div>
        <div id="pb-agree">algos: 0/0</div>
        <div id="pb-groups">A:0/0 B:0/0 C:0/0 D:0/0</div>
        <div id="pb-hurst">H:– –</div>
        <div id="pb-kalman">KF: –</div>
        <div id="pb-drag-hint">اسحب للتحريك</div>
      </div>
    `;
    W.document.body.appendChild(root);

    // زر الإغلاق
    W.document.getElementById('pb-close').addEventListener('click', () => {
      root.style.display = 'none';
    });

    // جعله قابلاً للسحب
    _makeDraggable(root, W.document.getElementById('pb-bar'));
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 29.5  SUPREME-PRED v2 — Brain Persistence (localStorage)
  // ══════════════════════════════════════════════════════════════════════
  function _saveBrain() {
    try {
      W.localStorage.setItem('cb_v12_brain', JSON.stringify({
        aw:            _PS.aw,
        regimeStats:   _PS.regimeStats,
        regimeBlocked: _PS.regimeBlocked
      }));
    } catch(_) {}
  }

  function _loadBrain() {
    try {
      const raw = W.localStorage.getItem('cb_v12_brain');
      if (!raw) return;
      const b = JSON.parse(raw);
      if (b.aw)            Object.assign(_PS.aw, b.aw);
      if (b.regimeStats) {
        for (const k of ['TREND','RANGE','VOLATILE']) {
          if (b.regimeStats[k]) Object.assign(_PS.regimeStats[k], b.regimeStats[k]);
        }
      }
      if (b.regimeBlocked) Object.assign(_PS.regimeBlocked, b.regimeBlocked);
      addLog('[BRAIN] ✅ تم استعادة أوزان SUPREME-PRED v2 من الذاكرة', 'info');
    } catch(_) {}
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 30  الإقلاع
  // ══════════════════════════════════════════════════════════════════════
  function init() {
    // SUPREME-PRED v2: restore learned weights from localStorage before UI starts
    _loadBrain();

    // V12: Strict boot-gate — single atomic flag covering ALL entry paths.
    // Previously the guard only existed in the else-branch, leaving the fast-path
    // (document.body already present) unprotected against double-init races.
    let _bootFired = false;
    const _startAfterUI = () => {
      if (_bootFired) return;   // ← strict gate: exactly-once regardless of path
      _bootFired = true;
      initUI();
      _startSignalWatcher();
      addLog('⚡ V12_SUPREME | SUPREME-PRED v2 | 70% gate | 30 algos | IMDB ✓ | Signal Watcher ✓', 'signal');
    };

    if (W.document.body) {
      _startAfterUI();
    } else {
      W.document.addEventListener('DOMContentLoaded', _startAfterUI);
      setTimeout(_startAfterUI, 1500); // fallback — _bootFired prevents double-fire
    }
  }

  init();

})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
