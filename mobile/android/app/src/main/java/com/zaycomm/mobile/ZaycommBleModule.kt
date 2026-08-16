package com.zaycomm.mobile

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.ParcelUuid
import androidx.annotation.RequiresPermission
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

/**
 * Native Android BLE bridge for Zaycomm.
 *
 * The bridge only moves opaque byte frames. Zaycomm identity, routing,
 * sessions, encryption, replay protection and ACK semantics remain in the
 * TypeScript core above this layer.
 */
class ZaycommBleModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object {
        private const val MODULE = "ZaycommBle"
        private const val SERVICE = "8f4d0001-7e2c-4c7d-9f11-7a9d00000001"
        private const val FRAME = "8f4d0002-7e2c-4c7d-9f11-7a9d00000001"
        private const val CCCD = "00002902-0000-1000-8000-00805f9b34fb"
    }

    private val serviceUuid = UUID.fromString(SERVICE)
    private val frameUuid = UUID.fromString(FRAME)
    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter: BluetoothAdapter? get() = bluetoothManager.adapter
    private var scannerCallback: ScanCallback? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var server: BluetoothGattServer? = null
    private val connections = mutableMapOf<String, BluetoothGatt>()

    override fun getName(): String = MODULE

    private fun emit(name: String, params: com.facebook.react.bridge.WritableMap) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, params)
    }

    private fun has(permission: String): Boolean = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    @ReactMethod
    fun startScan() {
        val bt = adapter ?: return
        if (!bt.isEnabled) return
        if (android.os.Build.VERSION.SDK_INT >= 31 && !has(Manifest.permission.BLUETOOTH_SCAN)) return
        val scanner = bt.bluetoothLeScanner ?: return
        scannerCallback?.let { scanner.stopScan(it) }
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val serviceData = result.scanRecord?.getServiceData(ParcelUuid(serviceUuid)) ?: return
                val id = serviceData.toString(Charsets.UTF_8)
                val map = Arguments.createMap()
                map.putString("id", id)
                map.putString("address", result.device.address)
                emit("ZaycommBleAdvertisement", map)
            }
        }
        scannerCallback = callback
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(serviceUuid)).build()
        scanner.startScan(listOf(filter), ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback)
    }

    @ReactMethod
    fun stopScan() {
        if (android.os.Build.VERSION.SDK_INT >= 31 && !has(Manifest.permission.BLUETOOTH_SCAN)) return
        val callback = scannerCallback ?: return
        adapter?.bluetoothLeScanner?.stopScan(callback)
        scannerCallback = null
    }

    @ReactMethod
    fun startAdvertising(nodeId: String, promise: Promise) {
        val bt = adapter
        if (bt == null || !bt.isEnabled) {
            promise.reject("BLE_UNAVAILABLE", "Bluetooth LE is unavailable or disabled")
            return
        }
        if (android.os.Build.VERSION.SDK_INT >= 31 && !has(Manifest.permission.BLUETOOTH_ADVERTISE)) {
            promise.reject("BLE_PERMISSION", "BLUETOOTH_ADVERTISE permission is required")
            return
        }
        advertiser = bt.bluetoothLeAdvertiser
        val settings = AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setConnectable(true).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).build()
        val data = AdvertiseData.Builder().setIncludeDeviceName(false).addServiceUuid(ParcelUuid(serviceUuid)).addServiceData(ParcelUuid(serviceUuid), nodeId.toByteArray(Charsets.UTF_8)).build()
        advertiser?.startAdvertising(settings, data, object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings) { promise.resolve(null) }
            override fun onStartFailure(errorCode: Int) { promise.reject("BLE_ADVERTISE", "BLE advertising failed: $errorCode") }
        }) ?: promise.reject("BLE_UNAVAILABLE", "BLE advertiser unavailable")
    }

    @ReactMethod
    fun stopAdvertising() {
        if (android.os.Build.VERSION.SDK_INT >= 31 && !has(Manifest.permission.BLUETOOTH_ADVERTISE)) return
        advertiser?.stopAdvertising(object : AdvertiseCallback() {})
        advertiser = null
    }

    @ReactMethod
    fun connect(address: String, promise: Promise) {
        val bt = adapter
        if (bt == null) { promise.reject("BLE_UNAVAILABLE", "Bluetooth adapter unavailable"); return }
        if (android.os.Build.VERSION.SDK_INT >= 31 && !has(Manifest.permission.BLUETOOTH_CONNECT)) {
            promise.reject("BLE_PERMISSION", "BLUETOOTH_CONNECT permission is required")
            return
        }
        val device = try { bt.getRemoteDevice(address) } catch (e: IllegalArgumentException) {
            promise.reject("BLE_ADDRESS", "Invalid Bluetooth address", e); return
        }
        val gatt = device.connectGatt(context, false, object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                val map = Arguments.createMap().apply { putString("address", address); putBoolean("connected", newState == BluetoothGatt.STATE_CONNECTED) }
                if (newState == BluetoothGatt.STATE_CONNECTED) {
                    connections[address] = gatt
                    gatt.discoverServices()
                } else {
                    connections.remove(address)
                    gatt.close()
                }
                emit("ZaycommBleConnectionChanged", map)
            }
            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) promise.resolve(null) else promise.reject("BLE_GATT", "Service discovery failed: $status")
            }
            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
                if (characteristic.uuid != frameUuid) return
                val map = Arguments.createMap().apply {
                    putString("address", address)
                    putArray("frame", Arguments.fromList(characteristic.value.map { it.toInt() }))
                }
                emit("ZaycommBleFrame", map)
            }
        })
        if (gatt == null) promise.reject("BLE_CONNECT", "Unable to create GATT connection")
    }

    @ReactMethod
    fun disconnect(address: String, promise: Promise) {
        if (android.os.Build.VERSION.SDK_INT >= 31 && !has(Manifest.permission.BLUETOOTH_CONNECT)) { promise.reject("BLE_PERMISSION", "BLUETOOTH_CONNECT permission is required"); return }
        connections.remove(address)?.let { it.disconnect(); it.close() }
        promise.resolve(null)
    }

    @ReactMethod
    fun write(address: String, frame: com.facebook.react.bridge.ReadableArray, promise: Promise) {
        val gatt = connections[address]
        if (gatt == null) { promise.reject("BLE_NOT_CONNECTED", "No connected BLE peer: $address"); return }
        if (frame.size() > 200) { promise.reject("BLE_MTU", "Frame exceeds C25 BLE transport MTU"); return }
        val service = gatt.getService(serviceUuid)
        val characteristic = service?.getCharacteristic(frameUuid)
        if (characteristic == null) { promise.reject("BLE_SERVICE", "Zaycomm BLE frame characteristic not found"); return }
        val bytes = ByteArray(frame.size()) { frame.getInt(it).toByte() }
        characteristic.value = bytes
        val ok = gatt.writeCharacteristic(characteristic)
        if (ok) promise.resolve(null) else promise.reject("BLE_WRITE", "GATT write could not be queued")
    }

    @ReactMethod
    fun addListener(eventName: String) { }

    @ReactMethod
    fun removeListeners(count: Int) { }

    override fun onCatalystInstanceDestroy() {
        stopScan()
        connections.values.forEach { it.close() }
        connections.clear()
        server?.close()
        server = null
        super.onCatalystInstanceDestroy()
    }
}
