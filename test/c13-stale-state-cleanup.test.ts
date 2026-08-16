// test/c13-stale-state-cleanup.test.ts

import { describe, it, expect } from 'vitest';
import { StoreForwardQueue } from '../src/storage/store';
import { createDataEnvelope } from '../src/envelope/envelope';

const text = (s: string) => new TextEncoder().encode(s);

function makeEnvelope(ttl = 10) {
  return createDataEnvelope(
    new Uint8Array(8).fill(1),
    { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
    text('c13 stale-state test'),
    ttl
  );
}

describe('C13 automatic stale-state cleanup', () => {
  it('purges expired store-forward state before a new allocation', () => {
    const queue = new StoreForwardQueue(1, 1);
    const stale = makeEnvelope();
    queue.store(stale, 'old-peer');
    stale.header.timestamp -= 7200;

    const fresh = makeEnvelope();
    const result = queue.store(fresh, 'new-peer');

    expect(result.stored).toBe(true);
    expect(queue.size()).toBe(1);
    expect(queue.has(stale.header.messageId)).toBe(false);
  });

  it('purges expired state before security-sensitive reads', () => {
    const queue = new StoreForwardQueue();
    const stale = makeEnvelope();
    queue.store(stale, 'old-peer');
    stale.header.timestamp -= 7200;

    expect(queue.getSummary()).toHaveLength(0);
    expect(queue.getByIds([stale.header.messageId])).toHaveLength(0);
    expect(queue.verifyIntegrity(stale.header.messageId)).toBe(false);
  });
});
