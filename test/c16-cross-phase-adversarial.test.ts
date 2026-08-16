import { describe, expect, it } from 'vitest';
import { createIdentity } from '../src/identity/identity';
import { createBroadcastMessage } from '../src/broadcast/broadcast';
import {
  bindRouteTrust,
  createRouteProvenance,
  matchesRouteTrustBinding,
} from '../src/routing/route-provenance';
import { FragmentReassembler } from '../src/envelope/fragment';
import { encryptSyncPayload, decryptSyncPayload } from '../src/sync/session-sync';

const hint = (seed: number) => new Uint8Array(8).fill(seed);

const sessionKey = (seed: number) => new Uint8Array(32).fill(seed);

describe('C16 cross-phase adversarial campaign', () => {
  it('C3 + C8: authenticated identity cannot substitute a different sync session', () => {
    const origin = createIdentity();
    const peer = createIdentity();
    const payload = new TextEncoder().encode('authorized sync');
    const encrypted = encryptSyncPayload(sessionKey(1), 'session-a', payload);

    expect(() => decryptSyncPayload(sessionKey(2), encrypted)).toThrow();
    expect(origin.publicKey).toHaveLength(32);
    expect(peer.publicKey).toHaveLength(32);
  });

  it('C6 + C8: fragment exhaustion cannot be used to allocate unbounded sync state', () => {
    const reassembler = new FragmentReassembler();
    const peer = 'authenticated-peer';

    for (let i = 0; i < 64; i++) {
      reassembler.addFragment({
        messageId: new Uint8Array([i & 0xff, (i >> 8) & 0xff]),
        index: 0,
        total: 2,
        data: new Uint8Array(32),
      }, peer);
    }

    expect(reassembler.pendingCount).toBeLessThanOrEqual(16);
  });

  it('C7 + C9: replayed advertisement provenance cannot become a different route', () => {
    const destination = createIdentity();
    const advertiser = createIdentity();
    const original = createRouteProvenance(
      destination.publicKey,
      hint(1),
      advertiser.publicKey,
      'relay-a',
      100,
    );
    const replayedThroughDifferentNeighbor = createRouteProvenance(
      destination.publicKey,
      hint(1),
      advertiser.publicKey,
      'relay-b',
      100,
    );

    const binding = bindRouteTrust(original, 10);
    expect(matchesRouteTrustBinding(binding, replayedThroughDifferentNeighbor)).toBe(false);
  });

  it('C5 + C6: authenticated fragmentation still obeys bounded reassembly', () => {
    const reassembler = new FragmentReassembler();
    const peer = 'authenticated-peer';

    for (let i = 0; i < 32; i++) {
      reassembler.addFragment({
        messageId: new Uint8Array([0xaa, i]),
        index: 0,
        total: 2,
        data: new Uint8Array(16),
      }, peer);
    }

    expect(reassembler.pendingCount).toBeLessThanOrEqual(16);
  });

  it('C9 + C11: route abuse does not grant unlimited broadcast creation', () => {
    const origin = createIdentity();
    const payload = new Uint8Array([1, 2, 3]);

    for (let i = 0; i < 20; i++) {
      createBroadcastMessage(origin, payload);
    }

    expect(() => createBroadcastMessage(origin, payload)).toThrow('BROADCAST_RATE_LIMITED');
  });
});
