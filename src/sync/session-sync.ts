import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/webcrypto.js';
import { buildNonce } from '../util';

const INFO = new TextEncoder().encode('Zaycomm C14 sync v1');

export interface SyncCiphertext {
  sessionId: string;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * C14: protects store-forward synchronization with the already-established
 * authenticated session key. The caller must supply the directional session
 * key obtained from the Noise/ratchet session; this module never invents a
 * separate long-lived sync credential.
 */
export function encryptSyncPayload(
  sessionKey: Uint8Array,
  sessionId: string,
  plaintext: Uint8Array
): SyncCiphertext {
  if (sessionKey.length !== 32) throw new Error('INVALID_SESSION_KEY');
  const nonce = randomBytes(24);
  const aad = new TextEncoder().encode(`${sessionId}:c14`);
  const cipher = xchacha20poly1305(sessionKey, nonce, aad);
  return { sessionId, nonce, ciphertext: cipher.encrypt(plaintext) };
}

export function decryptSyncPayload(
  sessionKey: Uint8Array,
  envelope: SyncCiphertext
): Uint8Array {
  if (sessionKey.length !== 32) throw new Error('INVALID_SESSION_KEY');
  const aad = new TextEncoder().encode(`${envelope.sessionId}:c14`);
  const cipher = xchacha20poly1305(sessionKey, envelope.nonce, aad);
  return cipher.decrypt(envelope.ciphertext);
}
