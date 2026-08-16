# Zaycomm Real-Device Execution Plan

## Architecture

```text
TypeScript protocol core
        ↓
React Native / mobile-compatible JS runtime
        ↓
native platform bridge
        ↓
real radio hardware
```

The mobile boundary moves opaque Zaycomm frames. Identity, authentication, encryption, routing, fragmentation/reassembly, ACK validation and store-forward remain in the TypeScript protocol core.

## BLE interoperability contract

Both platforms use:

- Service: `8F4D0001-7E2C-4C7D-9F11-7A9D00000001`
- Frame characteristic: `8F4D0002-7E2C-4C7D-9F11-7A9D00000001`
- Protocol transport ceiling: 200 bytes

Native adapters must also respect the current physical write capacity. iOS CoreBluetooth reports that capacity through `maximumWriteValueLength`; the TypeScript iOS adapter uses the lower of the native capacity and 200 bytes.

Advertisements expose only the public service. Platform UUID/address values are transport handles, never protocol identity.

---

# C25 — Real Mobile Transport Foundation

### C25.1 — TypeScript mobile boundary — IMPLEMENTED

- `mobile/src/transport.ts`
- `mobile/src/androidBleTransport.ts`
- `mobile/src/iosBleTransport.ts`

The core remains TypeScript and never imports native Bluetooth APIs.

### C25.2 — Android BLE bridge — IMPLEMENTED / HARDWARE VERIFICATION PENDING

`mobile/android/app/src/main/java/com/zaycomm/mobile/ZaycommBleModule.kt` provides scan, advertise, GATT service/characteristic registration, connection lifecycle, opaque frame writes/receives and notifications.

### C25.3 — iOS CoreBluetooth bridge — IMPLEMENTED / HARDWARE VERIFICATION PENDING

`mobile/ios/ZaycommBleBridge.swift` provides:

- CoreBluetooth scanning;
- service-only advertising;
- GATT service/characteristic creation;
- central connections;
- opaque frame writes;
- notifications/subscriptions;
- peripheral write reception;
- connection lifecycle;
- native write-capacity reporting.

The Swift bridge contains no Zaycomm protocol interpretation.

### C25.4-A — Mobile node shell — IMPLEMENTED / BUILD VERIFICATION PENDING

The first user-facing mobile node shell is now in the repository:

- `mobile/App.tsx` — node setup, BLE start, nearby-node discovery, connect action and transport log.
- `mobile/index.js` — React Native application entry point.
- `mobile/package.json` — React Native 0.86.x runtime dependencies.
- `mobile/tsconfig.json` — mobile TypeScript configuration.
- Android `ZaycommBlePackage.kt` registers the BLE native module.

The UI deliberately does not implement protocol cryptography. It controls the native transport boundary and will be wired to the existing TypeScript node/session layer before the first end-to-end message test.

### C25.4-B — Physical-device proof — OPEN

A real pair may be:

```text
Android ↔ Android
Android ↔ iPhone
iPhone  ↔ iPhone
```

Acceptance:

1. Build and install a real mobile node runtime on both devices.
2. Give each node a persistent Zaycomm identity using the existing identity implementation.
3. Grant only the platform permissions required for BLE.
4. Disable Internet and cellular data.
5. Enable BLE.
6. Discover the Zaycomm service on the peer.
7. Establish/authenticate the Zaycomm session at the protocol layer.
8. Send a real encrypted envelope.
9. Verify recipient decryption.
10. Verify destination-authenticated ACK.
11. Repeat in reverse.
12. Restart one device and repeat after reconnection.

**Codespace/Vitest results do not count as C25.4 hardware evidence.**

### Current physical setup

The repository is now prepared for a React Native mobile shell, but the current Codespace is not itself an iOS signing/build environment. iOS installation therefore requires an Apple-compatible build/signing path. Android can be built on a supported non-macOS environment.

For Android 12+, the application must request `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, and `BLUETOOTH_ADVERTISE` at runtime when those capabilities are used. The app does not derive physical location from BLE scanning, so the Android implementation can use the platform's `neverForLocation` assertion where appropriate.

For iOS, the app must provide the Core Bluetooth usage description in its Info.plist and use CoreBluetooth central/peripheral APIs for scanning, connections, advertising and GATT data transfer.

React Native 0.86 is the current stable release line as of this plan; the project deliberately pins the mobile runtime to the 0.86 line rather than tracking a nightly release.

## Physical evidence record

Record device model, OS version, build identifier, protocol node ID/fingerprint, transport, Internet/cellular state, message ID, delivery result, ACK result, elapsed time, retries/disconnects, restarts and relevant logs.

`SIMULATED`, `OS-PROCESS`, and `REAL HARDWARE` are separate evidence classes.

---

# C26 — Real Multi-Node Mobile Mesh

**Status: PREPARATION — starts after C25.4 hardware proof.**

Goal: prove three physical phones form a relay network rather than only a direct two-device link.

```text
Alice                 Bob                  Charlie
  ●  <──── BLE ────>   ●   <──── BLE ────>    ●
                         relay
```

Alice and Charlie must have no usable direct path during the first test. Run a direct-path control before starting Bob, record the result, then place Bob so both adjacent links work.

### C26 acceptance

1. Three physical phones have independent persistent Zaycomm identities.
2. Alice↔Charlie direct communication is unavailable at the chosen test positions.
3. Alice↔Bob and Bob↔Charlie local links work.
4. Alice sends an end-to-end encrypted message addressed to Charlie.
5. Bob forwards only the opaque encrypted envelope.
6. Charlie decrypts successfully.
7. Charlie's authenticated/destination-signed ACK returns through Bob to Alice.
8. Duplicate/replay protection remains active.
9. Bob can disconnect/reconnect without corrupting protocol state.
10. Charlie→Bob→Alice also succeeds.
11. The experiment is repeated at a second physical placement.

### C26 execution sequence

**A — Direct-path control**

- Internet and cellular data off on all phones.
- Alice and Charlie at the selected separation.
- Bob disabled.
- Confirm no usable direct Zaycomm session forms.

**B — Two-hop route**

- Start Bob's node/relay transport.
- Position Bob where Alice↔Bob and Bob↔Charlie are viable.
- Authenticate adjacent peers.
- Send a uniquely tagged Alice→Charlie message.
- Verify Charlie decrypts it and ACK reaches Alice.

**C — Reverse route**

- Send Charlie→Alice through Bob.
- Verify decryption and ACK.

**D — Relay interruption**

- Interrupt Bob during/after a queued delivery.
- Restore Bob.
- Verify delivery resumes without session/ratchet corruption.

C26 proves physical multi-hop routing. It does not prove long-range radio, direct cellular transport, satellite, or Internet-gateway behavior.

---

# Following phases

- **C27:** moving relay/store-and-forward with physically separated encounters.
- **C28:** opportunistic Internet gateway while preserving offline delivery.
- **C29:** real multi-transport node: BLE + supported Wi-Fi P2P + Internet.
- **C30:** field campaign: movement, packet loss, restarts, repeated encounters, malicious neighbors and connectivity changes.
- **C31+:** purpose-built long-range radio and legitimate satellite-capable gateways.

Cellular Internet is an online transport opportunity, not an offline radio. A normal smartphone must not be assumed to provide arbitrary satellite packet transport.
