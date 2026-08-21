package com.zaycomm.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class ZaycommCameraScannerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), ActivityEventListener {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val scanner = BarcodeScanning.getClient()
    @Volatile private var released = true
    private var lastEmittedPayload: String? = null
    private var previewContainer: FrameLayout? = null
    private val imagePickRequestCode = 4817

    init {
        context.addActivityEventListener(this)
    }

    override fun getName(): String = "ZaycommCameraScanner"

    private fun emitQrDetected(raw: String) {
        if (released || raw == lastEmittedPayload) return
        lastEmittedPayload = raw
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("ZaycommQrDetected", Arguments.createMap().apply {
            putString("payload", raw)
            putInt("length", raw.length)
        })
    }

    private fun isZaycommQrPayload(raw: String): Boolean =
        raw.length in 32..4096 && raw.startsWith("{") && raw.endsWith("}") &&
            raw.contains("\"scheme\":\"zaycomm\"") && raw.contains("\"version\":1") &&
            raw.contains("\"nodeId\"") && raw.contains("\"publicKey\"")

    @ReactMethod
    fun prepare(promise: Promise) {
        released = false
        lastEmittedPayload = null
        try {
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener({
                try {
                    promise.resolve(future.get().hasCamera(CameraSelector.DEFAULT_BACK_CAMERA))
                } catch (t: Throwable) {
                    promise.reject("SCANNER_PREPARE_ERROR", t.message, t)
                }
            }, ContextCompat.getMainExecutor(context))
        } catch (t: Throwable) {
            promise.reject("SCANNER_PREPARE_ERROR", t.message, t)
        }
    }

    @ReactMethod
    fun prepareAnalysis(promise: Promise) {
        released = false
        lastEmittedPayload = null
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            promise.reject("CAMERA_PERMISSION_REQUIRED", "Camera permission has not been granted")
            return
        }
        val activity = context.currentActivity ?: run {
            promise.reject("SCANNER_NO_ACTIVITY", "Camera activity is unavailable")
            return
        }
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                if (activity.isFinishing || activity.isDestroyed) {
                    promise.reject("SCANNER_CANCELLED", "Camera scanner was cancelled")
                    return@addListener
                }
                val provider = future.get()
                val lifecycleOwner = activity as? androidx.lifecycle.LifecycleOwner
                    ?: throw IllegalStateException("Activity is not a LifecycleOwner")

                val previewView = PreviewView(context).apply {
                    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                    scaleType = PreviewView.ScaleType.FILL_CENTER
                    contentDescription = "Zaycomm QR camera preview"
                }
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(executor) { imageProxy ->
                    val mediaImage = imageProxy.image
                    if (mediaImage == null || released) {
                        imageProxy.close()
                        return@setAnalyzer
                    }
                    scanner.process(InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees))
                        .addOnSuccessListener { barcodes ->
                            if (!released) {
                                for (barcode in barcodes) {
                                    if (barcode.format == Barcode.FORMAT_QR_CODE) {
                                        barcode.rawValue?.takeIf(::isZaycommQrPayload)?.let(::emitQrDetected)
                                    }
                                }
                            }
                        }
                        .addOnFailureListener { if (!released) Log.e("ZaycommCamera", "QR_DECODE_ERROR", it) }
                        .addOnCompleteListener { imageProxy.close() }
                }

                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)

                ContextCompat.getMainExecutor(context).execute {
                    if (released || activity.isFinishing || activity.isDestroyed) {
                        provider.unbindAll()
                        return@execute
                    }
                    previewContainer?.let { old -> (old.parent as? ViewGroup)?.removeView(old) }
                    val root = FrameLayout(context).apply {
                        setBackgroundColor(Color.BLACK)
                        addView(previewView, FrameLayout.LayoutParams(-1, -1))
                    }
                    addScannerChrome(root, activity)
                    activity.addContentView(root, FrameLayout.LayoutParams(-1, -1).apply {
                        gravity = Gravity.TOP or Gravity.START
                    })
                    previewContainer = root
                }
                promise.resolve(true)
            } catch (t: Throwable) {
                Log.e("ZaycommCamera", "ANALYSIS_PREPARE_ERROR", t)
                promise.reject("ANALYSIS_PREPARE_ERROR", t.message, t)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun addScannerChrome(root: FrameLayout, activity: Activity) {
        val chrome = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 56, 24, 28)
        }

        val top = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val title = TextView(context).apply {
            text = "SCAN ZAYCOMM QR"
            textColor = Color.WHITE
            textSize = 15f
            typeface = android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD)
            letterSpacing = 0.08f
            setShadowLayer(8f, 0f, 2f, Color.BLACK)
        }
        val close = TextView(context).apply {
            text = "CLOSE"
            textColor = Color.WHITE
            textSize = 11f
            typeface = android.graphics.Typeface.create("monospace", android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(18, 12, 18, 12)
            setBackgroundColor(Color.argb(190, 8, 12, 34))
            setOnClickListener { releaseFromUi(activity) }
        }
        top.addView(title, LinearLayout.LayoutParams(0, 52).apply { weight = 1f })
        top.addView(close, LinearLayout.LayoutParams(-2, 52))

        val spacer = View(context)
        val actions = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, 12, 0, 0)
        }
        val gallery = TextView(context).apply {
            text = "CHOOSE IMAGE"
            textColor = Color.rgb(4, 16, 28)
            textSize = 11f
            typeface = android.graphics.Typeface.create("monospace", android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(22, 14, 22, 14)
            setBackgroundColor(Color.rgb(87, 224, 255))
            setOnClickListener { openImagePicker(activity) }
        }
        actions.addView(gallery, LinearLayout.LayoutParams(-2, 50))

        val hint = TextView(context).apply {
            text = "Align a Zaycomm QR inside the frame"
            textColor = Color.WHITE
            textSize = 12f
            gravity = Gravity.CENTER
            setPadding(12, 8, 12, 0)
            setShadowLayer(8f, 0f, 2f, Color.BLACK)
        }

        chrome.addView(top)
        chrome.addView(spacer, LinearLayout.LayoutParams(-1, 0, 1f))
        chrome.addView(hint, LinearLayout.LayoutParams(-1, 40))
        chrome.addView(actions, LinearLayout.LayoutParams(-1, 62))
        root.addView(chrome, FrameLayout.LayoutParams(-1, -1))
    }

    private fun openImagePicker(activity: Activity) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
        }
        try {
            activity.startActivityForResult(intent, imagePickRequestCode)
        } catch (t: Throwable) {
            Log.e("ZaycommCamera", "IMAGE_PICKER_ERROR", t)
        }
    }

    private fun releaseFromUi(activity: Activity) {
        released = true
        lastEmittedPayload = null
        previewContainer?.let { container -> (container.parent as? ViewGroup)?.removeView(container) }
        previewContainer = null
        try { ProcessCameraProvider.getInstance(context).get().unbindAll() } catch (_: Throwable) {}
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("ZaycommQrScannerClosed", Arguments.createMap())
    }

    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != imagePickRequestCode || resultCode != Activity.RESULT_OK) return
        val uri: Uri = data?.data ?: return
        try {
            val image = InputImage.fromFilePath(context, uri)
            scanner.process(image)
                .addOnSuccessListener { barcodes ->
                    val payload = barcodes.firstOrNull { it.format == Barcode.FORMAT_QR_CODE && it.rawValue?.let(::isZaycommQrPayload) == true }?.rawValue
                    if (payload != null) emitQrDetected(payload)
                    else context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("ZaycommQrImageRejected", Arguments.createMap())
                }
                .addOnFailureListener { error ->
                    Log.e("ZaycommCamera", "QR_IMAGE_DECODE_ERROR", error)
                    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("ZaycommQrImageRejected", Arguments.createMap())
                }
        } catch (t: Throwable) {
            Log.e("ZaycommCamera", "QR_IMAGE_READ_ERROR", t)
        }
    }

    override fun onNewIntent(intent: Intent?) = Unit

    @ReactMethod
    fun release(promise: Promise) {
        ContextCompat.getMainExecutor(context).execute {
            released = true
            lastEmittedPayload = null
            previewContainer?.let { container -> (container.parent as? ViewGroup)?.removeView(container) }
            previewContainer = null
            try { ProcessCameraProvider.getInstance(context).get().unbindAll() } catch (_: Throwable) {}
            promise.resolve(null)
        }
    }

    override fun invalidate() {
        released = true
        context.removeActivityEventListener(this)
        ContextCompat.getMainExecutor(context).execute {
            previewContainer?.let { container -> (container.parent as? ViewGroup)?.removeView(container) }
            previewContainer = null
            try { ProcessCameraProvider.getInstance(context).get().unbindAll() } catch (_: Throwable) {}
        }
        executor.shutdownNow()
        scanner.close()
        super.invalidate()
    }
}
