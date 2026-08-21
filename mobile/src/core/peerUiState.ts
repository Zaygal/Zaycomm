import { getPeerEstablishmentState } from './peerEstablishment';

export type PeerUiState = 'unknown' | 'introduced' | 'established';

/** Single UI-facing adapter for Pair, Nearby and Home. */
export async function resolvePeerUiState(nodeId: string): Promise<PeerUiState> {
  return getPeerEstablishmentState(nodeId);
}

export function peerUiLabel(state: PeerUiState): string {
  switch (state) {
    case 'established': return 'ESTABLISHED';
    case 'introduced': return 'INTRODUCED';
    default: return 'UNKNOWN';
  }
}
