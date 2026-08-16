import Foundation
import CoreBluetooth
import React

@objc(ZaycommBle)
final class ZaycommBleModule: RCTEventEmitter, CBCentralManagerDelegate, CBPeripheralDelegate, CBPeripheralManagerDelegate {
    private let serviceUUID = CBUUID(string: "8F4D0001-7E2C-4C7D-9F11-7A9D00000001")
    private let frameUUID = CBUUID(string: "8F4D0002-7E2C-4C7D-9F11-7A9D00000001")

    private var central: CBCentralManager!
    private var peripheralManager: CBPeripheralManager!
    private var peripherals: [UUID: CBPeripheral] = [:]
    private var frameCharacteristics: [UUID: CBCharacteristic] = [:]
    private var peripheralFrameCharacteristic: CBMutableCharacteristic?
    private var peripheralSubscriptions: [CBCentral: Bool] = [:]
    private var pendingConnects: [UUID: RCTPromiseResolveBlock] = [:]
    private var pendingConnectErrors: [UUID: RCTPromiseRejectBlock] = [:]
    private var pendingNodeId: String?
    private var scanRequested = false

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: nil)
        peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
    }

    @objc override static func requiresMainQueueSetup() -> Bool { true }

    override func supportedEvents() -> [String]! {
        ["ZaycommBleAdvertisement", "ZaycommBleFrame", "ZaycommBleConnectionChanged"]
    }

    private func emit(_ name: String, _ body: [String: Any]) {
        sendEvent(withName: name, body: body)
    }

    @objc func startScan() {
        scanRequested = true
        guard central.state == .poweredOn else { return }
        central.scanForPeripherals(withServices: [serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    @objc func stopScan() {
        scanRequested = false
        central.stopScan()
    }

    @objc func startAdvertising(_ nodeId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard peripheralManager.state == .poweredOn else {
            reject("BLE_UNAVAILABLE", "Bluetooth LE is unavailable or disabled", nil)
            return
        }

        peripheralManager.removeAllServices()
        pendingNodeId = nodeId
        let characteristic = CBMutableCharacteristic(
            type: frameUUID,
            properties: [.write, .writeWithoutResponse, .notify],
            value: nil,
            permissions: [.writeable]
        )
        peripheralFrameCharacteristic = characteristic
        let service = CBMutableService(type: serviceUUID, primary: true)
        service.characteristics = [characteristic]
        peripheralManager.add(service)

        // iOS exposes the node identifier as the advertised local name. The
        // protocol frame itself remains opaque and never enters advertisement data.
        peripheralManager.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
            CBAdvertisementDataLocalNameKey: "Zaycomm-\(nodeId.prefix(24))"
        ])
        resolve(nil)
    }

    @objc func stopAdvertising() {
        peripheralManager.stopAdvertising()
        peripheralManager.removeAllServices()
        peripheralFrameCharacteristic = nil
        peripheralSubscriptions.removeAll()
    }

    @objc func connect(_ peerId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let uuid = UUID(uuidString: peerId), let peripheral = peripherals[uuid] else {
            reject("BLE_PEER", "Unknown BLE peer: \(peerId)", nil)
            return
        }
        pendingConnects[uuid] = resolve
        pendingConnectErrors[uuid] = reject
        central.connect(peripheral, options: nil)
    }

    @objc func disconnect(_ peerId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let uuid = UUID(uuidString: peerId), let peripheral = peripherals[uuid] else {
            resolve(nil)
            return
        }
        central.cancelPeripheralConnection(peripheral)
        resolve(nil)
    }

    @objc func write(_ peerId: String, frame: [NSNumber], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard frame.count <= 200 else {
            reject("BLE_MTU", "Frame exceeds C25 BLE transport MTU", nil)
            return
        }
        guard let uuid = UUID(uuidString: peerId), let peripheral = peripherals[uuid], let characteristic = frameCharacteristics[uuid] else {
            reject("BLE_NOT_CONNECTED", "No writable Zaycomm BLE characteristic for peer: \(peerId)", nil)
            return
        }
        let data = Data(frame.map { UInt8(truncating: $0) })
        let type: CBCharacteristicWriteType = characteristic.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
        peripheral.writeValue(data, for: characteristic, type: type)
        resolve(nil)
    }

    @objc func notify(_ peerId: String, frame: [NSNumber], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard frame.count <= 200 else {
            reject("BLE_MTU", "Frame exceeds C25 BLE transport MTU", nil)
            return
        }
        guard let characteristic = peripheralFrameCharacteristic else {
            reject("BLE_SERVICE", "Zaycomm BLE peripheral characteristic unavailable", nil)
            return
        }
        let data = Data(frame.map { UInt8(truncating: $0) })
        guard peripheralManager.updateValue(data, for: characteristic, onSubscribedCentrals: nil) else {
            reject("BLE_NOTIFY", "CoreBluetooth could not queue notification", nil)
            return
        }
        resolve(nil)
    }

    // MARK: CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn && scanRequested {
            central.scanForPeripherals(withServices: [serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        peripherals[peripheral.identifier] = peripheral
        let localName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let nodeId: String
        if let localName, localName.hasPrefix("Zaycomm-") {
            nodeId = String(localName.dropFirst("Zaycomm-".count))
        } else {
            nodeId = peripheral.identifier.uuidString
        }
        emit("ZaycommBleAdvertisement", [
            "id": nodeId,
            "address": peripheral.identifier.uuidString,
            "publicKey": NSNull()
        ])
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        peripheral.discoverServices([serviceUUID])
        emit("ZaycommBleConnectionChanged", ["peerId": peripheral.identifier.uuidString, "connected": true])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        let uuid = peripheral.identifier
        pendingConnectErrors.removeValue(forKey: uuid)?("BLE_CONNECT", error?.localizedDescription ?? "BLE connection failed", error)
        pendingConnects.removeValue(forKey: uuid)
        emit("ZaycommBleConnectionChanged", ["peerId": uuid.uuidString, "connected": false])
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        frameCharacteristics.removeValue(forKey: peripheral.identifier)
        emit("ZaycommBleConnectionChanged", ["peerId": peripheral.identifier.uuidString, "connected": false])
    }

    // MARK: CBPeripheralDelegate

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil else {
            pendingConnectErrors.removeValue(forKey: peripheral.identifier)?("BLE_SERVICE", error?.localizedDescription ?? "Service discovery failed", error)
            pendingConnects.removeValue(forKey: peripheral.identifier)
            return
        }
        peripheral.services?.first(where: { $0.uuid == serviceUUID })?.let { peripheral.discoverCharacteristics([frameUUID], for: $0) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if let error {
            pendingConnectErrors.removeValue(forKey: peripheral.identifier)?("BLE_CHARACTERISTIC", error.localizedDescription, error)
            pendingConnects.removeValue(forKey: peripheral.identifier)
            return
        }
        guard let characteristic = service.characteristics?.first(where: { $0.uuid == frameUUID }) else {
            pendingConnectErrors.removeValue(forKey: peripheral.identifier)?("BLE_CHARACTERISTIC", "Zaycomm frame characteristic not found", nil)
            pendingConnects.removeValue(forKey: peripheral.identifier)
            return
        }
        frameCharacteristics[peripheral.identifier] = characteristic
        if characteristic.properties.contains(.notify) {
            peripheral.setNotifyValue(true, for: characteristic)
        }
        pendingConnects.removeValue(forKey: peripheral.identifier)?(nil)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, characteristic.uuid == frameUUID, let value = characteristic.value else { return }
        emit("ZaycommBleFrame", [
            "peerId": peripheral.identifier.uuidString,
            "frame": [UInt8](value).map { NSNumber(value: $0) }
        ])
    }

    // MARK: CBPeripheralManagerDelegate

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {}

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        guard let characteristic = peripheralFrameCharacteristic else { return }
        for request in requests {
            guard request.characteristic.uuid == frameUUID, let value = request.value, value.count <= 200 else {
                peripheralManager.respond(to: request, withResult: .unlikelyError)
                continue
            }
            emit("ZaycommBleFrame", [
                "peerId": request.central.identifier.uuidString,
                "frame": [UInt8](value).map { NSNumber(value: $0) }
            ])
            peripheralManager.respond(to: request, withResult: .success)
        }
        _ = characteristic
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        peripheralSubscriptions[central] = true
        emit("ZaycommBleConnectionChanged", ["peerId": central.identifier.uuidString, "connected": true])
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        peripheralSubscriptions.removeValue(forKey: central)
        emit("ZaycommBleConnectionChanged", ["peerId": central.identifier.uuidString, "connected": false])
    }
}
