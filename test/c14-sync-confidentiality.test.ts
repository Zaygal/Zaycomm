import { describe, expect, it } from 'vitest';
import { Encoder } from 'cbor-x';
import { decryptSyncPayload, encryptSyncPayload } from '../src/sync/session-sync';
import { createIdentity } from '../src/identity/identity';
import { RelayNode } from '../src/routing/routing';
import { createInternetTransport, type SimulatedTransport } from '../src/transport/transport';

const cbor = new Encoder();

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

  it('uses the established session keys in the production RelayNode sync path', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);

    const aSend = new Uint8Array(32).fill(11);
    const aReceive = new Uint8Array(32).fill(12);
    b.registerAuthenticatedSession('a', a.identity.publicKey, { sessionId: 'handshake-session-a', sendKey: aReceive, receiveKey: aSend });
    a.registerAuthenticatedSession('b', b.identity.publicKey, { sessionId: 'handshake-session-a', sendKey: aSend, receiveKey: aReceive });

    let received: Uint8Array | null = null;
    b.onDelivered((envelope) => {
      if (envelope.header.packetType === 4) received = envelope.sealedPayload;
    });

    expect(a.initiateSync('b')).toBe(true);
    expect(received).not.toBeNull();

    const outer = cbor.decode(received!) as [string, Uint8Array, Uint8Array];
    expect(outer[0]).toBe('handshake-session-a');
    expect(outer[1]).toHaveLength(24);
    expect(outer[2]).not.toContain(a.identity.publicKey[0]);
  });

  it('drops production sync when the receiving session key does not match', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);

    const sendKey = new Uint8Array(32).fill(21);
    a.registerAuthenticatedSession('b', b.identity.publicKey, { sessionId: 'session-mismatch', sendKey, receiveKey: new Uint8Array(32).fill(22) });
    b.registerAuthenticatedSession('a', a.identity.publicKey, { sessionId: 'session-mismatch', sendKey: new Uint8Array(32).fill(23), receiveKey: new Uint8Array(32).fill(99) });

    expect(a.initiateSync('b')).toBe(true);
    expect(b.queueSize()).toBe(0);
  });
});
