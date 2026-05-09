package com.supremebot

import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject

class AndroidBridge(private val service: BotService) {

    companion object {
        private const val TAG = "AndroidBridge"
        const val JS_INTERFACE_NAME = "Android"
    }

    @JavascriptInterface
    fun onLog(type: String, message: String, extra: String) {
        Log.d(TAG, "[$type] $message${if (extra.isNotEmpty()) " | $extra" else ""}")
        service.sendLog(type, message, extra.ifEmpty { null })
    }

    @JavascriptInterface
    fun onTrade(dataJson: String) {
        try {
            val data = JSONObject(dataJson)
            service.sendTrade(
                signal = data.optString("signal", "BUY"),
                asset = data.optString("asset", "UNKNOWN"),
                amount = data.optDouble("amount", 1.0),
                patternCase = data.optString("patternCase").takeIf { it.isNotEmpty() },
                confluence = if (data.has("confluence")) data.optDouble("confluence") else null,
                isTVE = data.optBoolean("isTVE", false),
                isDouble = data.optBoolean("isDouble", false)
            )
        } catch (e: Exception) {
            Log.e(TAG, "Trade parse error", e)
        }
    }

    @JavascriptInterface
    fun onStatus(dataJson: String) {
        try {
            val data = JSONObject(dataJson)
            service.sendStatus(
                status = data.optString("tradingStatus", "IDLE"),
                asset = data.optString("activeAsset").takeIf { it.isNotEmpty() },
                period = if (data.has("candlePeriod")) data.optInt("candlePeriod") else null,
                balance = if (data.has("accountBalance")) data.optDouble("accountBalance") else null,
                isDemo = data.optBoolean("isDemo", false)
            )
        } catch (e: Exception) {
            Log.e(TAG, "Status parse error", e)
        }
    }
}
