// src/routing/routing.ts
// RFC-0007, Sections 2, 4, and 5: routing advertisements, multi-hop
// forwarding, and store-and-forward. Now sends real bytes through a
// Transport (RFC-0008 Section 1) instead of one node calling another
// node's method directly in-process.
//
// One honest consequence: Transport.send() only reports whether a
// send succeeded, it cannot hand back what the recipient eventually
// did with those bytes, no real radio works that way. So this no
// longer returns a full multi-hop delivery path the way the earlier
// in-process simulation could. That is not a regression, a real mesh
// genuinely cannot know that either, every node only ever knows its
// own immediate predecessor, which is exactly the metadata
// minimization RFC-0002 asks for. Observe actual delivery via
// onDelivered() registered at the destination node instead.

import { sha256 } from '@noble/hashes/sha2.js';
import { signMessage, verifySignature } from '../crypto/keys';
import type { Identity } from '../identity/identity';
import {
  type Envelope,
  validateRoutingHeader,
  encodeEnvelope,
  decodeEnvelope,
} from '../envelope/envelope';
import { concatBytes, bytesEqual, bytesToHex, u64le } from '../util';
import { StoreForwardQueue } from '../storage/store';
import type { Transport } from '../transport/transport';

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

  /** Registers a callback that fires when a message addressed to this
   * node is actually delivered. This is how delivery gets observed
   * now that a Transport boundary sits between hops, since the
   * sender's own call can no longer see downstream outcomes. */
  onDelivered(listener: (envelope: Envelope) => void): void {
    this.deliveryListeners.push(listener);
  }

  hasRoute(destinationHint: Uint8Array): boolean {
    return this.routingTable.hasRoute(destinationHint);
  }

  queueSize(): number {
    return this.queue.size();
  }

  /**
   * Learns a route, then immediately checks the local queue for
   * anything addressed to a newly reachable destination, RFC-0007
   * Section 2's actual "forward" half of store, carry, and forward.
   */
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
   * The core relay decision, RFC-0007 Sections 2 and 4. Still never
   * touches envelope.sealedPayload, only envelope.header.
   */
  receiveEnvelope(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    if (!validateRoutingHeader(envelope.header)) {
      return { outcome: 'dropped', reason: 'invalid header' };
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
      // Send failed (exceeds MTU, link down, etc), fall through to queueing.
    }

    const result = this.queue.store(envelope, fromNodeId ?? 'origin');
    if (result.stored) {
      return { outcome: 'queued' };
    }
    return { outcome: 'dropped', reason: result.reason ?? 'unknown' };
  }
}
