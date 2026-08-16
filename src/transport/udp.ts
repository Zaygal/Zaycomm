// src/transport/udp.ts
// RFC-0008 transport adapter for real Node.js UDP sockets.
//
// The transport only moves opaque frames. Routing, identity, session
// authentication, fragmentation, and encryption remain above this layer.

import * as dgram from 'node:dgram';
import type { Transport, LinkCharacteristics } from './transport';

export interface UdpPeer {
  host: string;
  port: number;
}

export interface UdpTransportOptions {
  host?: string;
  port?: number;
  maxTransmissionUnit?: number;
  reliability?: number;
}

const DEFAULT_MTU = 1200;
const DEFAULT_RELIABILITY = 0.99;

function endpointKey(host: string, port: number): string {
  return `${host}:${port}`;
}

/**
 * Real point-to-point UDP transport for Node.js.
 *
 * UDP is deliberately used as an opaque datagram carrier: Zaycomm's
 * application protocol remains responsible for authentication, replay
 * resistance, retransmission/store-forward, and end-to-end protection.
 */
export class UdpTransport implements Transport {
  readonly name = 'udp4';

  private readonly socket = dgram.createSocket('udp4');
  private readonly peers = new Map<string, UdpPeer>();
  private readonly neighborByEndpoint = new Map<string, string>();
  private receiveCallback: ((fromNeighborId: string, frame: Uint8Array) => void) | null = null;
  private readonly mtu: number;
  private readonly reliability: number;
  private readonly readyPromise: Promise<void>;
  private closed = false;

  constructor(
    readonly ownId: string,
    options: UdpTransportOptions = {},
  ) {
    this.mtu = options.maxTransmissionUnit ?? DEFAULT_MTU;
    this.reliability = options.reliability ?? DEFAULT_RELIABILITY;
    if (!Number.isInteger(this.mtu) || this.mtu <= 0 || this.mtu > 65507) throw new Error('INVALID_UDP_MTU');
    if (!Number.isFinite(this.reliability) || this.reliability < 0 || this.reliability > 1) throw new Error('INVALID_UDP_RELIABILITY');

    this.socket.on('message', (message, rinfo) => {
      const neighborId = this.neighborByEndpoint.get(endpointKey(rinfo.address, rinfo.port));
      if (!neighborId || !this.receiveCallback || message.length > this.mtu) return;
      this.receiveCallback(neighborId, Uint8Array.from(message));
    });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.socket.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.socket.off('error', onError);
        resolve();
      };
      this.socket.once('error', onError);
      this.socket.once('listening', onListening);
      this.socket.bind(options.port ?? 0, options.host ?? '127.0.0.1');
    });
  }

  async ready(): Promise<void> {
    return this.readyPromise;
  }

  get address(): { host: string; port: number } {
    const info = this.socket.address();
    if (typeof info === 'string') throw new Error('UDP_SOCKET_NOT_READY');
    return { host: info.address, port: info.port };
  }

  addPeer(neighborId: string, peer: UdpPeer): void {
    if (!neighborId || !Number.isInteger(peer.port) || peer.port < 1 || peer.port > 65535) throw new Error('INVALID_UDP_PEER');
    this.peers.set(neighborId, { host: peer.host, port: peer.port });
    this.neighborByEndpoint.set(endpointKey(peer.host, peer.port), neighborId);
  }

  removePeer(neighborId: string): void {
    const peer = this.peers.get(neighborId);
    if (!peer) return;
    this.peers.delete(neighborId);
    this.neighborByEndpoint.delete(endpointKey(peer.host, peer.port));
  }

  discoverNeighbors(): string[] {
    return Array.from(this.peers.keys());
  }

  send(neighborId: string, frame: Uint8Array): boolean {
    if (this.closed || frame.length > this.mtu) return false;
    const peer = this.peers.get(neighborId);
    if (!peer) return false;
    try {
      this.socket.send(frame, peer.port, peer.host, (error) => {
        // Delivery confirmation belongs to the protocol above UDP. The
        // callback intentionally only exposes kernel-send errors here.
        if (error) return;
      });
      return true;
    } catch {
      return false;
    }
  }

  onReceive(callback: (fromNeighborId: string, frame: Uint8Array) => void): void {
    this.receiveCallback = callback;
  }

  getLinkCharacteristics(neighborId: string): LinkCharacteristics | null {
    return this.peers.has(neighborId)
      ? { maxTransmissionUnit: this.mtu, reliability: this.reliability }
      : null;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.readyPromise.catch(() => undefined);
    if (this.socket.address()) {
      await new Promise<void>((resolve) => {
        this.socket.close(() => resolve());
      });
    }
  }
}

export function createUdpTransport(ownId: string, options: UdpTransportOptions = {}): UdpTransport {
  return new UdpTransport(ownId, options);
}
