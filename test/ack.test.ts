// test/ack.test.ts

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { DoubleRatchet } from '../src/crypto/ratchet';
import {
  initiatorWriteMessage1,
  responderReadMessage1,
  responderWriteMessage2,
  initiatorReadMessage2,
} from '../src/crypto/handshake';
import {
  createDataEnvelope,
  openDataEnvelope,
  createAckEnvelope,
} from '../src/envelope/envelope';
import { RelayNode, computeDestinationHint, createRoutingAdvertisement } from '../src/routing/routing';
import { createIdentity } from '../src/identity/identity';
import { wrapWithSenderIdentity, unwrapSenderIdentity } from '../src/identity/seal';
import { encodeTextMessage, decodeTextMessage } from '../src/message/message';
import { createBluetoothTransport, type SimulatedTransport } from '../src/transport/transport';

function connectNodes(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
}

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe('Delivery acknowledgment (RFC-0007 Section 7)', () => {
  it('accepts an authenticated ack from the actual message destination', () => {
    const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
    const bob = new RelayNode('bob', createIdentity(), createBluetoothTransport('bob'));
    connectNodes(alice, bob);
    alice.registerAuthenticatedPeer('bob', bob.identity.publicKey);
    bob.registerAuthenticatedPeer('alice', alice.identity.publicKey);

    const aliceHint = computeDestinationHint(alice.identity.publicKey);
    const bobHint = computeDestinationHint(bob.identity.publicKey);
    alice.receiveAdvertisement('bob', createRoutingAdvertisement(bob.identity, [bobHint]));
    bob.receiveAdvertisement('alice', createRoutingAdvertisement(alice.identity, [aliceHint]));

    const fakeDataEnvelope = {
      header: {
        version: 1,
        packetType: 1,
        messageId: new Uint8Array(16).fill(9),
        ttl: 10,
        destinationHint: bobHint,
        timestamp: Math.floor(Date.now() / 60_000) * 60,
      },
      sealedPayload: new Uint8Array([1, 2, 3]),
    } as const;

    alice.receiveEnvelope(fakeDataEnvelope, null);
    bob.sendAck(aliceHint, fakeDataEnvelope.header.messageId);

    expect(alice.neighborTrustScore('bob')).toBe(1);
  });

  it('rejects a validly signed ack from the wrong identity and does not increase trust', () => {
    const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
    const bob = new RelayNode('bob', createIdentity(), createBluetoothTransport('bob'));
    const attacker = createIdentity();
    connectNodes(alice, bob);
    alice.registerAuthenticatedPeer('bob', bob.identity.publicKey);
    bob.registerAuthenticatedPeer('alice', alice.identity.publicKey);

    const aliceHint = computeDestinationHint(alice.identity.publicKey);
    const bobHint = computeDestinationHint(bob.identity.publicKey);
    alice.receiveAdvertisement('bob', createRoutingAdvertisement(bob.identity, [bobHint]));
    bob.receiveAdvertisement('alice', createRoutingAdvertisement(alice.identity, [aliceHint]));

    const messageId = new Uint8Array(16).fill(7);
    const fakeDataEnvelope = {
      header: {
        version: 1,
        packetType: 1,
        messageId,
        ttl: 10,
        destinationHint: bobHint,
        timestamp: Math.floor(Date.now() / 60_000) * 60,
      },
      sealedPayload: new Uint8Array([1, 2, 3]),
    } as const;
    alice.receiveEnvelope(fakeDataEnvelope, null);

    const forgedAck = createAckEnvelope(aliceHint, messageId, attacker);
    const result = alice.receiveEnvelope(forgedAck, 'bob');

    expect(result.outcome).toBe('dropped');
    expect(alice.neighborTrustScore('bob')).toBe(0);
  });

  it('the real flow: Bob decrypts a sealed-sender message, learns it is from Alice using only the sealed field, and sends her a delivery confirmation', () => {
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

    const aliceNode = new RelayNode('alice', aliceIdentity, createBluetoothTransport('alice'));
    const bobNode = new RelayNode('bob', bobIdentity, createBluetoothTransport('bob'));
    connectNodes(aliceNode, bobNode);
    aliceNode.registerAuthenticatedPeer('bob', bobIdentity.publicKey);
    bobNode.registerAuthenticatedPeer('alice', aliceIdentity.publicKey);

    const bobHint = computeDestinationHint(bobIdentity.publicKey);
    const aliceHint = computeDestinationHint(aliceIdentity.publicKey);
    const bobAd = createRoutingAdvertisement(bobIdentity, [bobHint]);
    const aliceAd = createRoutingAdvertisement(aliceIdentity, [aliceHint]);
    aliceNode.receiveAdvertisement('bob', bobAd);
    bobNode.receiveAdvertisement('alice', aliceAd);

    let aliceConfirmedMessageId: Uint8Array | null = null;
    aliceNode.onAckReceived((messageId) => {
      aliceConfirmedMessageId = messageId;
    });

    bobNode.onDelivered((envelope) => {
      const { ratchetHeader, ciphertext } = openDataEnvelope(envelope);
      const plaintext = bobRatchet.decrypt(ratchetHeader, ciphertext);
      const { senderPublicKey, payload } = unwrapSenderIdentity(plaintext);
      expect(decodeTextMessage(payload)).toBe('hi bob');

      const senderHint = computeDestinationHint(senderPublicKey);
      bobNode.sendAck(senderHint, envelope.header.messageId);
    });

    const plaintext = wrapWithSenderIdentity(aliceIdentity.publicKey, encodeTextMessage('hi bob'));
    const { header, ciphertext } = aliceRatchet.encrypt(plaintext);
    const envelope = createDataEnvelope(bobHint, header, ciphertext, 10);

    aliceNode.receiveEnvelope(envelope, null);

    expect(aliceConfirmedMessageId).toEqual(envelope.header.messageId);
  });

  it('an ack for an unreachable destination queues just like any other message, no special-cased failure', () => {
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));

    const unknownHint = new Uint8Array(8).fill(7);
    relay.sendAck(unknownHint, new Uint8Array(16).fill(1));

    expect(relay.queueSize()).toBe(1);
  });
});