import type { MobilePeer } from './transport';

export interface IosBleNativeModule {
  startScan(): void;
  stopScan(): void;
  startAdvertising(nodeId: string): Promise<void>;
  stopAdvertising(): void;
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  write(peerId: string, frame: number[]): Promise<void>;
  notify(peerId: string, frame: number[]): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export interface NativeEventEmitterLike {
  addListener(
    eventName: string,
    callback: (payload: any) => void,
  ): { remove(): void };
}

/**
 * React-Native-specific iOS surface. CoreBluetooth is isolated inside the
 * native module; the Zaycomm TypeScript core only sees opaque frames.
 */
export function createIosBleBridge(
  nativeModules: { ZaycommBle?: IosBleNativeModule },
  emitter: NativeEventEmitterLike,
) {
  const native = nativeModules.ZaycommBle;
  if (!native) throw new Error('ZaycommBle native module is unavailable');

  return {
    startScan: () => native.startScan(),
    stopScan: () => native.stopScan(),
    connect: (peerId: string) => native.connect(peerId),
    disconnect: (peerId: string) => native.disconnect(peerId),
    write: (peerId: string, frame: Uint8Array) => native.write(peerId, Array.from(frame)),
    onAdvertisement: (callback: (peer: MobilePeer) => void) => {
      emitter.addListener('ZaycommBleAdvertisement', callback);
    },
    onFrame: (callback: (peerId: string, frame: Uint8Array) => void) => {
      emitter.addListener('ZaycommBleFrame', (event) => {
        callback(String(event.peerId), Uint8Array.from(event.frame));
      });
    },
    onConnectionChanged: (callback: (peerId: string, connected: boolean) => void) => {
      emitter.addListener('ZaycommBleConnectionChanged', (event) => {
        callback(String(event.peerId), Boolean(event.connected));
      });
    },
  };
}
