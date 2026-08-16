# Zaycomm Mobile Build and C25.4 Device Test

## Goal

Build the mobile node shell and validate a real Zaycomm BLE exchange between any two supported physical devices.

## Architecture

TypeScript Zaycomm core -> mobile JS runtime -> native BLE bridge -> platform BLE radio.

The BLE transport carries opaque Zaycomm frames. Identity, encryption, sessions, routing, fragmentation, synchronization, and ACK semantics remain in the protocol core.

## Android

The repository contains the Android React Native shell and native BLE bridge. Android is the first practical physical-device target because an APK can be built and installed without owning a Mac.

From an environment with the Android SDK/Gradle toolchain:

```bash
cd mobile
npm install
npx react-native run-android
```

A physical Android device must have developer options and USB debugging enabled, or use a configured wireless-debugging connection. Grant the requested Nearby devices/Bluetooth permissions when prompted.

## iOS

The repository contains the Swift/CoreBluetooth bridge and iOS configuration. An iOS binary must be built and signed with Apple's toolchain. Codespaces alone cannot sign/install an iOS application on a physical iPhone.

The iOS source can therefore be developed and tested in Codespaces, but physical iPhone validation requires an available macOS/Xcode signing environment or another legitimate macOS CI/build service.

## C25.4 physical test

1. Install Zaycomm on device A and device B.
2. Create a local Zaycomm node identity on each device.
3. Enable Bluetooth; disable Internet/cellular data for the offline test.
4. Start the BLE transport on both devices.
5. Verify Zaycomm service discovery.
6. Establish the authenticated Zaycomm session.
7. Send an encrypted message A -> B.
8. Verify B decrypts and delivers it.
9. Verify the destination-signed ACK returns B -> A.
10. Repeat B -> A.
11. Record device/platform, transport, packet/frame counts, connection events, and ACK result.

Do not mark C25.4 complete from unit tests alone. It requires the physical exchange above.

## C26 preparation

After C25.4 succeeds, add a third physical node and prove:

A -> Relay -> C
C -> Relay -> A

The relay must forward the opaque encrypted envelope without learning the plaintext. Then test queue/store-and-forward by taking the destination offline and restoring it.
