import { computeFingerprint } from '../../../src/identity/identity';
import { introducePeerIdentity, type PeerIdentity } from '../core/peerEstablishment';

export interface ZaycommQrIdentity {
  scheme: 'zaycomm';
  version: 1;
  nodeId: string;
  publicKey: string;
  capabilities?: string[];
  nonce?: string;
}

export interface QrIdentityResult {
  peer: Awaited<ReturnType<typeof introducePeerIdentity>>;
  identity: ZaycommQrIdentity;
}

/**
 * Canonical QR identity introduction.
 * QR only introduces a peer identity; it does not authenticate a transport,
 * start BLE, or mark the peer as established by itself.
 */
export async function introduceZaycommQrIdentity(payload: string): Promise<QrIdentityResult> {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 4096) {
    throw new Error('INVALID_QR_PAYLOAD');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('INVALID_QR_PAYLOAD');
  }

  if (!isRecord(parsed) || parsed.scheme !== 'zaycomm' || parsed.version !== 1) {
    throw new Error('INVALID_ZAYCOMM_QR');
  }
  if (typeof parsed.nodeId !== 'string' || !/^[0-9a-f]{16}$/i.test(parsed.nodeId)) {
    throw new Error('INVALID_NODE_ID');
  }
  if (typeof parsed.publicKey !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.publicKey)) {
    throw new Error('INVALID_PUBLIC_KEY');
  }

  const nodeId = parsed.nodeId.toLowerCase();
  const publicKey = parsed.publicKey.toLowerCase();
  const fingerprint = computeFingerprint(hexToBytes(publicKey)).replace(/\s/g, '').slice(0, 16).toLowerCase();
  if (fingerprint !== nodeId) throw new Error('PEER_NODE_ID_MISMATCH');

  let capabilities: string[] | undefined;
  if (parsed.capabilities !== undefined) {
    if (!Array.isArray(parsed.capabilities) || parsed.capabilities.some((value) => typeof value !== 'string')) {
      throw new Error('INVALID_CAPABILITIES');
    }
    capabilities = [...new Set(parsed.capabilities as string[])].slice(0, 32);
  }

  let nonce: string | undefined;
  if (parsed.nonce !== undefined) {
    if (typeof parsed.nonce !== 'string' || !/^[0-9a-f]{32}$/i.test(parsed.nonce)) {
      throw new Error('INVALID_NONCE');
    }
    nonce = parsed.nonce.toLowerCase();
  }

  const identity: ZaycommQrIdentity = {
    scheme: 'zaycomm',
    version: 1,
    nodeId,
    publicKey,
    ...(capabilities ? { capabilities } : {}),
    ...(nonce ? { nonce } : {}),
  };

  const peerIdentity: PeerIdentity = {
    nodeId,
    publicKey,
    capabilities,
  };

  const peer = await introducePeerIdentity(peerIdentity);
  return { peer, identity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('INVALID_PUBLIC_KEY');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
