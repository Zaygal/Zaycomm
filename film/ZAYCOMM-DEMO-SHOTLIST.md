# Zaycomm real-device demo film

## Goal

Prove one claim with real footage:

> Two physical Zaycomm devices exchange an encrypted message over an offline BLE link.

No simulated device, fake network animation, synthetic ciphertext, or fabricated delivery state counts as proof.

## Required capture

Record both physical devices in the same session.

1. **Pairing**
   - Device A opens **Your Node** and displays its QR.
   - Device B scans the QR.
   - Show the authentication result on Device B.
   - Keep the node IDs visible long enough to establish that the peers are distinct.

2. **Offline condition**
   - Show Wi-Fi and cellular data disabled on both devices.
   - BLE remains enabled.
   - Do not open any Internet-dependent screen.

3. **Connection**
   - Start Zaycomm BLE transport on both devices.
   - Show the linked/connected state.

4. **Message**
   - Device A enters a harmless test message such as:
     `ZAYCOMM OFFLINE TEST 01`
   - Send it.

5. **Wire evidence**
   - The recording must show the actual transmitted frame as opaque bytes/ciphertext if the app exposes a protocol debug view.
   - The plaintext must not be visible as the transmitted payload.
   - Do not create a fake ciphertext panel for the film.

6. **Receipt**
   - Device B receives the frame.
   - Device B decrypts it and displays the original plaintext.
   - Show the delivery/ACK state if exposed by the implementation.

7. **Network proof**
   - End on both devices with the message delivered while Internet/cellular remain disabled.

## Evidence labels

Use these labels only when supported by footage:

- REAL HARDWARE
- OFFLINE
- BLE TRANSPORT
- ENCRYPTED FRAME
- DECRYPTED ON PEER
- ACK

Do not label simulated, emulator, unit-test, or protocol-only footage as real hardware.

## Film structure

Target: 60–90 seconds.

- 0–6s: ZAYCOMM / OFFLINE MESH
- 6–20s: Device A identity + Device B QR scan
- 20–32s: authentication / trusted peer
- 32–42s: Wi-Fi + cellular disabled, BLE active
- 42–58s: plaintext entered on A → sealed → opaque frame
- 58–72s: B receives → decrypts → displays message
- 72–82s: ACK / linked state
- 82–90s: final architecture card

## Architecture card

```
DEVICE A
  ↓
Zaycomm session
  ↓
encrypted envelope
  ↓
BLE
  ↓
DEVICE B
  ↓
authenticated decryption
```

The film must not claim that BLE itself provides encryption. Zaycomm's protocol layer creates the authenticated encrypted envelope; BLE is the local transport.

## Hard stop

If C25.4 physical-device proof has not been captured, the final film must remain marked **NOT YET VERIFIED**. Do not substitute emulator footage or generated visuals.
