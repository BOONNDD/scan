package com.supremebot

import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Android ↔ JavaScript bridge.
 * The injected bridge script calls window.Android.* to pass data here.
 */
class BotJsInterface(
    private val onLog    : (String, String) -> Unit,
    private val onStats  : (JSONObject)     -> Unit,
    private val onTrade  : (JSONObject)     -> Unit,
    private val onStatus : (String)         -> Unit,
    private val onReady  : ()               -> Unit,
) {

    @JavascriptInterface
    fun log(json: String) {
        try {
            val obj  = JSONObject(json)
            val msg  = obj.optString("msg", "")
            val type = obj.optString("type", "info")
            onLog(msg, type)
        } catch (_: Exception) {
            onLog(json, "info")
        }
    }

    @JavascriptInterface
    fun stats(json: String) {
        try { onStats(JSONObject(json)) } catch (_: Exception) {}
    }

    @JavascriptInterface
    fun trade(json: String) {
        try { onTrade(JSONObject(json)) } catch (_: Exception) {}
    }

    @JavascriptInterface
    fun status(s: String) {
        onStatus(s)
    }

    @JavascriptInterface
    fun ready() {
        onReady()
    }

    /** Returns the WebSocket server URL so the bridge script can connect directly */
    @JavascriptInterface
    fun getServerUrl(): String = BotPrefs.serverWsUrl

    /** Returns the current script version hash */
    @JavascriptInterface
    fun getScriptVersion(): String = BotPrefs.scriptVersion
}
