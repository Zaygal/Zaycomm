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

export function createBroadcastMessage(identity: Identity, content: Uint8Array): BroadcastMessage {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signMessage(buildSigningMessage(content, timestamp), identity.privateKey);
  return { senderPublicKey: identity.publicKey, content, timestamp, signature };
}

export function verifyBroadcastMessage(message: BroadcastMessage): boolean {
  return verifySignature(message.signature, buildSigningMessage(message.content, message.timestamp), message.senderPublicKey);
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