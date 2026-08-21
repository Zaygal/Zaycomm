package com.zaycomm.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
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

class ZaycommCameraScannerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val scanner = BarcodeScanning.getClient()
    @Volatile private var released = false
    private var lastEmittedPayload: String? = null
    private var previewContainer: FrameLayout? = null

    override fun getName(): String = "ZaycommCameraScanner"

    private fun emitQrDetected(raw: String) {
        if (released || raw == lastEmittedPayload) return
        lastEmittedPayload = raw
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("ZaycommQrDetected", Arguments.createMap().apply {
            putString("payload", raw); putInt("length", raw.length)
        })
    }

    @ReactMethod fun prepare(promise: Promise) {
        if (released) { promise.reject("SCANNER_RELEASED", "Scanner is no longer active"); return }
        try {
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener({ try { promise.resolve(future.get().hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) } catch (t: Throwable) { promise.reject("SCANNER_PREPARE_ERROR", t.message, t) } }, ContextCompat.getMainExecutor(context))
        } catch (t: Throwable) { promise.reject("SCANNER_PREPARE_ERROR", t.message, t) }
    }

    @ReactMethod fun prepareAnalysis(promise: Promise) {
        if (released) { promise.reject("SCANNER_RELEASED", "Scanner is no longer active"); return }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) { promise.reject("CAMERA_PERMISSION_REQUIRED", "Camera permission has not been granted"); return }
        val activity = context.currentActivity ?: run { promise.reject("SCANNER_NO_ACTIVITY", "Camera activity is unavailable"); return }
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                if (released || activity.isFinishing || activity.isDestroyed) { promise.reject("SCANNER_CANCELLED", "Camera scanner was cancelled"); return@addListener }
                val provider = future.get()
                val lifecycleOwner = activity as? androidx.lifecycle.LifecycleOwner ?: throw IllegalStateException("Activity is not a LifecycleOwner")
                val previewView = PreviewView(context).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE; scaleType = PreviewView.ScaleType.FILL_CENTER; contentDescription = "Zaycomm QR camera preview" }
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                analysis.setAnalyzer(executor) { imageProxy ->
                    val mediaImage = imageProxy.image
                    if (mediaImage == null || released) { imageProxy.close(); return@setAnalyzer }
                    scanner.process(InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees))
                        .addOnSuccessListener { barcodes -> if (!released) for (barcode in barcodes) if (barcode.format == Barcode.FORMAT_QR_CODE) barcode.rawValue?.takeIf { isZaycommQrPayload(it) }?.let { emitQrDetected(it) } }
                        .addOnFailureListener { if (!released) Log.e("ZaycommCamera", "QR_DECODE_ERROR", it) }
                        .addOnCompleteListener { imageProxy.close() }
                }
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                ContextCompat.getMainExecutor(context).execute {
                    if (released || activity.isFinishing || activity.isDestroyed) { provider.unbindAll(); return@execute }
                    previewContainer?.let { old -> (old.parent as? ViewGroup)?.removeView(old) }
                    val container = FrameLayout(context).apply { setBackgroundColor(android.graphics.Color.BLACK); addView(previewView, FrameLayout.LayoutParams(-1, -1)) }
                    activity.addContentView(container, FrameLayout.LayoutParams(-1, -1).apply { gravity = Gravity.TOP or Gravity.START })
                    previewContainer = container
                }
                promise.resolve(true)
            } catch (t: Throwable) { Log.e("ZaycommCamera", "ANALYSIS_PREPARE_ERROR", t); promise.reject("ANALYSIS_PREPARE_ERROR", t.message, t) }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun isZaycommQrPayload(raw: String): Boolean = raw.length in 32..4096 && raw.startsWith("{") && raw.endsWith("}") && raw.contains("\"scheme\":\"zaycomm\"") && raw.contains("\"version\":1") && raw.contains("\"nodeId\"") && raw.contains("\"publicKey\"")

    @ReactMethod fun release(promise: Promise) {
        ContextCompat.getMainExecutor(context).execute {
            released = true; lastEmittedPayload = null
            previewContainer?.let { container -> (container.parent as? ViewGroup)?.removeView(container) }
            previewContainer = null
            try { ProcessCameraProvider.getInstance(context).get().unbindAll() } catch (_: Throwable) {}
            promise.resolve(null)
        }
    }

    override fun invalidate() {
        released = true
        ContextCompat.getMainExecutor(context).execute {
            previewContainer?.let { container -> (container.parent as? ViewGroup)?.removeView(container) }
            previewContainer = null
            try { ProcessCameraProvider.getInstance(context).get().unbindAll() } catch (_: Throwable) {}
        }
        executor.shutdownNow(); scanner.close(); super.invalidate()
    }
}