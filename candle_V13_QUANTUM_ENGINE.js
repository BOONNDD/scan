// ==UserScript==
// @name         ⚡ V13_QUANTUM_ENGINE — Ultra-Low-Latency Adaptive Prediction Engine
// @namespace    candle-pro-strategy-v13-quantum-engine
// @version      13.0.0
// @description  Modular quantitative execution engine: OBI + LAD + Fractional Kelly + Anti-Martingale + LSTM Proxy + RL Weights + WebWorker + CRC + DOM Self-Healing
// @author       aoirusra
// @match        *://pocketoption.com/*
// @match        *://*.pocketoption.com/*
// @match        *://m.pocketoption.com/*
// @match        *://trade.pocketoption.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function (W) {
  'use strict';
  if (W.__CANDLE_QE_V13) return;
  W.__CANDLE_QE_V13 = true;

  // ══════════════════════════════════════════════════════════════════════════════
  // §1  CONFIGURATION
  // ══════════════════════════════════════════════════════════════════════════════
  const CFG = {
    // ── Candle Pattern thresholds ─────────────────────────────────────────────
    HAMMER_WICK_RATIO      : 2.0,
    MARUBOZU_MAX_WICK      : 0.04,
    HARAMI_MAX_RATIO       : 0.55,
    ENGULF_MIN_RATIO       : 1.05,
    STAR_BODY_RATIO        : 0.20,
    DOJI_MAX_BODY_RATIO    : 0.08,
    GRAVE_UPPER_MIN        : 0.65,
    DRAGON_LOWER_MIN       : 0.65,
    TWEEZER_TOLERANCE      : 0.0001,
    MIN_TICKS_PER_CANDLE   : 3,
    MAX_CANDLES            : 50,
    MIN_CANDLES_TO_TRADE   : 7,
    BODY_SMA_PERIOD        : 10,
    BODY_SMA_RATIO         : 0.3,

    // ── Timing ────────────────────────────────────────────────────────────────
    ENTRY_DELAY_MS         : 20,
    ENTRY_DELAY_SHORT      : 3,
    TRADE_COOLDOWN_MS      : 500,
    TRADE_COOLDOWN_RATIO   : 0.25,
    TICK_CANDLE_TIMEOUT    : 3500,
    SIGNAL_WATCHER_MS      : 80,
    SIGNAL_WATCHER_EXPIRY_MS: 2500,
    JITTER_MIN_MS          : 2,
    JITTER_MAX_MS          : 12,
    JITTER_ENABLED         : true,

    // ── Strategy ──────────────────────────────────────────────────────────────
    MIN_PATTERN_CONFIDENCE : 2,
    TREND_CANDLES          : 7,
    TREND_STRONG_RATIO     : 0.72,
    DEFAULT_AMOUNT         : 1,
    PERIOD_CONFIRM_COUNT   : 4,
    PERIOD_TRUSTED_OVERRIDE: 4,
    TREND_FILTER_ENABLED   : true,
    SHORT_MODE_ASSUME      : true,
    SHORT_MODE_ASSUME_MAX  : 15,
    SHORT_MODE_TVE_DIRECT  : true,
    SHORT_MODE_NO_TREND_FILTER: true,

    // ── Confluence thresholds ─────────────────────────────────────────────────
    CONFLUENCE_PATTERN_WEIGHT: 1.0,
    CONFLUENCE_MIN_SCORE   : 1.5,
    CONF_SHORT_AUTO        : 2.5,
    CONF_SHORT_MIN         : 1.5,
    CONF_MED_AUTO          : 3.0,
    CONF_MED_MIN           : 2.0,
    CONF_LONG_AUTO         : 3.5,
    CONF_LONG_MIN          : 2.5,
    ADAPTIVE_CONF_ENABLED  : true,
    ADAPTIVE_CONF_WINDOW   : 20,
    ADAPTIVE_CONF_RISE_PER_LOSS: 0.08,
    ADAPTIVE_CONF_MAX_BOOST: 1.5,

    // ── Indicators ───────────────────────────────────────────────────────────
    RSI_PERIOD             : 14,
    RSI_OVERSOLD           : 30,
    RSI_OVERBOUGHT         : 70,
    RSI_ENABLED            : true,
    EMA_FAST_PERIOD        : 9,
    EMA_SLOW_PERIOD        : 21,
    EMA_CROSS_ENABLED      : true,
    MACD_FAST              : 12,
    MACD_SLOW              : 26,
    MACD_SIGNAL            : 9,
    MACD_ENABLED           : true,
    BB_PERIOD              : 20,
    BB_STD                 : 2.0,
    BB_SQUEEZE_THRESHOLD   : 0.001,
    BB_ENABLED             : true,
    SRSI_PERIOD            : 14,
    SRSI_K                 : 3,
    SRSI_D                 : 3,
    SRSI_OVERSOLD          : 20,
    SRSI_OVERBOUGHT        : 80,
    SRSI_ENABLED           : true,
    DIV_ENABLED            : true,
    DIV_LOOKBACK           : 12,
    FIB_ENABLED            : true,
    FIB_LOOKBACK           : 20,
    FIB_TOLERANCE          : 0.002,
    MTF_ENABLED            : true,
    MTF_MULTIPLIER         : 4,
    SR_ENABLED             : true,
    SR_LOOKBACK            : 20,
    SR_TOLERANCE           : 0.001,
    ATR_PERIOD             : 14,
    ATR_ENABLED            : true,
    ATR_MOMENTUM_RATIO     : 0.3,
    MICRO_TREND_ENABLED    : true,
    MICRO_TREND_EMA_PERIOD : 5,

    // ── TVE ───────────────────────────────────────────────────────────────────
    TVE_ENABLED            : true,
    TVE_BUF_SIZE           : 30,
    TVE_MIN_DT_MS          : 10,
    TVE_STD_WINDOW_MS      : 3000,
    TVE_VEL_HISTORY        : 50,
    TVE_SIGMA_THRESHOLD    : 1.8,
    TVE_STREAK_ENABLED     : true,
    TVE_STREAK_MIN         : 4,
    SHORT_MODE_SIGMA       : 1.2,
    TVE_PRIORITY           : true,
    ADAPTIVE_SIGMA_ENABLED : true,
    ADAPTIVE_SIGMA_FLOOR   : 1.2,
    ADAPTIVE_SIGMA_DECAY_STEP: 0.05,
    ADAPTIVE_SIGMA_DECAY_MS: 30000,
    ADAPTIVE_SIGMA_IDLE_MS : 120000,

    // ── SUPREME-PRED v3 ───────────────────────────────────────────────────────
    SUPREME_MIN_CONF       : 52,
    SUPREME_AUTO_CONF      : 60,
    SUPREME_DOUBLE_CONF    : 75,
    SUPREME_LEARN_RATE     : 0.015,
    SUPREME_ALGO_WEIGHT_MIN: 0.25,
    SUPREME_ALGO_WEIGHT_MAX: 5.5,
    SUPREME_KALMAN_Q       : 0.001,
    SUPREME_KALMAN_R       : 0.01,
    SUPREME_HURST_TREND    : 0.58,
    SUPREME_HURST_RANGE    : 0.48,
    SUPREME_VOLATILE_ATR_MULT: 1.8,
    SUPREME_REGIME_MIN_TRADES: 15,
    SUPREME_REGIME_BLOCK_WR: 0.42,

    // ── ORDER BOOK IMBALANCE ENGINE ──────────────────────────────────────────
    OBI_WINDOW             : 30,
    OBI_STRONG_THRESHOLD   : 0.65,
    OBI_WEIGHT             : 2.2,
    OBI_DECAY_ALPHA        : 0.92,
    OBI_ENABLED            : true,

    // ── LATENCY ARBITRAGE DETECTOR ───────────────────────────────────────────
    LAD_ENABLED            : true,
    LAD_DESYNC_THRESHOLD_MS: 150,
    LAD_MIN_STREAMS        : 1,
    LAD_BOOST_WEIGHT       : 1.8,
    LAD_HISTORY_SIZE       : 20,

    // ── FRACTIONAL KELLY ──────────────────────────────────────────────────────
    KELLY_ENABLED          : true,
    KELLY_FRACTION         : 0.35,
    KELLY_MIN              : 1,
    KELLY_MAX_PCT          : 0.05,
    KELLY_MAX_USD          : 50,
    KELLY_REGIME_TREND     : 1.0,
    KELLY_REGIME_RANGE     : 0.8,
    KELLY_REGIME_VOLATILE  : 0.5,
    KELLY_STREAK_LOSS_MULT : 0.6,
    KELLY_STREAK_WIN_MULT  : 1.15,
    KELLY_STREAK_WIN_MIN   : 3,
    KELLY_VOL_HIGH_MULT    : 0.7,
    KELLY_VOL_EXPLOSIVE_MULT: 0.4,

    // ── ANTI-MARTINGALE PYRAMIDING ────────────────────────────────────────────
    PYRAMID_ENABLED        : true,
    PYRAMID_MIN_STREAK     : 3,
    PYRAMID_SCALE_1        : 1.0,
    PYRAMID_SCALE_2        : 1.5,
    PYRAMID_SCALE_3        : 2.0,
    PYRAMID_MAX_TIERS      : 3,
    PYRAMID_COOLDOWN_MS    : 2000,
    PYRAMID_REQUIRE_CONF   : 70,

    // ── IMDB ──────────────────────────────────────────────────────────────────
    IMDB_ENABLED           : true,
    IMDB_TIER_DOUBLE       : 62,
    IMDB_TIER_TRIPLE       : 75,
    IMDB_TIER_QUAD         : 88,
    IMDB_AMOUNT_MULT_2     : 1.0,
    IMDB_AMOUNT_MULT_3     : 1.2,
    IMDB_AMOUNT_MULT_4     : 1.5,
    IMDB_INSTANT_DELAY_MS  : 2,
    IMDB_COOLDOWN_MS       : 3000,
    ISLAMIC_DISABLE_IMDB   : true,

    // ── DOUBLE TRADE ─────────────────────────────────────────────────────────
    DOUBLE_ENABLED         : true,
    DOUBLE_REQUIRE_TVE     : true,
    DOUBLE_REQUIRE_MACD    : false,
    DOUBLE_AMOUNT_MULT     : 1.0,
    DOUBLE_DELAY_MS        : 200,
    DOUBLE_COOLDOWN_MS     : 5000,

    // ── SESSION PROTECTION ────────────────────────────────────────────────────
    SESSION_PROTECTION_ENABLED: true,
    SESSION_MAX_LOSS_STREAK: 4,
    SESSION_MAX_HOURLY_LOSSES: 6,
    SESSION_MIN_WINRATE_20 : 0.35,
    SESSION_DRAWDOWN_LIMIT : 0.20,
    SESSION_PAUSE_MINUTES  : 15,
    SESSION_REGIME_BLOCK_WR: 0.38,

    // ── LSTM PROXY ────────────────────────────────────────────────────────────
    LSTM_ENABLED           : true,
    LSTM_SEQ_LEN           : 16,
    LSTM_HIDDEN            : 12,
    LSTM_LEARN_RATE        : 0.03,
    LSTM_WEIGHT_IN_ENSEMBLE: 1.4,

    // ── RL WEIGHT ENGINE ──────────────────────────────────────────────────────
    RL_ENABLED             : true,
    RL_EPSILON             : 0.08,
    RL_GAMMA               : 0.92,
    RL_ALPHA               : 0.12,
    RL_STATE_BUCKETS       : 4,

    // ── ETC (Execution Timing Calibrator) ─────────────────────────────────────
    ETC_CONF_MIN           : 55,
    ETC_MAX_OFFSET         : 800,
    ETC_DECAY_WIN          : 4,
    ETC_STEP_RATE          : 0.6,
    ETC_MAX_HIST           : 30,

    // ── Smart Early Entry ─────────────────────────────────────────────────────
    SEE_ENABLED            : true,
    SEE_CONF_HIGH          : 4.5,
    SEE_CONF_MED           : 3.0,
    SEE_RATIO_HIGH         : 0.38,
    SEE_RATIO_MED          : 0.22,
    SEE_RATIO_LOW          : 0.12,
    SEE_MIN_MS             : 200,
    SEE_MAX_MS             : 4000,
    PREDICTIVE_FIRE_MS     : 500,

    // ── PPT (Pattern Performance Tracking) ───────────────────────────────────
    PPT_ENABLED            : true,
    PPT_MIN_TRADES         : 8,
    PPT_DECAY_DAYS         : 3,
    PPT_DECAY_FACTOR       : 0.85,
    PPT_LOW_WR_THRESHOLD   : 0.38,
    PPT_HIGH_WR_THRESHOLD  : 0.65,

    // ── Phantom Predictor ─────────────────────────────────────────────────────
    CR15_ENABLED           : true,
    CR15_TRADE_SEC         : 3,
    CR15_AMOUNT            : 0,
    CC3_ENABLED            : true,
    CC3_AMOUNT             : 0,

    // ── Volatility ────────────────────────────────────────────────────────────
    VOLATILITY_ATR_WINDOW  : 20,
    VOLATILITY_SQUEEZE_MULT: 0.6,
    VOLATILITY_EXPLOSIVE_MULT: 2.0,
    VOLATILITY_BB_SQUEEZE  : 0.003,
    VOL_GATE_SQUEEZE_BLOCK : false,
    VOL_GATE_EXPLOSIVE_CONF: 80,

    // ── Stream Watchdog ───────────────────────────────────────────────────────
    STREAM_STALL_MS        : 5000,
    DSO_WS_PING_MS         : 25000,
    FRAG_BUFFER_TTL        : 2000,
    CLOCK_SYNC_ENABLED     : true,

    // ── Slippage guard ────────────────────────────────────────────────────────
    SLIPPAGE_ENABLED       : true,
    SLIPPAGE_TICKS         : 8,

    // ── WebWorker ─────────────────────────────────────────────────────────────
    WORKER_ENABLED         : true,
    WORKER_TIMEOUT_MS      : 80,

    // ── Packet CRC ───────────────────────────────────────────────────────────
    CRC_ENABLED            : true,

    // ── DOM Self-Healing ─────────────────────────────────────────────────────
    DOM_HEAL_ENABLED       : true,
    DOM_HEAL_INTERVAL_MS   : 8000,

    // ── Misc ──────────────────────────────────────────────────────────────────
    PSM_ENABLED            : true,
    PSM_MIN_TICKS          : 3,
    MAX_LOSS_STREAK        : 4,
    GH_TOKEN               : '',
    GH_REPO                : '',
    GH_BRANCH              : 'main',
    GH_SYNC_INTERVAL_MS    : 300000,
    DB_TICK_ENABLED        : true,
    MINI_BACKTEST_ENABLED  : true,
    MINI_BACKTEST_MIN_CANDLES: 15,
    APPDATA_READ_ENABLED   : true,
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // §2  EVENT BUS — deterministic pub/sub with priority lanes
  // ══════════════════════════════════════════════════════════════════════════════
  const EventBus = (() => {
    const _subs = Object.create(null);
    const _once = Object.create(null);
    return {
      on(event, fn, priority) {
        if (!_subs[event]) _subs[event] = [];
        _subs[event].push({ fn, priority: priority || 0 });
        _subs[event].sort((a, b) => b.priority - a.priority);
        return () => this.off(event, fn);
      },
      once(event, fn) {
        if (!_once[event]) _once[event] = [];
        _once[event].push(fn);
      },
      off(event, fn) {
        if (!_subs[event]) return;
        _subs[event] = _subs[event].filter(s => s.fn !== fn);
      },
      emit(event, data) {
        const subs = _subs[event];
        if (subs) { for (let i = 0; i < subs.length; i++) { try { subs[i].fn(data); } catch (e) { console.error('[EB]', event, e); } } }
        const once = _once[event];
        if (once && once.length) { _once[event] = []; for (let i = 0; i < once.length; i++) { try { once[i](data); } catch (e) {} } }
      },
      clear(event) { if (event) { delete _subs[event]; delete _once[event]; } else { Object.keys(_subs).forEach(k => delete _subs[k]); } },
    };
  })();

  // ══════════════════════════════════════════════════════════════════════════════
  // §3  RUNTIME CORE — shared state, object pools, typed buffers
  // ══════════════════════════════════════════════════════════════════════════════
  const _STATE = {
    activeAsset     : null,
    candlePeriod    : 0,
    tradeDuration   : 0,
    durSource       : 'none',
    wsConnected     : false,
    totalTicks      : 0,
    autoTrade       : true,
    tradeExec       : false,
    lastTradeMs     : 0,
    lastSignal      : null,
    windowTimer     : null,
    fastCloseAt     : 0,
    clockOffset     : 0,
    isDemo          : 1,
    tradeAmount     : CFG.DEFAULT_AMOUNT,
    manualAmountOverride: false,
    accountBalance  : null,
    lastOpenedOrder : null,
    volatilityState : 'NORMAL',
    streamStalled   : false,
    lastTickMs      : 0,
    dynamicPayout   : null,
    isIslamicAccount: false,
    platformId      : 0,
    platformVersion : 0,
    sessionStartBalance: null,
    signalPrice     : null,
    tickSize        : null,
    readySignal     : null,
    readySignalTs   : 0,
    lastExecutedSignalKey: null,
    lastExecutedSignalTs : 0,
    lastTradeWasTVE : false,
    lastTradePatternCase: null,
    lastTradeWasDouble: false,
    lastDoubleTradeMs: 0,
    candlesSinceAssetChange: 0,
    lastIMDBTradeMs : 0,
    lossStreakPauseUntil: 0,
    periodLockUntil : 0,
    lastDetectedPeriod: 0,
    lastDetectedCount : 0,
    ghostTradeActive : false,
    ghostSignal      : null,
    ghostWatching    : false,
    recalibrating    : false,
    tradeExecLockTimer : null,
    tradeExecResetTimer: null,
    subSecondBucket  : 0,
    pendingIsTVE     : false,
    pendingTradeRecord: null,
    magnetPulse2Active: false,
    magnetPulse3Active: false,
    etcOffset        : 0,
    etcPending       : null,
    etcHistory       : [],
    currentSigma     : CFG.TVE_SIGMA_THRESHOLD,
    adaptiveSigmaActive: false,
    adaptiveSigmaTimer : null,
    predictiveTimer  : null,
    predictiveRAF    : null,
    cr15LastFire     : 0,
    cc3LastFireCandle: 0,
    pyramidTier      : 1,
    pyramidLastMs    : 0,
    sessionHourlyLosses: 0,
    sessionHourlyStart : Date.now(),
    sessionPausedUntil : 0,
    workerReady      : false,
    workerPending    : new Map(),
    miniBacktestDone : false,
  };

  // Typed-array rolling buffer pool — reused to avoid GC churn
  const _BUF = {
    _pool: new Map(),
    get(key, size, Type) {
      Type = Type || Float64Array;
      const k = key + '_' + size;
      if (!this._pool.has(k)) this._pool.set(k, new Type(size));
      return this._pool.get(k);
    },
  };

  // Per-asset data maps
  const tickBuffers   = {};   // asset → price[]  (last 600)
  const candleBuffers = {};   // asset → candle[]
  const currentCandles= {};   // asset → {open,high,low,prices[],startTime}
  const chaforState   = {};   // asset → {prev,resetAt}
  const botOrderIds   = new Set();
  const _assetPayouts = new Map();
  const _assetIsOpen  = new Map();
  const _atrHistory   = [];
  const _recentResults= [];
  const _spyEntries   = [];
  const _SESSION_ID   = Date.now().toString(36);

  // Request ID generator (unique per order)
  let _reqIdCounter = 0;
  function _nextReqId() {
    _reqIdCounter = (_reqIdCounter + 1) & 0xFFFFFF;
    const perfNs = Math.round((W.performance?.now?.() ?? Date.now()) * 1000) & 0xFFFFF;
    return ((_reqIdCounter << 20) | perfNs) >>> 0;
  }

  // Interval tracker for clean teardown
  const _intervals = [];
  const _setInterval = (fn, ms) => { const id = setInterval(fn, ms); _intervals.push(id); return id; };
  function _clearAllIntervals() { _intervals.forEach(clearInterval); _intervals.length = 0; }

  const PO_VALID_TIMES = [1,2,3,5,10,15,20,25,30,45,60,90,120,180,300,600,900,1800,3600];
  const TRUSTED_SOURCES = new Set(['saveCharts','platform','updateCharts','history']);

  // addLog — unified log sink
  const _logBuf = [];
  function addLog(msg, type, detail) {
    const entry = { ts: Date.now(), msg, type: type || 'info', detail: detail || '' };
    _logBuf.push(entry);
    if (_logBuf.length > 500) _logBuf.shift();
    try {
      const logEl = W.document.getElementById('cbLogBody');
      if (!logEl) return;
      const row = W.document.createElement('div');
      row.className = 'cb-log-row ' + (type || '');
      const time = new Date(entry.ts).toLocaleTimeString('ar');
      row.innerHTML = '<span class="cb-log-ts">' + time + '</span><span class="cb-log-msg">' + msg + '</span>';
      if (detail) { const dEl = W.document.createElement('div'); dEl.className='cb-log-detail'; dEl.textContent=detail; row.appendChild(dEl); }
      logEl.insertBefore(row, logEl.firstChild);
      if (logEl.children.length > 120) logEl.removeChild(logEl.lastChild);
    } catch (_) {}
  }

  // Payload cache
  const _payloadCache = { call: null, put: null, asset: null, time: 0, amount: 0, isDemo: -1, prefixCall: '', suffixCall: '', prefixPut: '', suffixPut: '' };
  function _rebuildPayloadCache() {
    const a = _STATE.activeAsset || '';
    const t = _STATE.tradeDuration > 0 ? _STATE.tradeDuration : snapToPOTime(_STATE.candlePeriod || 5);
    const amt = _STATE.tradeAmount, d = _STATE.isDemo;
    if (_payloadCache.asset === a && _payloadCache.time === t && _payloadCache.amount === amt && _payloadCache.isDemo === d) return;
    _payloadCache.asset = a; _payloadCache.time = t; _payloadCache.amount = amt; _payloadCache.isDemo = d;
    _payloadCache.prefixCall = '42["openOrder",{"asset":"'+a+'","amount":'+amt+',"action":"call","isDemo":'+d+',"requestId":';
    _payloadCache.suffixCall = ',"optionType":100,"time":'+t+'}]';
    _payloadCache.prefixPut  = '42["openOrder",{"asset":"'+a+'","amount":'+amt+',"action":"put","isDemo":'+d+',"requestId":';
    _payloadCache.suffixPut  = _payloadCache.suffixCall;
  }
  function _getCachedPayload(direction, overrideAmount, overrideTime) {
    const t = overrideTime ? overrideTime : (_STATE.tradeDuration > 0 ? _STATE.tradeDuration : snapToPOTime(_STATE.candlePeriod || 5));
    if (overrideAmount && overrideAmount !== _STATE.tradeAmount) {
      const a = _STATE.activeAsset || '', d = _STATE.isDemo;
      return '42["openOrder",{"asset":"'+a+'","amount":'+overrideAmount+',"action":"'+(direction==='BUY'?'call':'put')+'","isDemo":'+d+',"requestId":'+_nextReqId()+',"optionType":100,"time":'+t+'}]';
    }
    if (overrideTime) {
      const a = _STATE.activeAsset || '', d = _STATE.isDemo;
      return '42["openOrder",{"asset":"'+a+'","amount":'+_STATE.tradeAmount+',"action":"'+(direction==='BUY'?'call':'put')+'","isDemo":'+d+',"requestId":'+_nextReqId()+',"optionType":100,"time":'+t+'}]';
    }
    _rebuildPayloadCache();
    return direction === 'BUY'
      ? _payloadCache.prefixCall + _nextReqId() + _payloadCache.suffixCall
      : _payloadCache.prefixPut  + _nextReqId() + _payloadCache.suffixPut;
  }
  function snapToPOTime(raw) { return PO_VALID_TIMES.reduce((a,b) => Math.abs(b-raw)<Math.abs(a-raw)?b:a); }
  function _safeAmount(amt) {
    const hardCap = CFG.KELLY_MAX_USD > 0 ? CFG.KELLY_MAX_USD : 50;
    const pctCap  = _STATE.accountBalance > 0 ? _STATE.accountBalance * (CFG.KELLY_MAX_PCT || 0.05) : hardCap;
    return Math.max(CFG.KELLY_MIN || 1, Math.min(amt || _STATE.tradeAmount, pctCap, hardCap));
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // §4  TELEMETRY CORE
  // ══════════════════════════════════════════════════════════════════════════════
  const TELEMETRY = {
    packetRecv : 0, decodeStart: 0, tickRecv: 0, psmArmed: 0,
    schedFired : 0, orderSent: 0,
    _tickLatEma: null, _tickCount: 0, _DISPLAY_EVERY: 10,
    latencyLog  : [],
    predQuality : [],
    anomalies   : [],

    mark(label) { this[label] = performance.now(); },

    tickDone() {
      this._tickCount++;
      const lat = this.orderSent > this.packetRecv ? (this.orderSent - this.packetRecv) : 0;
      if (lat > 0) {
        this._tickLatEma = this._tickLatEma === null ? lat : this._tickLatEma * 0.9 + lat * 0.1;
        this.latencyLog.push({ ts: Date.now(), lat });
        if (this.latencyLog.length > 200) this.latencyLog.shift();
      }
      if (this._tickCount % this._DISPLAY_EVERY === 0) this._updateDisplay();
    },

    recordPrediction(predicted, actual, conf) {
      const err = actual !== 0 ? Math.abs(predicted - actual) / Math.abs(actual) : 0;
      this.predQuality.push({ ts: Date.now(), err, conf });
      if (this.predQuality.length > 100) this.predQuality.shift();
    },

    recordAnomaly(type, detail) {
      const entry = { ts: Date.now(), type, detail };
      this.anomalies.push(entry);
      if (this.anomalies.length > 50) this.anomalies.shift();
      addLog('[ANOMALY] ' + type + ': ' + detail, 'error');
    },

    avgLatency() { return this._tickLatEma !== null ? this._tickLatEma.toFixed(1) + 'ms' : '–'; },

    predAccuracy() {
      if (this.predQuality.length < 5) return '–';
      const recent = this.predQuality.slice(-20);
      const avg = recent.reduce((s,v) => s + v.err, 0) / recent.length;
      return (100 - avg * 100).toFixed(1) + '%';
    },

    _updateDisplay() {
      try {
        const latEl = W.document.getElementById('cbLatency');
        if (latEl) latEl.textContent = this.avgLatency();
        const accEl = W.document.getElementById('cbPredAcc');
        if (accEl) accEl.textContent = this.predAccuracy();
      } catch(_) {}
    },

    report() {
      if (this.orderSent > 0 && this.packetRecv > 0) {
        const total = this.orderSent - this.packetRecv;
        addLog('[TEL] Δ=' + total.toFixed(1) + 'ms | lat=' + this.avgLatency() + ' | acc=' + this.predAccuracy(), 'info');
      }
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // §5  MSGPACK DECODER — compact binary protocol parser
  // ══════════════════════════════════════════════════════════════════════════════
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
    const ri64 = () => { const h = view.getInt32(pos,false),l = view.getUint32(pos+4,false); pos+=8; return h*4294967296+l; };
    const ru64 = () => { const h = view.getUint32(pos,false),l = view.getUint32(pos+4,false); pos+=8; return h*4294967296+l; };
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
        default: throw new Error('msgpack:0x'+b.toString(16));
      }
    }
    try { return decode(); } catch(e) { throw e; }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // §6  PACKET INTEGRITY + CRC32 VALIDATION
  // ══════════════════════════════════════════════════════════════════════════════
  const _CRC32_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = _CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  const _packetChecksums = new Map();
  let _crcFailCount = 0;

  function validatePacket(bytes, wsUrl) {
    if (!CFG.CRC_ENABLED || bytes.length < 8) return true;
    const checksum = crc32(bytes);
    const key = wsUrl + ':' + bytes.length;
    const prev = _packetChecksums.get(key);
    // Duplicate detection: exact same length+checksum within 100ms = duplicate frame
    if (prev && prev.crc === checksum && (Date.now() - prev.ts) < 100) {
      return false; // duplicate — discard
    }
    _packetChecksums.set(key, { crc: checksum, ts: Date.now() });
    // Cleanup old entries every 500 packets
    if (_packetChecksums.size > 500) {
      const cutoff = Date.now() - 5000;
      for (const [k, v] of _packetChecksums) { if (v.ts < cutoff) _packetChecksums.delete(k); }
    }
    return true;
  }

  function detectMalformedFrame(bytes) {
    if (!bytes || bytes.length < 2) return true;
    const first = bytes[0];
    // MsgPack: valid start bytes for our protocol
    const validStarts = [0x80,0x81,0x82,0x83,0x84,0x90,0x91,0x92,0x93,0x94,0x95,0x5b,0xa0,0xa1,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xab,0xac,0xad,0xae,0xaf];
    for (const s of validStarts) { if (first === s) return false; }
    // Range 0-127 (positive fixint), 0xe0-0xff (negative fixint), 0xc0-0xdf (type markers)
    if (first <= 0x7f || first >= 0xe0 || (first >= 0xc0 && first <= 0xdf)) return false;
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // §7  WEBWORKER INFRASTRUCTURE — compute offloading
  // ══════════════════════════════════════════════════════════════════════════════
  let _worker = null;
  let _workerCallbacks = new Map();
  let _workerMsgId = 0;

  const _WORKER_CODE = `
    'use strict';
    // Lightweight math kernels for worker-side computation
    function hurstRS(vels) {
      if (!vels || vels.length < 32) return 0.5;
      const rs = (n) => {
        const w = vels.slice(-n);
        let sum=0; for(let i=0;i<w.length;i++) sum+=w[i]; const m=sum/w.length;
        let cum=0,mx=-Infinity,mn=Infinity,ss=0;
        for(let i=0;i<w.length;i++){cum+=w[i]-m;if(cum>mx)mx=cum;if(cum<mn)mn=cum;ss+=(w[i]-m)**2;}
        const s=Math.sqrt(ss/w.length); return s>1e-12?(mx-mn)/s:null;
      };
      const pts=[[4,rs(4)],[8,rs(8)],[16,rs(16)],[32,rs(32)]];
      const valid=pts.filter(([,r])=>r!==null&&r>0);
      if(valid.length<2) return 0.5;
      const h=valid.map(([n,r])=>Math.log(r)/Math.log(n));
      return Math.max(0.1,Math.min(0.9,h.reduce((a,v)=>a+v,0)/h.length));
    }
    function dfaHurst(data,n) {
      const len=Math.min(n,data.length); if(len<12) return 0.5;
      let mean=0; for(let i=0;i<len;i++) mean+=data[i]; mean/=len;
      const Y=new Float64Array(len); let cum=0;
      for(let i=0;i<len;i++){cum+=data[i]-mean;Y[i]=cum;}
      const scales=[4,6,8,12,16].filter(s=>s*2<=len);
      if(scales.length<2) return 0.5;
      const logF=[],logS=[];
      for(const s of scales){
        let fSum=0,cnt=0;
        for(let st=0;st+s<=len;st+=s){
          let sx=0,sy=0,sxy=0,sx2=0;
          for(let i=0;i<s;i++){sx+=i;sy+=Y[st+i];sxy+=i*Y[st+i];sx2+=i*i;}
          const den=s*sx2-sx*sx||1; const m=(s*sxy-sx*sy)/den,b=(sy-m*sx)/s;
          let res=0; for(let i=0;i<s;i++){const d=Y[st+i]-m*i-b;res+=d*d;}
          fSum+=res/s;cnt++;
        }
        if(cnt>0&&fSum>0){logF.push(0.5*Math.log(fSum/cnt));logS.push(Math.log(s));}
      }
      if(logF.length<2) return 0.5;
      let xm=0,ym=0; for(let i=0;i<logS.length;i++){xm+=logS[i];ym+=logF[i];} xm/=logS.length;ym/=logF.length;
      let num=0,den2=0; for(let i=0;i<logS.length;i++){num+=(logS[i]-xm)*(logF[i]-ym);den2+=(logS[i]-xm)**2;}
      return den2>1e-15?Math.max(0.1,Math.min(0.9,num/den2)):0.5;
    }
    function permEntropy3(buf,n) {
      const len=Math.min(n,buf.length); if(len<5) return 1;
      const cnt=[0,0,0,0,0,0]; const total=len-2;
      for(let i=0;i<total;i++){const a=buf[i],b=buf[i+1],c=buf[i+2];cnt[a<=b?(b<=c?0:a<=c?1:2):(a<=c?3:b<=c?4:5)]++;}
      let H=0; for(let k=0;k<6;k++){if(cnt[k]>0){const p=cnt[k]/total;H-=p*Math.log2(p);}} return H/2.58496;
    }
    function dftCycleSignal(prices,n) {
      const len=Math.min(n,prices.length); if(len<8) return 0;
      let mean=0; for(let i=0;i<len;i++) mean+=prices[i]; mean/=len;
      let maxPow=0,bestK=1;
      for(let k=1;k<=Math.floor(len/2);k++){
        let re=0,im=0; for(let t=0;t<len;t++){const a=6.28318*k*t/len;re+=(prices[t]-mean)*Math.cos(a);im+=(prices[t]-mean)*Math.sin(a);}
        const pow=re*re+im*im; if(pow>maxPow){maxPow=pow;bestK=k;}
      }
      let re=0,im=0;
      for(let t=0;t<len;t++){const a=6.28318*bestK*t/len;re+=(prices[t]-mean)*Math.cos(a);im+=(prices[t]-mean)*Math.sin(a);}
      const phase=Math.atan2(im,re)+6.28318*bestK*(len-1)/len;
      return -Math.cos(phase);
    }
    self.onmessage = function(e) {
      const {id, type, payload} = e.data;
      try {
        let result;
        if (type === 'hurst') { result = hurstRS(payload.vels); }
        else if (type === 'dfaHurst') { result = dfaHurst(payload.data, payload.n); }
        else if (type === 'permEnt') { result = permEntropy3(payload.buf, payload.n); }
        else if (type === 'dftCycle') { result = dftCycleSignal(payload.prices, payload.n); }
        else if (type === 'multiCalc') {
          const v = payload.vels, p = payload.prices, n = payload.n;
          result = {
            hurst: hurstRS(v),
            dfaH:  dfaHurst(v, n),
            permEnt: permEntropy3(v, n),
            dftCycle: dftCycleSignal(p, n),
          };
        }
        self.postMessage({ id, result, error: null });
      } catch(err) {
        self.postMessage({ id, result: null, error: err.message });
      }
    };
  `;

  function _initWorker() {
    if (!CFG.WORKER_ENABLED || _worker) return;
    try {
      const blob = new Blob([_WORKER_CODE], { type: 'application/javascript' });
      const url  = URL.createObjectURL(blob);
      _worker = new Worker(url);
      URL.revokeObjectURL(url);
      _worker.onmessage = (e) => {
        const { id, result, error } = e.data;
        const cb = _workerCallbacks.get(id);
        if (cb) { _workerCallbacks.delete(id); if (error) cb(null, error); else cb(result, null); }
      };
      _worker.onerror = (e) => {
        addLog('[WORKER] error: ' + e.message, 'error');
        _worker = null;
        _STATE.workerReady = false;
      };
      _STATE.workerReady = true;
      addLog('[WORKER] ✅ WebWorker initialized', 'info');
    } catch (e) {
      addLog('[WORKER] ⚠ Failed to init: ' + e.message + ' — running on main thread', 'info');
      _STATE.workerReady = false;
    }
  }

  function _workerPost(type, payload, callback, timeoutMs) {
    if (!_worker || !_STATE.workerReady) { callback(null, 'no-worker'); return; }
    const id = ++_workerMsgId;
    _workerCallbacks.set(id, callback);
    _worker.postMessage({ id, type, payload });
    const tm = setTimeout(() => {
      if (_workerCallbacks.has(id)) { _workerCallbacks.delete(id); callback(null, 'timeout'); }
    }, timeoutMs || CFG.WORKER_TIMEOUT_MS);
    // override: wrap callback to clear timeout
    const orig = _workerCallbacks.get(id);
    _workerCallbacks.set(id, (res, err) => { clearTimeout(tm); orig(res, err); });
  }

  // Sync fallback for when worker is unavailable
  function _workerSync(type, payload) {
    if (type === 'hurst') return _MATH.hurstFromVels(payload.vels);
    if (type === 'dfaHurst') return _MATH.dfaHurst(payload.data, payload.n);
    if (type === 'permEnt') return _MATH.permEntropy3(payload.buf, payload.n);
    if (type === 'dftCycle') return _MATH.dftCycleSignal(payload.prices, payload.n);
    if (type === 'multiCalc') {
      const v = payload.vels, p = payload.prices, n = payload.n;
      return { hurst: _MATH.hurstFromVels(v), dfaH: _MATH.dfaHurst(v, n), permEnt: _MATH.permEntropy3(v, n), dftCycle: _MATH.dftCycleSignal(p, n) };
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // §8  MATH CORE — all mathematical kernels
  // ══════════════════════════════════════════════════════════════════════════════
  const _MATH = Object.freeze({
    sigmoid6: (x) => 1 / (1 + Math.exp(-x * 6)),
    wilderStep: (prev, val, period) => (prev * (period - 1) + val) / period,
    rsAnalysis(w) {
      if (!w || w.length < 4) return null;
      const n = w.length; let sum = 0;
      for (let i = 0; i < n; i++) sum += w[i];
      const m = sum / n; let cum = 0, mx = -Infinity, mn = Infinity, ss = 0;
      for (let i = 0; i < n; i++) { cum += w[i]-m; if(cum>mx)mx=cum; if(cum<mn)mn=cum; ss+=(w[i]-m)**2; }
      const s = Math.sqrt(ss/n); return s>1e-12?(mx-mn)/s:null;
    },
    hurstFromVels(vels) {
      if (!vels || vels.length < 32) return 0.5;
      const rs = (n) => { const w=vels.slice(-n); return this.rsAnalysis(w); };
      const pts = [[4,rs(4)],[8,rs(8)],[16,rs(16)],[32,rs(32)]];
      const valid = pts.filter(([,r]) => r!==null&&r>0);
      if (valid.length < 2) return 0.5;
      const h = valid.map(([n,r]) => Math.log(r)/Math.log(n));
      return Math.max(0.1, Math.min(0.9, h.reduce((a,v)=>a+v,0)/h.length));
    },
    kalmanStep(kf_x, kf_p, measurement, Q, R) {
      const p_pred = kf_p + Q;
      const K = p_pred / (p_pred + R);
      return { x: kf_x + K*(measurement - kf_x), p: (1-K)*p_pred, K };
    },
    kalman2D(state, meas, Qp, Qv, R) {
      const {x, v, P00, P01, P11} = state;
      const xp=x+v, P00p=P00+2*P01+P11+Qp, P01p=P01+P11, P11p=P11+Qv;
      const S=P00p+R, K0=P00p/S, K1=P01p/S, y=meas-xp;
      return { x:xp+K0*y, v:v+K1*y, P00:(1-K0)*P00p, P01:P01p*(1-K0), P11:P11p-K1*P01p };
    },
    shannonH(p) { const q=1-p; return -(p>0?p*Math.log2(p):0)-(q>0?q*Math.log2(q):0); },
    autocorrLag(buf, n, lag) {
      if (n < lag+2) return 0;
      let sx=0,sy=0,sxy=0,sx2=0,cnt=0;
      for(let i=0;i<n-lag;i++){sx+=buf[i];sy+=buf[i+lag];sxy+=buf[i]*buf[i+lag];sx2+=buf[i]*buf[i];cnt++;}
      const d=cnt*sx2-sx*sx; return Math.abs(d)>1e-20?(cnt*sxy-sx*sy)/d:0;
    },
    permEntropy3(buf, n) {
      const len=Math.min(n,buf.length); if(len<5) return 1;
      const cnt=[0,0,0,0,0,0]; const total=len-2;
      for(let i=0;i<total;i++){const a=buf[i],b=buf[i+1],c=buf[i+2];cnt[a<=b?(b<=c?0:a<=c?1:2):(a<=c?3:b<=c?4:5)]++;}
      let H=0; for(let k=0;k<6;k++){if(cnt[k]>0){const p=cnt[k]/total;H-=p*Math.log2(p);}} return H/2.58496;
    },
    kaufmanER(vels, n) {
      const len=Math.min(n,vels.length); if(len<3) return 0;
      let net=0,path=0; for(let i=0;i<len;i++){net+=vels[i];path+=Math.abs(vels[i]);}
      return path<1e-12?0:Math.abs(net)/path;
    },
    dfaHurst(data, n) {
      const len=Math.min(n,data.length); if(len<12) return 0.5;
      let mean=0; for(let i=0;i<len;i++) mean+=data[i]; mean/=len;
      const Y=new Float64Array(len); let cum=0;
      for(let i=0;i<len;i++){cum+=data[i]-mean;Y[i]=cum;}
      const scales=[4,6,8,12,16].filter(s=>s*2<=len); if(scales.length<2) return 0.5;
      const logF=[],logS=[];
      for(const s of scales){
        let fSum=0,cnt=0;
        for(let st=0;st+s<=len;st+=s){
          let sx=0,sy=0,sxy=0,sx2=0;
          for(let i=0;i<s;i++){sx+=i;sy+=Y[st+i];sxy+=i*Y[st+i];sx2+=i*i;}
          const den=s*sx2-sx*sx||1; const m=(s*sxy-sx*sy)/den,b=(sy-m*sx)/s;
          let res=0; for(let i=0;i<s;i++){const d=Y[st+i]-m*i-b;res+=d*d;} fSum+=res/s;cnt++;
        }
        if(cnt>0&&fSum>0){logF.push(0.5*Math.log(fSum/cnt));logS.push(Math.log(s));}
      }
      if(logF.length<2) return 0.5;
      let xm=0,ym=0; for(let i=0;i<logS.length;i++){xm+=logS[i];ym+=logF[i];} xm/=logS.length;ym/=logF.length;
      let num=0,den2=0; for(let i=0;i<logS.length;i++){num+=(logS[i]-xm)*(logF[i]-ym);den2+=(logS[i]-xm)**2;}
      return den2>1e-15?Math.max(0.1,Math.min(0.9,num/den2)):0.5;
    },
    dftCycleSignal(prices, n) {
      const len=Math.min(n,prices.length); if(len<8) return 0;
      let mean=0; for(let i=0;i<len;i++) mean+=prices[i]; mean/=len;
      let maxPow=0,bestK=1;
      for(let k=1;k<=Math.floor(len/2);k++){
        let re=0,im=0; for(let t=0;t<len;t++){const a=6.28318*k*t/len;re+=(prices[t]-mean)*Math.cos(a);im+=(prices[t]-mean)*Math.sin(a);}
        const pow=re*re+im*im; if(pow>maxPow){maxPow=pow;bestK=k;}
      }
      let re=0,im=0;
      for(let t=0;t<len;t++){const a=6.28318*bestK*t/len;re+=(prices[t]-mean)*Math.cos(a);im+=(prices[t]-mean)*Math.sin(a);}
      const phase=Math.atan2(im,re)+6.28318*bestK*(len-1)/len;
      return -Math.cos(phase);
    },
  });

  // Rolling ATR class using typed array
  class RollingATR {
    constructor(period=14) { this.period=period; this.buf=new Float64Array(period); this.count=0; this.atr=null; }
    addCandle(high, low, prevClose) {
      const tr=Math.max(high-low,Math.abs(high-prevClose),Math.abs(low-prevClose));
      if(this.count<this.period){this.buf[this.count++]=tr;if(this.count===this.period){let s=0;for(let i=0;i<this.period;i++)s+=this.buf[i];this.atr=s/this.period;}}
      else{this.atr=(this.atr*(this.period-1)+tr)/this.period;}
      return this.atr;
    }
    seedFromCandles(candles){for(let i=1;i<candles.length;i++)this.addCandle(candles[i].high,candles[i].low,candles[i-1].close);}
    get value(){return this.atr;} get isReady(){return this.atr!==null;}
  }
  const _rollingATR = new RollingATR(CFG.ATR_PERIOD);

  // Incremental EMA (avoids full recompute)
  const _incEMA = {};
  function _incrementalEMA(key, price, period) {
    const k = 2/(period+1);
    if(!_incEMA[key]||_incEMA[key].period!==period){_incEMA[key]={ema:price,period,count:1};return price;}
    _incEMA[key].ema=price*k+_incEMA[key].ema*(1-k); return _incEMA[key].ema;
  }
  function computeEMA(prices, period) {
    if(!prices||prices.length<period) return null;
    const k=2/(period+1); let ema=prices.slice(0,period).reduce((s,p)=>s+p,0)/period;
    for(let i=period;i<prices.length;i++) ema=prices[i]*k+ema*(1-k); return ema;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // §9  INDICATORS — RSI, MACD, BB, StochRSI, EMA Cross, S/R, Divergence, Fib, MTF
  // ══════════════════════════════════════════════════════════════════════════════
  function computeRSIProxy(candles, period) {
    if(!CFG.RSI_ENABLED) return null;
    const n=candles.length; if(n<period*2) return null;
    let avgGain=0,avgLoss=0;
    for(let i=1;i<=period;i++){const ch=candles[i].close-candles[i-1].close;if(ch>0)avgGain+=ch;else avgLoss-=ch;}
    avgGain/=period;avgLoss/=period;
    for(let i=period+1;i<n;i++){const ch=candles[i].close-candles[i-1].close;const g=ch>0?ch:0,l=ch<0?-ch:0;avgGain=(avgGain*(period-1)+g)/period;avgLoss=(avgLoss*(period-1)+l)/period;}
    if(avgGain+avgLoss<1e-12) return 50;
    return Math.round((100-100/(1+avgGain/(avgLoss||1e-10)))*10)/10;
  }
  function getRSISignal(rsi){if(rsi===null)return null;if(rsi<=CFG.RSI_OVERSOLD)return'BUY';if(rsi>=CFG.RSI_OVERBOUGHT)return'SELL';return null;}

  function getEMACrossSignal(candles) {
    if(!CFG.EMA_CROSS_ENABLED||candles.length<CFG.EMA_SLOW_PERIOD+2) return null;
    const prices=candles.map(c=>c.close);
    const emaSlow=computeEMA(prices,CFG.EMA_SLOW_PERIOD),emaFast=computeEMA(prices,CFG.EMA_FAST_PERIOD);
    if(!emaSlow||!emaFast) return null;
    const lc=prices[prices.length-1];
    if(emaFast>emaSlow&&lc>emaFast) return 'BUY';
    if(emaFast<emaSlow&&lc<emaFast) return 'SELL';
    return null;
  }

  function detectSRLevels(candles) {
    if(!CFG.SR_ENABLED) return {nearSupport:false,nearResistance:false};
    const n=Math.min(candles.length,CFG.SR_LOOKBACK); if(n<5) return {nearSupport:false,nearResistance:false};
    const slice=candles.slice(-n),lc=slice[slice.length-1].close,tol=lc*CFG.SR_TOLERANCE;
    let nearSupport=false,nearResistance=false;
    for(let i=1;i<slice.length-1;i++){
      const c=slice[i],p=slice[i-1],nx=slice[i+1];
      if(c.high>p.high&&c.high>nx.high&&Math.abs(lc-c.high)<=tol) nearResistance=true;
      if(c.low<p.low&&c.low<nx.low&&Math.abs(lc-c.low)<=tol) nearSupport=true;
    }
    return {nearSupport,nearResistance};
  }

  function computeMACD(candles) {
    if(!CFG.MACD_ENABLED||candles.length<CFG.MACD_SLOW+CFG.MACD_SIGNAL+2) return null;
    const prices=candles.map(c=>c.close);
    const emaFast=computeEMA(prices,CFG.MACD_FAST),emaSlow=computeEMA(prices,CFG.MACD_SLOW);
    if(!emaFast||!emaSlow) return null;
    const macdLine=emaFast-emaSlow;
    const macdSeries=[];
    const kFast=2/(CFG.MACD_FAST+1),kSlow=2/(CFG.MACD_SLOW+1);
    let ef=prices.slice(0,CFG.MACD_FAST).reduce((s,p)=>s+p,0)/CFG.MACD_FAST;
    let es=prices.slice(0,CFG.MACD_SLOW).reduce((s,p)=>s+p,0)/CFG.MACD_SLOW;
    for(let i=CFG.MACD_FAST;i<CFG.MACD_SLOW;i++) ef=prices[i]*kFast+ef*(1-kFast);
    for(let i=CFG.MACD_SLOW;i<prices.length;i++){ef=prices[i]*kFast+ef*(1-kFast);es=prices[i]*kSlow+es*(1-kSlow);macdSeries.push(ef-es);}
    if(macdSeries.length<CFG.MACD_SIGNAL+1) return null;
    const kSig=2/(CFG.MACD_SIGNAL+1);
    let sig=macdSeries.slice(0,CFG.MACD_SIGNAL).reduce((s,v)=>s+v,0)/CFG.MACD_SIGNAL;
    for(let i=CFG.MACD_SIGNAL;i<macdSeries.length;i++) sig=macdSeries[i]*kSig+sig*(1-kSig);
    const prevMacd=macdSeries[macdSeries.length-2];
    let prevSig=macdSeries.slice(0,CFG.MACD_SIGNAL).reduce((s,v)=>s+v,0)/CFG.MACD_SIGNAL;
    for(let i=CFG.MACD_SIGNAL;i<macdSeries.length-1;i++) prevSig=macdSeries[i]*kSig+prevSig*(1-kSig);
    const histogram=macdLine-sig;
    let cross=null;
    if(prevMacd<prevSig&&macdLine>sig) cross='BUY';
    if(prevMacd>prevSig&&macdLine<sig) cross='SELL';
    return {macdLine,signalLine:sig,histogram,cross};
  }
  function getMACDSignal(candles){const m=computeMACD(candles);if(!m)return null;if(m.cross)return m.cross;return m.histogram>0?'BUY':m.histogram<0?'SELL':null;}

  function computeBB(candles) {
    if(!CFG.BB_ENABLED||candles.length<CFG.BB_PERIOD) return null;
    const prices=candles.slice(-CFG.BB_PERIOD).map(c=>c.close);
    const middle=prices.reduce((s,p)=>s+p,0)/CFG.BB_PERIOD;
    const variance=prices.reduce((s,p)=>s+(p-middle)**2,0)/CFG.BB_PERIOD;
    const stdDev=Math.sqrt(variance);
    const upper=middle+CFG.BB_STD*stdDev,lower=middle-CFG.BB_STD*stdDev;
    const bandwidth=stdDev>0?(upper-lower)/middle:0;
    const lc=prices[prices.length-1];
    const percentB=bandwidth>0?(lc-lower)/(upper-lower):0.5;
    return {upper,middle,lower,bandwidth,percentB,squeeze:bandwidth<CFG.BB_SQUEEZE_THRESHOLD};
  }
  function getBBSignal(candles){
    const bb=computeBB(candles);if(!bb||bb.squeeze) return null;
    const rsi=computeRSIProxy(candles,CFG.RSI_PERIOD),lc=candles[candles.length-1].close;
    if(lc<=bb.lower&&(rsi===null||rsi<=40)) return 'BUY';
    if(lc>=bb.upper&&(rsi===null||rsi>=60)) return 'SELL';
    return null;
  }

  function computeRSISeries(candles, period) {
    const n=candles.length; if(n<period+1) return null;
    const result=[];
    let avgGain=0,avgLoss=0;
    for(let i=1;i<=period;i++){const ch=candles[i].close-candles[i-1].close;if(ch>0)avgGain+=ch;else avgLoss-=ch;}
    avgGain/=period;avgLoss/=period;
    result.push(100-100/(1+avgGain/(avgLoss||1e-10)));
    for(let i=period+1;i<n;i++){const ch=candles[i].close-candles[i-1].close;avgGain=(avgGain*(period-1)+Math.max(ch,0))/period;avgLoss=(avgLoss*(period-1)+Math.max(-ch,0))/period;result.push(100-100/(1+avgGain/(avgLoss||1e-10)));}
    return new Float64Array(result);
  }
  function _sma(arr,period,startIdx){let s=0;for(let i=startIdx;i<startIdx+period;i++)s+=arr[i];return s/period;}

  function computeStochRSI(candles) {
    if(!CFG.SRSI_ENABLED) return null;
    const need=CFG.SRSI_PERIOD+CFG.SRSI_K+CFG.SRSI_D+2; if(candles.length<need) return null;
    const rsiSeries=computeRSISeries(candles,CFG.SRSI_PERIOD);
    if(!rsiSeries||rsiSeries.length<CFG.SRSI_PERIOD+CFG.SRSI_K+CFG.SRSI_D) return null;
    const stochLen=rsiSeries.length-CFG.SRSI_PERIOD+1; if(stochLen<CFG.SRSI_K+CFG.SRSI_D) return null;
    const rawK=new Float64Array(stochLen);
    for(let i=0;i<stochLen;i++){const window=rsiSeries.slice(i,i+CFG.SRSI_PERIOD);const hi=Math.max(...window),lo=Math.min(...window);rawK[i]=hi===lo?50:((rsiSeries[i+CFG.SRSI_PERIOD-1]-lo)/(hi-lo))*100;}
    const kLen=stochLen-CFG.SRSI_K+1; if(kLen<CFG.SRSI_D) return null;
    const kLine=new Float64Array(kLen); for(let i=0;i<kLen;i++) kLine[i]=_sma(rawK,CFG.SRSI_K,i);
    const dLen=kLen-CFG.SRSI_D+1; if(dLen<2) return null;
    const dLine=new Float64Array(dLen); for(let i=0;i<dLen;i++) dLine[i]=_sma(kLine,CFG.SRSI_D,i);
    const k=kLine[kLine.length-1],d=dLine[dLine.length-1],prevK=kLine[kLine.length-2],prevD=dLine[dLine.length-2];
    let signal=null;
    if(k<CFG.SRSI_OVERSOLD) signal='BUY';
    if(k>CFG.SRSI_OVERBOUGHT) signal='SELL';
    if(prevK<prevD&&k>d) signal='BUY';
    if(prevK>prevD&&k<d) signal='SELL';
    return {k,d,signal};
  }

  function detectDivergence(candles) {
    if(!CFG.DIV_ENABLED||candles.length<CFG.DIV_LOOKBACK+CFG.RSI_PERIOD+2) return null;
    const slice=candles.slice(-CFG.DIV_LOOKBACK);
    const rsiSlice=computeRSISeries(candles,CFG.RSI_PERIOD);
    if(!rsiSlice||rsiSlice.length<CFG.DIV_LOOKBACK) return null;
    const rsiWin=Array.from(rsiSlice.slice(-CFG.DIV_LOOKBACK));
    const prices=slice.map(c=>c.close);
    const n=slice.length;
    const lows=[],highs=[];
    for(let i=1;i<n-1;i++){
      if(prices[i]<prices[i-1]&&prices[i]<prices[i+1]) lows.push({idx:i,price:prices[i],rsi:rsiWin[i]});
      if(prices[i]>prices[i-1]&&prices[i]>prices[i+1]) highs.push({idx:i,price:prices[i],rsi:rsiWin[i]});
    }
    if(lows.length>=2){const l1=lows[lows.length-2],l2=lows[lows.length-1];if(l2.idx>l1.idx&&l2.price<l1.price&&l2.rsi>l1.rsi)return{type:'bullish',strength:1.5};}
    if(highs.length>=2){const h1=highs[highs.length-2],h2=highs[highs.length-1];if(h2.idx>h1.idx&&h2.price>h1.price&&h2.rsi<h1.rsi)return{type:'bearish',strength:1.5};}
    return null;
  }

  const FIB_LEVELS=[0,0.236,0.382,0.5,0.618,0.786,1.0];
  function computeFibLevels(candles){
    if(!CFG.FIB_ENABLED||candles.length<CFG.FIB_LOOKBACK) return null;
    const slice=candles.slice(-CFG.FIB_LOOKBACK);
    const swingHigh=Math.max(...slice.map(c=>c.high)),swingLow=Math.min(...slice.map(c=>c.low));
    const range=swingHigh-swingLow; if(range<1e-10) return null;
    return FIB_LEVELS.map(lvl=>swingLow+lvl*range);
  }
  function getFibSignal(candles){
    if(!CFG.FIB_ENABLED) return null;
    const levels=computeFibLevels(candles); if(!levels) return null;
    const lc=candles[candles.length-1].close,tol=lc*CFG.FIB_TOLERANCE;
    const trendInfo=analyzeTrend(candles);
    const fibSupportLevels=[levels[2],levels[3],levels[4]];
    for(const level of fibSupportLevels){
      if(Math.abs(lc-level)<=tol){
        if(trendInfo.trend==='UP'||trendInfo.trend==='UP_WEAK') return {signal:'BUY',bonus:0.5};
        if(trendInfo.trend==='DOWN'||trendInfo.trend==='DN_WEAK') return {signal:'SELL',bonus:0.5};
      }
    }
    return null;
  }

  function getHigherTFTrend(candles){
    if(!CFG.MTF_ENABLED||candles.length<CFG.MTF_MULTIPLIER*3) return null;
    const grouped=[]; const step=CFG.MTF_MULTIPLIER;
    for(let i=0;i+step<=candles.length;i+=step){
      const group=candles.slice(i,i+step);
      const o=group[0].open,c=group[group.length-1].close;
      const h=Math.max(...group.map(g=>g.high)),l=Math.min(...group.map(g=>g.low));
      grouped.push({open:o,close:c,high:h,low:l,isBullish:c>=o});
    }
    if(grouped.length<3) return null;
    return analyzeTrend(grouped);
  }
  function getMTFScore(signalDir,candles){
    const htf=getHigherTFTrend(candles); if(!htf) return 0;
    const agrees=(signalDir==='BUY'&&(htf.trend==='UP'||htf.trend==='UP_WEAK'))||(signalDir==='SELL'&&(htf.trend==='DOWN'||htf.trend==='DN_WEAK'));
    const conflicts=(signalDir==='BUY'&&htf.trend==='DOWN')||(signalDir==='SELL'&&htf.trend==='UP');
    if(agrees) return 0.5; if(conflicts) return -1.0; return 0;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // §10  CANDLE ENGINE
  // ══════════════════════════════════════════════════════════════════════════════
  function buildCandle(prices, startTime) {
    if(!prices||prices.length<2) return null;
    const open=prices[0],close=prices[prices.length-1];
    const high=Math.max(...prices),low=Math.min(...prices);
    const totalRange=high-low,isBullish=close>=open,bodySize=Math.abs(close-open);
    const upperWick=isBullish?(high-close):(high-open);
    const lowerWick=isBullish?(open-low):(close-low);
    const isDoji=totalRange>0&&(bodySize/totalRange)<CFG.DOJI_MAX_BODY_RATIO;
    return {
      open,high,low,close,upperWick,lowerWick,bodySize,totalRange,isBullish,startTime,tickCount:prices.length,
      isHammer:isBullish&&bodySize>0&&lowerWick>=CFG.HAMMER_WICK_RATIO*bodySize&&upperWick<=bodySize*0.5,
      isInvertedHammer:isBullish&&bodySize>0&&upperWick>=CFG.HAMMER_WICK_RATIO*bodySize&&lowerWick<=bodySize*0.5,
      isHangingMan:!isBullish&&bodySize>0&&lowerWick>=CFG.HAMMER_WICK_RATIO*bodySize&&upperWick<=bodySize*0.5,
      isShootingStar:!isBullish&&bodySize>0&&upperWick>=CFG.HAMMER_WICK_RATIO*bodySize&&lowerWick<=bodySize*0.5,
      isBullishMarubozu:isBullish&&totalRange>0&&(upperWick/totalRange)<CFG.MARUBOZU_MAX_WICK&&(lowerWick/totalRange)<CFG.MARUBOZU_MAX_WICK,
      isBearishMarubozu:!isBullish&&totalRange>0&&(upperWick/totalRange)<CFG.MARUBOZU_MAX_WICK&&(lowerWick/totalRange)<CFG.MARUBOZU_MAX_WICK,
      isDoji,
      isGravestoneDoji:isDoji&&totalRange>0&&(upperWick/totalRange)>=CFG.GRAVE_UPPER_MIN&&(lowerWick/totalRange)<=0.05,
      isDragonflyDoji:isDoji&&totalRange>0&&(lowerWick/totalRange)>=CFG.DRAGON_LOWER_MIN&&(upperWick/totalRange)<=0.05,
    };
  }

  function analyzeTrend(candles){
    const n=Math.min(candles.length,CFG.TREND_CANDLES); if(n<3) return {trend:'NEUTRAL',strength:0,label:'➡ محايد'};
    const recent=candles.slice(-n);
    const bulls=recent.filter(c=>c.isBullish).length,ratio=bulls/n;
    let isAsc=true,isDes=true;
    for(let i=1;i<recent.length;i++){if(recent[i].close<=recent[i-1].close)isAsc=false;if(recent[i].close>=recent[i-1].close)isDes=false;}
    if(ratio>=CFG.TREND_STRONG_RATIO||isAsc) return {trend:'UP',strength:Math.round(ratio*100),label:'↗ صاعد'};
    if(ratio<=(1-CFG.TREND_STRONG_RATIO)||isDes) return {trend:'DOWN',strength:Math.round((1-ratio)*100),label:'↘ هابط'};
    if(ratio>0.55) return {trend:'UP_WEAK',strength:Math.round(ratio*100),label:'↗ صاعد ضعيف'};
    if(ratio<0.45) return {trend:'DN_WEAK',strength:Math.round((1-ratio)*100),label:'↘ هابط ضعيف'};
    return {trend:'NEUTRAL',strength:50,label:'➡ محايد'};
  }

  function computeBodySMA(candles,period){const slice=candles.slice(-period);if(slice.length<Math.min(period,5))return null;return slice.reduce((s,c)=>s+c.bodySize,0)/slice.length;}
  function computeATR(candles,period){
    if(!candles||candles.length<period+1) return null;
    const trs=[];
    for(let i=1;i<candles.length;i++){const c=candles[i],p=candles[i-1];trs.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));}
    const seed=trs.slice(0,period).reduce((s,v)=>s+v,0)/period; let atr=seed;
    for(let i=period;i<trs.length;i++) atr=(atr*(period-1)+trs[i])/period;
    return atr;
  }

  function classifyVolatility(asset){
    const candles=candleBuffers[asset];
    if(!candles||candles.length<CFG.ATR_PERIOD+5) return 'NORMAL';
    const atr=computeATR(candles,CFG.ATR_PERIOD); if(!atr||atr<=0) return 'NORMAL';
    _atrHistory.push(atr); if(_atrHistory.length>CFG.VOLATILITY_ATR_WINDOW) _atrHistory.shift();
    if(_atrHistory.length<5) return 'NORMAL';
    const avgATR=_atrHistory.reduce((s,v)=>s+v,0)/_atrHistory.length,ratio=atr/avgATR;
    let bbWidth=null;
    if(candles.length>=CFG.BB_PERIOD&&CFG.BB_ENABLED){const bb=computeBB(candles);if(bb&&bb.middle>0)bbWidth=(bb.upper-bb.lower)/bb.middle;}
    if(ratio<CFG.VOLATILITY_SQUEEZE_MULT||(bbWidth!==null&&bbWidth<CFG.VOLATILITY_BB_SQUEEZE)) return 'SQUEEZE';
    if(ratio>CFG.VOLATILITY_EXPLOSIVE_MULT) return 'EXPLOSIVE';
    return 'NORMAL';
  }

  function updateTickSize(asset,newPrice){
    const buf=tickBuffers[asset]; if(!buf||buf.length<2) return;
    const diff=Math.abs(newPrice-buf[buf.length-2]);
    if(diff>0) _STATE.tickSize=_STATE.tickSize===null?diff:_STATE.tickSize*0.9+diff*0.1;
  }

  function normalizeAsset(str){return String(str).replace(/^#/,'').replace(/[/\\\-\s]/g,'').replace(/_?otc$/i,'_otc');}


  // ══════════════════════════════════════════════════════════════════════════════
  // §11  ORDER BOOK IMBALANCE ENGINE (OBI)
  // Detects buy/sell pressure from tick direction sequences.
  // Builds a normalized imbalance score [-1, +1] that feeds into confluence.
  // ══════════════════════════════════════════════════════════════════════════════
  const OBI = {
    _buyPressure  : 0,
    _sellPressure : 0,
    _totalVol     : 0,
    _tickDir      : new Int8Array(CFG.OBI_WINDOW),  // +1 up, -1 down, 0 flat
    _tickDirN     : 0,
    _imbalanceEma : 0,
    _lastPrice    : null,
    _consecutiveBuy : 0,
    _consecutiveSell: 0,
    _streakScore  : 0,

    update(price) {
      if (!CFG.OBI_ENABLED) return;
      const prev = this._lastPrice;
      this._lastPrice = price;
      if (prev === null) return;

      const dir = price > prev ? 1 : price < prev ? -1 : 0;
      const magnitude = Math.abs(price - prev);

      // Sliding window of tick directions
      if (this._tickDirN < CFG.OBI_WINDOW) {
        this._tickDir[this._tickDirN++] = dir;
      } else {
        this._tickDir.copyWithin(0, 1);
        this._tickDir[CFG.OBI_WINDOW - 1] = dir;
      }

      // Weighted buy/sell pressure: recent ticks get more weight
      const n = Math.min(this._tickDirN, CFG.OBI_WINDOW);
      let buyW = 0, sellW = 0;
      for (let i = 0; i < n; i++) {
        const w = (i + 1) / n;  // linearly increasing weight
        if (this._tickDir[i] > 0) buyW += w;
        else if (this._tickDir[i] < 0) sellW += w;
      }
      const total = buyW + sellW;
      const rawImbalance = total > 0 ? (buyW - sellW) / total : 0;

      // EMA smooth the imbalance
      this._imbalanceEma = this._imbalanceEma * CFG.OBI_DECAY_ALPHA + rawImbalance * (1 - CFG.OBI_DECAY_ALPHA);

      // Consecutive streak tracking
      if (dir > 0)  { this._consecutiveBuy++;  this._consecutiveSell = 0; }
      else if (dir < 0) { this._consecutiveSell++; this._consecutiveBuy = 0; }
      else { this._consecutiveBuy = 0; this._consecutiveSell = 0; }

      // Streak score: +1 for 4+ consecutive buys, -1 for 4+ sells
      if (this._consecutiveBuy >= 4) this._streakScore = Math.min(1, this._consecutiveBuy / 6);
      else if (this._consecutiveSell >= 4) this._streakScore = -Math.min(1, this._consecutiveSell / 6);
      else this._streakScore = 0;
    },

    // Returns normalized imbalance: positive = buy pressure, negative = sell pressure
    getImbalance() {
      if (!CFG.OBI_ENABLED) return 0;
      return this._imbalanceEma * 0.7 + this._streakScore * 0.3;
    },

    // Returns confluence score contribution for a given signal direction
    getScore(signalDir) {
      if (!CFG.OBI_ENABLED) return 0;
      const imb = this.getImbalance();
      if (signalDir === 'BUY'  && imb >  CFG.OBI_STRONG_THRESHOLD) return  CFG.OBI_WEIGHT;
      if (signalDir === 'SELL' && imb < -CFG.OBI_STRONG_THRESHOLD) return  CFG.OBI_WEIGHT;
      if (signalDir === 'BUY'  && imb < -CFG.OBI_STRONG_THRESHOLD) return -CFG.OBI_WEIGHT * 0.5;
      if (signalDir === 'SELL' && imb >  CFG.OBI_STRONG_THRESHOLD) return -CFG.OBI_WEIGHT * 0.5;
      // Partial agreement
      if (signalDir === 'BUY'  && imb > 0.2) return  CFG.OBI_WEIGHT * 0.4;
      if (signalDir === 'SELL' && imb < -0.2) return  CFG.OBI_WEIGHT * 0.4;
      return 0;
    },

    getBuyPct()  { const imb = this.getImbalance(); return Math.round(50 + imb * 50); },
    getSellPct() { return 100 - this.getBuyPct(); },

    reset() {
      this._buyPressure = 0; this._sellPressure = 0; this._totalVol = 0;
      this._tickDirN = 0; this._imbalanceEma = 0; this._lastPrice = null;
      this._consecutiveBuy = 0; this._consecutiveSell = 0; this._streakScore = 0;
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // §12  LATENCY ARBITRAGE DETECTOR (LAD)
  // Tracks multiple tick stream timestamps and detects asynchronous
  // price desynchronization between frame sources.
  // When desync > threshold, creates a predictive entry opportunity.
  // ══════════════════════════════════════════════════════════════════════════════
  const LAD = {
    _streams       : new Map(),   // streamId → { lastPrice, lastTs, timestamps[] }
    _desyncs       : [],          // rolling desync events
    _activeOpportunity: null,     // { direction, confidence, expiresAt }
    _reconcileTs   : 0,

    recordTick(streamId, price, serverTs) {
      if (!CFG.LAD_ENABLED) return;
      const now = Date.now();
      if (!this._streams.has(streamId)) {
        this._streams.set(streamId, { lastPrice: price, lastTs: now, serverTs, priceHistory: [], tsHistory: [] });
        return;
      }
      const s = this._streams.get(streamId);
      s.priceHistory.push({ price, localTs: now, serverTs });
      if (s.priceHistory.length > CFG.LAD_HISTORY_SIZE) s.priceHistory.shift();
      const prevPrice = s.lastPrice;
      s.lastPrice = price;
      s.lastTs = now;
      s.serverTs = serverTs;

      // Reconcile timestamps across streams every 200ms
      if (now - this._reconcileTs > 200) {
        this._reconcileTs = now;
        this._reconcile(now);
      }
    },

    _reconcile(now) {
      if (this._streams.size < 1) return;
      // Compare prices across streams at the same server-time window
      const streams = Array.from(this._streams.values());
      if (streams.length < 2) {
        // Single stream: detect internal desync (server timestamp vs local clock)
        const s = streams[0];
        if (!s.serverTs || !s.lastTs) return;
        const drift = Math.abs(now - s.lastTs);
        if (drift > CFG.LAD_DESYNC_THRESHOLD_MS * 2) {
          this._registerDesync('clock-drift', drift, s.lastPrice, null);
        }
        return;
      }

      // Multi-stream: compare last prices
      let maxDesyncMs = 0, priceDelta = 0;
      for (let i = 0; i < streams.length - 1; i++) {
        for (let j = i + 1; j < streams.length; j++) {
          const si = streams[i], sj = streams[j];
          const tsDesync = Math.abs(si.lastTs - sj.lastTs);
          const pDelta   = Math.abs(si.lastPrice - sj.lastPrice);
          if (tsDesync > maxDesyncMs) maxDesyncMs = tsDesync;
          if (pDelta > priceDelta) priceDelta = pDelta;
        }
      }

      if (maxDesyncMs > CFG.LAD_DESYNC_THRESHOLD_MS) {
        // Determine direction from the leading stream (freshest tick)
        const sorted = streams.sort((a, b) => b.lastTs - a.lastTs);
        const leading  = sorted[0];
        const lagging  = sorted[sorted.length - 1];
        const direction = leading.lastPrice > lagging.lastPrice ? 'BUY' : 'SELL';
        this._registerDesync('stream-lag', maxDesyncMs, leading.lastPrice, direction);
      }
    },

    _registerDesync(type, lagMs, price, direction) {
      const now = Date.now();
      const event = { ts: now, type, lagMs, price, direction };
      this._desyncs.push(event);
      if (this._desyncs.length > CFG.LAD_HISTORY_SIZE) this._desyncs.shift();

      if (direction && lagMs > CFG.LAD_DESYNC_THRESHOLD_MS) {
        const confidence = Math.min(1.0, lagMs / (CFG.LAD_DESYNC_THRESHOLD_MS * 2));
        this._activeOpportunity = {
          direction,
          confidence: confidence * CFG.LAD_BOOST_WEIGHT,
          lagMs,
          expiresAt: now + Math.min(lagMs * 2, 800),
        };
        addLog('[LAD] ⚡ desync=' + lagMs.toFixed(0) + 'ms dir=' + direction + ' conf=' + (confidence*100).toFixed(0) + '%', 'info');
        EventBus.emit('lad:opportunity', this._activeOpportunity);
      }
    },

    getOpportunity() {
      if (!CFG.LAD_ENABLED || !this._activeOpportunity) return null;
      if (Date.now() > this._activeOpportunity.expiresAt) { this._activeOpportunity = null; return null; }
      return this._activeOpportunity;
    },

    getScore(signalDir) {
      if (!CFG.LAD_ENABLED) return 0;
      const opp = this.getOpportunity();
      if (!opp) return 0;
      if (opp.direction === signalDir) return opp.confidence;
      if (opp.direction !== signalDir) return -opp.confidence * 0.5;
      return 0;
    },

    reset() {
      this._streams.clear();
      this._desyncs.length = 0;
      this._activeOpportunity = null;
      this._reconcileTs = 0;
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // §13  TICK VELOCITY ENGINE (TVE)
  // ══════════════════════════════════════════════════════════════════════════════
  const TickVelocityEngine = {
    buf: [], velHistory: [], lastSigKey: '', _dirBias: null,

    push(price, ts) {
      if (!CFG.TVE_ENABLED) return null;
      const now = ts || performance.now() + performance.timeOrigin;
      this.buf.push({ ts: now, price });
      if (this.buf.length > CFG.TVE_BUF_SIZE) this.buf.shift();
      return this._analyze(now);
    },

    getDirectionBias() { return this._dirBias; },

    _analyze(now) {
      const n = this.buf.length; if (n < 3) return null;
      const vels = [];
      for (let i = 1; i < n; i++) {
        const dt = this.buf[i].ts - this.buf[i-1].ts;
        if (dt < CFG.TVE_MIN_DT_MS) continue;
        vels.push((this.buf[i].price - this.buf[i-1].price) / dt);
      }
      if (vels.length < 2) return null;

      if (CFG.TVE_STREAK_ENABLED && vels.length >= CFG.TVE_STREAK_MIN) {
        const tail = vels.slice(-CFG.TVE_STREAK_MIN);
        const allUp = tail.every(v => v > 0), allDown = tail.every(v => v < 0);
        if (allUp || allDown) {
          const dir = allUp ? 'BUY' : 'SELL';
          this._dirBias = dir;
          const sigKey = 'STREAK:' + dir + ':' + Math.round(now / 3000);
          if (sigKey !== this.lastSigKey) {
            this.lastSigKey = sigKey;
            return { signal: dir, case: 'TVE-Streak', reason: (allUp ? '⚡ تيارات صاعدة ×' : '⚡ تيارات هابطة ×') + CFG.TVE_STREAK_MIN, confidence: 4, sigma: 0, velocity: vels[vels.length-1], acceleration: 0, isTVE: true };
          }
        }
      }

      const latestVel   = vels[vels.length-1];
      const latestAccel = vels[vels.length-1] - vels[vels.length-2];
      this.velHistory.push({ ts: now, accel: latestAccel });
      if (this.velHistory.length > CFG.TVE_VEL_HISTORY) this.velHistory.shift();

      const cutoff = now - CFG.TVE_STD_WINDOW_MS;
      const recent = this.velHistory.filter(v => v.ts >= cutoff);
      if (recent.length < 5) return null;

      const vals = recent.map(v => v.accel);
      const mean = vals.reduce((s,v) => s+v, 0) / vals.length;
      const vari = vals.reduce((s,v) => s+(v-mean)**2, 0) / vals.length;
      const std  = Math.sqrt(vari);
      if (std < 1e-15) return null;

      const sigma = (latestAccel - mean) / std;
      const isShortSigma = (_STATE.candlePeriod > 0 && _STATE.candlePeriod <= 15) ||
                           (_STATE.candlePeriod === 0 && CFG.SHORT_MODE_ASSUME);
      const activeSigma = isShortSigma ? Math.min(_STATE.currentSigma, CFG.SHORT_MODE_SIGMA) : _STATE.currentSigma;
      if (Math.abs(sigma) < activeSigma) return null;

      const direction = sigma > 0 ? 'BUY' : 'SELL';
      this._dirBias = direction;
      const sigKey = direction + ':' + Math.round(now / 500);
      if (sigKey === this.lastSigKey) return null;
      this.lastSigKey = sigKey;
      const confidence = Math.min(5, Math.max(1, Math.floor(Math.abs(sigma) / CFG.TVE_SIGMA_THRESHOLD * 2)));
      return { signal: direction, case: 'TVE-Accel', reason: (direction==='BUY'?'⚡ تسارع صاعد':'⚡ تسارع هابط') + ' σ='+Math.abs(sigma).toFixed(2), confidence, sigma, velocity: latestVel, acceleration: latestAccel, isTVE: true };
    },

    reset() { this.buf=[]; this.velHistory=[]; this.lastSigKey=''; this._dirBias=null; },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // §14  QUANTUM PHANTOM PREDICTOR (QPP) — 4-model ensemble close prediction
  // ══════════════════════════════════════════════════════════════════════════════
  const _qppErr  = { wlr: 0.01, ema3: 0.01, holt: 0.01, mom: 0.01 };
  const _qppK    = 0.25;
  const _phantom = {
    processed    : new Set(),
    skipUntil    : 0,
    weight       : 1.0,
    pendingKey   : null,
    predicted    : null,
    triggerTs    : 0,
    tradeFlag    : false,
    lastWasPhantom: false,
    glowTimer    : null,
  };

  function _qppWLR(sl) {
    const m=sl.length; let sw=0,swx=0,swy=0,swx2=0,swxy=0;
    for(let i=0;i<m;i++){const w=i+1;sw+=w;swx+=w*i;swy+=w*sl[i];swx2+=w*i*i;swxy+=w*i*sl[i];}
    const det=sw*swx2-swx*swx; if(Math.abs(det)<1e-14) return sl[m-1];
    const slope=(sw*swxy-swx*swy)/det, intercept=(swy-slope*swx)/sw;
    return intercept+slope*m;
  }
  function _qppTEMA(sl) {
    const k=2/(sl.length+1); let e1=sl[0],e2=sl[0],e3=sl[0];
    for(let i=1;i<sl.length;i++){e1=sl[i]*k+e1*(1-k);e2=e1*k+e2*(1-k);e3=e2*k+e3*(1-k);}
    const tema=3*e1-3*e2+e3; const prevE1=(sl[sl.length-1]-e1)/k+e1;
    return tema+(tema-prevE1);
  }
  function _qppHolt(sl) {
    const alpha=0.5,beta=0.3; let s=sl[0],b=sl[1]-sl[0];
    for(let i=1;i<sl.length;i++){const ps=s;s=alpha*sl[i]+(1-alpha)*(s+b);b=beta*(s-ps)+(1-beta)*b;}
    return s+b;
  }
  function _qppMom(sl) {
    const n=sl.length; if(n<3) return sl[n-1];
    const x0=n-3,x1=n-2,x2=n-1,y0=sl[n-3],y1=sl[n-2],y2=sl[n-1];
    const a=((y2-y0)/(x2-x0)-(y1-y0)/(x1-x0))/(x2-x1);
    const b=(y1-y0)/(x1-x0)-a*(x0+x1),c=y0-a*x0*x0-b*x0;
    return a*n*n+b*n+c;
  }
  function predictClosePrice(prices, n) {
    n=n||8; const len=prices.length; if(len<2) return prices[len-1]||0;
    const sl=prices.slice(-Math.min(n,len)); if(sl.length<2) return sl[sl.length-1];
    const p_wlr=_qppWLR(sl),p_tema=_qppTEMA(sl),p_holt=_qppHolt(sl),p_mom=_qppMom(sl);
    const w_wlr=1/(_qppErr.wlr+1e-9),w_tema=1/(_qppErr.ema3+1e-9),w_holt=1/(_qppErr.holt+1e-9),w_mom=1/(_qppErr.mom+1e-9);
    const wSum=w_wlr+w_tema+w_holt+w_mom;
    const pred=(p_wlr*w_wlr+p_tema*w_tema+p_holt*w_holt+p_mom*w_mom)/wSum;
    const cur=prices[len-1],limit=cur*0.005;
    return Math.max(cur-limit,Math.min(cur+limit,pred));
  }
  function _qppUpdateErrors(prices,realClose){
    if(!prices||prices.length<2) return;
    const sl=prices.slice(-8);
    const e=(m)=>Math.abs(m-realClose)/(Math.abs(realClose)||1);
    _qppErr.wlr =_qppK*e(_qppWLR(sl)) +(1-_qppK)*_qppErr.wlr;
    _qppErr.ema3=_qppK*e(_qppTEMA(sl))+(1-_qppK)*_qppErr.ema3;
    _qppErr.holt=_qppK*e(_qppHolt(sl))+(1-_qppK)*_qppErr.holt;
    _qppErr.mom =_qppK*e(_qppMom(sl)) +(1-_qppK)*_qppErr.mom;
  }

  function injectPhantomCandle(asset, predictedClose, now) {
    if (now < _phantom.skipUntil) return;
    const cc = currentCandles[asset];
    if (!cc || cc.prices.length < CFG.MIN_TICKS_PER_CANDLE) return;
    const key = asset + ':' + cc.startTime;
    if (_phantom.processed.has(key)) return;
    const phantomPrices = cc.prices.concat(predictedClose);
    const phantom = buildCandle(phantomPrices, cc.startTime);
    if (!phantom) return;
    phantom.isPhantom = true;
    phantom.phantomConf = _phantom.weight;
    _phantom.processed.add(key);
    _phantom.pendingKey = key;
    _phantom.predicted  = predictedClose;
    _phantom.triggerTs  = now;
    addLog('👻 phantom ' + (phantom.isBullish?'↑':'↓') + ' → ' + predictedClose.toFixed(5) + ' | w=' + _phantom.weight.toFixed(2), 'phantom');
    _flashPhantomUI(phantom.isBullish, predictedClose);
    _phantom.tradeFlag = true;
    try { _predBarTick(asset, predictedClose, now); } catch(_) {}
    _phantom.tradeFlag = false;
  }

  function _flashPhantomUI(isBullish, price) {
    try {
      const el = W.document.getElementById('pb-phantom-flash');
      if (!el) return;
      if (_phantom.glowTimer) { clearTimeout(_phantom.glowTimer); _phantom.glowTimer = null; }
      const overdrive = _phantom.weight >= 1.3;
      const dir = isBullish ? 'bull' : 'bear';
      el.textContent = (isBullish ? '▲' : '▼') + ' ' + price.toFixed(5);
      el.className = 'pb-ph-' + dir + (overdrive ? ' pb-ph-od' : '');
      _phantom.glowTimer = setTimeout(() => { if(el) el.className=''; _phantom.glowTimer=null; }, 3000);
    } catch(_) {}
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // §15  LSTM PROXY ENGINE — lightweight sequential prediction
  // A minimal 1-layer LSTM-like network (GRU approximation) with sigmoid gates.
  // Trained online using a lightweight SGD update after each candle close.
  // ══════════════════════════════════════════════════════════════════════════════
  const LSTMProxy = (() => {
    const SEQ = CFG.LSTM_SEQ_LEN;
    const H   = CFG.LSTM_HIDDEN;
    const LR  = CFG.LSTM_LEARN_RATE;

    // Xavier initialization
    function _xavier(rows, cols) {
      const scale = Math.sqrt(2.0 / (rows + cols));
      const arr = new Float64Array(rows * cols);
      for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 2 - 1) * scale;
      return arr;
    }
    function _zeros(n) { return new Float64Array(n); }
    function _sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x)))); }
    function _tanh(x) { return Math.tanh(Math.max(-20, Math.min(20, x))); }

    // Weights: Input gate (i), Forget gate (f), Output gate (o), Cell gate (g)
    const Wxi = _xavier(H, SEQ), Whi = _xavier(H, H), bi = _zeros(H);
    const Wxf = _xavier(H, SEQ), Whf = _xavier(H, H), bf = _zeros(H);
    const Wxo = _xavier(H, SEQ), Who = _xavier(H, H), bo = _zeros(H);
    const Wxg = _xavier(H, SEQ), Whg = _xavier(H, H), bg = _zeros(H);
    const Wy  = _xavier(1, H),   by  = _zeros(1);

    // State
    const h = _zeros(H), c = _zeros(H);
    let _seqBuf = [];
    let _trained = false;
    let _normMean = 0, _normStd = 1;
    let _lastPred = null;
    let _predHistory = [];

    function _matVec(W, x, rows, cols) {
      const out = new Float64Array(rows);
      for (let i = 0; i < rows; i++) {
        let s = 0;
        for (let j = 0; j < cols; j++) s += W[i * cols + j] * x[j];
        out[i] = s;
      }
      return out;
    }

    function _forward(x) {
      // x: Float64Array[SEQ], h_prev: Float64Array[H]
      const xi = _matVec(Wxi, x, H, SEQ), hi2 = _matVec(Whi, h, H, H);
      const xf = _matVec(Wxf, x, H, SEQ), hf2 = _matVec(Whf, h, H, H);
      const xo = _matVec(Wxo, x, H, SEQ), ho2 = _matVec(Who, h, H, H);
      const xg = _matVec(Wxg, x, H, SEQ), hg2 = _matVec(Whg, h, H, H);
      for (let i = 0; i < H; i++) {
        const ig = _sigmoid(xi[i] + hi2[i] + bi[i]);
        const fg = _sigmoid(xf[i] + hf2[i] + bf[i]);
        const og = _sigmoid(xo[i] + ho2[i] + bo[i]);
        const gg = _tanh(xg[i] + hg2[i] + bg[i]);
        c[i] = fg * c[i] + ig * gg;
        h[i] = og * _tanh(c[i]);
      }
      let out = by[0];
      for (let i = 0; i < H; i++) out += Wy[i] * h[i];
      return _sigmoid(out);  // 0=sell, 1=buy
    }

    function _normalize(prices) {
      if (prices.length < 2) return new Float64Array(prices);
      const arr = new Float64Array(prices.length);
      _normMean = prices.reduce((s,v) => s+v, 0) / prices.length;
      const sq   = prices.reduce((s,v) => s+(v-_normMean)**2, 0) / prices.length;
      _normStd   = Math.sqrt(sq) || 1e-8;
      for (let i = 0; i < prices.length; i++) arr[i] = (prices[i] - _normMean) / _normStd;
      return arr;
    }

    // Online weight update: gradient descent on binary cross-entropy
    function _update(x, target) {
      const pred = _forward(x);
      const err  = pred - target;
      // Update output weights
      for (let i = 0; i < H; i++) {
        Wy[i] -= LR * err * h[i];
      }
      by[0] -= LR * err;
      // Simplified hidden-layer gradient (one-step backprop approximation)
      for (let i = 0; i < H; i++) {
        const dhErr = err * Wy[i] * (1 - h[i] * h[i]);
        bo[i] -= LR * dhErr;
        bg[i] -= LR * dhErr * 0.5;
        bi[i] -= LR * dhErr * 0.3;
        bf[i] -= LR * dhErr * 0.1;
      }
    }

    return {
      push(price) {
        if (!CFG.LSTM_ENABLED) return;
        _seqBuf.push(price);
        if (_seqBuf.length > SEQ * 2) _seqBuf.shift();
      },

      predict() {
        if (!CFG.LSTM_ENABLED || _seqBuf.length < SEQ) return null;
        const slice = _seqBuf.slice(-SEQ);
        const norm  = _normalize(slice);
        const pred  = _forward(norm);
        _lastPred = pred;
        // Convert 0..1 → direction signal with confidence
        const conf = Math.abs(pred - 0.5) * 2;  // 0=neutral, 1=max
        const dir  = pred > 0.5 ? 'BUY' : 'SELL';
        return { direction: dir, confidence: conf, raw: pred };
      },

      learn(actualBullish) {
        if (!CFG.LSTM_ENABLED || _seqBuf.length < SEQ) return;
        const slice = _seqBuf.slice(-SEQ);
        const norm  = _normalize(slice);
        _update(norm, actualBullish ? 1.0 : 0.0);
        _trained = true;
        // Track prediction quality
        if (_lastPred !== null) {
          const correct = (actualBullish && _lastPred > 0.5) || (!actualBullish && _lastPred <= 0.5);
          _predHistory.push(correct ? 1 : 0);
          if (_predHistory.length > 50) _predHistory.shift();
        }
      },

      getWinRate() {
        if (_predHistory.length < 10) return null;
        return _predHistory.reduce((s,v)=>s+v,0) / _predHistory.length;
      },

      getScore(signalDir) {
        if (!CFG.LSTM_ENABLED) return 0;
        const p = this.predict();
        if (!p || p.confidence < 0.2) return 0;
        const wr = this.getWinRate();
        const wrMult = wr !== null ? (wr > 0.55 ? 1.2 : wr < 0.45 ? 0.5 : 0.9) : 0.8;
        if (p.direction === signalDir) return CFG.LSTM_WEIGHT_IN_ENSEMBLE * p.confidence * wrMult;
        return -CFG.LSTM_WEIGHT_IN_ENSEMBLE * p.confidence * 0.4;
      },

      reset() { _seqBuf=[]; for(let i=0;i<H;i++){h[i]=0;c[i]=0;} _lastPred=null; },
    };
  })();

  // ══════════════════════════════════════════════════════════════════════════════
  // §16  RL WEIGHT ENGINE — Q-learning inspired adaptive algorithm weighting
  // State: [regime, recentWR, hurstBucket, volBucket]
  // Actions: increase/decrease/hold weight for each algo group
  // Reward: +1 on win, -1 on loss
  // ══════════════════════════════════════════════════════════════════════════════
  const RLEngine = (() => {
    const NUM_STATES  = CFG.RL_STATE_BUCKETS ** 4;  // 256 states
    const NUM_ACTIONS = 3;  // 0=decrease, 1=hold, 2=increase

    // Q-table: state × (algo_groups × actions)
    const NUM_ALGO_GROUPS = 4;  // A, B, C, D
    const Q = new Float64Array(NUM_STATES * NUM_ALGO_GROUPS * NUM_ACTIONS);
    let _lastState = 0, _lastActions = new Int8Array(NUM_ALGO_GROUPS);
    let _episodeCount = 0;

    function _stateIndex(regime, recentWR, hurst, vol) {
      // Discretize each dimension into CFG.RL_STATE_BUCKETS buckets
      const B = CFG.RL_STATE_BUCKETS;
      const r = regime === 'TREND' ? 0 : regime === 'VOLATILE' ? 2 : 1;
      const w = Math.min(B-1, Math.floor(recentWR * B));
      const h = Math.min(B-1, Math.floor(hurst * B));
      const v = vol === 'EXPLOSIVE' ? B-1 : vol === 'SQUEEZE' ? 0 : Math.floor(B/2);
      return Math.min(NUM_STATES - 1, r * B * B * B + w * B * B + h * B + v);
    }

    function _getQIdx(state, group, action) {
      return state * NUM_ALGO_GROUPS * NUM_ACTIONS + group * NUM_ACTIONS + action;
    }

    function _selectAction(state, group) {
      if (Math.random() < CFG.RL_EPSILON) return Math.floor(Math.random() * NUM_ACTIONS);
      let bestQ = -Infinity, bestA = 1;
      for (let a = 0; a < NUM_ACTIONS; a++) {
        const q = Q[_getQIdx(state, group, a)];
        if (q > bestQ) { bestQ = q; bestA = a; }
      }
      return bestA;
    }

    function _update(state, group, action, reward, nextState) {
      const idx = _getQIdx(state, group, action);
      let maxNextQ = -Infinity;
      for (let a = 0; a < NUM_ACTIONS; a++) {
        const q = Q[_getQIdx(nextState, group, a)];
        if (q > maxNextQ) maxNextQ = q;
      }
      Q[idx] += CFG.RL_ALPHA * (reward + CFG.RL_GAMMA * maxNextQ - Q[idx]);
    }

    return {
      selectWeightAdjustments(ps) {
        if (!CFG.RL_ENABLED) return [1, 1, 1, 1];
        const recentWR = _recentResults.length >= 5
          ? _recentResults.slice(-10).reduce((s,v)=>s+v,0) / Math.min(10, _recentResults.length)
          : 0.5;
        const state = _stateIndex(ps.regime || 'RANGE', recentWR, ps.hurst_h || 0.5, _STATE.volatilityState);
        _lastState = state;
        const adjustments = [1.0, 1.0, 1.0, 1.0];
        for (let g = 0; g < NUM_ALGO_GROUPS; g++) {
          const action = _selectAction(state, g);
          _lastActions[g] = action;
          adjustments[g] = action === 0 ? 0.85 : action === 2 ? 1.15 : 1.0;
        }
        return adjustments;
      },

      recordOutcome(won) {
        if (!CFG.RL_ENABLED) return;
        _episodeCount++;
        const reward = won ? 1.0 : -1.0;
        const recentWR = _recentResults.length >= 5
          ? _recentResults.slice(-10).reduce((s,v)=>s+v,0) / Math.min(10, _recentResults.length)
          : 0.5;
        const ps = _PS;
        const nextState = _stateIndex(ps.regime || 'RANGE', recentWR, ps.hurst_h || 0.5, _STATE.volatilityState);
        for (let g = 0; g < NUM_ALGO_GROUPS; g++) {
          _update(_lastState, g, _lastActions[g], reward, nextState);
        }
      },

      save() {
        try { W.localStorage.setItem('cb_v13_rl', JSON.stringify(Array.from(Q))); } catch(_) {}
      },
      load() {
        try {
          const raw = W.localStorage.getItem('cb_v13_rl');
          if (!raw) return;
          const arr = JSON.parse(raw);
          for (let i = 0; i < Math.min(arr.length, Q.length); i++) Q[i] = arr[i];
          addLog('[RL] ✅ Q-table restored (' + _episodeCount + ' episodes)', 'info');
        } catch(_) {}
      },
    };
  })();

  // ══════════════════════════════════════════════════════════════════════════════
  // §17  ADVANCED FRACTIONAL KELLY ENGINE
  // Dynamic regime-adjusted Kelly: f* = (W*R - L) / R * fraction
  // Adjusted by: regime multiplier, streak state, volatility, RL feedback
  // ══════════════════════════════════════════════════════════════════════════════
  function computeKellyAmount(balance) {
    if (!CFG.KELLY_ENABLED || !balance || balance <= 0) return CFG.DEFAULT_AMOUNT;
    const total = STATS.wins + STATS.losses;
    if (total < 10) return CFG.DEFAULT_AMOUNT;

    const wr = STATS.wins / total;
    const lr = STATS.losses / total;

    // Live payout: per-asset → dynamic → fallback
    const liveP = getActiveAssetPayout();
    const payout = (liveP !== null && liveP > 0.5 && liveP < 1.5) ? liveP : 0.85;

    // Raw Kelly fraction
    const kellyRaw = wr - (lr / payout);
    if (kellyRaw <= 0) return CFG.KELLY_MIN;

    // Base Kelly amount
    let fraction = CFG.KELLY_FRACTION;

    // Regime multiplier
    const regime = _PS.regime || 'RANGE';
    const regimeMult = regime === 'TREND' ? CFG.KELLY_REGIME_TREND
                     : regime === 'VOLATILE' ? CFG.KELLY_REGIME_VOLATILE
                     : CFG.KELLY_REGIME_RANGE;
    fraction *= regimeMult;

    // Streak adjustment
    if (STATS.lossStreak >= 2) {
      fraction *= CFG.KELLY_STREAK_LOSS_MULT * Math.max(0.3, 1 - STATS.lossStreak * 0.1);
    } else if (STATS.winStreak >= CFG.KELLY_STREAK_WIN_MIN) {
      fraction *= Math.min(1.4, CFG.KELLY_STREAK_WIN_MULT + (STATS.winStreak - CFG.KELLY_STREAK_WIN_MIN) * 0.03);
    }

    // Volatility adjustment
    const vol = _STATE.volatilityState;
    if (vol === 'EXPLOSIVE') fraction *= CFG.KELLY_VOL_EXPLOSIVE_MULT;
    else if (vol === 'SQUEEZE') fraction *= CFG.KELLY_VOL_HIGH_MULT;

    // Recent win rate adaptation
    if (_recentResults.length >= 10) {
      const recentWR = _recentResults.slice(-10).reduce((s,v)=>s+v,0) / Math.min(10, _recentResults.length);
      if (recentWR < 0.4) fraction *= 0.7;
      else if (recentWR > 0.65) fraction *= 1.1;
    }

    const kellyAmount  = balance * kellyRaw * fraction;
    const maxAmount    = balance * CFG.KELLY_MAX_PCT;
    const hardCap      = CFG.KELLY_MAX_USD > 0 ? CFG.KELLY_MAX_USD : 50;
    return Math.round(Math.max(CFG.KELLY_MIN, Math.min(maxAmount, kellyAmount, hardCap)) * 100) / 100;
  }

  function getActiveAssetPayout() {
    const a = _STATE.activeAsset;
    if (a && _assetPayouts.has(a)) { const p=_assetPayouts.get(a); if(p>0.5&&p<1.5) return p; }
    return _STATE.dynamicPayout;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // §18  ANTI-MARTINGALE PYRAMIDING
  // Increases exposure ONLY during statistically favorable winning streaks.
  // Reduces risk immediately on any loss.
  // ══════════════════════════════════════════════════════════════════════════════
  const Pyramid = {
    _tier: 1,
    _lastMs: 0,
    _lastWinStreak: 0,

    getCurrentTier() {
      if (!CFG.PYRAMID_ENABLED) return 1;
      const ws = STATS.winStreak || 0;
      if (ws < CFG.PYRAMID_MIN_STREAK) return 1;
      if (ws >= CFG.PYRAMID_MIN_STREAK + 4) return Math.min(3, CFG.PYRAMID_MAX_TIERS);
      if (ws >= CFG.PYRAMID_MIN_STREAK + 2) return Math.min(2, CFG.PYRAMID_MAX_TIERS);
      return Math.min(1, CFG.PYRAMID_MAX_TIERS);
    },

    getScaledAmount(baseAmount, spConf) {
      if (!CFG.PYRAMID_ENABLED) return baseAmount;
      if (spConf < CFG.PYRAMID_REQUIRE_CONF) return baseAmount;
      if ((Date.now() - this._lastMs) < CFG.PYRAMID_COOLDOWN_MS) return baseAmount;
      const tier = this.getCurrentTier();
      const scale = tier === 3 ? CFG.PYRAMID_SCALE_3 : tier === 2 ? CFG.PYRAMID_SCALE_2 : CFG.PYRAMID_SCALE_1;
      return Math.round(_safeAmount(baseAmount * scale) * 100) / 100;
    },

    onTrade() { this._lastMs = Date.now(); },

    onResult(won) {
      if (!won) { this._tier = 1; }
    },

    getInfo() {
      const tier = this.getCurrentTier();
      return { tier, scale: tier === 3 ? CFG.PYRAMID_SCALE_3 : tier === 2 ? CFG.PYRAMID_SCALE_2 : CFG.PYRAMID_SCALE_1 };
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // §19  ETC — Execution Timing Calibrator
  // ══════════════════════════════════════════════════════════════════════════════
  function _etcRecordSignal(direction, conf, price) {
    _STATE.etcPending = { signalTs: performance.now(), direction, conf, signalPrice: price ?? 0, clickTs: null, openPrice: null };
  }
  function _etcRecordClick() { if (_STATE.etcPending) _STATE.etcPending.clickTs = performance.now(); }
  function _etcStoreOpenPrice(price) { if (_STATE.etcPending) _STATE.etcPending.openPrice = price; }
  function _etcCalibrate(win) {
    if (!_STATE.etcPending) return;
    const rec = _STATE.etcPending; _STATE.etcPending = null;
    if (rec.clickTs === null) return;
    const delay    = rec.clickTs - rec.signalTs;
    const slippage = rec.openPrice && rec.signalPrice ? Math.abs(rec.openPrice - rec.signalPrice) * 1e5 : null;
    let adj = 0;
    if (!win && rec.conf >= CFG.ETC_CONF_MIN && delay > 5) {
      adj = Math.round(delay * CFG.ETC_STEP_RATE);
      _STATE.etcOffset = Math.min(_STATE.etcOffset + adj, CFG.ETC_MAX_OFFSET);
      addLog('⚡ [ETC] خسارة | تأخير=' + delay.toFixed(1) + 'ms' + (slippage !== null ? ' | انزلاق=' + slippage.toFixed(2) + 'pip' : '') + ' | +' + adj + 'ms → offset=' + _STATE.etcOffset.toFixed(0) + 'ms', 'info');
    } else if (win && rec.conf >= CFG.ETC_CONF_MIN && _STATE.etcOffset > 0) {
      adj = -CFG.ETC_DECAY_WIN;
      _STATE.etcOffset = Math.max(0, _STATE.etcOffset - CFG.ETC_DECAY_WIN);
    }
    _STATE.etcHistory.push({ delay: +delay.toFixed(1), slippage, win, conf: rec.conf, adj, ts: Date.now() });
    if (_STATE.etcHistory.length > CFG.ETC_MAX_HIST) _STATE.etcHistory.shift();
    try {
      const eOff = W.document.getElementById('cbEtcOffset');
      if (eOff) eOff.textContent = _STATE.etcOffset.toFixed(0) + 'ms';
    } catch(_) {}
  }
  function _etcEffectiveDelay(baseMs) { return Math.max(0, baseMs - _STATE.etcOffset); }


  // ══════════════════════════════════════════════════════════════════════════════
  // §20  SUPREME-PRED v3 STATE + ENGINE
  // 35+ algorithm ensemble with adaptive weights, regime detection, RL-guided adjustments
  // ══════════════════════════════════════════════════════════════════════════════
  const _PS = {
    tickCount:0, lastPrice:null, lastNow:0,
    buyPct:50, sellPct:50, direction:'NEUTRAL', confidence:0, spConf:0,
    tickTs:new Float64Array(10), tickTs_n:0, spikeActive:false, spikePenaltyUntil:0,
    W5:[], W10:[], W20:[], W40:[], W80:[],
    vels:[], accels:[],
    e2:null,e3:null,e5:null,e8:null,e13:null,e21:null,e34:null,e55:null,
    tRsi_ag:0,tRsi_al:0,tRsi_val:50,tRsi_n:0,tRsi_prev:[],
    ofi_streak:0,ofi_score:0,ofi_bid:0,ofi_ask:0,
    mom:0,momHL:5,
    vol_sq_sum:0,vol_sum:0,vol_n:0,vol:1e-9,
    vol_hist:new Float64Array(50),vol_hist_n:0,
    lr_xy:0,lr_x:0,lr_y:0,lr_x2:0,lr_n:0,lr_prices:[],lr_r2:0,
    ac_lags:[
      {prevVel:null,sxy:0,sx:0,sy:0,sx2:0,n:0},
      {prevVel:null,sxy:0,sx:0,sy:0,sx2:0,n:0},
      {prevVel:null,sxy:0,sx:0,sy:0,sx2:0,n:0},
      {prevVel:null,sxy:0,sx:0,sy:0,sx2:0,n:0},
      {prevVel:null,sxy:0,sx:0,sy:0,sx2:0,n:0},
    ],
    ac_velBuf:new Float64Array(50),ac_velBuf_n:0,
    ent_up:0,ent_dn:0,ent_n:0,
    hurst_h:0.5,
    kf_x:null,kf_p:1.0,kf_dir:0,
    pg_peak:null,pg_trough:null,pg_prev_peak:null,pg_prev_trough:null,
    sr_pivots:[],
    regime:'RANGE',atr_ma:1e-9,
    aw:{
      ofi:2.0,vel:2.5,accel:2.2,tRsi:1.8,mom:1.5,zScore:1.2,entropy:0.7,
      ac1:1.2,ac2:0.8,ac3:0.6,ac4:0.4,ac5:0.3,
      hurst:0.6,lr:1.8,kalman:2.0,roc:1.3,breakout:1.5,geo:1.0,
      regime_w:1.0,dynSR:0.8,emaStack:2.0,liqVac:1.2,
      candle:1.5,rsi:1.2,macd:0.9,bb:0.8,srsi:0.8,mtf:0.6,fib:0.5,
      tveAccel:2.5,tveBias:1.0,
      mer:1.8,ofiDelta:2.0,permEnt:0.9,vwapDev:1.4,
      kf2vel:2.3,dftCycle:1.1,obi:2.2,lad:1.8,lstm:1.4,
    },
    kf2:{x:null,v:0,P00:1.0,P01:0.0,P11:1.0},kf2_vScore:0,
    mer:0,
    vwap_psum:0,vwap_tsum:0,vwap:null,
    ofi_delta:0,ofi_dRaw:0,
    pe_score:0,dfa_h:0.5,dft_score:0,
    zs_sum:0,zs_sq:0,zs_n:0,
    roc3:0,roc8:0,roc15:0,roc25:0,
    smoothBuy:50,smoothSell:50,smoothK:0.18,
    bp_high:null,bp_low:null,bp_n:0,
    regimeStats:{TREND:{wins:0,total:0},RANGE:{wins:0,total:0},VOLATILE:{wins:0,total:0}},
    regimeBlocked:{TREND:false,RANGE:false,VOLATILE:false},
    algoScores:{},groupScores:{A:0,B:0,C:0,D:0},
    groupVotes:{A:{bull:0,bear:0,total:0},B:{bull:0,bear:0,total:0},C:{bull:0,bear:0,total:0},D:{bull:0,bear:0,total:0}},
    snap:{},kalmanPredDir:0,kalmanMagnitude:0,
    // Worker async results (cached from last completed worker call)
    _workerHurst:0.5,_workerDfaH:0.5,_workerPermEnt:0.5,_workerDftCycle:0,
    _workerStale:true,
  };

  const _EK={k2:2/3,k3:2/4,k5:2/6,k8:2/9,k13:2/14,k21:2/22,k34:2/35,k55:2/56};
  function _rp(arr,val,maxLen){arr.push(val);if(arr.length>maxLen)arr.shift();}
  function _rbPush(buf,nRef,val){const cap=buf.length;if(nRef[0]<cap){buf[nRef[0]++]=val;}else{buf.copyWithin(0,1);buf[cap-1]=val;}}
  function _mean(arr){if(!arr.length)return 0;return arr.reduce((a,v)=>a+v,0)/arr.length;}
  function _std(arr,mean){if(arr.length<2)return 1e-9;const m=mean!==undefined?mean:_mean(arr);return Math.sqrt(arr.reduce((a,v)=>a+(v-m)**2,0)/arr.length)||1e-9;}
  function _cls(val,scale){return Math.max(-1,Math.min(1,val*scale));}
  function _addBS(B_ref,S_ref,score,weight){if(score>0)B_ref.v+=weight*score;else S_ref.v+=weight*Math.abs(score);}

  // Dispatch heavy calcs to worker async (results land in _PS._worker*)
  let _workerDispatchTimer = null;
  function _dispatchToWorker(asset, price) {
    if (!_STATE.workerReady || _workerDispatchTimer) return;
    _workerDispatchTimer = setTimeout(() => {
      _workerDispatchTimer = null;
      const ps = _PS;
      const n  = Math.min(ps.vels.length, 50);
      if (n < 32) return;
      const velSlice   = ps.vels.slice(-n);
      const priceSlice = (tickBuffers[asset] || []).slice(-32);
      _workerPost('multiCalc', { vels: velSlice, prices: priceSlice, n }, (result, err) => {
        if (result) {
          ps._workerHurst   = result.hurst  ?? 0.5;
          ps._workerDfaH    = result.dfaH   ?? 0.5;
          ps._workerPermEnt = result.permEnt ?? 0.5;
          ps._workerDftCycle= result.dftCycle?? 0;
          ps._workerStale   = false;
        }
      }, 100);
    }, 16); // batch: wait one frame before dispatching
  }

  function _predBarTick(asset, price, now) {
    const ps = _PS;
    ps.tickCount++;
    const prev = ps.lastPrice;
    ps.lastPrice = price;
    ps.lastNow   = now;

    if (prev === null) return;
    const dt   = Math.max(1, now - ps.lastNow);
    const vel  = (price - prev);
    const priceMid = (price + prev) * 0.5;

    // Dispatch heavy calcs to worker every N ticks
    if (ps.tickCount % 5 === 0) _dispatchToWorker(asset, price);

    // Update OBI
    OBI.update(price);

    // Update LAD
    LAD.recordTick('main', price, now);

    // Update LSTM
    LSTMProxy.push(price);

    // ── Spike detection ──────────────────────────────────────────────────────
    {
      const tsb = ps.tickTs, cap = tsb.length;
      if (ps.tickTs_n < cap) { tsb[ps.tickTs_n++] = now; }
      else { tsb.copyWithin(0,1); tsb[cap-1]=now; }
      const n4 = Math.min(ps.tickTs_n, 4);
      const oldest4 = tsb[ps.tickTs_n >= 4 ? ps.tickTs_n-4 : 0];
      if (n4 >= 4 && (now - oldest4) < 100) {
        if (!ps.spikeActive) { ps.spikeActive=true; ps.spikePenaltyUntil=now+500; }
      }
      if (ps.spikeActive && now > ps.spikePenaltyUntil) ps.spikeActive = false;
    }

    // ── Rolling windows ───────────────────────────────────────────────────────
    _rp(ps.W5,  price, 5);  _rp(ps.W10, price, 10);
    _rp(ps.W20, price, 20); _rp(ps.W40, price, 40); _rp(ps.W80, price, 80);

    // ── Velocity & acceleration ───────────────────────────────────────────────
    _rp(ps.vels,  vel, 60);
    if (ps.vels.length >= 2) { const accel = ps.vels[ps.vels.length-1]-ps.vels[ps.vels.length-2]; _rp(ps.accels, accel, 60); }

    // ── EMA stack ────────────────────────────────────────────────────────────
    ps.e2  = ps.e2  === null ? price : price*_EK.k2 +ps.e2 *(1-_EK.k2);
    ps.e3  = ps.e3  === null ? price : price*_EK.k3 +ps.e3 *(1-_EK.k3);
    ps.e5  = ps.e5  === null ? price : price*_EK.k5 +ps.e5 *(1-_EK.k5);
    ps.e8  = ps.e8  === null ? price : price*_EK.k8 +ps.e8 *(1-_EK.k8);
    ps.e13 = ps.e13 === null ? price : price*_EK.k13+ps.e13*(1-_EK.k13);
    ps.e21 = ps.e21 === null ? price : price*_EK.k21+ps.e21*(1-_EK.k21);
    ps.e34 = ps.e34 === null ? price : price*_EK.k34+ps.e34*(1-_EK.k34);
    ps.e55 = ps.e55 === null ? price : price*_EK.k55+ps.e55*(1-_EK.k55);

    // ── Tick RSI (Wilder) ─────────────────────────────────────────────────────
    {
      const ch = vel;
      const gain = ch > 0 ? ch : 0, loss = ch < 0 ? -ch : 0;
      if (ps.tRsi_n < CFG.RSI_PERIOD) {
        ps.tRsi_ag += gain / CFG.RSI_PERIOD; ps.tRsi_al += loss / CFG.RSI_PERIOD; ps.tRsi_n++;
      } else {
        ps.tRsi_ag = _MATH.wilderStep(ps.tRsi_ag, gain, CFG.RSI_PERIOD);
        ps.tRsi_al = _MATH.wilderStep(ps.tRsi_al, loss, CFG.RSI_PERIOD);
      }
      ps.tRsi_val = ps.tRsi_ag + ps.tRsi_al > 0 ? 100 - 100 / (1 + ps.tRsi_ag / (ps.tRsi_al || 1e-10)) : 50;
    }

    // ── OFI ──────────────────────────────────────────────────────────────────
    {
      if (vel > 0)      { ps.ofi_streak = Math.min(ps.ofi_streak+1, 20); ps.ofi_bid++; }
      else if (vel < 0) { ps.ofi_streak = Math.max(ps.ofi_streak-1, -20); ps.ofi_ask++; }
      const ofiRaw = (ps.ofi_bid - ps.ofi_ask) / Math.max(ps.ofi_bid + ps.ofi_ask, 1);
      ps.ofi_score = ps.ofi_score * 0.95 + ofiRaw * 0.05;
      // OFI Delta (EMA of |vel| × sign)
      const signedMag = vel > 0 ? Math.abs(vel) : vel < 0 ? -Math.abs(vel) : 0;
      ps.ofi_dRaw = signedMag;
      ps.ofi_delta = ps.ofi_delta * 0.9 + signedMag * 0.1;
    }

    // ── Momentum ─────────────────────────────────────────────────────────────
    { const halfLife = Math.max(3, ps.momHL); const alpha = 1 - Math.pow(0.5, 1 / halfLife); ps.mom = ps.mom * (1 - alpha) + vel * alpha; }

    // ── Volatility ────────────────────────────────────────────────────────────
    {
      const n = ps.vol_n + 1;
      const delta = vel - ps.vol_sum / Math.max(n - 1, 1);
      ps.vol_sum += vel; ps.vol_sq_sum += vel * vel; ps.vol_n = n;
      if (n >= 10) {
        const m = ps.vol_sum / n;
        ps.vol = Math.sqrt(Math.max(0, ps.vol_sq_sum / n - m * m)) || 1e-9;
      }
      const nRef = [ps.vol_hist_n];
      _rbPush(ps.vol_hist, nRef, ps.vol); ps.vol_hist_n = nRef[0];
    }

    // ── Linear Regression ────────────────────────────────────────────────────
    {
      _rp(ps.lr_prices, price, 25);
      const m = ps.lr_prices.length;
      let sx=0,sy=0,sxy=0,sx2=0;
      for (let i=0;i<m;i++){sx+=i;sy+=ps.lr_prices[i];sxy+=i*ps.lr_prices[i];sx2+=i*i;}
      const det=m*sx2-sx*sx;
      if (Math.abs(det) > 1e-10) {
        const slope=(m*sxy-sx*sy)/det;
        const yMean=sy/m;const xMean=sx/m;
        const ssTot=ps.lr_prices.reduce((a,v)=>a+(v-yMean)**2,0);
        const ssFit=ps.lr_prices.reduce((a,v,i)=>a+(v-(slope*(i-xMean)+yMean))**2,0);
        ps.lr_r2=ssTot>0?Math.max(0,1-ssFit/ssTot):0;
      }
    }

    // ── AutoCorrelation lags 1-5 ──────────────────────────────────────────────
    {
      const nRef = [ps.ac_velBuf_n];
      _rbPush(ps.ac_velBuf, nRef, vel); ps.ac_velBuf_n = nRef[0];
    }

    // ── Z-Score ───────────────────────────────────────────────────────────────
    {
      ps.zs_sum += vel; ps.zs_sq += vel*vel; ps.zs_n++;
      if (ps.zs_n > 50) { ps.zs_sum -= vel * 0.02; ps.zs_sq -= vel*vel*0.02; ps.zs_n = Math.max(10, ps.zs_n - 1); }
    }

    // ── Entropy ───────────────────────────────────────────────────────────────
    { if (vel > 0) ps.ent_up++; else if (vel < 0) ps.ent_dn++; ps.ent_n++; }

    // ── VWAP ─────────────────────────────────────────────────────────────────
    { ps.vwap_psum += price; ps.vwap_tsum += 1; ps.vwap = ps.vwap_tsum > 0 ? ps.vwap_psum / ps.vwap_tsum : price; }

    // ── ROC multi-window ──────────────────────────────────────────────────────
    {
      if (ps.W5.length >= 3)  ps.roc3  = (price / ps.W5[Math.max(0,ps.W5.length-3)] - 1);
      if (ps.W10.length >= 8) ps.roc8  = (price / ps.W10[Math.max(0,ps.W10.length-8)] - 1);
      if (ps.W20.length >= 15)ps.roc15 = (price / ps.W20[Math.max(0,ps.W20.length-15)] - 1);
      if (ps.W40.length >= 25)ps.roc25 = (price / ps.W40[Math.max(0,ps.W40.length-25)] - 1);
    }

    // ── Breakout probability ──────────────────────────────────────────────────
    {
      ps.bp_n++;
      if (ps.bp_high === null || price > ps.bp_high) ps.bp_high = price;
      if (ps.bp_low  === null || price < ps.bp_low)  ps.bp_low  = price;
      if (ps.bp_n >= 20) { ps.bp_high = null; ps.bp_low = null; ps.bp_n = 0; }
    }

    // ── 2D Kalman ─────────────────────────────────────────────────────────────
    {
      if (ps.kf2.x === null) { ps.kf2.x = price; }
      else {
        ps.kf2 = _MATH.kalman2D(ps.kf2, price, CFG.SUPREME_KALMAN_Q, CFG.SUPREME_KALMAN_Q * 0.3, CFG.SUPREME_KALMAN_R);
        ps.kf2_vScore = _cls(ps.kf2.v / (ps.vol * 2 || 1e-9), 1);
      }
    }

    // ── Kaufman ER ───────────────────────────────────────────────────────────
    { if (ps.vels.length >= 10) ps.mer = _MATH.kaufmanER(ps.vels, Math.min(ps.vels.length, 20)); }

    // ── Price Geometry (peaks/troughs) ────────────────────────────────────────
    {
      if (ps.vels.length >= 3) {
        const vn = ps.vels.length, v1 = ps.vels[vn-1], v2 = ps.vels[vn-2];
        if (v2 > 0 && v1 <= 0) { ps.pg_prev_peak = ps.pg_peak; ps.pg_peak = price; }
        if (v2 < 0 && v1 >= 0) { ps.pg_prev_trough = ps.pg_trough; ps.kg_trough = price; }
      }
    }

    // ── Regime detection ──────────────────────────────────────────────────────
    {
      const atr = _rollingATR.isReady ? _rollingATR.value : ps.vol * 10;
      if (atr > 0) {
        ps.atr_ma = ps.atr_ma * 0.97 + atr * 0.03;
        const atrRatio = atr / (ps.atr_ma || 1e-9);
        ps.regime = atrRatio > CFG.SUPREME_VOLATILE_ATR_MULT ? 'VOLATILE'
                  : ps.hurst_h > CFG.SUPREME_HURST_TREND ? 'TREND' : 'RANGE';
      }
    }

    // ── Hurst (use worker result if available, else sync on rare ticks) ───────
    {
      if (!ps._workerStale) {
        ps.hurst_h = ps._workerHurst;
      } else if (ps.vels.length >= 32 && ps.tickCount % 20 === 0) {
        ps.hurst_h = _MATH.hurstFromVels(ps.vels);
      }
    }

    // ── Permutation entropy (from worker cache) ────────────────────────────────
    { if (!ps._workerStale) ps.pe_score = (1 - ps._workerPermEnt) * (ps.ofi_score > 0 ? 1 : ps.ofi_score < 0 ? -1 : 0); }

    // ── DFT Cycle (from worker cache) ──────────────────────────────────────────
    { if (!ps._workerStale) ps.dft_score = ps._workerDftCycle; }

    // ────────────────────────────────────────────────────────────────────────
    // SUPREME-PRED v3: compute weighted ensemble score
    // ────────────────────────────────────────────────────────────────────────
    const sigmoid6 = (x) => 1 / (1 + Math.exp(-x * 6));
    const aw = ps.aw;

    // RL weight adjustments
    const rlAdj = RLEngine.selectWeightAdjustments(ps);

    const B = { v: 0 }, S = { v: 0 };
    const scores = {};

    // — Group A: micro-tick algos —————————————————————————————————————————
    const gAMult = rlAdj[0];
    {
      const velScore  = ps.vels.length >= 2 ? _cls(ps.vels[ps.vels.length-1] / (ps.vol * 3 || 1e-9), 1) : 0;
      scores.vel = velScore; _addBS(B, S, velScore, aw.vel * gAMult);

      const accelScore = ps.accels.length >= 2 ? _cls(ps.accels[ps.accels.length-1] / (ps.vol * 5 || 1e-9), 1) : 0;
      scores.accel = accelScore; _addBS(B, S, accelScore, aw.accel * gAMult);

      const tRsiScore = _cls((ps.tRsi_val - 50) / 50, 1);
      scores.tRsi = tRsiScore; _addBS(B, S, tRsiScore, aw.tRsi * gAMult);

      const ofiScore = _cls(ps.ofi_score * 3, 1);
      scores.ofi = ofiScore; _addBS(B, S, ofiScore, aw.ofi * gAMult);

      const momScore = _cls(ps.mom / (ps.vol * 2 || 1e-9), 1);
      scores.mom = momScore; _addBS(B, S, momScore, aw.mom * gAMult);

      const zsMean = ps.zs_n > 5 ? ps.zs_sum / ps.zs_n : 0;
      const zsSd   = ps.zs_n > 5 ? Math.sqrt(Math.max(0, ps.zs_sq / ps.zs_n - zsMean * zsMean)) : 1e-9;
      const zScore = zsSd > 0 ? _cls(vel / zsSd, 1) : 0;
      scores.zScore = zScore; _addBS(B, S, zScore, aw.zScore * gAMult);

      const entP = ps.ent_n > 0 ? ps.ent_up / ps.ent_n : 0.5;
      const entScore = _cls((ps.ofi_score > 0 ? 1 : -1) * (1 - _MATH.shannonH(entP)), 1);
      scores.entropy = entScore; _addBS(B, S, entScore, aw.entropy * gAMult);

      // AC lags 1-5
      for (let lag = 1; lag <= 5; lag++) {
        const acScore = _MATH.autocorrLag(ps.ac_velBuf, ps.ac_velBuf_n, lag) * (ps.ofi_score > 0 ? 1 : -1);
        scores['ac'+lag] = acScore; _addBS(B, S, acScore, aw['ac'+lag] * gAMult);
      }

      // TVE
      const tveBias = TickVelocityEngine.getDirectionBias();
      const tveAccel = ps.accels.length >= 2 ? _cls(ps.accels[ps.accels.length-1] / (ps.vol * 4 || 1e-9), 1) : 0;
      scores.tveAccel = tveAccel; _addBS(B, S, tveAccel, aw.tveAccel * gAMult);
      const tveBiasScore = tveBias === 'BUY' ? 1 : tveBias === 'SELL' ? -1 : 0;
      scores.tveBias = tveBiasScore; _addBS(B, S, tveBiasScore, aw.tveBias * gAMult);

      // MER (Kaufman ER)
      const merScore = ps.mer * (ps.ofi_score >= 0 ? 1 : -1);
      scores.mer = merScore; _addBS(B, S, merScore, aw.mer * gAMult);

      // OFI Delta
      const ofiDeltaScore = _cls(ps.ofi_delta / (ps.vol * 2 || 1e-9), 1);
      scores.ofiDelta = ofiDeltaScore; _addBS(B, S, ofiDeltaScore, aw.ofiDelta * gAMult);

      // Permutation Entropy
      scores.permEnt = ps.pe_score; _addBS(B, S, ps.pe_score, aw.permEnt * gAMult);

      // VWAP Deviation
      const vwapScore = ps.vwap !== null ? _cls((price - ps.vwap) / (ps.vol * 5 || 1e-9), 1) : 0;
      scores.vwapDev = vwapScore; _addBS(B, S, vwapScore, aw.vwapDev * gAMult);

      // OBI
      const obiScore = _cls(OBI.getImbalance() * 2, 1);
      scores.obi = obiScore; _addBS(B, S, obiScore, aw.obi * gAMult);
    }

    // — Group B: statistical algos ————————————————————————————————————————
    const gBMult = rlAdj[1];
    {
      const hurstScore = _cls((ps.hurst_h - 0.5) * 4, 1) * (ps.ofi_score >= 0 ? 1 : -1);
      scores.hurst = hurstScore; _addBS(B, S, hurstScore, aw.hurst * gBMult);

      const lrScore = ps.lr_r2 > 0.3 ? _cls(ps.roc15 / (ps.vol * 10 || 1e-9), 1) * ps.lr_r2 : 0;
      scores.lr = lrScore; _addBS(B, S, lrScore, aw.lr * gBMult);

      let kalmanScore = 0;
      if (ps.kf_x === null) { ps.kf_x = price; ps.kf_p = 1.0; }
      else {
        const kf = _MATH.kalmanStep(ps.kf_x, ps.kf_p, price, CFG.SUPREME_KALMAN_Q, CFG.SUPREME_KALMAN_R);
        ps.kf_x = kf.x; ps.kf_p = kf.p;
        const kDiff = price - ps.kf_x;
        ps.kalmanPredDir   = kDiff > 0 ? 1 : kDiff < 0 ? -1 : 0;
        ps.kalmanMagnitude = Math.min(1, Math.abs(kDiff) / (ps.vol * 2 || 1e-9));
        kalmanScore = _cls(kDiff / (ps.vol * 3 || 1e-9), 1);
      }
      scores.kalman = kalmanScore; _addBS(B, S, kalmanScore, aw.kalman * gBMult);

      const rocScore = _cls((ps.roc3*3 + ps.roc8*2 + ps.roc15 + ps.roc25*0.5) / 3, 1);
      scores.roc = rocScore; _addBS(B, S, rocScore, aw.roc * gBMult);

      // Breakout
      const bpRange = ps.bp_high !== null && ps.bp_low !== null ? ps.bp_high - ps.bp_low : 0;
      const bpScore = bpRange > 0 ? _cls((price - (ps.bp_high + ps.bp_low) / 2) / (bpRange / 2), 1) : 0;
      scores.breakout = bpScore; _addBS(B, S, bpScore, aw.breakout * gBMult);

      // Price Geometry
      const geoScore = (ps.pg_peak && ps.pg_trough) ? _cls((price - (ps.pg_peak + (ps.kg_trough||ps.pg_trough)) / 2) / ((ps.pg_peak - (ps.kg_trough||ps.pg_trough)) / 2 || 1e-9), 1) : 0;
      scores.geo = geoScore; _addBS(B, S, geoScore, aw.geo * gBMult);

      // 2D Kalman velocity
      scores.kf2vel = ps.kf2_vScore; _addBS(B, S, ps.kf2_vScore, aw.kf2vel * gBMult);

      // DFT Cycle
      scores.dftCycle = ps.dft_score; _addBS(B, S, ps.dft_score, aw.dftCycle * gBMult);

      // LAD
      const ladScore = _cls(LAD.getScore(ps.ofi_score > 0 ? 'BUY' : 'SELL'), 1);
      scores.lad = ladScore; _addBS(B, S, ladScore, aw.lad * gBMult);
    }

    // — Group C: structural algos ─────────────────────────────────────────────
    const gCMult = rlAdj[2];
    {
      const regimeScore = ps.regime === 'TREND' ? _cls(ps.ofi_score * 2, 1) : ps.regime === 'VOLATILE' ? 0 : _cls(ps.ofi_score, 1) * 0.5;
      scores.regime_w = regimeScore; _addBS(B, S, regimeScore, aw.regime_w * gCMult);

      // Dynamic S/R
      const sr = ps.sr_pivots.length >= 4 ? (() => {
        const recents = ps.sr_pivots.slice(-8);
        const nearLevel = recents.find(p => Math.abs(price - p.price) < ps.vol * 5);
        if (!nearLevel) return 0;
        return nearLevel.type === 'trough' ? 0.4 : -0.4;  // near support = bull, resistance = bear
      })() : 0;
      scores.dynSR = sr; _addBS(B, S, sr, aw.dynSR * gCMult);

      // EMA Stack alignment
      const emaStackScore = (() => {
        if (!ps.e5 || !ps.e13 || !ps.e21) return 0;
        const bullStack = price > ps.e5 && ps.e5 > ps.e13 && ps.e13 > ps.e21;
        const bearStack = price < ps.e5 && ps.e5 < ps.e13 && ps.e13 < ps.e21;
        if (bullStack) return 0.8; if (bearStack) return -0.8;
        const partial = (price > ps.e5 ? 0.3 : -0.3) + (ps.e5 > ps.e13 ? 0.2 : -0.2);
        return _cls(partial, 1);
      })();
      scores.emaStack = emaStackScore; _addBS(B, S, emaStackScore, aw.emaStack * gCMult);

      // Liquidity Vacuum (large vel spike after consolidation)
      const liqVacScore = (() => {
        if (ps.vels.length < 10) return 0;
        const recentMeanVel = _mean(ps.vels.slice(-5));
        const priorMeanVel  = _mean(ps.vels.slice(-10, -5));
        const acceleration  = Math.abs(recentMeanVel) / (Math.abs(priorMeanVel) + 1e-12);
        if (acceleration < 2) return 0;
        return _cls(recentMeanVel / (ps.vol * 2 || 1e-9), 1) * Math.min(1, acceleration / 4);
      })();
      scores.liqVac = liqVacScore; _addBS(B, S, liqVacScore, aw.liqVac * gCMult);
    }

    // — Group D: candle-level algos (use buffered candle indicators) ──────────
    const gDMult = rlAdj[3];
    {
      const candles = candleBuffers[asset] || [];
      if (candles.length >= 5) {
        const trendInfo = analyzeTrend(candles);
        const trendScore = trendInfo.trend === 'UP' ? 1 : trendInfo.trend === 'DOWN' ? -1
                         : trendInfo.trend === 'UP_WEAK' ? 0.5 : trendInfo.trend === 'DN_WEAK' ? -0.5 : 0;
        scores.candle = trendScore; _addBS(B, S, trendScore, aw.candle * gDMult);

        if (candles.length >= CFG.RSI_PERIOD * 2) {
          const rsi = computeRSIProxy(candles, CFG.RSI_PERIOD);
          const rsiScore = rsi !== null ? _cls((rsi - 50) / 50, 1) * -1 : 0; // oversold=buy
          scores.rsi = rsiScore; _addBS(B, S, rsiScore, aw.rsi * gDMult);
        }
        if (candles.length >= CFG.MACD_SLOW + CFG.MACD_SIGNAL) {
          const macdData = computeMACD(candles);
          const macdScore = macdData ? _cls(macdData.histogram / (ps.vol * 10 || 1e-9), 1) : 0;
          scores.macd = macdScore; _addBS(B, S, macdScore, aw.macd * gDMult);
        }
        if (candles.length >= CFG.BB_PERIOD) {
          const bb = computeBB(candles);
          const bbScore = bb && !bb.squeeze ? _cls((0.5 - bb.percentB) * 2, 1) : 0;
          scores.bb = bbScore; _addBS(B, S, bbScore, aw.bb * gDMult);
        }
        const srsiData = computeStochRSI(candles);
        const srsiScore = srsiData ? _cls((srsiData.k - 50) / 50, 1) * -1 : 0;
        scores.srsi = srsiScore; _addBS(B, S, srsiScore, aw.srsi * gDMult);

        const mtfScore = getMTFScore(ps.ofi_score > 0 ? 'BUY' : 'SELL', candles);
        scores.mtf = mtfScore; _addBS(B, S, mtfScore, aw.mtf * gDMult);

        const fibRes = getFibSignal(candles);
        const fibScore = fibRes ? (fibRes.signal === 'BUY' ? 1 : -1) * fibRes.bonus : 0;
        scores.fib = fibScore; _addBS(B, S, fibScore, aw.fib * gDMult);

        // LSTM
        const lstmScore = LSTMProxy.getScore(ps.ofi_score > 0 ? 'BUY' : 'SELL');
        scores.lstm = lstmScore; _addBS(B, S, lstmScore, aw.lstm * gDMult);
      }
    }

    // ── Normalize and compute confidence ─────────────────────────────────────
    const totalW = B.v + S.v || 1e-9;
    const rawBuyPct = (B.v / totalW) * 100;

    // Spike penalty
    const spikeMultiplier = ps.spikeActive ? 0.80 : 1.0;
    const adjBuyPct = 50 + (rawBuyPct - 50) * spikeMultiplier;

    // Smooth
    ps.smoothBuy  = ps.smoothBuy  * (1 - ps.smoothK) + adjBuyPct       * ps.smoothK;
    ps.smoothSell = ps.smoothSell * (1 - ps.smoothK) + (100-adjBuyPct) * ps.smoothK;

    const smoothed = ps.smoothBuy;
    ps.buyPct  = Math.round(smoothed);
    ps.sellPct = 100 - ps.buyPct;
    ps.spConf  = Math.abs(smoothed - 50) * 2;  // 0-100

    // Regime block
    const regime = ps.regime || 'RANGE';
    const rs = ps.regimeStats[regime];
    if (rs && rs.total >= CFG.SUPREME_REGIME_MIN_TRADES) {
      ps.regimeBlocked[regime] = (rs.wins / rs.total) < CFG.SUPREME_REGIME_BLOCK_WR;
    }

    ps.direction   = smoothed > 52 ? 'BUY' : smoothed < 48 ? 'SELL' : 'NEUTRAL';
    ps.confidence  = ps.spConf;
    ps.algoScores  = scores;
    ps.snap        = { price, regime, direction: ps.direction, spConf: ps.spConf, buyPct: ps.buyPct, sellPct: ps.sellPct, hurst: ps.hurst_h };

    // Update group scores for telemetry
    ps.groupScores = {
      A: Math.round((B.v - S.v) / totalW * 100),
      B: Math.round(scores.kalman * 100 || 0),
      C: Math.round(scores.emaStack * 100 || 0),
      D: Math.round(scores.candle * 100 || 0),
    };

    // Update prediction bar
    _updatePredBar(ps);
  }

  function _updatePredBar(ps) {
    try {
      const bar = W.document.getElementById('pb-bar');
      if (!bar) return;
      const fill = W.document.getElementById('pb-fill');
      const dirEl = W.document.getElementById('pb-direction');
      const sigEl = W.document.getElementById('pb-signal');
      const buyEl = W.document.getElementById('pb-buy-pct');
      const selEl = W.document.getElementById('pb-sell-pct');
      const confEl = W.document.getElementById('pb-conf-bar');
      const confTxt = W.document.getElementById('pb-conf-text');
      const regEl  = W.document.getElementById('pb-regime');
      const agEl   = W.document.getElementById('pb-agree');
      const blkEl  = W.document.getElementById('pb-blocked');

      const buyPct = ps.buyPct, spConf = ps.spConf, dir = ps.direction;
      if (fill)   { fill.style.width = buyPct + '%'; fill.style.background = buyPct > 55 ? 'linear-gradient(90deg,#00d264,#00a850)' : buyPct < 45 ? 'linear-gradient(90deg,#ff3755,#cc0022)' : 'linear-gradient(90deg,#888,#666)'; }
      if (dirEl)  { dirEl.textContent = dir === 'BUY' ? '▲ BUY' : dir === 'SELL' ? '▼ SELL' : '◆ WAIT'; dirEl.style.color = dir==='BUY'?'#00d264':dir==='SELL'?'#ff3755':'#ffb020'; }
      if (sigEl)  sigEl.textContent = 'ثقة: ' + spConf.toFixed(0) + '%';
      if (buyEl)  { buyEl.textContent = buyPct + '%'; buyEl.style.color = buyPct > 55 ? '#00d264' : 'rgba(0,210,100,0.4)'; }
      if (selEl)  { selEl.textContent = ps.sellPct + '%'; selEl.style.color = ps.sellPct > 55 ? '#ff3755' : 'rgba(255,55,85,0.4)'; }
      if (confEl) { confEl.style.width = spConf + '%'; confEl.style.background = spConf > 70 ? '#00d264' : spConf > 50 ? '#ffb020' : '#ff3755'; }
      if (confTxt)confTxt.textContent = 'ثقة: ' + spConf.toFixed(0) + '%';
      if (regEl)  regEl.textContent = ps.regime + ' | WR: ' + (STATS.total > 0 ? Math.round(STATS.wins/STATS.total*100) : '–') + '%';
      if (agEl)   agEl.textContent = 'algos: ' + Object.keys(ps.algoScores).filter(k => (ps.algoScores[k]||0) > 0).length + '/' + Object.keys(ps.algoScores).length;
      if (blkEl)  { const blocked = ps.regimeBlocked[ps.regime]; blkEl.style.display = blocked ? 'block' : 'none'; if (blocked) blkEl.textContent = '⛔ Regime blocked'; }
      // Arrows
      const upArrow = W.document.getElementById('pb-arrow-up');
      const dnArrow = W.document.getElementById('pb-arrow-dn');
      if (upArrow && dnArrow) {
        if (dir === 'BUY' && spConf >= CFG.SUPREME_AUTO_CONF)       { upArrow.className='pba-fire'; dnArrow.className=''; }
        else if (dir === 'BUY')                                      { upArrow.className='pba-soft'; dnArrow.className=''; }
        else if (dir === 'SELL' && spConf >= CFG.SUPREME_AUTO_CONF)  { dnArrow.className='pba-fire'; upArrow.className=''; }
        else if (dir === 'SELL')                                     { dnArrow.className='pba-soft'; upArrow.className=''; }
        else { upArrow.className=''; dnArrow.className=''; }
      }
      // Glow
      if (spConf >= CFG.SUPREME_MIN_CONF) { const gc = dir==='BUY'?'rgba(0,210,100,0.4)':'rgba(255,55,85,0.4)'; bar.style.boxShadow=`0 0 20px ${gc},0 8px 32px rgba(0,0,0,0.8)`; }
      else bar.style.boxShadow='0 8px 32px rgba(0,0,0,0.8)';
    } catch(_) {}
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §21  PATTERN PERFORMANCE TRACKER (PPT)
  // ═══════════════════════════════════════════════════════════════════════════
  const PPT = (() => {
    const _DB_KEY = 'v13_ppt';
    let _data = {}; // { patternName: { wins, total, decay } }

    function _load() {
      try {
        const raw = localStorage.getItem(_DB_KEY);
        if (raw) _data = JSON.parse(raw);
      } catch(_) { _data = {}; }
    }

    function _save() {
      try { localStorage.setItem(_DB_KEY, JSON.stringify(_data)); } catch(_) {}
    }

    function _entry(name) {
      if (!_data[name]) _data[name] = { wins: 0, total: 0, decay: 1.0 };
      return _data[name];
    }

    function record(name, won) {
      const e = _entry(name);
      e.total++;
      if (won) e.wins++;
      // Exponential decay — older trades weight less
      e.decay = e.decay * CFG.PPT_DECAY + (won ? 1 : 0) * (1 - CFG.PPT_DECAY);
      _save();
    }

    function getWeight(name) {
      const e = _data[name];
      if (!e || e.total < CFG.PPT_MIN_TRADES) return 1.0;
      const wr = e.wins / e.total;
      // Decay-adjusted score: blend raw WR with recency-weighted WR
      const blended = wr * 0.5 + e.decay * 0.5;
      // Map 0..1 → 0.5..1.5
      return 0.5 + blended;
    }

    function isBlocked(name) {
      const e = _data[name];
      if (!e || e.total < CFG.PPT_MIN_TRADES) return false;
      return (e.wins / e.total) < CFG.PPT_BLOCK_WR;
    }

    function getAll() { return _data; }

    function reset() { _data = {}; _save(); }

    _load();
    return { record, getWeight, isBlocked, getAll, reset };
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // §22  PATTERN RECOGNITION ENGINE (35+ candlestick patterns)
  // ═══════════════════════════════════════════════════════════════════════════
  const PatternEngine = (() => {

    function _body(c)  { return Math.abs(c.close - c.open); }
    function _range(c) { return c.high - c.low || 1e-9; }
    function _upShadow(c) { return c.high - Math.max(c.open, c.close); }
    function _dnShadow(c) { return Math.min(c.open, c.close) - c.low; }
    function _bullish(c)  { return c.close > c.open; }
    function _bearish(c)  { return c.close < c.open; }
    function _doji(c)     { return _body(c) / _range(c) < 0.1; }
    function _avg(arr, fn) { let s=0; for(const c of arr) s+=fn(c); return s/arr.length; }

    // ── Individual pattern functions (c0=newest, c1=one before, c2=two before) ──

    function p_hammer(cs) {
      const c = cs[0]; if (_bullish(c)) return null;
      const b = _body(c), r = _range(c), lo = _dnShadow(c), up = _upShadow(c);
      if (b/r < 0.15 && lo >= b*2 && up < b*0.5) return { dir:'BUY', name:'hammer', str:0.7 };
      return null;
    }
    function p_hangingMan(cs) {
      const c = cs[0];
      const b = _body(c), r = _range(c), lo = _dnShadow(c), up = _upShadow(c);
      // Appears at top of uptrend
      if (cs.length < 3) return null;
      const trend = cs[2].close < cs[1].close && cs[1].close < c.close;
      if (trend && b/r < 0.2 && lo >= b*1.8 && up < b*0.4) return { dir:'SELL', name:'hangingMan', str:0.65 };
      return null;
    }
    function p_invertedHammer(cs) {
      const c = cs[0];
      const b = _body(c), r = _range(c), lo = _dnShadow(c), up = _upShadow(c);
      if (b/r < 0.2 && up >= b*2 && lo < b*0.5) return { dir:'BUY', name:'invertedHammer', str:0.6 };
      return null;
    }
    function p_shootingStar(cs) {
      const c = cs[0];
      const b = _body(c), r = _range(c), up = _upShadow(c), lo = _dnShadow(c);
      if (cs.length < 3) return null;
      const trend = cs[2].close < cs[1].close && cs[1].close < c.close;
      if (trend && b/r < 0.2 && up >= b*2 && lo < b*0.4) return { dir:'SELL', name:'shootingStar', str:0.7 };
      return null;
    }
    function p_doji(cs) {
      const c = cs[0];
      if (_doji(c)) return { dir:'NEUTRAL', name:'doji', str:0.4 };
      return null;
    }
    function p_dragonfly(cs) {
      const c = cs[0];
      const b = _body(c), r = _range(c), lo = _dnShadow(c), up = _upShadow(c);
      if (b/r < 0.05 && lo/r > 0.7 && up/r < 0.1) return { dir:'BUY', name:'dragonfly', str:0.75 };
      return null;
    }
    function p_gravestone(cs) {
      const c = cs[0];
      const b = _body(c), r = _range(c), lo = _dnShadow(c), up = _upShadow(c);
      if (b/r < 0.05 && up/r > 0.7 && lo/r < 0.1) return { dir:'SELL', name:'gravestone', str:0.75 };
      return null;
    }
    function p_marubozu_bull(cs) {
      const c = cs[0];
      if (!_bullish(c)) return null;
      const b = _body(c), r = _range(c);
      if (b/r > 0.9) return { dir:'BUY', name:'marubozu_bull', str:0.8 };
      return null;
    }
    function p_marubozu_bear(cs) {
      const c = cs[0];
      if (!_bearish(c)) return null;
      const b = _body(c), r = _range(c);
      if (b/r > 0.9) return { dir:'SELL', name:'marubozu_bear', str:0.8 };
      return null;
    }
    function p_spinningTop(cs) {
      const c = cs[0];
      const b = _body(c), r = _range(c);
      const lo = _dnShadow(c), up = _upShadow(c);
      if (b/r < 0.35 && up > b*0.5 && lo > b*0.5) return { dir:'NEUTRAL', name:'spinningTop', str:0.35 };
      return null;
    }
    // Two-candle
    function p_bullEngulf(cs) {
      if (cs.length < 2) return null;
      const [c0, c1] = cs;
      if (_bullish(c0) && _bearish(c1) && c0.open < c1.close && c0.close > c1.open && _body(c0) > _body(c1))
        return { dir:'BUY', name:'bullEngulf', str:0.85 };
      return null;
    }
    function p_bearEngulf(cs) {
      if (cs.length < 2) return null;
      const [c0, c1] = cs;
      if (_bearish(c0) && _bullish(c1) && c0.open > c1.close && c0.close < c1.open && _body(c0) > _body(c1))
        return { dir:'SELL', name:'bearEngulf', str:0.85 };
      return null;
    }
    function p_piercingLine(cs) {
      if (cs.length < 2) return null;
      const [c0, c1] = cs;
      const mid1 = (c1.open + c1.close) / 2;
      if (_bullish(c0) && _bearish(c1) && c0.open < c1.close && c0.close > mid1 && c0.close < c1.open)
        return { dir:'BUY', name:'piercingLine', str:0.75 };
      return null;
    }
    function p_darkCloud(cs) {
      if (cs.length < 2) return null;
      const [c0, c1] = cs;
      const mid1 = (c1.open + c1.close) / 2;
      if (_bearish(c0) && _bullish(c1) && c0.open > c1.close && c0.close < mid1 && c0.close > c1.open)
        return { dir:'SELL', name:'darkCloud', str:0.75 };
      return null;
    }
    function p_tweezersTop(cs) {
      if (cs.length < 2) return null;
      const [c0, c1] = cs;
      if (Math.abs(c0.high - c1.high) / (_range(c0) + _range(c1) + 1e-9) < 0.05 && _bullish(c1) && _bearish(c0))
        return { dir:'SELL', name:'tweezersTop', str:0.65 };
      return null;
    }
    function p_tweezersBot(cs) {
      if (cs.length < 2) return null;
      const [c0, c1] = cs;
      if (Math.abs(c0.low - c1.low) / (_range(c0) + _range(c1) + 1e-9) < 0.05 && _bearish(c1) && _bullish(c0))
        return { dir:'BUY', name:'tweezersBot', str:0.65 };
      return null;
    }
    function p_harami_bull(cs) {
      if (cs.length < 2) return null;
      const [c0, c1] = cs;
      if (_bearish(c1) && _bullish(c0) && c0.open > c1.close && c0.close < c1.open && _body(c0) < _body(c1)*0.5)
        return { dir:'BUY', name:'harami_bull', str:0.6 };
      return null;
    }
    function p_harami_bear(cs) {
      if (cs.length < 2) return null;
      const [c0, c1] = cs;
      if (_bullish(c1) && _bearish(c0) && c0.open < c1.close && c0.close > c1.open && _body(c0) < _body(c1)*0.5)
        return { dir:'SELL', name:'harami_bear', str:0.6 };
      return null;
    }
    function p_kicker_bull(cs) {
      if (cs.length < 2) return null;
      const [c0, c1] = cs;
      if (_bearish(c1) && _bullish(c0) && c0.open >= c1.open && _body(c0) / _range(c0) > 0.6)
        return { dir:'BUY', name:'kicker_bull', str:0.9 };
      return null;
    }
    function p_kicker_bear(cs) {
      if (cs.length < 2) return null;
      const [c0, c1] = cs;
      if (_bullish(c1) && _bearish(c0) && c0.open <= c1.open && _body(c0) / _range(c0) > 0.6)
        return { dir:'SELL', name:'kicker_bear', str:0.9 };
      return null;
    }
    // Three-candle
    function p_morningStar(cs) {
      if (cs.length < 3) return null;
      const [c0, c1, c2] = cs;
      if (_bearish(c2) && _body(c1)/_range(c1) < 0.3 && _bullish(c0) && c0.close > (c2.open+c2.close)/2)
        return { dir:'BUY', name:'morningStar', str:0.9 };
      return null;
    }
    function p_eveningStar(cs) {
      if (cs.length < 3) return null;
      const [c0, c1, c2] = cs;
      if (_bullish(c2) && _body(c1)/_range(c1) < 0.3 && _bearish(c0) && c0.close < (c2.open+c2.close)/2)
        return { dir:'SELL', name:'eveningStar', str:0.9 };
      return null;
    }
    function p_3white(cs) {
      if (cs.length < 3) return null;
      const [c0, c1, c2] = cs;
      if (_bullish(c0) && _bullish(c1) && _bullish(c2) && c0.close > c1.close && c1.close > c2.close &&
          _body(c0)/_range(c0) > 0.5 && _body(c1)/_range(c1) > 0.5 && _body(c2)/_range(c2) > 0.5)
        return { dir:'BUY', name:'3whiteSoldiers', str:0.85 };
      return null;
    }
    function p_3black(cs) {
      if (cs.length < 3) return null;
      const [c0, c1, c2] = cs;
      if (_bearish(c0) && _bearish(c1) && _bearish(c2) && c0.close < c1.close && c1.close < c2.close &&
          _body(c0)/_range(c0) > 0.5 && _body(c1)/_range(c1) > 0.5 && _body(c2)/_range(c2) > 0.5)
        return { dir:'SELL', name:'3blackCrows', str:0.85 };
      return null;
    }
    function p_3inside_up(cs) {
      if (cs.length < 3) return null;
      const [c0, c1, c2] = cs;
      if (p_harami_bull([c1, c2]) && _bullish(c0) && c0.close > c2.open)
        return { dir:'BUY', name:'3insideUp', str:0.8 };
      return null;
    }
    function p_3inside_dn(cs) {
      if (cs.length < 3) return null;
      const [c0, c1, c2] = cs;
      if (p_harami_bear([c1, c2]) && _bearish(c0) && c0.close < c2.open)
        return { dir:'SELL', name:'3insideDown', str:0.8 };
      return null;
    }
    function p_3outside_up(cs) {
      if (cs.length < 3) return null;
      const [c0, c1, c2] = cs;
      if (p_bullEngulf([c1, c2]) && _bullish(c0) && c0.close > c1.close)
        return { dir:'BUY', name:'3outsideUp', str:0.82 };
      return null;
    }
    function p_3outside_dn(cs) {
      if (cs.length < 3) return null;
      const [c0, c1, c2] = cs;
      if (p_bearEngulf([c1, c2]) && _bearish(c0) && c0.close < c1.close)
        return { dir:'SELL', name:'3outsideDown', str:0.82 };
      return null;
    }
    function p_tristar_bull(cs) {
      if (cs.length < 3) return null;
      const [c0,c1,c2] = cs;
      if (_doji(c0) && _doji(c1) && _doji(c2) && c1.low < c0.low && c1.low < c2.low)
        return { dir:'BUY', name:'tristarBull', str:0.7 };
      return null;
    }
    function p_tristar_bear(cs) {
      if (cs.length < 3) return null;
      const [c0,c1,c2] = cs;
      if (_doji(c0) && _doji(c1) && _doji(c2) && c1.high > c0.high && c1.high > c2.high)
        return { dir:'SELL', name:'tristarBear', str:0.7 };
      return null;
    }
    function p_abandonedBaby_bull(cs) {
      if (cs.length < 3) return null;
      const [c0,c1,c2] = cs;
      if (_bearish(c2) && _doji(c1) && _bullish(c0) && c1.high < c2.low && c1.low > c0.high)
        return null; // gap requires strict price gap — skip if not present
      // PocketOption ticks are continuous; use close gap proxy
      if (_bearish(c2) && _doji(c1) && _bullish(c0) && c1.close < c2.close && c0.close > c1.close)
        return { dir:'BUY', name:'abandonedBabyBull', str:0.88 };
      return null;
    }
    function p_abandonedBaby_bear(cs) {
      if (cs.length < 3) return null;
      const [c0,c1,c2] = cs;
      if (_bullish(c2) && _doji(c1) && _bearish(c0) && c1.close > c2.close && c0.close < c1.close)
        return { dir:'SELL', name:'abandonedBabyBear', str:0.88 };
      return null;
    }
    function p_beltHold_bull(cs) {
      const c = cs[0];
      if (_bullish(c) && _dnShadow(c) / _range(c) < 0.02 && _body(c)/_range(c) > 0.6)
        return { dir:'BUY', name:'beltHoldBull', str:0.65 };
      return null;
    }
    function p_beltHold_bear(cs) {
      const c = cs[0];
      if (_bearish(c) && _upShadow(c) / _range(c) < 0.02 && _body(c)/_range(c) > 0.6)
        return { dir:'SELL', name:'beltHoldBear', str:0.65 };
      return null;
    }
    function p_breakaway_bull(cs) {
      if (cs.length < 5) return null;
      const [c0,c1,c2,c3,c4] = cs;
      if (_bearish(c4) && _bearish(c3) && c3.open < c4.close && _bullish(c0) && c0.close > c2.close)
        return { dir:'BUY', name:'breakawayBull', str:0.72 };
      return null;
    }
    function p_breakaway_bear(cs) {
      if (cs.length < 5) return null;
      const [c0,c1,c2,c3,c4] = cs;
      if (_bullish(c4) && _bullish(c3) && c3.open > c4.close && _bearish(c0) && c0.close < c2.close)
        return { dir:'SELL', name:'breakawayBear', str:0.72 };
      return null;
    }
    function p_risingMethod(cs) {
      if (cs.length < 5) return null;
      const [c0,c1,c2,c3,c4] = cs;
      if (_bullish(c4) && _body(c4)/_range(c4)>0.6 && _bearish(c3) && _bearish(c2) && _bearish(c1) &&
          c3.high < c4.close && c1.low > c4.open && _bullish(c0) && c0.close > c4.close)
        return { dir:'BUY', name:'risingMethod', str:0.78 };
      return null;
    }
    function p_fallingMethod(cs) {
      if (cs.length < 5) return null;
      const [c0,c1,c2,c3,c4] = cs;
      if (_bearish(c4) && _body(c4)/_range(c4)>0.6 && _bullish(c3) && _bullish(c2) && _bullish(c1) &&
          c3.low > c4.close && c1.high < c4.open && _bearish(c0) && c0.close < c4.close)
        return { dir:'SELL', name:'fallingMethod', str:0.78 };
      return null;
    }
    function p_matHold(cs) {
      if (cs.length < 5) return null;
      const [c0,c1,c2,c3,c4] = cs;
      if (_bullish(c4) && _body(c4)/_range(c4)>0.7 && _bearish(c3) && _bearish(c2) &&
          c3.close > c4.open && _bullish(c1) && _bullish(c0) && c0.close > c3.open)
        return { dir:'BUY', name:'matHold', str:0.76 };
      return null;
    }
    function p_tasuki_bull(cs) {
      if (cs.length < 3) return null;
      const [c0,c1,c2] = cs;
      if (_bullish(c2) && _bullish(c1) && c1.open > c2.close && _bearish(c0) &&
          c0.open < c1.close && c0.close > c1.open)
        return { dir:'BUY', name:'tasukiBull', str:0.67 };
      return null;
    }
    function p_tasuki_bear(cs) {
      if (cs.length < 3) return null;
      const [c0,c1,c2] = cs;
      if (_bearish(c2) && _bearish(c1) && c1.open < c2.close && _bullish(c0) &&
          c0.open > c1.close && c0.close < c1.open)
        return { dir:'SELL', name:'tasukiBear', str:0.67 };
      return null;
    }
    function p_threeLineStrike_bull(cs) {
      if (cs.length < 4) return null;
      const [c0,c1,c2,c3] = cs;
      if (_bearish(c3) && _bearish(c2) && _bearish(c1) && _bullish(c0) &&
          c0.open < c1.close && c0.close > c3.open)
        return { dir:'BUY', name:'3lineStrikeBull', str:0.8 };
      return null;
    }
    function p_threeLineStrike_bear(cs) {
      if (cs.length < 4) return null;
      const [c0,c1,c2,c3] = cs;
      if (_bullish(c3) && _bullish(c2) && _bullish(c1) && _bearish(c0) &&
          c0.open > c1.close && c0.close < c3.open)
        return { dir:'SELL', name:'3lineStrikeBear', str:0.8 };
      return null;
    }
    function p_concealingBaby(cs) {
      if (cs.length < 4) return null;
      const [c0,c1,c2,c3] = cs;
      // 4 bearish candles, each closing within previous — strong continuation
      if ([c0,c1,c2,c3].every(_bearish) && c1.close > c0.open && c1.close < c0.close &&
          c2.close > c1.open && c2.close < c1.close)
        return { dir:'BUY', name:'concealingBabySwallow', str:0.73 };
      return null;
    }

    // ── Master run ────────────────────────────────────────────────────────────
    const ALL_PATTERNS = [
      p_hammer, p_hangingMan, p_invertedHammer, p_shootingStar,
      p_doji, p_dragonfly, p_gravestone,
      p_marubozu_bull, p_marubozu_bear, p_spinningTop,
      p_bullEngulf, p_bearEngulf, p_piercingLine, p_darkCloud,
      p_tweezersTop, p_tweezersBot, p_harami_bull, p_harami_bear,
      p_kicker_bull, p_kicker_bear,
      p_morningStar, p_eveningStar, p_3white, p_3black,
      p_3inside_up, p_3inside_dn, p_3outside_up, p_3outside_dn,
      p_tristar_bull, p_tristar_bear, p_abandonedBaby_bull, p_abandonedBaby_bear,
      p_beltHold_bull, p_beltHold_bear,
      p_breakaway_bull, p_breakaway_bear,
      p_risingMethod, p_fallingMethod, p_matHold,
      p_tasuki_bull, p_tasuki_bear,
      p_threeLineStrike_bull, p_threeLineStrike_bear,
      p_concealingBaby,
    ];

    function detect(candles) {
      // candles[0] = newest, candles[N-1] = oldest
      const results = [];
      for (const fn of ALL_PATTERNS) {
        try {
          const r = fn(candles);
          if (r) results.push(r);
        } catch(_) {}
      }
      return results;
    }

    return { detect };
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // §23  PATTERN STATE MACHINE + CONFLUENCE SCORER
  // ═══════════════════════════════════════════════════════════════════════════
  const PSM = (() => {
    // State: last N signal events
    const _SIG_BUF = 8;
    let _signals = []; // { dir, strength, name, ts }

    function update(candles) {
      if (!candles || candles.length < 2) return null;
      const patterns = PatternEngine.detect(candles);
      if (!patterns.length) return null;

      const now = Date.now();
      for (const p of patterns) {
        if (p.dir === 'NEUTRAL') continue;
        _signals.push({ dir: p.dir, str: p.str * PPT.getWeight(p.name), name: p.name, ts: now });
      }
      // Keep only recent
      const cutoff = now - CFG.SIGNAL_WINDOW_MS;
      _signals = _signals.filter(s => s.ts >= cutoff);
      if (_signals.length > _SIG_BUF) _signals = _signals.slice(-_SIG_BUF);

      return patterns;
    }

    function confluence(patterns, assetId) {
      if (!patterns || !patterns.length) return null;

      let buyW = 0, sellW = 0;
      for (const p of _signals) {
        if (PPT.isBlocked(p.name)) continue;
        const w = p.str;
        if (p.dir === 'BUY')  buyW  += w;
        if (p.dir === 'SELL') sellW += w;
      }
      if (buyW + sellW < 0.01) return null;

      // OBI integration
      const obiScore = OBI.getScore(assetId);
      const obiDir   = obiScore > 0.1 ? 1 : obiScore < -0.1 ? -1 : 0;
      buyW  += Math.max(0,  obiDir) * CFG.OBI_CONFLUENCE_WEIGHT;
      sellW += Math.max(0, -obiDir) * CFG.OBI_CONFLUENCE_WEIGHT;

      // LAD integration
      const ladOpp = LAD.getOpportunity();
      if (ladOpp) {
        if (ladOpp.dir === 'BUY')  buyW  += CFG.LAD_CONFLUENCE_WEIGHT;
        if (ladOpp.dir === 'SELL') sellW += CFG.LAD_CONFLUENCE_WEIGHT;
      }

      // LSTM
      const lstmB = LSTMProxy.getScore('BUY');
      const lstmS = LSTMProxy.getScore('SELL');
      buyW  += Math.max(0, lstmB) * CFG.LSTM_CONFLUENCE_WEIGHT;
      sellW += Math.max(0, lstmS) * CFG.LSTM_CONFLUENCE_WEIGHT;

      // Supreme-Pred
      const spDir   = _PS.direction;
      const spConf  = _PS.spConf;
      if (spDir === 'BUY')  buyW  += (spConf / 100) * CFG.SUPREM_CONFLUENCE_WEIGHT;
      if (spDir === 'SELL') sellW += (spConf / 100) * CFG.SUPREM_CONFLUENCE_WEIGHT;

      const total = buyW + sellW;
      const buyPct = (buyW / total) * 100;
      const dir = buyPct > 60 ? 'BUY' : buyPct < 40 ? 'SELL' : null;
      if (!dir) return null;

      const conf = Math.abs(buyPct - 50) * 2;
      return { dir, conf, buyPct, patterns };
    }

    function reset() { _signals = []; }

    return { update, confluence, reset };
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // §24  WEBSOCKET LAYER
  // ═══════════════════════════════════════════════════════════════════════════

  // ── WS message text handlers ──────────────────────────────────────────────
  function _handleTextMsg(raw) {
    try {
      // Fast type sniff before JSON.parse
      if (raw[0] !== '{' && raw[0] !== '[') return;
      const msg = JSON.parse(raw);
      if (!msg || typeof msg !== 'object') return;

      const action = msg.action || msg.type || msg[0];

      if (action === 51 || action === 'updateStream') {
        // tick update [assetId, price, time, ...]
        const d = msg.data || msg[1];
        if (Array.isArray(d) && d.length >= 3) {
          onTick(String(d[0]), parseFloat(d[1]), Number(d[2]));
        }
      } else if (action === 73 || action === 'successauth') {
        addLog('AUTH OK');
        EventBus.emit('auth');
      } else if (action === 14 || action === 'updateAssets') {
        const assets = msg.data || [];
        processUpdateAssets(assets);
      } else if (action === 31 || action === 'openOrder') {
        const od = msg.data || msg[1];
        if (od && od.id) { botOrderIds.add(String(od.id)); _STATE.pendingOrderId = String(od.id); }
        EventBus.emit('order:open', od);
      } else if (action === 32 || action === 'updateOrder') {
        const od = msg.data || msg[1];
        if (od) processCloseOrder(od);
      } else if (action === 34 || action === 'listOrders') {
        const list = msg.data || [];
        list.forEach(o => botOrderIds.add(String(o.id)));
      } else if (action === 4 || action === 'updateBalance') {
        const bal = msg.data || msg[1];
        if (bal) {
          if (bal.amount !== undefined) _STATE.balance = parseFloat(bal.amount);
          if (bal.id !== undefined) _STATE.accountId = bal.id;
        }
        EventBus.emit('balance', _STATE.balance);
      } else if (action === 74 || action === 'setTimeZone') {
        // ignore
      } else if (action === 11 || action === 'updateClientTimeDelta') {
        const delta = msg.data;
        if (typeof delta === 'number') _STATE.serverTimeDelta = delta;
      } else if (action === 'candles' || action === 120) {
        const d = msg.data || msg[1];
        if (d) onChafor(d);
      }
    } catch(e) { addLog('WS text err: ' + e.message); }
  }

  // ── WS binary handler ─────────────────────────────────────────────────────
  function _handleBinaryMsg(buf) {
    try {
      const u8 = new Uint8Array(buf);
      // CRC validation
      if (!validatePacket(u8)) { TELEMETRY.recordAnomaly('crc_fail'); return; }
      const decoded = msgpackDecode(u8);
      if (!decoded) return;

      // Normalise msgpack array response
      const msgs = Array.isArray(decoded) ? decoded : [decoded];
      for (const m of msgs) {
        const action = m[0] || m.action;
        if (action === 51) {
          const d = m[1] || m.data;
          if (Array.isArray(d)) onTick(String(d[0]), parseFloat(d[1]), Number(d[2]));
        } else if (action === 120 || action === 'candles') {
          onChafor(m[1] || m.data);
        } else if (action === 14) {
          processUpdateAssets(m[1] || m.data || []);
        } else if (action === 31) {
          const od = m[1] || m.data;
          if (od && od.id) { botOrderIds.add(String(od.id)); _STATE.pendingOrderId = String(od.id); }
          EventBus.emit('order:open', od);
        } else if (action === 32) {
          processCloseOrder(m[1] || m.data);
        } else if (action === 4) {
          const bal = m[1] || m.data;
          if (bal && bal.amount !== undefined) _STATE.balance = parseFloat(bal.amount);
          EventBus.emit('balance', _STATE.balance);
        }
      }
    } catch(e) { addLog('WS bin err: ' + e.message); }
  }

  // ── WS Proxy (intercept native WebSocket) ────────────────────────────────
  function _installWSProxy() {
    const NativeWS = W.WebSocket;
    if (!NativeWS || W._v13WsInstalled) return;
    W._v13WsInstalled = true;

    class WSProxy extends NativeWS {
      constructor(url, protocols) {
        super(url, protocols);
        _STATE.wsSocket = this;

        const origOnMsg = this.onmessage;
        this.addEventListener('message', (ev) => {
          try {
            if (ev.data instanceof ArrayBuffer || ev.data instanceof Uint8Array) {
              const buf = ev.data instanceof Uint8Array ? ev.data.buffer : ev.data;
              _handleBinaryMsg(buf);
            } else if (typeof ev.data === 'string') {
              _handleTextMsg(ev.data);
            } else if (ev.data && typeof ev.data.arrayBuffer === 'function') {
              ev.data.arrayBuffer().then(_handleBinaryMsg).catch(()=>{});
            }
          } catch(e) { addLog('WS proxy err: ' + e.message); }
        });

        this.addEventListener('open', () => {
          addLog('WS OPEN: ' + url);
          _STATE.wsConnected = true;
          EventBus.emit('ws:open');
        });
        this.addEventListener('close', () => {
          addLog('WS CLOSED');
          _STATE.wsConnected = false;
          EventBus.emit('ws:close');
        });
        this.addEventListener('error', () => {
          TELEMETRY.recordAnomaly('ws_error');
          EventBus.emit('ws:error');
        });
      }
    }

    // Preserve all static props
    Object.keys(NativeWS).forEach(k => { try { WSProxy[k] = NativeWS[k]; } catch(_) {} });
    WSProxy.prototype = NativeWS.prototype;
    try { W.WebSocket = WSProxy; } catch(_) {
      // If window is sealed, patch via defineProperty
      Object.defineProperty(W, 'WebSocket', { value: WSProxy, writable: true, configurable: true });
    }
    addLog('WS proxy installed');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §25  TICK INGESTION + CANDLE LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  function onTick(assetId, price, serverTs) {
    const t0 = performance.now();
    if (!assetId || !isFinite(price) || price <= 0) return;

    const asset = normalizeAsset(assetId);
    if (!asset) return;

    // ── Tick buffer ───────────────────────────────────────────────────────
    if (!tickBuffers.has(asset)) tickBuffers.set(asset, []);
    const tb = tickBuffers.get(asset);
    const localTs = Date.now() + (_STATE.serverTimeDelta || 0);
    const tickObj = { price, ts: serverTs || localTs, localTs };
    tb.push(tickObj);
    if (tb.length > CFG.TICK_BUF_SIZE) tb.shift();

    // ── OBI / LAD ─────────────────────────────────────────────────────────
    OBI.update(asset, price, tickObj.ts);
    LAD.recordTick(asset, price, tickObj.ts, tickObj.localTs);
    TVE.update(asset, price);

    // ── QPP phantom ───────────────────────────────────────────────────────
    predictClosePrice(tb, price);

    // ── LSTM push ─────────────────────────────────────────────────────────
    if (tb.length >= 2) {
      LSTMProxy.push(price);
    }

    // ── Current candle update ─────────────────────────────────────────────
    const tf = _STATE.activeTimeframe || CFG.DEFAULT_TIMEFRAME;
    const snap = snapToPOTime(tickObj.ts || Date.now(), tf);
    const ck = asset + ':' + snap.open;

    if (!currentCandles.has(ck)) {
      currentCandles.set(ck, {
        open: price, high: price, low: price, close: price,
        openTime: snap.open, closeTime: snap.close,
        volume: 0, asset, tf, ticks: 1,
      });
    } else {
      const cc = currentCandles.get(ck);
      if (price > cc.high) cc.high = price;
      if (price < cc.low)  cc.low  = price;
      cc.close = price;
      cc.ticks++;
    }

    // ── Supreme-Pred bar ─────────────────────────────────────────────────
    if (asset === normalizeAsset(_STATE.activeAsset || '')) {
      const candles = candleBuffers.get(asset) || [];
      if (candles.length >= 2) _predBarTick(price, candles, asset);
    }

    // ── ETC record ───────────────────────────────────────────────────────
    if (_STATE.pendingEtcSignal) {
      _etcRecordSignal(asset);
      _STATE.pendingEtcSignal = false;
    }

    TELEMETRY.tickDone(performance.now() - t0);
  }

  function onChafor(data) {
    // Historical candle data from server (chafor = chart for?)
    if (!data) return;
    try {
      const assetId = String(data.asset_id || data.assetId || data[0] || '');
      const rawCandles = data.candles || data.history || data[1] || [];
      if (!assetId || !rawCandles.length) return;
      const asset = normalizeAsset(assetId);
      if (!asset) return;

      const built = [];
      for (const rc of rawCandles) {
        // [time, open, high, low, close, volume] or object
        let c;
        if (Array.isArray(rc)) {
          c = { openTime: Number(rc[0])*1000, open: parseFloat(rc[1]), high: parseFloat(rc[2]),
                low: parseFloat(rc[3]), close: parseFloat(rc[4]), volume: parseFloat(rc[5]||0), asset };
        } else {
          c = { openTime: Number(rc.open_time||rc.time||rc.t)*1000, open: parseFloat(rc.open||rc.o),
                high: parseFloat(rc.high||rc.h), low: parseFloat(rc.low||rc.l),
                close: parseFloat(rc.close||rc.c), volume: parseFloat(rc.volume||rc.v||0), asset };
        }
        if (isFinite(c.open) && c.open > 0) built.push(c);
      }
      built.sort((a,b) => a.openTime - b.openTime);

      if (!candleBuffers.has(asset)) candleBuffers.set(asset, []);
      const buf = candleBuffers.get(asset);
      // Merge: append new candles that are newer than last
      const lastTs = buf.length ? buf[buf.length-1].openTime : 0;
      for (const c of built) {
        if (c.openTime > lastTs) buf.push(c);
      }
      while (buf.length > CFG.CANDLE_BUF_SIZE) buf.shift();

      // Store chafor state for scheduling
      if (!chaforState.has(asset)) chaforState.set(asset, {});
      const cs = chaforState.get(asset);
      cs.loaded = true;
      cs.lastChaforTs = Date.now();
      cs.tf = _STATE.activeTimeframe;
      cs.count = buf.length;

      addLog('Chafor ' + asset + ' loaded ' + built.length + ' candles → buf=' + buf.length);
      EventBus.emit('chafor:loaded', { asset, count: buf.length });
    } catch(e) { addLog('onChafor err: ' + e.message); }
  }

  function closeCurrentCandle(asset, tf) {
    const tf2 = tf || _STATE.activeTimeframe || CFG.DEFAULT_TIMEFRAME;
    const tb = tickBuffers.get(asset);
    if (!tb || !tb.length) return;

    const lastTick = tb[tb.length - 1];
    const snap = snapToPOTime(lastTick.ts, tf2);

    // Find the current open candle for previous window
    const prevSnap = snapToPOTime(snap.open - 1, tf2);
    const ck = asset + ':' + prevSnap.open;
    const cc = currentCandles.get(ck);
    if (!cc) return;

    // Build finalized candle
    const finalized = buildCandle(cc, asset);
    if (!finalized) return;

    if (!candleBuffers.has(asset)) candleBuffers.set(asset, []);
    const buf = candleBuffers.get(asset);
    buf.push(finalized);
    while (buf.length > CFG.CANDLE_BUF_SIZE) buf.shift();
    currentCandles.delete(ck);

    EventBus.emit('candle:close', { asset, candle: finalized });
    addLog('Candle closed: ' + asset + ' @ ' + finalized.close.toFixed(5));
  }

  function onActiveAsset(assetId) {
    const asset = normalizeAsset(assetId);
    if (!asset) return;
    _STATE.activeAsset = asset;
    addLog('Active asset: ' + asset);
    EventBus.emit('asset:change', asset);
  }

  function onPlatformTimeframe(tf) {
    if (!tf || isNaN(tf)) return;
    _STATE.activeTimeframe = Number(tf);
    addLog('TF: ' + tf + 's');
    EventBus.emit('tf:change', Number(tf));
  }

  function processUpdateAssets(assets) {
    if (!Array.isArray(assets)) return;
    for (const a of assets) {
      if (!a) continue;
      const id = String(a.id || a.asset_id || '');
      const payout = parseFloat(a.profit || a.payout || a.pay || 0);
      const isOpen = !!(a.is_active !== false && a.suspended !== true);
      if (id) {
        if (payout > 0) _assetPayouts.set(id, payout / 100);
        _assetIsOpen.set(id, isOpen);
      }
    }
  }

  function processCloseOrder(od) {
    if (!od || !od.id) return;
    const oid = String(od.id);
    if (!botOrderIds.has(oid)) return;

    const won = od.profit > 0 || od.win === true || od.result === 'win';
    const pnl = parseFloat(od.profit || od.win_amount || 0);

    addLog('Order ' + oid + ' → ' + (won ? 'WIN' : 'LOSE') + ' PnL=' + pnl.toFixed(2));

    // Stats
    STATS.total++;
    if (won) { STATS.wins++; STATS.streak = Math.max(0, STATS.streak) + 1; }
    else      { STATS.streak = Math.min(0, STATS.streak) - 1; }
    STATS.pnl += pnl;
    STATS.todayPnl += pnl;

    // Anti-martingale
    Pyramid.onResult(won);

    // RL outcome
    RLEngine.recordOutcome(won);

    // LSTM learn
    const candles = candleBuffers.get(normalizeAsset(_STATE.activeAsset || '')) || [];
    if (candles.length) LSTMProxy.learn(candles, won);

    // PPT update for last fired patterns
    if (_STATE.lastPatternNames) {
      for (const name of _STATE.lastPatternNames) PPT.record(name, won);
      _STATE.lastPatternNames = null;
    }

    // Session protection accounting
    SessionGuard.recordTrade(won, pnl);

    // ETC calibrate
    _etcCalibrate(od);

    // Save brain
    _saveBrain();
    saveStats();

    EventBus.emit('trade:result', { oid, won, pnl });

    // Update stats UI
    _refreshStatsUI();

    // Clear pending
    botOrderIds.delete(oid);
    if (_STATE.pendingOrderId === oid) _STATE.pendingOrderId = null;
    _STATE.inTrade = false;
  }

  // ── Strategy check (called after each candle close or on demand) ──────────
  function checkStrategy(asset) {
    if (!_STATE.autoEnabled) return;
    if (_STATE.inTrade) return;
    if (!SessionGuard.canTrade()) return;

    const candles = candleBuffers.get(asset);
    if (!candles || candles.length < CFG.MIN_CANDLES_REQUIRED) return;

    const dir = _PS.direction;
    const conf = _PS.spConf;
    if (dir === 'NEUTRAL') return;
    if (conf < CFG.SUPREME_AUTO_CONF) return;

    // Regime block
    if (_PS.regimeBlocked[_PS.regime]) { addLog('Regime blocked: ' + _PS.regime); return; }

    // Pattern confluence check
    const patterns = PSM.update(candles);
    const conf2 = PSM.confluence(patterns, asset);
    if (!conf2) return;
    if (conf2.conf < CFG.MIN_CONFLUENCE_CONF) return;
    // Direction must agree
    if (conf2.dir !== dir) return;

    // Store pattern names for PPT
    _STATE.lastPatternNames = (patterns || []).map(p => p.name);

    // Compute amount
    const amount = computeKellyAmount(dir);

    addLog('SIGNAL ' + dir + ' conf=' + conf.toFixed(1) + ' amount=' + amount.toFixed(2));
    schedulePredictiveEntry(asset, dir, amount);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §26  PREDICTION SCHEDULER + EXECUTION TIMING
  // ═══════════════════════════════════════════════════════════════════════════

  function getSmartEarlyMs() {
    // ETC-calibrated pre-fire offset + jitter
    const base = _etcEffectiveDelay();
    const jitter = (Math.random() - 0.5) * CFG.EXEC_JITTER_MS * 2;
    return Math.max(50, base + jitter);
  }

  function _executeWithJitter(fn, delayMs) {
    const jMs = delayMs + (Math.random() * CFG.EXEC_JITTER_MS * 2 - CFG.EXEC_JITTER_MS);
    return setTimeout(fn, Math.max(10, jMs));
  }

  let _scheduledTid = null;
  let _scheduledEntry = null;

  function cancelPredictiveExecution() {
    if (_scheduledTid) { clearTimeout(_scheduledTid); _scheduledTid = null; }
    _scheduledEntry = null;
  }

  function scheduleExactExecution(asset, dir, amount, targetTs) {
    cancelPredictiveExecution();
    const now = Date.now();
    const earlyMs = getSmartEarlyMs();
    const fireAt = targetTs - earlyMs;
    const delay = fireAt - now;

    if (delay < 0) {
      // Already past target — fire immediately if within tolerance
      if (now - targetTs < CFG.EXEC_LATE_TOLERANCE_MS) {
        executeTrade(asset, dir, amount);
      } else {
        addLog('EXEC: target expired by ' + (now - targetTs) + 'ms — skip');
      }
      return;
    }

    _scheduledEntry = { asset, dir, amount, targetTs };
    addLog('SCHED: ' + dir + ' in ' + delay.toFixed(0) + 'ms (earlyBy=' + earlyMs.toFixed(0) + 'ms)');

    _scheduledTid = setTimeout(() => {
      _scheduledTid = null;
      if (!_scheduledEntry) return;
      const e = _scheduledEntry;
      _scheduledEntry = null;
      if (!_STATE.autoEnabled || _STATE.inTrade || !SessionGuard.canTrade()) return;
      executeTrade(e.asset, e.dir, e.amount);
    }, delay);
  }

  function schedulePredictiveEntry(asset, dir, amount) {
    const tf = _STATE.activeTimeframe || CFG.DEFAULT_TIMEFRAME;
    const tb = tickBuffers.get(asset);
    if (!tb || !tb.length) return;
    const lastTs = tb[tb.length-1].ts || Date.now();
    const snap = snapToPOTime(lastTs, tf);
    // Target = next candle open (= current candle close)
    const targetTs = snap.close;
    scheduleExactExecution(asset, dir, amount, targetTs);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §27  EXECUTION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  async function executeTrade(asset, dir, amount) {
    if (_STATE.inTrade) { addLog('EXEC: already in trade'); return; }
    if (!SessionGuard.canTrade()) { addLog('EXEC: session guard blocked'); return; }
    if (!_STATE.autoEnabled) return;
    if (!asset || !dir || !isFinite(amount) || amount < CFG.MIN_BET) {
      addLog('EXEC: invalid params'); return;
    }

    const safeAmt = _safeAmount(amount);
    addLog('EXEC: ' + dir + ' $' + safeAmt.toFixed(2) + ' on ' + asset);

    // IMDB: simultaneous multi-trade
    if (CFG.IMDB_ENABLED && _STATE.imdbActive) {
      await _imdbExecute(asset, dir, safeAmt);
      return;
    }

    _STATE.inTrade = true;
    _STATE.lastTradeTs = Date.now();

    const success = await clickTradeButton(dir, safeAmt);
    if (!success) {
      _STATE.inTrade = false;
      addLog('EXEC: click failed');
    } else {
      _etcRecordClick(asset);
      TELEMETRY.recordPrediction(dir, _PS.spConf);
    }
  }

  async function clickTradeButton(dir, amount) {
    // Set amount
    const amountSet = await _setAmount(amount);
    if (!amountSet) addLog('WARN: amount set failed');

    // Click direction button
    const btnSels = dir === 'BUY'
      ? CFG.BTN_BUY_SELECTORS
      : CFG.BTN_SELL_SELECTORS;

    for (const sel of btnSels) {
      try {
        const btn = W.document.querySelector(sel);
        if (!btn || btn.disabled) continue;
        btn.click();
        addLog('Clicked: ' + sel);
        return true;
      } catch(_) {}
    }

    // Fallback: XPath for button text
    const labels = dir === 'BUY' ? ['Higher','Call','UP','BUY','▲'] : ['Lower','Put','DOWN','SELL','▼'];
    for (const lbl of labels) {
      try {
        const xpath = `//button[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'${lbl.toUpperCase()}')]`;
        const res = W.document.evaluate(xpath, W.document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const btn = res.singleNodeValue;
        if (btn && !btn.disabled) { btn.click(); addLog('XPath click: ' + lbl); return true; }
      } catch(_) {}
    }

    addLog('EXEC: no button found for ' + dir);
    return false;
  }

  async function _setAmount(amount) {
    const sels = CFG.AMOUNT_INPUT_SELECTORS;
    for (const sel of sels) {
      try {
        const inp = W.document.querySelector(sel);
        if (!inp) continue;
        // Native value setter to bypass React controlled input
        const nativeSetter = Object.getOwnPropertyDescriptor(W.HTMLInputElement.prototype, 'value');
        if (nativeSetter && nativeSetter.set) {
          nativeSetter.set.call(inp, amount.toFixed(2));
        } else {
          inp.value = amount.toFixed(2);
        }
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      } catch(_) {}
    }
    return false;
  }

  async function _imdbExecute(asset, dir, baseAmount) {
    const tiers = CFG.IMDB_TIERS;
    _STATE.inTrade = true;
    addLog('IMDB: firing ' + tiers.length + ' tiers');

    for (let i = 0; i < tiers.length; i++) {
      const tierAmt = _safeAmount(baseAmount * tiers[i]);
      const success = await clickTradeButton(dir, tierAmt);
      if (!success) break;
      if (i < tiers.length - 1) await new Promise(r => setTimeout(r, CFG.IMDB_INTER_DELAY_MS));
    }
    _etcRecordClick(asset);
    TELEMETRY.recordPrediction(dir, _PS.spConf);
  }

  function _sendRawOrder(asset, dir, amount, tf) {
    // Direct WS order for environments where DOM click is unreliable
    const ws = _STATE.wsSocket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const reqId = _nextReqId();
    const payload = JSON.stringify([
      60,
      { id: reqId, asset_id: asset, direction: dir === 'BUY' ? 'call' : 'put',
        amount: amount, time: tf || _STATE.activeTimeframe || CFG.DEFAULT_TIMEFRAME,
        option_type: 'turbo' }
    ]);
    try { ws.send(payload); return true; } catch(e) { addLog('Raw order err: ' + e.message); return false; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §28  DYNAMIC SESSION PROTECTION
  // ═══════════════════════════════════════════════════════════════════════════
  const SessionGuard = (() => {
    let _hourlyPnl = 0;
    let _hourlyStart = Date.now();
    let _hourlyTrades = 0;
    let _blocked = false;
    let _blockReason = '';
    let _blockUntil = 0;

    function recordTrade(won, pnl) {
      _hourlyPnl += pnl;
      _hourlyTrades++;
      _check();
    }

    function _check() {
      const now = Date.now();
      // Reset hourly window
      if (now - _hourlyStart >= 3600000) {
        _hourlyPnl = 0;
        _hourlyTrades = 0;
        _hourlyStart = now;
        if (_blocked && _blockUntil <= now) {
          _blocked = false;
          _blockReason = '';
          addLog('Session guard: unblocked (hourly reset)');
        }
      }

      // Loss streak block
      if (STATS.streak <= -CFG.SESSION_LOSS_STREAK_BLOCK) {
        _blocked = true;
        _blockReason = 'Loss streak: ' + STATS.streak;
        _blockUntil = now + CFG.SESSION_BLOCK_COOLDOWN_MS;
        addLog('SESSION BLOCK: ' + _blockReason);
        EventBus.emit('session:blocked', _blockReason);
      }

      // Hourly loss limit
      if (_hourlyPnl < -CFG.SESSION_HOURLY_LOSS_LIMIT) {
        _blocked = true;
        _blockReason = 'Hourly loss: ' + _hourlyPnl.toFixed(2);
        _blockUntil = now + CFG.SESSION_BLOCK_COOLDOWN_MS;
        addLog('SESSION BLOCK: ' + _blockReason);
        EventBus.emit('session:blocked', _blockReason);
      }

      // Total daily drawdown
      if (STATS.todayPnl < -CFG.SESSION_MAX_DAILY_LOSS) {
        _blocked = true;
        _blockReason = 'Daily loss limit: ' + STATS.todayPnl.toFixed(2);
        _blockUntil = now + 86400000; // 24h
        addLog('SESSION BLOCK (24h): ' + _blockReason);
        EventBus.emit('session:blocked', _blockReason);
        _STATE.autoEnabled = false; // Hard stop
      }

      // Regime block
      if (_PS.regimeBlocked[_PS.regime]) {
        _blocked = true;
        _blockReason = 'Regime: ' + _PS.regime;
        _blockUntil = now + CFG.SESSION_REGIME_COOLDOWN_MS;
      }

      _refreshSessionUI();
    }

    function canTrade() {
      const now = Date.now();
      if (_blocked && now >= _blockUntil) {
        _blocked = false;
        _blockReason = '';
        addLog('Session guard: block expired');
      }
      return !_blocked;
    }

    function getStatus() {
      return { blocked: _blocked, reason: _blockReason, until: _blockUntil,
               hourlyPnl: _hourlyPnl, hourlyTrades: _hourlyTrades };
    }

    function reset() {
      _hourlyPnl = 0; _hourlyTrades = 0; _hourlyStart = Date.now();
      _blocked = false; _blockReason = ''; _blockUntil = 0;
    }

    return { recordTrade, canTrade, getStatus, reset };
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // §29  ADAPTIVE LEARNING + STATS PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  const STATS = {
    total: 0, wins: 0, streak: 0, pnl: 0, todayPnl: 0,
    peakBalance: 0, maxDrawdown: 0, dateStr: '',
  };

  function loadStats() {
    try {
      const raw = localStorage.getItem('v13_stats');
      if (!raw) return;
      const s = JSON.parse(raw);
      const today = new Date().toDateString();
      if (s.dateStr !== today) {
        // New day: reset daily stats
        STATS.todayPnl = 0;
        STATS.dateStr  = today;
      } else {
        Object.assign(STATS, s);
      }
    } catch(_) {}
  }

  function saveStats() {
    try {
      STATS.dateStr = new Date().toDateString();
      localStorage.setItem('v13_stats', JSON.stringify(STATS));
    } catch(_) {}
  }

  function _saveBrain() {
    try {
      RLEngine.save();
      // LSTM state is saved inside LSTMProxy on each learn()
      localStorage.setItem('v13_ps_weights', JSON.stringify(_PS.weights));
    } catch(_) {}
  }

  function _loadBrain() {
    try {
      RLEngine.load();
      const wraw = localStorage.getItem('v13_ps_weights');
      if (wraw) {
        const w = JSON.parse(wraw);
        if (w && typeof w === 'object') Object.assign(_PS.weights, w);
      }
    } catch(_) {}
  }

  function recordTrade(won, pnl) {
    STATS.total++;
    if (won) { STATS.wins++; STATS.streak = Math.max(0, STATS.streak) + 1; }
    else      { STATS.streak = Math.min(0, STATS.streak) - 1; }
    STATS.pnl += pnl;
    STATS.todayPnl += pnl;
    if (_STATE.balance > STATS.peakBalance) STATS.peakBalance = _STATE.balance;
    const dd = STATS.peakBalance - _STATE.balance;
    if (dd > STATS.maxDrawdown) STATS.maxDrawdown = dd;
    saveStats();
  }

  // Mini-backtest: replay last N candles to sanity-check signal quality
  function _miniBacktest(asset, n) {
    const buf = candleBuffers.get(asset);
    if (!buf || buf.length < n + 10) return null;
    const slice = buf.slice(-n - 10, -10);
    let wins = 0;
    for (let i = 1; i < slice.length; i++) {
      const sub = slice.slice(0, i).reverse();
      const patterns = PatternEngine.detect(sub);
      const cf = PSM.confluence(patterns, asset);
      if (!cf) continue;
      const nextCandle = slice[i];
      const won = cf.dir === 'BUY' ? nextCandle.close > nextCandle.open : nextCandle.close < nextCandle.open;
      if (won) wins++;
    }
    PSM.reset();
    const wr = wins / (slice.length - 1);
    addLog('Backtest ' + asset + ' ' + n + 'c WR=' + (wr*100).toFixed(1) + '%');
    return wr;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §30  DOM SELF-HEALING LAYER
  // ═══════════════════════════════════════════════════════════════════════════
  const DOMHealer = (() => {
    let _observer = null;
    let _rebindTimer = null;
    let _missCount = 0;
    const CRITICAL_IDS = ['pb-bar', 'v13-panel', 'v13-stats'];

    function _checkCritical() {
      let missing = 0;
      for (const id of CRITICAL_IDS) {
        if (!W.document.getElementById(id)) missing++;
      }
      if (missing > 0) {
        _missCount++;
        addLog('DOMHealer: ' + missing + ' critical elements missing (x' + _missCount + ')');
        if (_missCount >= 2) {
          addLog('DOMHealer: reinserting UI');
          _injectUI();
          _missCount = 0;
        }
      } else {
        _missCount = 0;
      }
    }

    function _rebindSelectors() {
      // Verify trade buttons are still queryable; log if not
      const testSels = [...CFG.BTN_BUY_SELECTORS, ...CFG.BTN_SELL_SELECTORS].slice(0, 4);
      let found = 0;
      for (const sel of testSels) {
        try { if (W.document.querySelector(sel)) found++; } catch(_) {}
      }
      if (!found) addLog('DOMHealer: no trade buttons found — may need selector update');
    }

    function start() {
      if (_observer) return;
      _observer = new MutationObserver(() => {
        clearTimeout(_rebindTimer);
        _rebindTimer = setTimeout(() => {
          _checkCritical();
          _rebindSelectors();
        }, 500);
      });
      _observer.observe(W.document.body, { childList: true, subtree: true });
      // Periodic hard check every 30s
      setInterval(_checkCritical, 30000);
      addLog('DOMHealer: started');
    }

    function stop() {
      if (_observer) { _observer.disconnect(); _observer = null; }
    }

    // Debug popup: show live state
    function showDebug() {
      let popup = W.document.getElementById('v13-debug');
      if (!popup) {
        popup = W.document.createElement('div');
        popup.id = 'v13-debug';
        popup.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;background:#111c;color:#0f0;font:11px monospace;padding:10px;border:1px solid #0f0;border-radius:6px;max-width:400px;max-height:60vh;overflow:auto;pointer-events:auto;';
        const close = W.document.createElement('span');
        close.textContent = '✕';
        close.style.cssText = 'float:right;cursor:pointer;color:#f00;';
        close.onclick = () => popup.remove();
        popup.appendChild(close);
        W.document.body.appendChild(popup);
      }
      const report = TELEMETRY.report();
      const sg = SessionGuard.getStatus();
      popup.innerHTML = `<span style="float:right;cursor:pointer;color:#f00;" onclick="this.parentElement.remove()">✕</span>
<b>V13 QUANTUM ENGINE DEBUG</b><br>
Ticks: ${report.ticks} | AvgLat: ${report.avgLatency}ms<br>
Pred accuracy: ${report.predAccuracy}%<br>
WS: ${_STATE.wsConnected ? 'ON' : 'OFF'} | InTrade: ${_STATE.inTrade}<br>
Balance: ${_STATE.balance.toFixed(2)}<br>
Stats: ${STATS.wins}/${STATS.total} (${STATS.total?Math.round(STATS.wins/STATS.total*100):0}%)<br>
Streak: ${STATS.streak} | PnL: ${STATS.pnl.toFixed(2)}<br>
Session: ${sg.blocked ? '🔴 '+sg.reason : '🟢 OK'}<br>
Regime: ${_PS.regime} | Hurst: ${(_PS.hurst_h||0).toFixed(3)}<br>
OBI: ${OBI.getScore(_STATE.activeAsset||'').toFixed(3)}<br>
LAD: ${JSON.stringify(LAD.getOpportunity())}<br>
LSTM: B=${LSTMProxy.getScore('BUY').toFixed(3)} S=${LSTMProxy.getScore('SELL').toFixed(3)}<br>
RL epsilon: ${(RLEngine._eps||0).toFixed(3)}<br>
Anomalies: ${JSON.stringify(report.anomalies)}`;
    }

    return { start, stop, showDebug };
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // §31  UI / HUD
  // ═══════════════════════════════════════════════════════════════════════════

  function _injectUI() {
    // Remove stale instances
    ['v13-panel','v13-pred-bar','v13-stats'].forEach(id => {
      const el = W.document.getElementById(id);
      if (el) el.remove();
    });

    const css = `
#v13-pred-bar{position:fixed;bottom:0;left:0;right:0;z-index:2147483646;background:linear-gradient(180deg,#0d1117 0%,#161b22 100%);border-top:1px solid rgba(0,210,100,.25);padding:8px 12px;display:flex;align-items:center;gap:10px;height:52px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:none;}
#pb-bar{flex:1;height:20px;background:#1a2030;border-radius:10px;overflow:hidden;position:relative;box-shadow:0 8px 32px rgba(0,0,0,.8);}
#pb-fill{height:100%;width:50%;transition:width .3s ease,background .3s ease;border-radius:10px;}
#pb-arrow-up{position:absolute;left:50%;transform:translateX(-50%);top:-18px;font-size:14px;transition:all .2s;}
#pb-arrow-dn{position:absolute;left:50%;transform:translateX(-50%);top:20px;font-size:14px;transition:all .2s;}
.pba-fire{animation:pbFire .4s infinite alternate;color:#ff0;}
.pba-soft{opacity:.6;}
@keyframes pbFire{from{opacity:.6}to{opacity:1;text-shadow:0 0 8px #ff0;}}
#pb-direction{font-size:15px;font-weight:700;min-width:80px;text-align:center;}
#pb-buy-pct{color:rgba(0,210,100,.8);font-size:12px;min-width:36px;text-align:center;}
#pb-sell-pct{color:rgba(255,55,85,.8);font-size:12px;min-width:36px;text-align:center;}
#pb-conf-wrap{display:flex;flex-direction:column;gap:2px;min-width:90px;}
#pb-conf-bar{height:4px;border-radius:2px;transition:width .3s,background .3s;background:#888;}
#pb-conf-text{font-size:10px;color:#888;}
#pb-regime{font-size:10px;color:#555;min-width:90px;}
#pb-agree{font-size:10px;color:#555;}
#pb-blocked{font-size:11px;color:#ff3755;display:none;font-weight:700;}
#pb-signal{font-size:11px;color:#888;}

#v13-panel{position:fixed;top:70px;right:14px;z-index:2147483645;width:280px;background:linear-gradient(145deg,#0d1117,#161b22);border:1px solid rgba(0,210,100,.2);border-radius:12px;padding:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#c9d1d9;box-shadow:0 16px 48px rgba(0,0,0,.7);pointer-events:auto;}
#v13-panel h3{margin:0 0 8px;font-size:13px;color:#58a6ff;letter-spacing:.5px;}
.v13-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04);}
.v13-row:last-child{border:none;}
.v13-label{color:#8b949e;font-size:11px;}
.v13-val{font-size:11px;font-weight:600;}
.v13-toggle{display:flex;align-items:center;gap:6px;cursor:pointer;}
.v13-switch{width:32px;height:16px;background:#333;border-radius:8px;position:relative;transition:background .2s;}
.v13-switch.on{background:#00d264;}
.v13-switch::after{content:'';position:absolute;width:12px;height:12px;background:#fff;border-radius:50%;top:2px;left:2px;transition:left .2s;}
.v13-switch.on::after{left:18px;}
.v13-sep{height:1px;background:rgba(255,255,255,.06);margin:6px 0;}
.v13-btn{background:linear-gradient(135deg,#21262d,#30363d);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#c9d1d9;font-size:11px;padding:4px 8px;cursor:pointer;transition:all .15s;}
.v13-btn:hover{background:linear-gradient(135deg,#30363d,#3d444d);border-color:rgba(0,210,100,.4);}
.v13-btn.danger{border-color:rgba(255,55,85,.4);}
.v13-btn.danger:hover{background:linear-gradient(135deg,#3d1a1e,#4d2226);}
#v13-stats{font-size:11px;color:#8b949e;padding:4px 0;}
.stat-win{color:#00d264;} .stat-lose{color:#ff3755;} .stat-neutral{color:#ffb020;}
#v13-log{height:60px;overflow:auto;background:#0d1117;border-radius:6px;padding:4px 6px;font-size:9px;color:#444;font-family:monospace;margin-top:6px;}
#v13-log div{padding:1px 0;border-bottom:1px solid rgba(255,255,255,.03);}
.v13-amount-row{display:flex;align-items:center;gap:6px;padding:4px 0;}
.v13-amount-row input{width:70px;background:#0d1117;border:1px solid rgba(255,255,255,.15);border-radius:4px;color:#c9d1d9;font-size:11px;padding:2px 5px;text-align:right;}
#v13-drag-handle{cursor:move;padding:4px 0 8px;text-align:center;color:#30363d;font-size:14px;user-select:none;}
`;

    const styleEl = W.document.createElement('style');
    styleEl.id = 'v13-styles';
    styleEl.textContent = css;
    W.document.head.appendChild(styleEl);

    // ── Prediction bar ────────────────────────────────────────────────────
    const predBar = W.document.createElement('div');
    predBar.id = 'v13-pred-bar';
    predBar.innerHTML = `
<div id="pb-buy-pct">50%</div>
<div id="pb-bar">
  <div id="pb-fill" style="width:50%"></div>
  <span id="pb-arrow-up"></span>
  <span id="pb-arrow-dn"></span>
</div>
<div id="pb-sell-pct">50%</div>
<div id="pb-direction" style="color:#888">◆ WAIT</div>
<div id="pb-conf-wrap">
  <div id="pb-conf-bar" style="width:0%"></div>
  <span id="pb-conf-text">0%</span>
</div>
<div id="pb-regime">– | WR: –%</div>
<div id="pb-agree">algos: 0/0</div>
<div id="pb-blocked"></div>
<div id="pb-signal"></div>
`;
    W.document.body.appendChild(predBar);

    // ── Control panel ─────────────────────────────────────────────────────
    const panel = W.document.createElement('div');
    panel.id = 'v13-panel';
    panel.innerHTML = `
<div id="v13-drag-handle">⠿⠿⠿</div>
<h3>⚡ V13 QUANTUM ENGINE</h3>
<div class="v13-row">
  <span class="v13-label">Auto-Trade</span>
  <div class="v13-toggle" id="v13-auto-toggle">
    <div class="v13-switch" id="v13-auto-sw"></div>
    <span id="v13-auto-lbl" style="font-size:11px;color:#ff3755">OFF</span>
  </div>
</div>
<div class="v13-amount-row">
  <span class="v13-label">Amount $</span>
  <input type="number" id="v13-amount" min="1" step="1" value="${CFG.BET_AMOUNT}">
  <button class="v13-btn" id="v13-apply-amt">Apply</button>
</div>
<div class="v13-row">
  <span class="v13-label">IMDB Tiers</span>
  <div class="v13-toggle" id="v13-imdb-toggle">
    <div class="v13-switch" id="v13-imdb-sw"></div>
    <span id="v13-imdb-lbl" style="font-size:11px;color:#ff3755">OFF</span>
  </div>
</div>
<div class="v13-row">
  <span class="v13-label">Min Confidence</span>
  <span class="v13-val" id="v13-conf-val">${CFG.SUPREME_AUTO_CONF}%</span>
</div>
<div class="v13-sep"></div>
<div id="v13-stats">
  <div class="v13-row"><span class="v13-label">Trades</span><span id="st-total" class="v13-val">0</span></div>
  <div class="v13-row"><span class="v13-label">Win Rate</span><span id="st-wr" class="v13-val stat-neutral">–%</span></div>
  <div class="v13-row"><span class="v13-label">Streak</span><span id="st-streak" class="v13-val">0</span></div>
  <div class="v13-row"><span class="v13-label">PnL Today</span><span id="st-pnl" class="v13-val">$0.00</span></div>
  <div class="v13-row"><span class="v13-label">Balance</span><span id="st-bal" class="v13-val">–</span></div>
  <div class="v13-row"><span class="v13-label">Session</span><span id="st-session" class="v13-val stat-win">OK</span></div>
</div>
<div class="v13-sep"></div>
<div style="display:flex;gap:4px;flex-wrap:wrap;">
  <button class="v13-btn" id="v13-reset-stats">Reset Stats</button>
  <button class="v13-btn" id="v13-backtest">Backtest</button>
  <button class="v13-btn" id="v13-debug">Debug</button>
  <button class="v13-btn danger" id="v13-hide">Hide</button>
</div>
<div id="v13-log"></div>
`;
    W.document.body.appendChild(panel);

    // ── Wire interactions ────────────────────────────────────────────────
    _wireUI();
    _makeDraggable(panel, W.document.getElementById('v13-drag-handle'));
  }

  function _wireUI() {
    // Auto toggle
    const autoToggle = W.document.getElementById('v13-auto-toggle');
    if (autoToggle) {
      autoToggle.addEventListener('click', () => {
        _STATE.autoEnabled = !_STATE.autoEnabled;
        _updateAutoToggleUI();
        addLog('Auto: ' + (_STATE.autoEnabled ? 'ON' : 'OFF'));
        if (!_STATE.autoEnabled) cancelPredictiveExecution();
      });
    }

    // IMDB toggle
    const imdbToggle = W.document.getElementById('v13-imdb-toggle');
    if (imdbToggle) {
      imdbToggle.addEventListener('click', () => {
        _STATE.imdbActive = !_STATE.imdbActive;
        const sw = W.document.getElementById('v13-imdb-sw');
        const lbl = W.document.getElementById('v13-imdb-lbl');
        if (sw)  sw.className  = 'v13-switch' + (_STATE.imdbActive ? ' on' : '');
        if (lbl) { lbl.textContent = _STATE.imdbActive ? 'ON' : 'OFF'; lbl.style.color = _STATE.imdbActive ? '#00d264' : '#ff3755'; }
      });
    }

    // Amount apply
    const applyBtn = W.document.getElementById('v13-apply-amt');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const inp = W.document.getElementById('v13-amount');
        if (inp) {
          const v = parseFloat(inp.value);
          if (isFinite(v) && v >= CFG.MIN_BET) { CFG.BET_AMOUNT = v; addLog('Amount set: $' + v); }
        }
      });
    }

    // Reset stats
    const resetBtn = W.document.getElementById('v13-reset-stats');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        STATS.total = STATS.wins = 0; STATS.streak = 0; STATS.pnl = 0; STATS.todayPnl = 0;
        saveStats();
        PPT.reset();
        SessionGuard.reset();
        _refreshStatsUI();
        addLog('Stats reset');
      });
    }

    // Backtest
    const btBtn = W.document.getElementById('v13-backtest');
    if (btBtn) {
      btBtn.addEventListener('click', () => {
        const asset = normalizeAsset(_STATE.activeAsset || '');
        if (asset) _miniBacktest(asset, 50);
        else addLog('No active asset for backtest');
      });
    }

    // Debug
    const dbgBtn = W.document.getElementById('v13-debug');
    if (dbgBtn) dbgBtn.addEventListener('click', () => DOMHealer.showDebug());

    // Hide
    const hideBtn = W.document.getElementById('v13-hide');
    if (hideBtn) {
      hideBtn.addEventListener('click', () => {
        const panel = W.document.getElementById('v13-panel');
        if (panel) { panel.style.display = 'none'; _STATE.panelHidden = true; _addShowButton(); }
      });
    }
  }

  function _addShowButton() {
    if (W.document.getElementById('v13-show-btn')) return;
    const btn = W.document.createElement('button');
    btn.id = 'v13-show-btn';
    btn.textContent = '⚡';
    btn.style.cssText = 'position:fixed;top:70px;right:14px;z-index:2147483645;width:32px;height:32px;background:#0d1117;border:1px solid rgba(0,210,100,.3);border-radius:50%;color:#00d264;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    btn.onclick = () => {
      const panel = W.document.getElementById('v13-panel');
      if (panel) { panel.style.display = ''; _STATE.panelHidden = false; }
      btn.remove();
    };
    W.document.body.appendChild(btn);
  }

  function _updateAutoToggleUI() {
    const sw  = W.document.getElementById('v13-auto-sw');
    const lbl = W.document.getElementById('v13-auto-lbl');
    if (sw)  sw.className  = 'v13-switch' + (_STATE.autoEnabled ? ' on' : '');
    if (lbl) { lbl.textContent = _STATE.autoEnabled ? 'ON' : 'OFF'; lbl.style.color = _STATE.autoEnabled ? '#00d264' : '#ff3755'; }
  }

  function _refreshStatsUI() {
    try {
      const wr = STATS.total > 0 ? Math.round(STATS.wins / STATS.total * 100) : 0;
      const set = (id, val, cls) => {
        const el = W.document.getElementById(id);
        if (!el) return;
        el.textContent = val;
        if (cls) el.className = 'v13-val ' + cls;
      };
      set('st-total', STATS.total);
      set('st-wr', wr + '%', wr >= 60 ? 'stat-win' : wr >= 50 ? 'stat-neutral' : 'stat-lose');
      set('st-streak', STATS.streak >= 0 ? '+' + STATS.streak : String(STATS.streak),
          STATS.streak > 0 ? 'stat-win' : STATS.streak < 0 ? 'stat-lose' : 'stat-neutral');
      set('st-pnl', (STATS.todayPnl >= 0 ? '+$' : '-$') + Math.abs(STATS.todayPnl).toFixed(2),
          STATS.todayPnl >= 0 ? 'stat-win' : 'stat-lose');
      set('st-bal', _STATE.balance > 0 ? '$' + _STATE.balance.toFixed(2) : '–');
      const sg = SessionGuard.getStatus();
      set('st-session', sg.blocked ? '⛔ ' + sg.reason.substring(0,18) : '✓ OK',
          sg.blocked ? 'stat-lose' : 'stat-win');
    } catch(_) {}
  }

  function _refreshSessionUI() {
    _refreshStatsUI();
    const sg = SessionGuard.getStatus();
    const blkEl = W.document.getElementById('pb-blocked');
    if (blkEl) {
      blkEl.style.display = sg.blocked ? 'block' : 'none';
      if (sg.blocked) blkEl.textContent = '⛔ ' + sg.reason.substring(0,30);
    }
  }

  function _makeDraggable(el, handle) {
    if (!handle || !el) return;
    let ox=0, oy=0, mx=0, my=0;
    handle.onmousedown = (e) => {
      e.preventDefault();
      mx = e.clientX; my = e.clientY;
      W.document.onmousemove = drag;
      W.document.onmouseup = () => { W.document.onmousemove = null; W.document.onmouseup = null; };
    };
    function drag(e) {
      ox = mx - e.clientX; oy = my - e.clientY;
      mx = e.clientX; my = e.clientY;
      el.style.top  = (el.offsetTop  - oy) + 'px';
      el.style.right = 'auto';
      el.style.left = (el.offsetLeft - ox) + 'px';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §32  SELF-HEALING RUNTIME RECOVERY
  // ═══════════════════════════════════════════════════════════════════════════

  function _startHeartbeat() {
    // Every 10s: verify state consistency
    setInterval(() => {
      const now = Date.now();

      // If a trade was marked open for > 5 min, assume it closed silently
      if (_STATE.inTrade && _STATE.lastTradeTs && (now - _STATE.lastTradeTs) > 300000) {
        addLog('Heartbeat: stale inTrade reset');
        _STATE.inTrade = false;
        TELEMETRY.recordAnomaly('stale_trade');
      }

      // If WS has been disconnected > 30s, log anomaly
      if (!_STATE.wsConnected && (now - (_STATE.wsDisconnectTs || now)) > 30000) {
        TELEMETRY.recordAnomaly('ws_disconnected');
        addLog('Heartbeat: WS disconnected');
      }

      // Refresh stats UI
      _refreshStatsUI();
    }, 10000);
  }

  EventBus.on('ws:close', () => { _STATE.wsDisconnectTs = Date.now(); });

  // ═══════════════════════════════════════════════════════════════════════════
  // §33  INIT + BOOTSTRAP
  // ═══════════════════════════════════════════════════════════════════════════

  function _init() {
    addLog('V13 QUANTUM ENGINE init...');

    // Load persistent state
    loadStats();
    _loadBrain();

    // Install WebSocket proxy (must happen before page creates any WS)
    _installWSProxy();

    // Inject UI
    _injectUI();
    _updateAutoToggleUI();

    // Start DOM self-healing observer
    DOMHealer.start();

    // Start heartbeat
    _startHeartbeat();

    // Listen for candle close events to trigger strategy
    EventBus.on('candle:close', ({ asset }) => {
      checkStrategy(asset);
    });

    // Listen for chafor load to run mini-backtest once
    EventBus.on('chafor:loaded', ({ asset, count }) => {
      if (count >= 60) {
        setTimeout(() => _miniBacktest(asset, 50), 500);
      }
    });

    // Listen for auth to request asset data
    EventBus.on('auth', () => {
      addLog('AUTH: requesting asset list');
      const ws = _STATE.wsSocket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify([14])); } catch(_) {}
      }
    });

    // Try to detect active asset from URL / page DOM
    try {
      const urlMatch = W.location.href.match(/asset[_=]([A-Z]{3,6}\/[A-Z]{3,6})/i);
      if (urlMatch) onActiveAsset(urlMatch[1]);
    } catch(_) {}

    // Detect timeframe from page if possible
    try {
      const tfEl = W.document.querySelector('[data-timeframe],[data-tf]');
      if (tfEl) {
        const tf = parseInt(tfEl.dataset.timeframe || tfEl.dataset.tf);
        if (tf > 0) onPlatformTimeframe(tf);
      }
    } catch(_) {}

    // Periodic UI log flush
    setInterval(() => {
      const logEl = W.document.getElementById('v13-log');
      if (!logEl) return;
      const recent = _logBuf.slice(-20);
      logEl.innerHTML = recent.map(l => `<div>${l}</div>`).join('');
      logEl.scrollTop = logEl.scrollHeight;
    }, 1000);

    // Periodic stats UI refresh
    setInterval(_refreshStatsUI, 5000);

    addLog('V13 ready. ' + CFG.VERSION);
    EventBus.emit('v13:ready');
  }

  // ── Deferred boot: wait for DOM ready ────────────────────────────────────
  if (W.document.readyState === 'loading') {
    W.document.addEventListener('DOMContentLoaded', _init);
  } else {
    // Already loaded — defer one tick so the page's own WS setup fires first
    setTimeout(_init, 0);
  }

})(); // end IIFE
