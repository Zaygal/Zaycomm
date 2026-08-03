// test/envelope.test.ts

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
  encodeEnvelope,
  decodeEnvelope,
  validateRoutingHeader,
  PacketType,
} from '../src/envelope/envelope';

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe('Envelope (RFC-0006)', () => {
  it('round-trips a ratchet message through create/open', () => {
    const sharedRootKey = new Uint8Array(32).fill(1);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    const { header, ciphertext } = alice.encrypt(text('wrapped message'));
    const destinationHint = new Uint8Array([1, 2, 3, 4]);
    const envelope = createDataEnvelope(destinationHint, header, ciphertext);

    expect(envelope.header.packetType).toBe(PacketType.Data);
    expect(envelope.header.messageId.length).toBe(16);

    const { ratchetHeader, ciphertext: recoveredCiphertext } = openDataEnvelope(envelope);
    const plaintext = bob.decrypt(ratchetHeader, recoveredCiphertext);
    expect(decode(plaintext)).toBe('wrapped message');
  });

  it('round-trips a full envelope through wire encoding', () => {
    const sharedRootKey = new Uint8Array(32).fill(2);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);

    const { header, ciphertext } = alice.encrypt(text('over the wire'));
    const envelope = createDataEnvelope(new Uint8Array([9, 9]), header, ciphertext);

    const wireBytes = encodeEnvelope(envelope);
    const decoded = decodeEnvelope(wireBytes);

    expect(decoded.header.messageId).toEqual(envelope.header.messageId);
    expect(decoded.header.ttl).toBe(envelope.header.ttl);
  });

  it('accepts a freshly created header', () => {
    const header = createDataEnvelope(new Uint8Array([1]), {
      dhPublicKey: new Uint8Array(32),
      previousChainLength: 0,
      messageNumber: 0,
    }, new Uint8Array([1, 2, 3])).header;

    expect(validateRoutingHeader(header)).toBe(true);
  });

  it('rejects a wrong protocol version', () => {
    const header = createDataEnvelope(new Uint8Array([1]), {
      dhPublicKey: new Uint8Array(32),
      previousChainLength: 0,
      messageNumber: 0,
    }, new Uint8Array([1, 2, 3])).header;

    expect(validateRoutingHeader({ ...header, version: 99 })).toBe(false);
  });

  it('rejects an expired TTL', () => {
    const header = createDataEnvelope(new Uint8Array([1]), {
      dhPublicKey: new Uint8Array(32),
      previousChainLength: 0,
      messageNumber: 0,
    }, new Uint8Array([1, 2, 3])).header;

    expect(validateRoutingHeader({ ...header, ttl: 0 })).toBe(false);
  });

  it('rejects a stale timestamp beyond maxAgeSeconds', () => {
    const header = createDataEnvelope(new Uint8Array([1]), {
      dhPublicKey: new Uint8Array(32),
      previousChainLength: 0,
      messageNumber: 0,
    }, new Uint8Array([1, 2, 3])).header;

    const staleHeader = { ...header, timestamp: header.timestamp - 10000 };
    expect(validateRoutingHeader(staleHeader, 3600)).toBe(false);
  });
});

describe('Phase 1 end to end (handshake -> ratchet -> envelope -> wire -> decrypt)', () => {
  it('carries a message from Alice to Bob through the entire stack', () => {
    const aliceStatic = generateX25519KeyPair();
    const bobStatic = generateX25519KeyPair();

    const { message: msg1, state: aliceHandshakeState, initiatorEphemeral } =
      initiatorWriteMessage1(aliceStatic, bobStatic.publicKey);

    const { state: bobHandshakeState, initiatorStaticPublicKey } =
      responderReadMessage1(bobStatic, msg1);

    const { message: msg2, result: bobHandshakeResult, initialRatchetKeyPair } =
      responderWriteMessage2(bobHandshakeState, msg1.ephemeralPublicKey, initiatorStaticPublicKey);

    const aliceHandshakeResult = initiatorReadMessage2(
      aliceHandshakeState,
      aliceStatic,
      initiatorEphemeral,
      msg2
    );

    expect(aliceHandshakeResult.rootKey).toEqual(bobHandshakeResult.rootKey);

    const alice = DoubleRatchet.initAsInitiator(aliceHandshakeResult.rootKey, msg2.ephemeralPublicKey);
    const bob = DoubleRatchet.initAsResponder(bobHandshakeResult.rootKey, initialRatchetKeyPair);

    const { header: ratchetHeader, ciphertext } = alice.encrypt(text('the whole stack works'));
    const destinationHint = new Uint8Array([1, 2, 3, 4]);
    const envelope = createDataEnvelope(destinationHint, ratchetHeader, ciphertext);
    const wireBytes = encodeEnvelope(envelope);

    const receivedEnvelope = decodeEnvelope(wireBytes);
    expect(validateRoutingHeader(receivedEnvelope.header)).toBe(true);

    const { ratchetHeader: recoveredHeader, ciphertext: recoveredCiphertext } =
      openDataEnvelope(receivedEnvelope);
    const plaintext = bob.decrypt(recoveredHeader, recoveredCiphertext);

    expect(decode(plaintext)).toBe('the whole stack works');
  });
});