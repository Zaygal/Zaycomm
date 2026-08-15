import { describe, expect, it } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { DoubleRatchet } from '../src/crypto/ratchet';
import {
  createAuthenticatedDataEnvelope,
  openAuthenticatedDataEnvelope,
} from '../src/envelope/envelope';

const text = (s: string) => new TextEncoder().encode(s);
const pair = () => {
  const root = new Uint8Array(32).fill(7);
  const responderKey = generateX25519KeyPair();
  return {
    alice: DoubleRatchet.initAsInitiator(root, responderKey.publicKey),
    bob: DoubleRatchet.initAsResponder(root, responderKey),
  };
};

describe('C5: immutable envelope header authentication', () => {
  it.each([
    ['messageId', (e: any) => { e.header.messageId = Uint8Array.from(e.header.messageId, (b: number) => b ^ 0xff); }],
    ['destinationHint', (e: any) => { e.header.destinationHint = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]); }],
    ['packetType', (e: any) => { e.header.packetType = 2; }],
    ['timestamp', (e: any) => { e.header.timestamp += 60; }],
  ])('rejects tampering with immutable %s', (_field, mutate) => {
    const { alice, bob } = pair();
    const envelope = createAuthenticatedDataEnvelope(new Uint8Array(8).fill(1), alice, text('secret'));
    mutate(envelope);
    expect(() => openAuthenticatedDataEnvelope(envelope, bob)).toThrow();
  });

  it('allows TTL mutation because relays are allowed to decrement it', () => {
    const { alice, bob } = pair();
    const envelope = createAuthenticatedDataEnvelope(new Uint8Array(8).fill(1), alice, text('secret'), 16);
    envelope.header.ttl = 3;
    expect(new TextDecoder().decode(openAuthenticatedDataEnvelope(envelope, bob))).toBe('secret');
  });

  it('does not consume the ratchet message after an authenticated-header failure', () => {
    const { alice, bob } = pair();
    const envelope = createAuthenticatedDataEnvelope(new Uint8Array(8).fill(1), alice, text('secret'));
    envelope.header.destinationHint = new Uint8Array(8).fill(8);

    expect(() => openAuthenticatedDataEnvelope(envelope, bob)).toThrow();

    envelope.header.destinationHint = new Uint8Array(8).fill(1);
    expect(new TextDecoder().decode(openAuthenticatedDataEnvelope(envelope, bob))).toBe('secret');
  });
});
