#!/usr/bin/env python3
"""
Build V13 Quantum Engine from V12 base:
  1. Copy V12
  2. Remove AI-Direct system
  3. Update header/version
  4. Inject 10 new engine blocks
  5. Wire hooks into existing functions
"""
import re, sys

SRC = '/home/user/scan/candle_V12_SUPREME_HYBRID.js'
DST = '/home/user/scan/candle_V13_QUANTUM_ENGINE.js'

with open(SRC, 'r', encoding='utf-8') as f:
    src = f.read()

# ─────────────────────────────────────────────────────────────────────────────
# 1. HEADER — update name / version
# ─────────────────────────────────────────────────────────────────────────────
src = src.replace(
    '// @name         ⚡ V12_SUPREME_HYBRID — بدون حراس + معايرة التوقيت التلقائية (ETC)',
    '// @name         ⚡ V13_QUANTUM_ENGINE — Ultra-Low-Latency Adaptive Prediction Engine'
)
src = src.replace(
    '// @namespace    candle-pro-strategy-v12-supreme-hybrid',
    '// @namespace    candle-pro-strategy-v13-quantum-engine'
)
src = src.replace(
    '// @version      12.16.1-hybrid',
    '// @version      13.0.0'
)
src = src.replace(
    '// @description  HYBRID: لا حراس، لا وقف خسائر — يُعوّض بمعايرة التوقيت التلقائية (ETC)',
    '// @description  QUANTUM: OBI + LAD + LSTM Proxy + RL Weights + Fractional Kelly + Anti-Martingale + Session Protection + WebWorker + CRC32 + DOM Self-Healing'
)
src = src.replace(
    '  if (W.__CANDLE_BOT_V12_SUPREME) return;\n  W.__CANDLE_BOT_V12_SUPREME = true;',
    '  if (W.__CANDLE_BOT_V13_QUANTUM) return;\n  W.__CANDLE_BOT_V13_QUANTUM = true;'
)

# ─────────────────────────────────────────────────────────────────────────────
# 2. REMOVE AI_DIRECT_* config block
# ─────────────────────────────────────────────────────────────────────────────
src = re.sub(
    r"\n    // ─── 🆕 v12\.8 \[AI-DIRECT\].*?AI_DIRECT_MIN_PAYOUT\s*:\s*[\d.]+,\s*// [^\n]+\n",
    '\n',
    src, flags=re.DOTALL
)

# ─────────────────────────────────────────────────────────────────────────────
# 3. REMOVE AI-Direct state variables (3 const lines + 2 let lines)
# ─────────────────────────────────────────────────────────────────────────────
src = re.sub(
    r"\n  const _aiSignalLog\s+=\s+\[\];[^\n]*\n"
    r"  const _aiPendingChecks\s+=\s+\[\];[^\n]*\n"
    r"  let\s+_aiLogStats\s+=[^;]+;\s*// [^\n]+\n",
    '\n',
    src, flags=re.DOTALL
)
src = re.sub(
    r"\n  // ── v12\.8 \[AI-DIRECT\] Direct trader state[^\n]*\n"
    r"  let _aiDirectLastTradeMs[^\n]+\n"
    r"  let\s+_aiDirectStats\s+=[^\n]+\n",
    '\n',
    src, flags=re.DOTALL
)

# ─────────────────────────────────────────────────────────────────────────────
# 4. REMOVE uid:3 dispatch block in handleChatMessage
# ─────────────────────────────────────────────────────────────────────────────
src = re.sub(
    r"              // v12\.8 \[AI-DIRECT\] uid:3 \+ structured signal.*?_executeAISignalTrade\(aiDir, rawSym, tfSecs, structSig\.price\);\n              \}\n",
    '',
    src, flags=re.DOTALL
)

# ─────────────────────────────────────────────────────────────────────────────
# 5. REMOVE AI-Direct row from HUD_HTML
# ─────────────────────────────────────────────────────────────────────────────
src = re.sub(
    r"\n      <div class=\"cb-auto-row\" id=\"cbAIDirectRow\">\s*"
    r"<span class=\"cb-auto-lbl\">🤖 AI مباشر \(uid:3 إشارات\)</span>\s*"
    r"<input[^>]*id=\"cbAIDirectToggle\"[^>]*>\s*"
    r"<span[^>]*id=\"cbAIDirectBadge\"[^>]*>OFF</span>\s*"
    r"</div>",
    '',
    src, flags=re.DOTALL
)

# ─────────────────────────────────────────────────────────────────────────────
# 6. UPDATE status bar
# ─────────────────────────────────────────────────────────────────────────────
src = src.replace(
    '<div id="cbStatus">v12.8 | AI-Direct: uid:3→تداول مباشر | IMDB: 70%→×2 | 85%→×3 | 94%→×4</div>',
    '<div id="cbStatus">v13.0 | OBI+LAD+LSTM+RL | IMDB: 70%→×2 | 85%→×3 | 94%→×4</div>'
)

# ─────────────────────────────────────────────────────────────────────────────
# 7. REMOVE AI-Direct toggle wiring in initUI()
# ─────────────────────────────────────────────────────────────────────────────
src = re.sub(
    r"\n    // v12\.8: AI-Direct toggle\n    const aiDToggle.*?addLog\(CFG\.AI_DIRECT_ENABLED.*?\);\n      \}\n    \}",
    '',
    src, flags=re.DOTALL
)

# ─────────────────────────────────────────────────────────────────────────────
# 8. REMOVE _executeAISignalTrade function (lines 7272-7396)
# ─────────────────────────────────────────────────────────────────────────────
src = re.sub(
    r"\n  // ── v12\.8 \[AI-DIRECT\] Execute a trade directly from uid:3 structured signal ──.*?^  \}\n",
    '\n',
    src, flags=re.DOTALL | re.MULTILINE
)

# ─────────────────────────────────────────────────────────────────────────────
# 9. UPDATE _aiLogStats references in SPY panel display (safe no-op removal)
# ─────────────────────────────────────────────────────────────────────────────
src = re.sub(
    r"      const wr10 = \(_aiLogStats\.w10.*?wr60 \+ \'; \';[^\n]*\n",
    '      const wr10 = \'–\', wr30 = \'–\', wr60 = \'–\';\n',
    src, flags=re.DOTALL
)
# Remove _aiPendingChecks.push calls
src = re.sub(r"\n    _aiPendingChecks\.push\(check\);\n", '\n', src)
# Remove _aiLogStats win/loss counting
src = re.sub(
    r"\n    if \(secKey === 10\).*?const wins.*?_aiLogStats\.w60;\n",
    '\n',
    src, flags=re.DOTALL
)
# Remove AI-Direct stats increments in _executeAISignalTrade (already removed function, belt+suspenders)
src = re.sub(r"      _aiDirectStats\.(trades|wins|losses)\+\+;\n", '', src)

# ─────────────────────────────────────────────────────────────────────────────
# 10. UPDATE title in initUI
# ─────────────────────────────────────────────────────────────────────────────
src = src.replace(
    "titleEl.textContent = '⚡ V12.8 SUPREME' + (badges.length ? ' ' + badges.join('') : '');",
    "titleEl.textContent = '⚡ V13 QUANTUM' + (badges.length ? ' ' + badges.join('') : '');"
)

# ─────────────────────────────────────────────────────────────────────────────
# 11. UPDATE boot log message
# ─────────────────────────────────────────────────────────────────────────────
src = re.sub(
    r"addLog\('⚡ V12\.[^']+', 'signal'\);",
    "addLog('⚡ V13_QUANTUM_ENGINE | OBI+LAD+LSTM+RL+Kelly+Pyramid+Session+Worker+CRC+Heal | session:' + _SESSION_ID, 'signal');",
    src
)

# ─────────────────────────────────────────────────────────────────────────────
# 12. ADD new CFG keys for the 10 engines (appended to CFG before closing brace)
# ─────────────────────────────────────────────────────────────────────────────
NEW_CFG = """
    // ── V13: ORDER BOOK IMBALANCE ENGINE ──────────────────────────────────────
    OBI_ENABLED            : true,
    OBI_WINDOW             : 30,
    OBI_DECAY_ALPHA        : 0.94,
    OBI_STRONG_THRESHOLD   : 0.55,
    OBI_CONF_BOOST         : 4,       // % boost to spConf when OBI aligns

    // ── V13: LATENCY ARBITRAGE DETECTOR ──────────────────────────────────────
    LAD_ENABLED            : true,
    LAD_DESYNC_THRESHOLD_MS: 150,
    LAD_CONF_BOOST         : 3,       // % boost when desync detected

    // ── V13: ENHANCED FRACTIONAL KELLY MULTIPLIERS ───────────────────────────
    KELLY_REGIME_TREND     : 1.00,
    KELLY_REGIME_RANGE     : 0.80,
    KELLY_REGIME_VOLATILE  : 0.50,
    KELLY_STREAK_WIN_MIN   : 3,
    KELLY_STREAK_WIN_MULT  : 1.15,
    KELLY_STREAK_LOSS_MULT : 0.60,
    KELLY_VOL_HIGH_MULT    : 0.70,
    KELLY_VOL_EXPLOSIVE_MULT: 0.40,
    KELLY_RECENT_WR_WINDOW : 20,

    // ── V13: ANTI-MARTINGALE PYRAMIDING ──────────────────────────────────────
    PYRAMID_ENABLED        : true,
    PYRAMID_MIN_WIN_STREAK : 3,
    PYRAMID_SCALE_T2       : 1.50,
    PYRAMID_MIN_WIN_T3     : 5,
    PYRAMID_SCALE_T3       : 2.00,

    // ── V13: SESSION PROTECTION ───────────────────────────────────────────────
    SESSION_MAX_LOSS_STREAK: 4,
    SESSION_MAX_HOURLY_LOSSES: 6,
    SESSION_DRAWDOWN_LIMIT : 0.20,
    SESSION_PAUSE_MINUTES  : 15,

    // ── V13: LSTM PROXY ───────────────────────────────────────────────────────
    LSTM_ENABLED           : true,
    LSTM_SEQ_LEN           : 16,
    LSTM_HIDDEN            : 12,
    LSTM_LEARN_RATE        : 0.03,
    LSTM_CONF_BOOST        : 3,

    // ── V13: RL WEIGHT ENGINE ─────────────────────────────────────────────────
    RL_ENABLED             : true,
    RL_EPSILON             : 0.08,
    RL_GAMMA               : 0.92,
    RL_ALPHA               : 0.12,

    // ── V13: WEBWORKER ────────────────────────────────────────────────────────
    WORKER_ENABLED         : true,
    WORKER_TIMEOUT_MS      : 80,

    // ── V13: PACKET CRC ───────────────────────────────────────────────────────
    CRC_ENABLED            : true,

    // ── V13: DOM SELF-HEALING ─────────────────────────────────────────────────
    DOM_HEAL_ENABLED       : true,
"""
# Insert new CFG keys just before the closing `};` of CFG
src = src.replace(
    "    DB_TICK_ENABLED      : true,\n  };",
    "    DB_TICK_ENABLED      : true," + NEW_CFG + "  };"
)

# ─────────────────────────────────────────────────────────────────────────────
# 13. REPLACE computeKellyAmount body with enhanced fractional Kelly
# ─────────────────────────────────────────────────────────────────────────────
OLD_KELLY = """  function computeKellyAmount(balance) {
    if (!CFG.KELLY_ENABLED || !balance || balance <= 0) return CFG.DEFAULT_AMOUNT;
    const total = STATS.wins + STATS.losses;
    if (total < 10) return CFG.DEFAULT_AMOUNT;
    const wr = STATS.wins / total;
    const lr = STATS.losses / total;
    // v12.2 [PAYOUT] Per-asset payout (from updateAssets) > _dynamicPayout (from closed deals) > 0.85 fallback
    const liveP = (typeof getActiveAssetPayout === 'function') ? getActiveAssetPayout() : null;
    const avgWinLoss = (liveP !== null && liveP > 0) ? liveP
                     : (_dynamicPayout !== null && _dynamicPayout > 0) ? _dynamicPayout
                     : 0.85;
    const kellyFraction = wr - (lr / avgWinLoss);
    if (kellyFraction <= 0) return CFG.KELLY_MIN;
    const kellyAmount = balance * (kellyFraction * CFG.KELLY_FRACTION);
    const maxAmount   = balance * CFG.KELLY_MAX_PCT;
    const hardCap     = CFG.KELLY_MAX_USD > 0 ? CFG.KELLY_MAX_USD : 50;  // [FIX] never Infinity
    const result = Math.max(CFG.KELLY_MIN, Math.min(maxAmount, kellyAmount, hardCap));
    return Math.round(result * 100) / 100;
  }"""

NEW_KELLY = """  function computeKellyAmount(balance) {
    if (!CFG.KELLY_ENABLED || !balance || balance <= 0) return CFG.DEFAULT_AMOUNT;
    const total = STATS.wins + STATS.losses;
    if (total < 10) return CFG.DEFAULT_AMOUNT;
    const wr = STATS.wins / total;
    const lr = STATS.losses / total;
    // Payout
    const liveP = (typeof getActiveAssetPayout === 'function') ? getActiveAssetPayout() : null;
    const avgWinLoss = (liveP !== null && liveP > 0) ? liveP
                     : (_dynamicPayout !== null && _dynamicPayout > 0) ? _dynamicPayout
                     : 0.85;
    const kellyFraction = wr - (lr / avgWinLoss);
    if (kellyFraction <= 0) return CFG.KELLY_MIN;
    let kellyAmount = balance * (kellyFraction * CFG.KELLY_FRACTION);

    // V13: Regime multiplier
    const regime = (_PS && _PS.regime) ? _PS.regime : 'RANGE';
    const regimeMult = regime === 'TREND'    ? CFG.KELLY_REGIME_TREND
                     : regime === 'VOLATILE' ? CFG.KELLY_REGIME_VOLATILE
                     :                        CFG.KELLY_REGIME_RANGE;
    kellyAmount *= regimeMult;

    // V13: Win-streak boost / loss-streak reduction
    const streak = STATS.lossStreak > 0 ? -STATS.lossStreak : (STATS.winStreak || 0);
    if (streak >= CFG.KELLY_STREAK_WIN_MIN) kellyAmount *= CFG.KELLY_STREAK_WIN_MULT;
    else if (streak < 0)                    kellyAmount *= CFG.KELLY_STREAK_LOSS_MULT;

    // V13: Volatility reduction
    const vol = typeof _volatilityState !== 'undefined' ? _volatilityState : 'NORMAL';
    if      (vol === 'EXPLOSIVE') kellyAmount *= CFG.KELLY_VOL_EXPLOSIVE_MULT;
    else if (vol === 'SQUEEZE')   kellyAmount *= CFG.KELLY_VOL_HIGH_MULT;

    // V13: Recent WR multiplier (last 20 trades)
    const rWin = _recentResults.filter(r => r === 1).length;
    const rTot = _recentResults.length;
    if (rTot >= 10) {
      const rWR = rWin / rTot;
      if (rWR < 0.40)      kellyAmount *= 0.60;
      else if (rWR >= 0.65) kellyAmount *= 1.10;
    }

    const maxAmount = balance * CFG.KELLY_MAX_PCT;
    const hardCap   = CFG.KELLY_MAX_USD > 0 ? CFG.KELLY_MAX_USD : 50;
    const result = Math.max(CFG.KELLY_MIN, Math.min(maxAmount, kellyAmount, hardCap));
    return Math.round(result * 100) / 100;
  }"""

src = src.replace(OLD_KELLY, NEW_KELLY)

# ─────────────────────────────────────────────────────────────────────────────
# 14. ADD OBI hook in onTick — after tickBuffers[a].push(price)
# ─────────────────────────────────────────────────────────────────────────────
src = src.replace(
    "    tickBuffers[a].push(price);\n    if (tickBuffers[a].length > 600) tickBuffers[a].shift();",
    "    tickBuffers[a].push(price);\n    if (tickBuffers[a].length > 600) tickBuffers[a].shift();\n"
    "    // V13: OBI + LAD + LSTM tick hooks\n"
    "    if (CFG.OBI_ENABLED) OBIEngine.update(a, price);\n"
    "    if (CFG.LAD_ENABLED) LADEngine.recordTick(a, price, serverTs || Date.now());\n"
    "    if (CFG.LSTM_ENABLED) LSTMProxy.push(price);"
)

# ─────────────────────────────────────────────────────────────────────────────
# 15. ADD Session Protection guard at top of executeTrade (after sub-second bucket check)
# ─────────────────────────────────────────────────────────────────────────────
src = src.replace(
    "    // [HYBRID] حارس 0b/0c/1/2/4/H5 محذوفة — بدون فلاتر، ETC يتولى التعويض",
    "    // V13: Session Protection guard\n"
    "    if (!SessionGuard.canTrade()) {\n"
    "      addLog('⛔ [SESSION] محجوب: ' + SessionGuard.blockReason(), 'error'); return;\n"
    "    }\n\n"
    "    // [HYBRID] حارس 0b/0c/1/2/4/H5 محذوفة — بدون فلاتر، ETC يتولى التعويض"
)

# ─────────────────────────────────────────────────────────────────────────────
# 16. ADD Anti-Martingale Pyramid amount scaling in executeTrade
# ─────────────────────────────────────────────────────────────────────────────
src = src.replace(
    "    const a = asset || activeAsset;\n"
    "    if (!a) { addLog('❌ لا زوج نشط','error'); return; }",
    "    const a = asset || activeAsset;\n"
    "    if (!a) { addLog('❌ لا زوج نشط','error'); return; }\n\n"
    "    // V13: Anti-Martingale Pyramiding — scale amount by win-streak tier\n"
    "    if (CFG.PYRAMID_ENABLED && !overrideAmount && !_manualAmountOverride) {\n"
    "      const _pyrScaled = PyramidEngine.getAmount(tradeAmount);\n"
    "      if (_pyrScaled !== tradeAmount) {\n"
    "        overrideAmount = _pyrScaled;\n"
    "        addLog('[PYRAMID] T' + PyramidEngine.tier + ' ×' + PyramidEngine.scale().toFixed(2) + ' → $' + _pyrScaled.toFixed(2), 'info');\n"
    "      }\n"
    "    }"
)

# ─────────────────────────────────────────────────────────────────────────────
# 17. ADD OBI/LAD confidence boost to _predBarTick (SUPREME-PRED) if applicable
#     Hook into the spConf smoothing step — apply OBI/LAD boost
# ─────────────────────────────────────────────────────────────────────────────
src = src.replace(
    "    ps.spConf  = Math.max(0, Math.min(100, buyPct > 50\n"
    "      ? (buyPct - 50) * 2\n"
    "      : (50 - buyPct) * -2 + 100));",
    "    ps.spConf  = Math.max(0, Math.min(100, buyPct > 50\n"
    "      ? (buyPct - 50) * 2\n"
    "      : (50 - buyPct) * -2 + 100));\n"
    "    // V13: OBI/LAD/LSTM confidence boost\n"
    "    if (CFG.OBI_ENABLED) {\n"
    "      const obiScore = OBIEngine.getScore(asset);\n"
    "      const obiAligns = (ps.direction === 'BUY' && obiScore > CFG.OBI_STRONG_THRESHOLD) ||\n"
    "                        (ps.direction === 'SELL' && obiScore < -CFG.OBI_STRONG_THRESHOLD);\n"
    "      if (obiAligns) ps.spConf = Math.min(100, ps.spConf + CFG.OBI_CONF_BOOST);\n"
    "    }\n"
    "    if (CFG.LAD_ENABLED && LADEngine.hasDesync()) ps.spConf = Math.min(100, ps.spConf + CFG.LAD_CONF_BOOST);\n"
    "    if (CFG.LSTM_ENABLED) {\n"
    "      const lstmBias = LSTMProxy.getBias(ps.direction);\n"
    "      if (lstmBias > 0.6) ps.spConf = Math.min(100, ps.spConf + CFG.LSTM_CONF_BOOST);\n"
    "    }"
)

# ─────────────────────────────────────────────────────────────────────────────
# 18. ADD Pyramid + LSTM + RL + Session outcome hooks in processCloseOrder
# ─────────────────────────────────────────────────────────────────────────────
src = src.replace(
    "    _etcCalibrate(win); // [ETC] معايرة التوقيت بناءً على النتيجة",
    "    _etcCalibrate(win); // [ETC] معايرة التوقيت بناءً على النتيجة\n"
    "    // V13: outcome hooks\n"
    "    if (CFG.PYRAMID_ENABLED) PyramidEngine.onResult(win);\n"
    "    if (CFG.LSTM_ENABLED)    LSTMProxy.learn(win);\n"
    "    if (CFG.RL_ENABLED)      RLEngine.recordOutcome(win);\n"
    "    SessionGuard.recordTrade(win, deal.profit || 0);"
)

# ─────────────────────────────────────────────────────────────────────────────
# 19. ADD DOM Self-Healing start after initUI() in init()
# ─────────────────────────────────────────────────────────────────────────────
src = src.replace(
    "      initUI();\n"
    "      _startSignalWatcher();",
    "      initUI();\n"
    "      if (CFG.DOM_HEAL_ENABLED) DOMHealer.start();\n"
    "      if (CFG.RL_ENABLED) RLEngine.load();\n"
    "      _startSignalWatcher();"
)

# ─────────────────────────────────────────────────────────────────────────────
# 20. ADD CRC32 check in handleBinaryFrame (after the Blob read, before decode)
# ─────────────────────────────────────────────────────────────────────────────
src = src.replace(
    "  function handleBinaryFrame(rawData, urlStr, wsRef) {",
    "  function handleBinaryFrame(rawData, urlStr, wsRef) {\n"
    "    // V13: CRC32 duplicate detection\n"
    "    if (CFG.CRC_ENABLED && rawData instanceof ArrayBuffer) {\n"
    "      if (_crcRejectFrame(rawData)) return;\n"
    "    }"
)

# ─────────────────────────────────────────────────────────────────────────────
# 21. INSERT 10 new engine blocks before init()
# ─────────────────────────────────────────────────────────────────────────────
NEW_ENGINES = r"""
  // ════════════════════════════════════════════════════════════════════════════
  // V13 §A  CRC32 PACKET INTEGRITY
  // ════════════════════════════════════════════════════════════════════════════
  const _CRC32_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();
  function _crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = _CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const _crcSeen = new Map(); // crc → ts
  function _crcRejectFrame(ab) {
    try {
      const u8 = new Uint8Array(ab);
      const crc = _crc32(u8);
      const key = crc + '_' + u8.length;
      const now = Date.now();
      if (_crcSeen.has(key) && (now - _crcSeen.get(key)) < 100) return true; // duplicate
      _crcSeen.set(key, now);
      if (_crcSeen.size > 200) { const oldest = [..._crcSeen.keys()][0]; _crcSeen.delete(oldest); }
    } catch(_) {}
    return false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // V13 §B  ORDER BOOK IMBALANCE ENGINE (OBI)
  // ════════════════════════════════════════════════════════════════════════════
  const OBIEngine = (() => {
    const _prevPrice = new Map();
    const _ema       = new Map();
    const _ALPHA     = 1 - (typeof CFG !== 'undefined' ? CFG.OBI_DECAY_ALPHA : 0.94);
    function update(asset, price) {
      const prev = _prevPrice.get(asset);
      if (prev !== undefined) {
        const dir = price > prev ? 1 : price < prev ? -1 : 0;
        const cur = _ema.get(asset) || 0;
        _ema.set(asset, cur * (1 - _ALPHA) + dir * _ALPHA);
      }
      _prevPrice.set(asset, price);
    }
    function getScore(asset) { return _ema.get(asset) || 0; }
    return { update, getScore };
  })();

  // ════════════════════════════════════════════════════════════════════════════
  // V13 §C  LATENCY ARBITRAGE DETECTOR (LAD)
  // ════════════════════════════════════════════════════════════════════════════
  const LADEngine = (() => {
    let _lastDesync = 0;
    let _desyncActive = false;
    function recordTick(asset, price, serverTs) {
      const localTs = Date.now();
      const delta = Math.abs(localTs - serverTs);
      if (delta > CFG.LAD_DESYNC_THRESHOLD_MS) {
        _lastDesync = localTs;
        _desyncActive = true;
      } else if (_desyncActive && (localTs - _lastDesync) > 3000) {
        _desyncActive = false;
      }
    }
    function hasDesync() { return _desyncActive; }
    return { recordTick, hasDesync };
  })();

  // ════════════════════════════════════════════════════════════════════════════
  // V13 §D  ANTI-MARTINGALE PYRAMID ENGINE
  // ════════════════════════════════════════════════════════════════════════════
  const PyramidEngine = (() => {
    let _tier = 1;
    function onResult(won) {
      if (won) {
        const ws = STATS.winStreak || 0;
        if (ws >= CFG.PYRAMID_MIN_WIN_T3)      _tier = 3;
        else if (ws >= CFG.PYRAMID_MIN_WIN_STREAK) _tier = 2;
        else                                    _tier = 1;
      } else {
        _tier = 1;
      }
    }
    function scale() {
      return _tier === 3 ? CFG.PYRAMID_SCALE_T3
           : _tier === 2 ? CFG.PYRAMID_SCALE_T2
           :               1.0;
    }
    function getAmount(base) {
      const s = scale();
      if (s === 1.0) return base;
      const hardCap = CFG.KELLY_MAX_USD > 0 ? CFG.KELLY_MAX_USD : 50;
      return Math.min(Math.round(base * s * 100) / 100, hardCap);
    }
    return { onResult, scale, getAmount, get tier() { return _tier; } };
  })();

  // ════════════════════════════════════════════════════════════════════════════
  // V13 §E  DYNAMIC SESSION PROTECTION
  // ════════════════════════════════════════════════════════════════════════════
  const SessionGuard = (() => {
    let _blocked = false;
    let _reason  = '';
    let _until   = 0;
    let _hourlyLosses = 0;
    let _hourlyStart  = Date.now();
    let _sessionStartBal = null;

    function recordTrade(won, pnl) {
      const now = Date.now();
      if (now - _hourlyStart > 3600000) { _hourlyLosses = 0; _hourlyStart = now; }
      if (!won) _hourlyLosses++;
      if (_sessionStartBal === null && typeof accountBalance !== 'undefined' && accountBalance > 0) {
        _sessionStartBal = accountBalance;
      }
      _evaluate();
    }
    function _evaluate() {
      const now = Date.now();
      if (_blocked && now >= _until) { _blocked = false; _reason = ''; }
      if (_blocked) return;

      // Streak
      if ((STATS.lossStreak || 0) >= CFG.SESSION_MAX_LOSS_STREAK) {
        _block('سلسلة خسائر ' + STATS.lossStreak); return;
      }
      // Hourly
      if (_hourlyLosses >= CFG.SESSION_MAX_HOURLY_LOSSES) {
        _block('حد الساعة ' + _hourlyLosses + ' خسارة'); return;
      }
      // Drawdown
      if (_sessionStartBal && typeof accountBalance !== 'undefined' && accountBalance > 0) {
        const dd = (_sessionStartBal - accountBalance) / _sessionStartBal;
        if (dd >= CFG.SESSION_DRAWDOWN_LIMIT) {
          _block('حد الخسارة ' + Math.round(dd * 100) + '%'); return;
        }
      }
    }
    function _block(reason) {
      _blocked = true; _reason = reason;
      _until   = Date.now() + CFG.SESSION_PAUSE_MINUTES * 60000;
      addLog('⛔ [SESSION] وقف تلقائي: ' + reason + ' — استئناف بعد ' + CFG.SESSION_PAUSE_MINUTES + 'د', 'error');
    }
    function canTrade() {
      const now = Date.now();
      if (_blocked && now >= _until) { _blocked = false; _reason = ''; }
      return !_blocked;
    }
    function blockReason() { return _reason; }
    function reset() { _blocked = false; _reason = ''; _until = 0; _hourlyLosses = 0; _hourlyStart = Date.now(); }
    return { recordTrade, canTrade, blockReason, reset };
  })();

  // ════════════════════════════════════════════════════════════════════════════
  // V13 §F  LSTM PROXY ENGINE (GRU-approximation)
  // ════════════════════════════════════════════════════════════════════════════
  const LSTMProxy = (() => {
    const SEQ = CFG.LSTM_SEQ_LEN || 16;
    const H   = CFG.LSTM_HIDDEN   || 12;
    const LR  = CFG.LSTM_LEARN_RATE || 0.03;
    const _buf = new Float32Array(SEQ);
    let   _bufN = 0;
    let   _h    = new Float32Array(H);
    let   _lastOut = 0;
    // Xavier init
    function _xavier(rows, cols) {
      const s = Math.sqrt(2 / (rows + cols)), a = new Float32Array(rows * cols);
      for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * s;
      return a;
    }
    let _Wz = _xavier(H, H + 1), _Wr = _xavier(H, H + 1), _Wh = _xavier(H, H + 1);
    let _Wy = _xavier(1, H);
    // Persist
    const _LS_KEY = 'v13_lstm';
    function _save() {
      try {
        localStorage.setItem(_LS_KEY, JSON.stringify({
          Wz: Array.from(_Wz), Wr: Array.from(_Wr), Wh: Array.from(_Wh), Wy: Array.from(_Wy),
        }));
      } catch(_) {}
    }
    function _load() {
      try {
        const d = JSON.parse(localStorage.getItem(_LS_KEY) || 'null');
        if (!d) return;
        _Wz = new Float32Array(d.Wz); _Wr = new Float32Array(d.Wr);
        _Wh = new Float32Array(d.Wh); _Wy = new Float32Array(d.Wy);
      } catch(_) {}
    }
    _load();
    function _sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
    function _tanh(x)    { return Math.tanh(x); }
    // Single GRU step: input scalar + prev hidden → new hidden + output
    function _step(x) {
      const inp = new Float32Array(H + 1);
      for (let i = 0; i < H; i++) inp[i] = _h[i];
      inp[H] = x;
      const hz = new Float32Array(H), hr = new Float32Array(H), hh = new Float32Array(H);
      for (let i = 0; i < H; i++) {
        let sz = 0, sr = 0;
        for (let j = 0; j <= H; j++) { sz += _Wz[i * (H+1) + j] * inp[j]; sr += _Wr[i * (H+1) + j] * inp[j]; }
        hz[i] = _sigmoid(sz); hr[i] = _sigmoid(sr);
      }
      const inp2 = new Float32Array(H + 1);
      for (let i = 0; i < H; i++) inp2[i] = hr[i] * _h[i];
      inp2[H] = x;
      for (let i = 0; i < H; i++) {
        let sh = 0;
        for (let j = 0; j <= H; j++) sh += _Wh[i * (H+1) + j] * inp2[j];
        hh[i] = _tanh(sh);
        _h[i] = (1 - hz[i]) * _h[i] + hz[i] * hh[i];
      }
      let out = 0;
      for (let i = 0; i < H; i++) out += _Wy[i] * _h[i];
      return _sigmoid(out);
    }
    function push(price) {
      // Normalize price into buffer as delta
      if (_bufN > 0) {
        const prev = _buf[(_bufN - 1) % SEQ];
        const delta = (price - prev) / (Math.abs(prev) || 1);
        _buf[_bufN % SEQ] = delta;
        _bufN++;
        _lastOut = _step(delta);
      } else {
        _buf[0] = price; _bufN = 1;
      }
    }
    function getBias(direction) {
      // _lastOut > 0.5 → BUY bias, < 0.5 → SELL bias
      if (direction === 'BUY')  return _lastOut;
      if (direction === 'SELL') return 1 - _lastOut;
      return 0;
    }
    function learn(won) {
      // Nudge Wy toward correct output (won=BUY→1, lost=0)
      const target = won ? 1.0 : 0.0;
      const err = target - _lastOut;
      for (let i = 0; i < H; i++) _Wy[i] += LR * err * _h[i];
      _save();
    }
    function getScore() { return _lastOut; }
    return { push, getBias, learn, getScore };
  })();

  // ════════════════════════════════════════════════════════════════════════════
  // V13 §G  RL WEIGHT ENGINE (Q-learning, 256-state)
  // ════════════════════════════════════════════════════════════════════════════
  const RLEngine = (() => {
    const N_STATES  = 256; // 4^4: regime×WR×Hurst×vol
    const N_ACTIONS = 2;   // 0=keep, 1=boost
    const _Q  = new Float32Array(N_STATES * N_ACTIONS);
    const _LS = 'v13_rl';
    let _lastState  = 0;
    let _lastAction = 0;
    let _eps = CFG.RL_EPSILON || 0.08;
    function _getState() {
      const regime = (_PS && _PS.regime) ? _PS.regime : 'RANGE';
      const rIdx   = regime === 'TREND' ? 0 : regime === 'VOLATILE' ? 2 : 1;
      const tot    = STATS.wins + STATS.losses;
      const wr     = tot > 10 ? STATS.wins / tot : 0.5;
      const wrIdx  = wr > 0.6 ? 3 : wr > 0.5 ? 2 : wr > 0.4 ? 1 : 0;
      const h      = (_PS && _PS.hurst_h) ? _PS.hurst_h : 0.5;
      const hIdx   = h > 0.65 ? 3 : h > 0.55 ? 2 : h > 0.45 ? 1 : 0;
      const vol    = typeof _volatilityState !== 'undefined' ? _volatilityState : 'NORMAL';
      const vIdx   = vol === 'SQUEEZE' ? 0 : vol === 'EXPLOSIVE' ? 3 : vol === 'NORMAL' ? 1 : 2;
      return (rIdx * 64 + wrIdx * 16 + hIdx * 4 + vIdx) % N_STATES;
    }
    function selectAction() {
      _lastState = _getState();
      if (Math.random() < _eps) { _lastAction = Math.random() < 0.5 ? 0 : 1; }
      else {
        const qBase = _Q[_lastState * N_ACTIONS];
        _lastAction = _Q[_lastState * N_ACTIONS + 1] > qBase ? 1 : 0;
      }
      return _lastAction; // 1=apply confidence boost
    }
    function recordOutcome(won) {
      const reward = won ? 1 : -1;
      const nextS  = _getState();
      const maxQ   = Math.max(_Q[nextS * N_ACTIONS], _Q[nextS * N_ACTIONS + 1]);
      const idx    = _lastState * N_ACTIONS + _lastAction;
      _Q[idx] += (CFG.RL_ALPHA || 0.12) * (reward + (CFG.RL_GAMMA || 0.92) * maxQ - _Q[idx]);
      _eps = Math.max(0.01, _eps * 0.9995);
      save();
    }
    function save() {
      try { localStorage.setItem(_LS, JSON.stringify({ Q: Array.from(_Q), eps: _eps })); } catch(_) {}
    }
    function load() {
      try {
        const d = JSON.parse(localStorage.getItem(_LS) || 'null');
        if (!d) return;
        if (d.Q && d.Q.length === N_STATES * N_ACTIONS) for (let i = 0; i < d.Q.length; i++) _Q[i] = d.Q[i];
        if (d.eps) _eps = d.eps;
      } catch(_) {}
    }
    return { selectAction, recordOutcome, save, load };
  })();

  // ════════════════════════════════════════════════════════════════════════════
  // V13 §H  WEBWORKER (inline blob — Hurst + DFA + PermEnt + DFT)
  // ════════════════════════════════════════════════════════════════════════════
  const _WORKER_CODE = `
    self.onmessage = function(e) {
      const { id, type, data } = e.data;
      let result = null;
      try {
        if (type === 'hurst')    result = hurstRS(data);
        else if (type === 'dfa') result = dfaHurst(data);
        else if (type === 'pe')  result = permEntropy(data, 3);
        else if (type === 'dft') result = dftCycle(data);
      } catch(err) { result = null; }
      self.postMessage({ id, result });
    };
    function hurstRS(prices) {
      const n = prices.length; if (n < 8) return 0.5;
      const logR = [], logS = [];
      for (let sz = 4; sz <= n/2; sz = Math.round(sz * 1.5)) {
        const lags = Math.floor(n / sz);
        let rSum = 0, sSum = 0, cnt = 0;
        for (let k = 0; k < lags; k++) {
          const seg = prices.slice(k*sz, (k+1)*sz);
          const m = seg.reduce((a,b) => a+b, 0) / sz;
          const dev = seg.map((v,i) => seg.slice(0,i+1).reduce((a,b)=>a+b,0)/sz*(i+1) - m*(i+1));
          const R = Math.max(...dev) - Math.min(...dev);
          const S = Math.sqrt(seg.reduce((a,b)=>a+(b-m)**2,0)/sz);
          if (S > 0) { rSum += R/S; sSum += 1; cnt++; }
        }
        if (cnt > 0) { logR.push(Math.log(sz)); logS.push(Math.log(rSum/cnt)); }
      }
      if (logR.length < 2) return 0.5;
      const n2 = logR.length, sx = logR.reduce((a,b)=>a+b,0), sy = logS.reduce((a,b)=>a+b,0);
      const sxx = logR.reduce((a,b)=>a+b*b,0), sxy = logR.reduce((a,v,i)=>a+v*logS[i],0);
      return (n2*sxy - sx*sy) / (n2*sxx - sx*sx) || 0.5;
    }
    function dfaHurst(prices) {
      const n = prices.length; if (n < 16) return 0.5;
      const y = prices.map((v,i,a) => { let s=0; for(let j=0;j<=i;j++) s+=a[j]-a.reduce((x,y)=>x+y,0)/n; return s; });
      const logN = [], logF = [];
      for (let s = 4; s <= n/4; s = Math.round(s*1.5)) {
        const segs = Math.floor(n/s); let sum = 0;
        for (let k = 0; k < segs; k++) {
          const seg = y.slice(k*s,(k+1)*s), si = Array.from({length:s},(_,i)=>i);
          const sx=si.reduce((a,b)=>a+b,0),sy=seg.reduce((a,b)=>a+b,0),sxx=si.reduce((a,b)=>a+b*b,0),sxy=si.reduce((a,v,i)=>a+v*seg[i],0);
          const slope=(s*sxy-sx*sy)/(s*sxx-sx*sx)||0, intercept=(sy-slope*sx)/s;
          sum += seg.reduce((a,v,i)=>a+(v-(slope*i+intercept))**2,0)/s;
        }
        logN.push(Math.log(s)); logF.push(Math.log(Math.sqrt(sum/segs)));
      }
      if (logN.length < 2) return 0.5;
      const n2=logN.length,sx=logN.reduce((a,b)=>a+b,0),sy=logF.reduce((a,b)=>a+b,0);
      const sxx=logN.reduce((a,b)=>a+b*b,0),sxy=logN.reduce((a,v,i)=>a+v*logF[i],0);
      return (n2*sxy-sx*sy)/(n2*sxx-sx*sx)||0.5;
    }
    function permEntropy(prices, order) {
      const n = prices.length; if (n < order+1) return 1;
      const counts = {};
      for (let i = 0; i <= n-order; i++) {
        const seg = prices.slice(i, i+order);
        const perm = seg.map((_,j)=>j).sort((a,b)=>seg[a]-seg[b]).join('');
        counts[perm] = (counts[perm]||0)+1;
      }
      const total = n - order + 1;
      return -Object.values(counts).reduce((s,c)=>s+(c/total)*Math.log(c/total),0) / Math.log(factorial(order));
    }
    function factorial(n) { let r=1; for(let i=2;i<=n;i++) r*=i; return r; }
    function dftCycle(prices) {
      const n = prices.length; if (n < 8) return 0;
      const re = new Float64Array(n), im = new Float64Array(n);
      for (let k = 1; k < n/2; k++) {
        let r=0,im2=0;
        for (let j=0;j<n;j++) { const a=2*Math.PI*k*j/n; r+=prices[j]*Math.cos(a); im2-=prices[j]*Math.sin(a); }
        re[k]=r; im[k]=im2;
      }
      let maxPow=0, maxK=4;
      for (let k=2;k<n/2;k++) { const p=re[k]*re[k]+im[k]*im[k]; if(p>maxPow){maxPow=p;maxK=k;} }
      return maxK > 0 ? Math.round(n/maxK) : 0;
    }
  `;
  let _worker = null;
  const _workerCbs = new Map();
  let _workerIdSeq = 0;
  function _initWorker() {
    if (!CFG.WORKER_ENABLED || _worker) return;
    try {
      const blob = new Blob([_WORKER_CODE], { type: 'text/javascript' });
      _worker = new Worker(URL.createObjectURL(blob));
      _worker.onmessage = (e) => {
        const { id, result } = e.data;
        const cb = _workerCbs.get(id);
        if (cb) { _workerCbs.delete(id); clearTimeout(cb.tid); cb.resolve(result); }
      };
      _worker.onerror = () => { _worker = null; };
    } catch(_) { _worker = null; }
  }
  function _workerPost(type, data) {
    return new Promise((resolve) => {
      if (!_worker) { resolve(null); return; }
      const id  = ++_workerIdSeq;
      const tid = setTimeout(() => { _workerCbs.delete(id); resolve(null); }, CFG.WORKER_TIMEOUT_MS || 80);
      _workerCbs.set(id, { resolve, tid });
      try { _worker.postMessage({ id, type, data }); } catch(_) { _workerCbs.delete(id); clearTimeout(tid); resolve(null); }
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // V13 §I  DOM SELF-HEALING
  // ════════════════════════════════════════════════════════════════════════════
  const DOMHealer = (() => {
    let _observer = null;
    let _debounce = null;
    let _healCount = 0;
    function start() {
      if (!W.MutationObserver || _observer) return;
      _observer = new W.MutationObserver(() => {
        clearTimeout(_debounce);
        _debounce = setTimeout(_check, 500);
      });
      _observer.observe(W.document.body, { childList: true, subtree: false });
    }
    function _check() {
      const root = W.document.getElementById('cbRoot');
      if (!root && _healCount < 5) {
        _healCount++;
        addLog('[HEAL] cbRoot missing — reinserting UI (×' + _healCount + ')', 'error');
        try { initUI(); } catch(_) {}
      }
    }
    function stop() { if (_observer) { _observer.disconnect(); _observer = null; } }
    return { start, stop };
  })();

"""

# Insert just before the closing `  function init() {`
src = src.replace(
    "  function init() {",
    NEW_ENGINES + "  function init() {"
)

# ─────────────────────────────────────────────────────────────────────────────
# 22. ADD _initWorker() call inside init()
# ─────────────────────────────────────────────────────────────────────────────
src = src.replace(
    "      if (CFG.DOM_HEAL_ENABLED) DOMHealer.start();\n"
    "      if (CFG.RL_ENABLED) RLEngine.load();\n"
    "      _startSignalWatcher();",
    "      if (CFG.DOM_HEAL_ENABLED) DOMHealer.start();\n"
    "      if (CFG.RL_ENABLED) RLEngine.load();\n"
    "      if (CFG.WORKER_ENABLED) _initWorker();\n"
    "      _startSignalWatcher();"
)

# ─────────────────────────────────────────────────────────────────────────────
# WRITE OUTPUT
# ─────────────────────────────────────────────────────────────────────────────
with open(DST, 'w', encoding='utf-8') as f:
    f.write(src)

print(f"Done. Lines: {src.count(chr(10))}")
