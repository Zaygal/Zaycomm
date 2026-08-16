# Zaycomm — Implementation Progress

This tracks what is actually built and tested against the RFC series and real-node roadmap.

**Active branch:** `Test`

**Core stack:** TypeScript, Node, vitest.

**Full regression baseline:** 203 / 203 tests passed before the latest C25 iOS additions.

---

## Verified security and node track

- C1–C20 security hardening: **COMPLETE / VERIFIED**
- C21 RelayNode integration: **COMPLETE**
- C22 real UDP communication: **COMPLETE**
- C23 independent OS-process nodes: **COMPLETE**
- C24 independent-process encrypted sync: **COMPLETE / VERIFIED**

C24 demonstrated encrypted synchronization between independently running OS processes using established directional session keys.

This does **not** constitute proof of physical phone-radio communication.

---

# C25 — Real Mobile Transport Foundation

**Architecture:** keep the protocol core in TypeScript; native code only bridges physical radio APIs.

```text
TypeScript Zaycomm core
        ↓
mobile-compatible JavaScript runtime
        ↓
native platform bridge
        ↓
real radio hardware
```

### C25.1 — TypeScript mobile boundary — 🟢 IMPLEMENTED

`mobile/src/transport.ts`, `mobile/src/androidBleTransport.ts`, `mobile/src/iosBleTransport.ts`

Opaque `Uint8Array` frames cross the mobile boundary. The transport adapter does not interpret protocol contents.

### C25.2 — Android BLE native bridge — 🟢 IMPLEMENTED / HARDWARE VERIFICATION PENDING

`mobile/android/app/src/main/java/com/zaycomm/mobile/ZaycommBleModule.kt`

Implements BLE scanning, service-only advertising, GATT registration, connection lifecycle, opaque frame write/receive, notifications and Android permission guards.

### C25.3 — iOS CoreBluetooth bridge — 🟢 IMPLEMENTED / HARDWARE VERIFICATION PENDING

`mobile/ios/ZaycommBleBridge.swift`

Implements CoreBluetooth central/peripheral behavior, the shared Zaycomm service/characteristic, opaque frame I/O, notifications, connection lifecycle and native write-capacity reporting.

`mobile/src/iosBleTransport.ts` now consumes the native iOS write capacity instead of assuming every physical link can carry the full 200-byte protocol ceiling.

### C25.3 contract tests — 🟢 IMPLEMENTED

`test/ios-ble-transport.test.ts`

Covers opaque frame forwarding, CoreBluetooth transport handles, native write-capacity binding, MTU rejection and connection enforcement.

### C25.4 — Two-device physical proof — 🔵 OPEN

This is the first milestone that requires actual phones.

Valid first pairings include:

```text
Android ↔ Android
Android ↔ iPhone
iPhone  ↔ iPhone
```

Required proof:

- persistent protocol identity on both phones;
- Internet and cellular data disabled;
- real BLE discovery/connection;
- protocol-level peer authentication;
- real encrypted envelope delivery;
- recipient decryption;
- destination-authenticated ACK;
- reverse-direction delivery;
- repeat after a device restart/reconnection.

**No Codespace test is being counted as C25.4 evidence.**

---

# C26 — Real Multi-Node Mobile Mesh

**Status: 🟡 PREPARED / NOT STARTED AS HARDWARE TEST**

Target topology:

```text
Alice  ←→  Bob  ←→  Charlie
             relay
```

C26 will use three physical devices with Internet/cellular data disabled. Alice and Charlie must first be shown unable to communicate directly at the selected physical positions. Bob is then introduced as the only viable relay path.

Acceptance:

1. Three persistent protocol identities.
2. No usable Alice↔Charlie direct path.
3. Alice↔Bob and Bob↔Charlie links work.
4. Alice→Bob→Charlie encrypted delivery succeeds.
5. Bob cannot decrypt the application payload.
6. Charlie's destination-authenticated ACK returns through Bob.
7. Duplicate/replay protection remains active.
8. Bob interruption/reconnection does not corrupt session/ratchet state.
9. Charlie→Bob→Alice succeeds.
10. Test repeats at a second physical placement.

Detailed procedure is in `mobile/REAL_DEVICE_PLAN.md`.

---

## Future physical track

- C27 — moving relay/store-and-forward
- C28 — opportunistic Internet gateway
- C29 — real multi-transport node (BLE + supported Wi-Fi P2P + Internet)
- C30 — field campaign
- C31+ — purpose-built long-range radio and legitimate satellite-capable gateways

Cellular Internet remains an online transport opportunity. Satellite capability requires compatible hardware/service/gateway and is not assumed from an ordinary smartphone.

---

## Testing rule

```text
Unit
  ↓
Integration
  ↓
Simulated transport
  ↓
Independent OS processes
  ↓
Real transport
  ↓
Two physical devices (C25.4)
  ↓
Three+ physical devices (C26)
  ↓
Mobility/intermittency
  ↓
Hybrid offline + Internet gateway
  ↓
Field campaign
```

`SIMULATED`, `OS-PROCESS`, and `REAL HARDWARE` are never interchangeable evidence.

---

## Environment notes

- Development is being performed from GitHub Codespaces/mobile browser.
- The user does not have a personal Mac; this does not block TypeScript/core or Android development. Physical iOS build/signing requires an Apple-supported macOS/Xcode environment, which can be supplied by a legitimate cloud/macOS build service when the native app shell is ready.
- C22 UDP is Node.js-only.
- C23/C24 process tests are Node.js-only.
- The mobile directory is an integration track and is not hardware proof until a real phone test succeeds.

*Last updated: C25 mobile BLE foundation extended with iOS CoreBluetooth bridge; C25.4 remains open; C26 physical mesh procedure prepared.*
