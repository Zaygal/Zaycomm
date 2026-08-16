import type {
  AndroidBleBridge,
  MobileLinkCharacteristics,
  MobilePeer,
  MobileTransport,
} from './transport';

/**
 * Adapter from the Android native bridge to the RFC transport contract.
 * BLE remains a transport only: frames are opaque Uint8Array values.
 */
export class AndroidBleTransport implements MobileTransport {
  readonly name = 'bluetooth-le';
  private peers = new Map<string, MobilePeer>();
  private connected = new Set<string>();
  private receiveCallback: ((peerId: string, frame: Uint8Array) => void) | null = null;
  private peerCallback: ((peer: MobilePeer, connected: boolean) => void) | null = null;

  constructor(private readonly bridge: AndroidBleBridge) {
    bridge.onAdvertisement((peer) => {
      this.peers.set(peer.id, peer);
    });
    bridge.onFrame((address, frame) => {
      const peer = [...this.peers.values()].find((candidate) => candidate.address === address);
      if (peer) this.receiveCallback?.(peer.id, frame);
    });
    bridge.onConnectionChanged((address, connected) => {
      const peer = [...this.peers.values()].find((candidate) => candidate.address === address);
      if (!peer) return;
      if (connected) this.connected.add(peer.id);
      else this.connected.delete(peer.id);
      this.peerCallback?.(peer, connected);
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
    await this.bridge.connect(peer.address);
  }

  async disconnect(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    await this.bridge.disconnect(peer.address);
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
    await this.bridge.write(peer.address, frame);
  }

  onReceive(callback: (peerId: string, frame: Uint8Array) => void): void {
    this.receiveCallback = callback;
  }

  onPeerChanged(callback: (peer: MobilePeer, connected: boolean) => void): void {
    this.peerCallback = callback;
  }

  getLinkCharacteristics(peerId: string): MobileLinkCharacteristics | null {
    if (!this.peers.has(peerId)) return null;
    return { maxTransmissionUnit: 200, reliability: 0.9 };
  }
}
