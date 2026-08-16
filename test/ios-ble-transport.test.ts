import { describe, expect, it } from 'vitest';
import { IosBleTransport, type IosBleBridge } from '../mobile/src/iosBleTransport';

function createBridge() {
  let advertisement: ((peer: any) => void) | undefined;
  let frame: ((peerId: string, frame: Uint8Array) => void) | undefined;
  let connection: ((peerId: string, connected: boolean) => void) | undefined;
  const writes: Array<{ peerId: string; frame: Uint8Array }> = [];

  const bridge: IosBleBridge = {
    startScan: () => {},
    stopScan: () => {},
    connect: async () => {},
    disconnect: async () => {},
    write: async (peerId, value) => writes.push({ peerId, frame: Uint8Array.from(value) }),
    onAdvertisement: (cb) => { advertisement = cb; },
    onFrame: (cb) => { frame = cb; },
    onConnectionChanged: (cb) => { connection = cb; },
  };

  return {
    bridge,
    writes,
    advertise: (peer: any) => advertisement?.(peer),
    setConnected: (peerId: string, value: boolean) => connection?.(peerId, value),
    receive: (peerId: string, value: Uint8Array) => frame?.(peerId, value),
  };
}

describe('C25 iOS BLE transport', () => {
  it('discovers peers and carries opaque frames', async () => {
    const fake = createBridge();
    const transport = new IosBleTransport(fake.bridge);
    const received: Uint8Array[] = [];
    transport.onReceive((_peerId, value) => received.push(value));

    fake.advertise({ id: 'bob', address: 'ios-peer-bob' });
    fake.setConnected('bob', true);
    expect(await transport.discover()).toEqual([{ id: 'bob', address: 'ios-peer-bob' }]);

    await transport.send('bob', Uint8Array.from([1, 2, 3]));
    expect(fake.writes).toHaveLength(1);
    expect([...fake.writes[0].frame]).toEqual([1, 2, 3]);

    fake.receive('bob', Uint8Array.from([9, 8]));
    expect([...received[0]]).toEqual([9, 8]);
  });

  it('rejects frames larger than the configured BLE MTU', async () => {
    const fake = createBridge();
    const transport = new IosBleTransport(fake.bridge);
    fake.advertise({ id: 'bob', address: 'ios-peer-bob' });
    fake.setConnected('bob', true);

    await expect(transport.send('bob', new Uint8Array(201))).rejects.toThrow('BLE frame exceeds transport MTU');
  });

  it('does not send to a peer that is not connected', async () => {
    const fake = createBridge();
    const transport = new IosBleTransport(fake.bridge);
    fake.advertise({ id: 'bob', address: 'ios-peer-bob' });

    await expect(transport.send('bob', Uint8Array.from([1]))).rejects.toThrow('BLE peer is not connected');
  });
});
