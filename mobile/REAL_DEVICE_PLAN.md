# Zaycomm Real-Device Execution Plan

## Current state

The Zaycomm protocol core remains TypeScript.

```text
TypeScript protocol core
        ↓
mobile-compatible JS runtime
        ↓
native platform bridge
        ↓
real radio hardware
```

Both mobile adapters use the same Zaycomm BLE service and frame characteristic so an iPhone and Android phone can be part of the same BLE test.

## Platform policy

- iOS is a first-class physical target.
- Android is a first-class physical target.
- We do not require a Mac to continue protocol implementation or TypeScript/mobile-boundary testing.
- A physical iOS build/install still requires an Apple-supported build/signing environment. If the user has no Mac, use a legitimate cloud/macOS build service or a GitHub-hosted macOS runner once the native app project is ready.
- Do not claim a physical iOS test has passed until it has actually run on an iPhone.

## BLE interoperability contract

Both platforms use:

- Service: `8F4D0001-7E2C-4C7D-9F11-7A9D00000001`
- Frame characteristic: `8F4D0002-7E2C-4C7D-9F11-7A9D00000001`
- Configured protocol transport MTU: 200 bytes

BLE advertisements contain only the public Zaycomm service. They do not expose protocol identity, public keys, routes, or encrypted application data.

The platform UUID/address is only a transport peer handle. Zaycomm identity must be established and authenticated by the protocol layer.

## C25 execution sequence

1. TypeScript mobile transport contract — implemented.
2. Android BLE native bridge — implemented.
3. iOS CoreBluetooth native bridge — implemented.
4. Cross-platform BLE UUID/advertisement alignment — implemented.
5. JS adapter tests — implemented.
6. Run complete TypeScript suite in Codespaces.
7. Prepare an actual mobile application shell around the node runtime.
8. Build on an Apple/macOS environment without requiring the user's own Mac.
9. Install the build on an iPhone and Android device.
10. Disable Internet/cellular data for the first physical test.
11. Advertise Zaycomm on both devices.
12. Discover and connect.
13. Send a real encrypted Zaycomm envelope over BLE.
14. Verify recipient decryption and authenticated ACK.
15. Repeat in the opposite direction.

## Physical test matrix

The same protocol must work across:

| Sender | Relay/Receiver | Target |
|---|---|---|
| iPhone | Android | Android/iPhone |
| Android | iPhone | iPhone/Android |
| Android | Android | Android |
| iPhone | iPhone | iPhone |

A single successful two-device test is the first hardware proof. Cross-platform testing is then required to prove the transport contract is genuinely interoperable.

## What comes next

After two-device BLE proof:

- C26: three+ physical nodes and multi-hop routing.
- C27: store-and-forward with moving relay phones.
- C28: opportunistic Internet gateway while preserving offline operation.
- C29: real multi-transport node (BLE + Wi-Fi P2P where platform APIs permit + Internet).
- C30: field campaign with movement, packet loss, restarts and connectivity changes.
- Later: purpose-built long-range radio and legitimate satellite-capable gateways.

Cellular Internet is an online transport opportunity, not an offline radio. Satellite support requires compatible satellite hardware/service or an external gateway; it must never be assumed merely because a phone has satellite-related features.

## Evidence rule

Every physical milestone records:

- exact device models;
- OS versions;
- transport used;
- Internet state;
- whether cellular data was disabled;
- sender/receiver node IDs (protocol-level, not BLE address as identity);
- message ID;
- delivery result;
- ACK result;
- elapsed time;
- failure/retry behavior.

`SIMULATED` and `REAL HARDWARE` must never be conflated.
