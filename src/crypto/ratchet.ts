// src/crypto/ratchet.ts
// RFC-0004, Section 2.4: Double Ratchet, Signal-style.
//
// Skipped-message keys are cached and bounded by MAX_SKIP. Decryption
// is transactional: hostile ciphertext must authenticate before any
// ratchet state (including skipped keys or DH-ratchet state) is committed.

import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import {
  generateX25519KeyPair,
  deriveSharedSecret,
  type X25519KeyPair,
} from './keys';
import { buildNonce, concatBytes, bytesEqual, u32le, bytesToHex } from '../util';

const MAX_SKIP = 1000;

function kdfRootKey(rootKey: Uint8Array, dhOutput: Uint8Array): { rootKey: Uint8Array; chainKey: Uint8Array } {
  const output = hkdf(sha256, dhOutput, rootKey, new Uint8Array(0), 64);
  return { rootKey: output.slice(0, 32), chainKey: output.slice(32, 64) };
}

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

type RatchetState = {
  rootKey: Uint8Array;
  dhSelf: X25519KeyPair;
  dhRemote: Uint8Array | null;
  sendingChainKey: Uint8Array | null;
  receivingChainKey: Uint8Array | null;
  sendMessageNumber: number;
  receiveMessageNumber: number;
  previousSendingChainLength: number;
  skippedMessageKeys: Map<string, Uint8Array>;
};

function copyBytes(value: Uint8Array | null): Uint8Array | null {
  return value === null ? null : new Uint8Array(value);
}

function snapshotState(state: RatchetState): RatchetState {
  return {
    rootKey: new Uint8Array(state.rootKey),
    dhSelf: {
      privateKey: new Uint8Array(state.dhSelf.privateKey),
      publicKey: new Uint8Array(state.dhSelf.publicKey),
    },
    dhRemote: copyBytes(state.dhRemote),
    sendingChainKey: copyBytes(state.sendingChainKey),
    receivingChainKey: copyBytes(state.receivingChainKey),
    sendMessageNumber: state.sendMessageNumber,
    receiveMessageNumber: state.receiveMessageNumber,
    previousSendingChainLength: state.previousSendingChainLength,
    skippedMessageKeys: new Map(
      Array.from(state.skippedMessageKeys.entries(), ([key, value]) => [key, new Uint8Array(value)])
    ),
  };
}

export class DoubleRatchet {
  // ECMAScript private storage prevents reflective access such as
  // (ratchet as any).rootKey. Callers can only use protocol operations.
  #rootKey: Uint8Array;
  private dhSelf: X25519KeyPair;
  private dhRemote: Uint8Array | null;
  private sendingChainKey: Uint8Array | null;
  private receivingChainKey: Uint8Array | null;
  private sendMessageNumber = 0;
  private receiveMessageNumber = 0;
  private previousSendingChainLength = 0;
  private skippedMessageKeys = new Map<string, Uint8Array>();

  private constructor(
    rootKey: Uint8Array,
    dhSelf: X25519KeyPair,
    dhRemote: Uint8Array | null,
    sendingChainKey: Uint8Array | null,
    receivingChainKey: Uint8Array | null
  ) {
    this.#rootKey = new Uint8Array(rootKey);
    this.dhSelf = dhSelf;
    this.dhRemote = dhRemote;
    this.sendingChainKey = sendingChainKey;
    this.receivingChainKey = receivingChainKey;
  }

  static initAsInitiator(rootKey: Uint8Array, remoteRatchetPublicKey: Uint8Array): DoubleRatchet {
    const dhSelf = generateX25519KeyPair();
    const dhOutput = deriveSharedSecret(dhSelf.privateKey, remoteRatchetPublicKey);
    const { rootKey: newRootKey, chainKey } = kdfRootKey(rootKey, dhOutput);
    return new DoubleRatchet(newRootKey, dhSelf, remoteRatchetPublicKey, chainKey, null);
  }

  static initAsResponder(rootKey: Uint8Array, ownRatchetKeyPair: X25519KeyPair): DoubleRatchet {
    return new DoubleRatchet(rootKey, ownRatchetKeyPair, null, null, null);
  }

  private getState(): RatchetState {
    return {
      rootKey: this.#rootKey,
      dhSelf: this.dhSelf,
      dhRemote: this.dhRemote,
      sendingChainKey: this.sendingChainKey,
      receivingChainKey: this.receivingChainKey,
      sendMessageNumber: this.sendMessageNumber,
      receiveMessageNumber: this.receiveMessageNumber,
      previousSendingChainLength: this.previousSendingChainLength,
      skippedMessageKeys: this.skippedMessageKeys,
    };
  }

  private restoreState(state: RatchetState): void {
    this.#rootKey = state.rootKey;
    this.dhSelf = state.dhSelf;
    this.dhRemote = state.dhRemote;
    this.sendingChainKey = state.sendingChainKey;
    this.receivingChainKey = state.receivingChainKey;
    this.sendMessageNumber = state.sendMessageNumber;
    this.receiveMessageNumber = state.receiveMessageNumber;
    this.previousSendingChainLength = state.previousSendingChainLength;
    this.skippedMessageKeys = state.skippedMessageKeys;
  }

  private skipKey(dhPublicKey: Uint8Array, messageNumber: number): string {
    return `${bytesToHex(dhPublicKey)}:${messageNumber}`;
  }

  private getSkippedMessageKey(header: RatchetHeader): { cacheKey: string; messageKey: Uint8Array } | null {
    const cacheKey = this.skipKey(header.dhPublicKey, header.messageNumber);
    const messageKey = this.skippedMessageKeys.get(cacheKey);
    return messageKey ? { cacheKey, messageKey } : null;
  }

  private skipMessageKeysUntil(until: number): void {
    if (this.receivingChainKey === null || this.dhRemote === null) return;
    if (until - this.receiveMessageNumber > MAX_SKIP) {
      throw new Error('Too many skipped messages in one gap, refusing to advance further.');
    }
    while (this.receiveMessageNumber < until) {
      const { messageKey, nextChainKey } = kdfChainKey(this.receivingChainKey);
      this.receivingChainKey = nextChainKey;
      this.skippedMessageKeys.set(this.skipKey(this.dhRemote, this.receiveMessageNumber), messageKey);
      this.receiveMessageNumber++;
    }
  }

  private performDhRatchetStep(remoteRatchetPublicKey: Uint8Array): void {
    this.previousSendingChainLength = this.sendMessageNumber;
    this.sendMessageNumber = 0;
    this.receiveMessageNumber = 0;
    this.dhRemote = remoteRatchetPublicKey;

    const receiveStep = kdfRootKey(this.#rootKey, deriveSharedSecret(this.dhSelf.privateKey, this.dhRemote));
    this.#rootKey = receiveStep.rootKey;
    this.receivingChainKey = receiveStep.chainKey;

    this.dhSelf = generateX25519KeyPair();
    const sendStep = kdfRootKey(this.#rootKey, deriveSharedSecret(this.dhSelf.privateKey, this.dhRemote));
    this.#rootKey = sendStep.rootKey;
    this.sendingChainKey = sendStep.chainKey;
  }

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

  private openWithMessageKey(
    messageKey: Uint8Array,
    header: RatchetHeader,
    ciphertext: Uint8Array,
    associatedData: Uint8Array
  ): Uint8Array {
    const nonce = buildNonce(header.messageNumber);
    const aad = concatBytes(encodeHeader(header), associatedData);
    const cipher = xchacha20poly1305(messageKey, nonce, aad);
    return cipher.decrypt(ciphertext);
  }

  decrypt(header: RatchetHeader, ciphertext: Uint8Array, associatedData: Uint8Array = new Uint8Array(0)): Uint8Array {
    const before = snapshotState(this.getState());

    try {
      const skipped = this.getSkippedMessageKey(header);
      if (skipped) {
        const plaintext = this.openWithMessageKey(skipped.messageKey, header, ciphertext, associatedData);
        this.skippedMessageKeys.delete(skipped.cacheKey);
        return plaintext;
      }

      if (this.dhRemote === null || !bytesEqual(header.dhPublicKey, this.dhRemote)) {
        this.skipMessageKeysUntil(header.previousChainLength);
        this.performDhRatchetStep(header.dhPublicKey);
      }

      this.skipMessageKeysUntil(header.messageNumber);

      if (this.receivingChainKey === null) {
        throw new Error('No receiving chain established yet.');
      }
      const { messageKey, nextChainKey } = kdfChainKey(this.receivingChainKey);
      this.receivingChainKey = nextChainKey;
      this.receiveMessageNumber++;

      return this.openWithMessageKey(messageKey, header, ciphertext, associatedData);
    } catch (error) {
      this.restoreState(before);
      throw error;
    }
  }
}
