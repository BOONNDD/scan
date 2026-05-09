package com.supremebot

import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class BotSocketClient(
    private val onCommand      : (cmd: String, payload: JSONObject?) -> Unit,
    private val onReloadScript : (script: String, version: String) -> Unit,
    private val onLog          : (msg: String) -> Unit,
) {
    private val scope     = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val connected = AtomicBoolean(false)

    @Volatile private var wsConn: WebSocket? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    // ── Public ────────────────────────────────────────────────────────────────

    fun connect() { scope.launch { connectLoop() } }

    fun disconnect() {
        scope.cancel()
        wsConn?.cancel()
    }

    fun sendLog(msg: String, type: String = "info") =
        send(JSONObject().put("type", "log").put("msg", msg).put("logType", type))

    fun sendStats(stats: JSONObject) =
        send(JSONObject().put("type", "stats").put("data", stats))

    fun sendTrade(trade: JSONObject) =
        send(JSONObject().put("type", "trade").put("data", trade))

    fun sendStatus(status: String) =
        send(JSONObject().put("type", "status").put("status", status))

    fun isConnected(): Boolean = connected.get()

    // ── Internal ──────────────────────────────────────────────────────────────

    private fun send(obj: JSONObject) {
        if (!connected.get()) return
        try { wsConn?.send(obj.toString()) } catch (e: Exception) { /* ignore */ }
    }

    private suspend fun connectLoop() {
        var backoffMs = 2_000L
        while (scope.isActive) {
            val url = BotPrefs.serverWsUrl
            if (url.isBlank() || url == "ws://localhost:3000") {
                delay(10_000)
                continue
            }
            onLog("🔌 Connecting to $url")
            openSocket(url)
            delay(backoffMs)
            backoffMs = minOf(backoffMs * 2, 30_000L)
        }
    }

    private suspend fun openSocket(url: String) {
        val latch = CompletableDeferred<Unit>()

        val listener = object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                wsConn = ws
                connected.set(true)
                onLog("✅ Server connected")
                ws.send(JSONObject().put("type", "identify").put("client", "bot").toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                handleMessage(bytes.utf8())
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                connected.set(false)
                onLog("🔌 Disconnected ($code)")
                latch.complete(Unit)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                connected.set(false)
                onLog("⚠️ WS error: ${t.message}")
                latch.complete(Unit)
            }
        }

        try {
            val request = Request.Builder().url(url).build()
            client.newWebSocket(request, listener)
            latch.await()
        } catch (e: Exception) {
            onLog("⚠️ Connect error: ${e.message}")
        } finally {
            connected.set(false)
            wsConn = null
        }
    }

    private fun handleMessage(raw: String) {
        try {
            val msg = JSONObject(raw)
            when (msg.optString("type")) {
                "command" -> onCommand(
                    msg.optString("cmd"),
                    msg.optJSONObject("payload")
                )
                "reload_script" -> onReloadScript(
                    msg.optString("script"),
                    msg.optString("version")
                )
            }
        } catch (e: Exception) { /* ignore bad json */ }
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────────
    init {
        scope.launch {
            while (isActive) {
                delay(15_000)
                if (connected.get()) {
                    send(JSONObject().put("type", "ping").put("ts", System.currentTimeMillis()))
                }
            }
        }
    }
}
