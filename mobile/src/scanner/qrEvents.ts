import { DeviceEventEmitter, EmitterSubscription, NativeModules, PermissionsAndroid } from 'react-native';
import { introduceZaycommQrIdentity, QrIdentityResult } from './qrIdentity';
import { introducePeerIdentity } from '../core/peerEstablishment';

export type ZaycommQrEvent = { payload: string; length: number; identity: QrIdentityResult };
const scanner = NativeModules.ZaycommCameraScanner;
let scanActive = false;

/**
 * CAMERA permission is authorization only. Once Android grants it, the scanner
 * presents the method chooser; it does not silently start CameraX.
 */
const originalCameraRequest = PermissionsAndroid.request.bind(PermissionsAndroid);
PermissionsAndroid.request = async (permission: any, ...args: any[]) => {
  const result = await originalCameraRequest(permission, ...args);
  if (permission === PermissionsAndroid.PERMISSIONS.CAMERA && result === PermissionsAndroid.RESULTS.GRANTED) {
    try { await scanner?.showScanMethodChooser?.(); } catch {}
  }
  return result;
};

export function subscribeToZaycommQr(onDetected: (event: ZaycommQrEvent) => void): EmitterSubscription {
  const subscription = DeviceEventEmitter.addListener('ZaycommQrDetected', async (event: { payload?: string; length?: number }) => {
    if (typeof event?.payload !== 'string') return;
    try {
      const identity = introduceZaycommQrIdentity(event.payload);
      await introducePeerIdentity({
        nodeId: identity.identity.nodeId,
        publicKey: identity.identity.publicKey,
        capabilities: identity.identity.capabilities ?? [],
      });
      await stopZaycommQrScanner();
      onDetected({ payload: event.payload, length: event.length ?? event.payload.length, identity });
    } catch {}
  });

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
