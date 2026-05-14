package com.supremebot

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject

class BotService : Service() {

    companion object {
        private const val TAG = "BotService"
        private const val NOTIF_CHANNEL_ID = "supreme_bot"
        private const val NOTIF_ID = 1001

        fun start(ctx: Context) {
            val intent = Intent(ctx, BotService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, BotService::class.java))
        }
    }

    inner class LocalBinder : Binder() {
        fun getService(): BotService = this@BotService
    }

    private val binder = LocalBinder()
    private lateinit var socketClient: BotSocketClient
    private var _isConnected = false

    fun isConnected(): Boolean = _isConnected

    var onStatusUpdate: ((status: String) -> Unit)? = null
    var onLogReceived: ((type: String, message: String) -> Unit)? = null

    override fun onCreate() {
        super.onCreate()
        BotPrefs.init(applicationContext)
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("Supreme Bot running..."))

        socketClient = BotSocketClient(
            serverUrl = BotPrefs.serverUrl,
            onCommand = { cmd, payload -> handleServerCommand(cmd, payload) },
            onReloadScript = { script, version ->
                BotPrefs.cachedScript = script
                BotPrefs.scriptVersion = version
                onScriptReloaded?.invoke(script, version)
            },
            onConnected = {
                _isConnected = true
                Log.i(TAG, "Connected to server")
                updateNotification("Connected to server")
            },
            onDisconnected = {
                _isConnected = false
                Log.i(TAG, "Disconnected from server")
                updateNotification("Disconnected — retrying...")
            }
        )
        socketClient.connect()
    }

    var onScriptReloaded: ((script: String, version: String?) -> Unit)? = null
    var onCommandReceived: ((cmd: String, payload: JSONObject) -> Unit)? = null

    fun sendLog(type: String, message: String, extra: String? = null) {
        socketClient.sendLog(type, message, extra)
        onLogReceived?.invoke(type, message)
    }

    fun sendTrade(
        signal: String, asset: String, amount: Double,
        patternCase: String?, confluence: Double?,
        isTVE: Boolean, isDouble: Boolean
    ) {
        socketClient.sendTrade(signal, asset, amount, patternCase, confluence, isTVE, isDouble)
    }

    fun sendStatus(status: String, asset: String?, period: Int?, balance: Double?, isDemo: Boolean) {
        socketClient.sendStatus(status, asset, period, balance, isDemo)
        updateNotification("Status: $status${asset?.let { " | $it" } ?: ""}")
        onStatusUpdate?.invoke(status)
    }

    private fun handleServerCommand(cmd: String, payload: JSONObject) {
        Log.i(TAG, "Server command: $cmd")
        updateNotification("Command: $cmd")
        onCommandReceived?.invoke(cmd, payload)
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        socketClient.disconnect()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIF_CHANNEL_ID,
                getString(R.string.channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.channel_desc)
            }
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val pi = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, NOTIF_CHANNEL_ID)
            .setContentTitle("Supreme Bot")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_ID, buildNotification(text))
    }
}
