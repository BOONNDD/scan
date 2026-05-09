package com.supremebot

import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * WebSocket client (OkHttp) — connects APK to the Node.js bridge server.
 *
 * Sends  : identify, log, stats, trade, status, ping
 * Receives: command, reload_script, pong
 */
class BotSocketClient(
    private val onCommand     : (cmd: String, payload: JSONObject?) -> Unit,
    private val onReloadScript: (script: String, version: String)   -> Unit,
    private val onLog         : (String) -> Unit,
) {
    private val scope     = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val connected = AtomicBoolean(false)
    private var wsConn    : WebSocket? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)   // no timeout on read (persistent)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    // ── Public API ────────────────────────────────────────────────────────────

    fun connect() {
        scope.launch { attemptConnect() }
    }

    fun disconnect() {
        scope.cancel()
        wsConn?.cancel()
        wsConn = null
    }

    fun sendLog(msg: String, type: String = "info") = send(
        JSONObject().put("type","log").put("msg",msg).put("logType",type)
    )

    fun sendStats(stats: JSONObject) = send(
        JSONObject().put("type","stats").put("data",stats)
    )

    fun sendTrade(trade: JSONObject) = send(
        JSONObject().put("type","trade").put("data",trade)
    )

    fun sendStatus(status: String) = send(
        JSONObject().put("type","status").put("status",status)
    )

    fun isConnected() = connected.get()

    // ── Internal ──────────────────────────────────────────────────────────────

    private fun send(obj: JSONObject) {
        if (!connected.get()) return
        try { wsConn?.send(obj.toString()) } catch (_: Exception) {}
    }

    private suspend fun attemptConnect() {
        var backoff = 2_000L
        while (scope.isActive) {
            val url = BotPrefs.serverWsUrl
            if (url.isBlank()) { delay(5000); continue }
            onLog("🔌 Connecting to $url")

            val ready    = CompletableDeferred<Unit>()
            val closed   = CompletableDeferred<Unit>()

            val listener = object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    wsConn    = ws
                    connected.set(true)
                    backoff   = 2_000L
                    onLog("✅ Server connected")
                    ws.send(JSONObject().put("type","identify").put("client","bot").toString())
                    ready.complete(Unit)
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    handleMessage(text)
                }

                override fun onMessage(ws: WebSocket, bytes: ByteString) {
                    handleMessage(bytes.utf8())
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    connected.set(false)
                    if (!ready.isCompleted) ready.complete(Unit)
                    if (!closed.isCompleted) closed.complete(Unit)
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    connected.set(false)
                    onLog("🔌 Disconnected ($code)")
                    if (!closed.isCompleted) closed.complete(Unit)
                }
            }

            val request = Request.Builder().url(url).build()
            client.newWebSocket(request, listener)

            ready.await()
            closed.await()

            wsConn = null
            onLog("🔄 Reconnecting in ${backoff/1000}s…")
            delay(backoff)
            backoff = minOf(backoff * 2, 30_000L)
        }
    }

    private fun handleMessage(raw: String) {
        try {
            val msg  = JSONObject(raw)
            when (msg.optString("type")) {
                "command"       -> onCommand(
                    msg.optString("cmd"),
                    msg.optJSONObject("payload")
                )
                "reload_script" -> onReloadScript(
                    msg.optString("script"),
                    msg.optString("version")
                )
            }
        } catch (_: Exception) {}
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────────
    init {
        scope.launch {
            while (isActive) {
                delay(15_000)
                if (connected.get()) {
                    send(JSONObject().put("type","ping").put("ts", System.currentTimeMillis()))
                }
            }
        }
    }
}
