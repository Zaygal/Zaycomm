package com.zaycomm.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ZaycommNotificationModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object {
        private const val MODULE = "ZaycommNotifications"
        const val CHANNEL_MESSAGES = "zaycomm.messages"
        const val CHANNEL_CONNECTIONS = "zaycomm.connections"
        const val CHANNEL_SECURITY = "zaycomm.security"
    }

    override fun getName(): String = MODULE

    private fun manager(): NotificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val notificationManager = manager()
        notificationManager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_MESSAGES,
                "Messages",
                NotificationManager.IMPORTANCE_HIGH
            ).apply { description = "New Zaycomm messages" }
        )
        notificationManager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_CONNECTIONS,
                "Connections",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "Nearby node and secure link events" }
        )
        notificationManager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_SECURITY,
                "Security",
                NotificationManager.IMPORTANCE_HIGH
            ).apply { description = "Zaycomm security events" }
        )
    }

    @ReactMethod
    fun createChannels(promise: Promise) {
        try {
            ensureChannels()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("NOTIFICATION_CHANNEL_ERROR", e)
        }
    }

    @ReactMethod
    fun showNotification(
        id: Int,
        channel: String,
        title: String,
        body: String,
        promise: Promise
    ) {
        try {
            ensureChannels()
            val priority = if (
                channel == CHANNEL_MESSAGES || channel == CHANNEL_SECURITY
            ) {
                NotificationCompat.PRIORITY_HIGH
            } else {
                NotificationCompat.PRIORITY_DEFAULT
            }

            val notification = NotificationCompat.Builder(context, channel)
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(priority)
                .build()

            manager().notify(id, notification)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject(
                "NOTIFICATION_ERROR",
                e.message ?: "Unable to show notification",
                e
            )
        }
    }

    @ReactMethod
    fun cancelNotification(id: Int) {
        manager().cancel(id)
    }

    @ReactMethod
    fun openNotificationSettings() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            }
        } else {
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:${context.packageName}")
            )
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
