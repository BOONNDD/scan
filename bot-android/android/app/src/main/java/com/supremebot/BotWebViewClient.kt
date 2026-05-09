package com.supremebot

import android.graphics.Bitmap
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

class BotWebViewClient(
    private val socketClient: BotSocketClient,
    private val onPageReady: () -> Unit
) : WebViewClient() {

    companion object {
        private const val TAG = "BotWebViewClient"
        private const val POCKET_OPTION_HOST = "pocketoption.com"
    }

    var cachedScript: String? = null
    var scriptVersion: String? = null

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val host = request?.url?.host ?: return false
        return !host.contains(POCKET_OPTION_HOST)
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        Log.d(TAG, "Page started: $url")
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        Log.i(TAG, "Page loaded: $url")

        val script = cachedScript ?: return
        injectScript(view, script)
        onPageReady()
    }

    fun injectScript(view: WebView?, script: String) {
        view ?: return
        val version = scriptVersion ?: "unknown"

        setupBridgeInterface(view)

        val wrapped = """
            (function() {
                try {
                    $script
                } catch(e) {
                    console.error('[V12_SUPREME] Injection error: ' + e.message);
                    if (window.__SUPREME_BRIDGE__) {
                        window.__SUPREME_BRIDGE__.onLog('error', 'Injection error: ' + e.message, '');
                    }
                }
            })();
        """.trimIndent()

        view.evaluateJavascript(wrapped) { result ->
            Log.d(TAG, "Script injected (v$version), result=$result")
        }
    }

    private fun setupBridgeInterface(view: WebView) {
        val bridgeJs = """
            (function() {
                window.__SUPREME_CMD__ = window.__SUPREME_CMD__ || [];
                window.__SUPREME_BRIDGE__ = {
                    onLog: function(type, message, extra) {
                        Android.onLog(type, message, extra || '');
                    },
                    onTrade: function(dataJson) {
                        Android.onTrade(dataJson);
                    },
                    onStatus: function(dataJson) {
                        Android.onStatus(dataJson);
                    }
                };
            })();
        """.trimIndent()
        view.evaluateJavascript(bridgeJs, null)
    }

    fun sendCommand(view: WebView, command: String, extra: JSONObject? = null) {
        val cmd = extra?.put("command", command) ?: JSONObject().put("command", command)
        val js = """
            (function() {
                if (!window.__SUPREME_CMD__) window.__SUPREME_CMD__ = [];
                window.__SUPREME_CMD__.push(${cmd});
            })();
        """.trimIndent()
        view.evaluateJavascript(js, null)
    }
}
