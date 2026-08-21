import type { Identity } from './identity';
import { computeFingerprint } from './identity';

export interface KnownPeer {
  nodeId: string;
  publicKey: Uint8Array;
  introducedAt: number;
  source: 'qr';
}

/**
 * Canonical peer identity registry.
 * QR introduces an identity only; transport/routing remains separate.
 * The node ID is always the first 16 hex characters of the SHA-256
 * fingerprint defined by identity.ts.
 */
export class KnownPeerStore {
  private readonly peers = new Map<string, KnownPeer>();

  introduce(nodeId: string, publicKey: Uint8Array): KnownPeer {
    const normalizedId = nodeId.toLowerCase();
    if (!/^[0-9a-f]{16}$/.test(normalizedId) || publicKey.length !== 32) {
      throw new Error('INVALID_PEER_IDENTITY');
    }

    const derivedNodeId = nodeIdFromPublicKey(publicKey);
    if (normalizedId !== derivedNodeId) {
      throw new Error('PEER_NODE_ID_MISMATCH');
    }

    const existing = this.peers.get(normalizedId);
    if (existing) {
      if (!bytesEqual(existing.publicKey, publicKey)) {
        throw new Error('PEER_IDENTITY_MISMATCH');
      }
      return existing;
    }

    const peer: KnownPeer = {
      nodeId: normalizedId,
      publicKey: Uint8Array.from(publicKey),
      introducedAt: Date.now(),
      source: 'qr',
    };
    this.peers.set(peer.nodeId, peer);
    return peer;
  }

  get(nodeId: string): KnownPeer | undefined {
    return this.peers.get(nodeId.toLowerCase());
  }

  has(nodeId: string): boolean {
    return this.peers.has(nodeId.toLowerCase());
  }

  list(): KnownPeer[] {
    return [...this.peers.values()].map((peer) => ({
      ...peer,
      publicKey: Uint8Array.from(peer.publicKey),
    }));
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function nodeIdFromPublicKey(publicKey: Uint8Array): string {
  return computeFingerprint(publicKey).replace(/\s/g, '').slice(0, 16).toLowerCase();
}

export function identityToKnownPeer(identity: Identity, nodeId?: string): KnownPeer {
  const derived = nodeIdFromPublicKey(identity.publicKey);
  const resolvedNodeId = nodeId?.toLowerCase() ?? derived;
  if (resolvedNodeId !== derived) throw new Error('PEER_NODE_ID_MISMATCH');
  return {
    nodeId: resolvedNodeId,
    publicKey: Uint8Array.from(identity.publicKey),
    introducedAt: Date.now(),
    source: 'qr',
  };
}

export const knownPeerStore = new KnownPeerStore();
