package com.supremebot

import android.util.Log
import kotlinx.coroutines.*
import java.net.HttpURLConnection
import java.net.URL

class ScriptManager(
    private val onUpdate: (script: String, version: String?) -> Unit,
    private val onChecked: () -> Unit
) {
    companion object {
        private const val TAG = "ScriptManager"
        private const val POLL_INTERVAL_MS = 5 * 60 * 1000L
    }

    var lastCheckMs: Long = 0L
        private set

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun start(cachedScript: String?, cachedVersion: String?) {
        if (cachedScript != null) {
            onUpdate(cachedScript, cachedVersion)
        }
        scope.launch {
            while (isActive) {
                checkForUpdate()
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    fun stop() {
        scope.cancel()
    }

    private suspend fun checkForUpdate() = withContext(Dispatchers.IO) {
        lastCheckMs = System.currentTimeMillis()
        onChecked()

        val url = URL(BotPrefs.SCRIPT_GITHUB_URL)
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 30_000
        conn.readTimeout = 30_000
        conn.setRequestProperty("User-Agent", "SupremeBot-Android/1.0")

        val storedEtag = BotPrefs.scriptVersion
        if (storedEtag != null) {
            conn.setRequestProperty("If-None-Match", storedEtag)
        }

        try {
            val code = conn.responseCode
            if (code == 304) {
                Log.d(TAG, "Script unchanged (304)")
                return@withContext
            }
            if (code != 200) {
                Log.w(TAG, "Unexpected HTTP $code")
                return@withContext
            }

            val content = conn.inputStream.bufferedReader().readText()
            val etag = conn.getHeaderField("ETag")

            if (etag != null && etag == storedEtag) {
                Log.d(TAG, "Script same ETag, skip")
                return@withContext
            }

            BotPrefs.cachedScript = content
            BotPrefs.scriptVersion = etag

            Log.i(TAG, "Script updated: etag=$etag size=${content.length}")
            withContext(Dispatchers.Main) {
                onUpdate(content, etag)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Script fetch error", e)
        } finally {
            conn.disconnect()
        }
    }
}
