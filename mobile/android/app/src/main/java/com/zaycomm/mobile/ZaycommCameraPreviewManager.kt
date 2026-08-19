package com.zaycomm.mobile

import android.view.View
import androidx.camera.view.PreviewView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

/**
 * Stage 2 preview foundation.
 *
 * This exposes a native CameraX PreviewView to React Native. Camera binding is
 * intentionally the next isolated step; this commit only proves the native
 * preview surface can be created and managed by React Native.
 */
class ZaycommCameraPreviewManager : SimpleViewManager<PreviewView>() {
    override fun getName(): String = "ZaycommCameraPreview"

    override fun createViewInstance(reactContext: ThemedReactContext): PreviewView {
        return PreviewView(reactContext).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
            contentDescription = "Zaycomm camera preview"
        }
    }

    override fun onDropViewInstance(view: PreviewView) {
        view.controller = null
        super.onDropViewInstance(view)
    }
}
