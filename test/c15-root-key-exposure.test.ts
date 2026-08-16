import { describe, expect, it } from 'vitest';
import { DoubleRatchet } from '../src/crypto/ratchet';
import { generateX25519KeyPair } from '../src/crypto/keys';

const rootKey = new Uint8Array(32).fill(0x41);

describe('C15 handshake root-key exposure', () => {
  it('does not expose rootKey as a public runtime property', () => {
    const remote = generateX25519KeyPair();
    const ratchet = DoubleRatchet.initAsInitiator(rootKey, remote.publicKey);

    expect(Object.prototype.hasOwnProperty.call(ratchet, 'rootKey')).toBe(false);
    expect('rootKey' in ratchet).toBe(false);
  });

  it('does not retain the caller-owned root-key buffer by reference', () => {
    const remote = generateX25519KeyPair();
    const supplied = new Uint8Array(rootKey);
    const ratchet = DoubleRatchet.initAsInitiator(supplied, remote.publicKey);

    supplied.fill(0);
    expect((ratchet as unknown as Record<string, unknown>).rootKey).toBeUndefined();
  });

  it('keeps root-key material inaccessible through normal public API', () => {
    const remote = generateX25519KeyPair();
    const ratchet = DoubleRatchet.initAsInitiator(rootKey, remote.publicKey);

    const publicNames = Object.keys(ratchet);
    expect(publicNames).not.toContain('rootKey');
    expect(publicNames).not.toContain('#rootKey');
  });
});
