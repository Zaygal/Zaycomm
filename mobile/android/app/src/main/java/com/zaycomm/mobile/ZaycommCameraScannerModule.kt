package com.zaycomm.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
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
 * The analyzer is intentionally introduced before React Native integration:
 * CameraX owns frame delivery and ML Kit owns QR decoding. Payload handling
 * will be added only after this native frame-analysis layer builds cleanly.
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
    fun prepareAnalysis(promise: Promise) {
        Log.d("ZaycommCamera", "ANALYSIS_PREPARE_START")
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Log.d("ZaycommCamera", "ANALYSIS_PREPARE_WAITING_FOR_PERMISSION")
            promise.reject("CAMERA_PERMISSION_REQUIRED", "Camera permission has not been granted")
            return
        }

        val activity = context.currentActivity
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                val provider = future.get()
                val lifecycleOwner = activity as? androidx.lifecycle.LifecycleOwner
                    ?: throw IllegalStateException("Activity is not a LifecycleOwner")

                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                analysis.setAnalyzer(executor) { imageProxy ->
                    // Frame plumbing only. QR decoding is the next isolated change.
                    Log.d("ZaycommCamera", "ANALYSIS_FRAME • ${imageProxy.width}x${imageProxy.height}")
                    imageProxy.close()
                }

                provider.unbindAll()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    Preview.Builder().build(),
                    analysis
                )

                Log.d("ZaycommCamera", "ANALYSIS_READY")
                promise.resolve(true)
            } catch (t: Throwable) {
                Log.e("ZaycommCamera", "ANALYSIS_PREPARE_ERROR", t)
                promise.reject("ANALYSIS_PREPARE_ERROR", t.message, t)
            }
        }, ContextCompat.getMainExecutor(context))
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
