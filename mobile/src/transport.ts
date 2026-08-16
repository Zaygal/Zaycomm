/**
 * C25 mobile transport boundary.
 *
 * The TypeScript protocol core produces/consumes opaque Uint8Array frames.
 * Platform code (Android BLE first) owns discovery, connections and radio I/O.
 * No routing, identity, session, or crypto logic belongs here.
 */
export interface MobilePeer {
  id: string;
  address: string;
  publicKey?: string;
}

export interface MobileLinkCharacteristics {
  maxTransmissionUnit: number;
  reliability: number;
}

export interface MobileTransport {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  discover(): Promise<MobilePeer[]>;
  connect(peer: MobilePeer): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  send(peerId: string, frame: Uint8Array): Promise<void>;
  onReceive(callback: (peerId: string, frame: Uint8Array) => void): void;
  onPeerChanged(callback: (peer: MobilePeer, connected: boolean) => void): void;
  getLinkCharacteristics(peerId: string): MobileLinkCharacteristics | null;
}

/**
 * Native bridge contract. Implemented by Android/Kotlin and exposed to the
 * mobile-compatible JavaScript runtime. The JS side never touches Bluetooth
 * APIs directly.
 */
export interface AndroidBleBridge {
  startScan(): void;
  stopScan(): void;
  connect(address: string): Promise<void>;
  disconnect(address: string): Promise<void>;
  write(address: string, frame: Uint8Array): Promise<void>;
  onAdvertisement(callback: (peer: MobilePeer) => void): void;
  onFrame(callback: (address: string, frame: Uint8Array) => void): void;
  onConnectionChanged(callback: (address: string, connected: boolean) => void): void;
}
