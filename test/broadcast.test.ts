// test/broadcast.test.ts

import { describe, it, expect } from 'vitest';
import { createIdentity } from '../src/identity/identity';
import { createBroadcastMessage, verifyBroadcastMessage, encodeBroadcastMessage } from '../src/broadcast/broadcast';
import { createBroadcastEnvelope } from '../src/envelope/envelope';
import { RelayNode } from '../src/routing/routing';
import { createBluetoothTransport, type SimulatedTransport } from '../src/transport/transport';

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

function connectNodes(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
}

describe('Broadcast message signing (RFC-0006 Section 4)', () => {
  it('creates and verifies a valid broadcast', () => {
    const identity = createIdentity();
    const message = createBroadcastMessage(identity, text('evacuate the area'));
    expect(verifyBroadcastMessage(message)).toBe(true);
  });

  it('rejects a broadcast with tampered content', () => {
    const identity = createIdentity();
    const message = createBroadcastMessage(identity, text('evacuate the area'));
    const tampered = { ...message, content: text('everything is fine') };
    expect(verifyBroadcastMessage(tampered)).toBe(false);
  });
});

describe('Broadcast flooding (RFC-0007-style flood delivery)', () => {
  function buildChain() {
    const origin = new RelayNode('origin', createIdentity(), createBluetoothTransport('origin'));
    const n1 = new RelayNode('n1', createIdentity(), createBluetoothTransport('n1'));
    const n2 = new RelayNode('n2', createIdentity(), createBluetoothTransport('n2'));
    const n3 = new RelayNode('n3', createIdentity(), createBluetoothTransport('n3'));
    connectNodes(origin, n1);
    connectNodes(n1, n2);
    connectNodes(n2, n3);
    return { origin, n1, n2, n3 };
  }

  it('floods to every node in a chain given enough TTL', () => {
    const { origin, n1, n2, n3 } = buildChain();

    const received: string[] = [];
    n1.onBroadcastReceived((m) => received.push(`n1:${decode(m.content)}`));
    n2.onBroadcastReceived((m) => received.push(`n2:${decode(m.content)}`));
    n3.onBroadcastReceived((m) => received.push(`n3:${decode(m.content)}`));

    origin.broadcast(text('evacuate now'), 10);

    expect(received).toContain('n1:evacuate now');
    expect(received).toContain('n2:evacuate now');
    expect(received).toContain('n3:evacuate now');
  });

  it('a low TTL bounds how far the flood reaches', () => {
    const { origin, n1, n2, n3 } = buildChain();

    let n1Got = false;
    let n3Got = false;
    n1.onBroadcastReceived(() => {
      n1Got = true;
    });
    n3.onBroadcastReceived(() => {
      n3Got = true;
    });

    origin.broadcast(text('short range only'), 1);

    expect(n1Got).toBe(true); // one hop away, reachable with ttl 1
    expect(n3Got).toBe(false); // three hops away, out of range
  });

  it('does not re-deliver or re-flood a broadcast it has already seen', () => {
    const identity = createIdentity();
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));

    const message = createBroadcastMessage(identity, text('duplicate test'));
    const envelope = createBroadcastEnvelope(encodeBroadcastMessage(message), 5);

    let count = 0;
    relay.onBroadcastReceived(() => {
      count++;
    });

    relay.receiveEnvelope(envelope, 'someone');
    relay.receiveEnvelope(envelope, 'someone'); // exact same message id, arriving twice

    expect(count).toBe(1);
  });

  it('rejects a broadcast with an invalid signature and never delivers it', () => {
    const identity = createIdentity();
    const impostor = createIdentity();
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));

    const message = createBroadcastMessage(identity, text('trust me'));
    const forged = { ...message, senderPublicKey: impostor.publicKey };
    const envelope = createBroadcastEnvelope(encodeBroadcastMessage(forged), 5);

    let delivered = false;
    relay.onBroadcastReceived(() => {
      delivered = true;
    });

    const result = relay.receiveEnvelope(envelope, 'someone');
    expect(result.outcome).toBe('dropped');
    expect(delivered).toBe(false);
  });
});