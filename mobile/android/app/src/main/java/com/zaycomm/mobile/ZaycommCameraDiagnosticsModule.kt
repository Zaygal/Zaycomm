package com.zaycomm.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.UUID

class ZaycommCameraDiagnosticsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName(): String = "ZaycommCameraDiagnostics"
    private fun trace(session: String, event: String, detail: String? = null) = android.util.Log.d("ZaycommCamera", "CAM[$session] $event${detail?.let { " • $it" } ?: ""}")

    @ReactMethod fun startSession(promise: Promise) {
        val session = UUID.randomUUID().toString().replace("-", "").take(4).uppercase()
        try {
            trace(session, "SESSION_START")
            if (context.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                trace(session, "PERMISSION_MISSING")
                promise.resolve(Arguments.createMap().apply { putString("sessionId", session); putString("state", "PERMISSION_REQUIRED"); putBoolean("permissionGranted", false); putBoolean("cameraAvailable", false) }); return
            }
            trace(session, "PERMISSION_GRANTED")
            val manager = context.getSystemService(CameraManager::class.java) ?: error("Camera service unavailable")
            val ids = manager.cameraIdList
            trace(session, "CAMERA_ENUMERATED", "count=${ids.size}")
            if (ids.isEmpty()) { trace(session, "CAMERA_UNAVAILABLE"); promise.resolve(Arguments.createMap().apply { putString("sessionId", session); putString("state", "NO_CAMERA"); putBoolean("permissionGranted", true); putBoolean("cameraAvailable", false) }); return }
            val backCamera = ids.firstOrNull { id -> runCatching { manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK }.getOrDefault(false) }
            val selected = backCamera ?: ids.first()
            trace(session, "CAMERA_READY", "cameraId=$selected")
            promise.resolve(Arguments.createMap().apply { putString("sessionId", session); putString("state", "READY"); putBoolean("permissionGranted", true); putBoolean("cameraAvailable", true); putString("cameraId", selected) })
        } catch (t: Throwable) { trace(session, "CAMERA_ERROR", t.message ?: t.javaClass.simpleName); promise.reject("CAMERA_ERROR", t.message, t) }
    }

    @ReactMethod fun traceQrDetected(sessionId: String, payloadLength: Int, format: String?, promise: Promise) {
        trace(sessionId, "QR_DETECTED", "format=${format ?: "unknown"} • payloadLength=$payloadLength")
        promise.resolve(null)
    }
    @ReactMethod fun traceQrDetectionError(sessionId: String, detail: String, promise: Promise) {
        trace(sessionId, "QR_DETECTION_ERROR", detail.take(160)); promise.resolve(null)
    }
    @ReactMethod fun stopSession(sessionId: String, promise: Promise) { trace(sessionId, "SESSION_STOP"); promise.resolve(null) }
}
