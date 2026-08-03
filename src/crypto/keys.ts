// src/crypto/keys.ts
// RFC-0004, Section 2.1 (X25519) and Section 2.2 (Ed25519)

import { x25519, ed25519 } from '@noble/curves/ed25519.js';

export interface X25519KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface Ed25519KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * Generates an X25519 key pair, used for ephemeral and static
 * Diffie Hellman key agreement (Noise handshake, double ratchet).
 */
export function generateX25519KeyPair(): X25519KeyPair {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Generates an Ed25519 key pair, used as a Zaycomm identity
 * (RFC-0005, Section 1) and for signing routing advertisements
 * and device linking statements.
 */
export function generateEd25519KeyPair(): Ed25519KeyPair {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Computes an X25519 shared secret between your private key
 * and a peer's public key. Feeds directly into HKDF in the
 * Noise handshake (RFC-0004, Section 2.3 and 2.6).
 */
export function deriveSharedSecret(
  privateKey: Uint8Array,
  peerPublicKey: Uint8Array
): Uint8Array {
  return x25519.getSharedSecret(privateKey, peerPublicKey);
}

/** Signs a message with an Ed25519 private key. */
export function signMessage(
  message: Uint8Array,
  privateKey: Uint8Array
): Uint8Array {
  return ed25519.sign(message, privateKey);
}

/** Verifies an Ed25519 signature against a public key. */
export function verifySignature(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): boolean {
  return ed25519.verify(signature, message, publicKey);
}