import Foundation
import CoreBluetooth

/// C25 iOS native BLE bridge.
///
/// This class is deliberately protocol-agnostic: it only discovers peers,
/// maintains a GATT connection, and moves opaque Zaycomm bytes. Zaycomm
/// identity, authentication, encryption, routing and ACK handling remain in
/// the TypeScript core.
public final class ZaycommBleBridge: NSObject,
                                      CBCentralManagerDelegate,
                                      CBPeripheralDelegate,
                                      CBPeripheralManagerDelegate {
    public static let serviceUUID = CBUUID(string: "8F4D0001-7E2C-4C7D-9F11-7A9D00000001")
    public static let frameUUID = CBUUID(string: "8F4D0002-7E2C-4C7D-9F11-7A9D00000001")
    public static let configuredMTU = 200

    public struct Peer {
        public let id: String       // CoreBluetooth UUID; transport handle only.
        public let address: String  // Same OS-provided handle on iOS.
    }

    public var onPeerDiscovered: ((Peer) -> Void)?
    public var onFrame: ((String, Data) -> Void)?
    public var onConnectionChanged: ((String, Bool) -> Void)?

    private lazy var central = CBCentralManager(delegate: self, queue: nil)
    private lazy var peripheralManager = CBPeripheralManager(delegate: self, queue: nil)

    private var peripherals: [String: CBPeripheral] = [:]
    private var frameCharacteristics: [String: CBCharacteristic] = [:]
    private var subscribers: [CBCentral] = []
    private var localFrameCharacteristic: CBMutableCharacteristic?

    private var scanning = false
    private var advertising = false

    public override init() {
        super.init()
        _ = central
        _ = peripheralManager
    }

    // MARK: - Lifecycle

    public func startScan() {
        guard central.state == .poweredOn, !scanning else { return }
        scanning = true
        central.scanForPeripherals(
            withServices: [Self.serviceUUID],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
    }

    public func stopScan() {
        guard scanning else { return }
        central.stopScan()
        scanning = false
    }

    public func startAdvertising() {
        guard peripheralManager.state == .poweredOn, !advertising else { return }
        let properties: CBCharacteristicProperties = [.write, .writeWithoutResponse, .notify]
        let permissions: CBAttributePermissions = [.writeable]
        let characteristic = CBMutableCharacteristic(
            type: Self.frameUUID,
            properties: properties,
            value: nil,
            permissions: permissions
        )
        localFrameCharacteristic = characteristic

        let service = CBMutableService(type: Self.serviceUUID, primary: true)
        service.characteristics = [characteristic]
        peripheralManager.removeAllServices()
        peripheralManager.add(service)
    }

    public func stopAdvertising() {
        peripheralManager.stopAdvertising()
        peripheralManager.removeAllServices()
        localFrameCharacteristic = nil
        subscribers.removeAll()
        advertising = false
    }

    // MARK: - Central / client side

    public func connect(peerId: String) {
        guard let peripheral = peripherals[peerId] else { return }
        central.connect(peripheral, options: nil)
    }

    public func disconnect(peerId: String) {
        guard let peripheral = peripherals[peerId] else { return }
        central.cancelPeripheralConnection(peripheral)
    }

    /// Sends one opaque Zaycomm frame. The TypeScript layer must fragment any
    /// frame larger than the negotiated physical write capacity.
    public func send(peerId: String, frame: Data) throws {
        guard frame.count <= Self.configuredMTU else {
            throw NSError(domain: "ZaycommBLE", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Frame exceeds configured BLE MTU"])
        }
        guard let peripheral = peripherals[peerId],
              peripheral.state == .connected,
              let characteristic = frameCharacteristics[peerId] else {
            throw NSError(domain: "ZaycommBLE", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "BLE peer is not connected"])
        }

        let maxWrite = peripheral.maximumWriteValueLength(for: .withoutResponse)
        guard frame.count <= maxWrite else {
            throw NSError(domain: "ZaycommBLE", code: 3,
                          userInfo: [
                            NSLocalizedDescriptionKey: "Frame exceeds current iOS BLE write capacity",
                            "capacity": maxWrite
                          ])
        }

        peripheral.writeValue(frame, for: characteristic, type: .withoutResponse)
    }

    public func maximumWriteLength(peerId: String) -> Int {
        guard let peripheral = peripherals[peerId] else { return 0 }
        return min(Self.configuredMTU,
                   peripheral.maximumWriteValueLength(for: .withoutResponse))
    }

    // MARK: - CBCentralManagerDelegate

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state != .poweredOn {
            scanning = false
            advertising = false
        }
    }

    public func centralManager(_ central: CBCentralManager,
                               didDiscover peripheral: CBPeripheral,
                               advertisementData: [String : Any],
                               rssi RSSI: NSNumber) {
        let id = peripheral.identifier.uuidString
        peripherals[id] = peripheral
        peripheral.delegate = self
        onPeerDiscovered?(Peer(id: id, address: id))
    }

    public func centralManager(_ central: CBCentralManager,
                               didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        peripheral.discoverServices([Self.serviceUUID])
        onConnectionChanged?(peripheral.identifier.uuidString, true)
    }

    public func centralManager(_ central: CBCentralManager,
                               didFailToConnect peripheral: CBPeripheral,
                               error: Error?) {
        onConnectionChanged?(peripheral.identifier.uuidString, false)
    }

    public func centralManager(_ central: CBCentralManager,
                               didDisconnectPeripheral peripheral: CBPeripheral,
                               error: Error?) {
        let id = peripheral.identifier.uuidString
        frameCharacteristics.removeValue(forKey: id)
        onConnectionChanged?(id, false)
    }

    // MARK: - CBPeripheralDelegate

    public func peripheral(_ peripheral: CBPeripheral,
                           didDiscoverServices error: Error?) {
        guard error == nil,
              let service = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else { return }
        peripheral.discoverCharacteristics([Self.frameUUID], for: service)
    }

    public func peripheral(_ peripheral: CBPeripheral,
                           didDiscoverCharacteristicsFor service: CBService,
                           error: Error?) {
        guard error == nil,
              let characteristic = service.characteristics?.first(where: { $0.uuid == Self.frameUUID }) else { return }
        let id = peripheral.identifier.uuidString
        frameCharacteristics[id] = characteristic
        if characteristic.properties.contains(.notify) {
            peripheral.setNotifyValue(true, for: characteristic)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral,
                           didUpdateValueFor characteristic: CBCharacteristic,
                           error: Error?) {
        guard error == nil,
              characteristic.uuid == Self.frameUUID,
              let data = characteristic.value else { return }
        onFrame?(peripheral.identifier.uuidString, data)
    }

    // MARK: - CBPeripheralManagerDelegate

    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        guard peripheral.state == .poweredOn else { return }
        if localFrameCharacteristic != nil && !advertising {
            let advertisement: [String: Any] = [CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID]]
            peripheral.startAdvertising(advertisement)
            advertising = true
        }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager,
                                  didAdd service: CBService,
                                  error: Error?) {
        guard error == nil, peripheral.state == .poweredOn, !advertising else { return }
        let advertisement: [String: Any] = [CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID]]
        peripheral.startAdvertising(advertisement)
        advertising = true
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager,
                                  central: CBCentral,
                                  didSubscribeTo characteristic: CBCharacteristic) {
        guard characteristic.uuid == Self.frameUUID else { return }
        if !subscribers.contains(where: { $0.identifier == central.identifier }) {
            subscribers.append(central)
        }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager,
                                  central: CBCentral,
                                  didUnsubscribeFrom characteristic: CBCharacteristic) {
        subscribers.removeAll { $0.identifier == central.identifier }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager,
                                  didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            guard request.characteristic.uuid == Self.frameUUID,
                  let value = request.value,
                  value.count <= Self.configuredMTU else {
                peripheral.respond(to: request, withResult: .invalidAttributeValueLength)
                continue
            }
            onFrame?(request.central.identifier.uuidString, value)
            peripheral.respond(to: request, withResult: .success)
        }
    }

    /// Sends an opaque frame to all subscribed centrals when this iPhone is
    /// acting as the BLE peripheral/relay side.
    public func notifySubscribers(frame: Data) throws {
        guard frame.count <= Self.configuredMTU,
              let characteristic = localFrameCharacteristic else {
            throw NSError(domain: "ZaycommBLE", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "BLE frame unavailable or too large"])
        }
        guard peripheralManager.updateValue(frame, for: characteristic, onSubscribedCentrals: subscribers.isEmpty ? nil : subscribers) else {
            throw NSError(domain: "ZaycommBLE", code: 5,
                          userInfo: [NSLocalizedDescriptionKey: "BLE notification could not be queued"])
        }
    }
}
