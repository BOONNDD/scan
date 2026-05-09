package com.supremebot

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Custom WebViewClient that:
 * 1. Injects the bridge script on every Pocket Option page
 * 2. Injects the main bot script after the bridge
 * 3. Intercepts page navigation to stay on Pocket Option
 */
class BotWebViewClient(
    private val getScript : () -> String?,
    private val onLog     : (String) -> Unit,
) : WebViewClient() {

    companion object {
        private const val TARGET_HOST = "pocketoption.com"
        private const val LOGIN_URL   = "https://pocketoption.com/en/login/"
        private const val TRADE_URL   = "https://pocketoption.com/en/cabinet/demo-quick-high-low/"
    }

    // Called once the DOM is ready
    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)

        if (!url.contains(TARGET_HOST)) return

        onLog("📄 Page: $url")

        // Step 1: inject the bridge (defines window.Android + window.__SUPREME_BRIDGE__)
        val bridge = buildBridgeScript()
        view.evaluateJavascript(bridge, null)

        // Step 2: inject the main bot script (if available)
        val script = getScript()
        if (!script.isNullOrEmpty()) {
            // Wrap in IIFE and remove @grant/@match Tampermonkey headers if present
            val cleaned = cleanScript(script)
            view.evaluateJavascript(cleaned) { result ->
                onLog("🤖 Bot script injected: $result")
            }
        } else {
            onLog("⚠️ No script cached yet, waiting for download…")
        }
    }

    // ── URL filtering ─────────────────────────────────────────────────────────

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        // Block navigating away from Pocket Option
        if (!url.contains(TARGET_HOST)) {
            onLog("🚫 Blocked navigation to: $url")
            return true
        }
        return false
    }

    // ── Bridge script ─────────────────────────────────────────────────────────

    private fun buildBridgeScript(): String = """
        (function() {
          if (window.__SUPREME_BRIDGE_LOADED__) return;
          window.__SUPREME_BRIDGE_LOADED__ = true;

          /* ── Android → JS callbacks ──────────────────────────── */
          window.__SUPREME_BRIDGE__ = {
            _ws      : null,
            _serverUrl: null,
            _ready   : false,

            connect: function() {
              try {
                var url = window.Android && window.Android.getServerUrl
                  ? window.Android.getServerUrl()
                  : null;
                if (!url || url === 'ws://localhost:3000') return; // no real server
                this._serverUrl = url;
                var self = this;
                var ws   = new WebSocket(url);
                this._ws = ws;

                ws.onopen = function() {
                  ws.send(JSON.stringify({ type:'identify', client:'bot' }));
                  self._ready = true;
                };
                ws.onmessage = function(e) {
                  try {
                    var m = JSON.parse(e.data);
                    if (m.type === 'command')       self._handleCmd(m.cmd, m.payload);
                    if (m.type === 'reload_script') self._reloadScript(m.script, m.version);
                    if (m.type === 'pong')          {}
                  } catch(_) {}
                };
                ws.onerror = ws.onclose = function() {
                  self._ready = false;
                  setTimeout(function(){ self.connect(); }, 5000);
                };
              } catch(e) {}
            },

            log: function(msg, type) {
              /* Forward to Android native interface */
              try { window.Android && window.Android.log(JSON.stringify({msg:msg,type:type||'info'})); } catch(_){}
              /* Also send over WebSocket if connected */
              this._send({ type:'log', msg:msg, logType:type||'info', ts:Date.now() });
            },

            stats: function(data) {
              try { window.Android && window.Android.stats(JSON.stringify(data)); } catch(_){}
              this._send({ type:'stats', data:data });
            },

            trade: function(data) {
              try { window.Android && window.Android.trade(JSON.stringify(data)); } catch(_){}
              this._send({ type:'trade', data:data });
            },

            status: function(s) {
              try { window.Android && window.Android.status(s); } catch(_){}
              this._send({ type:'status', status:s });
            },

            _send: function(obj) {
              if (this._ws && this._ws.readyState === 1) {
                try { this._ws.send(JSON.stringify(obj)); } catch(_) {}
              }
            },

            _handleCmd: function(cmd, payload) {
              switch(cmd) {
                case 'start':       window.__SUPREME_CMD__ = 'start';       break;
                case 'stop':        window.__SUPREME_CMD__ = 'stop';        break;
                case 'pause':       window.__SUPREME_CMD__ = 'pause';       break;
                case 'set_amount':
                  if (payload && payload.amount) window.__SUPREME_AMOUNT__ = payload.amount;
                  break;
              }
            },

            _reloadScript: function(script, version) {
              if (!script) return;
              try {
                // eslint-disable-next-line no-eval
                eval(script);
                window.__SUPREME_BRIDGE__.log('🔄 Hot-reload OK: ' + (version||'').slice(0,12), 'system');
              } catch(e) {
                window.__SUPREME_BRIDGE__.log('❌ Hot-reload failed: ' + e.message, 'error');
              }
            },
          };

          /* ── Auto-connect bridge ───────────────────────────────── */
          window.__SUPREME_BRIDGE__.connect();

          /* ── Heartbeat ping every 10s ─────────────────────────── */
          setInterval(function() {
            window.__SUPREME_BRIDGE__._send({ type:'ping', ts:Date.now() });
          }, 10000);

        })();
    """.trimIndent()

    // ── Script cleaner ────────────────────────────────────────────────────────

    private fun cleanScript(raw: String): String {
        // Remove Tampermonkey metadata block if present
        val cleaned = raw.replace(Regex("""// ==UserScript==[\s\S]*?// ==/UserScript=="""), "")
        // Wrap in IIFE to avoid polluting global scope accidentally
        return "(function(){\n$cleaned\n})();"
    }
}
