package com.zaycomm.mobile

import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Stage 2 QR scanner foundation.
 *
 * This first native scanner step deliberately opens no preview and performs no
 * barcode decoding. It only proves that CameraX can create a camera provider,
 * select the back camera, and bind a lifecycle-safe camera session later.
 */
class ZaycommCameraScannerModule(
    private val context: ReactApplicationContext
) : ReactContextBaseJavaModule(context) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()

    override fun getName(): String = "ZaycommCameraScanner"

    @ReactMethod
    fun prepare(promise: Promise) {
        Log.d("ZaycommCamera", "SCANNER_PREPARE_START")
        try {
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener({
                try {
                    val provider = future.get()
                    val hasBackCamera = provider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)
                    Log.d("ZaycommCamera", "SCANNER_CAMERA_PROVIDER_READY • backCamera=$hasBackCamera")
                    promise.resolve(hasBackCamera)
                } catch (t: Throwable) {
                    Log.e("ZaycommCamera", "SCANNER_PREPARE_ERROR", t)
                    promise.reject("SCANNER_PREPARE_ERROR", t.message, t)
                }
            }, ContextCompat.getMainExecutor(context))
        } catch (t: Throwable) {
            Log.e("ZaycommCamera", "SCANNER_PREPARE_ERROR", t)
            promise.reject("SCANNER_PREPARE_ERROR", t.message, t)
        }
    }

    @ReactMethod
    fun release(promise: Promise) {
        Log.d("ZaycommCamera", "SCANNER_RELEASE")
        promise.resolve(null)
    }

    override fun invalidate() {
        executor.shutdownNow()
        super.invalidate()
    }
}
