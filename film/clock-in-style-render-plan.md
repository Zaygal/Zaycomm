# Zaycomm film render plan

This directory is reserved for the final evidence film once real two-device footage exists.

Expected source:

- `film/raw/zaycomm-two-device-real.mp4`

Expected outputs:

- `film/zaycomm-demo.mp4`
- `film/zaycomm-demo-captioned.mp4`
- `film/zaycomm-demo.srt`
- `film/zaycomm-demo-README.md`

The render must preserve the captured device footage and audio. It may add restrained labels, captions, cuts, and evidence cards.

It must not manufacture:

- a second phone
- a BLE connection
- encrypted bytes
- a successful authentication
- a delivered message
- an ACK
- an offline state

Those must all come from the captured implementation.

## Current state

The repository has the native Android BLE bridge, iOS CoreBluetooth bridge, QR introduction/authentication path, encrypted envelope implementation, and mobile transport boundary. The real two-device acceptance test C25.4-B remains open.

Therefore no final Zaycomm evidence video is being claimed yet.
