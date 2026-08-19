import type { AndroidBleBridge } from './transport';

type NativeModulesShape = { ZaycommBle?: AndroidBleNativeModule };

export interface AndroidBleNativeModule {
  startScan(): void;
  stopScan(): void;
  startAdvertising(nodeName: string): Promise<void>;
  stopAdvertising(): void;
  connect(address: string): Promise<void>;
  disconnect(address: string): Promise<void>;
  write(address: string, frame: number[]): Promise<void>;
  notify(address: string, frame: number[]): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

/**
 * The only React-Native-specific surface. The protocol core does not import
 * React Native; an app supplies this bridge to AndroidBleTransport.
 */
export function createAndroidBleBridge(nativeModules: NativeModulesShape, emitter: {
  addListener(eventName: string, callback: (payload: any) => void): { remove(): void };
}): AndroidBleBridge {
  const native = nativeModules.ZaycommBle;
  if (!native) throw new Error('ZaycommBle native module is unavailable');

  return {
    startScan: () => native.startScan(),
    stopScan: () => native.stopScan(),
    connect: (address) => native.connect(address),
    disconnect: (address) => native.disconnect(address),
    write: (address, frame) => native.write(address, Array.from(frame)),
    onAdvertisement: (callback) => {
      emitter.addListener('ZaycommBleAdvertisement', callback);
    },
    onFrame: (callback) => {
      emitter.addListener('ZaycommBleFrame', (event) => {
        callback(event.address, Uint8Array.from(event.frame));
      });
    },
    onConnectionChanged: (callback) => {
      emitter.addListener('ZaycommBleConnectionChanged', (event) => {
        callback(event.address, Boolean(event.connected));
      });
    },
  };
}