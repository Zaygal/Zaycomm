package com.zaycomm.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Stage 2 QR scanner foundation.
 *
 * CameraX owns frame delivery and ML Kit performs QR decoding. React Native
 * payload delivery remains a separate step after native decoding is verified.
 */
class ZaycommCameraScannerModule(
    private val context: ReactApplicationContext
) : ReactContextBaseJavaModule(context) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val scanner = BarcodeScanning.getClient()

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
                    val mediaImage = imageProxy.image
                    if (mediaImage == null) {
                        imageProxy.close()
                        return@setAnalyzer
                    }

                    val image = InputImage.fromMediaImage(
                        mediaImage,
                        imageProxy.imageInfo.rotationDegrees
                    )

                    scanner.process(image)
                        .addOnSuccessListener { barcodes ->
                            for (barcode in barcodes) {
                                if (barcode.format == Barcode.FORMAT_QR_CODE) {
                                    val raw = barcode.rawValue
                                    if (!raw.isNullOrEmpty()) {
                                        Log.d("ZaycommCamera", "QR_DETECTED • length=${raw.length}")
                                    }
                                }
                            }
                        }
                        .addOnFailureListener { error ->
                            Log.e("ZaycommCamera", "QR_DECODE_ERROR", error)
                        }
                        .addOnCompleteListener {
                            imageProxy.close()
                        }
                }

                provider.unbindAll()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
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
        scanner.close()
        promise.resolve(null)
    }

    override fun invalidate() {
        executor.shutdownNow()
        scanner.close()
        super.invalidate()
    }
}
