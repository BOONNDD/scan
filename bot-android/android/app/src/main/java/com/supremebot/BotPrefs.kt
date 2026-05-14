package com.supremebot

import android.content.Context
import android.content.SharedPreferences

object BotPrefs {
    private const val PREFS_NAME = "supreme_bot_prefs"
    private const val KEY_CACHED_SCRIPT = "cached_script"
    private const val KEY_SCRIPT_VERSION = "script_version"
    private const val KEY_SERVER_URL = "server_url"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var cachedScript: String?
        get() = _prefs?.getString(KEY_CACHED_SCRIPT, null)
        set(value) { _prefs?.edit()?.putString(KEY_CACHED_SCRIPT, value)?.apply() }

    var scriptVersion: String?
        get() = _prefs?.getString(KEY_SCRIPT_VERSION, null)
        set(value) { _prefs?.edit()?.putString(KEY_SCRIPT_VERSION, value)?.apply() }

    var serverUrl: String
        get() = _prefs?.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        set(value) { _prefs?.edit()?.putString(KEY_SERVER_URL, value)?.apply() }

    private var _prefs: SharedPreferences? = null

    fun init(ctx: Context) {
        _prefs = prefs(ctx)
    }

    const val DEFAULT_SERVER_URL = "wss://pocket-option-bot--azzideenalhwry.replit.app/ws"
    const val SCRIPT_GITHUB_URL =
        "https://raw.githubusercontent.com/boonndd/scan/claude/supreme-pred-v2-engine-UiUx4/candle_V12_SUPREME.js"
}
