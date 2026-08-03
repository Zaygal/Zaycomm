// test/crypto.test.ts

import { describe, it, expect } from 'vitest';
import {
  generateX25519KeyPair,
  generateEd25519KeyPair,
  deriveSharedSecret,
  signMessage,
  verifySignature,
} from '../src/crypto/keys';

describe('X25519 key generation (RFC-0004 Section 2.1)', () => {
  it('produces 32 byte private and public keys', () => {
    const { privateKey, publicKey } = generateX25519KeyPair();
    expect(privateKey.length).toBe(32);
    expect(publicKey.length).toBe(32);
  });

  it('two parties derive the same shared secret', () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();

    const aliceShared = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const bobShared = deriveSharedSecret(bob.privateKey, alice.publicKey);

    expect(aliceShared).toEqual(bobShared);
  });
});

describe('Ed25519 key generation (RFC-0004 Section 2.2)', () => {
  it('produces 32 byte private and public keys', () => {
    const { privateKey, publicKey } = generateEd25519KeyPair();
    expect(privateKey.length).toBe(32);
    expect(publicKey.length).toBe(32);
  });

  it('signs and verifies a message correctly', () => {
    const { privateKey, publicKey } = generateEd25519KeyPair();
    const message = new TextEncoder().encode('zaycomm test message');

    const signature = signMessage(message, privateKey);
    expect(verifySignature(signature, message, publicKey)).toBe(true);
  });

  it('rejects a signature verified against the wrong key', () => {
    const signer = generateEd25519KeyPair();
    const impostor = generateEd25519KeyPair();
    const message = new TextEncoder().encode('zaycomm test message');

    const signature = signMessage(message, signer.privateKey);
    expect(verifySignature(signature, message, impostor.publicKey)).toBe(false);
  });
});