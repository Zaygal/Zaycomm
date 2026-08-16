// src/routing/routing.ts
// RFC-0007 routing, RFC-0009 sync, RFC-0006 fragmentation/broadcast.

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
  createBroadcastEnvelope,
  createAckEnvelope,
  verifyAckEnvelope,
} from '../envelope/envelope';
import { fragmentEnvelope, FragmentReassembler } from '../envelope/fragment';
import { concatBytes, bytesEqual, bytesToHex, u64le } from '../util';
import { StoreForwardQueue } from '../storage/store';
import type { Transport } from '../transport/transport';
import {
  type BroadcastMessage,
  createBroadcastMessage,
  verifyBroadcastMessage,
  encodeBroadcastMessage,
  decodeBroadcastMessage,
} from '../broadcast/broadcast';

const cbor = new Encoder();
const ROUTING_AD_CONTEXT = 'ZAYCOMM_ROUTING_AD_V1';
const SYNC_AUTH_CONTEXT = new TextEncoder().encode('ZAYCOMM_SYNC_AUTH_V1');
const DESTINATION_HINT_LENGTH = 8;
const DEFAULT_BROADCAST_TTL = 8;
const MAX_PENDING_ACKS = 500;
const MAX_ROUTING_AD_AGE_MS = 5 * 60 * 1000;
const MAX_ROUTING_AD_FUTURE_SKEW_MS = 30 * 1000;
const MAX_ROUTING_AD_DESTINATIONS = 256;
const MAX_SEEN_ROUTING_ADS = 2048;
const MAX_SYNC_ENTRIES = 512;
const MAX_SYNC_REQUESTS = 512;
const MAX_SYNC_TRANSFER_ENVELOPES = 128;
const MAX_SYNC_TRANSFER_BYTES = 512 * 1024;
const FRAME_KIND_ENVELOPE = 0;
const FRAME_KIND_FRAGMENT = 1;

// C9: a newly advertised route is usable only during a short probation window.
// A destination-signed ACK promotes the route to validated status. Validated routes
// also expire so stale or compromised paths cannot remain trusted indefinitely.
export const ROUTE_PROBATION_MS = 30 * 1000;
export const ROUTE_VALIDATION_TTL_MS = 5 * 60 * 1000;
export const ROUTE_ACK_TIMEOUT_MS = ROUTE_PROBATION_MS;

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
  return concatBytes(new TextEncoder().encode(ROUTING_AD_CONTEXT), u64le(timestamp), ...reachableDestinations);
}

export function createRoutingAdvertisement(identity: Identity, reachableDestinations: Uint8Array[]): RoutingAdvertisement {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signMessage(buildAdvertisementMessage(reachableDestinations, timestamp), identity.privateKey);
  return { advertiserPublicKey: identity.publicKey, reachableDestinations, timestamp, signature };
}

export function verifyRoutingAdvertisement(ad: RoutingAdvertisement, nowMs: number = Date.now()): boolean {
  if (!Number.isSafeInteger(ad.timestamp) || ad.timestamp < 0) return false;
  if (!Array.isArray(ad.reachableDestinations) || ad.reachableDestinations.length > MAX_ROUTING_AD_DESTINATIONS) return false;
  if (ad.advertiserPublicKey.length !== 32 || ad.signature.length !== 64) return false;
  if (ad.reachableDestinations.some((hint) => hint.length !== DESTINATION_HINT_LENGTH)) return false;
  const timestampMs = ad.timestamp * 1000;
  if (timestampMs < nowMs - MAX_ROUTING_AD_AGE_MS || timestampMs > nowMs + MAX_ROUTING_AD_FUTURE_SKEW_MS) return false;
  return verifySignature(ad.signature, buildAdvertisementMessage(ad.reachableDestinations, ad.timestamp), ad.advertiserPublicKey);
}

type RouteCandidate = {
  status: 'probation' | 'validated';
  lastAdvertisedAt: number;
  expiresAt: number;
};

class RoutingTable {
  private routes = new Map<string, Map<string, RouteCandidate>>();

  learnFromAdvertisement(fromNeighborId: string, ad: RoutingAdvertisement, nowMs: number = Date.now()): void {
    if (!verifyRoutingAdvertisement(ad, nowMs)) return;
    for (const hint of ad.reachableDestinations) {
      const key = bytesToHex(hint);
      let candidates = this.routes.get(key);
      if (!candidates) { candidates = new Map(); this.routes.set(key, candidates); }
      const existing = candidates.get(fromNeighborId);
      // A fresh advertisement never silently upgrades a route. Only a valid ACK can do that.
      candidates.set(fromNeighborId, {
        status: existing?.status === 'validated' && existing.expiresAt > nowMs ? 'validated' : 'probation',
        lastAdvertisedAt: nowMs,
        expiresAt: existing?.status === 'validated' && existing.expiresAt > nowMs
          ? nowMs + ROUTE_VALIDATION_TTL_MS
          : nowMs + ROUTE_PROBATION_MS,
      });
    }
  }

  markValidated(destinationHint: Uint8Array, neighborId: string, nowMs: number = Date.now()): void {
    const candidates = this.routes.get(bytesToHex(destinationHint));
    const route = candidates?.get(neighborId);
    if (!route) return;
    route.status = 'validated';
    route.lastAdvertisedAt = nowMs;
    route.expiresAt = nowMs + ROUTE_VALIDATION_TTL_MS;
  }

  demote(destinationHint: Uint8Array, neighborId: string): void {
    const candidates = this.routes.get(bytesToHex(destinationHint));
    const route = candidates?.get(neighborId);
    if (!route) return;
    route.status = 'probation';
    route.expiresAt = 0;
  }

  purgeExpired(nowMs: number = Date.now()): number {
    let purged = 0;
    for (const [destination, candidates] of this.routes) {
      for (const [neighborId, route] of candidates) {
        if (route.expiresAt <= nowMs) { candidates.delete(neighborId); purged++; }
      }
      if (candidates.size === 0) this.routes.delete(destination);
    }
    return purged;
  }

  lookup(destinationHint: Uint8Array, trustScores: Map<string, number>, nowMs: number = Date.now()): string | null {
    this.purgeExpired(nowMs);
    const candidates = this.routes.get(bytesToHex(destinationHint));
    if (!candidates || candidates.size === 0) return null;

    let bestValidated: string | null = null;
    let bestValidatedScore = -Infinity;
    let bestProbation: string | null = null;
    let bestProbationScore = -Infinity;

    for (const [neighborId, route] of candidates) {
      const score = trustScores.get(neighborId) ?? 0;
      if (route.status === 'validated') {
        if (score > bestValidatedScore) { bestValidatedScore = score; bestValidated = neighborId; }
      } else if (score > bestProbationScore) {
        bestProbationScore = score;
        bestProbation = neighborId;
      }
    }
    return bestValidated ?? bestProbation;
  }

  hasRoute(destinationHint: Uint8Array, nowMs: number = Date.now()): boolean {
    return this.lookup(destinationHint, new Map(), nowMs) !== null;
  }
}

export type DeliveryResult =
  | { outcome: 'delivered'; envelope: Envelope }
  | { outcome: 'forwarded'; to: string }
  | { outcome: 'queued' }
  | { outcome: 'broadcast'; message: BroadcastMessage }
  | { outcome: 'dropped'; reason: string };

type SyncSummaryEntry = [Uint8Array, number];
type SyncPayloadTuple = [0, SyncSummaryEntry[]] | [1, Uint8Array[]] | [2, Uint8Array[]];
type AuthenticatedSyncTuple = [Uint8Array, Uint8Array, Uint8Array];
type PendingAck = { neighborId: string; destinationHint: Uint8Array; sentAt: number };
type AuthenticatedPeer = { identityPublicKey: Uint8Array; establishedAt: number };

function encodeAuthenticatedSync(identity: Identity, inner: SyncPayloadTuple): Uint8Array {
  const innerBytes = Uint8Array.from(cbor.encode(inner));
  const message = concatBytes(SYNC_AUTH_CONTEXT, identity.publicKey, innerBytes);
  const signature = signMessage(message, identity.privateKey);
  const outer: AuthenticatedSyncTuple = [identity.publicKey, signature, innerBytes];
  return Uint8Array.from(cbor.encode(outer));
}

function decodeAuthenticatedSync(payload: Uint8Array): { senderPublicKey: Uint8Array; inner: SyncPayloadTuple } | null {
  try {
    const outer = cbor.decode(payload) as AuthenticatedSyncTuple;
    if (!Array.isArray(outer) || outer.length !== 3) return null;
    const senderPublicKey = Uint8Array.from(outer[0]);
    const signature = Uint8Array.from(outer[1]);
    const innerBytes = Uint8Array.from(outer[2]);
    if (senderPublicKey.length !== 32 || signature.length !== 64 || innerBytes.length === 0 || innerBytes.length > MAX_SYNC_TRANSFER_BYTES) return null;
    const message = concatBytes(SYNC_AUTH_CONTEXT, senderPublicKey, innerBytes);
    if (!verifySignature(signature, message, senderPublicKey)) return null;
    const inner = cbor.decode(innerBytes) as SyncPayloadTuple;
    if (!Array.isArray(inner) || inner.length !== 2 || !Number.isInteger(inner[0]) || inner[0] < 0 || inner[0] > 2) return null;
    return { senderPublicKey, inner };
  } catch { return null; }
}

export class RelayNode {
  readonly id: string;
  readonly identity: Identity;
  readonly transport: Transport;
  private readonly routingTable = new RoutingTable();
  private readonly queue = new StoreForwardQueue();
  private readonly reassembler = new FragmentReassembler();
  private readonly ownDestinationHint: Uint8Array;
  private deliveryListeners: ((envelope: Envelope) => void)[] = [];
  private broadcastListeners: ((message: BroadcastMessage) => void)[] = [];
  private ackListeners: ((acknowledgedMessageId: Uint8Array) => void)[] = [];
  private seenBroadcasts = new Map<string, number>();
  private seenRoutingAdvertisements = new Map<string, number>();
  private neighborTrust = new Map<string, number>();
  private pendingAcks = new Map<string, PendingAck>();
  private authenticatedPeers = new Map<string, AuthenticatedPeer>();

  constructor(id: string, identity: Identity, transport: Transport) {
    this.id = id;
    this.identity = identity;
    this.transport = transport;
    this.ownDestinationHint = computeDestinationHint(identity.publicKey);
    this.transport.onReceive((fromNeighborId, frame) => {
      try {
        if (frame.length === 0) return;
        const kind = frame[0];
        const body = frame.slice(1);
        if (kind === FRAME_KIND_FRAGMENT) {
          const reassembled = this.reassembler.addFragment(body);
          if (reassembled) this.receiveEnvelope(reassembled, fromNeighborId);
          return;
        }
        if (kind !== FRAME_KIND_ENVELOPE) return;
        this.receiveEnvelope(decodeEnvelope(body), fromNeighborId);
      } catch { return; }
    });
  }

  onDelivered(listener: (envelope: Envelope) => void): void { this.deliveryListeners.push(listener); }
  onBroadcastReceived(listener: (message: BroadcastMessage) => void): void { this.broadcastListeners.push(listener); }
  onAckReceived(listener: (acknowledgedMessageId: Uint8Array) => void): void { this.ackListeners.push(listener); }
  hasRoute(destinationHint: Uint8Array): boolean { return this.routingTable.hasRoute(destinationHint); }
  queueSize(): number { return this.queue.size(); }
  neighborTrustScore(neighborId: string): number { return this.neighborTrust.get(neighborId) ?? 0; }

  /** Call this only after C3 has established an authenticated session with this neighbor. */
  registerAuthenticatedPeer(neighborId: string, peerIdentityPublicKey: Uint8Array): void {
    if (peerIdentityPublicKey.length !== 32) throw new Error('INVALID_PEER_IDENTITY_KEY');
    this.authenticatedPeers.set(neighborId, { identityPublicKey: Uint8Array.from(peerIdentityPublicKey), establishedAt: Date.now() });
  }

  unregisterAuthenticatedPeer(neighborId: string): void { this.authenticatedPeers.delete(neighborId); }
  isAuthenticatedPeer(neighborId: string): boolean { return this.authenticatedPeers.has(neighborId); }

  purgeStaleBroadcastRecords(maxAgeMs: number): number {
    const now = Date.now(); let purged = 0;
    for (const [key, seenAt] of this.seenBroadcasts) if (now - seenAt > maxAgeMs) { this.seenBroadcasts.delete(key); purged++; }
    return purged;
  }

  purgeStaleRoutingAdvertisements(maxAgeMs: number = MAX_ROUTING_AD_AGE_MS): number {
    const now = Date.now(); let purged = 0;
    for (const [key, seenAt] of this.seenRoutingAdvertisements) if (now - seenAt > maxAgeMs) { this.seenRoutingAdvertisements.delete(key); purged++; }
    return purged;
  }

  purgeStaleRoutes(): number {
    return this.routingTable.purgeExpired(Date.now());
  }

  private expirePendingAcks(nowMs: number = Date.now()): number {
    let expired = 0;
    for (const [messageId, pending] of this.pendingAcks) {
      if (nowMs - pending.sentAt < ROUTE_ACK_TIMEOUT_MS) continue;
      this.pendingAcks.delete(messageId);
      this.routingTable.demote(pending.destinationHint, pending.neighborId);
      expired++;
    }
    return expired;
  }

  purgeStaleRoutingState(): number {
    const now = Date.now();
    return this.expirePendingAcks(now) + this.routingTable.purgeExpired(now);
  }

  purgeStaleFragments(maxAgeMs: number): number { return this.reassembler.purgeStale(maxAgeMs); }

  sendAck(destinationHint: Uint8Array, acknowledgedMessageId: Uint8Array): void {
    this.purgeStaleRoutingState();
    const ackEnvelope = createAckEnvelope(destinationHint, acknowledgedMessageId, this.identity);
    if (bytesEqual(destinationHint, this.ownDestinationHint)) { this.receiveEnvelope(ackEnvelope, null); return; }
    const nextHopId = this.routingTable.lookup(destinationHint, this.neighborTrust);
    if (nextHopId && this.sendEnvelopeOverTransport(nextHopId, ackEnvelope)) return;
    this.queue.store(ackEnvelope, 'origin');
  }

  private recordPendingAck(messageId: Uint8Array, neighborId: string, destinationHint: Uint8Array): void {
    if (this.pendingAcks.size >= MAX_PENDING_ACKS) {
      const oldestKey = this.pendingAcks.keys().next().value;
      if (oldestKey !== undefined) this.pendingAcks.delete(oldestKey);
    }
    this.pendingAcks.set(bytesToHex(messageId), { neighborId, destinationHint: Uint8Array.from(destinationHint), sentAt: Date.now() });
  }

  private sendEnvelopeOverTransport(neighborId: string, envelope: Envelope): boolean {
    const mtu = this.transport.getLinkCharacteristics(neighborId)?.maxTransmissionUnit ?? Infinity;
    const encoded = encodeEnvelope(envelope);
    if (encoded.length + 1 <= mtu) return this.transport.send(neighborId, concatBytes(new Uint8Array([FRAME_KIND_ENVELOPE]), encoded));
    const fragments = fragmentEnvelope(envelope, mtu - 1);
    let allSent = true;
    for (const fragment of fragments) if (!this.transport.send(neighborId, concatBytes(new Uint8Array([FRAME_KIND_FRAGMENT]), fragment))) allSent = false;
    return allSent;
  }

  broadcast(content: Uint8Array, ttl: number = DEFAULT_BROADCAST_TTL): void {
    const envelope = createBroadcastEnvelope(encodeBroadcastMessage(createBroadcastMessage(this.identity, content)), ttl);
    for (const neighborId of this.transport.discoverNeighbors()) this.sendEnvelopeOverTransport(neighborId, envelope);
  }

  receiveAdvertisement(fromNeighborId: string, ad: RoutingAdvertisement): void {
    const now = Date.now();
    this.purgeStaleRoutingState();
    if (!verifyRoutingAdvertisement(ad, now)) return;
    const fingerprint = bytesToHex(sha256(concatBytes(ad.advertiserPublicKey, u64le(ad.timestamp), ...ad.reachableDestinations, ad.signature)));
    const replayKey = `${fromNeighborId}:${fingerprint}`;
    if (this.seenRoutingAdvertisements.has(replayKey)) return;
    if (this.seenRoutingAdvertisements.size >= MAX_SEEN_ROUTING_ADS) {
      const oldestKey = this.seenRoutingAdvertisements.keys().next().value;
      if (oldestKey !== undefined) this.seenRoutingAdvertisements.delete(oldestKey);
    }
    this.seenRoutingAdvertisements.set(replayKey, now);
    this.routingTable.learnFromAdvertisement(fromNeighborId, ad, now);
    for (const hint of ad.reachableDestinations) this.attemptQueuedDelivery(hint);
  }

  private attemptQueuedDelivery(destinationHint: Uint8Array): void {
    this.purgeStaleRoutingState();
    const nextHopId = this.routingTable.lookup(destinationHint, this.neighborTrust);
    if (!nextHopId) return;
    for (const envelope of this.queue.getByDestination(destinationHint)) {
      const sent = this.forwardOverTransport(envelope, nextHopId);
      if (sent) this.queue.acknowledge(envelope.header.messageId);
    }
  }

  private forwardOverTransport(envelope: Envelope, nextHopId: string): boolean {
    const forwardedEnvelope: Envelope = { header: { ...envelope.header, ttl: envelope.header.ttl - 1 }, sealedPayload: envelope.sealedPayload };
    const expectsAck = envelope.header.packetType === PacketType.Data;
    if (expectsAck) this.recordPendingAck(envelope.header.messageId, nextHopId, envelope.header.destinationHint);
    const sent = this.sendEnvelopeOverTransport(nextHopId, forwardedEnvelope);
    if (!sent && expectsAck) this.pendingAcks.delete(bytesToHex(envelope.header.messageId));
    return sent;
  }

  initiateSync(neighborId: string): boolean {
    if (!this.authenticatedPeers.has(neighborId)) return false;
    const entries: SyncSummaryEntry[] = this.queue.getSummary().slice(0, MAX_SYNC_ENTRIES).map((e) => [e.messageId, e.ttlRemaining]);
    const payload = encodeAuthenticatedSync(this.identity, [0, entries]);
    return this.sendEnvelopeOverTransport(neighborId, createSyncEnvelope(payload));
  }

  private peerAuthorized(fromNodeId: string, senderPublicKey: Uint8Array): boolean {
    const peer = this.authenticatedPeers.get(fromNodeId);
    return !!peer && bytesEqual(peer.identityPublicKey, senderPublicKey);
  }

  private handleSyncPacket(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    if (!fromNodeId || !this.authenticatedPeers.has(fromNodeId)) return { outcome: 'dropped', reason: 'unauthenticated sync peer' };
    const authenticated = decodeAuthenticatedSync(envelope.sealedPayload);
    if (!authenticated || !this.peerAuthorized(fromNodeId, authenticated.senderPublicKey)) return { outcome: 'dropped', reason: 'invalid sync authentication' };
    const tuple = authenticated.inner;

    if (tuple[0] === 0) {
      if (!Array.isArray(tuple[1]) || tuple[1].length > MAX_SYNC_ENTRIES) return { outcome: 'dropped', reason: 'sync summary too large' };
      const entries: SyncSummaryEntry[] = tuple[1].map(([id, ttl]) => [Uint8Array.from(id), ttl]);
      if (entries.some(([id, ttl]) => id.length !== 16 || !Number.isSafeInteger(ttl) || ttl < 0)) return { outcome: 'dropped', reason: 'invalid sync summary' };
      const missingIds = entries.filter(([id]) => !this.queue.has(id)).map(([id]) => id).slice(0, MAX_SYNC_REQUESTS);
      if (missingIds.length > 0) {
        const requestEnvelope = createSyncEnvelope(encodeAuthenticatedSync(this.identity, [1, missingIds]));
        this.sendEnvelopeOverTransport(fromNodeId, requestEnvelope);
      }
      return { outcome: 'delivered', envelope };
    }

    if (tuple[0] === 1) {
      if (!Array.isArray(tuple[1]) || tuple[1].length > MAX_SYNC_REQUESTS) return { outcome: 'dropped', reason: 'sync request too large' };
      const requestedIds = tuple[1].map((id) => Uint8Array.from(id));
      if (requestedIds.some((id) => id.length !== 16)) return { outcome: 'dropped', reason: 'invalid sync request' };
      const requested = this.queue.getByIds(requestedIds).slice(0, MAX_SYNC_TRANSFER_ENVELOPES);
      const wireEnvelopes: Uint8Array[] = [];
      let totalBytes = 0;
      for (const item of requested) {
        const wire = Uint8Array.from(encodeEnvelope(item));
        if (totalBytes + wire.length > MAX_SYNC_TRANSFER_BYTES) break;
        wireEnvelopes.push(wire); totalBytes += wire.length;
      }
      const transferEnvelope = createSyncEnvelope(encodeAuthenticatedSync(this.identity, [2, wireEnvelopes]));
      this.sendEnvelopeOverTransport(fromNodeId, transferEnvelope);
      return { outcome: 'delivered', envelope };
    }

    if (!Array.isArray(tuple[1]) || tuple[1].length > MAX_SYNC_TRANSFER_ENVELOPES) return { outcome: 'dropped', reason: 'sync transfer too large' };
    let totalBytes = 0;
    try {
      for (const wireBytes of tuple[1]) {
        const wire = Uint8Array.from(wireBytes);
        totalBytes += wire.length;
        if (totalBytes > MAX_SYNC_TRANSFER_BYTES) return { outcome: 'dropped', reason: 'sync transfer byte limit exceeded' };
        this.receiveEnvelope(decodeEnvelope(wire), fromNodeId);
      }
    } catch { return { outcome: 'dropped', reason: 'malformed sync transfer' }; }
    return { outcome: 'delivered', envelope };
  }

  private handleBroadcastPacket(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    const key = bytesToHex(envelope.header.messageId);
    if (this.seenBroadcasts.has(key)) return { outcome: 'dropped', reason: 'broadcast already seen' };
    this.seenBroadcasts.set(key, Date.now());
    const message = decodeBroadcastMessage(envelope.sealedPayload);
    if (!verifyBroadcastMessage(message)) return { outcome: 'dropped', reason: 'invalid broadcast signature' };
    for (const listener of this.broadcastListeners) listener(message);
    if (envelope.header.ttl > 0) {
      const forwarded: Envelope = { header: { ...envelope.header, ttl: envelope.header.ttl - 1 }, sealedPayload: envelope.sealedPayload };
      for (const neighborId of this.transport.discoverNeighbors()) if (neighborId !== fromNodeId) this.sendEnvelopeOverTransport(neighborId, forwarded);
    }
    return { outcome: 'broadcast', message };
  }

  receiveEnvelope(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    this.purgeStaleRoutingState();
    if (!validateRoutingHeader(envelope.header)) return { outcome: 'dropped', reason: 'invalid header' };
    if (envelope.header.packetType === PacketType.StoreForwardSync) return this.handleSyncPacket(envelope, fromNodeId);
    if (envelope.header.packetType === PacketType.EmergencyBroadcast) return this.handleBroadcastPacket(envelope, fromNodeId);

    if (bytesEqual(envelope.header.destinationHint, this.ownDestinationHint)) {
      if (envelope.header.packetType === PacketType.Ack) {
        const verifiedAck = verifyAckEnvelope(envelope);
        if (!verifiedAck) return { outcome: 'dropped', reason: 'invalid ack signature' };
        const ackedIdHex = bytesToHex(verifiedAck.acknowledgedMessageId);
        const pending = this.pendingAcks.get(ackedIdHex);
        if (!pending) return { outcome: 'dropped', reason: 'ack for unknown message' };
        if (!bytesEqual(pending.destinationHint, verifiedAck.signerDestinationHint)) return { outcome: 'dropped', reason: 'ack signer is not the message destination' };
        this.routingTable.markValidated(pending.destinationHint, pending.neighborId);
        this.neighborTrust.set(pending.neighborId, (this.neighborTrust.get(pending.neighborId) ?? 0) + 1);
        this.pendingAcks.delete(ackedIdHex);
        for (const listener of this.ackListeners) listener(verifiedAck.acknowledgedMessageId);
      } else {
        for (const listener of this.deliveryListeners) listener(envelope);
      }
      return { outcome: 'delivered', envelope };
    }

    if (envelope.header.ttl <= 0) return { outcome: 'dropped', reason: 'ttl expired' };
    const nextHopId = this.routingTable.lookup(envelope.header.destinationHint, this.neighborTrust);
    if (nextHopId) {
      const sent = this.forwardOverTransport(envelope, nextHopId);
      if (sent) return { outcome: 'forwarded', to: nextHopId };
    }
    const result = this.queue.store(envelope, fromNodeId ?? 'origin');
    if (result.stored) return { outcome: 'queued' };
    return { outcome: 'dropped', reason: result.reason ?? 'unknown' };
  }
}
