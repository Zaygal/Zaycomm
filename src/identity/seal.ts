// src/identity/seal.ts
// RFC-0004 Section 4, RFC-0005: sealed sender.
//
// Wraps a sender's identity public key into the plaintext BEFORE it
// goes into DoubleRatchet.encrypt(), rather than as a separate
// envelope-level field. Only content that goes through the ratchet's
// own AEAD is genuinely sealed, protected by the same authenticated
// encryption as the message itself, readable only by whoever holds
// the ratchet key. A field placed outside that, even inside the
// "opaque" envelope wire format, is only hidden from relays by
// convention, not by cryptography. RFC-0004 Section 4 specifically
// asks for the stronger property: "only the recipient's session
// layer can determine the sender."
//
// Worth being precise about what this does and doesn't add: the
// Noise IK handshake (RFC-0004 Section 2.3) already cryptographically
// authenticates identity at session-establishment time, only the
// real counterpart to that handshake could ever produce a message
// this ratchet session will successfully decrypt. This doesn't add
// new authentication on top of that. It gives the application layer
// a sealed, convenient way to know WHICH contact sent something once
// decrypted, useful the moment a recipient has more than one ratchet
// session open at once, which is the realistic case.

import { concatBytes } from '../util';

const IDENTITY_PUBLIC_KEY_LENGTH = 32;

export function wrapWithSenderIdentity(senderPublicKey: Uint8Array, payload: Uint8Array): Uint8Array {
  if (senderPublicKey.length !== IDENTITY_PUBLIC_KEY_LENGTH) {
    throw new Error(`Expected a ${IDENTITY_PUBLIC_KEY_LENGTH} byte identity public key.`);
  }
  return concatBytes(senderPublicKey, payload);
}

export interface UnwrappedSender {
  senderPublicKey: Uint8Array;
  payload: Uint8Array;
}

export function unwrapSenderIdentity(data: Uint8Array): UnwrappedSender {
  return {
    senderPublicKey: data.slice(0, IDENTITY_PUBLIC_KEY_LENGTH),
    payload: data.slice(IDENTITY_PUBLIC_KEY_LENGTH),
  };
}