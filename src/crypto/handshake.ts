// src/crypto/handshake.ts
// RFC-0004, Section 2.3: Noise Protocol Framework, IK pattern.
//
// IK means: Initiator sends its static key Immediately (encrypted, in
// message one). Responder's static key is Known to the initiator
// beforehand (this is why RFC-0005's fingerprint verification matters,
// it's how you came to know that key in the first place).
//
// Four Diffie Hellman operations happen across the two messages:
//   es -> confidentiality, as soon as message one is sent
//   ss -> sender authentication (only the real initiator has this static key)
//   ee -> forward secrecy (ephemeral keys are thrown away after use)
//   se -> responder authentication back to the initiator
//
// Every byte exchanged gets folded into a running hash (h). That hash
// is used as authenticated associated data for every encryption from
// that point forward, which is what makes tampering anywhere in the
// transcript cause every later decryption to fail.

import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import {
  generateX25519KeyPair,
  deriveSharedSecret,
  type X25519KeyPair,
} from './keys';
import { buildNonce } from '../util';




const HASHLEN = 32;
const PROTOCOL_NAME = 'Noise_IK_25519_XChaChaPoly_SHA256';

/**
 * The running handshake state. h is the transcript hash, ck is the
 * chaining key that accumulates entropy from each Diffie Hellman
 * result, k is the current encryption key (null until the first DH
 * result is mixed in), n is the per-key nonce counter.
 */
class SymmetricState {
  private h: Uint8Array;
  private ck: Uint8Array;
  private k: Uint8Array | null = null;
  private n = 0;

  constructor(h: Uint8Array, ck: Uint8Array) {
    this.h = h;
    this.ck = ck;
  }

  /** Folds arbitrary data into the transcript hash. */
  mixHash(data: Uint8Array): void {
    const combined = new Uint8Array(this.h.length + data.length);
    combined.set(this.h);
    combined.set(data, this.h.length);
    this.h = sha256(combined);
  }

  /**
   * Folds a Diffie Hellman result into the chaining key, derives a
   * fresh encryption key from it, and resets the nonce counter.
   * This is called once per DH operation (es, ss, ee, se).
   */
  mixKey(inputKeyMaterial: Uint8Array): void {
    const output = hkdf(sha256, inputKeyMaterial, this.ck, new Uint8Array(0), 64);
    this.ck = output.slice(0, 32);
    this.k = output.slice(32, 64);
    this.n = 0;
  }

  /**
   * Encrypts (if a key is set) and always mixes the result into the
   * hash. Before any mixKey call there is no key yet, so this just
   * passes data through while still hashing it, matching the Noise
   * spec exactly.
   */
  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    if (this.k === null) {
      this.mixHash(plaintext);
      return plaintext;
    }
    const nonce = buildNonce(this.n);
    const cipher = xchacha20poly1305(this.k, nonce, this.h);
    const ciphertext = cipher.encrypt(plaintext);
    this.mixHash(ciphertext);
    this.n++;
    return ciphertext;
  }

  /** The decrypt-side mirror of encryptAndHash. */
  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    if (this.k === null) {
      this.mixHash(ciphertext);
      return ciphertext;
    }
    const nonce = buildNonce(this.n);
    const cipher = xchacha20poly1305(this.k, nonce, this.h);
    const plaintext = cipher.decrypt(ciphertext);
    this.mixHash(ciphertext);
    this.n++;
    return plaintext;
  }

  /**
   * Called once, after the final mixKey of the handshake. Splits the
   * chaining key into two independent transport keys, one per
   * direction, so a compromise of one direction's key doesn't expose
   * the other. k1 is used initiator to responder, k2 the reverse,
   * per the Noise specification's convention.
   */
  split(): { k1: Uint8Array; k2: Uint8Array; handshakeHash: Uint8Array } {
    const output = hkdf(sha256, new Uint8Array(0), this.ck, new Uint8Array(0), 64);
    return { k1: output.slice(0, 32), k2: output.slice(32, 64), handshakeHash: this.h };
  }

  /**
   * Exposes the chaining key directly, used as the double ratchet's
   * root key (ratchet.ts). This is deliberately NOT the same as
   * split()'s k1/k2, those are fixed forever, right for a handshake
   * used standalone (like WireGuard does). The ratchet instead needs
   * the raw accumulated entropy so it can keep re-deriving new keys
   * for the entire lifetime of the conversation.
   */
  getChainingKey(): Uint8Array {
    return this.ck;
  }
}

/**
 * Sets up the initial state before any handshake message is sent.
 * The responder's static public key is mixed in here as a
 * "pre-message", both sides do this identically, since IK means the
 * initiator already knows this key before the handshake starts.
 */
function initializeState(responderStaticPublicKey: Uint8Array): SymmetricState {
  const nameBytes = new TextEncoder().encode(PROTOCOL_NAME);
  let h: Uint8Array;
  if (nameBytes.length <= HASHLEN) {
    h = new Uint8Array(HASHLEN);
    h.set(nameBytes);
  } else {
    h = sha256(nameBytes);
  }
  const state = new SymmetricState(h, h.slice());
  state.mixHash(new Uint8Array(0)); // empty prologue
  state.mixHash(responderStaticPublicKey); // pre-message
  return state;
}

export interface HandshakeMessage1 {
  ephemeralPublicKey: Uint8Array;
  encryptedStaticKey: Uint8Array;
  encryptedPayload: Uint8Array;
}

export interface HandshakeMessage2 {
  ephemeralPublicKey: Uint8Array;
  encryptedPayload: Uint8Array;
}

export interface HandshakeResult {
  sendKey: Uint8Array;
  receiveKey: Uint8Array;
  handshakeHash: Uint8Array;
  rootKey: Uint8Array;
}

/**
 * INITIATOR, message 1: e, es, s, ss
 *
 *  e  - generate a fresh ephemeral key, send it in the clear, hash it in
 *  es - DH(my ephemeral, their known static) -> confidentiality
 *  s  - send my own static key, now encrypted using the es-derived key
 *  ss - DH(my static, their known static) -> sender authentication
 */
export function initiatorWriteMessage1(
  initiatorStaticKeyPair: X25519KeyPair,
  responderStaticPublicKey: Uint8Array,
  payload: Uint8Array = new Uint8Array(0)
): { message: HandshakeMessage1; state: SymmetricState; initiatorEphemeral: X25519KeyPair } {
  const state = initializeState(responderStaticPublicKey);
  const e = generateX25519KeyPair();
  state.mixHash(e.publicKey);

  const es = deriveSharedSecret(e.privateKey, responderStaticPublicKey);
  state.mixKey(es);

  const encryptedStaticKey = state.encryptAndHash(initiatorStaticKeyPair.publicKey);

  const ss = deriveSharedSecret(initiatorStaticKeyPair.privateKey, responderStaticPublicKey);
  state.mixKey(ss);

  const encryptedPayload = state.encryptAndHash(payload);

  return {
    message: { ephemeralPublicKey: e.publicKey, encryptedStaticKey, encryptedPayload },
    state,
    initiatorEphemeral: e,
  };
}

/**
 * RESPONDER, reading message 1: mirrors initiatorWriteMessage1 exactly,
 * arriving at the same es and ss values via the Diffie Hellman
 * symmetry property: DH(a_priv, b_pub) always equals DH(b_priv, a_pub).
 */
export function responderReadMessage1(
  responderStaticKeyPair: X25519KeyPair,
  message: HandshakeMessage1
): { state: SymmetricState; initiatorStaticPublicKey: Uint8Array; payload: Uint8Array } {
  const state = initializeState(responderStaticKeyPair.publicKey);
  state.mixHash(message.ephemeralPublicKey);

  const es = deriveSharedSecret(responderStaticKeyPair.privateKey, message.ephemeralPublicKey);
  state.mixKey(es);

  const initiatorStaticPublicKey = state.decryptAndHash(message.encryptedStaticKey);

  const ss = deriveSharedSecret(responderStaticKeyPair.privateKey, initiatorStaticPublicKey);
  state.mixKey(ss);

  const payload = state.decryptAndHash(message.encryptedPayload);

  return { state, initiatorStaticPublicKey, payload };
}

/**
 * RESPONDER, message 2: e, ee, se
 *
 *  e  - generate my own fresh ephemeral key, send it, hash it in
 *  ee - DH(my ephemeral, their ephemeral) -> forward secrecy
 *  se - DH(my ephemeral, their static) -> authenticates me back to them
 *
 * This also calls split(), completing the handshake and producing the
 * two transport keys, plus getChainingKey() for the ratchet's root key.
 * The ephemeral keypair generated here is also returned directly, as
 * initialRatchetKeyPair, since it doubles as the seed for the
 * responder's side of the double ratchet (ratchet.ts).
 */
export function responderWriteMessage2(
  state: SymmetricState,
  initiatorEphemeralPublicKey: Uint8Array,
  initiatorStaticPublicKey: Uint8Array,
  payload: Uint8Array = new Uint8Array(0)
): { message: HandshakeMessage2; result: HandshakeResult; initialRatchetKeyPair: X25519KeyPair } {
  const e = generateX25519KeyPair();
  state.mixHash(e.publicKey);

  const ee = deriveSharedSecret(e.privateKey, initiatorEphemeralPublicKey);
  state.mixKey(ee);

  const se = deriveSharedSecret(e.privateKey, initiatorStaticPublicKey);
  state.mixKey(se);

  const encryptedPayload = state.encryptAndHash(payload);

  const { k1, k2, handshakeHash } = state.split();
  // Responder sends with k2, receives with k1 (reverse of the initiator).
  const result: HandshakeResult = { sendKey: k2, receiveKey: k1, handshakeHash, rootKey: state.getChainingKey() };

  return {
    message: { ephemeralPublicKey: e.publicKey, encryptedPayload },
    result,
    initialRatchetKeyPair: e,
  };
}

/**
 * INITIATOR, reading message 2: mirrors responderWriteMessage2, and
 * likewise finishes with split() plus getChainingKey(). Because both
 * sides fed identical DH results into identical positions of the same
 * chaining key, they arrive at the same rootKey and the same two
 * transport keys, just assigned to opposite directions.
 */
export function initiatorReadMessage2(
  state: SymmetricState,
  initiatorStaticKeyPair: X25519KeyPair,
  initiatorEphemeral: X25519KeyPair,
  message: HandshakeMessage2
): HandshakeResult {
  state.mixHash(message.ephemeralPublicKey);

  const ee = deriveSharedSecret(initiatorEphemeral.privateKey, message.ephemeralPublicKey);
  state.mixKey(ee);

  const se = deriveSharedSecret(initiatorStaticKeyPair.privateKey, message.ephemeralPublicKey);
  state.mixKey(se);

  state.decryptAndHash(message.encryptedPayload);

  const { k1, k2, handshakeHash } = state.split();
  // Initiator sends with k1, receives with k2.
  return { sendKey: k1, receiveKey: k2, handshakeHash, rootKey: state.getChainingKey() };
}