// src/routing/routing.ts
// RFC-0007, Sections 2, 4, and 5: routing advertisements, multi-hop
// forwarding, and now store-and-forward, RFC-0007 Section 2's
// "store, carry, and forward" model. A relay no longer just drops a
// message it has no live route for, it queues it (src/storage/store.ts)
// and automatically retries delivery the moment a route becomes known,
// whenever the next routing advertisement teaches it one.

import { sha256 } from '@noble/hashes/sha2.js';
import { signMessage, verifySignature } from '../crypto/keys';
import type { Identity } from '../identity/identity';
import { type Envelope, validateRoutingHeader } from '../envelope/envelope';
import { concatBytes, bytesEqual, bytesToHex, u64le } from '../util';
import { StoreForwardQueue } from '../storage/store';

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
  | { outcome: 'delivered'; envelope: Envelope; path: string[] }
  | { outcome: 'queued'; path: string[] }
  | { outcome: 'dropped'; reason: string; path: string[] };

export class RelayNode {
  readonly id: string;
  readonly identity: Identity;
  private readonly neighbors = new Map<string, RelayNode>();
  private readonly routingTable = new RoutingTable();
  private readonly queue = new StoreForwardQueue();
  private readonly ownDestinationHint: Uint8Array;

  constructor(id: string, identity: Identity) {
    this.id = id;
    this.identity = identity;
    this.ownDestinationHint = computeDestinationHint(identity.publicKey);
  }

  connectNeighbor(neighbor: RelayNode): void {
    this.neighbors.set(neighbor.id, neighbor);
  }

  hasRoute(destinationHint: Uint8Array): boolean {
    return this.routingTable.hasRoute(destinationHint);
  }

  queueSize(): number {
    return this.queue.size();
  }

  /**
   * Learns a route, then immediately checks the local queue for
   * anything addressed to a newly reachable destination, this is the
   * actual "forward" half of "store, carry, and forward": no resend
   * from the original sender required, delivery happens the moment a
   * path appears.
   */
  receiveAdvertisement(fromNeighborId: string, ad: RoutingAdvertisement): DeliveryResult[] {
    this.routingTable.learnFromAdvertisement(fromNeighborId, ad);
    const results: DeliveryResult[] = [];
    for (const hint of ad.reachableDestinations) {
      results.push(...this.attemptQueuedDelivery(hint));
    }
    return results;
  }

  private attemptQueuedDelivery(destinationHint: Uint8Array): DeliveryResult[] {
    const nextHopId = this.routingTable.lookup(destinationHint);
    if (!nextHopId || !this.neighbors.has(nextHopId)) return [];

    const results: DeliveryResult[] = [];
    for (const envelope of this.queue.getByDestination(destinationHint)) {
      const result = this.forward(envelope, nextHopId, [this.id]);
      if (result.outcome !== 'dropped') {
        this.queue.acknowledge(envelope.header.messageId);
      }
      results.push(result);
    }
    return results;
  }

  private forward(envelope: Envelope, nextHopId: string, path: string[]): DeliveryResult {
    const nextHop = this.neighbors.get(nextHopId)!;
    const forwardedEnvelope: Envelope = {
      header: { ...envelope.header, ttl: envelope.header.ttl - 1 },
      sealedPayload: envelope.sealedPayload,
    };
    return nextHop.receiveEnvelope(forwardedEnvelope, this.id, path);
  }

  /**
   * The core relay decision, now with store-and-forward. Still never
   * touches envelope.sealedPayload, only envelope.header. The only
   * change from Phase 3: "no route" no longer means "drop", it means
   * "queue and wait" (RFC-0007 Section 2), unless the queue itself
   * refuses it (full, forged, duplicate, or over quota).
   */
  receiveEnvelope(envelope: Envelope, fromNodeId: string | null, path: string[] = []): DeliveryResult {
    const currentPath = [...path, this.id];

    if (!validateRoutingHeader(envelope.header)) {
      return { outcome: 'dropped', reason: 'invalid header', path: currentPath };
    }

    if (bytesEqual(envelope.header.destinationHint, this.ownDestinationHint)) {
      return { outcome: 'delivered', envelope, path: currentPath };
    }

    if (envelope.header.ttl <= 0) {
      return { outcome: 'dropped', reason: 'ttl expired', path: currentPath };
    }

    const nextHopId = this.routingTable.lookup(envelope.header.destinationHint);
    if (nextHopId && this.neighbors.has(nextHopId)) {
      return this.forward(envelope, nextHopId, currentPath);
    }

    const result = this.queue.store(envelope, fromNodeId ?? 'origin');
    if (result.stored) {
      return { outcome: 'queued', path: currentPath };
    }
    return { outcome: 'dropped', reason: result.reason ?? 'unknown', path: currentPath };
  }
}