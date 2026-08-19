import {knownPeerStore, type KnownPeer} from '../../../src/identity/knownPeers';

export interface ZaycommQrIdentity {
  scheme: 'zaycomm';
  version: 1;
  nodeId: string;
  publicKey: string;
}

export interface QrIdentityResult {
  peer: KnownPeer;
  identity: ZaycommQrIdentity;
}

/**
 * Parses and introduces a Zaycomm QR identity into the existing identity
 * model. This deliberately does not initiate BLE or any other transport.
 */
export function introduceZaycommQrIdentity(payload: string): QrIdentityResult {
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

  const identity: ZaycommQrIdentity = {
    scheme: 'zaycomm',
    version: 1,
    nodeId: parsed.nodeId.toLowerCase(),
    publicKey: parsed.publicKey.toLowerCase(),
  };
  const publicKey = hexToBytes(identity.publicKey);
  const peer = knownPeerStore.introduce(identity.nodeId, publicKey);
  return {peer, identity};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
