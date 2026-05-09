package com.supremebot

import android.annotation.SuppressLint
import android.app.*
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.webkit.*
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView      : WebView
    private lateinit var statusBar    : TextView
    private lateinit var socketClient : BotSocketClient
    private lateinit var scriptManager: ScriptManager

    private var currentScript  : String? = null
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        BotPrefs.init(applicationContext)
        createNotificationChannel()

        webView   = findViewById(R.id.webview)
        statusBar = findViewById(R.id.status_bar)

        setupWebView()
        setupSocketClient()
        setupScriptManager()

        // Load Pocket Option
        webView.loadUrl("https://pocketoption.com/en/login/")

        startForegroundNotification()
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        socketClient.disconnect()
        scriptManager.stop()
    }

    // ── Menu ──────────────────────────────────────────────────────────────────

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(Menu.NONE, 1, Menu.NONE, "⚙️ الإعدادات")
        menu.add(Menu.NONE, 2, Menu.NONE, "🔄 تحديث السكربت")
        menu.add(Menu.NONE, 3, Menu.NONE, "🔁 إعادة تحميل الصفحة")
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

    // ── WebView setup ─────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled      = true
        settings.domStorageEnabled      = true
        settings.databaseEnabled        = true
        settings.mixedContentMode       = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.userAgentString        = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"
        settings.allowContentAccess     = true
        settings.loadsImagesAutomatically = true
        settings.mediaPlaybackRequiresUserGesture = false

        // JS interface — accessible as window.Android in JS
        val jsInterface = BotJsInterface(
            onLog    = { msg, type -> handleLog(msg, type) },
            onStats  = { obj       -> handleStats(obj)     },
            onTrade  = { obj       -> handleTrade(obj)     },
            onStatus = { s         -> handleStatus(s)      },
            onReady  = {             handleBotReady()      },
        )
        webView.addJavascriptInterface(jsInterface, "Android")

        webView.webViewClient = BotWebViewClient(
            getScript = { currentScript },
            onLog     = { msg -> handleLog(msg, "system") },
        )

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                // Capture console.log from the bot
                val level = when (m.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR -> "error"
                    ConsoleMessage.MessageLevel.WARNING -> "warn"
                    else -> "debug"
                }
                // Only relay logs that look like bot logs (contain emoji or keywords)
                val msg = m.message()
                if (msg.contains("SUPREME") || msg.contains("TVE") ||
                    msg.contains("WIN") || msg.contains("LOSS") ||
                    msg.startsWith("❌") || msg.startsWith("✅") ||
                    msg.startsWith("🔔") || msg.startsWith("📊")) {
                    handleLog(msg, level)
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
                BotPrefs.cachedScript   = script
                BotPrefs.scriptVersion  = version
                runOnUiThread {
                    handleLog("🔄 Hot-reloading script v${version.take(12)}", "system")
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
                BotPrefs.cachedScript   = script
                BotPrefs.scriptVersion  = version
                runOnUiThread {
                    handleLog("📦 Script ready: ${version.take(12)}", "system")
                    // If page is already loaded, inject immediately
                    webView.evaluateJavascript("document.readyState", { state ->
                        if (state?.contains("complete") == true || state?.contains("interactive") == true) {
                            injectScript(script)
                        }
                    })
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
        val wins    = obj.optInt("wins", 0)
        val losses  = obj.optInt("losses", 0)
        val total   = wins + losses
        val wr      = if (total > 0) wins * 100.0 / total else 0.0
        setStatus("W:$wins L:$losses WR:${"%.1f".format(wr)}%")

        val statsForServer = JSONObject().apply {
            put("wins",    wins)
            put("losses",  losses)
            put("total",   total)
            put("winRate", wr)
            put("balance", obj.optDouble("balance", 0.0))
        }
        socketClient.sendStats(statsForServer)
    }

    private fun handleTrade(obj: JSONObject) {
        socketClient.sendTrade(obj)
    }

    private fun handleStatus(s: String) {
        setStatus(s)
        socketClient.sendStatus(s)
    }

    private fun handleBotReady() {
        handleLog("🤖 Bot initialized and ready", "system")
        socketClient.sendStatus("IDLE")
    }

    private fun executeCommand(cmd: String, payload: JSONObject?) {
        val js = when (cmd) {
            "start"      -> "window.__SUPREME_CMD__ = 'start';"
            "stop"       -> "window.__SUPREME_CMD__ = 'stop';"
            "pause"      -> "window.__SUPREME_CMD__ = 'pause';"
            "set_amount" -> "window.__SUPREME_AMOUNT__ = ${payload?.optDouble("amount", 1.0) ?: 1.0};"
            else         -> null
        }
        js?.let { webView.evaluateJavascript(it, null) }
        handleLog("▶ Command: $cmd", "system")
    }

    private fun injectScript(script: String) {
        val cleaned = "(function(){\n" +
            script.replace(Regex("""// ==UserScript==[\s\S]*?// ==/UserScript=="""), "") +
            "\n})();"
        webView.evaluateJavascript(cleaned) { result ->
            handleLog("🤖 Script re-injected: $result", "system")
        }
    }

    // ── UI ────────────────────────────────────────────────────────────────────

    private fun setStatus(msg: String) {
        runOnUiThread {
            statusBar.text = msg.take(120)
        }
    }

    private fun showSettings() {
        val view   = layoutInflater.inflate(android.R.layout.simple_list_item_2, null)
        val dialog = AlertDialog.Builder(this)
            .setTitle("⚙️ الإعدادات")
            .setMessage("Server URL الحالي:\n${BotPrefs.serverWsUrl}\n\nScript URL:\n${BotPrefs.scriptUrl}")
            .setPositiveButton("تعديل Server URL") { _, _ -> showEditDialog("Server WS URL", BotPrefs.serverWsUrl) { BotPrefs.serverWsUrl = it } }
            .setNeutralButton("تعديل Script URL")  { _, _ -> showEditDialog("Script URL",    BotPrefs.scriptUrl)   { BotPrefs.scriptUrl   = it } }
            .setNegativeButton("إغلاق", null)
            .create()
        dialog.show()
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

    // ── Foreground notification (keeps app alive) ─────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel("bot_channel", "Supreme Bot", NotificationManager.IMPORTANCE_LOW)
            ch.description = "Bot running in background"
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    private fun startForegroundNotification() {
        val notification = NotificationCompat.Builder(this, "bot_channel")
            .setContentTitle("⚡ Supreme Bot Running")
            .setContentText("Trading bot is active")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build()
        startForeground(1, notification)
    }
}
