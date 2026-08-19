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
    if (!nodeId || publicKey.length !== 32) throw new Error('INVALID_PEER_IDENTITY');
    const existing = this.peers.get(nodeId);
    if (existing) {
      if (!bytesEqual(existing.publicKey, publicKey)) throw new Error('PEER_IDENTITY_MISMATCH');
      return existing;
    }
    const peer: KnownPeer = {
      nodeId,
      publicKey: Uint8Array.from(publicKey),
      introducedAt: Date.now(),
      source: 'qr',
    };
    this.peers.set(nodeId, peer);
    return peer;
  }

  get(nodeId: string): KnownPeer | undefined {
    return this.peers.get(nodeId);
  }

  has(nodeId: string): boolean {
    return this.peers.has(nodeId);
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
  return hex.slice(0, 16);
}

export function identityToKnownPeer(identity: Identity, nodeId?: string): KnownPeer {
  return {
    nodeId: nodeId ?? nodeIdFromPublicKey(identity.publicKey),
    publicKey: Uint8Array.from(identity.publicKey),
    introducedAt: Date.now(),
    source: 'qr',
  };
}
