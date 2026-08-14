// test/routing-trust.test.ts

import { describe, it, expect } from 'vitest';
import { createDataEnvelope } from '../src/envelope/envelope';
import { RelayNode, computeDestinationHint, createRoutingAdvertisement } from '../src/routing/routing';
import { createIdentity } from '../src/identity/identity';
import { createBluetoothTransport, type SimulatedTransport } from '../src/transport/transport';

function connectNodes(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
}

const text = (s: string) => new TextEncoder().encode(s);

describe('Sybil-resistant routing trust (RFC-0007 Section 6)', () => {
  it('a neighbor never observed delivering anything has zero trust', () => {
    const node = new RelayNode('node', createIdentity(), createBluetoothTransport('node'));
    expect(node.neighborTrustScore('nobody')).toBe(0);
  });

  it("a neighbor's trust increases once a message routed through it is genuinely acknowledged", () => {
    const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
    const bob = new RelayNode('bob', createIdentity(), createBluetoothTransport('bob'));
    connectNodes(alice, bob);

    const bobHint = computeDestinationHint(bob.identity.publicKey);
    const aliceHint = computeDestinationHint(alice.identity.publicKey);
    alice.receiveAdvertisement('bob', createRoutingAdvertisement(bob.identity, [bobHint]));
    bob.receiveAdvertisement('alice', createRoutingAdvertisement(alice.identity, [aliceHint]));

    expect(alice.neighborTrustScore('bob')).toBe(0);

    const envelope = createDataEnvelope(
      bobHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
      text('hi'),
      10
    );
    alice.receiveEnvelope(envelope, null);
    bob.sendAck(aliceHint, envelope.header.messageId);

    expect(alice.neighborTrustScore('bob')).toBe(1);
  });

  it('a later advertisement from an unproven neighbor does not silently hijack an already-trusted route', () => {
    const origin = new RelayNode('origin', createIdentity(), createBluetoothTransport('origin'));
    const trustedRelay = new RelayNode('trustedRelay', createIdentity(), createBluetoothTransport('trustedRelay'));
    const sybilRelay = new RelayNode('sybilRelay', createIdentity(), createBluetoothTransport('sybilRelay'));
    const destination = new RelayNode('destination', createIdentity(), createBluetoothTransport('destination'));

    connectNodes(origin, trustedRelay);
    connectNodes(origin, sybilRelay);
    connectNodes(trustedRelay, destination);

    const destHint = computeDestinationHint(destination.identity.publicKey);
    const originHint = computeDestinationHint(origin.identity.publicKey);
    const destAd = createRoutingAdvertisement(destination.identity, [destHint]);
    const originAd = createRoutingAdvertisement(origin.identity, [originHint]);

    trustedRelay.receiveAdvertisement('destination', destAd);
    origin.receiveAdvertisement('trustedRelay', destAd);
    destination.receiveAdvertisement('trustedRelay', originAd);
    trustedRelay.receiveAdvertisement('origin', originAd);

    for (let i = 0; i < 2; i++) {
      const envelope = createDataEnvelope(
        destHint,
        { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: i },
        text(`msg ${i}`),
        10
      );
      origin.receiveEnvelope(envelope, null);
      destination.sendAck(originHint, envelope.header.messageId);
    }
    expect(origin.neighborTrustScore('trustedRelay')).toBe(2);

    const sybilIdentity = createIdentity();
    const forgedAd = createRoutingAdvertisement(sybilIdentity, [destHint]);
    origin.receiveAdvertisement('sybilRelay', forgedAd);
    expect(origin.neighborTrustScore('sybilRelay')).toBe(0);

    const finalEnvelope = createDataEnvelope(
      destHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 99 },
      text('must still go the trusted way'),
      10
    );
    const result = origin.receiveEnvelope(finalEnvelope, null);
    expect(result.outcome).toBe('forwarded');
    expect((result as { outcome: 'forwarded'; to: string }).to).toBe('trustedRelay');
  });
});