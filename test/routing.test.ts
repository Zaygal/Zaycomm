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

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

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

describe('Multi-hop forwarding (RFC-0007 Section 4)', () => {
  function buildThreeNodeMesh() {
    const alice = new RelayNode('alice', createIdentity());
    const relay = new RelayNode('relay', createIdentity());
    const bob = new RelayNode('bob', createIdentity());

    alice.connectNeighbor(relay);
    relay.connectNeighbor(alice);
    relay.connectNeighbor(bob);
    bob.connectNeighbor(relay);

    const bobAd = createRoutingAdvertisement(bob.identity, [computeDestinationHint(bob.identity.publicKey)]);
    relay.receiveAdvertisement('bob', bobAd);
    alice.receiveAdvertisement('relay', bobAd);

    return { alice, relay, bob };
  }

  it('delivers a message across two hops', () => {
    const { alice, bob } = buildThreeNodeMesh();

    const destinationHint = computeDestinationHint(bob.identity.publicKey);
    const envelope = createDataEnvelope(
      destinationHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
      text('secret for bob'),
      10
    );

    const result = alice.receiveEnvelope(envelope, null);

    expect(result.outcome).toBe('delivered');
    expect(result.path).toEqual(['alice', 'relay', 'bob']);
  });

  it('drops the message when TTL is too low to reach the destination', () => {
    const { alice, bob } = buildThreeNodeMesh();

    const destinationHint = computeDestinationHint(bob.identity.publicKey);
    const envelope = createDataEnvelope(
      destinationHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
      text('too far'),
      1
    );

    const result = alice.receiveEnvelope(envelope, null);
    expect(result.outcome).toBe('dropped');
    expect(result.path).toEqual(['alice', 'relay']);
  });

  it('queues, rather than drops, a message with no known route yet (RFC-0007 Section 2)', () => {
    const alice = new RelayNode('alice', createIdentity());
    const relay = new RelayNode('relay', createIdentity());
    alice.connectNeighbor(relay);
    relay.connectNeighbor(alice);




    const unknownDestination = computeDestinationHint(createIdentity().publicKey);
    const envelope = createDataEnvelope(
      unknownDestination,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
      text('nobody knows this address yet')
    );




    const result = alice.receiveEnvelope(envelope, null);
    expect(result.outcome).toBe('queued');
    expect(alice.queueSize()).toBe(1);
  });




  it('queues a message when no route exists yet, then delivers it automatically once a route is learned (RFC-0007 Section 2)', () => {
    const alice = new RelayNode('alice', createIdentity());
    const relay = new RelayNode('relay', createIdentity());
    const bob = new RelayNode('bob', createIdentity());




    alice.connectNeighbor(relay);
    relay.connectNeighbor(alice);
    relay.connectNeighbor(bob);
    bob.connectNeighbor(relay);




    const bobHint = computeDestinationHint(bob.identity.publicKey);
    const bobAd = createRoutingAdvertisement(bob.identity, [bobHint]);
    relay.receiveAdvertisement('bob', bobAd);




    const envelope = createDataEnvelope(
      bobHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
      text('waiting for a path'),
      10
    );




    const firstAttempt = alice.receiveEnvelope(envelope, null);
    expect(firstAttempt.outcome).toBe('queued');
    expect(alice.queueSize()).toBe(1);




    const results = alice.receiveAdvertisement('relay', bobAd);




    expect(alice.queueSize()).toBe(0);
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe('delivered');
    expect(results[0].path).toEqual(['alice', 'relay', 'bob']);
  });

  it('does not learn routes from a forged advertisement', () => {
    const alice = new RelayNode('alice', createIdentity());
    const relay = new RelayNode('relay', createIdentity());
    const bob = createIdentity();
    alice.connectNeighbor(relay);

    const bobHint = computeDestinationHint(bob.publicKey);
    const legitimateAd = createRoutingAdvertisement(bob, [bobHint]);
    const forgedAd = { ...legitimateAd, advertiserPublicKey: createIdentity().publicKey };

    alice.receiveAdvertisement('relay', forgedAd);
    expect(alice.hasRoute(bobHint)).toBe(false);
  });

  it('carries a real end-to-end encrypted message across the relay hop', () => {
    const aliceStatic = generateX25519KeyPair();
    const bobStatic = generateX25519KeyPair();
    const aliceIdentity = createIdentity();
    const bobIdentity = createIdentity();

    const { message: msg1, state: aliceHandshakeState, initiatorEphemeral } =
      initiatorWriteMessage1(aliceStatic, bobStatic.publicKey);
    const { state: bobHandshakeState, initiatorStaticPublicKey } =
      responderReadMessage1(bobStatic, msg1);
    const { message: msg2, result: bobHandshakeResult, initialRatchetKeyPair } =
      responderWriteMessage2(bobHandshakeState, msg1.ephemeralPublicKey, initiatorStaticPublicKey);
    const aliceHandshakeResult = initiatorReadMessage2(aliceHandshakeState, aliceStatic, initiatorEphemeral, msg2);

    const aliceRatchet = DoubleRatchet.initAsInitiator(aliceHandshakeResult.rootKey, msg2.ephemeralPublicKey);
    const bobRatchet = DoubleRatchet.initAsResponder(bobHandshakeResult.rootKey, initialRatchetKeyPair);

    const aliceNode = new RelayNode('alice', aliceIdentity);
    const relayNode = new RelayNode('relay', createIdentity());
    const bobNode = new RelayNode('bob', bobIdentity);
    aliceNode.connectNeighbor(relayNode);
    relayNode.connectNeighbor(aliceNode);
    relayNode.connectNeighbor(bobNode);
    bobNode.connectNeighbor(relayNode);

    const bobDestinationHint = computeDestinationHint(bobIdentity.publicKey);
    const bobAd = createRoutingAdvertisement(bobIdentity, [bobDestinationHint]);
    relayNode.receiveAdvertisement('bob', bobAd);
    aliceNode.receiveAdvertisement('relay', bobAd);

    const { header: ratchetHeader, ciphertext } = aliceRatchet.encrypt(text('routed and encrypted'));
    const envelope = createDataEnvelope(bobDestinationHint, ratchetHeader, ciphertext, 10);

    const result = aliceNode.receiveEnvelope(envelope, null);
    expect(result.outcome).toBe('delivered');
    expect(result.path).toEqual(['alice', 'relay', 'bob']);

    if (result.outcome === 'delivered') {
      const { ratchetHeader: recoveredHeader, ciphertext: recoveredCiphertext } = openDataEnvelope(result.envelope);
      const plaintext = bobRatchet.decrypt(recoveredHeader, recoveredCiphertext);
      expect(decode(plaintext)).toBe('routed and encrypted');
    }
  });
});