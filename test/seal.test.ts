// test/seal.test.ts

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { DoubleRatchet } from '../src/crypto/ratchet';
import {
  initiatorWriteMessage1,
  responderReadMessage1,
  responderWriteMessage2,
  initiatorReadMessage2,
} from '../src/crypto/handshake';
import { createIdentity, computeFingerprint } from '../src/identity/identity';
import { wrapWithSenderIdentity, unwrapSenderIdentity } from '../src/identity/seal';
import { encodeTextMessage, decodeTextMessage } from '../src/message/message';
import { bytesToHex } from '../src/util';

function setupRatchetPair() {
  const initiatorStatic = generateX25519KeyPair();
  const responderStatic = generateX25519KeyPair();

  const { message: msg1, state: initState, initiatorEphemeral } =
    initiatorWriteMessage1(initiatorStatic, responderStatic.publicKey);
  const { state: respState, initiatorStaticPublicKey } =
    responderReadMessage1(responderStatic, msg1);
  const { message: msg2, result: respResult, initialRatchetKeyPair } =
    responderWriteMessage2(respState, msg1.ephemeralPublicKey, initiatorStaticPublicKey);
  const initResult = initiatorReadMessage2(initState, initiatorStatic, initiatorEphemeral, msg2);

  const initiatorRatchet = DoubleRatchet.initAsInitiator(initResult.rootKey, msg2.ephemeralPublicKey);
  const responderRatchet = DoubleRatchet.initAsResponder(respResult.rootKey, initialRatchetKeyPair);

  return { initiatorRatchet, responderRatchet };
}

describe('Sealed sender (RFC-0004 Section 4, RFC-0005)', () => {
  it('round-trips a sender identity sealed inside the ratchet-encrypted plaintext', () => {
    const { initiatorRatchet, responderRatchet } = setupRatchetPair();
    const aliceIdentity = createIdentity();

    const plaintext = wrapWithSenderIdentity(aliceIdentity.publicKey, encodeTextMessage('hi bob'));
    const { header, ciphertext } = initiatorRatchet.encrypt(plaintext);

    const decrypted = responderRatchet.decrypt(header, ciphertext);
    const { senderPublicKey, payload } = unwrapSenderIdentity(decrypted);

    expect(senderPublicKey).toEqual(aliceIdentity.publicKey);
    expect(decodeTextMessage(payload)).toBe('hi bob');
  });

  it('Bob correctly attributes messages to the right contact across two separate ratchet sessions, using only the sealed field', () => {
    const aliceIdentity = createIdentity();
    const carolIdentity = createIdentity();

    const withAlice = setupRatchetPair();
    const withCarol = setupRatchetPair();

    const aliceMsg = withAlice.initiatorRatchet.encrypt(
      wrapWithSenderIdentity(aliceIdentity.publicKey, encodeTextMessage('from alice'))
    );
    const carolMsg = withCarol.initiatorRatchet.encrypt(
      wrapWithSenderIdentity(carolIdentity.publicKey, encodeTextMessage('from carol'))
    );

    const fromAliceSession = unwrapSenderIdentity(
      withAlice.responderRatchet.decrypt(aliceMsg.header, aliceMsg.ciphertext)
    );
    const fromCarolSession = unwrapSenderIdentity(
      withCarol.responderRatchet.decrypt(carolMsg.header, carolMsg.ciphertext)
    );

    expect(computeFingerprint(fromAliceSession.senderPublicKey)).toBe(computeFingerprint(aliceIdentity.publicKey));
    expect(computeFingerprint(fromCarolSession.senderPublicKey)).toBe(computeFingerprint(carolIdentity.publicKey));
    expect(decodeTextMessage(fromAliceSession.payload)).toBe('from alice');
    expect(decodeTextMessage(fromCarolSession.payload)).toBe('from carol');
  });

  it('rejects a wrong-length identity key rather than silently truncating or padding', () => {
    expect(() => wrapWithSenderIdentity(new Uint8Array(10), encodeTextMessage('x'))).toThrow();
  });

  it('the sealed sender key never appears in the raw ciphertext bytes on the wire', () => {
    const { initiatorRatchet } = setupRatchetPair();
    const aliceIdentity = createIdentity();
    const plaintext = wrapWithSenderIdentity(aliceIdentity.publicKey, encodeTextMessage('secret sender'));
    const { ciphertext } = initiatorRatchet.encrypt(plaintext);

    const ciphertextHex = bytesToHex(ciphertext);
    const senderKeyHex = bytesToHex(aliceIdentity.publicKey);
    expect(ciphertextHex.includes(senderKeyHex)).toBe(false);
  });
});