package com.supremebot

import kotlinx.coroutines.*
import java.net.HttpURLConnection
import java.net.URL

/**
 * Polls GitHub for script updates every [pollIntervalMs] milliseconds.
 * Calls [onUpdate] with the new script text when a new version is detected.
 */
class ScriptManager(
    private val pollIntervalMs : Long = 5 * 60_000L,
    private val onUpdate       : (script: String, version: String) -> Unit,
    private val onLog          : (String) -> Unit,
    private val onChecked      : (() -> Unit)? = null,
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /** Timestamp (ms) of the most recent completed poll cycle. */
    @Volatile var lastCheckMs: Long = System.currentTimeMillis()
        private set

    val pollIntervalMsPublic: Long get() = pollIntervalMs

    fun start() {
        scope.launch {
            // Load cached script immediately so the bot can start before network
            val cached = BotPrefs.cachedScript
            if (cached.isNotEmpty()) {
                onUpdate(cached, BotPrefs.scriptVersion)
                onLog("📦 Loaded cached script v${BotPrefs.scriptVersion.take(12)}")
            }

            while (isActive) {
                fetchIfNew()
                lastCheckMs = System.currentTimeMillis()
                onChecked?.invoke()
                delay(pollIntervalMs)
            }
        }
    }

    fun forceRefresh() {
        scope.launch { fetchIfNew(force = true) }
    }

    fun stop() { scope.cancel() }

    // ── Internal ──────────────────────────────────────────────────────────────

    private suspend fun fetchIfNew(force: Boolean = false) = withContext(Dispatchers.IO) {
        try {
            val url  = BotPrefs.scriptUrl
            if (url.isEmpty()) return@withContext

            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout   = 10_000
                readTimeout      = 15_000
                requestMethod    = "GET"
                if (!force && BotPrefs.scriptVersion.isNotEmpty()) {
                    setRequestProperty("If-None-Match", BotPrefs.scriptVersion)
                }
            }

            val code = conn.responseCode
            if (code == 304) {
                // Not modified — still send cached so WebView always has a script
                return@withContext
            }
            if (code != 200) {
                onLog("⚠️ Script fetch HTTP $code")
                return@withContext
            }

            val script  = conn.inputStream.bufferedReader().readText()
            val etag    = conn.getHeaderField("ETag")
                        ?: conn.getHeaderField("Last-Modified")
                        ?: System.currentTimeMillis().toString()

            if (etag != BotPrefs.scriptVersion || force) {
                val isNew = BotPrefs.scriptVersion.isNotEmpty()
                BotPrefs.cachedScript   = script
                BotPrefs.scriptVersion  = etag
                onLog(if (isNew) "🔄 Script updated: ${etag.take(12)}"
                      else       "📦 Script loaded: ${etag.take(12)}")
                onUpdate(script, etag)
            }
        } catch (e: Exception) {
            onLog("⚠️ Script fetch error: ${e.message}")
        }
    }
}
