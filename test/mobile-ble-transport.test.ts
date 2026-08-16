import { describe, expect, it, vi } from 'vitest';
import { AndroidBleTransport } from '../mobile/src/androidBleTransport';
import type { AndroidBleBridge, MobilePeer } from '../mobile/src/transport';

function bridge(): AndroidBleBridge & { advertise(peer: MobilePeer): void; frame(address: string, bytes: Uint8Array): void; connection(address: string, connected: boolean): void } {
  let advertisement: ((peer: MobilePeer) => void) | undefined;
  let received: ((address: string, frame: Uint8Array) => void) | undefined;
  let changed: ((address: string, connected: boolean) => void) | undefined;
  return {
    startScan: vi.fn(),
    stopScan: vi.fn(),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
    onAdvertisement: (callback) => { advertisement = callback; },
    onFrame: (callback) => { received = callback; },
    onConnectionChanged: (callback) => { changed = callback; },
    advertise: (peer) => advertisement?.(peer),
    frame: (address, bytes) => received?.(address, bytes),
    connection: (address, connected) => changed?.(address, connected),
  };
}

describe('C25 Android BLE transport adapter', () => {
  it('passes opaque frames without interpreting protocol bytes', async () => {
    const b = bridge();
    const transport = new AndroidBleTransport(b);
    const peer = { id: 'bob', address: 'AA:BB:CC:DD:EE:FF' };
    b.advertise(peer);
    b.connection(peer.address, true);
    const frame = Uint8Array.from([0, 255, 1, 2, 3, 254]);
    const receive = vi.fn();
    transport.onReceive(receive);
    b.frame(peer.address, frame);
    expect(receive).toHaveBeenCalledWith('bob', frame);
  });

  it('rejects frames above the BLE transport MTU before native I/O', async () => {
    const b = bridge();
    const transport = new AndroidBleTransport(b);
    const peer = { id: 'bob', address: 'AA:BB:CC:DD:EE:FF' };
    b.advertise(peer);
    b.connection(peer.address, true);
    await expect(transport.send(peer.id, new Uint8Array(201))).rejects.toThrow(/MTU/);
    expect(b.write).not.toHaveBeenCalled();
  });

  it('discovers and reports peer connection state through the bridge', async () => {
    const b = bridge();
    const transport = new AndroidBleTransport(b);
    const peer = { id: 'bob', address: 'AA:BB:CC:DD:EE:FF', publicKey: 'bob-key' };
    b.advertise(peer);
    expect(await transport.discover()).toEqual([peer]);
    const changed = vi.fn();
    transport.onPeerChanged(changed);
    b.connection(peer.address, true);
    expect(changed).toHaveBeenCalledWith(peer, true);
  });
});
