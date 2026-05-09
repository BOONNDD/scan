package com.supremebot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Starts BotService automatically after the device boots.
 * Requires RECEIVE_BOOT_COMPLETED permission in the manifest.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            BotService.start(context)
        }
    }
}
