import { DeviceEventEmitter, EmitterSubscription, NativeModules } from 'react-native';
import { introduceZaycommQrIdentity, QrIdentityResult } from './qrIdentity';
import { bindIntroducedPeerToTransport } from '../core/peerEstablishment';

export type ZaycommQrEvent = {
  payload: string;
  length: number;
  identity: QrIdentityResult;
  transportAddress?: string;
};

const scanner = NativeModules.ZaycommCameraScanner;
let scanActive = false;

export function subscribeToZaycommQr(
  onDetected: (event: ZaycommQrEvent) => void,
  getTransportAddress?: () => string | undefined,
): EmitterSubscription {
  return DeviceEventEmitter.addListener('ZaycommQrDetected', async (event: { payload?: string; length?: number }) => {
    if (typeof event?.payload !== 'string') return;
    try {
      const identity = await introduceZaycommQrIdentity(event.payload);
      const transportAddress = getTransportAddress?.();
      if (transportAddress) {
        await bindIntroducedPeerToTransport(identity.identity.nodeId, transportAddress);
      }
      await stopZaycommQrScanner();
      onDetected({
        payload: event.payload,
        length: event.length ?? event.payload.length,
        identity,
        ...(transportAddress ? { transportAddress } : {}),
      });
    } catch {
      // Invalid QR payloads are ignored; scanning remains active for the next frame.
    }
  });
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
