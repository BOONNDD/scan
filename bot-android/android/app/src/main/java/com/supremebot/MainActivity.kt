package com.supremebot

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.ServiceConnection
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import android.webkit.*
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.*

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val POCKET_OPTION_URL = "https://pocketoption.com/en/cabinet/demo-quick-high-low/"
    }

    private lateinit var webView: WebView
    private lateinit var statusText: TextView
    private lateinit var btnRefreshScript: TextView

    private var botService: BotService? = null
    private var serviceConnected = false
    private var webViewClient: BotWebViewClient? = null
    private var scriptManager: ScriptManager? = null

    private val mainScope = CoroutineScope(Dispatchers.Main + SupervisorJob())

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

        webView = findViewById(R.id.webView)
        statusText = findViewById(R.id.statusText)
        btnRefreshScript = findViewById(R.id.btnRefreshScript)

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

        BotPrefs.init(applicationContext)
        setupWebView()

        BotService.start(this)
        bindService(
            android.content.Intent(this, BotService::class.java),
            serviceConnection,
            BIND_AUTO_CREATE
        )

        startScriptManager()
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

        val wvc = BotWebViewClient(
            onPageReady = { Log.i(TAG, "Page ready for trading") }
        )
        webViewClient = wvc
        webView.webViewClient = wvc

        webView.loadUrl(POCKET_OPTION_URL)
    }

    private fun setupServiceCallbacks() {
        val service = botService ?: return

        val bridge = AndroidBridge(service)
        webView.addJavascriptInterface(bridge, AndroidBridge.JS_INTERFACE_NAME)

        service.onStatusUpdate = { status ->
            statusText.text = "Status: $status"
        }

        service.onScriptReloaded = { script, version ->
            Log.i(TAG, "New script from server: $version")
            webViewClient?.cachedScript = script
            webViewClient?.scriptVersion = version
            webView.evaluateJavascript("document.readyState") { state ->
                if (state?.contains("complete") == true || state?.contains("interactive") == true) {
                    webViewClient?.injectScript(webView, script)
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
                    statusText.text = "Script updated: ${version?.take(12) ?: "unknown"}"
                }
            },
            onChecked = {
                runOnUiThread {
                    Log.d(TAG, "Script poll check done")
                }
            }
        ).also {
            it.start(BotPrefs.cachedScript, BotPrefs.scriptVersion)
        }
    }

    override fun onDestroy() {
        mainScope.cancel()
        scriptManager?.stop()
        if (serviceConnected) unbindService(serviceConnection)
        webView.destroy()
        super.onDestroy()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
