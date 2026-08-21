export type PeerTransportState = 'offline' | 'connecting' | 'linked';

export type PeerConnectionSnapshot = {
  nodeId: string;
  transport: PeerTransportState;
  updatedAt: number;
};

const connections = new Map<string, PeerConnectionSnapshot>();

export function setPeerTransportState(nodeId: string, transport: PeerTransportState): PeerConnectionSnapshot {
  const snapshot = { nodeId, transport, updatedAt: Date.now() };
  connections.set(nodeId, snapshot);
  return snapshot;
}

export function getPeerTransportState(nodeId: string): PeerTransportState {
  return connections.get(nodeId)?.transport ?? 'offline';
}

export function getPeerConnectionSnapshot(nodeId: string): PeerConnectionSnapshot | null {
  return connections.get(nodeId) ?? null;
}

export function clearPeerTransportState(nodeId: string): void {
  connections.delete(nodeId);
}

export function resetPeerTransportStates(): void {
  connections.clear();
}
