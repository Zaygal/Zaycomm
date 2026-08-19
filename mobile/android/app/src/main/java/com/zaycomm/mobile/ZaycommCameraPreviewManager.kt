package com.zaycomm.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import android.widget.FrameLayout
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
 * This step connects a native PreviewView to CameraX's back-camera preview
 * use case. Permission requesting and QR decoding remain separate steps.
 */
class ZaycommCameraPreviewManager : SimpleViewManager<FrameLayout>() {
    override fun getName(): String = "ZaycommCameraPreview"

    override fun createViewInstance(reactContext: ThemedReactContext): FrameLayout {
        val container = FrameLayout(reactContext)
        val preview = PreviewView(reactContext).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
            contentDescription = "Zaycomm camera preview"
        }

        container.addView(
            preview,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        bindCamera(reactContext, preview)
        return container
    }

    override fun onDropViewInstance(view: FrameLayout) {
        view.getChildAt(0)?.tag?.let { tag ->
            if (tag is ProcessCameraProvider) tag.unbindAll()
        }
        super.onDropViewInstance(view)
    }

    private fun bindCamera(reactContext: ThemedReactContext, previewView: PreviewView) {
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
                val cameraPreview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                provider.unbindAll()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    cameraPreview
                )
                previewView.tag = provider
                Log.d("ZaycommCamera", "PREVIEW_BIND_READY")
            } catch (t: Throwable) {
                Log.e("ZaycommCamera", "PREVIEW_BIND_ERROR", t)
            }
        }, ContextCompat.getMainExecutor(reactContext))
    }
}
