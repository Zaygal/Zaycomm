import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import {
  createIdentity,
  createSessionIdentityBinding,
  verifySessionIdentityBinding,
} from '../src/identity/identity';

describe('Ed25519 identity ↔ Noise/X25519 session binding', () => {
  it('accepts a binding for the exact X25519 key and handshake transcript', () => {
    const identity = createIdentity();
    const x25519 = generateX25519KeyPair();
    const handshakeHash = crypto.getRandomValues(new Uint8Array(32));

    const binding = createSessionIdentityBinding(
      identity,
      x25519.publicKey,
      handshakeHash,
      'initiator'
    );

    expect(
      verifySessionIdentityBinding(
        binding,
        x25519.publicKey,
        handshakeHash,
        'initiator'
      )
    ).toBe(true);
  });

  it('rejects a binding for a different X25519 session key', () => {
    const identity = createIdentity();
    const x25519 = generateX25519KeyPair();
    const otherX25519 = generateX25519KeyPair();
    const handshakeHash = crypto.getRandomValues(new Uint8Array(32));

    const binding = createSessionIdentityBinding(
      identity,
      x25519.publicKey,
      handshakeHash,
      'initiator'
    );

    expect(
      verifySessionIdentityBinding(
        binding,
        otherX25519.publicKey,
        handshakeHash,
        'initiator'
      )
    ).toBe(false);
  });

  it('rejects a binding transplanted to a different handshake transcript', () => {
    const identity = createIdentity();
    const x25519 = generateX25519KeyPair();
    const handshakeHash = crypto.getRandomValues(new Uint8Array(32));
    const otherHandshakeHash = crypto.getRandomValues(new Uint8Array(32));

    const binding = createSessionIdentityBinding(
      identity,
      x25519.publicKey,
      handshakeHash,
      'initiator'
    );

    expect(
      verifySessionIdentityBinding(
        binding,
        x25519.publicKey,
        otherHandshakeHash,
        'initiator'
      )
    ).toBe(false);
  });

  it('rejects role confusion between initiator and responder', () => {
    const identity = createIdentity();
    const x25519 = generateX25519KeyPair();
    const handshakeHash = crypto.getRandomValues(new Uint8Array(32));

    const binding = createSessionIdentityBinding(
      identity,
      x25519.publicKey,
      handshakeHash,
      'initiator'
    );

    expect(
      verifySessionIdentityBinding(
        binding,
        x25519.publicKey,
        handshakeHash,
        'responder'
      )
    ).toBe(false);
  });

  it('rejects a signature from an impostor identity', () => {
    const identity = createIdentity();
    const impostor = createIdentity();
    const x25519 = generateX25519KeyPair();
    const handshakeHash = crypto.getRandomValues(new Uint8Array(32));

    const binding = createSessionIdentityBinding(
      identity,
      x25519.publicKey,
      handshakeHash,
      'initiator'
    );

    const forged = { ...binding, identityPublicKey: impostor.publicKey };

    expect(
      verifySessionIdentityBinding(
        forged,
        x25519.publicKey,
        handshakeHash,
        'initiator'
      )
    ).toBe(false);
  });
});