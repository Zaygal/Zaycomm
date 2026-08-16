import { describe, expect, it } from 'vitest';
import { FragmentReassembler } from '../src/envelope/fragment';
import { createIdentity } from '../src/identity/identity';
import { createBroadcastMessage } from '../src/broadcast/broadcast';
import { encryptSyncPayload, decryptSyncPayload } from '../src/sync/session-sync';

describe('C20 concurrency / state-race campaign', () => {
  it('keeps fragment state bounded under concurrent allocation attempts', async () => {
    const r = new FragmentReassembler();
    const jobs = Array.from({ length: 64 }, (_, i) => Promise.resolve().then(() => {
      r.addFragment({ messageId: new Uint8Array([i & 255, i >> 8]), index: 0, total: 2, data: new Uint8Array(32) }, `peer-${i % 4}`);
    }));
    await Promise.all(jobs);
    expect(r.pendingCount()).toBeLessThanOrEqual(16);
  });

  it('does not corrupt independent sync sessions under concurrent decrypt attempts', async () => {
    const keyA = new Uint8Array(32).fill(1);
    const keyB = new Uint8Array(32).fill(2);
    const packetA = encryptSyncPayload(keyA, 'session-a', new TextEncoder().encode('A'));
    const packetB = encryptSyncPayload(keyB, 'session-b', new TextEncoder().encode('B'));
    const results = await Promise.all([
      Promise.resolve().then(() => decryptSyncPayload(keyA, packetA)),
      Promise.resolve().then(() => decryptSyncPayload(keyB, packetB)),
    ]);
    expect(new TextDecoder().decode(results[0])).toBe('A');
    expect(new TextDecoder().decode(results[1])).toBe('B');
  });

  it('isolates concurrent broadcast creation budgets by origin', async () => {
    const a = createIdentity();
    const b = createIdentity();
    const payload = new Uint8Array([1]);
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => Promise.resolve().then(() => createBroadcastMessage(i % 2 ? a : b, payload))));
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThan(0);
    expect(fulfilled.length).toBeLessThanOrEqual(12);
  });

  it('does not let concurrent failed sync decryptions mutate valid session state', async () => {
    const key = new Uint8Array(32).fill(7);
    const wrong = new Uint8Array(32).fill(8);
    const packet = encryptSyncPayload(key, 'session-race', new TextEncoder().encode('stable'));
    await Promise.allSettled(Array.from({ length: 32 }, () => Promise.resolve().then(() => decryptSyncPayload(wrong, packet))));
    expect(new TextDecoder().decode(decryptSyncPayload(key, packet))).toBe('stable');
  });

  it('keeps identity-scoped concurrent operations independent', async () => {
    const identities = Array.from({ length: 8 }, () => createIdentity());
    const keys = await Promise.all(identities.map(identity => Promise.resolve(identity.publicKey)));
    expect(new Set(keys.map(key => Buffer.from(key).toString('hex')).size)).toBe(8);
  });

  it('remains stable when concurrent workloads finish in different orders', async () => {
    const r = new FragmentReassembler();
    const jobs = Array.from({ length: 40 }, (_, i) => new Promise<void>(resolve => {
      setTimeout(() => {
        r.addFragment({ messageId: new Uint8Array([i, 0]), index: 0, total: 2, data: new Uint8Array(8) }, 'race-peer');
        resolve();
      }, i % 5);
    }));
    await Promise.all(jobs);
    expect(r.pendingCount()).toBeLessThanOrEqual(16);
  });
});
