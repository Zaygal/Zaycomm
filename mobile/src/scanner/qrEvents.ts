import { DeviceEventEmitter, EmitterSubscription, NativeModules } from 'react-native';
import { introduceZaycommQrIdentity, QrIdentityResult } from './qrIdentity';

export type ZaycommQrEvent = {
  payload: string;
  length: number;
  identity: QrIdentityResult;
};

const scanner = NativeModules.ZaycommCameraScanner;
let scanActive = false;

/**
 * Subscribe to the single canonical Zaycomm QR introduction event.
 * A valid scan is parsed, fingerprint-checked, introduced into the peer
 * registry, and only then delivered to the UI. Camera lifecycle is explicit;
 * this module never monkey-patches React Native permission APIs.
 */
export function subscribeToZaycommQr(
  onDetected: (event: ZaycommQrEvent) => void,
): EmitterSubscription {
  const subscription = DeviceEventEmitter.addListener(
    'ZaycommQrDetected',
    (event: { payload?: string; length?: number }) => {
      if (typeof event?.payload !== 'string') return;
      try {
        const identity = introduceZaycommQrIdentity(event.payload);
        stopZaycommQrScanner().catch(() => {});
        onDetected({
          payload: event.payload,
          length: event.length ?? event.payload.length,
          identity,
        });
      } catch {
        // Invalid/non-Zaycomm payloads never reach the peer-establishment UI.
      }
    },
  );

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
  try {
    await scanner?.release?.();
  } catch {}
}
