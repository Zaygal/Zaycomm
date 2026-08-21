import { DeviceEventEmitter, EmitterSubscription, NativeModules, PermissionsAndroid } from 'react-native';
import { introduceZaycommQrIdentity, QrIdentityResult } from './qrIdentity';

export type ZaycommQrEvent = { payload: string; length: number; identity: QrIdentityResult };
const scanner = NativeModules.ZaycommCameraScanner;
let scanActive = false;

/**
 * Compatibility bridge for the current AppV2 camera-permission entry point.
 * It starts CameraX only after CAMERA permission is granted. The UI will move
 * to startZaycommQrScanner() directly in the next scanner-surface cleanup.
 */
const originalCameraRequest = PermissionsAndroid.request.bind(PermissionsAndroid);
PermissionsAndroid.request = async (permission: any, ...args: any[]) => {
  const result = await originalCameraRequest(permission, ...args);
  if (permission === PermissionsAndroid.PERMISSIONS.CAMERA && result === PermissionsAndroid.RESULTS.GRANTED) {
    await startZaycommQrScanner();
  }
  return result;
};

/**
 * Single canonical QR event path. Invalid/non-Zaycomm payloads never reach
 * the UI or peer registry. A valid scan is fingerprint-checked and introduced
 * before the callback fires.
 */
export function subscribeToZaycommQr(onDetected: (event: ZaycommQrEvent) => void): EmitterSubscription {
  const subscription = DeviceEventEmitter.addListener('ZaycommQrDetected', (event: { payload?: string; length?: number }) => {
    if (typeof event?.payload !== 'string') return;
    try {
      const identity = introduceZaycommQrIdentity(event.payload);
      stopZaycommQrScanner().catch(() => {});
      onDetected({ payload: event.payload, length: event.length ?? event.payload.length, identity });
    } catch {
      // Ignore invalid/non-Zaycomm QR frames.
    }
  });
  const originalRemove = subscription.remove.bind(subscription);
  subscription.remove = () => {
    stopZaycommQrScanner().catch(() => {});
    originalRemove();
  };
  return subscription;
}

export async function startZaycommQrScanner(): Promise<boolean> {
  if (scanActive) return true;
  if (!scanner?.prepareAnalysis) return false;
  try {
    const ready = Boolean(await scanner.prepareAnalysis());
    scanActive = ready;
    return ready;
  } catch {
    scanActive = false;
    return false;
  }
}

export async function stopZaycommQrScanner(): Promise<void> {
  scanActive = false;
  try { await scanner?.release?.(); } catch {}
}
