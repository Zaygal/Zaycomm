import { describe, it, expect } from 'vitest';
import { Encoder } from 'cbor-x';
import {
  FragmentReassembler,
  DEFAULT_FRAGMENT_MAX_AGE_MS,
  MAX_PENDING_FRAGMENT_SETS_PER_PEER,
  MAX_PENDING_FRAGMENT_BYTES_PER_PEER,
} from '../src/envelope/fragment';

const cbor = new Encoder();

function fragment(messageIdByte: number, index = 0, count = 2, size = 1): Uint8Array {
  const id = new Uint8Array(16).fill(messageIdByte);
  return Uint8Array.from(cbor.encode([id, index, count, new Uint8Array(size)]));
}

describe('C10 fragment-state exhaustion resistance', () => {
  it('enforces an independent incomplete-set quota per peer', () => {
    const reassembler = new FragmentReassembler();

    for (let i = 0; i < MAX_PENDING_FRAGMENT_SETS_PER_PEER; i++) {
      expect(reassembler.addFragment(fragment(i + 1), 'attacker-a')).toBeNull();
    }

    expect(reassembler.pendingCount()).toBe(MAX_PENDING_FRAGMENT_SETS_PER_PEER);
    expect(reassembler.addFragment(fragment(250), 'attacker-a')).toBeNull();
    expect(reassembler.pendingCount()).toBe(MAX_PENDING_FRAGMENT_SETS_PER_PEER);

    // A different authenticated peer still receives its own bounded allocation.
    expect(reassembler.addFragment(fragment(251), 'attacker-b')).toBeNull();
    expect(reassembler.pendingCount()).toBe(MAX_PENDING_FRAGMENT_SETS_PER_PEER + 1);
  });

  it('enforces a per-peer byte budget independently of the global budget', () => {
    const reassembler = new FragmentReassembler();
    const chunk = 4096;
    const count = Math.floor(MAX_PENDING_FRAGMENT_BYTES_PER_PEER / chunk) + 1;

    for (let i = 0; i < count - 1; i++) {
      expect(reassembler.addFragment(fragment(i + 1, 0, count, chunk), 'attacker')).toBeNull();
    }

    expect(reassembler.addFragment(fragment(250, 0, count, chunk), 'attacker')).toBeNull();
    expect(reassembler.pendingBytesCount()).toBeLessThanOrEqual(MAX_PENDING_FRAGMENT_BYTES_PER_PEER);
  });

  it('does not allow a second peer to claim an existing message ID', () => {
    const reassembler = new FragmentReassembler();
    const id = new Uint8Array(16).fill(77);
    const wire = Uint8Array.from(cbor.encode([id, 0, 2, new Uint8Array([1])]));

    expect(reassembler.addFragment(wire, 'peer-a')).toBeNull();
    expect(reassembler.addFragment(wire, 'peer-b')).toBeNull();
    expect(reassembler.pendingCount()).toBe(1);
    expect(reassembler.pendingBytesCount()).toBe(1);
  });

  it('automatically expires incomplete state during a new allocation attempt', async () => {
    const reassembler = new FragmentReassembler();
    expect(reassembler.addFragment(fragment(88), 'attacker')).toBeNull();
    expect(reassembler.pendingCount()).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, DEFAULT_FRAGMENT_MAX_AGE_MS + 10));

    // addFragment() itself performs cleanup; callers no longer need to remember
    // a separate purge call before accepting another attacker-controlled ID.
    expect(reassembler.addFragment(fragment(89), 'attacker')).toBeNull();
    expect(reassembler.pendingCount()).toBe(1);
  }, DEFAULT_FRAGMENT_MAX_AGE_MS + 1000);
});
