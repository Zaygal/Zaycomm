package com.zaycomm.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.*

class ZaycommNotificationModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object {
        private const val MODULE = "ZaycommNotifications"
        const val CHANNEL_MESSAGES = "zaycomm.messages"
        const val CHANNEL_CONNECTIONS = "zaycomm.connections"
        const val CHANNEL_SECURITY = "zaycomm.security"
    }

    override fun getName() = MODULE
    private fun manager() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun ensureChannels() {
        if (Build.VERSION.SDK_INT < 26) return
        val m = manager()
        m.createNotificationChannel(NotificationChannel(CHANNEL_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH).apply { description = "New Zaycomm messages" })
        m.createNotificationChannel(NotificationChannel(CHANNEL_CONNECTIONS, "Connections", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Nearby node and secure link events" })
        m.createNotificationChannel(NotificationChannel(CHANNEL_SECURITY, "Security", NotificationManager.IMPORTANCE_HIGH).apply { description = "Zaycomm security events" })
    }

    @ReactMethod
    fun createChannels(promise: Promise) { ensureChannels(); promise.resolve(null) }

    @ReactMethod
    fun showNotification(id: Int, channel: String, title: String, body: String, promise: Promise) {
        try {
            ensureChannels()
            val builder = NotificationCompat.Builder(context, channel)
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(if (channel == CHANNEL_MESSAGES || channel == CHANNEL_SECURITY) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            manager().notify(id, builder.build())
            promise.resolve(null)
        } catch (e: Exception) { promise.reject("NOTIFICATION_ERROR", e.message ?: "Unable to show notification") }
    }

    @ReactMethod
    fun cancelNotification(id: Int) { manager().cancel(id) }

    @ReactMethod
    fun openNotificationSettings() {
        val intent = if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply { putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName) }
        else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
