'use strict';

const express  = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const cors     = require('cors');
const fetch    = require('node-fetch');
const http     = require('http');
const path     = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 3000;
const GITHUB_RAW   = process.env.SCRIPT_URL ||
  'https://raw.githubusercontent.com/boonndd/scan/claude/supreme-pred-v2-engine-UiUx4/candle_V12_SUPREME.js';
const MAX_LOGS     = 500;
const MAX_TRADES   = 200;

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  botConnected : false,
  botStatus    : 'OFFLINE',   // OFFLINE | IDLE | TRADING | PAUSED
  logs         : [],           // { ts, msg, type }
  trades       : [],           // { ts, dir, result, conf, duration }
  stats        : { wins: 0, losses: 0, total: 0, winRate: 0, balance: 0 },
  scriptVersion: null,         // etag / commit sha
  scriptCache  : null,         // latest JS text
  lastSeen     : null,
};

// ── Express ───────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dashboard')));

// REST API
app.get('/api/status', (_req, res) => res.json({
  botConnected : state.botConnected,
  botStatus    : state.botStatus,
  stats        : state.stats,
  scriptVersion: state.scriptVersion,
  lastSeen     : state.lastSeen,
}));

app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, MAX_LOGS);
  res.json(state.logs.slice(-limit));
});

app.get('/api/trades', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_TRADES);
  res.json(state.trades.slice(-limit));
});

app.get('/api/stats', (_req, res) => res.json(state.stats));

// Send command to bot
app.post('/api/command', (req, res) => {
  const { cmd, payload } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });
  if (!state.botConnected) return res.status(503).json({ error: 'Bot not connected' });
  broadcastToBot({ type: 'command', cmd, payload });
  res.json({ ok: true, cmd });
});

// Trigger script reload from GitHub
app.post('/api/script/reload', async (_req, res) => {
  try {
    const { script, version } = await fetchScript(true);
    state.scriptCache   = script;
    state.scriptVersion = version;
    broadcastToBot({ type: 'reload_script', script, version });
    broadcast({ type: 'script_updated', version });
    res.json({ ok: true, version });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual log injection (for testing)
app.post('/api/log', (req, res) => {
  const { msg, logType } = req.body;
  pushLog(msg || 'test', logType || 'info');
  res.json({ ok: true });
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

// client types: 'bot' | 'dashboard'
const clients = new Set();
let botSocket = null;

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  ws._clientType = 'dashboard'; // default until identified
  clients.add(ws);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── Bot identification ────────────────────────────────────────────────
      case 'identify':
        if (msg.client === 'bot') {
          ws._clientType  = 'bot';
          botSocket        = ws;
          state.botConnected = true;
          state.botStatus    = 'IDLE';
          state.lastSeen     = Date.now();
          pushLog('🤖 Bot connected from ' + ip, 'system');
          broadcast({ type: 'bot_connected', ip });
          // send latest script version to bot
          if (state.scriptCache) {
            ws.send(JSON.stringify({
              type   : 'reload_script',
              script : state.scriptCache,
              version: state.scriptVersion,
            }));
          }
        }
        break;

      // ── Logs from bot ─────────────────────────────────────────────────────
      case 'log':
        state.lastSeen = Date.now();
        pushLog(msg.msg, msg.logType || 'info');
        break;

      // ── Stats update ──────────────────────────────────────────────────────
      case 'stats':
        state.lastSeen = Date.now();
        Object.assign(state.stats, msg.data);
        if (state.stats.total > 0) {
          state.stats.winRate = +(state.stats.wins / state.stats.total * 100).toFixed(1);
        }
        broadcastToDashboard({ type: 'stats', data: state.stats });
        break;

      // ── Trade result ──────────────────────────────────────────────────────
      case 'trade':
        state.lastSeen = Date.now();
        const trade = { ts: Date.now(), ...msg.data };
        state.trades.push(trade);
        if (state.trades.length > MAX_TRADES) state.trades.shift();
        broadcastToDashboard({ type: 'trade', data: trade });
        break;

      // ── Bot status ────────────────────────────────────────────────────────
      case 'status':
        state.lastSeen  = Date.now();
        state.botStatus = msg.status;
        broadcastToDashboard({ type: 'status', status: msg.status });
        break;

      // ── Heartbeat ─────────────────────────────────────────────────────────
      case 'ping':
        state.lastSeen = Date.now();
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        break;

      // ── Dashboard commands ────────────────────────────────────────────────
      case 'command':
        if (ws._clientType === 'dashboard') {
          broadcastToBot({ type: 'command', cmd: msg.cmd, payload: msg.payload });
        }
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (ws === botSocket) {
      botSocket          = null;
      state.botConnected = false;
      state.botStatus    = 'OFFLINE';
      pushLog('🔌 Bot disconnected', 'system');
      broadcast({ type: 'bot_disconnected' });
    }
  });

  ws.on('error', () => {});

  // Send current state to new dashboard connections
  if (ws._clientType === 'dashboard') {
    ws.send(JSON.stringify({
      type  : 'init',
      state : {
        botConnected : state.botConnected,
        botStatus    : state.botStatus,
        stats        : state.stats,
        logs         : state.logs.slice(-50),
        trades       : state.trades.slice(-20),
        scriptVersion: state.scriptVersion,
      },
    }));
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function pushLog(msg, type = 'info') {
  const entry = { ts: Date.now(), msg, type };
  state.logs.push(entry);
  if (state.logs.length > MAX_LOGS) state.logs.shift();
  broadcastToDashboard({ type: 'log', data: entry });
  console.log(`[${type.toUpperCase()}] ${msg}`);
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

function broadcastToDashboard(msg) {
  const data = JSON.stringify(msg);
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws._clientType === 'dashboard') ws.send(data);
  });
}

function broadcastToBot(msg) {
  if (botSocket && botSocket.readyState === WebSocket.OPEN) {
    botSocket.send(JSON.stringify(msg));
  }
}

async function fetchScript(force = false) {
  const headers = {};
  if (state.scriptVersion && !force) headers['If-None-Match'] = state.scriptVersion;

  const res = await fetch(GITHUB_RAW, { headers });
  if (res.status === 304) return { script: state.scriptCache, version: state.scriptVersion };
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);

  const script  = await res.text();
  const version = res.headers.get('etag') || res.headers.get('last-modified') || Date.now().toString();
  return { script, version };
}

// ── Script auto-update loop (every 5 min) ────────────────────────────────────
async function scriptUpdateLoop() {
  try {
    const { script, version } = await fetchScript();
    if (version !== state.scriptVersion && script) {
      const isNew = !!state.scriptVersion;
      state.scriptCache   = script;
      state.scriptVersion = version;
      if (isNew) {
        pushLog(`📦 New script version detected: ${version.slice(0, 12)}`, 'system');
        broadcastToBot({ type: 'reload_script', script, version });
        broadcast({ type: 'script_updated', version });
      } else {
        pushLog(`📦 Script loaded: ${version.slice(0, 12)}`, 'system');
      }
    }
  } catch (e) {
    pushLog('⚠️ Script fetch error: ' + e.message, 'warn');
  }
}

// ── Bot heartbeat watchdog ────────────────────────────────────────────────────
setInterval(() => {
  if (state.botConnected && state.lastSeen) {
    const gap = Date.now() - state.lastSeen;
    if (gap > 30000) {
      pushLog(`⚠️ Bot silent for ${Math.round(gap/1000)}s`, 'warn');
    }
  }
}, 15000);

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`Supreme Bot Server running on port ${PORT}`);
  await scriptUpdateLoop();
  setInterval(scriptUpdateLoop, 5 * 60 * 1000);
});
