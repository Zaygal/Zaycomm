// test/ratchet-skipped-keys.test.ts

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { DoubleRatchet } from '../src/crypto/ratchet';

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe('Skipped message key cache (RFC-0004 Section 2.4, out-of-order delivery)', () => {
  it('decrypts a message that arrives ahead of an earlier one, then the earlier one afterward', () => {
    const sharedRootKey = new Uint8Array(32).fill(11);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    const msg1 = alice.encrypt(text('first'));
    const msg2 = alice.encrypt(text('second'));
    const msg3 = alice.encrypt(text('third'));

    expect(decode(bob.decrypt(msg2.header, msg2.ciphertext))).toBe('second');
    expect(decode(bob.decrypt(msg3.header, msg3.ciphertext))).toBe('third');
    expect(decode(bob.decrypt(msg1.header, msg1.ciphertext))).toBe('first');
  });

  it('still decrypts correctly when a message is lost entirely, never delivered at all', () => {
    const sharedRootKey = new Uint8Array(32).fill(12);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    const msg1 = alice.encrypt(text('lost forever'));
    const msg2 = alice.encrypt(text('this one arrives'));
    void msg1;

    expect(decode(bob.decrypt(msg2.header, msg2.ciphertext))).toBe('this one arrives');
  });

  it('works across a DH ratchet step too: a reply correctly skips ahead for messages from the closed chain', () => {
    const sharedRootKey = new Uint8Array(32).fill(13);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    const aMsg1 = alice.encrypt(text('a1'));
    const aMsg2 = alice.encrypt(text('a2'));

    expect(decode(bob.decrypt(aMsg2.header, aMsg2.ciphertext))).toBe('a2');

    const bReply = bob.encrypt(text('reply'));
    expect(decode(alice.decrypt(bReply.header, bReply.ciphertext))).toBe('reply');

    expect(decode(bob.decrypt(aMsg1.header, aMsg1.ciphertext))).toBe('a1');
  });

  it('refuses to skip an unreasonably large gap rather than let the cache grow unbounded', () => {
    const sharedRootKey = new Uint8Array(32).fill(14);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    let last;
    for (let i = 0; i < 1005; i++) {
      last = alice.encrypt(text(`msg ${i}`));
    }

    expect(() => bob.decrypt(last!.header, last!.ciphertext)).toThrow();
  });

  it('closes the gap flagged since Phase 1: file chunks now decrypt correctly even arriving out of order', () => {
    const sharedRootKey = new Uint8Array(32).fill(15);
    const responderRatchetKeyPair = generateX25519KeyPair();
    const alice = DoubleRatchet.initAsInitiator(sharedRootKey, responderRatchetKeyPair.publicKey);
    const bob = DoubleRatchet.initAsResponder(sharedRootKey, responderRatchetKeyPair);

    const chunks = ['chunk-A', 'chunk-B', 'chunk-C', 'chunk-D'].map((c) => alice.encrypt(text(c)));
    const arrivalOrder = [2, 0, 3, 1];

    const received = arrivalOrder.map((i) => decode(bob.decrypt(chunks[i].header, chunks[i].ciphertext)));

    expect(received).toEqual(['chunk-C', 'chunk-A', 'chunk-D', 'chunk-B']);
  });
});