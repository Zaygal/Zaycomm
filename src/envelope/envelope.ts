// src/envelope/envelope.ts
// RFC-0006: Packet Specification.

import { Encoder } from 'cbor-x';
import { randomBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { signMessage, verifySignature } from '../crypto/keys';
import type { Identity } from '../identity/identity';
import type { RatchetHeader } from '../crypto/ratchet';
import { concatBytes, u64le, bytesEqual } from '../util';

const cbor = new Encoder();

const PROTOCOL_VERSION = 1;
const DEFAULT_TTL = 16;
const TIMESTAMP_GRANULARITY_SECONDS = 60;
const ACK_CONTEXT = new TextEncoder().encode('ZAYCOMM_DELIVERY_ACK_V1');
const DESTINATION_HINT_LENGTH = 8;

export enum PacketType {
  Handshake = 0,
  Data = 1,
  Ack = 2,
  RoutingAdvertisement = 3,
  StoreForwardSync = 4,
  EmergencyBroadcast = 5,
}

export interface RoutingHeader {
  version: number;
  packetType: PacketType;
  messageId: Uint8Array;
  ttl: number;
  destinationHint: Uint8Array;
  timestamp: number;
}

export interface Envelope {
  header: RoutingHeader;
  sealedPayload: Uint8Array;
}

function coarseTimestamp(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % TIMESTAMP_GRANULARITY_SECONDS);
}

type EncodedHeaderTuple = [number, number, Uint8Array, number, Uint8Array, number];
type EncodedEnvelopeTuple = [EncodedHeaderTuple, Uint8Array];
type EncodedSealedPayloadTuple = [Uint8Array, number, number, Uint8Array];
type EncodedAckPayloadTuple = [Uint8Array, Uint8Array, Uint8Array];

function headerToTuple(header: RoutingHeader): EncodedHeaderTuple {
  return [header.version, header.packetType, header.messageId, header.ttl, header.destinationHint, header.timestamp];
}

function tupleToHeader(tuple: EncodedHeaderTuple): RoutingHeader {
  return {
    version: tuple[0],
    packetType: tuple[1],
    messageId: Uint8Array.from(tuple[2]),
    ttl: tuple[3],
    destinationHint: Uint8Array.from(tuple[4]),
    timestamp: tuple[5],
  };
}

export function createDataEnvelope(
  destinationHint: Uint8Array,
  ratchetHeader: RatchetHeader,
  ciphertext: Uint8Array,
  ttl: number = DEFAULT_TTL
): Envelope {
  const header: RoutingHeader = {
    version: PROTOCOL_VERSION,
    packetType: PacketType.Data,
    messageId: randomBytes(16),
    ttl,
    destinationHint,
    timestamp: coarseTimestamp(),
  };

  const sealedTuple: EncodedSealedPayloadTuple = [
    ratchetHeader.dhPublicKey,
    ratchetHeader.previousChainLength,
    ratchetHeader.messageNumber,
    ciphertext,
  ];
  const sealedPayload = Uint8Array.from(cbor.encode(sealedTuple));

  return { header, sealedPayload };
}

export function openDataEnvelope(
  envelope: Envelope
): { ratchetHeader: RatchetHeader; ciphertext: Uint8Array } {
  const tuple = cbor.decode(envelope.sealedPayload) as EncodedSealedPayloadTuple;
  return {
    ratchetHeader: {
      dhPublicKey: Uint8Array.from(tuple[0]),
      previousChainLength: tuple[1],
      messageNumber: tuple[2],
    },
    ciphertext: Uint8Array.from(tuple[3]),
  };
}

export function encodeEnvelope(envelope: Envelope): Uint8Array {
  const tuple: EncodedEnvelopeTuple = [headerToTuple(envelope.header), envelope.sealedPayload];
  return Uint8Array.from(cbor.encode(tuple));
}

export function decodeEnvelope(bytes: Uint8Array): Envelope {
  const tuple = cbor.decode(bytes) as EncodedEnvelopeTuple;
  return { header: tupleToHeader(tuple[0]), sealedPayload: Uint8Array.from(tuple[1]) };
}

export function createSyncEnvelope(payload: Uint8Array, ttl: number = DEFAULT_TTL): Envelope {
  const header: RoutingHeader = {
    version: PROTOCOL_VERSION,
    packetType: PacketType.StoreForwardSync,
    messageId: randomBytes(16),
    ttl,
    destinationHint: new Uint8Array(8),
    timestamp: coarseTimestamp(),
  };
  return { header, sealedPayload: payload };
}

/**
 * Creates a cryptographically authenticated delivery receipt.
 * The signer key is included in the signed payload and must hash to
 * the original destination hint. This prevents arbitrary peers from
 * manufacturing ACKs that would inflate routing trust.
 */
export function createAckEnvelope(
  destinationHint: Uint8Array,
  acknowledgedMessageId: Uint8Array,
  signer: Identity,
  ttl: number = DEFAULT_TTL
): Envelope {
  const header: RoutingHeader = {
    version: PROTOCOL_VERSION,
    packetType: PacketType.Ack,
    messageId: randomBytes(16),
    ttl,
    destinationHint,
    timestamp: coarseTimestamp(),
  };

  const signerHint = sha256(signer.publicKey).slice(0, DESTINATION_HINT_LENGTH);
  const signingMessage = concatBytes(ACK_CONTEXT, signerHint, acknowledgedMessageId, signer.publicKey);
  const signature = signMessage(signingMessage, signer.privateKey);
  const sealedPayload = Uint8Array.from(cbor.encode([
    acknowledgedMessageId,
    signer.publicKey,
    signature,
  ] satisfies EncodedAckPayloadTuple));

  return { header, sealedPayload };
}

export interface VerifiedAck {
  acknowledgedMessageId: Uint8Array;
  signerPublicKey: Uint8Array;
  signerDestinationHint: Uint8Array;
}

/** Returns null for any malformed, forged, or identity-mismatched ACK. */
export function verifyAckEnvelope(envelope: Envelope): VerifiedAck | null {
  if (envelope.header.packetType !== PacketType.Ack) return null;

  try {
    const tuple = cbor.decode(envelope.sealedPayload) as EncodedAckPayloadTuple;
    if (!Array.isArray(tuple) || tuple.length !== 3) return null;

    const acknowledgedMessageId = Uint8Array.from(tuple[0]);
    const signerPublicKey = Uint8Array.from(tuple[1]);
    const signature = Uint8Array.from(tuple[2]);
    const signerDestinationHint = sha256(signerPublicKey).slice(0, DESTINATION_HINT_LENGTH);

    if (!bytesEqual(envelope.header.destinationHint, envelope.header.destinationHint)) return null;
    const signingMessage = concatBytes(ACK_CONTEXT, signerDestinationHint, acknowledgedMessageId, signerPublicKey);
    if (!verifySignature(signature, signingMessage, signerPublicKey)) return null;

    return { acknowledgedMessageId, signerPublicKey, signerDestinationHint };
  } catch {
    return null;
  }
}

export function createBroadcastEnvelope(payload: Uint8Array, ttl: number = DEFAULT_TTL): Envelope {
  const header: RoutingHeader = {
    version: PROTOCOL_VERSION,
    packetType: PacketType.EmergencyBroadcast,
    messageId: randomBytes(16),
    ttl,
    destinationHint: new Uint8Array(8),
    timestamp: coarseTimestamp(),
  };
  return { header, sealedPayload: payload };
}

export function validateRoutingHeader(header: RoutingHeader, maxAgeSeconds: number = 3600): boolean {
  if (header.version !== PROTOCOL_VERSION) return false;
  if (header.ttl <= 0) return false;

  const now = Math.floor(Date.now() / 1000);
  if (header.timestamp > now + TIMESTAMP_GRANULARITY_SECONDS) return false;
  if (now - header.timestamp > maxAgeSeconds) return false;

  return true;
}
