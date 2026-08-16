// test/routing.test.ts

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { createIdentity } from '../src/identity/identity';
import { DoubleRatchet } from '../src/crypto/ratchet';
import {
  initiatorWriteMessage1,
  responderReadMessage1,
  responderWriteMessage2,
  initiatorReadMessage2,
} from '../src/crypto/handshake';
import { createDataEnvelope, openDataEnvelope } from '../src/envelope/envelope';
import {
  computeDestinationHint,
  createRoutingAdvertisement,
  verifyRoutingAdvertisement,
  RelayNode,
} from '../src/routing/routing';
import { createBluetoothTransport, type SimulatedTransport } from '../src/transport/transport';

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

function connectNodes(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
  // C10: transport receivers must authenticate the direct peer before
  // allocating fragment/reassembly state. Real node links therefore have
  // an identity binding in both directions.
  a.registerAuthenticatedPeer(b.id, b.identity.publicKey);
  b.registerAuthenticatedPeer(a.id, a.identity.publicKey);
}

describe('Routing advertisements (RFC-0007 Section 5)', () => {
  it('creates and verifies a valid advertisement', () => {
    const identity = createIdentity();
    const hint = computeDestinationHint(identity.publicKey);
    const ad = createRoutingAdvertisement(identity, [hint]);
    expect(verifyRoutingAdvertisement(ad)).toBe(true);
  });

  it('rejects a forged advertisement (wrong signer)', () => {
    const identity = createIdentity();
    const impostor = createIdentity();
    const hint = computeDestinationHint(identity.publicKey);
    const ad = createRoutingAdvertisement(identity, [hint]);
    const forged = { ...ad, advertiserPublicKey: impostor.publicKey };
    expect(verifyRoutingAdvertisement(forged)).toBe(false);
  });
});

describe('Multi-hop forwarding over a real Transport (RFC-0007 Section 4, RFC-0008)', () => {
  function buildThreeNodeMesh() {
    const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const bob = new RelayNode('bob', createIdentity(), createBluetoothTransport('bob'));

    connectNodes(alice, relay);
    connectNodes(relay, bob);
    relay.registerAuthenticatedPeer('bob', bob.identity.publicKey);
    alice.registerAuthenticatedPeer('relay', relay.identity.publicKey);

    const bobAd = createRoutingAdvertisement(bob.identity, [computeDestinationHint(bob.identity.publicKey)]);
    relay.receiveAdvertisement('bob', bobAd);
    alice.receiveAdvertisement('relay', bobAd);

    return { alice, relay, bob };
  }

  it('delivers a message across two hops, observed at the destination via onDelivered', () => {
    const { alice, bob } = buildThreeNodeMesh();
    let deliveredEnvelope: Awaited<ReturnType<typeof openDataEnvelope>> | null = null;
    bob.onDelivered((envelope) => { deliveredEnvelope = openDataEnvelope(envelope) as any; });

    const destinationHint = computeDestinationHint(bob.identity.publicKey);
    const envelope = createDataEnvelope(destinationHint, { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 }, text('secret for bob'), 10);
    const result = alice.receiveEnvelope(envelope, null);
    expect(result.outcome).toBe('forwarded');
    expect(deliveredEnvelope).not.toBeNull();
  });

  it('drops the message when TTL is too low to reach the destination', () => {
    const { alice, bob } = buildThreeNodeMesh();
    let bobReceivedAnything = false;
    bob.onDelivered(() => { bobReceivedAnything = true; });
    const destinationHint = computeDestinationHint(bob.identity.publicKey);
    const envelope = createDataEnvelope(destinationHint, { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 }, text('too far'), 1);
    const result = alice.receiveEnvelope(envelope, null);
    expect(result.outcome).toBe('forwarded');
    expect(bobReceivedAnything).toBe(false);
  });

  it('queues, rather than drops, a message with no known route yet, then delivers it once a route is learned', () => {
    const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const bob = new RelayNode('bob', createIdentity(), createBluetoothTransport('bob'));
    connectNodes(alice, relay);
    connectNodes(relay, bob);
    relay.registerAuthenticatedPeer('bob', bob.identity.publicKey);
    alice.registerAuthenticatedPeer('relay', relay.identity.publicKey);

    let delivered = false;
    bob.onDelivered(() => { delivered = true; });
    const bobHint = computeDestinationHint(bob.identity.publicKey);
    const envelope = createDataEnvelope(bobHint, { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 }, text('waiting for a path'), 10);
    const firstAttempt = alice.receiveEnvelope(envelope, null);
    expect(firstAttempt.outcome).toBe('queued');
    expect(alice.queueSize()).toBe(1);
    expect(delivered).toBe(false);

    const bobAd = createRoutingAdvertisement(bob.identity, [bobHint]);
    relay.receiveAdvertisement('bob', bobAd);
    alice.receiveAdvertisement('relay', bobAd);
    expect(alice.queueSize()).toBe(0);
    expect(delivered).toBe(true);
  });

  it('does not learn routes from a forged advertisement', () => {
    const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const bob = createIdentity();
    connectNodes(alice, relay);
    alice.registerAuthenticatedPeer('relay', relay.identity.publicKey);

    const bobHint = computeDestinationHint(bob.publicKey);
    const legitimateAd = createRoutingAdvertisement(bob, [bobHint]);
    const forgedAd = { ...legitimateAd, advertiserPublicKey: createIdentity().publicKey };
    alice.receiveAdvertisement('relay', forgedAd);
    expect(alice.hasRoute(bobHint)).toBe(false);
  });

  it('carries a real end-to-end encrypted message across the relay hop, over a real Transport', () => {
    const aliceStatic = generateX25519KeyPair();
    const bobStatic = generateX25519KeyPair();
    const aliceIdentity = createIdentity();
    const bobIdentity = createIdentity();

    const { message: msg1, state: aliceHandshakeState, initiatorEphemeral } = initiatorWriteMessage1(aliceStatic, bobStatic.publicKey);
    const { state: bobHandshakeState, initiatorStaticPublicKey } = responderReadMessage1(bobStatic, msg1);
    const { message: msg2, result: bobHandshakeResult, initialRatchetKeyPair } = responderWriteMessage2(bobHandshakeState, msg1.ephemeralPublicKey, initiatorStaticPublicKey);
    const aliceHandshakeResult = initiatorReadMessage2(aliceHandshakeState, aliceStatic, initiatorEphemeral, msg2);

    const aliceRatchet = DoubleRatchet.initAsInitiator(aliceHandshakeResult.rootKey, msg2.ephemeralPublicKey);
    const bobRatchet = DoubleRatchet.initAsResponder(bobHandshakeResult.rootKey, initialRatchetKeyPair);

    const aliceNode = new RelayNode('alice', aliceIdentity, createBluetoothTransport('alice'));
    const relayNode = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const bobNode = new RelayNode('bob', bobIdentity, createBluetoothTransport('bob'));
    connectNodes(aliceNode, relayNode);
    connectNodes(relayNode, bobNode);
    relayNode.registerAuthenticatedPeer('bob', bobIdentity.publicKey);
    aliceNode.registerAuthenticatedPeer('relay', relayNode.identity.publicKey);

    const bobDestinationHint = computeDestinationHint(bobIdentity.publicKey);
    const bobAd = createRoutingAdvertisement(bobIdentity, [bobDestinationHint]);
    relayNode.receiveAdvertisement('bob', bobAd);
    aliceNode.receiveAdvertisement('relay', bobAd);

    let receivedPlaintext: string | null = null;
    bobNode.onDelivered((envelope) => {
      const { ratchetHeader, ciphertext } = openDataEnvelope(envelope);
      receivedPlaintext = decode(bobRatchet.decrypt(ratchetHeader, ciphertext));
    });

    const { header: ratchetHeader, ciphertext } = aliceRatchet.encrypt(text('routed and encrypted'));
    const envelope = createDataEnvelope(bobDestinationHint, ratchetHeader, ciphertext, 10);
    const result = aliceNode.receiveEnvelope(envelope, null);
    expect(result.outcome).toBe('forwarded');
    expect(receivedPlaintext).toBe('routed and encrypted');
  });
});
