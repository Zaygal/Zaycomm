// src/envelope/fragment.ts
// RFC-0006, Section 5: Fragmentation and Reassembly.
//
// Phase 5's own transport tests proved this is a real, current gap:
// a 220 character message correctly fails to cross the simulated
// Bluetooth transport, because a full encoded envelope simply
// doesn't fit a realistic BLE MTU. This file closes that gap.
//
// Fragmentation is a property of the envelope layer, not any single
// transport adapter (RFC-0006 Section 5), so this has no idea what
// transport it's running over, it only needs an MTU number.

import { concatBytes, bytesToHex } from '../util';
import { Encoder } from 'cbor-x';
import { type Envelope, encodeEnvelope, decodeEnvelope } from './envelope';

const cbor = new Encoder();

const FRAGMENT_OVERHEAD_ESTIMATE = 32;

interface Fragment {
  messageId: Uint8Array;
  fragmentIndex: number;
  fragmentCount: number;
  data: Uint8Array;
}

type EncodedFragmentTuple = [Uint8Array, number, number, Uint8Array];

function encodeFragment(fragment: Fragment): Uint8Array {
  const tuple: EncodedFragmentTuple = [
    fragment.messageId,
    fragment.fragmentIndex,
    fragment.fragmentCount,
    fragment.data,
  ];
  // cbor-x's Encoder reuses an internal buffer across calls for
  // performance. Every other call site in this project uses its
  // result immediately, once. Fragmentation is the first place that
  // encodes many results in a loop and reads them back later, so a
  // copy here is required, not optional, or later fragments corrupt
  // earlier ones sharing the same underlying buffer.
  return Uint8Array.from(cbor.encode(tuple));
}

function decodeFragment(bytes: Uint8Array): Fragment {
  const tuple = cbor.decode(bytes) as EncodedFragmentTuple;
  return {
    messageId: Uint8Array.from(tuple[0]),
    fragmentIndex: tuple[1],
    fragmentCount: tuple[2],
    data: Uint8Array.from(tuple[3]),
  };
}

/**
 * Splits an envelope into ordered, individually-transmittable wire
 * fragments sized to fit under a given transport's MTU. If the
 * envelope already fits, this returns a single fragment, same code
 * path either way, no special case for "small enough" messages.
 */
export function fragmentEnvelope(envelope: Envelope, transportMtu: number): Uint8Array[] {
  const fullBytes = encodeEnvelope(envelope);
  const chunkSize = Math.max(1, transportMtu - FRAGMENT_OVERHEAD_ESTIMATE);
  const fragmentCount = Math.ceil(fullBytes.length / chunkSize);

  const wireFragments: Uint8Array[] = [];
  for (let i = 0; i < fragmentCount; i++) {
    const data = fullBytes.slice(i * chunkSize, (i + 1) * chunkSize);
    wireFragments.push(
      encodeFragment({ messageId: envelope.header.messageId, fragmentIndex: i, fragmentCount, data })
    );
  }
  return wireFragments;
}

/**
 * Accumulates fragments as they arrive, in any order, and reassembles
 * the original envelope once every piece for a given message id has
 * been seen. Multiple in-flight messages are tracked independently by
 * message id, so fragments from different messages interleaving on
 * the wire don't interfere with each other.
 */
export class FragmentReassembler {
  private pending = new Map<
    string,
    { fragmentCount: number; received: Map<number, Uint8Array>; firstSeenAt: number }
  >();

  addFragment(wireFragment: Uint8Array): Envelope | null {
    const fragment = decodeFragment(wireFragment);
    const key = bytesToHex(fragment.messageId);

    let entry = this.pending.get(key);
    if (!entry) {
      entry = { fragmentCount: fragment.fragmentCount, received: new Map(), firstSeenAt: Date.now() };
      this.pending.set(key, entry);
    }
    entry.received.set(fragment.fragmentIndex, fragment.data);

    if (entry.received.size < entry.fragmentCount) {
      return null;
    }

    const parts: Uint8Array[] = [];
    for (let i = 0; i < entry.fragmentCount; i++) {
      const part = entry.received.get(i);
      if (!part) return null;
      parts.push(part);
    }

    this.pending.delete(key);
    return decodeEnvelope(concatBytes(...parts));
  }

  purgeStale(maxAgeMs: number): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.pending) {
      if (now - entry.firstSeenAt > maxAgeMs) {
        this.pending.delete(key);
        purged++;
      }
    }
    return purged;
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
