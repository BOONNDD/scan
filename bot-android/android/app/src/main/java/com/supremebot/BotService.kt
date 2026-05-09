package com.supremebot

import android.annotation.SuppressLint
import android.app.*
import android.content.Context
import android.content.Intent
import android.os.*
import android.webkit.*
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/**
 * Foreground service that owns the trading WebView and keeps the bot alive:
 *  - Screen off / device locked  → continues trading (PARTIAL_WAKE_LOCK)
 *  - App swiped from Recent Apps → service restarts (START_STICKY)
 *  - Device reboot               → BootReceiver restarts this service
 *
 * MainActivity binds to this service to display status. Closing MainActivity
 * does NOT stop trading.
 */
class BotService : Service() {

    // ── Binder (for MainActivity to get a direct reference) ───────────────────
    inner class LocalBinder : Binder() {
        fun getService(): BotService = this@BotService
    }
    private val binder = LocalBinder()
    override fun onBind(intent: Intent): IBinder = binder

    // ── Fields ────────────────────────────────────────────────────────────────
    private val mainHandler = Handler(Looper.getMainLooper())

    private lateinit var webView      : WebView
    private lateinit var socketClient : BotSocketClient
    private lateinit var scriptManager: ScriptManager
    private lateinit var extManager   : ExtensionManager
    private lateinit var wakeLock     : PowerManager.WakeLock

    var currentScript: String? = null

    // Callbacks → bound MainActivity updates its UI from these
    var onLog   : ((String, String) -> Unit)? = null
    var onStats : ((JSONObject) -> Unit)?      = null
    var onTrade : ((JSONObject) -> Unit)?      = null
    var onStatus: ((String) -> Unit)?          = null

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        BotPrefs.init(applicationContext)
        extManager = ExtensionManager(this)

        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("⚡ Starting…"))
        acquireWakeLock()

        // WebView must be created on the main thread (onCreate IS the main thread)
        setupWebView()
        setupSocketClient()
        setupScriptManager()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY   // system will restart service if killed
    }

    override fun onDestroy() {
        super.onDestroy()
        releaseWakeLock()
        socketClient.disconnect()
        scriptManager.stop()
        mainHandler.post { webView.destroy() }
    }

    // ── Public API (called by bound MainActivity) ─────────────────────────────

    fun isConnected()       : Boolean = socketClient.isConnected()
    fun getLastCheckMs()    : Long    = scriptManager.lastCheckMs
    fun getPollIntervalMs() : Long    = scriptManager.pollIntervalMsPublic

    fun forceScriptRefresh() = scriptManager.forceRefresh()

    fun reloadPage() = mainHandler.post { webView.reload() }

    fun executeCommand(cmd: String, payload: JSONObject?) {
        val js = when (cmd) {
            "start"      -> "window.__SUPREME_CMD__='start';"
            "stop"       -> "window.__SUPREME_CMD__='stop';"
            "pause"      -> "window.__SUPREME_CMD__='pause';"
            "set_amount" -> "window.__SUPREME_AMOUNT__=${payload?.optDouble("amount", 1.0) ?: 1.0};"
            else         -> return
        }
        mainHandler.post { webView.evaluateJavascript(js, null) }
    }

    fun toggleDevTools() {
        val js = """
            (function(){
              if(window.__eruda_loaded__){
                typeof eruda!=='undefined'&&(eruda._isShow?eruda.hide():eruda.show());
                return;
              }
              window.__eruda_loaded__=true;
              var s=document.createElement('script');
              s.src='https://cdn.jsdelivr.net/npm/eruda@latest/eruda.min.js';
              s.onload=function(){eruda.init();eruda.show();};
              document.head.appendChild(s);
            })();
        """.trimIndent()
        mainHandler.post { webView.evaluateJavascript(js, null) }
    }

    // ── WebView (headless — no visible window, JS engine still runs) ──────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView = WebView(applicationContext)
        webView.settings.apply {
            javaScriptEnabled               = true
            domStorageEnabled               = true
            databaseEnabled                 = true
            mixedContentMode                = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString                 = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"
            allowContentAccess              = true
            loadsImagesAutomatically        = false  // headless: skip images, save RAM
            mediaPlaybackRequiresUserGesture = false
        }

        webView.addJavascriptInterface(
            BotJsInterface(
                onLog    = { msg, type -> handleLog(msg, type) },
                onStats  = { obj       -> handleStats(obj) },
                onTrade  = { obj       -> handleTrade(obj) },
                onStatus = { s         -> handleStatus(s) },
                onReady  = {             handleBotReady() },
            ), "Android"
        )

        webView.webViewClient = BotWebViewClient(
            getScript     = { currentScript },
            onLog         = { msg -> handleLog(msg, "system") },
            getExtensions = { url -> extManager.getScriptsForUrl(url) },
        )

        webView.loadUrl("https://pocketoption.com/en/login/")
    }

    // ── Socket client ─────────────────────────────────────────────────────────

    private fun setupSocketClient() {
        socketClient = BotSocketClient(
            onCommand = { cmd, payload ->
                mainHandler.post { executeCommand(cmd, payload) }
            },
            onReloadScript = { script, version ->
                currentScript          = script
                BotPrefs.cachedScript  = script
                BotPrefs.scriptVersion = version
                handleLog("🔄 Hot-reload v${version.take(12)}", "system")
                mainHandler.post { injectScript(script) }
            },
            onLog = { msg -> handleLog(msg, "system") },
        )
        socketClient.connect()
    }

    // ── Script manager ────────────────────────────────────────────────────────

    private fun setupScriptManager() {
        val cached = BotPrefs.cachedScript
        if (cached.isNotEmpty()) currentScript = cached

        scriptManager = ScriptManager(
            onUpdate = { script, version ->
                currentScript          = script
                BotPrefs.cachedScript  = script
                BotPrefs.scriptVersion = version
                handleLog("📦 Script v${version.take(12)}", "system")
                mainHandler.post {
                    webView.evaluateJavascript("document.readyState") { state ->
                        if (state?.contains("complete") == true) injectScript(script)
                    }
                }
            },
            onLog = { msg -> handleLog(msg, "system") },
        )
        scriptManager.start()
    }

    // ── Event handlers ────────────────────────────────────────────────────────

    private fun handleLog(msg: String, type: String) {
        onLog?.invoke(msg, type)
        socketClient.sendLog(msg, type)
        notify(msg.take(60))
    }

    private fun handleStats(obj: JSONObject) {
        val wins   = obj.optInt("wins", 0)
        val losses = obj.optInt("losses", 0)
        val total  = wins + losses
        val wr     = if (total > 0) wins * 100.0 / total else 0.0
        onStats?.invoke(obj)
        socketClient.sendStats(JSONObject().apply {
            put("wins",    wins);  put("losses",  losses)
            put("total",   total); put("winRate", wr)
            put("balance", obj.optDouble("balance", 0.0))
        })
        notify("W:$wins L:$losses WR:${"%.1f".format(wr)}%")
    }

    private fun handleTrade(obj: JSONObject) {
        onTrade?.invoke(obj)
        socketClient.sendTrade(obj)
    }

    private fun handleStatus(s: String) {
        onStatus?.invoke(s)
        socketClient.sendStatus(s)
        notify(s)
    }

    private fun handleBotReady() {
        handleLog("🤖 Bot ready", "system")
        socketClient.sendStatus("IDLE")
    }

    private fun injectScript(script: String) {
        val iife = "(function(){\n" +
            script.replace(Regex("""// ==UserScript==[\s\S]*?// ==/UserScript=="""), "") +
            "\n})();"
        webView.evaluateJavascript(iife) { handleLog("🤖 Script injected", "system") }
    }

    // ── WakeLock ──────────────────────────────────────────────────────────────

    @SuppressLint("WakelockTimeout")
    private fun acquireWakeLock() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "supremebot:trading")
        wakeLock.acquire()   // released in onDestroy
    }

    private fun releaseWakeLock() {
        if (::wakeLock.isInitialized && wakeLock.isHeld) wakeLock.release()
    }

    // ── Notification ──────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Supreme Bot Service", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "Trading bot background service" }
            )
        }
    }

    private fun notify(text: String) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val openPi = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stopPi = PendingIntent.getService(
            this, 1,
            Intent(this, BotService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("⚡ Supreme Bot")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setContentIntent(openPi)
            .addAction(android.R.drawable.ic_delete, "إيقاف البوت", stopPi)
            .build()
    }

    // ── Companion ─────────────────────────────────────────────────────────────

    companion object {
        const val NOTIF_ID   = 42
        const val CHANNEL_ID = "bot_service"
        const val ACTION_STOP = "com.supremebot.STOP"

        /** Start the service the correct way for the API level. */
        fun start(ctx: Context) {
            val intent = Intent(ctx, BotService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ctx.startForegroundService(intent)
            else
                ctx.startService(intent)
        }
    }
}
