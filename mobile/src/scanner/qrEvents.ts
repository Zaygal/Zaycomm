import { DeviceEventEmitter, EmitterSubscription, NativeModules, PermissionsAndroid } from 'react-native';
import { introduceZaycommQrIdentity, QrIdentityResult } from './qrIdentity';
import { introducePeerIdentity } from '../core/peerEstablishment';

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
 * Single canonical QR establishment path.
 *
 * 1. Validate the QR and its cryptographic node-id fingerprint.
 * 2. Persist the node as an INTRODUCED peer.
 * 3. Only then notify the UI.
 *
 * QR never starts BLE, authenticates a transport, or marks a peer established.
 */
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
    } catch {
      // Ignore invalid/non-Zaycomm QR frames and persistence failures.
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
