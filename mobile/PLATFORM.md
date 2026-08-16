# Zaycomm Mobile Platform Execution

## Current physical-device target

The first real hardware target is **iOS**, because the current field-test device is an iPhone.

This supersedes the earlier Android-first wording in the roadmap for the purpose of the first physical-device proof. Android remains a supported future adapter target; it is not the device used for the first field test.

```text
TypeScript Zaycomm core
        ↓
mobile-compatible JS runtime
        ↓
React Native/native bridge
        ↓
CoreBluetooth (iOS)
        ↓
real iPhone BLE
```

## C25 iOS implementation status

- C25.1 mobile transport boundary: IMPLEMENTED.
- C25.2 iOS native bridge boundary: IMPLEMENTED.
- C25.3 CoreBluetooth BLE adapter: IMPLEMENTED in Swift; physical build verification pending.
- C25.4 two physical iPhones: NOT YET VERIFIED.

The adapter carries opaque Zaycomm `Uint8Array` frames only. Identity, session establishment, encryption, routing, fragmentation, ACKs, and store-and-forward remain in the TypeScript protocol core.

## C25.4 acceptance test

Two physical iPhones:

```text
Phone A                         Phone B
Alice                           Bob
  |                               |
  +========= real BLE ============+
           encrypted frame
  +<========= ACK =================+
```

Acceptance:

1. Install the mobile runtime on both iPhones.
2. Grant Bluetooth permission.
3. Create/load persistent Zaycomm identities.
4. Disable Internet/cellular data for the test.
5. Start BLE advertising/scanning on both nodes.
6. Discover and authenticate the peer through the existing Zaycomm protocol.
7. Send an encrypted message A → B over real BLE.
8. Verify B decrypts it.
9. Verify the authenticated/destination-signed delivery confirmation returns B → A.
10. Repeat B → A.
11. Record device models, iOS versions, BLE connection result, message result, ACK result, and failures.

A Codespace/Vitest result cannot mark C25.4 complete.

## Build reality

The iOS Swift/CoreBluetooth adapter requires an Apple build environment (Xcode/macOS) for physical installation and hardware verification. Codespaces can continue to validate the TypeScript adapter contract, but cannot substitute for the iPhone hardware test.
