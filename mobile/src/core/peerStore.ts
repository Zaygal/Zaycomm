import AsyncStorage from '@react-native-async-storage/async-storage';

export type PeerState = 'introduced' | 'established';

export type StoredPeer = {
  nodeId: string;
  publicKey: string;
  capabilities: string[];
  state: PeerState;
  introducedAt: number;
  establishedAt?: number;
};

const STORAGE_KEY = '@zaycomm/peers/v1';

function normalizePeer(peer: StoredPeer): StoredPeer {
  return {
    nodeId: peer.nodeId.trim(),
    publicKey: peer.publicKey.trim().toLowerCase(),
    capabilities: [...new Set(peer.capabilities)].sort(),
    state: peer.state === 'established' ? 'established' : 'introduced',
    introducedAt: Number.isFinite(peer.introducedAt) ? peer.introducedAt : Date.now(),
    ...(peer.establishedAt ? { establishedAt: peer.establishedAt } : {}),
  };
}

async function read(): Promise<Record<string, StoredPeer>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => {
        const peer = value as Partial<StoredPeer>;
        return typeof peer?.nodeId === 'string' && typeof peer?.publicKey === 'string';
      }).map(([key, value]) => [key, normalizePeer(value as StoredPeer)])
    );
  } catch {
    return {};
  }
}

async function write(peers: Record<string, StoredPeer>): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(peers));
}

export async function getPeer(nodeId: string): Promise<StoredPeer | null> {
  const peers = await read();
  return peers[nodeId] ?? null;
}

export async function listPeers(): Promise<StoredPeer[]> {
  const peers = await read();
  return Object.values(peers).sort((a, b) => b.introducedAt - a.introducedAt);
}

export async function introducePeer(input: Omit<StoredPeer, 'state' | 'introducedAt' | 'establishedAt'>): Promise<StoredPeer> {
  const peers = await read();
  const existing = peers[input.nodeId];
  const peer = normalizePeer({
    ...input,
    state: existing?.state ?? 'introduced',
    introducedAt: existing?.introducedAt ?? Date.now(),
    ...(existing?.establishedAt ? { establishedAt: existing.establishedAt } : {}),
  });
  peers[peer.nodeId] = peer;
  await write(peers);
  return peer;
}

export async function establishPeer(nodeId: string): Promise<StoredPeer | null> {
  const peers = await read();
  const existing = peers[nodeId];
  if (!existing) return null;
  const peer = normalizePeer({ ...existing, state: 'established', establishedAt: existing.establishedAt ?? Date.now() });
  peers[nodeId] = peer;
  await write(peers);
  return peer;
}

export async function removePeer(nodeId: string): Promise<void> {
  const peers = await read();
  delete peers[nodeId];
  await write(peers);
}

export async function isEstablishedPeer(nodeId: string): Promise<boolean> {
  const peer = await getPeer(nodeId);
  return peer?.state === 'established';
}
