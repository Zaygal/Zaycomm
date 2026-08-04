// src/transport/transport.ts
// RFC-0008, Section 1: Transport Interface Contract.
//
// A transport moves opaque bytes between two directly reachable
// nodes and reports its own basic characteristics. It must NOT know
// or care what's inside those bytes, that's the whole point of
// transport agnosticism (RFC-0001 Section 4.1): the routing, session,
// and crypto layers built in earlier phases should work completely
// unchanged regardless of which transport is underneath.
//
// This file deliberately does not touch routing.ts's RelayNode.
// Rewiring RelayNode to send through a Transport instead of calling
// a neighbor directly in-process is a real architectural change,
// flagged as a deferred follow-up in PROGRESS.md, not bundled in
// here. This phase proves the transport contract itself works.

export interface LinkCharacteristics {
  maxTransmissionUnit: number;
  reliability: number; // rough 0 to 1 estimate, per RFC-0008 Section 1
}

export interface Transport {
  readonly name: string;
  discoverNeighbors(): string[];
  /** Returns false if the frame cannot be sent (e.g. exceeds MTU), true if delivered. */
  send(neighborId: string, frame: Uint8Array): boolean;
  onReceive(callback: (fromNeighborId: string, frame: Uint8Array) => void): void;
  getLinkCharacteristics(neighborId: string): LinkCharacteristics | null;
}

/**
 * A simulated point-to-point transport. Real hardware access isn't
 * available from this environment, so this models the CONSTRAINTS of
 * a real transport (MTU, rough reliability) rather than real radio
 * behavior, which is exactly what the layers above actually depend
 * on per the Transport Interface Contract, they only ever see the
 * generic characteristics, never transport-specific details.
 */
export class SimulatedTransport implements Transport {
  private peers = new Map<string, SimulatedTransport>();
  private receiveCallback: ((fromNeighborId: string, frame: Uint8Array) => void) | null = null;

  constructor(
    readonly name: string,
    private readonly ownId: string,
    private readonly maxTransmissionUnit: number,
    private readonly reliability: number = 1.0
  ) {}

  connectPeer(peer: SimulatedTransport): void {
    this.peers.set(peer.ownId, peer);
    peer.peers.set(this.ownId, this);
  }

  discoverNeighbors(): string[] {
    return Array.from(this.peers.keys());
  }

  send(neighborId: string, frame: Uint8Array): boolean {
    if (frame.length > this.maxTransmissionUnit) return false;
    const peer = this.peers.get(neighborId);
    if (!peer) return false;
    peer.receiveCallback?.(this.ownId, frame);
    return true;
  }

  onReceive(callback: (fromNeighborId: string, frame: Uint8Array) => void): void {
    this.receiveCallback = callback;
  }

  getLinkCharacteristics(neighborId: string): LinkCharacteristics | null {
    if (!this.peers.has(neighborId)) return null;
    return { maxTransmissionUnit: this.maxTransmissionUnit, reliability: this.reliability };
  }
}

/**
 * RFC-0008 Section 2: small MTU, the realistic constraint that makes
 * fragmentation (RFC-0006 Section 5) necessary for anything but small
 * envelopes. 200 bytes approximates a real BLE ATT MTU.
 */
export function createBluetoothTransport(ownId: string): SimulatedTransport {
  return new SimulatedTransport('bluetooth-le', ownId, 200, 0.9);
}

/** RFC-0008 Section 3: meaningfully larger MTU, better suited to full envelopes. */
export function createWifiDirectTransport(ownId: string): SimulatedTransport {
  return new SimulatedTransport('wifi-direct', ownId, 4096, 0.95);
}




/**
 * RFC-0008 Section 5: very high effective range and bandwidth,
 * generally strong reliability, never assumed present, never
 * required, used opportunistically by gateway nodes (RFC-0003
 * Section 5) whenever real Internet connectivity happens to exist.
 */
export function createInternetTransport(ownId: string): SimulatedTransport {
  return new SimulatedTransport('internet', ownId, 65536, 0.99);
}