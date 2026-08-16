// src/broadcast/broadcast.ts
// RFC-0006 Section 4, RFC-0001's emergency broadcast goal.
//
// A broadcast has no single recipient, so it can't be encrypted with
// a specific person's double ratchet, there's no "other party" to
// ratchet with. Instead it's signed, same domain-separation pattern
// already used for routing advertisements and device statements, so
// anyone receiving it can verify who actually sent it. Broadcast
// content itself is necessarily public, that's the honest tradeoff
// for something meant to reach everyone.

import { Encoder } from 'cbor-x';
import { signMessage, verifySignature } from '../crypto/keys';
import { concatBytes, u64le } from '../util';
import type { Identity } from '../identity/identity';

const cbor = new Encoder();
const BROADCAST_CONTEXT = 'ZAYCOMM_BROADCAST_V1';

// C11: bound the amount of public traffic a single origin can inject.
// These limits apply independently at each node/process that verifies a
// broadcast, so a malicious origin cannot turn one valid signature into an
// unbounded mesh-wide forwarding stream.
export const MAX_BROADCAST_CONTENT_BYTES = 4096;
export const BROADCAST_RATE_WINDOW_MS = 60 * 1000;
export const MAX_BROADCASTS_PER_ORIGIN_PER_WINDOW = 20;
export const BROADCAST_FORWARD_BUDGET_PER_WINDOW = 20;

export interface BroadcastMessage {
  senderPublicKey: Uint8Array;
  content: Uint8Array;
  timestamp: number;
  signature: Uint8Array;
}

function buildSigningMessage(content: Uint8Array, timestamp: number): Uint8Array {
  const context = new TextEncoder().encode(BROADCAST_CONTEXT);
  return concatBytes(context, u64le(timestamp), content);
}

type RateWindow = { windowStartedAt: number; count: number };
const originRateWindows = new Map<string, RateWindow>();

function consumeOriginBudget(senderPublicKey: Uint8Array, nowMs: number): boolean {
  const key = Buffer.from(senderPublicKey).toString('hex');
  const existing = originRateWindows.get(key);
  if (!existing || nowMs - existing.windowStartedAt >= BROADCAST_RATE_WINDOW_MS) {
    originRateWindows.set(key, { windowStartedAt: nowMs, count: 1 });
    return true;
  }
  if (existing.count >= MAX_BROADCASTS_PER_ORIGIN_PER_WINDOW) return false;
  existing.count++;
  return true;
}

function purgeRateWindows(nowMs: number): void {
  for (const [key, window] of originRateWindows) {
    if (nowMs - window.windowStartedAt >= BROADCAST_RATE_WINDOW_MS) originRateWindows.delete(key);
  }
}

export function createBroadcastMessage(identity: Identity, content: Uint8Array): BroadcastMessage {
  if (content.length > MAX_BROADCAST_CONTENT_BYTES) throw new Error('BROADCAST_PAYLOAD_TOO_LARGE');
  const nowMs = Date.now();
  purgeRateWindows(nowMs);
  if (!consumeOriginBudget(identity.publicKey, nowMs)) throw new Error('BROADCAST_RATE_LIMITED');
  const timestamp = Math.floor(nowMs / 1000);
  const signature = signMessage(buildSigningMessage(content, timestamp), identity.privateKey);
  return { senderPublicKey: identity.publicKey, content, timestamp, signature };
}

export function verifyBroadcastMessage(message: BroadcastMessage): boolean {
  try {
    if (message.senderPublicKey.length !== 32 || message.signature.length !== 64) return false;
    if (message.content.length > MAX_BROADCAST_CONTENT_BYTES) return false;
    if (!Number.isSafeInteger(message.timestamp) || message.timestamp < 0) return false;
    if (!verifySignature(message.signature, buildSigningMessage(message.content, message.timestamp), message.senderPublicKey)) return false;
    const nowMs = Date.now();
    purgeRateWindows(nowMs);
    return consumeOriginBudget(message.senderPublicKey, nowMs);
  } catch {
    return false;
  }
}

type BroadcastTuple = [Uint8Array, Uint8Array, number, Uint8Array];

export function encodeBroadcastMessage(message: BroadcastMessage): Uint8Array {
  const tuple: BroadcastTuple = [message.senderPublicKey, message.content, message.timestamp, message.signature];
  return Uint8Array.from(cbor.encode(tuple));
}

export function decodeBroadcastMessage(bytes: Uint8Array): BroadcastMessage {
  const tuple = cbor.decode(bytes) as BroadcastTuple;
  return {
    senderPublicKey: Uint8Array.from(tuple[0]),
    content: Uint8Array.from(tuple[1]),
    timestamp: tuple[2],
    signature: Uint8Array.from(tuple[3]),
  };
}
