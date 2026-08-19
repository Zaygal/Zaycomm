import type { Identity } from './identity';

export interface KnownPeer {
  nodeId: string;
  publicKey: Uint8Array;
  introducedAt: number;
  source: 'qr';
}

/**
 * In-memory identity introduction registry.
 * QR only introduces an identity; transport/routing remains separate.
 */
export class KnownPeerStore {
  private readonly peers = new Map<string, KnownPeer>();

  introduce(nodeId: string, publicKey: Uint8Array): KnownPeer {
    if (!/^[0-9a-f]{16}$/i.test(nodeId) || publicKey.length !== 32) {
      throw new Error('INVALID_PEER_IDENTITY');
    }
    const derivedNodeId = nodeIdFromPublicKey(publicKey);
    if (nodeId.toLowerCase() !== derivedNodeId) {
      throw new Error('PEER_NODE_ID_MISMATCH');
    }
    const existing = this.peers.get(nodeId.toLowerCase());
    if (existing) {
      if (!bytesEqual(existing.publicKey, publicKey)) throw new Error('PEER_IDENTITY_MISMATCH');
      return existing;
    }
    const peer: KnownPeer = {
      nodeId: nodeId.toLowerCase(),
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
    return [...this.peers.values()].map((peer) => ({ ...peer, publicKey: Uint8Array.from(peer.publicKey) }));
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function nodeIdFromPublicKey(publicKey: Uint8Array): string {
  const hex = Array.from(publicKey).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16).toLowerCase();
}

export function identityToKnownPeer(identity: Identity, nodeId?: string): KnownPeer {
  const resolvedNodeId = nodeId ?? nodeIdFromPublicKey(identity.publicKey);
  return {
    nodeId: resolvedNodeId,
    publicKey: Uint8Array.from(identity.publicKey),
    introducedAt: Date.now(),
    source: 'qr',
  };
}

/** Process-wide store used by the mobile QR introduction bridge. */
export const knownPeerStore = new KnownPeerStore();
