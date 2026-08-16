import { describe, expect, it } from 'vitest';
import { decryptSyncPayload, encryptSyncPayload } from '../src/sync/session-sync';

describe('C14 sync confidentiality', () => {
  const key = new Uint8Array(32).fill(7);
  const otherKey = new Uint8Array(32).fill(8);
  const plaintext = new TextEncoder().encode('private store-forward content');

  it('encrypts sync contents and recovers them with the established session key', () => {
    const sealed = encryptSyncPayload(key, 'session-a', plaintext);
    expect(sealed.ciphertext).not.toEqual(plaintext);
    expect(decryptSyncPayload(key, sealed)).toEqual(plaintext);
  });

  it('rejects ciphertext modified in transit', () => {
    const sealed = encryptSyncPayload(key, 'session-a', plaintext);
    sealed.ciphertext[0] ^= 0xff;
    expect(() => decryptSyncPayload(key, sealed)).toThrow();
  });

  it('rejects ciphertext under a different session key', () => {
    const sealed = encryptSyncPayload(key, 'session-a', plaintext);
    expect(() => decryptSyncPayload(otherKey, sealed)).toThrow();
  });

  it('binds ciphertext to the session identifier', () => {
    const sealed = encryptSyncPayload(key, 'session-a', plaintext);
    sealed.sessionId = 'session-b';
    expect(() => decryptSyncPayload(key, sealed)).toThrow();
  });
});
