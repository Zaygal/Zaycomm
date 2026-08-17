package com.zaycomm.mobile

import android.app.Application
import android.util.Log
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import io.sentry.Sentry
import io.sentry.SentryLevel
import io.sentry.android.core.SentryAndroid

class MainApplication : Application(), ReactApplication {
    override val reactHost: ReactHost by lazy {
        getDefaultReactHost(
            applicationContext,
            PackageList(this).packages.apply {
                add(ZaycommBlePackage())
            }
        )
    }

    override fun onCreate() {
        super.onCreate()

        // Arm native crash reporting before React Native starts. JS-only Sentry
        // initialization is too late for failures during native startup.
        SentryAndroid.init(this) { options ->
            options.setDsn("https://99202c61c489b29c7786155723317700@o4511926121201664.ingest.de.sentry.io/4511926169632848")
            options.setEnvironment("diagnostic-native")
            options.setRelease("zaycomm@0.1.0+1")
            options.setDebug(true)
            options.setEnabled(true)
            options.setEnableNdk(true)
            options.setEnableUncaughtExceptionHandler(true)
            options.setEnableAutoSessionTracking(true)
            options.setAttachThreads(true)
        }

        // Keep startup diagnostics simple and compatible with the installed
        // Sentry Android SDK. The previous addBreadcrumb lambda did not match
        // this SDK's Kotlin API and caused compile-time failures.
        Log.i("ZaycommStartup", "MainApplication.onCreate reached; native Sentry initialized")
        Sentry.captureMessage("Zaycomm native startup reached", SentryLevel.INFO)

        Log.i("ZaycommStartup", "Loading React Native")
        loadReactNative(this)
    }
}
