// src/storage/store.ts
// RFC-0009: Storage Layer, the store and forward relay queue (Section
// 1's second category), the piece that makes RFC-0007 Section 2's
// "store, carry, and forward" model actually hold data.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesEqual, bytesToHex } from '../util';
import { type Envelope, encodeEnvelope, validateRoutingHeader } from '../envelope/envelope';

interface StoredEnvelope {
  envelope: Envelope;
  receivedFrom: string;
  storedAt: number;
  integrityHash: Uint8Array;
}

export interface StoreResult {
  stored: boolean;
  reason?: 'duplicate' | 'invalid header' | 'queue full' | 'neighbor quota exceeded';
}

export interface QueueSummaryEntry {
  messageId: Uint8Array;
  ttlRemaining: number;
}

export class StoreForwardQueue {
  private entries = new Map<string, StoredEnvelope>();
  private perNeighborCount = new Map<string, number>();

  constructor(
    private readonly maxPerNeighbor: number = 50,
    private readonly maxTotal: number = 200
  ) {}

  /**
   * Validates the header, rejects duplicates by message id (RFC-0009
   * Section 7), and enforces both a total capacity limit and a
   * per-neighbor share, directly addressing the storage exhaustion
   * and flooding threats in RFC-0002's catalog.
   */
  store(envelope: Envelope, receivedFrom: string): StoreResult {
    if (!validateRoutingHeader(envelope.header)) {
      return { stored: false, reason: 'invalid header' };
    }

    const key = bytesToHex(envelope.header.messageId);
    if (this.entries.has(key)) {
      return { stored: false, reason: 'duplicate' };
    }

    if (this.entries.size >= this.maxTotal) {
      return { stored: false, reason: 'queue full' };
    }

    const neighborCount = this.perNeighborCount.get(receivedFrom) ?? 0;
    if (neighborCount >= this.maxPerNeighbor) {
      return { stored: false, reason: 'neighbor quota exceeded' };
    }

    const integrityHash = sha256(encodeEnvelope(envelope));
    this.entries.set(key, {
      envelope,
      receivedFrom,
      storedAt: Math.floor(Date.now() / 1000),
      integrityHash,
    });
    this.perNeighborCount.set(receivedFrom, neighborCount + 1);
    return { stored: true };
  }

  /**
   * Detects local storage corruption (RFC-0009 Section 3), distinct
   * from the AEAD tamper detection that happens at decryption time,
   * this catches damage (a failing disk, say) before wasting a
   * forwarding attempt on data already known to be bad.
   */
  verifyIntegrity(messageId: Uint8Array): boolean {
    const entry = this.entries.get(bytesToHex(messageId));
    if (!entry) return false;
    const currentHash = sha256(encodeEnvelope(entry.envelope));
    return bytesEqual(currentHash, entry.integrityHash);
  }

  /** Purges anything expired or older than maxAgeSeconds (RFC-0009 Section 4). */
  purgeExpired(maxAgeSeconds: number = 3600): number {
    let purged = 0;
    for (const [key, entry] of this.entries) {
      if (!validateRoutingHeader(entry.envelope.header, maxAgeSeconds)) {
        this.removeByKey(key);
        purged++;
      }
    }
    return purged;
  }

  /** Early garbage collection once delivery is confirmed (RFC-0007 Section 7). */
  acknowledge(messageId: Uint8Array): void {
    this.removeByKey(bytesToHex(messageId));
  }

  private removeByKey(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      const count = this.perNeighborCount.get(entry.receivedFrom) ?? 0;
      this.perNeighborCount.set(entry.receivedFrom, Math.max(0, count - 1));
    }
    this.entries.delete(key);
  }

  has(messageId: Uint8Array): boolean {
    return this.entries.has(bytesToHex(messageId));
  }

  size(): number {
    return this.entries.size;
  }

  /** Bounded summary for peer sync (RFC-0009 Section 6): ids and TTL only, never content. */
  getSummary(): QueueSummaryEntry[] {
    return Array.from(this.entries.values()).map((e) => ({
      messageId: e.envelope.header.messageId,
      ttlRemaining: e.envelope.header.ttl,
    }));
  }

    getByDestination(destinationHint: Uint8Array): Envelope[] {
    const hex = bytesToHex(destinationHint);
    return Array.from(this.entries.values())
      .filter((e) => bytesToHex(e.envelope.header.destinationHint) === hex)
      .map((e) => e.envelope);
  }

  /** Fetches specific envelopes by message id, used to answer a sync
   * peer's request for exactly what it's missing (RFC-0009 Section 6). */
  getByIds(messageIds: Uint8Array[]): Envelope[] {
    const idSet = new Set(messageIds.map(bytesToHex));
    return Array.from(this.entries.values())
      .filter((e) => idSet.has(bytesToHex(e.envelope.header.messageId)))
      .map((e) => e.envelope);
  }
}
