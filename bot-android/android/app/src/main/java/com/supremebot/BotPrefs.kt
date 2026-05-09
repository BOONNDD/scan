package com.supremebot

import android.content.Context
import android.content.SharedPreferences

object BotPrefs {

    private lateinit var prefs: SharedPreferences

    fun init(ctx: Context) {
        prefs = ctx.getSharedPreferences("supreme_bot", Context.MODE_PRIVATE)
    }

    var serverWsUrl: String
        get() = prefs.getString("server_ws_url", "wss://pocket-option-bot--azzideenalhwry.replit.app/ws") ?: "wss://pocket-option-bot--azzideenalhwry.replit.app/ws"
        set(v) { prefs.edit().putString("server_ws_url", v).apply() }

    var scriptUrl: String
        get() = prefs.getString("script_url",
            "https://raw.githubusercontent.com/boonndd/scan/claude/supreme-pred-v2-engine-UiUx4/candle_V12_SUPREME.js"
        ) ?: ""
        set(v) { prefs.edit().putString("script_url", v).apply() }

    var scriptVersion: String
        get() = prefs.getString("script_version", "") ?: ""
        set(v) { prefs.edit().putString("script_version", v).apply() }

    var cachedScript: String
        get() = prefs.getString("cached_script", "") ?: ""
        set(v) { prefs.edit().putString("cached_script", v).apply() }

    var isDemo: Boolean
        get() = prefs.getBoolean("is_demo", true)
        set(v) { prefs.edit().putBoolean("is_demo", v).apply() }
}
