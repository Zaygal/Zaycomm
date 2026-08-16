// test/transport-fragmentation.test.ts

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { DoubleRatchet } from '../src/crypto/ratchet';
import {
  initiatorWriteMessage1,
  responderReadMessage1,
  responderWriteMessage2,
  initiatorReadMessage2,
} from '../src/crypto/handshake';
import { createDataEnvelope, openDataEnvelope } from '../src/envelope/envelope';
import { RelayNode, computeDestinationHint, createRoutingAdvertisement } from '../src/routing/routing';
import { createIdentity } from '../src/identity/identity';
import { createBluetoothTransport, type SimulatedTransport } from '../src/transport/transport';

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

function connectNodes(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
  a.registerAuthenticatedPeer(b.id, b.identity.publicKey);
  b.registerAuthenticatedPeer(a.id, a.identity.publicKey);
}

describe('Fragmentation wired into the transport send path (RFC-0006 Section 5)', () => {
  it('an oversized message that would have failed to send now delivers automatically, fragmented, over Bluetooth', () => {
    const aliceStatic = generateX25519KeyPair();
    const bobStatic = generateX25519KeyPair();
    const aliceIdentity = createIdentity();
    const bobIdentity = createIdentity();
    const relayIdentity = createIdentity();

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
    const relayNode = new RelayNode('relay', relayIdentity, createBluetoothTransport('relay'));
    const bobNode = new RelayNode('bob', bobIdentity, createBluetoothTransport('bob'));
    connectNodes(aliceNode, relayNode);
    connectNodes(relayNode, bobNode);

    const bobHint = computeDestinationHint(bobIdentity.publicKey);
    const bobAd = createRoutingAdvertisement(bobIdentity, [bobHint]);
    relayNode.receiveAdvertisement('bob', bobAd);
    aliceNode.receiveAdvertisement('relay', bobAd);

    const longMessage = 'x'.repeat(220);

    let receivedPlaintext: string | null = null;
    bobNode.onDelivered((envelope) => {
      const { ratchetHeader, ciphertext } = openDataEnvelope(envelope);
      receivedPlaintext = decode(bobRatchet.decrypt(ratchetHeader, ciphertext));
    });

    const { header: ratchetHeader, ciphertext } = aliceRatchet.encrypt(text(longMessage));
    const envelope = createDataEnvelope(bobHint, ratchetHeader, ciphertext, 10);

    const result = aliceNode.receiveEnvelope(envelope, null);
    expect(result.outcome).toBe('forwarded');
    expect(receivedPlaintext).toBe(longMessage);
  });

  it('a small message still sends as a single frame, not needlessly fragmented', () => {
    const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
    const bob = new RelayNode('bob', createIdentity(), createBluetoothTransport('bob'));
    connectNodes(alice, bob);

    const bobHint = computeDestinationHint(bob.identity.publicKey);
    const bobAd = createRoutingAdvertisement(bob.identity, [bobHint]);
    alice.receiveAdvertisement('bob', bobAd);

    let frameCount = 0;
    const originalSend = (alice.transport as SimulatedTransport).send.bind(alice.transport);
    (alice.transport as SimulatedTransport).send = (neighborId: string, frame: Uint8Array) => {
      frameCount++;
      return originalSend(neighborId, frame);
    };

    const envelope = createDataEnvelope(
      bobHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
      text('hi'),
      10
    );
    alice.receiveEnvelope(envelope, null);

    expect(frameCount).toBe(1);
  });

  it("a large sync transfer, bundling several queued envelopes, also fragments correctly", () => {
    const a = new RelayNode('a', createIdentity(), createBluetoothTransport('a'));
    const b = new RelayNode('b', createIdentity(), createBluetoothTransport('b'));
    connectNodes(a, b);

    const aSend = new Uint8Array(32).fill(31);
    const aReceive = new Uint8Array(32).fill(32);
    a.registerAuthenticatedSession('b', b.identity.publicKey, { sessionId: 'fragment-sync', sendKey: aSend, receiveKey: aReceive });
    b.registerAuthenticatedSession('a', a.identity.publicKey, { sessionId: 'fragment-sync', sendKey: aReceive, receiveKey: aSend });

    const destinationHint = new Uint8Array(8).fill(3);
    for (let i = 0; i < 5; i++) {
      const envelope = createDataEnvelope(
        destinationHint,
        { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
        text('x'.repeat(100)),
        10
      );
      a.receiveEnvelope(envelope, null);
    }
    expect(a.queueSize()).toBe(5);

    expect(a.initiateSync('b')).toBe(true);

    expect(b.queueSize()).toBe(5);
  });

  it('purgeStaleFragments clears an incomplete set left behind by a partial send failure', () => {
    const node = new RelayNode('node', createIdentity(), createBluetoothTransport('node'));
    expect(node.purgeStaleFragments(0)).toBe(0);
  });
});
