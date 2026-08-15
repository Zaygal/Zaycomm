// test/ratchet.test.ts

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { DoubleRatchet } from '../src/crypto/ratchet';

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe('Double ratchet (RFC-0004 Section 2.4)', () => {
  it('carries a full two-way conversation correctly', () => {
    const sharedRootKey = new Uint8Array(32).fill(7);
    const responderRatchetKeyPair = generateX25519KeyPair();

    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    const msg1 = alice.encrypt(text('hello bob'));
    expect(decode(bob.decrypt(msg1.header, msg1.ciphertext))).toBe('hello bob');

    const msg2 = bob.encrypt(text('hi alice'));
    expect(decode(alice.decrypt(msg2.header, msg2.ciphertext))).toBe('hi alice');

    const msg3 = alice.encrypt(text('how are you'));
    expect(decode(bob.decrypt(msg3.header, msg3.ciphertext))).toBe('how are you');

    const msg4 = bob.encrypt(text('good, you'));
    expect(decode(alice.decrypt(msg4.header, msg4.ciphertext))).toBe('good, you');
  });

  it('produces a different message key for every message, even identical plaintext', () => {
    const sharedRootKey = new Uint8Array(32).fill(3);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);

    const first = alice.encrypt(text('same message'));
    const second = alice.encrypt(text('same message'));

    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(first.header.messageNumber).toBe(0);
    expect(second.header.messageNumber).toBe(1);
  });

  it('rejects a message tampered with in transit', () => {
    const sharedRootKey = new Uint8Array(32).fill(9);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    const msg = alice.encrypt(text('do not modify me'));
    const tampered = new Uint8Array(msg.ciphertext);
    tampered[0] ^= 0xff;

    expect(() => bob.decrypt(msg.header, tampered)).toThrow();
  });

  it('does not advance the receiving chain after forged ciphertext', () => {
    const sharedRootKey = new Uint8Array(32).fill(11);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    const msg1 = alice.encrypt(text('message one'));
    expect(decode(bob.decrypt(msg1.header, msg1.ciphertext))).toBe('message one');

    const msg2 = alice.encrypt(text('message two'));
    const forged = new Uint8Array(msg2.ciphertext);
    forged[0] ^= 0xff;

    expect(() => bob.decrypt(msg2.header, forged)).toThrow();
    expect(decode(bob.decrypt(msg2.header, msg2.ciphertext))).toBe('message two');
  });

  it('does not change DH ratchet state after a forged new-ratchet packet', () => {
    const sharedRootKey = new Uint8Array(32).fill(13);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    const msg1 = alice.encrypt(text('establish session'));
    expect(decode(bob.decrypt(msg1.header, msg1.ciphertext))).toBe('establish session');

    const real = alice.encrypt(text('real ratchet message'));
    const attackerKeyPair = generateX25519KeyPair();
    const forgedHeader = {
      ...real.header,
      dhPublicKey: attackerKeyPair.publicKey,
    };

    expect(() => bob.decrypt(forgedHeader, new Uint8Array(real.ciphertext))).toThrow();
    expect(decode(bob.decrypt(real.header, real.ciphertext))).toBe('real ratchet message');
  });

  it('does not consume a skipped-message key when its ciphertext is forged', () => {
    const sharedRootKey = new Uint8Array(32).fill(15);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    const msg0 = alice.encrypt(text('message zero'));
    const msg1 = alice.encrypt(text('message one'));
    const msg2 = alice.encrypt(text('message two'));

    expect(decode(bob.decrypt(msg0.header, msg0.ciphertext))).toBe('message zero');
    expect(decode(bob.decrypt(msg2.header, msg2.ciphertext))).toBe('message two');

    const forged = new Uint8Array(msg1.ciphertext);
    forged[0] ^= 0xff;
    expect(() => bob.decrypt(msg1.header, forged)).toThrow();

    expect(decode(bob.decrypt(msg1.header, msg1.ciphertext))).toBe('message one');
  });

  it('rejects decryption before any sending chain exists on a fresh responder', () => {
    const sharedRootKey = new Uint8Array(32).fill(5);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    expect(() => bob.encrypt(text('bob cannot speak first'))).toThrow();
  });
});