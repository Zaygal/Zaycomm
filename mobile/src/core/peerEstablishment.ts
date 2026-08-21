import { introducePeer, establishPeer, getPeer, type StoredPeer } from './peerStore';

export type PeerIdentity = {
  nodeId: string;
  publicKey: string;
  capabilities?: string[];
};

export async function introducePeerIdentity(identity: PeerIdentity): Promise<StoredPeer> {
  return introducePeer({
    nodeId: identity.nodeId,
    publicKey: identity.publicKey,
    capabilities: identity.capabilities ?? [],
  });
}

export async function establishIntroducedPeer(nodeId: string): Promise<StoredPeer> {
  const existing = await getPeer(nodeId);
  if (!existing) throw new Error('PEER_NOT_INTRODUCED');
  const established = await establishPeer(nodeId);
  if (!established) throw new Error('PEER_ESTABLISH_FAILED');
  return established;
}

export async function getPeerEstablishmentState(nodeId: string): Promise<'unknown' | 'introduced' | 'established'> {
  const peer = await getPeer(nodeId);
  if (!peer) return 'unknown';
  return peer.state;
}
