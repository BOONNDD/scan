package com.supremebot

import android.util.Log
import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString
import org.json.JSONObject

class BotSocketClient(
    private val serverUrl: String,
    private val onCommand: (command: String, payload: JSONObject) -> Unit,
    private val onReloadScript: (script: String, version: String?) -> Unit,
    private val onConnected: () -> Unit,
    private val onDisconnected: () -> Unit
) : WebSocketListener() {

    companion object {
        private const val TAG = "BotSocketClient"
        private const val RECONNECT_DELAY_MS = 5_000L
    }

    private val client = OkHttpClient.Builder()
        .readTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
        .build()

    private var ws: WebSocket? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var running = false

    fun connect() {
        running = true
        doConnect()
    }

    private fun doConnect() {
        val request = Request.Builder()
            .url(serverUrl)
            .header("User-Agent", "SupremeBot-Android/1.0")
            .build()
        ws = client.newWebSocket(request, this)
    }

    fun disconnect() {
        running = false
        ws?.close(1000, "App closing")
        scope.cancel()
    }

    fun sendLog(type: String, message: String, extra: String? = null) {
        send(buildJsonObject {
            put("type", "log")
            put("logType", type)
            put("message", message)
            extra?.let { put("extra", it) }
        })
    }

    fun sendTrade(
        signal: String, asset: String, amount: Double,
        patternCase: String?, confluence: Double?,
        isTVE: Boolean, isDouble: Boolean
    ) {
        send(buildJsonObject {
            put("type", "trade")
            put("signal", signal)
            put("asset", asset)
            put("amount", amount)
            patternCase?.let { put("patternCase", it) }
            confluence?.let { put("confluence", it) }
            put("isTVE", isTVE)
            put("isDouble", isDouble)
        })
    }

    fun sendStatus(tradingStatus: String, activeAsset: String?, candlePeriod: Int?,
                   accountBalance: Double?, isDemo: Boolean) {
        send(buildJsonObject {
            put("type", "status")
            put("tradingStatus", tradingStatus)
            activeAsset?.let { put("activeAsset", it) }
            candlePeriod?.let { put("candlePeriod", it) }
            accountBalance?.let { put("accountBalance", it) }
            put("isDemo", isDemo)
        })
    }

    private fun send(json: JSONObject) {
        ws?.send(json.toString())
    }

    private fun buildJsonObject(block: JSONObject.() -> Unit): JSONObject =
        JSONObject().apply(block)

    override fun onOpen(webSocket: WebSocket, response: Response) {
        Log.i(TAG, "WebSocket connected to $serverUrl")
        onConnected()
        webSocket.send(buildJsonObject {
            put("type", "hello")
            put("scriptVersion", BotPrefs.scriptVersion)
        }.toString())
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        try {
            val json = JSONObject(text)
            val type = json.optString("type")
            when (type) {
                "command" -> {
                    val cmd = json.optString("command")
                    Log.d(TAG, "Received command: $cmd")
                    onCommand(cmd, json)
                }
                "reload_script" -> {
                    val script = json.optString("script")
                    val version = if (json.has("version")) json.optString("version") else null
                    Log.i(TAG, "Script reload from server, version=$version")
                    onReloadScript(script, version)
                }
                "ping" -> webSocket.send(buildJsonObject { put("type", "pong") }.toString())
                else -> Log.d(TAG, "Unknown message type: $type")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Message parse error", e)
        }
    }

    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {}

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        webSocket.close(1000, null)
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        Log.i(TAG, "WebSocket closed: $code $reason")
        onDisconnected()
        scheduleReconnect()
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        Log.e(TAG, "WebSocket failure: ${t.message}")
        onDisconnected()
        scheduleReconnect()
    }

    private fun scheduleReconnect() {
        if (!running) return
        scope.launch {
            delay(RECONNECT_DELAY_MS)
            if (running) {
                Log.i(TAG, "Reconnecting...")
                doConnect()
            }
        }
    }
}
