package com.supremebot

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.*
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.*
import java.net.URLEncoder

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val HOME_URL = "https://pocketoption.com/en/cabinet/demo-quick-high-low/"
        private const val CHECK_INTERVAL_MS = 5 * 60 * 1000L
    }

    private lateinit var webView: WebView
    private lateinit var statusText: TextView
    private lateinit var btnRefreshScript: TextView
    private lateinit var urlBar: EditText
    private lateinit var lockIcon: TextView
    private lateinit var btnBack: TextView
    private lateinit var btnForward: TextView
    private lateinit var btnReload: TextView
    private lateinit var btnHome: TextView
    private lateinit var btnMore: TextView
    private lateinit var btnOverflowTop: TextView
    private lateinit var connectionDot: android.view.View
    private lateinit var countdownText: TextView
    private lateinit var claudePanel: FrameLayout
    private lateinit var claudeWebView: WebView

    private var botService: BotService? = null
    private var serviceConnected = false
    private var webViewClient: BotWebViewClient? = null
    private var scriptManager: ScriptManager? = null
    private var extManager: ExtensionManager? = null

    private val mainScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val handler = Handler(Looper.getMainLooper())
    private var countdownRunnable: Runnable? = null
    private var dotPollRunnable: Runnable? = null

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val b = binder as? BotService.LocalBinder ?: return
            botService = b.getService()
            serviceConnected = true
            Log.i(TAG, "Service connected")
            setupServiceCallbacks()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            botService = null
            serviceConnected = false
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        extManager = ExtensionManager(this)

        webView = findViewById(R.id.webView)
        statusText = findViewById(R.id.statusText)
        btnRefreshScript = findViewById(R.id.btnRefreshScript)
        urlBar = findViewById(R.id.urlBar)
        lockIcon = findViewById(R.id.lockIcon)
        btnBack = findViewById(R.id.btn_back)
        btnForward = findViewById(R.id.btn_forward)
        btnReload = findViewById(R.id.btn_reload)
        btnHome = findViewById(R.id.btn_home)
        btnMore = findViewById(R.id.btn_more)
        btnOverflowTop = findViewById(R.id.btnOverflowTop)
        connectionDot = findViewById(R.id.connectionDot)
        countdownText = findViewById(R.id.countdownText)
        claudePanel = findViewById(R.id.claudePanel)
        claudeWebView = findViewById(R.id.claudeWebView)

        findViewById<TextView>(R.id.btnClaudeClose).setOnClickListener {
            claudePanel.visibility = android.view.View.GONE
        }
        setupClaudeWebView()

        setupButtons()

        BotPrefs.init(applicationContext)
        setupWebView()

        BotService.start(this)
        bindService(
            Intent(this, BotService::class.java),
            serviceConnection,
            BIND_AUTO_CREATE
        )

        startScriptManager()
        startCountdownTicker()
        startDotPoller()
    }

    private fun setupButtons() {
        btnRefreshScript.setOnClickListener {
            btnRefreshScript.isEnabled = false
            btnRefreshScript.alpha = 0.3f
            statusText.text = "Updating script..."
            scriptManager?.forceRefresh()
            btnRefreshScript.postDelayed({
                btnRefreshScript.isEnabled = true
                btnRefreshScript.alpha = 1f
            }, 3000)
        }

        urlBar.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_GO ||
                event?.keyCode == KeyEvent.KEYCODE_ENTER) {
                navigateTo(urlBar.text.toString().trim())
                hideKeyboard()
                true
            } else false
        }

        btnBack.setOnClickListener {
            if (webView.canGoBack()) webView.goBack()
        }
        btnForward.setOnClickListener {
            if (webView.canGoForward()) webView.goForward()
        }
        btnReload.setOnClickListener { webView.reload() }
        btnHome.setOnClickListener { webView.loadUrl(HOME_URL) }

        btnMore.setOnClickListener { showOverflowMenu(btnMore) }
        btnOverflowTop.setOnClickListener { showOverflowMenu(btnOverflowTop) }
    }

    private fun showOverflowMenu(anchor: android.view.View) {
        val popup = PopupMenu(this, anchor)
        popup.menu.apply {
            add(0, 1, 0, "🔧 DevTools")
            add(0, 2, 0, "🧩 Extensions")
            add(0, 3, 0, "🤖 Claude AI")
            add(0, 4, 0, "🏠 Home")
        }
        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> { toggleDevTools(); true }
                2 -> {
                    startActivity(Intent(this, ExtensionManagerActivity::class.java))
                    true
                }
                3 -> { toggleClaudePanel(); true }
                4 -> { webView.loadUrl(HOME_URL); true }
                else -> false
            }
        }
        popup.show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupClaudeWebView() {
        claudeWebView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            userAgentString = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        claudeWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?, request: WebResourceRequest?
            ) = false
        }
        claudeWebView.loadUrl("https://claude.ai")
    }

    private fun toggleClaudePanel() {
        claudePanel.visibility = if (claudePanel.visibility == android.view.View.VISIBLE)
            android.view.View.GONE else android.view.View.VISIBLE
    }

    private fun navigateTo(input: String) {
        val url = when {
            input.startsWith("http://") || input.startsWith("https://") -> input
            input.contains(".") -> "https://$input"
            else -> "https://www.google.com/search?q=${URLEncoder.encode(input, "UTF-8")}"
        }
        webView.loadUrl(url)
    }

    private fun toggleDevTools() {
        val js = """
            (function(){
                if(window.__eruda_loaded__){
                    typeof eruda!=='undefined' && (eruda._isShow ? eruda.hide() : eruda.show());
                    return;
                }
                window.__eruda_loaded__=true;
                var s=document.createElement('script');
                s.src='https://cdn.jsdelivr.net/npm/eruda/eruda.min.js';
                s.onload=function(){eruda.init();eruda.show();};
                document.head.appendChild(s);
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            userAgentString = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        }

        WebView.setWebContentsDebuggingEnabled(false)

        val em = extManager
        val wvc = BotWebViewClient(
            onPageReady = { Log.i(TAG, "Page ready") },
            getExtensions = { url -> em?.getScriptsForUrl(url) ?: emptyList() },
            onUrlChanged = { url ->
                runOnUiThread {
                    urlBar.setText(url)
                    lockIcon.text = if (url.startsWith("https")) "🔒" else "🔓"
                    updateNavButtons()
                }
            }
        )
        webViewClient = wvc
        webView.webViewClient = wvc

        webView.loadUrl(HOME_URL)
    }

    private fun updateNavButtons() {
        btnBack.alpha = if (webView.canGoBack()) 1f else 0.35f
        btnForward.alpha = if (webView.canGoForward()) 1f else 0.35f
    }

    private fun setupServiceCallbacks() {
        val service = botService ?: return

        val bridge = AndroidBridge(service)
        webView.addJavascriptInterface(bridge, AndroidBridge.JS_INTERFACE_NAME)

        service.onStatusUpdate = { status ->
            runOnUiThread { statusText.text = status }
        }

        service.onScriptReloaded = { script, version ->
            Log.i(TAG, "New script from server: $version")
            runOnUiThread {
                webViewClient?.cachedScript = script
                webViewClient?.scriptVersion = version
                webView.evaluateJavascript("document.readyState") { state ->
                    if (state?.contains("complete") == true || state?.contains("interactive") == true) {
                        webViewClient?.injectScript(webView, script)
                    }
                }
            }
        }

        service.onCommandReceived = { cmd, _ ->
            runOnUiThread {
                webViewClient?.sendCommand(webView, cmd)
                Toast.makeText(this, "Command: $cmd", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun startScriptManager() {
        scriptManager = ScriptManager(
            onUpdate = { script, version ->
                Log.i(TAG, "Script updated: $version")
                webViewClient?.cachedScript = script
                webViewClient?.scriptVersion = version
                BotPrefs.cachedScript = script
                BotPrefs.scriptVersion = version
                webView.evaluateJavascript("document.readyState") { state ->
                    if (state?.contains("complete") == true || state?.contains("interactive") == true) {
                        webViewClient?.injectScript(webView, script)
                    }
                }
                runOnUiThread {
                    statusText.text = "Script v${version?.take(12) ?: "?"}"
                }
            },
            onChecked = {
                runOnUiThread { Log.d(TAG, "Script poll done") }
            }
        ).also {
            it.start(BotPrefs.cachedScript, BotPrefs.scriptVersion)
        }
    }

    private fun startCountdownTicker() {
        var lastCheckMs = System.currentTimeMillis()
        val tick = object : Runnable {
            override fun run() {
                val elapsed = System.currentTimeMillis() - lastCheckMs
                val remaining = (CHECK_INTERVAL_MS - elapsed).coerceAtLeast(0)
                val mins = (remaining / 60000).toInt()
                val secs = ((remaining % 60000) / 1000).toInt()
                countdownText.text = "%d:%02d".format(mins, secs)
                if (remaining == 0L) lastCheckMs = System.currentTimeMillis()
                handler.postDelayed(this, 1000)
            }
        }
        countdownRunnable = tick
        handler.post(tick)
    }

    private fun startDotPoller() {
        val poll = object : Runnable {
            override fun run() {
                val connected = botService?.isConnected() ?: false
                val color = if (connected) 0xFF00FF88.toInt() else 0xFFFF4444.toInt()
                (connectionDot.background as? GradientDrawable)?.setColor(color)
                    ?: connectionDot.setBackgroundColor(color)
                handler.postDelayed(this, 2000)
            }
        }
        dotPollRunnable = poll
        handler.post(poll)
    }

    private fun hideKeyboard() {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(urlBar.windowToken, 0)
    }

    override fun onDestroy() {
        mainScope.cancel()
        scriptManager?.stop()
        countdownRunnable?.let { handler.removeCallbacks(it) }
        dotPollRunnable?.let { handler.removeCallbacks(it) }
        if (serviceConnected) unbindService(serviceConnection)
        webView.destroy()
        claudeWebView.destroy()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        when {
            claudePanel.visibility == android.view.View.VISIBLE ->
                claudePanel.visibility = android.view.View.GONE
            webView.canGoBack() -> webView.goBack()
            else -> super.onBackPressed()
        }
    }
}
