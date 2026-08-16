# Zaycomm Real-Device Execution Plan

## Architecture

```text
TypeScript protocol core
        ↓
mobile-compatible JS runtime
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

### C25.4 — Two-device physical proof — OPEN

A real pair may be:

```text
Android ↔ Android
Android ↔ iPhone
iPhone  ↔ iPhone
```

Acceptance:

1. Install a real mobile node runtime on both devices.
2. Give each node a persistent Zaycomm identity.
3. Disable Internet and cellular data.
4. Enable BLE.
5. Discover and authenticate the peer at the protocol layer.
6. Send a real encrypted envelope.
7. Verify recipient decryption.
8. Verify destination-authenticated ACK.
9. Repeat in reverse.
10. Restart one device and repeat after reconnection.

**Codespace/vitest results do not count as C25.4 hardware evidence.**

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
