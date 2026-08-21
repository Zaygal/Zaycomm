package com.zaycomm.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class ZaycommCameraScannerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private companion object { const val GALLERY_REQUEST = 7401 }

    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val scanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    )
    @Volatile private var released = false
    private var lastEmittedPayload: String? = null
    private var candidatePayload: String? = null
    private var candidateFrames = 0
    private var previewContainer: FrameLayout? = null

    private val activityListener: ActivityEventListener = object : ActivityEventListener {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, intent: Intent?) {
            if (requestCode != GALLERY_REQUEST || resultCode != Activity.RESULT_OK) return
            val uri = intent?.data ?: return
            decodeGalleryUri(uri)
        }

        override fun onNewIntent(intent: Intent) {
            // No deep-link handling is required by the QR gallery flow.
        }
    }

    init { context.addActivityEventListener(activityListener) }

    override fun getName(): String = "ZaycommCameraScanner"

    private fun emitQrDetected(raw: String) {
        if (released || raw == lastEmittedPayload) return
        lastEmittedPayload = raw
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("ZaycommQrDetected", Arguments.createMap().apply {
            putString("payload", raw)
            putInt("length", raw.length)
        })
    }

    @ReactMethod fun prepare(promise: Promise) {
        released = false
        try {
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener({ try { promise.resolve(future.get().hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) } catch (t: Throwable) { promise.reject("SCANNER_PREPARE_ERROR", t.message, t) } }, ContextCompat.getMainExecutor(context))
        } catch (t: Throwable) { promise.reject("SCANNER_PREPARE_ERROR", t.message, t) }
    }

    @ReactMethod fun showScanMethodChooser(promise: Promise) {
        val activity = context.currentActivity ?: run { promise.reject("SCANNER_NO_ACTIVITY", "Scanner activity is unavailable"); return }
        ContextCompat.getMainExecutor(context).execute {
            android.app.AlertDialog.Builder(activity)
                .setTitle("Scan Zaycomm QR")
                .setItems(arrayOf("Scan with Camera", "Upload from Gallery")) { _, which ->
                    if (which == 0) startCameraSession() else openGallery()
                }
                .setOnCancelListener { promise.resolve(false) }
                .show()
            promise.resolve(true)
        }
    }

    private fun startCameraSession() {
        released = false
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("ZaycommQrScannerError", Arguments.createMap().apply { putString("message", "Camera permission has not been granted.") })
            return
        }
        val activity = context.currentActivity ?: return
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                if (activity.isFinishing || activity.isDestroyed) return@addListener
                val provider = future.get()
                val lifecycleOwner = activity as? androidx.lifecycle.LifecycleOwner ?: throw IllegalStateException("Activity is not a LifecycleOwner")
                val previewView = PreviewView(context).apply {
                    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                    scaleType = PreviewView.ScaleType.FILL_CENTER
                    contentDescription = "Zaycomm QR camera preview"
                }
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                val analysis = ImageAnalysis.Builder()
                    .setTargetResolution(Size(1280, 720))
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                candidatePayload = null
                candidateFrames = 0
                lastEmittedPayload = null
                analysis.setAnalyzer(executor) { imageProxy ->
                    val mediaImage = imageProxy.image
                    if (mediaImage == null || released) { imageProxy.close(); return@setAnalyzer }
                    scanner.process(InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees))
                        .addOnSuccessListener { barcodes ->
                            if (released) return@addOnSuccessListener
                            var detected: String? = null
                            for (barcode in barcodes) {
                                if (barcode.format != Barcode.FORMAT_QR_CODE) continue
                                val raw = barcode.rawValue ?: continue
                                if (isZaycommQrPayload(raw)) { detected = raw; break }
                            }
                            if (detected == null) { candidatePayload = null; candidateFrames = 0 }
                            else if (detected == candidatePayload) candidateFrames += 1
                            else { candidatePayload = detected; candidateFrames = 1 }
                            if (detected != null && candidateFrames >= 2) { emitQrDetected(detected); candidateFrames = 0 }
                        }
                        .addOnFailureListener { if (!released) Log.e("ZaycommCamera", "QR_DECODE_ERROR", it) }
                        .addOnCompleteListener { imageProxy.close() }
                }
                ContextCompat.getMainExecutor(context).execute {
                    previewContainer?.let { old -> (old.parent as? ViewGroup)?.removeView(old) }
                    val container = FrameLayout(context).apply {
                        setBackgroundColor(android.graphics.Color.BLACK)
                        addView(previewView, FrameLayout.LayoutParams(-1, -1))
                        val gallery = Button(context).apply {
                            text = "CHOOSE FROM GALLERY"
                            isAllCaps = true
                            setOnClickListener { openGallery() }
                        }
                        addView(gallery, FrameLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                            setMargins(32, 0, 32, 48)
                        })
                    }
                    activity.addContentView(container, FrameLayout.LayoutParams(-1, -1).apply { gravity = Gravity.TOP or Gravity.START })
                    previewContainer = container
                }
            } catch (t: Throwable) { Log.e("ZaycommCamera", "ANALYSIS_PREPARE_ERROR", t) }
        }, ContextCompat.getMainExecutor(context))
    }

    @ReactMethod fun prepareAnalysis(promise: Promise) {
        startCameraSession()
        promise.resolve(true)
    }

    private fun openGallery() {
        val activity = context.currentActivity ?: return
        ContextCompat.getMainExecutor(context).execute {
            try { ProcessCameraProvider.getInstance(context).get().unbindAll() } catch (_: Throwable) {}
            previewContainer?.let { (it.parent as? ViewGroup)?.removeView(it) }
            previewContainer = null
            val intent = if (Build.VERSION.SDK_INT >= 33) Intent(MediaStore.ACTION_PICK_IMAGES).apply { type = "image/*" }
            else Intent(Intent.ACTION_GET_CONTENT).apply { type = "image/*"; addCategory(Intent.CATEGORY_OPENABLE) }
            activity.startActivityForResult(intent, GALLERY_REQUEST)
        }
    }

    private fun decodeGalleryUri(uri: Uri) {
        released = false
        executor.execute {
            try {
                val image = InputImage.fromFilePath(context, uri)
                scanner.process(image)
                    .addOnSuccessListener { barcodes ->
                        var detected: String? = null
                        for (barcode in barcodes) {
                            if (barcode.format != Barcode.FORMAT_QR_CODE) continue
                            val raw = barcode.rawValue ?: continue
                            if (isZaycommQrPayload(raw)) { detected = raw; break }
                        }
                        if (detected != null) emitQrDetected(detected)
                        else context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("ZaycommQrGalleryError", Arguments.createMap().apply { putString("message", "No valid Zaycomm QR code was found in that image.") })
                    }
                    .addOnFailureListener { error ->
                        Log.e("ZaycommCamera", "QR_GALLERY_DECODE_ERROR", error)
                        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("ZaycommQrGalleryError", Arguments.createMap().apply { putString("message", "Unable to read the selected image.") })
                    }
            } catch (t: Throwable) {
                Log.e("ZaycommCamera", "QR_GALLERY_IMAGE_ERROR", t)
                context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("ZaycommQrGalleryError", Arguments.createMap().apply { putString("message", "Unable to open the selected image.") })
            }
        }
    }

    private fun isZaycommQrPayload(raw: String): Boolean {
        if (raw.length !in 32..4096 || !raw.startsWith("{") || !raw.endsWith("}")) return false
        return try {
            val parsed = JSONObject(raw)
            val nodeId = parsed.optString("nodeId")
            val publicKey = parsed.optString("publicKey")
            parsed.optString("scheme") == "zaycomm" && parsed.optInt("version", -1) == 1 &&
                Regex("^[0-9a-fA-F]{16}$").matches(nodeId) && Regex("^[0-9a-fA-F]{64}$").matches(publicKey)
        } catch (_: Throwable) { false }
    }

    @ReactMethod fun release(promise: Promise) {
        ContextCompat.getMainExecutor(context).execute {
            released = true; lastEmittedPayload = null; candidatePayload = null; candidateFrames = 0
            previewContainer?.let { (it.parent as? ViewGroup)?.removeView(it) }; previewContainer = null
            try { ProcessCameraProvider.getInstance(context).get().unbindAll() } catch (_: Throwable) {}
            promise.resolve(null)
        }
    }

    override fun invalidate() {
        released = true
        ContextCompat.getMainExecutor(context).execute {
            previewContainer?.let { (it.parent as? ViewGroup)?.removeView(it) }; previewContainer = null
            try { ProcessCameraProvider.getInstance(context).get().unbindAll() } catch (_: Throwable) {}
        }
        context.removeActivityEventListener(activityListener)
        executor.shutdownNow(); scanner.close(); super.invalidate()
    }
}