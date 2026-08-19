package com.zaycomm.mobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ZaycommBlePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(
            ZaycommBleModule(reactContext),
            ZaycommNotificationModule(reactContext),
            ZaycommCameraDiagnosticsModule(reactContext),
            ZaycommCameraScannerModule(reactContext)
        )

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(
            ZaycommCameraPreviewManager()
        )
}
