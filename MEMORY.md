# Zaycomm — Execution Memory

> This file is the continuity source for future Zaycomm implementation sessions.
>
> **Evidence rule:** code existing is not proof of a milestone. `SIMULATED`, `OS-PROCESS`, and `REAL HARDWARE` are separate evidence classes.

## Mission

Zaycomm is an offline-first, secure, transport-agnostic communication network.

Core requirement:

> Real mobile devices must exchange end-to-end encrypted Zaycomm messages without requiring Internet connectivity.

If a node happens to have Internet, it may opportunistically accelerate delivery, but Internet is optional to the protocol.

```text
                    ZAYCOMM CORE
                        |
                 encrypted envelope
                        |
                     routing
                        |
                 transport interface
          +-------------+-------------+
          |             |             |
         BLE          Wi-Fi        Internet
          |             |             |
          +-------------+-------------+
                        |
                  physical node
```

## Non-negotiable architecture

```text
TypeScript protocol core
        ↓
mobile-compatible JS runtime
        ↓
native platform bridge
        ↓
real radio hardware
```

Keep cryptography, identity, sessions, routing, fragmentation/reassembly, ACK validation and store-forward above native radio adapters. Native code transports opaque bytes.

## Verified baseline

### Security

- C1–C20 security hardening: **COMPLETE / VERIFIED**.
- Regression and adversarial campaign are part of the release gate.
- Security controls include authenticated session binding, replay protection, bounded fragment state, route probation/trust, destination-authenticated ACK handling, malformed-wire defenses and concurrency/race defenses.

### Real-node protocol track

- C21 — RelayNode integration: **COMPLETE**.
- C22 — real UDP node communication: **COMPLETE**.
- C23 — independent OS-process nodes: **COMPLETE**.
- C24 — independent-process encrypted sync: **COMPLETE / VERIFIED**.

Recent known baseline before the latest C25 contract additions: **203 / 203 tests passed**.

C24 proves independent encrypted OS processes, not physical phone radios.

---

# C25 — Real Mobile Transport Foundation

## C25.1 — TypeScript mobile boundary

**IMPLEMENTED**

Files:

- `mobile/src/transport.ts`
- `mobile/src/androidBleTransport.ts`
- `mobile/src/iosBleTransport.ts`

The boundary carries opaque `Uint8Array` frames and link characteristics.

## C25.2 — Android BLE native bridge

**IMPLEMENTED / PHYSICAL HARDWARE VERIFICATION PENDING**

`mobile/android/app/src/main/java/com/zaycomm/mobile/ZaycommBleModule.kt`

Provides BLE scan, service-only advertising, GATT service/characteristic registration, connection lifecycle, opaque frame write/receive, notifications and permission guards.

## C25.3 — iOS CoreBluetooth native bridge

**IMPLEMENTED / PHYSICAL HARDWARE VERIFICATION PENDING**

`mobile/ios/ZaycommBleBridge.swift`

Provides CoreBluetooth central/peripheral behavior, the shared Zaycomm BLE service/characteristic, opaque frame I/O, notifications, lifecycle events and native write-capacity reporting.

`mobile/src/iosBleTransport.ts` uses the lower of the native CoreBluetooth write capacity and the 200-byte Zaycomm transport ceiling.

`test/ios-ble-transport.test.ts` covers the TypeScript iOS adapter contract, opaque frame forwarding, native capacity binding and MTU enforcement.

### Shared BLE contract

- Service: `8F4D0001-7E2C-4C7D-9F11-7A9D00000001`
- Frame characteristic: `8F4D0002-7E2C-4C7D-9F11-7A9D00000001`
- Protocol ceiling: 200 bytes

Platform UUID/address values are transport handles only. They are never protocol identity.

## C25.4 — Two physical devices

**OPEN — REAL HARDWARE REQUIRED**

First hardware proof may be:

```text
Android ↔ Android
Android ↔ iPhone
iPhone  ↔ iPhone
```

Acceptance:

1. Real mobile node runtime installed on both devices.
2. Persistent protocol identity on each device.
3. Internet and cellular data disabled.
4. Real BLE discovery and connection.
5. Protocol-level peer authentication.
6. Real encrypted envelope delivery.
7. Recipient decrypts successfully.
8. Destination-authenticated ACK returns.
9. Reverse direction succeeds.
10. Restart/reconnect test succeeds.

**No Codespace/vitest result may be reported as C25.4 hardware proof.**

Physical evidence must record device models, OS versions, build, protocol node IDs, transport, Internet/cellular state, message ID, delivery/ACK result, elapsed time, retries/disconnects and relevant logs.

### Important platform constraint

The user does not have a personal Mac. That does not block TypeScript or Android development. A physical iOS build/signing step requires an Apple-supported macOS/Xcode environment; use a legitimate cloud/macOS build environment when the native app shell is ready. Do not claim iOS hardware verification until an actual iPhone run occurs.

---

# C26 — Real Multi-Node Mobile Mesh

**STATUS: PREPARED — HARDWARE TEST NOT STARTED**

Goal: prove three physical phones form a relay network.

```text
Alice  ←→  Bob  ←→  Charlie
             relay
```

First establish that Alice and Charlie have no usable direct path at the selected physical positions. Then introduce Bob as the only viable relay.

### C26 acceptance

1. Three independent persistent Zaycomm identities.
2. No usable Alice↔Charlie direct path.
3. Alice↔Bob local link works.
4. Bob↔Charlie local link works.
5. Alice→Bob→Charlie encrypted delivery succeeds.
6. Bob forwards opaque ciphertext and cannot decrypt the application payload.
7. Charlie decrypts successfully.
8. Charlie's destination-authenticated ACK returns through Bob to Alice.
9. Replay/duplicate defenses remain active.
10. Bob interruption/reconnection does not corrupt session/ratchet state.
11. Charlie→Bob→Alice succeeds.
12. Test repeats at a second physical placement.

Detailed C25/C26 execution procedure is in `mobile/REAL_DEVICE_PLAN.md`.

---

# C27–C30 and beyond

- **C27:** moving relay/store-and-forward; relay physically carries encrypted data between intermittent contacts.
- **C28:** opportunistic Internet gateway; an Internet-connected node may accelerate delivery while preserving offline operation.
- **C29:** real multi-transport node: BLE + supported Wi-Fi P2P + Internet behind the same transport interface.
- **C30:** field campaign: mobility, packet loss, radio disconnects, restarts, repeated encounters, malicious neighbors and Internet toggling.
- **C31+:** purpose-built long-range radio and legitimate satellite-capable gateways.

Cellular Internet is an online transport opportunity, not an offline radio. Satellite requires compatible hardware/service/gateway and must not be assumed from an ordinary smartphone.

---

# Testing ladder

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
Offline + opportunistic Internet
 ↓
Field campaign
```

Never skip the stated acceptance evidence merely because lower-level tests pass.

## Execution rules

1. Read `MEMORY.md` before continuing work.
2. Inspect repository state before proposing changes.
3. Do not invent RFCs, APIs, transports, hardware capabilities or completed milestones.
4. Label planned work **PLANNED**, simulated work **SIMULATED**, OS-process evidence **OS-PROCESS**, and physical tests **REAL HARDWARE**.
5. Keep native code below the TypeScript protocol boundary.
6. After implementation: focused tests → full suite → status → commit → update memory/progress.
7. Do not move to the next C-phase solely because code compiles.
8. Real hardware milestones require actual devices and recorded evidence.

## Current next action

**C25.4 is the next execution gate: build/install the real mobile node and perform the first two-phone BLE proof. Once C25.4 passes, begin C26 with three physical phones and the direct-path control + two-hop relay test.**
