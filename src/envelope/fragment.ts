// src/envelope/fragment.ts
// RFC-0006, Section 5: Fragmentation and Reassembly.

import { concatBytes, bytesToHex } from '../util';
import { Encoder } from 'cbor-x';
import { type Envelope, encodeEnvelope, decodeEnvelope } from './envelope';

const cbor = new Encoder();

const FRAGMENT_OVERHEAD_ESTIMATE = 32;
export const MAX_FRAGMENT_COUNT = 4096;
export const MAX_FRAGMENT_SIZE = 4096;
export const MAX_PENDING_FRAGMENT_SETS = 128;
export const MAX_PENDING_FRAGMENT_BYTES = 2 * 1024 * 1024;

// C10: incomplete fragment state must have a bounded lifetime and must be
// attributable to a source when the transport provides authenticated peer IDs.
export const DEFAULT_FRAGMENT_MAX_AGE_MS = 30 * 1000;
export const MAX_PENDING_FRAGMENT_SETS_PER_PEER = 16;
export const MAX_PENDING_FRAGMENT_BYTES_PER_PEER = 256 * 1024;

interface Fragment {
  messageId: Uint8Array;
  fragmentIndex: number;
  fragmentCount: number;
  data: Uint8Array;
}

type EncodedFragmentTuple = [Uint8Array, number, number, Uint8Array];

type PendingEntry = {
  fragmentCount: number;
  received: Map<number, Uint8Array>;
  firstSeenAt: number;
  bytes: number;
  peerId: string;
};

function encodeFragment(fragment: Fragment): Uint8Array {
  const tuple: EncodedFragmentTuple = [fragment.messageId, fragment.fragmentIndex, fragment.fragmentCount, fragment.data];
  return Uint8Array.from(cbor.encode(tuple));
}

function decodeFragment(bytes: Uint8Array): Fragment {
  const tuple = cbor.decode(bytes) as EncodedFragmentTuple;
  if (!Array.isArray(tuple) || tuple.length !== 4) throw new Error('Invalid fragment');
  const messageId = Uint8Array.from(tuple[0]);
  const fragmentIndex = tuple[1];
  const fragmentCount = tuple[2];
  const data = Uint8Array.from(tuple[3]);
  if (messageId.length !== 16) throw new Error('Invalid fragment message ID');
  if (!Number.isSafeInteger(fragmentIndex) || !Number.isSafeInteger(fragmentCount)) throw new Error('Invalid fragment indexes');
  if (fragmentCount < 1 || fragmentCount > MAX_FRAGMENT_COUNT) throw new Error('Fragment count exceeds limit');
  if (fragmentIndex < 0 || fragmentIndex >= fragmentCount) throw new Error('Invalid fragment index');
  if (data.length > MAX_FRAGMENT_SIZE) throw new Error('Fragment size exceeds limit');
  return { messageId, fragmentIndex, fragmentCount, data };
}

export function fragmentEnvelope(envelope: Envelope, transportMtu: number): Uint8Array[] {
  const fullBytes = encodeEnvelope(envelope);
  const chunkSize = Math.max(1, transportMtu - FRAGMENT_OVERHEAD_ESTIMATE);
  const fragmentCount = Math.ceil(fullBytes.length / chunkSize);
  if (fragmentCount > MAX_FRAGMENT_COUNT) throw new Error('Envelope requires too many fragments');
  const wireFragments: Uint8Array[] = [];
  for (let i = 0; i < fragmentCount; i++) {
    const data = fullBytes.slice(i * chunkSize, (i + 1) * chunkSize);
    wireFragments.push(encodeFragment({ messageId: envelope.header.messageId, fragmentIndex: i, fragmentCount, data }));
  }
  return wireFragments;
}

export class FragmentReassembler {
  private pending = new Map<string, PendingEntry>();
  private pendingBytes = 0;
  private peerPendingSets = new Map<string, number>();
  private peerPendingBytes = new Map<string, number>();

  /**
   * Add one fragment. peerId should be the authenticated transport/session
   * identity whenever the caller has one. The default keeps the low-level
   * RFC-0006 primitive backwards-compatible for standalone reassembly tests.
   */
  addFragment(wireFragment: Uint8Array, peerId: string = 'unknown'): Envelope | null {
    // C10: cleanup happens on the allocation path, so callers cannot forget
    // to invoke purgeStale() before an attacker starts another allocation wave.
    this.purgeStale(DEFAULT_FRAGMENT_MAX_AGE_MS);

    if (wireFragment.length > MAX_FRAGMENT_SIZE + FRAGMENT_OVERHEAD_ESTIMATE + 64) return null;
    let fragment: Fragment;
    try {
      fragment = decodeFragment(wireFragment);
    } catch {
      return null;
    }

    const key = bytesToHex(fragment.messageId);
    let entry = this.pending.get(key);

    if (!entry) {
      const peerSets = this.peerPendingSets.get(peerId) ?? 0;
      const peerBytes = this.peerPendingBytes.get(peerId) ?? 0;
      if (this.pending.size >= MAX_PENDING_FRAGMENT_SETS) return null;
      if (peerSets >= MAX_PENDING_FRAGMENT_SETS_PER_PEER) return null;
      if (fragment.data.length > MAX_PENDING_FRAGMENT_BYTES) return null;
      if (peerBytes + fragment.data.length > MAX_PENDING_FRAGMENT_BYTES_PER_PEER) return null;

      entry = {
        fragmentCount: fragment.fragmentCount,
        received: new Map(),
        firstSeenAt: Date.now(),
        bytes: 0,
        peerId,
      };
      this.pending.set(key, entry);
      this.peerPendingSets.set(peerId, peerSets + 1);
    } else if (entry.fragmentCount !== fragment.fragmentCount || entry.peerId !== peerId) {
      // C10: the same message ID cannot be claimed by another peer.
      return null;
    }

    if (entry.received.has(fragment.fragmentIndex)) return null;

    const peerBytes = this.peerPendingBytes.get(peerId) ?? 0;
    if (this.pendingBytes + fragment.data.length > MAX_PENDING_FRAGMENT_BYTES) return null;
    if (peerBytes + fragment.data.length > MAX_PENDING_FRAGMENT_BYTES_PER_PEER) return null;

    entry.received.set(fragment.fragmentIndex, fragment.data);
    entry.bytes += fragment.data.length;
    this.pendingBytes += fragment.data.length;
    this.peerPendingBytes.set(peerId, peerBytes + fragment.data.length);

    if (entry.received.size < entry.fragmentCount) return null;

    const parts: Uint8Array[] = [];
    for (let i = 0; i < entry.fragmentCount; i++) {
      const part = entry.received.get(i);
      if (!part) return null;
      parts.push(part);
    }

    this.removeEntry(key, entry);

    try {
      return decodeEnvelope(concatBytes(...parts));
    } catch {
      return null;
    }
  }

  private removeEntry(key: string, entry: PendingEntry): void {
    this.pending.delete(key);
    this.pendingBytes -= entry.bytes;

    const sets = this.peerPendingSets.get(entry.peerId) ?? 0;
    if (sets <= 1) this.peerPendingSets.delete(entry.peerId);
    else this.peerPendingSets.set(entry.peerId, sets - 1);

    const bytes = this.peerPendingBytes.get(entry.peerId) ?? 0;
    const remaining = bytes - entry.bytes;
    if (remaining <= 0) this.peerPendingBytes.delete(entry.peerId);
    else this.peerPendingBytes.set(entry.peerId, remaining);
  }

  purgeStale(maxAgeMs: number = DEFAULT_FRAGMENT_MAX_AGE_MS): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.pending) {
      if (now - entry.firstSeenAt > maxAgeMs) {
        this.removeEntry(key, entry);
        purged++;
      }
    }
    return purged;
  }

  pendingCount(): number { return this.pending.size; }
  pendingBytesCount(): number { return this.pendingBytes; }
}
