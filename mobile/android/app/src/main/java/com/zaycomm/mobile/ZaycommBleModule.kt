package com.zaycomm.mobile

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

/** Native BLE bridge. It transports opaque Zaycomm bytes only. */
class ZaycommBleModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object {
        private const val MODULE = "ZaycommBle"
        private const val SERVICE = "8f4d0001-7e2c-4c7d-9f11-7a9d00000001"
        private const val FRAME = "8f4d0002-7e2c-4c7d-9f11-7a9d00000001"
        private const val CCCD = "00002902-0000-1000-8000-00805f9b34fb"
    }

    private val serviceUuid = UUID.fromString(SERVICE)
    private val frameUuid = UUID.fromString(FRAME)
    private val cccdUuid = UUID.fromString(CCCD)
    private val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter: BluetoothAdapter? get() = manager.adapter
    private var scanCallback: ScanCallback? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var server: BluetoothGattServer? = null
    private var frameCharacteristic: BluetoothGattCharacteristic? = null
    private val gattConnections = mutableMapOf<String, BluetoothGatt>()
    private val serverClients = mutableMapOf<String, BluetoothDevice>()

    override fun getName() = MODULE

    private fun allowed(permission: String) = Build.VERSION.SDK_INT < 31 || context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun emit(name: String, params: WritableMap) = context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, params)

    @ReactMethod
    fun startScan() {
        val bt = adapter ?: return
        if (!bt.isEnabled || !allowed(Manifest.permission.BLUETOOTH_SCAN)) return
        val scanner = bt.bluetoothLeScanner ?: return
        scanCallback?.let { scanner.stopScan(it) }
        val callback = object : ScanCallback() {
            override fun onScanResult(type: Int, result: ScanResult) {
                val record = result.scanRecord ?: return
                val advertisesZaycomm = record.serviceUuids?.any { it.uuid == serviceUuid } == true
                if (!advertisesZaycomm) return
                emit("ZaycommBleAdvertisement", Arguments.createMap().apply {
                    putString("id", result.device.address)
                    putString("address", result.device.address)
                })
            }
        }
        scanCallback = callback
        scanner.startScan(
            listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(serviceUuid)).build()),
            ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback
        )
    }

    @ReactMethod fun stopScan() {
        if (!allowed(Manifest.permission.BLUETOOTH_SCAN)) return
        scanCallback?.let { adapter?.bluetoothLeScanner?.stopScan(it) }
        scanCallback = null
    }

    @ReactMethod
    fun startAdvertising(nodeId: String, promise: Promise) {
        val bt = adapter
        if (bt == null || !bt.isEnabled) { promise.reject("BLE_UNAVAILABLE", "Bluetooth LE unavailable or disabled"); return }
        if (!allowed(Manifest.permission.BLUETOOTH_ADVERTISE) || !allowed(Manifest.permission.BLUETOOTH_CONNECT)) { promise.reject("BLE_PERMISSION", "Bluetooth permissions are required"); return }
        val service = BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val characteristic = BluetoothGattCharacteristic(
            frameUuid,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        characteristic.addDescriptor(BluetoothGattDescriptor(cccdUuid, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
        service.addCharacteristic(characteristic)
        frameCharacteristic = characteristic
        server?.close()
        server = manager.openGattServer(context, object : BluetoothGattServerCallback() {
            override fun onConnectionStateChange(device: BluetoothDevice, status: Int, state: Int) {
                val connected = state == BluetoothProfile.STATE_CONNECTED
                if (connected) serverClients[device.address] = device else serverClients.remove(device.address)
                emit("ZaycommBleConnectionChanged", Arguments.createMap().apply { putString("address", device.address); putBoolean("connected", connected) })
            }
            override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray) {
                if (descriptor.uuid == cccdUuid) {
                    if (value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) descriptor.value = value
                    if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
            }
            override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray) {
                if (characteristic.uuid != frameUuid || value.size > 200) return
                emit("ZaycommBleFrame", Arguments.createMap().apply {
                    putString("address", device.address)
                    putArray("frame", Arguments.fromList(value.map { it.toInt() }))
                })
                if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
        })
        if (server == null) { promise.reject("BLE_GATT_SERVER", "Unable to open GATT server"); return }
        if (!server!!.addService(service)) { promise.reject("BLE_GATT_SERVICE", "Unable to register Zaycomm BLE service"); return }

        advertiser = bt.bluetoothLeAdvertiser
        val settings = AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setConnectable(true).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).build()
        // Keep advertisements interoperable with iOS CoreBluetooth: only the
        // public service is advertised. Node identity is authenticated later.
        val data = AdvertiseData.Builder().setIncludeDeviceName(false).addServiceUuid(ParcelUuid(serviceUuid)).build()
        _ = nodeId
        advertiser?.startAdvertising(settings, data, object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings) = promise.resolve(null)
            override fun onStartFailure(errorCode: Int) = promise.reject("BLE_ADVERTISE", "BLE advertising failed: $errorCode")
        }) ?: promise.reject("BLE_UNAVAILABLE", "BLE advertiser unavailable")
    }

    @ReactMethod fun stopAdvertising() {
        if (allowed(Manifest.permission.BLUETOOTH_ADVERTISE)) advertiser?.stopAdvertising(object : AdvertiseCallback() {})
        advertiser = null; server?.close(); server = null; serverClients.clear()
    }

    @ReactMethod
    fun connect(address: String, promise: Promise) {
        val bt = adapter ?: run { promise.reject("BLE_UNAVAILABLE", "Bluetooth adapter unavailable"); return }
        if (!allowed(Manifest.permission.BLUETOOTH_CONNECT)) { promise.reject("BLE_PERMISSION", "BLUETOOTH_CONNECT permission required"); return }
        val device = try { bt.getRemoteDevice(address) } catch (e: IllegalArgumentException) { promise.reject("BLE_ADDRESS", "Invalid Bluetooth address", e); return }
        val gatt = device.connectGatt(context, false, object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, state: Int) {
                val connected = state == BluetoothProfile.STATE_CONNECTED
                if (connected) { gattConnections[address] = gatt; gatt.discoverServices() } else { gattConnections.remove(address); gatt.close() }
                emit("ZaycommBleConnectionChanged", Arguments.createMap().apply { putString("address", address); putBoolean("connected", connected) })
            }
            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                if (status != BluetoothGatt.GATT_SUCCESS) { promise.reject("BLE_GATT", "Service discovery failed: $status"); return }
                val characteristic = gatt.getService(serviceUuid)?.getCharacteristic(frameUuid)
                if (characteristic == null) { promise.reject("BLE_SERVICE", "Zaycomm frame characteristic not found"); return }

                // Enable notifications before resolving the connection. This
                // is required for Android to receive frames sent by an iOS
                // CoreBluetooth peripheral and for Android↔Android symmetry.
                val canNotify = characteristic.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0
                if (canNotify && gatt.setCharacteristicNotification(characteristic, true)) {
                    val descriptor = characteristic.getDescriptor(cccdUuid)
                    if (descriptor != null) {
                        descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        if (Build.VERSION.SDK_INT >= 33) {
                            gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                        } else {
                            @Suppress("DEPRECATION")
                            gatt.writeDescriptor(descriptor)
                        }
                    }
                }
                promise.resolve(null)
            }
            override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                if (descriptor.uuid == cccdUuid && status != BluetoothGatt.GATT_SUCCESS) {
                    emit("ZaycommBleConnectionChanged", Arguments.createMap().apply { putString("address", address); putBoolean("connected", false) })
                }
            }
            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
                if (characteristic.uuid != frameUuid) return
                emit("ZaycommBleFrame", Arguments.createMap().apply { putString("address", address); putArray("frame", Arguments.fromList(characteristic.value.map { it.toInt() })) })
            }
        })
        if (gatt == null) promise.reject("BLE_CONNECT", "Unable to create GATT connection")
    }

    @ReactMethod fun disconnect(address: String, promise: Promise) {
        if (!allowed(Manifest.permission.BLUETOOTH_CONNECT)) { promise.reject("BLE_PERMISSION", "BLUETOOTH_CONNECT permission required"); return }
        gattConnections.remove(address)?.let { it.disconnect(); it.close() }; promise.resolve(null)
    }

    @ReactMethod
    fun write(address: String, frame: ReadableArray, promise: Promise) {
        if (frame.size() > 200) { promise.reject("BLE_MTU", "Frame exceeds the configured mobile BLE transport MTU"); return }
        if (!allowed(Manifest.permission.BLUETOOTH_CONNECT)) { promise.reject("BLE_PERMISSION", "BLUETOOTH_CONNECT permission required"); return }
        val gatt = gattConnections[address] ?: run { promise.reject("BLE_NOT_CONNECTED", "No connected BLE peer: $address"); return }
        val characteristic = gatt.getService(serviceUuid)?.getCharacteristic(frameUuid) ?: run { promise.reject("BLE_SERVICE", "Zaycomm frame characteristic not found"); return }
        characteristic.value = ByteArray(frame.size()) { frame.getInt(it).toByte() }
        if (gatt.writeCharacteristic(characteristic)) promise.resolve(null) else promise.reject("BLE_WRITE", "GATT write could not be queued")
    }

    @ReactMethod
    fun notify(address: String, frame: ReadableArray, promise: Promise) {
        if (!allowed(Manifest.permission.BLUETOOTH_CONNECT)) { promise.reject("BLE_PERMISSION", "BLUETOOTH_CONNECT permission required"); return }
        if (frame.size() > 200) { promise.reject("BLE_MTU", "Frame exceeds the configured mobile BLE transport MTU"); return }
        val device = serverClients[address] ?: run { promise.reject("BLE_NOT_CONNECTED", "No server-side BLE peer: $address"); return }
        val characteristic = frameCharacteristic ?: run { promise.reject("BLE_SERVICE", "Zaycomm frame characteristic unavailable"); return }
        characteristic.value = ByteArray(frame.size()) { frame.getInt(it).toByte() }
        if (server?.notifyCharacteristicChanged(device, characteristic, false) == true) promise.resolve(null)
        else promise.reject("BLE_NOTIFY", "GATT notification could not be queued")
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    override fun onCatalystInstanceDestroy() {
        stopScan(); stopAdvertising(); gattConnections.values.forEach { it.close() }; gattConnections.clear(); super.onCatalystInstanceDestroy()
    }
}
