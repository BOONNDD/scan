package com.supremebot

import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class BotWebViewClient(
    private val getScript    : () -> String?,
    private val onLog        : (String) -> Unit,
    private val onPageLoaded : (() -> Unit)? = null,
    private val onUrlChanged : ((String) -> Unit)? = null,
    private val getExtensions: ((String) -> List<Pair<String, String>>)? = null,
) : WebViewClient() {

    companion object {
        private const val TARGET_HOST = "pocketoption.com"
        private const val LOGIN_URL   = "https://pocketoption.com/en/login/"
    }

    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)

        // Notify MainActivity so SwipeRefresh spinner can stop
        onPageLoaded?.invoke()
        // Update URL bar
        onUrlChanged?.invoke(url)

        // Inject extensions that match this URL
        getExtensions?.invoke(url)?.forEach { (name, js) ->
            view.evaluateJavascript("(function(){\n/* ext:$name */\n$js\n})();", null)
        }

        // Bot bridge + script: pocketoption.com pages only
        if (!url.contains(TARGET_HOST)) return

        onLog("📄 Page: $url")

        // Step 1: bridge (defines window.Android + window.__SUPREME_BRIDGE__)
        view.evaluateJavascript(buildBridgeScript(), null)

        // Step 2: main bot script
        val script = getScript()
        if (!script.isNullOrEmpty()) {
            view.evaluateJavascript(cleanScript(script)) { result ->
                onLog("🤖 Bot script injected: $result")
            }
        } else {
            onLog("⚠️ No script cached yet, waiting for download…")
        }
    }

    // Allow all navigation — the app is now a full browser
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        onUrlChanged?.invoke(request.url.toString())
        return false
    }

    // ── Bridge script ─────────────────────────────────────────────────────────

    private fun buildBridgeScript(): String = """
        (function() {
          if (window.__SUPREME_BRIDGE_LOADED__) return;
          window.__SUPREME_BRIDGE_LOADED__ = true;

          window.__SUPREME_BRIDGE__ = {
            _ws: null, _ready: false,

            connect: function() {
              try {
                var url = window.Android && window.Android.getServerUrl
                  ? window.Android.getServerUrl() : null;
                if (!url || url === 'ws://localhost:3000') return;
                var self = this, ws = new WebSocket(url);
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
                  } catch(_) {}
                };
                ws.onerror = ws.onclose = function() {
                  self._ready = false;
                  setTimeout(function(){ self.connect(); }, 5000);
                };
              } catch(e) {}
            },

            log: function(msg, type) {
              try { window.Android && window.Android.log(JSON.stringify({msg:msg,type:type||'info'})); } catch(_){}
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
              if (this._ws && this._ws.readyState === 1)
                try { this._ws.send(JSON.stringify(obj)); } catch(_){}
            },
            _handleCmd: function(cmd, payload) {
              switch(cmd) {
                case 'start':      window.__SUPREME_CMD__ = 'start';  break;
                case 'stop':       window.__SUPREME_CMD__ = 'stop';   break;
                case 'pause':      window.__SUPREME_CMD__ = 'pause';  break;
                case 'set_amount':
                  if (payload && payload.amount) window.__SUPREME_AMOUNT__ = payload.amount;
                  break;
              }
            },
            _reloadScript: function(script, version) {
              if (!script) return;
              try {
                eval(script);
                window.__SUPREME_BRIDGE__.log('🔄 Hot-reload OK: '+(version||'').slice(0,12),'system');
              } catch(e) {
                window.__SUPREME_BRIDGE__.log('❌ Hot-reload failed: '+e.message,'error');
              }
            },
          };

          window.__SUPREME_BRIDGE__.connect();

          setInterval(function() {
            window.__SUPREME_BRIDGE__._send({ type:'ping', ts:Date.now() });
          }, 10000);
        })();
    """.trimIndent()

    private fun cleanScript(raw: String): String {
        val cleaned = raw.replace(Regex("""// ==UserScript==[\s\S]*?// ==/UserScript=="""), "")
        return "(function(){\n$cleaned\n})();"
    }
}
