package com.zaycomm.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import android.view.Gravity
import android.widget.FrameLayout
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Stage 2 QR scanner foundation.
 *
 * CameraX owns preview/frame delivery and ML Kit performs QR decoding. Valid
 * Zaycomm payloads are emitted to React Native as scanner events.
 */
class ZaycommCameraScannerModule(
    private val context: ReactApplicationContext
) : ReactContextBaseJavaModule(context) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val scanner = BarcodeScanning.getClient()
    private var lastEmittedPayload: String? = null
    private var previewContainer: FrameLayout? = null

    override fun getName(): String = "ZaycommCameraScanner"

    private fun emitQrDetected(raw: String) {
        if (raw == lastEmittedPayload) return
        lastEmittedPayload = raw
        val payload = Arguments.createMap().apply {
            putString("payload", raw)
            putInt("length", raw.length)
        }
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("ZaycommQrDetected", payload)
        Log.d("ZaycommCamera", "QR_EVENT_EMITTED • length=${raw.length}")
    }

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

                val preview = Preview.Builder().build()
                val previewView = PreviewView(context).apply {
                    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                    scaleType = PreviewView.ScaleType.FILL_CENTER
                    contentDescription = "Zaycomm QR camera preview"
                }
                preview.setSurfaceProvider(previewView.surfaceProvider)

                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                analysis.setAnalyzer(executor) { imageProxy ->
                    val mediaImage = imageProxy.image
                    if (mediaImage == null) {
                        imageProxy.close()
                        return@setAnalyzer
                    }
                    val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                    scanner.process(image)
                        .addOnSuccessListener { barcodes ->
                            for (barcode in barcodes) {
                                if (barcode.format == Barcode.FORMAT_QR_CODE) {
                                    val raw = barcode.rawValue
                                    if (!raw.isNullOrEmpty()) {
                                        val valid = isZaycommQrPayload(raw)
                                        Log.d("ZaycommCamera", "QR_DETECTED • length=${raw.length} • zaycomm=$valid")
                                        if (valid) emitQrDetected(raw)
                                    }
                                }
                            }
                        }
                        .addOnFailureListener { error -> Log.e("ZaycommCamera", "QR_DECODE_ERROR", error) }
                        .addOnCompleteListener { imageProxy.close() }
                }

                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)

                ContextCompat.getMainExecutor(context).execute {
                    val container = FrameLayout(context).apply {
                        setBackgroundColor(android.graphics.Color.BLACK)
                        addView(previewView, FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT,
                            FrameLayout.LayoutParams.MATCH_PARENT
                        ))
                    }
                    previewContainer?.let { existing -> (existing.parent as? android.view.ViewGroup)?.removeView(existing) }
                    val params = FrameLayout.LayoutParams(320, 320).apply {
                        gravity = Gravity.CENTER_HORIZONTAL
                        topMargin = 120
                    }
                    activity.addContentView(container, params)
                    previewContainer = container
                }

                Log.d("ZaycommCamera", "ANALYSIS_READY")
                promise.resolve(true)
            } catch (t: Throwable) {
                Log.e("ZaycommCamera", "ANALYSIS_PREPARE_ERROR", t)
                promise.reject("ANALYSIS_PREPARE_ERROR", t.message, t)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun isZaycommQrPayload(raw: String): Boolean {
        if (raw.length !in 32..4096) return false
        if (!raw.startsWith("{")) return false
        if (!raw.endsWith("}")) return false
        return raw.contains("\"scheme\":\"zaycomm\"") &&
            raw.contains("\"version\":1") &&
            raw.contains("\"nodeId\"") &&
            raw.contains("\"publicKey\"")
    }

    @ReactMethod
    fun release(promise: Promise) {
        Log.d("ZaycommCamera", "SCANNER_RELEASE")
        lastEmittedPayload = null
        previewContainer?.let { container -> (container.parent as? android.view.ViewGroup)?.removeView(container) }
        previewContainer = null
        ProcessCameraProvider.getInstance(context).get().unbindAll()
        promise.resolve(null)
    }

    override fun invalidate() {
        previewContainer?.let { container -> (container.parent as? android.view.ViewGroup)?.removeView(container) }
        previewContainer = null
        executor.shutdownNow()
        scanner.close()
        super.invalidate()
    }
}
