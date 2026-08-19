package com.zaycomm.mobile

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import java.util.UUID

class ZaycommCameraDiagnosticsModule(
    private val context: ReactApplicationContext
) : ReactContextBaseJavaModule(context) {
    override fun getName(): String = "ZaycommCameraDiagnostics"

    private fun trace(session: String, event: String, detail: String? = null) {
        val message = "CAM[$session] $event${detail?.let { " • $it" } ?: ""}"
        Log.d("ZaycommCamera", message)
    }

    @ReactMethod
    fun startSession(promise: Promise) {
        val session = UUID.randomUUID().toString().replace("-", "").take(4).uppercase()
        try {
            trace(session, "SESSION_START")
            val permission = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
            if (permission != PackageManager.PERMISSION_GRANTED) {
                trace(session, "PERMISSION_MISSING")
                val result = Arguments.createMap().apply {
                    putString("sessionId", session)
                    putString("state", "PERMISSION_REQUIRED")
                    putBoolean("permissionGranted", false)
                    putBoolean("cameraAvailable", false)
                }
                promise.resolve(result)
                return
            }
            trace(session, "PERMISSION_GRANTED")

            val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val ids = manager.cameraIdList
            val hasCamera = ids.isNotEmpty()
            trace(session, "CAMERA_ENUMERATED", "count=${ids.size}")
            if (!hasCamera) {
                trace(session, "CAMERA_UNAVAILABLE")
                promise.resolve(Arguments.createMap().apply {
                    putString("sessionId", session)
                    putString("state", "NO_CAMERA")
                    putBoolean("permissionGranted", true)
                    putBoolean("cameraAvailable", false)
                })
                return
            }

            val backCamera = ids.firstOrNull { id ->
                runCatching {
                    val facing = manager.getCameraCharacteristics(id)
                        .get(CameraCharacteristics.LENS_FACING)
                    facing == CameraCharacteristics.LENS_FACING_BACK
                }.getOrDefault(false)
            }
            trace(session, "CAMERA_READY", "cameraId=${backCamera ?: ids.first()}")
            promise.resolve(Arguments.createMap().apply {
                putString("sessionId", session)
                putString("state", "READY")
                putBoolean("permissionGranted", true)
                putBoolean("cameraAvailable", true)
                putString("cameraId", backCamera ?: ids.first())
            })
        } catch (t: Throwable) {
            trace(session, "CAMERA_ERROR", t.message ?: t.javaClass.simpleName)
            promise.reject("CAMERA_ERROR", t.message, t)
        }
    }

    @ReactMethod
    fun stopSession(sessionId: String, promise: Promise) {
        trace(sessionId, "SESSION_STOP")
        promise.resolve(null)
    }
}
