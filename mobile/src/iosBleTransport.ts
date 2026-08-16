import type {
  MobileLinkCharacteristics,
  MobilePeer,
  MobileTransport,
} from './transport';

export interface IosBleBridge {
  startScan(): void;
  stopScan(): void;
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  write(peerId: string, frame: Uint8Array): Promise<void>;
  onAdvertisement(callback: (peer: MobilePeer) => void): void;
  onFrame(callback: (peerId: string, frame: Uint8Array) => void): void;
  onConnectionChanged(callback: (peerId: string, connected: boolean) => void): void;
  /** Native CoreBluetooth write-without-response capacity for this peer. */
  getMaximumWriteLength?(peerId: string): number;
}

/**
 * iOS CoreBluetooth adapter. The transport boundary carries opaque Zaycomm
 * frames; protocol semantics remain in the TypeScript core.
 *
 * `MobilePeer.id` is the CoreBluetooth UUID supplied by the OS, not a
 * protocol identity. The native bridge must never treat this UUID as proof
 * of who the peer is.
 */
export class IosBleTransport implements MobileTransport {
  readonly name = 'bluetooth-le-ios';
  private readonly peers = new Map<string, MobilePeer>();
  private readonly connected = new Set<string>();
  private receiveCallback: ((peerId: string, frame: Uint8Array) => void) | null = null;
  private peerCallback: ((peer: MobilePeer, connected: boolean) => void) | null = null;

  constructor(private readonly bridge: IosBleBridge) {
    bridge.onAdvertisement((peer) => this.peers.set(peer.id, peer));
    bridge.onFrame((peerId, frame) => this.receiveCallback?.(peerId, frame));
    bridge.onConnectionChanged((peerId, isConnected) => {
      const peer = this.peers.get(peerId);
      if (!peer) return;
      if (isConnected) this.connected.add(peerId);
      else this.connected.delete(peerId);
      this.peerCallback?.(peer, isConnected);
    });
  }

  async start(): Promise<void> {
    this.bridge.startScan();
  }

  async stop(): Promise<void> {
    this.bridge.stopScan();
  }

  async discover(): Promise<MobilePeer[]> {
    return [...this.peers.values()];
  }

  async connect(peer: MobilePeer): Promise<void> {
    await this.bridge.connect(peer.id);
  }

  async disconnect(peerId: string): Promise<void> {
    if (!this.peers.has(peerId)) return;
    await this.bridge.disconnect(peerId);
    this.connected.delete(peerId);
  }

  async send(peerId: string, frame: Uint8Array): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer || !this.connected.has(peerId)) {
      throw new Error(`BLE peer is not connected: ${peerId}`);
    }

    const mtu = this.getLinkCharacteristics(peerId)?.maxTransmissionUnit ?? 200;
    if (frame.byteLength > mtu) {
      throw new Error(`BLE frame exceeds transport MTU: ${frame.byteLength} > ${mtu}`);
    }
    await this.bridge.write(peerId, frame);
  }

  onReceive(callback: (peerId: string, frame: Uint8Array) => void): void {
    this.receiveCallback = callback;
  }

  onPeerChanged(callback: (peer: MobilePeer, connected: boolean) => void): void {
    this.peerCallback = callback;
  }

  getLinkCharacteristics(peerId: string): MobileLinkCharacteristics | null {
    if (!this.peers.has(peerId)) return null;
    const nativeCapacity = this.bridge.getMaximumWriteLength?.(peerId) ?? 200;
    return {
      maxTransmissionUnit: Math.min(200, Math.max(0, nativeCapacity)),
      reliability: 0.9,
    };
  }
}
