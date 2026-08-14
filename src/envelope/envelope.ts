// src/envelope/envelope.ts
// RFC-0006: Packet Specification.
//
// Every unit of data moving through the mesh is wrapped in an
// envelope with two parts: a routing header that relays are allowed
// to read (version, packet type, TTL, a destination hint, a coarse
// timestamp), and a sealed payload that relays cannot read at all.
//
// Wire encoding is positional (CBOR arrays), not named objects. An
// earlier version used string keys ("dhPublicKey", "ciphertext", and
// so on), which turned out to add enough overhead that even a two
// character message couldn't fit a realistic Bluetooth Low Energy
// MTU, discovered by the transport layer tests in RFC-0008's phase,
// not assumed away. Both sides already agree on field order from the
// code itself, so the names never need to travel on the wire at all.
//
// Scoping note: full sender-sealing (RFC-0004 Section 4) needs actual
// identity keys, which is identity.ts, RFC-0005, built but not yet
// wired into this layer. For now the sealed payload carries the
// ratchet's own ephemeral key as an implicit reference.

import { Encoder } from 'cbor-x';
import { randomBytes } from '@noble/hashes/utils.js';
import type { RatchetHeader } from '../crypto/ratchet';

const cbor = new Encoder();

const PROTOCOL_VERSION = 1;
const DEFAULT_TTL = 16;
const TIMESTAMP_GRANULARITY_SECONDS = 60;

export enum PacketType {
  Handshake = 0,
  Data = 1,
  Ack = 2,
  RoutingAdvertisement = 3,
  StoreForwardSync = 4,
  EmergencyBroadcast = 5,
}

/** Visible to every relay, per RFC-0006 Section 2.1. */
export interface RoutingHeader {
  version: number;
  packetType: PacketType;
  messageId: Uint8Array;
  ttl: number;
  destinationHint: Uint8Array;
  timestamp: number;
}

/** The full packet as it exists on the wire. */
export interface Envelope {
  header: RoutingHeader;
  sealedPayload: Uint8Array;
}

function coarseTimestamp(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % TIMESTAMP_GRANULARITY_SECONDS);
}

/** Positional tuple form of RoutingHeader, no field names on the wire. */
type EncodedHeaderTuple = [
  number,
  number,
  Uint8Array,
  number,
  Uint8Array,
  number
];

/** Positional tuple form of the full envelope. */
type EncodedEnvelopeTuple = [EncodedHeaderTuple, Uint8Array];

/** Positional tuple form of a ratchet header plus ciphertext. */
type EncodedSealedPayloadTuple = [
  Uint8Array,
  number,
  number,
  Uint8Array
];

function headerToTuple(header: RoutingHeader): EncodedHeaderTuple {
  return [
    header.version,
    header.packetType,
    header.messageId,
    header.ttl,
    header.destinationHint,
    header.timestamp,
  ];
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

/**
 * Wraps one ratchet-encrypted message into a Data envelope. The
 * sealed payload here is exactly what RFC-0006 Section 2.2 describes:
 * opaque to every relay, only the recipient's ratchet can make sense
 * of it.
 */
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

/**
 * The recipient-side mirror of createDataEnvelope: unwraps a Data
 * envelope back into the ratchet header and ciphertext, ready to
 * hand to DoubleRatchet.decrypt().
 */
export function openDataEnvelope(
  envelope: Envelope
): {
  ratchetHeader: RatchetHeader;
  ciphertext: Uint8Array;
} {
  const tuple = cbor.decode(
    envelope.sealedPayload
  ) as EncodedSealedPayloadTuple;

  return {
    ratchetHeader: {
      dhPublicKey: tuple[0],
      previousChainLength: tuple[1],
      messageNumber: tuple[2],
    },
    ciphertext: tuple[3],
  };
}

/** Serializes a full envelope for actual transmission over a transport. */
export function encodeEnvelope(envelope: Envelope): Uint8Array {
  const tuple: EncodedEnvelopeTuple = [
    headerToTuple(envelope.header),
    envelope.sealedPayload,
  ];

  return Uint8Array.from(cbor.encode(tuple));
}

/** The transport-receiving mirror of encodeEnvelope. */
export function decodeEnvelope(bytes: Uint8Array): Envelope {
  const tuple = cbor.decode(bytes) as EncodedEnvelopeTuple;

  return {
    header: tupleToHeader(tuple[0]),
    sealedPayload: Uint8Array.from(tuple[1]),
  };
}

/**
 * Wraps a pre-encoded sync sub-message (summary, request, or
 * transfer, RFC-0009 Section 6) as a StoreForwardSync packet. Sync
 * is always point-to-point between directly connected transport
 * neighbors, never routed multi-hop, so destinationHint is unused
 * here. A future relay-to-relay sync across the mesh would need real
 * addressing, deferred rather than half-built now.
 */
export function createSyncEnvelope(
  payload: Uint8Array,
  ttl: number = DEFAULT_TTL
): Envelope {
  const header: RoutingHeader = {
    version: PROTOCOL_VERSION,
    packetType: PacketType.StoreForwardSync,
    messageId: randomBytes(16),
    ttl,
    destinationHint: new Uint8Array(8),
    timestamp: coarseTimestamp(),
  };

  return {
    header,
    sealedPayload: payload,
  };
}

/**
 * RFC-0006 Section 4, RFC-0007 Section 7: acknowledges receipt of a
 * specific message id, addressed back to whoever should learn their
 * message arrived. Uses the exact same point-to-point routing as any
 * Data packet, no special casing needed at the transport or routing
 * layer.
 */
export function createAckEnvelope(
  destinationHint: Uint8Array,
  acknowledgedMessageId: Uint8Array,
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

  return {
    header,
    sealedPayload: acknowledgedMessageId,
  };
}

/**
 * Wraps a signed broadcast payload (RFC-0006 Section 4, RFC-0001's
 * emergency broadcast goal). No single destination, everyone is a
 * recipient, so destinationHint is unused here, same convention as
 * sync packets.
 */
export function createBroadcastEnvelope(
  payload: Uint8Array,
  ttl: number = DEFAULT_TTL
): Envelope {
  const header: RoutingHeader = {
    version: PROTOCOL_VERSION,
    packetType: PacketType.EmergencyBroadcast,
    messageId: randomBytes(16),
    ttl,
    destinationHint: new Uint8Array(8),
    timestamp: coarseTimestamp(),
  };

  return {
    header,
    sealedPayload: payload,
  };
}

/**
 * Validation order from RFC-0006 Section 7: version first, then TTL
 * and freshness, before anything else is trusted. Returns false
 * rather than throwing, receiving an invalid packet from the network
 * is an expected, routine event, not a bug in your own code, per the
 * fail-closed principle in RFC-0001 Section 5.
 */
export function validateRoutingHeader(
  header: RoutingHeader,
  maxAgeSeconds: number = 3600
): boolean {
  if (header.version !== PROTOCOL_VERSION) return false;
  if (header.ttl <= 0) return false;

  const now = Math.floor(Date.now() / 1000);

  if (header.timestamp > now + TIMESTAMP_GRANULARITY_SECONDS) {
    return false;
  }

  if (now - header.timestamp > maxAgeSeconds) {
    return false;
  }

  return true;
