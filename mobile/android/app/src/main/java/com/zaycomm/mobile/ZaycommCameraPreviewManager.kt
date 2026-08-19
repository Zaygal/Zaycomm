package com.zaycomm.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

/**
 * Stage 2 camera binding.
 *
 * This step connects the native PreviewView to CameraX's back-camera preview
 * use case. Permission requesting and QR decoding remain separate steps.
 */
class ZaycommCameraPreviewManager : SimpleViewManager<ZaycommCameraPreviewManager.ZaycommPreviewView>() {
    override fun getName(): String = "ZaycommCameraPreview"

    override fun createViewInstance(reactContext: ThemedReactContext): ZaycommPreviewView {
        val view = ZaycommPreviewView(reactContext).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
            contentDescription = "Zaycomm camera preview"
        }

        bindCamera(reactContext, view)
        return view
    }

    override fun onDropViewInstance(view: ZaycommPreviewView) {
        view.cameraProvider?.unbindAll()
        view.cameraProvider = null
        super.onDropViewInstance(view)
    }

    private fun bindCamera(reactContext: ThemedReactContext, view: ZaycommPreviewView) {
        Log.d("ZaycommCamera", "PREVIEW_BIND_START")

        if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Log.d("ZaycommCamera", "PREVIEW_BIND_WAITING_FOR_PERMISSION")
            return
        }

        val lifecycleOwner = reactContext.currentActivity as? LifecycleOwner
        if (lifecycleOwner == null) {
            Log.e("ZaycommCamera", "PREVIEW_BIND_ERROR: activity is not a LifecycleOwner")
            return
        }

        val future = ProcessCameraProvider.getInstance(reactContext)
        future.addListener({
            try {
                val provider = future.get()
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(view.surfaceProvider)
                }
                provider.unbindAll()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview
                )
                view.cameraProvider = provider
                Log.d("ZaycommCamera", "PREVIEW_BIND_READY")
            } catch (t: Throwable) {
                Log.e("ZaycommCamera", "PREVIEW_BIND_ERROR", t)
            }
        }, ContextCompat.getMainExecutor(reactContext))
    }

    class ZaycommPreviewView(context: android.content.Context) : PreviewView(context) {
        var cameraProvider: ProcessCameraProvider? = null
    }
}
