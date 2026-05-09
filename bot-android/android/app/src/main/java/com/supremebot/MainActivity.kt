package com.supremebot

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.IBinder
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.*
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import kotlinx.coroutines.*
import org.json.JSONObject

/**
 * Optional UI shell — pure browser WebView + status display.
 * All trading logic lives in BotService.
 * Closing this Activity does NOT stop the bot.
 */
class MainActivity : AppCompatActivity(), ServiceConnection {

    // ── Views ─────────────────────────────────────────────────────────────────
    private lateinit var webView      : WebView
    private lateinit var statusBar    : TextView
    private lateinit var connDot      : View
    private lateinit var updateTimer  : TextView
    private lateinit var swipeRefresh : SwipeRefreshLayout
    private lateinit var urlBar       : EditText
    private lateinit var btnBack      : TextView
    private lateinit var btnForward   : TextView

    // ── Service binding ───────────────────────────────────────────────────────
    private var botService: BotService? = null
    private var isBound = false

    // ── Extension manager (used by browser WebView only) ──────────────────────
    private lateinit var extManager: ExtensionManager

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        BotPrefs.init(applicationContext)
        extManager = ExtensionManager(this)

        webView      = findViewById(R.id.webview)
        statusBar    = findViewById(R.id.status_bar)
        connDot      = findViewById(R.id.conn_dot)
        updateTimer  = findViewById(R.id.update_timer)
        swipeRefresh = findViewById(R.id.swipe_refresh)
        urlBar       = findViewById(R.id.url_bar)
        btnBack      = findViewById(R.id.btn_back)
        btnForward   = findViewById(R.id.btn_forward)

        swipeRefresh.setColorSchemeColors(0xFF00FF88.toInt())
        swipeRefresh.setProgressBackgroundColorSchemeColor(0xFF111827.toInt())

        setupBrowserWebView()
        setupNavBar()

        swipeRefresh.setOnRefreshListener { webView.reload() }
        findViewById<TextView>(R.id.btn_refresh).setOnClickListener { webView.reload() }
        findViewById<TextView>(R.id.btn_extensions).setOnClickListener {
            startActivity(Intent(this, ExtensionManagerActivity::class.java))
        }
        // DevTools: operate on the SERVICE's trading WebView
        findViewById<TextView>(R.id.btn_devtools).setOnClickListener {
            botService?.toggleDevTools() ?: setStatus("⚠️ Service not bound yet")
        }

        webView.loadUrl("https://pocketoption.com/en/login/")
    }

    /** Bind to service on every start (service keeps running after stop). */
    override fun onStart() {
        super.onStart()
        BotService.start(this)                                   // ensure running
        bindService(Intent(this, BotService::class.java), this, BIND_AUTO_CREATE)
    }

    override fun onStop() {
        super.onStop()
        if (isBound) {
            // Clear callbacks before unbinding so service doesn't call dead views
            botService?.onLog    = null
            botService?.onStats  = null
            botService?.onTrade  = null
            botService?.onStatus = null
            unbindService(this)
            isBound = false
            botService = null
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        webView.destroy()
        // BotService keeps running — intentionally NOT calling stopService()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack(); return true
        }
        return super.onKeyDown(keyCode, event)
    }

    // ── ServiceConnection ─────────────────────────────────────────────────────

    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
        botService = (binder as BotService.LocalBinder).getService()
        isBound    = true

        // Forward service events to UI
        botService?.onLog    = { msg, _   -> runOnUiThread { setStatus(msg) } }
        botService?.onStats  = { obj      -> runOnUiThread { showStats(obj) } }
        botService?.onStatus = { s        -> runOnUiThread { setStatus(s) } }
        botService?.onTrade  = { _        -> /* could flash trade indicator here */ }

        startStatusPolling()
    }

    override fun onServiceDisconnected(name: ComponentName) {
        botService = null
        isBound    = false
    }

    // ── Menu ──────────────────────────────────────────────────────────────────

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, "⚙️ الإعدادات")
        menu.add(0, 2, 0, "🔄 تحديث السكربت")
        menu.add(0, 3, 0, "🏠 Pocket Option")
        menu.add(0, 4, 0, "⛔ إيقاف البوت")
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            1 -> { showSettings(); true }
            2 -> { botService?.forceScriptRefresh(); true }
            3 -> { webView.loadUrl("https://pocketoption.com/en/cabinet/demo-quick-high-low/"); true }
            4 -> { stopService(Intent(this, BotService::class.java)); true }
            else -> super.onOptionsItemSelected(item)
        }
    }

    // ── Browser WebView (pure navigation — no bot script) ─────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupBrowserWebView() {
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

        // Pure browser client: update URL bar + inject user extensions, no bot script
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                swipeRefresh.isRefreshing = false
                urlBar.setText(url)
                updateNavButtons()
                // Inject any user-installed extensions
                extManager.getScriptsForUrl(url).forEach { (name, js) ->
                    view.evaluateJavascript("(function(){/*ext:$name*/\n$js\n})();", null)
                }
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                urlBar.setText(request.url.toString())
                return false
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean = true
        }
    }

    // ── Navigation bar ────────────────────────────────────────────────────────

    private fun setupNavBar() {
        btnBack.setOnClickListener { if (webView.canGoBack()) webView.goBack() }
        btnForward.setOnClickListener { if (webView.canGoForward()) webView.goForward() }

        urlBar.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                navigateTo(urlBar.text.toString().trim()); true
            } else false
        }
        urlBar.setOnFocusChangeListener { _, focused -> if (focused) urlBar.selectAll() }
    }

    private fun navigateTo(input: String) {
        if (input.isBlank()) return
        val url = when {
            input.startsWith("http://") || input.startsWith("https://") -> input
            input.contains(".") -> "https://$input"
            else -> "https://www.google.com/search?q=${java.net.URLEncoder.encode(input, "UTF-8")}"
        }
        webView.loadUrl(url)
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(urlBar.windowToken, 0)
        urlBar.clearFocus()
    }

    private fun updateNavButtons() {
        btnBack.alpha    = if (webView.canGoBack()) 1f else 0.3f
        btnForward.alpha = if (webView.canGoForward()) 1f else 0.3f
    }

    // ── Status polling (conn dot + countdown) ─────────────────────────────────

    private fun startStatusPolling() {
        scope.launch {
            while (isActive) {
                updateConnDot()
                updateCountdown()
                delay(1_000)
            }
        }
    }

    private fun updateConnDot() {
        val connected = botService?.isConnected() ?: false
        (connDot.background as? GradientDrawable)
            ?.setColor(if (connected) 0xFF00FF88.toInt() else 0xFFFF4444.toInt())
    }

    private fun updateCountdown() {
        val svc = botService ?: run { updateTimer.text = "🔄 --:--"; return }
        val remaining = svc.getPollIntervalMs() - (System.currentTimeMillis() - svc.getLastCheckMs())
        if (remaining <= 0) {
            updateTimer.text = "🔄 ..."
        } else {
            val s = (remaining / 1000).toInt()
            updateTimer.text = "🔄 ${s / 60}:%02d".format(s % 60)
        }
    }

    // ── UI helpers ────────────────────────────────────────────────────────────

    private fun setStatus(msg: String) = statusBar.setText(msg.take(120))

    private fun showStats(obj: JSONObject) {
        val wins   = obj.optInt("wins", 0)
        val losses = obj.optInt("losses", 0)
        val total  = wins + losses
        val wr     = if (total > 0) wins * 100.0 / total else 0.0
        setStatus("W:$wins L:$losses WR:${"%.1f".format(wr)}%")
    }

    private fun showSettings() {
        AlertDialog.Builder(this)
            .setTitle("⚙️ الإعدادات")
            .setMessage("Server:\n${BotPrefs.serverWsUrl}\n\nScript:\n${BotPrefs.scriptUrl}")
            .setPositiveButton("Server URL") { _, _ ->
                showEdit("Server WS URL", BotPrefs.serverWsUrl) { BotPrefs.serverWsUrl = it }
            }
            .setNeutralButton("Script URL") { _, _ ->
                showEdit("Script URL", BotPrefs.scriptUrl) { BotPrefs.scriptUrl = it }
            }
            .setNegativeButton("إغلاق", null).show()
    }

    private fun showEdit(title: String, current: String, onSave: (String) -> Unit) {
        val input = EditText(this).apply { setText(current) }
        AlertDialog.Builder(this)
            .setTitle(title).setView(input)
            .setPositiveButton("حفظ") { _, _ -> onSave(input.text.toString().trim()) }
            .setNegativeButton("إلغاء", null).show()
    }
}
