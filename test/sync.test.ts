// test/sync.test.ts

import { describe, it, expect } from 'vitest';
import { createIdentity } from '../src/identity/identity';
import { createDataEnvelope } from '../src/envelope/envelope';
import { RelayNode, createRoutingAdvertisement, computeDestinationHint } from '../src/routing/routing';
import { createInternetTransport, type SimulatedTransport } from '../src/transport/transport';

const text = (s: string) => new TextEncoder().encode(s);

function connectNodes(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
  a.registerAuthenticatedPeer(b.id, b.identity.publicKey);
  b.registerAuthenticatedPeer(a.id, a.identity.publicKey);
}

function makeEnvelope(seed: number) {
  return createDataEnvelope(
    new Uint8Array(8).fill(9),
    { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
    text(`queued content ${seed}`),
    10
  );
}

describe('Gateway sync (RFC-0009 Section 6)', () => {
  it('transfers a message from A to B when B is missing it entirely', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connectNodes(a, b);

    const envelope = makeEnvelope(1);
    a.receiveEnvelope(envelope, null);
    expect(a.queueSize()).toBe(1);
    expect(b.queueSize()).toBe(0);

    expect(a.initiateSync('b')).toBe(true);
    expect(b.queueSize()).toBe(1);
  });

  it('does not re-transfer a message both sides already have (the actual bandwidth optimization)', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connectNodes(a, b);

    const sharedEnvelope = makeEnvelope(2);
    a.receiveEnvelope(sharedEnvelope, null);
    b.receiveEnvelope(sharedEnvelope, null);

    let sendCount = 0;
    const originalSend = (a.transport as SimulatedTransport).send.bind(a.transport);
    (a.transport as SimulatedTransport).send = (neighborId: string, frame: Uint8Array) => {
      sendCount++;
      return originalSend(neighborId, frame);
    };

    expect(a.initiateSync('b')).toBe(true);
    expect(sendCount).toBe(1);
    expect(a.queueSize()).toBe(1);
    expect(b.queueSize()).toBe(1);
  });

  it('with partial overlap, only the missing message is requested and transferred', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connectNodes(a, b);

    const shared = makeEnvelope(3);
    const onlyOnA = makeEnvelope(4);
    a.receiveEnvelope(shared, null);
    a.receiveEnvelope(onlyOnA, null);
    b.receiveEnvelope(shared, null);

    expect(a.queueSize()).toBe(2);
    expect(b.queueSize()).toBe(1);

    a.initiateSync('b');
    expect(b.queueSize()).toBe(2);
  });

  it('sync is bidirectional when triggered from both sides', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connectNodes(a, b);

    const onlyOnA = makeEnvelope(5);
    const onlyOnB = makeEnvelope(6);
    a.receiveEnvelope(onlyOnA, null);
    b.receiveEnvelope(onlyOnB, null);

    a.initiateSync('b');
    b.initiateSync('a');

    expect(a.queueSize()).toBe(2);
    expect(b.queueSize()).toBe(2);
  });

  it('a synced message is forwarded immediately, not queued, if the receiver already has a route', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    const c = new RelayNode('c', createIdentity(), createInternetTransport('c'));
    connectNodes(a, b);
    connectNodes(b, c);

    let delivered = false;
    c.onDelivered(() => { delivered = true; });

    const cHint = computeDestinationHint(c.identity.publicKey);
    const cAd = createRoutingAdvertisement(c.identity, [cHint]);
    b.receiveAdvertisement('c', cAd);

    const envelope = createDataEnvelope(
      cHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
      text('for c, via a syncing to b'),
      10
    );
    a.receiveEnvelope(envelope, null);
    expect(a.queueSize()).toBe(1);

    a.initiateSync('b');

    expect(delivered).toBe(true);
    expect(b.queueSize()).toBe(0);
  });
});
