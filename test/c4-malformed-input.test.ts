// C4: hostile wire input must never escape the transport boundary as an exception.
import { describe, it, expect } from 'vitest';
import { createIdentity } from '../src/identity/identity';
import { RelayNode } from '../src/routing/routing';
import { createBluetoothTransport, type SimulatedTransport } from '../src/transport/transport';

function connect(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
}

describe('C4 hostile wire input', () => {
  it('drops malformed envelope CBOR without throwing', () => {
    const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
    const bob = new RelayNode('bob', createIdentity(), createBluetoothTransport('bob'));
    connect(alice, bob);

    expect(() => alice.transport.send('bob', new Uint8Array([0, 0xff, 0xff, 0xff]))).not.toThrow();
  });

  it('drops malformed fragment CBOR without throwing', () => {
    const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
    const bob = new RelayNode('bob', createIdentity(), createBluetoothTransport('bob'));
    connect(alice, bob);

    expect(() => alice.transport.send('bob', new Uint8Array([1, 0xff, 0xff, 0xff]))).not.toThrow();
  });

  it('ignores unknown frame kinds without throwing', () => {
    const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
    const bob = new RelayNode('bob', createIdentity(), createBluetoothTransport('bob'));
    connect(alice, bob);

    expect(() => alice.transport.send('bob', new Uint8Array([99, 1, 2, 3]))).not.toThrow();
  });
});
