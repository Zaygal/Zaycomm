// test/store.test.ts

import { describe, it, expect } from 'vitest';
import { StoreForwardQueue } from '../src/storage/store';
import { createDataEnvelope } from '../src/envelope/envelope';

const text = (s: string) => new TextEncoder().encode(s);

function makeEnvelope(ttl = 10) {
  return createDataEnvelope(
    new Uint8Array(8).fill(1),
    { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
    text('queued content'),
    ttl
  );
}

describe('StoreForwardQueue (RFC-0009)', () => {
  it('stores a valid envelope', () => {
    const queue = new StoreForwardQueue();
    const result = queue.store(makeEnvelope(), 'neighborA');
    expect(result.stored).toBe(true);
    expect(queue.size()).toBe(1);
  });

  it('rejects a duplicate message id', () => {
    const queue = new StoreForwardQueue();
    const envelope = makeEnvelope();
    queue.store(envelope, 'neighborA');
    const second = queue.store(envelope, 'neighborA');
    expect(second.stored).toBe(false);
    expect(second.reason).toBe('duplicate');
    expect(queue.size()).toBe(1);
  });

  it('rejects an envelope with an invalid header', () => {
    const queue = new StoreForwardQueue();
    const envelope = makeEnvelope();
    envelope.header.ttl = 0;
    const result = queue.store(envelope, 'neighborA');
    expect(result.stored).toBe(false);
    expect(result.reason).toBe('invalid header');
  });

  it('enforces a per-neighbor quota', () => {
    const queue = new StoreForwardQueue(2, 100);
    expect(queue.store(makeEnvelope(), 'floodyNeighbor').stored).toBe(true);
    expect(queue.store(makeEnvelope(), 'floodyNeighbor').stored).toBe(true);
    const third = queue.store(makeEnvelope(), 'floodyNeighbor');
    expect(third.stored).toBe(false);
    expect(third.reason).toBe('neighbor quota exceeded');
  });

  it("does not let one neighbor exhaust another neighbor's share", () => {
    const queue = new StoreForwardQueue(2, 100);
    queue.store(makeEnvelope(), 'floody');
    queue.store(makeEnvelope(), 'floody');
    queue.store(makeEnvelope(), 'floody');
    const fromOther = queue.store(makeEnvelope(), 'wellBehaved');
    expect(fromOther.stored).toBe(true);
  });

  it('enforces total queue capacity regardless of neighbor', () => {
    const queue = new StoreForwardQueue(100, 2);
    queue.store(makeEnvelope(), 'a');
    queue.store(makeEnvelope(), 'b');
    const third = queue.store(makeEnvelope(), 'c');
    expect(third.stored).toBe(false);
    expect(third.reason).toBe('queue full');
  });

  it('purges expired entries', () => {
    const queue = new StoreForwardQueue();
    const envelope = makeEnvelope();
    queue.store(envelope, 'neighborA');
    envelope.header.timestamp -= 10000;
    const purged = queue.purgeExpired(3600);
    expect(purged).toBe(1);
    expect(queue.size()).toBe(0);
  });

  it('detects local storage corruption via verifyIntegrity', () => {
    const queue = new StoreForwardQueue();
    const envelope = makeEnvelope();
    queue.store(envelope, 'neighborA');
    expect(queue.verifyIntegrity(envelope.header.messageId)).toBe(true);

    envelope.sealedPayload[0] ^= 0xff;
    expect(queue.verifyIntegrity(envelope.header.messageId)).toBe(false);
  });

  it('acknowledge removes an entry and frees its neighbor quota', () => {
    const queue = new StoreForwardQueue(1, 100);
    const envelope = makeEnvelope();
    queue.store(envelope, 'neighborA');
    expect(queue.store(makeEnvelope(), 'neighborA').stored).toBe(false);

    queue.acknowledge(envelope.header.messageId);
    expect(queue.store(makeEnvelope(), 'neighborA').stored).toBe(true);
  });

  it('getSummary exposes only message ids and ttl, never content', () => {
    const queue = new StoreForwardQueue();
    queue.store(makeEnvelope(7), 'neighborA');
    const summary = queue.getSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0].ttlRemaining).toBe(7);
    expect(Object.keys(summary[0])).toEqual(['messageId', 'ttlRemaining']);
  });

  it('getByDestination filters correctly', () => {
    const queue = new StoreForwardQueue();
    const forHintA = createDataEnvelope(
      new Uint8Array(8).fill(1),
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
      text('a')
    );
    const forHintB = createDataEnvelope(
      new Uint8Array(8).fill(2),
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
      text('b')
    );
    queue.store(forHintA, 'x');
    queue.store(forHintB, 'x');

    const results = queue.getByDestination(new Uint8Array(8).fill(1));
    expect(results).toHaveLength(1);
  });
});