// src/crypto/ratchet.ts
// RFC-0004, Section 2.4: Double Ratchet, Signal-style.
//
// The handshake (handshake.ts) gives you exactly one shared secret,
// once. If every message in a conversation used that same secret,
// compromising it once would expose every past and future message.
// The double ratchet fixes this with two mechanisms stacked together:
//
//   1. Symmetric ratchet: every single message derives a brand new
//      message key from a running "chain key", then advances the
//      chain key forward. Even messages sent a second apart use
//      different keys. This alone gives forward secrecy for the
//      current chain.
//
//   2. Diffie Hellman ratchet: whenever the other party's ratchet
//      public key changes (which happens on their next reply), both
//      sides mix a fresh DH result into the root key and start new
//      sending/receiving chains. This is what gives "post-compromise
//      recovery": even if an attacker captures a chain key, they lose
//      access again the moment the next DH ratchet step happens,
//      because that step depends on fresh randomness they don't have.
//
// Both KDF_RK (root key derivation) and KDF_CK (chain key derivation)
// are exactly the constructions from Signal's published Double Ratchet
// specification, built from the same proven primitives as everywhere
// else in this project: HKDF, HMAC, SHA-256.

import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import {
  generateX25519KeyPair,
  deriveSharedSecret,
  type X25519KeyPair,
} from './keys';
import { buildNonce, concatBytes, bytesEqual, u32le } from '../util';

/**
 * The root ratchet step. Takes the current root key and a fresh DH
 * result, returns a new root key plus a chain key to start a new
 * sending or receiving chain. This is literally HKDF (RFC-0004,
 * Section 2.6), root key as salt, DH output as input key material.
 */
function kdfRootKey(rootKey: Uint8Array, dhOutput: Uint8Array): { rootKey: Uint8Array; chainKey: Uint8Array } {
  const output = hkdf(sha256, dhOutput, rootKey, new Uint8Array(0), 64);
  return { rootKey: output.slice(0, 32), chainKey: output.slice(32, 64) };
}

/**
 * The symmetric ratchet step. Advances a chain key forward one step,
 * producing a one-time message key along the way. Uses HMAC directly
 * (not full HKDF), this is exactly Signal's published construction,
 * two HMAC calls with different single-byte inputs, cheap enough to
 * run on every single message without it being a bottleneck.
 */
function kdfChainKey(chainKey: Uint8Array): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  const messageKey = hmac(sha256, chainKey, new Uint8Array([0x01]));
  const nextChainKey = hmac(sha256, chainKey, new Uint8Array([0x02]));
  return { messageKey, nextChainKey };
}

export interface RatchetHeader {
  dhPublicKey: Uint8Array;
  previousChainLength: number;
  messageNumber: number;
}

function encodeHeader(header: RatchetHeader): Uint8Array {
  return concatBytes(header.dhPublicKey, u32le(header.previousChainLength), u32le(header.messageNumber));
}

export class DoubleRatchet {
  private rootKey: Uint8Array;
  private dhSelf: X25519KeyPair;
  private dhRemote: Uint8Array | null;
  private sendingChainKey: Uint8Array | null;
  private receivingChainKey: Uint8Array | null;
  private sendMessageNumber = 0;
  private receiveMessageNumber = 0;
  private previousSendingChainLength = 0;

  private constructor(
    rootKey: Uint8Array,
    dhSelf: X25519KeyPair,
    dhRemote: Uint8Array | null,
    sendingChainKey: Uint8Array | null,
    receivingChainKey: Uint8Array | null
  ) {
    this.rootKey = rootKey;
    this.dhSelf = dhSelf;
    this.dhRemote = dhRemote;
    this.sendingChainKey = sendingChainKey;
    this.receivingChainKey = receivingChainKey;
  }

  /**
   * The initiator already knows the responder's ratchet public key
   * the moment the handshake finishes (it arrived in message 2, per
   * handshake.ts), so the initiator can perform one DH ratchet step
   * immediately and has a sending chain ready to go without waiting
   * for a reply.
   */
  static initAsInitiator(rootKey: Uint8Array, remoteRatchetPublicKey: Uint8Array): DoubleRatchet {
    const dhSelf = generateX25519KeyPair();
    const dhOutput = deriveSharedSecret(dhSelf.privateKey, remoteRatchetPublicKey);
    const { rootKey: newRootKey, chainKey } = kdfRootKey(rootKey, dhOutput);
    return new DoubleRatchet(newRootKey, dhSelf, remoteRatchetPublicKey, chainKey, null);
  }

  /**
   * The responder has no sending chain yet, they don't know the
   * initiator's next ratchet key until a message actually arrives.
   * This is why, in the real protocol, the initiator always sends
   * first, the responder's first ratchet step happens inside decrypt().
   */
  static initAsResponder(rootKey: Uint8Array, ownRatchetKeyPair: X25519KeyPair): DoubleRatchet {
    return new DoubleRatchet(rootKey, ownRatchetKeyPair, null, null, null);
  }

  /**
   * Runs when a message arrives carrying a ratchet public key we
   * haven't seen before. Two DH results get mixed in back to back:
   * first using our OLD sending key against their new key (finishes
   * our current receiving chain), then a freshly generated key of
   * our own against their new key (starts our next sending chain).
   * This asymmetry, old key first, then generate a new one, is what
   * keeps both parties' ratchets advancing in lockstep.
   */
  private performDhRatchetStep(remoteRatchetPublicKey: Uint8Array): void {
    this.previousSendingChainLength = this.sendMessageNumber;
    this.sendMessageNumber = 0;
    this.receiveMessageNumber = 0;
    this.dhRemote = remoteRatchetPublicKey;

    const receiveStep = kdfRootKey(this.rootKey, deriveSharedSecret(this.dhSelf.privateKey, this.dhRemote));
    this.rootKey = receiveStep.rootKey;
    this.receivingChainKey = receiveStep.chainKey;

    this.dhSelf = generateX25519KeyPair();
    const sendStep = kdfRootKey(this.rootKey, deriveSharedSecret(this.dhSelf.privateKey, this.dhRemote));
    this.rootKey = sendStep.rootKey;
    this.sendingChainKey = sendStep.chainKey;
  }

  /** Encrypts one message. Every call advances the sending chain, so
   * two calls in a row with identical plaintext still produce
   * completely different ciphertext, different message key each time. */
  encrypt(plaintext: Uint8Array, associatedData: Uint8Array = new Uint8Array(0)): { header: RatchetHeader; ciphertext: Uint8Array } {
    if (this.sendingChainKey === null) {
      throw new Error('No sending chain established yet, the responder must wait for a message before it can reply.');
    }
    const { messageKey, nextChainKey } = kdfChainKey(this.sendingChainKey);
    this.sendingChainKey = nextChainKey;

    const header: RatchetHeader = {
      dhPublicKey: this.dhSelf.publicKey,
      previousChainLength: this.previousSendingChainLength,
      messageNumber: this.sendMessageNumber,
    };

    const nonce = buildNonce(this.sendMessageNumber);
    const aad = concatBytes(encodeHeader(header), associatedData);
    const cipher = xchacha20poly1305(messageKey, nonce, aad);
    const ciphertext = cipher.encrypt(plaintext);

    this.sendMessageNumber++;
    return { header, ciphertext };
  }

  /** Decrypts one message. Automatically triggers a DH ratchet step
   * the first time it sees a new ratchet key from the other side. */
  decrypt(header: RatchetHeader, ciphertext: Uint8Array, associatedData: Uint8Array = new Uint8Array(0)): Uint8Array {
    if (this.dhRemote === null || !bytesEqual(header.dhPublicKey, this.dhRemote)) {
      this.performDhRatchetStep(header.dhPublicKey);
    }
    if (this.receivingChainKey === null) {
      throw new Error('No receiving chain established yet.');
    }
    const { messageKey, nextChainKey } = kdfChainKey(this.receivingChainKey);
    this.receivingChainKey = nextChainKey;

    const nonce = buildNonce(header.messageNumber);
    const aad = concatBytes(encodeHeader(header), associatedData);
    const cipher = xchacha20poly1305(messageKey, nonce, aad);
    const plaintext = cipher.decrypt(ciphertext);

    this.receiveMessageNumber++;
    return plaintext;
  }
}