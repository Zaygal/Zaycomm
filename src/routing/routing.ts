// src/routing/routing.ts
// RFC-0007, Sections 2, 4, and 5, plus RFC-0009 Section 6.
//
// Sends real bytes through a Transport (RFC-0008) instead of one
// node calling another directly in-process. The sender only ever
// sees its own local outcome, not a full downstream path, that
// matches real transport constraints and RFC-0002's metadata
// minimization: a node should only know its own immediate neighbor.
// Observe actual delivery via onDelivered() at the destination.
//
// Also implements gateway-to-gateway sync (RFC-0009 Section 6): a
// three-message exchange, summary, request, transfer, so two nodes
// with overlapping queues never redundantly resend what the other
// side already has.

import { sha256 } from '@noble/hashes/sha2.js';
import { Encoder } from 'cbor-x';
import { signMessage, verifySignature } from '../crypto/keys';
import type { Identity } from '../identity/identity';
import {
  type Envelope,
  PacketType,
  validateRoutingHeader,
  encodeEnvelope,
  decodeEnvelope,
  createSyncEnvelope,
} from '../envelope/envelope';
import { concatBytes, bytesEqual, bytesToHex, u64le } from '../util';
import { StoreForwardQueue } from '../storage/store';
import type { Transport } from '../transport/transport';

const cbor = new Encoder();

const ROUTING_AD_CONTEXT = 'ZAYCOMM_ROUTING_AD_V1';
const DESTINATION_HINT_LENGTH = 8;

export function computeDestinationHint(publicKey: Uint8Array): Uint8Array {
  return sha256(publicKey).slice(0, DESTINATION_HINT_LENGTH);
}

export interface RoutingAdvertisement {
  advertiserPublicKey: Uint8Array;
  reachableDestinations: Uint8Array[];
  timestamp: number;
  signature: Uint8Array;
}

function buildAdvertisementMessage(reachableDestinations: Uint8Array[], timestamp: number): Uint8Array {
  const context = new TextEncoder().encode(ROUTING_AD_CONTEXT);
  return concatBytes(context, u64le(timestamp), ...reachableDestinations);
}

export function createRoutingAdvertisement(
  identity: Identity,
  reachableDestinations: Uint8Array[]
): RoutingAdvertisement {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = buildAdvertisementMessage(reachableDestinations, timestamp);
  const signature = signMessage(message, identity.privateKey);
  return { advertiserPublicKey: identity.publicKey, reachableDestinations, timestamp, signature };
}

export function verifyRoutingAdvertisement(ad: RoutingAdvertisement): boolean {
  const message = buildAdvertisementMessage(ad.reachableDestinations, ad.timestamp);
  return verifySignature(ad.signature, message, ad.advertiserPublicKey);
}

class RoutingTable {
  private routes = new Map<string, string>();

  learnFromAdvertisement(fromNeighborId: string, ad: RoutingAdvertisement): void {
    if (!verifyRoutingAdvertisement(ad)) return;
    for (const hint of ad.reachableDestinations) {
      this.routes.set(bytesToHex(hint), fromNeighborId);
    }
  }

  lookup(destinationHint: Uint8Array): string | null {
    return this.routes.get(bytesToHex(destinationHint)) ?? null;
  }

  hasRoute(destinationHint: Uint8Array): boolean {
    return this.routes.has(bytesToHex(destinationHint));
  }
}

export type DeliveryResult =
  | { outcome: 'delivered'; envelope: Envelope }
  | { outcome: 'forwarded'; to: string }
  | { outcome: 'queued' }
  | { outcome: 'dropped'; reason: string };

// Sync sub-message shapes (RFC-0009 Section 6). Positional, like
// everything else on the wire, kind 0 = summary, 1 = request, 2 = transfer.
type SyncSummaryEntry = [Uint8Array, number];
type SyncPayloadTuple = [0, SyncSummaryEntry[]] | [1, Uint8Array[]] | [2, Uint8Array[]];

export class RelayNode {
  readonly id: string;
  readonly identity: Identity;
  readonly transport: Transport;
  private readonly routingTable = new RoutingTable();
  private readonly queue = new StoreForwardQueue();
  private readonly ownDestinationHint: Uint8Array;
  private deliveryListeners: ((envelope: Envelope) => void)[] = [];

  constructor(id: string, identity: Identity, transport: Transport) {
    this.id = id;
    this.identity = identity;
    this.transport = transport;
    this.ownDestinationHint = computeDestinationHint(identity.publicKey);
    this.transport.onReceive((fromNeighborId, frame) => {
      const envelope = decodeEnvelope(frame);
      this.receiveEnvelope(envelope, fromNeighborId);
    });
  }

  onDelivered(listener: (envelope: Envelope) => void): void {
    this.deliveryListeners.push(listener);
  }

  hasRoute(destinationHint: Uint8Array): boolean {
    return this.routingTable.hasRoute(destinationHint);
  }

  queueSize(): number {
    return this.queue.size();
  }

  receiveAdvertisement(fromNeighborId: string, ad: RoutingAdvertisement): void {
    this.routingTable.learnFromAdvertisement(fromNeighborId, ad);
    for (const hint of ad.reachableDestinations) {
      this.attemptQueuedDelivery(hint);
    }
  }

  private attemptQueuedDelivery(destinationHint: Uint8Array): void {
    const nextHopId = this.routingTable.lookup(destinationHint);
    if (!nextHopId) return;
    for (const envelope of this.queue.getByDestination(destinationHint)) {
      const sent = this.forwardOverTransport(envelope, nextHopId);
      if (sent) this.queue.acknowledge(envelope.header.messageId);
    }
  }

  private forwardOverTransport(envelope: Envelope, nextHopId: string): boolean {
    const forwardedEnvelope: Envelope = {
      header: { ...envelope.header, ttl: envelope.header.ttl - 1 },
      sealedPayload: envelope.sealedPayload,
    };
    return this.transport.send(nextHopId, encodeEnvelope(forwardedEnvelope));
  }

  /**
   * Kicks off a sync handshake with a directly connected neighbor,
   * sending our own queue summary. When to call this, "whenever a
   * node gains Internet connectivity" per RFC-0003 Section 5, is an
   * application/session-lifecycle decision, deliberately left to the
   * caller rather than hardcoded here.
   */
  initiateSync(neighborId: string): void {
    const entries: SyncSummaryEntry[] = this.queue.getSummary().map((e) => [e.messageId, e.ttlRemaining]);
    const tuple: SyncPayloadTuple = [0, entries];
    const summaryEnvelope = createSyncEnvelope(Uint8Array.from(cbor.encode(tuple)));
    this.transport.send(neighborId, encodeEnvelope(summaryEnvelope));
  }

  private handleSyncPacket(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    if (!fromNodeId) {
      return { outcome: 'dropped', reason: 'sync packet with no sender' };
    }

    const tuple = cbor.decode(envelope.sealedPayload) as SyncPayloadTuple;

    if (tuple[0] === 0) {
      // Summary received: request whatever we don't already have.
      const missingIds = tuple[1].filter(([id]) => !this.queue.has(id)).map(([id]) => id);
      if (missingIds.length > 0) {
        const requestTuple: SyncPayloadTuple = [1, missingIds];
        const requestEnvelope = createSyncEnvelope(Uint8Array.from(cbor.encode(requestTuple)));
        this.transport.send(fromNodeId, encodeEnvelope(requestEnvelope));
      }
      return { outcome: 'delivered', envelope };
    }

    if (tuple[0] === 1) {
      // Request received: send back exactly what was asked for, nothing more.
      const requested = this.queue.getByIds(tuple[1]);
      const wireEnvelopes = requested.map((e) => Uint8Array.from(encodeEnvelope(e)));
      const transferTuple: SyncPayloadTuple = [2, wireEnvelopes];
      const transferEnvelope = createSyncEnvelope(Uint8Array.from(cbor.encode(transferTuple)));
      this.transport.send(fromNodeId, encodeEnvelope(transferEnvelope));
      return { outcome: 'delivered', envelope };
    }

    // Transfer received: feed each envelope through normal processing,
    // the existing dedup, TTL, and quota logic all still apply, no
    // special-cased storage path for synced messages.
    for (const wireBytes of tuple[1]) {
      const syncedEnvelope = decodeEnvelope(wireBytes);
      this.receiveEnvelope(syncedEnvelope, fromNodeId);
    }
    return { outcome: 'delivered', envelope };
  }

  /**
   * The core relay decision, RFC-0007 Sections 2 and 4. Still never
   * touches envelope.sealedPayload for Data packets, only the header.
   */
  receiveEnvelope(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    if (!validateRoutingHeader(envelope.header)) {
      return { outcome: 'dropped', reason: 'invalid header' };
    }

    if (envelope.header.packetType === PacketType.StoreForwardSync) {
      return this.handleSyncPacket(envelope, fromNodeId);
    }

    if (bytesEqual(envelope.header.destinationHint, this.ownDestinationHint)) {
      for (const listener of this.deliveryListeners) listener(envelope);
      return { outcome: 'delivered', envelope };
    }

    if (envelope.header.ttl <= 0) {
      return { outcome: 'dropped', reason: 'ttl expired' };
    }

    const nextHopId = this.routingTable.lookup(envelope.header.destinationHint);
    if (nextHopId) {
      const sent = this.forwardOverTransport(envelope, nextHopId);
      if (sent) return { outcome: 'forwarded', to: nextHopId };
    }

    const result = this.queue.store(envelope, fromNodeId ?? 'origin');
    if (result.stored) {
      return { outcome: 'queued' };
    }
    return { outcome: 'dropped', reason: result.reason ?? 'unknown' };
  }
}
