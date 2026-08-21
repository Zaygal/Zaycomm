# QR Pipeline Recovery — Plan 1

This branch is the recovery checkpoint for the QR scanner.

## Target pipeline

CameraX / Gallery → ML Kit → raw QR payload → Zaycomm QR parser → identity validation → peer establishment.

## Ownership rules

- Native `ZaycommCameraScannerModule` owns camera/gallery acquisition and ML Kit decoding.
- `qrEvents.ts` owns the application QR event pipeline.
- `AppV3` must not independently parse QR payloads or duplicate QR validation.
- Scanner lifecycle must release CameraX and remove its native preview when the Pair/Nearby scanner session ends.

## Plan 1 checkpoint

Do not change BLE behavior until camera and gallery produce the same validated QR result through the same application path.
