package com.supremebot

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.webkit.*
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView       : WebView
    private lateinit var statusBar     : TextView
    private lateinit var socketClient  : BotSocketClient
    private lateinit var scriptManager : ScriptManager

    private var currentScript : String? = null
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        BotPrefs.init(applicationContext)

        webView   = findViewById(R.id.webview)
        statusBar = findViewById(R.id.status_bar)

        setupWebView()
        setupSocketClient()
        setupScriptManager()

        webView.loadUrl("https://pocketoption.com/en/login/")
        showPersistentNotification()
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        socketClient.disconnect()
        scriptManager.stop()
    }

    // ── Menu ──────────────────────────────────────────────────────────────────

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, "⚙️ الإعدادات")
        menu.add(0, 2, 0, "🔄 تحديث السكربت")
        menu.add(0, 3, 0, "🔁 إعادة تحميل")
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            1 -> { showSettings(); true }
            2 -> { scriptManager.forceRefresh(); true }
            3 -> { webView.reload(); true }
            else -> super.onOptionsItemSelected(item)
        }
    }

    // ── WebView ───────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled               = true
            domStorageEnabled               = true
            databaseEnabled                 = true
            mixedContentMode                = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString                 = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"
            allowContentAccess              = true
            loadsImagesAutomatically        = true
            mediaPlaybackRequiresUserGesture = false
        }

        val jsInterface = BotJsInterface(
            onLog    = { msg, type -> handleLog(msg, type) },
            onStats  = { obj       -> handleStats(obj) },
            onTrade  = { obj       -> handleTrade(obj) },
            onStatus = { s         -> handleStatus(s) },
            onReady  = {             handleBotReady() },
        )
        webView.addJavascriptInterface(jsInterface, "Android")

        webView.webViewClient = BotWebViewClient(
            getScript = { currentScript },
            onLog     = { msg -> handleLog(msg, "system") },
        )

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                val msg = m.message()
                if (msg.contains("SUPREME") || msg.contains("TVE") ||
                    msg.startsWith("❌") || msg.startsWith("✅") ||
                    msg.startsWith("🔔") || msg.startsWith("📊")) {
                    val type = when (m.messageLevel()) {
                        ConsoleMessage.MessageLevel.ERROR   -> "error"
                        ConsoleMessage.MessageLevel.WARNING -> "warn"
                        else -> "info"
                    }
                    handleLog(msg, type)
                }
                return true
            }
        }
    }

    // ── Socket client ─────────────────────────────────────────────────────────

    private fun setupSocketClient() {
        socketClient = BotSocketClient(
            onCommand = { cmd, payload ->
                runOnUiThread { executeCommand(cmd, payload) }
            },
            onReloadScript = { script, version ->
                currentScript = script
                BotPrefs.cachedScript  = script
                BotPrefs.scriptVersion = version
                runOnUiThread {
                    handleLog("🔄 Hot-reload v${version.take(12)}", "system")
                    injectScript(script)
                }
            },
            onLog = { msg -> runOnUiThread { handleLog(msg, "system") } },
        )
        socketClient.connect()
    }

    // ── Script manager ────────────────────────────────────────────────────────

    private fun setupScriptManager() {
        scriptManager = ScriptManager(
            onUpdate = { script, version ->
                currentScript = script
                BotPrefs.cachedScript  = script
                BotPrefs.scriptVersion = version
                runOnUiThread {
                    handleLog("📦 Script v${version.take(12)}", "system")
                    webView.evaluateJavascript("document.readyState") { state ->
                        if (state?.contains("complete") == true) injectScript(script)
                    }
                }
            },
            onLog = { msg -> runOnUiThread { handleLog(msg, "system") } },
        )
        scriptManager.start()
    }

    // ── Event handlers ────────────────────────────────────────────────────────

    private fun handleLog(msg: String, type: String) {
        setStatus(msg)
        socketClient.sendLog(msg, type)
    }

    private fun handleStats(obj: JSONObject) {
        val wins   = obj.optInt("wins", 0)
        val losses = obj.optInt("losses", 0)
        val total  = wins + losses
        val wr     = if (total > 0) wins * 100.0 / total else 0.0
        setStatus("W:$wins L:$losses WR:${"%.1f".format(wr)}%")
        socketClient.sendStats(JSONObject().apply {
            put("wins",    wins)
            put("losses",  losses)
            put("total",   total)
            put("winRate", wr)
            put("balance", obj.optDouble("balance", 0.0))
        })
    }

    private fun handleTrade(obj: JSONObject) = socketClient.sendTrade(obj)

    private fun handleStatus(s: String) {
        setStatus(s)
        socketClient.sendStatus(s)
    }

    private fun handleBotReady() {
        handleLog("🤖 Bot ready", "system")
        socketClient.sendStatus("IDLE")
    }

    private fun executeCommand(cmd: String, payload: JSONObject?) {
        val js = when (cmd) {
            "start"      -> "window.__SUPREME_CMD__='start';"
            "stop"       -> "window.__SUPREME_CMD__='stop';"
            "pause"      -> "window.__SUPREME_CMD__='pause';"
            "set_amount" -> "window.__SUPREME_AMOUNT__=${payload?.optDouble("amount", 1.0) ?: 1.0};"
            else         -> null
        }
        js?.let { webView.evaluateJavascript(it, null) }
        handleLog("▶ $cmd", "system")
    }

    private fun injectScript(script: String) {
        val cleaned = "(function(){\n" +
            script.replace(Regex("""// ==UserScript==[\s\S]*?// ==/UserScript=="""), "") +
            "\n})();"
        webView.evaluateJavascript(cleaned) { handleLog("🤖 Script injected", "system") }
    }

    // ── UI ────────────────────────────────────────────────────────────────────

    private fun setStatus(msg: String) = runOnUiThread {
        statusBar.text = msg.take(120)
    }

    private fun showSettings() {
        AlertDialog.Builder(this)
            .setTitle("⚙️ الإعدادات")
            .setMessage("Server:\n${BotPrefs.serverWsUrl}\n\nScript:\n${BotPrefs.scriptUrl}")
            .setPositiveButton("Server URL") { _, _ ->
                showEditDialog("Server WS URL", BotPrefs.serverWsUrl) { BotPrefs.serverWsUrl = it }
            }
            .setNeutralButton("Script URL") { _, _ ->
                showEditDialog("Script URL", BotPrefs.scriptUrl) { BotPrefs.scriptUrl = it }
            }
            .setNegativeButton("إغلاق", null)
            .show()
    }

    private fun showEditDialog(title: String, current: String, onSave: (String) -> Unit) {
        val input = EditText(this).apply { setText(current) }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setView(input)
            .setPositiveButton("حفظ") { _, _ -> onSave(input.text.toString().trim()) }
            .setNegativeButton("إلغاء", null)
            .show()
    }

    // ── Persistent notification (keeps screen on / reminds user) ──────────────

    private fun showPersistentNotification() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel("bot", "Supreme Bot", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "Bot is running" }
            )
        }
        val n = NotificationCompat.Builder(this, "bot")
            .setContentTitle("⚡ Supreme Bot")
            .setContentText("Bot is active")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build()
        nm.notify(1, n)
    }
}
