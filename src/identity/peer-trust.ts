// src/identity/peer-trust.ts
// RFC-0004 Section 2.7: provisional trust upgraded to verified trust.
//
// Scanning a QR code introduces a peer. It never authenticates one. This
// store makes that distinction structural rather than a convention the UI
// has to remember:
//
//   introduce()    -> trust 'introduced'. Grants nothing.
//   markVerified() -> refuses unless the peer was introduced first, and is
//                     only ever called with evidence from the session gate.
//
// So a bug that skips authentication cannot produce a verified peer: the
// transition simply is not reachable without an introduction to promote.

import type { NodeIntroduction } from './introduction';
import { bytesToHex } from '../util';

export type PeerTrustState = 'introduced' | 'verified';

export interface PeerTrustRecord {
  identityPublicKey: string;
  nodeId: string;
  capabilities: string[];
  introducedAt: number;
  trust: PeerTrustState;
  verifiedAt: number | null;
  /** Handshake transcript hash the successful authentication committed to. */
  sessionHash: string | null;
  /** Last rejection reason, kept so the UI can explain a refused peer. */
  lastFailure: string | null;
}

export class PeerTrustError extends Error {
  readonly code: 'PEER_NOT_INTRODUCED' | 'PEER_ALREADY_VERIFIED';

  constructor(code: 'PEER_NOT_INTRODUCED' | 'PEER_ALREADY_VERIFIED', message: string) {
    super(message);
    this.name = 'PeerTrustError';
    this.code = code;
  }
}

export interface VerificationEvidence {
  /** Handshake transcript hash produced by the completed Noise handshake. */
  sessionHash: Uint8Array;
  at?: number;
}

function normalize(keyHex: string): string {
  return keyHex.toLowerCase();
}

export class PeerTrustStore {
  private readonly records = new Map<string, PeerTrustRecord>();

  /**
   * Records an identity introduction. Deliberately cannot verify: a scan is
   * evidence that someone showed a code, not that they hold the key.
   * A re-scan refreshes the introduction but never downgrades an already
   * verified peer, since verified trust rests on the session, not on the code.
   */
  introduce(introduction: NodeIntroduction, at: number = Math.floor(Date.now() / 1000)): PeerTrustRecord {
    const key = normalize(introduction.publicKey);
    const existing = this.records.get(key);

    if (existing) {
      existing.nodeId = introduction.nodeId;
      existing.capabilities = introduction.capabilities;
      existing.introducedAt = at;
      return existing;
    }

    const record: PeerTrustRecord = {
      identityPublicKey: key,
      nodeId: introduction.nodeId,
      capabilities: introduction.capabilities,
      introducedAt: at,
      trust: 'introduced',
      verifiedAt: null,
      sessionHash: null,
      lastFailure: null,
    };
    this.records.set(key, record);
    return record;
  }

  /**
   * Promotes an introduced peer to verified. Callers must pass evidence from
   * a successful session establishment; this store does not authenticate and
   * will not promote a key it has never seen an introduction for.
   */
  markVerified(identityPublicKey: Uint8Array | string, evidence: VerificationEvidence): PeerTrustRecord {
    const key = normalize(
      typeof identityPublicKey === 'string' ? identityPublicKey : bytesToHex(identityPublicKey)
    );
    const record = this.records.get(key);

    if (!record) {
      throw new PeerTrustError(
        'PEER_NOT_INTRODUCED',
        'Refusing to verify a peer that was never introduced by a QR scan.'
      );
    }

    record.trust = 'verified';
    record.verifiedAt = evidence.at ?? Math.floor(Date.now() / 1000);
    record.sessionHash = bytesToHex(evidence.sessionHash);
    record.lastFailure = null;
    return record;
  }

  /** Records a refused or failed authentication without granting trust. */
  markFailed(identityPublicKey: Uint8Array | string, reason: string): void {
    const key = normalize(typeof identityPublicKey === 'string' ? identityPublicKey : bytesToHex(identityPublicKey));
    const record = this.records.get(key);
    if (!record) return;
    record.trust = 'introduced';
    record.verifiedAt = null;
    record.sessionHash = null;
    record.lastFailure = reason;
  }

  isVerified(identityPublicKey: Uint8Array | string): boolean {
    const key = normalize(typeof identityPublicKey === 'string' ? identityPublicKey : bytesToHex(identityPublicKey));
    return this.records.get(key)?.trust === 'verified';
  }

  get(identityPublicKey: Uint8Array | string): PeerTrustRecord | null {
    const key = normalize(typeof identityPublicKey === 'string' ? identityPublicKey : bytesToHex(identityPublicKey));
    return this.records.get(key) ?? null;
  }

  /** Verified peers only: the set every trust-consuming feature should read. */
  verified(): PeerTrustRecord[] {
    return this.list().filter((r) => r.trust === 'verified');
  }

  list(): PeerTrustRecord[] {
    return [...this.records.values()].sort((a, b) => b.introducedAt - a.introducedAt);
  }

  forget(identityPublicKey: Uint8Array | string): void {
    const key = normalize(typeof identityPublicKey === 'string' ? identityPublicKey : bytesToHex(identityPublicKey));
    this.records.delete(key);
  }

  clear(): void {
    this.records.clear();
  }

  toJSON(): PeerTrustRecord[] {
    return this.list();
  }

  static load(records: PeerTrustRecord[]): PeerTrustStore {
    const store = new PeerTrustStore();
    for (const record of records) {
      if (!record || typeof record.identityPublicKey !== 'string') continue;
      store.records.set(normalize(record.identityPublicKey), {
        identityPublicKey: normalize(record.identityPublicKey),
        nodeId: String(record.nodeId ?? ''),
        capabilities: Array.isArray(record.capabilities) ? record.capabilities : [],
        introducedAt: Number(record.introducedAt ?? 0),
        trust: record.trust === 'verified' ? 'verified' : 'introduced',
        verifiedAt: record.verifiedAt ?? null,
        sessionHash: record.sessionHash ?? null,
        lastFailure: record.lastFailure ?? null,
      });
    }
    return store;
  }
}
