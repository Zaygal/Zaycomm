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
import {
  bindRouteTrust,
  createRouteProvenance,
  matchesRouteTrustBinding,
  type RouteTrustBinding,
} from './route-provenance';
import { decryptSyncPayload, encryptSyncPayload, type SyncCiphertext } from '../sync/session-sync';

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
const MAX_SEEN_SYNC_PACKETS = 2048;
const SYNC_REPLAY_TTL_MS = 10 * 60 * 1000;
const MAX_SYNC_ENTRIES = 512;
const MAX_SYNC_REQUESTS = 512;
const MAX_SYNC_TRANSFER_ENVELOPES = 128;
const MAX_SYNC_TRANSFER_BYTES = 512 * 1024;
const FRAME_KIND_ENVELOPE = 0;
const FRAME_KIND_FRAGMENT = 1;

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
  binding: RouteTrustBinding | null;
};

class RoutingTable {
  private routes = new Map<string, Map<string, RouteCandidate>>();

  learnFromAdvertisement(
    fromNeighborId: string,
    ad: RoutingAdvertisement,
    sessionEpoch: number,
    authenticatedPeerPublicKey: Uint8Array,
    nowMs: number = Date.now(),
  ): void {
    if (!verifyRoutingAdvertisement(ad, nowMs)) return;
    if (!bytesEqual(ad.advertiserPublicKey, authenticatedPeerPublicKey)) return;
    if (!Number.isSafeInteger(sessionEpoch) || sessionEpoch < 0) return;

    for (const hint of ad.reachableDestinations) {
      const key = bytesToHex(hint);
      let candidates = this.routes.get(key);
      if (!candidates) { candidates = new Map(); this.routes.set(key, candidates); }
      const existing = candidates.get(fromNeighborId);
      candidates.set(fromNeighborId, {
        status: existing?.status === 'validated' && existing.expiresAt > nowMs ? 'validated' : 'probation',
        lastAdvertisedAt: nowMs,
        expiresAt: existing?.status === 'validated' && existing.expiresAt > nowMs ? nowMs + ROUTE_VALIDATION_TTL_MS : nowMs + ROUTE_PROBATION_MS,
        binding: existing?.binding && existing.binding.sessionEpoch === sessionEpoch && bytesEqual(existing.binding.advertiserPublicKey, authenticatedPeerPublicKey)
          ? existing.binding
          : null,
      });
    }
  }

  markValidated(
    destinationHint: Uint8Array,
    destinationPublicKey: Uint8Array,
    neighborId: string,
    authenticatedPeerPublicKey: Uint8Array,
    sessionEpoch: number,
    nowMs: number = Date.now(),
  ): void {
    const route = this.routes.get(bytesToHex(destinationHint))?.get(neighborId);
    if (!route || !bytesEqual(destinationHint, computeDestinationHint(destinationPublicKey))) return;
    const provenance = createRouteProvenance(destinationPublicKey, destinationHint, authenticatedPeerPublicKey, neighborId, sessionEpoch);
    route.binding = bindRouteTrust(provenance, nowMs);
    route.status = 'validated'; route.lastAdvertisedAt = nowMs; route.expiresAt = nowMs + ROUTE_VALIDATION_TTL_MS;
  }

  demote(destinationHint: Uint8Array, neighborId: string): void {
    const route = this.routes.get(bytesToHex(destinationHint))?.get(neighborId);
    if (!route) return;
    route.status = 'probation'; route.expiresAt = 0; route.binding = null;
  }

  purgeExpired(nowMs: number = Date.now()): number {
    let purged = 0;
    for (const [destination, candidates] of this.routes) {
      for (const [neighborId, route] of candidates) if (route.expiresAt <= nowMs) { candidates.delete(neighborId); purged++; }
      if (candidates.size === 0) this.routes.delete(destination);
    }
    return purged;
  }

  lookup(
    destinationHint: Uint8Array,
    trustScores: Map<string, number>,
    authenticatedPeers: Map<string, AuthenticatedPeer>,
    nowMs: number = Date.now(),
  ): string | null {
    this.purgeExpired(nowMs);
    const candidates = this.routes.get(bytesToHex(destinationHint));
    if (!candidates || candidates.size === 0) return null;
    let bestValidated: string | null = null, bestValidatedScore = -Infinity;
    let bestProbation: string | null = null, bestProbationScore = -Infinity;
    for (const [neighborId, route] of candidates) {
      const peer = authenticatedPeers.get(neighborId);
      if (!peer) continue;
      if (route.status === 'validated') {
        if (!route.binding) continue;
        const expected = createRouteProvenance(
          route.binding.destinationPublicKey,
          destinationHint,
          peer.identityPublicKey,
          neighborId,
          peer.establishedAt,
        );
        if (!matchesRouteTrustBinding(route.binding, expected)) continue;
        const score = trustScores.get(neighborId) ?? 0;
        if (score > bestValidatedScore) { bestValidatedScore = score; bestValidated = neighborId; }
      } else {
        const score = trustScores.get(neighborId) ?? 0;
        if (score > bestProbationScore) { bestProbationScore = score; bestProbation = neighborId; }
      }
    }
    return bestValidated ?? bestProbation;
  }

  hasRoute(destinationHint: Uint8Array, authenticatedPeers: Map<string, AuthenticatedPeer>, nowMs: number = Date.now()): boolean {
    return this.lookup(destinationHint, new Map(), authenticatedPeers, nowMs) !== null;
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
type PendingAck = { neighborId: string; destinationHint: Uint8Array; sentAt: number };
export type AuthenticatedSession = { sessionId: string; sendKey: Uint8Array; receiveKey: Uint8Array };
type AuthenticatedPeer = { identityPublicKey: Uint8Array; establishedAt: number; session: AuthenticatedSession | null };

type EncodedEncryptedSync = [string, Uint8Array, Uint8Array];

function encodeEncryptedSync(identityPublicKey: Uint8Array, session: AuthenticatedSession, inner: SyncPayloadTuple): Uint8Array {
  const plaintext = Uint8Array.from(cbor.encode([identityPublicKey, inner]));
  const encrypted = encryptSyncPayload(session.sendKey, session.sessionId, plaintext);
  return Uint8Array.from(cbor.encode([encrypted.sessionId, encrypted.nonce, encrypted.ciphertext] as EncodedEncryptedSync));
}

function decodeEncryptedSync(payload: Uint8Array, session: AuthenticatedSession): { senderPublicKey: Uint8Array; inner: SyncPayloadTuple } | null {
  try {
    const outer = cbor.decode(payload) as EncodedEncryptedSync;
    if (!Array.isArray(outer) || outer.length !== 3 || typeof outer[0] !== 'string') return null;
    const encrypted: SyncCiphertext = { sessionId: outer[0], nonce: Uint8Array.from(outer[1]), ciphertext: Uint8Array.from(outer[2]) };
    if (encrypted.sessionId !== session.sessionId || encrypted.nonce.length !== 24 || encrypted.ciphertext.length === 0) return null;
    const plaintext = decryptSyncPayload(session.receiveKey, encrypted);
    const tuple = cbor.decode(plaintext) as [Uint8Array, SyncPayloadTuple];
    if (!Array.isArray(tuple) || tuple.length !== 2) return null;
    const senderPublicKey = Uint8Array.from(tuple[0]);
    const inner = tuple[1];
    if (senderPublicKey.length !== 32 || !Array.isArray(inner) || inner.length !== 2 || !Number.isInteger(inner[0]) || inner[0] < 0 || inner[0] > 2) return null;
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
  private seenSyncPackets = new Map<string, number>();
  private neighborTrust = new Map<string, number>();
  private pendingAcks = new Map<string, PendingAck>();
  private authenticatedPeers = new Map<string, AuthenticatedPeer>();

  constructor(id: string, identity: Identity, transport: Transport) {
    this.id = id; this.identity = identity; this.transport = transport; this.ownDestinationHint = computeDestinationHint(identity.publicKey);
    this.transport.onReceive((fromNeighborId, frame) => {
      try {
        if (frame.length === 0) return;
        const kind = frame[0], body = frame.slice(1);
        if (kind === FRAME_KIND_FRAGMENT) {
          const peer = this.authenticatedPeers.get(fromNeighborId); if (!peer) return;
          const fragmentPeerId = `${fromNeighborId}:${peer.establishedAt}`;
          const reassembled = this.reassembler.addFragment(body, fragmentPeerId);
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
  hasRoute(destinationHint: Uint8Array): boolean { return this.routingTable.hasRoute(destinationHint, this.authenticatedPeers); }
  queueSize(): number { return this.queue.size(); }
  neighborTrustScore(neighborId: string): number { return this.neighborTrust.get(neighborId) ?? 0; }

  registerAuthenticatedPeer(neighborId: string, peerIdentityPublicKey: Uint8Array, session: AuthenticatedSession | null = null): void {
    if (peerIdentityPublicKey.length !== 32) throw new Error('INVALID_PEER_IDENTITY_KEY');
    if (session && (session.sendKey.length !== 32 || session.receiveKey.length !== 32 || session.sessionId.length === 0)) throw new Error('INVALID_AUTHENTICATED_SESSION');
    this.authenticatedPeers.set(neighborId, {
      identityPublicKey: Uint8Array.from(peerIdentityPublicKey),
      establishedAt: Date.now(),
      session: session ? { sessionId: session.sessionId, sendKey: Uint8Array.from(session.sendKey), receiveKey: Uint8Array.from(session.receiveKey) } : null,
    });
  }

  registerAuthenticatedSession(neighborId: string, peerIdentityPublicKey: Uint8Array, session: AuthenticatedSession): void {
    this.registerAuthenticatedPeer(neighborId, peerIdentityPublicKey, session);
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
  purgeStaleRoutes(): number { return this.routingTable.purgeExpired(Date.now()); }
  purgeStaleSyncReplayRecords(maxAgeMs: number = SYNC_REPLAY_TTL_MS): number {
    const now = Date.now(); let purged = 0;
    for (const [key, seenAt] of this.seenSyncPackets) if (now - seenAt > maxAgeMs) { this.seenSyncPackets.delete(key); purged++; }
    return purged;
  }

  private expirePendingAcks(nowMs: number = Date.now()): number {
    let expired = 0;
    for (const [messageId, pending] of this.pendingAcks) {
      if (nowMs - pending.sentAt < ROUTE_ACK_TIMEOUT_MS) continue;
      this.pendingAcks.delete(messageId); this.routingTable.demote(pending.destinationHint, pending.neighborId); expired++;
    }
    return expired;
  }
  purgeStaleRoutingState(): number { return this.expirePendingAcks() + this.routingTable.purgeExpired(); }
  purgeStaleFragments(maxAgeMs: number): number { return this.reassembler.purgeStale(maxAgeMs); }

  sendAck(destinationHint: Uint8Array, acknowledgedMessageId: Uint8Array): void {
    this.purgeStaleRoutingState();
    const ackEnvelope = createAckEnvelope(destinationHint, acknowledgedMessageId, this.identity);
    if (bytesEqual(destinationHint, this.ownDestinationHint)) { this.receiveEnvelope(ackEnvelope, null); return; }
    const nextHopId = this.routingTable.lookup(destinationHint, this.neighborTrust, this.authenticatedPeers);
    if (nextHopId && this.sendEnvelopeOverTransport(nextHopId, ackEnvelope)) return;
    this.queue.store(ackEnvelope, 'origin');
  }
  private recordPendingAck(messageId: Uint8Array, neighborId: string, destinationHint: Uint8Array): void {
    if (this.pendingAcks.size >= MAX_PENDING_ACKS) { const oldestKey = this.pendingAcks.keys().next().value; if (oldestKey !== undefined) this.pendingAcks.delete(oldestKey); }
    this.pendingAcks.set(bytesToHex(messageId), { neighborId, destinationHint: Uint8Array.from(destinationHint), sentAt: Date.now() });
  }
  private sendEnvelopeOverTransport(neighborId: string, envelope: Envelope): boolean {
    const mtu = this.transport.getLinkCharacteristics(neighborId)?.maxTransmissionUnit ?? Infinity;
    const encoded = encodeEnvelope(envelope);
    if (encoded.length + 1 <= mtu) return this.transport.send(neighborId, concatBytes(new Uint8Array([FRAME_KIND_ENVELOPE]), encoded));
    const fragments = fragmentEnvelope(envelope, mtu - 1); let allSent = true;
    for (const fragment of fragments) if (!this.transport.send(neighborId, concatBytes(new Uint8Array([FRAME_KIND_FRAGMENT]), fragment))) allSent = false;
    return allSent;
  }
  broadcast(content: Uint8Array, ttl: number = DEFAULT_BROADCAST_TTL): void {
    const envelope = createBroadcastEnvelope(encodeBroadcastMessage(createBroadcastMessage(this.identity, content)), ttl);
    for (const neighborId of this.transport.discoverNeighbors()) this.sendEnvelopeOverTransport(neighborId, envelope);
  }
  receiveAdvertisement(fromNeighborId: string, ad: RoutingAdvertisement): void {
    const now = Date.now(); this.purgeStaleRoutingState(); if (!verifyRoutingAdvertisement(ad, now)) return;
    const peer = this.authenticatedPeers.get(fromNeighborId); if (!peer) return;
    if (!bytesEqual(peer.identityPublicKey, ad.advertiserPublicKey)) return;
    const fingerprint = bytesToHex(sha256(concatBytes(ad.advertiserPublicKey, u64le(ad.timestamp), ...ad.reachableDestinations, ad.signature)));
    const replayKey = `${fromNeighborId}:${fingerprint}`;
    if (this.seenRoutingAdvertisements.has(replayKey)) return;
    if (this.seenRoutingAdvertisements.size >= MAX_SEEN_ROUTING_ADS) { const oldestKey = this.seenRoutingAdvertisements.keys().next().value; if (oldestKey !== undefined) this.seenRoutingAdvertisements.delete(oldestKey); }
    this.seenRoutingAdvertisements.set(replayKey, now);
    this.routingTable.learnFromAdvertisement(fromNeighborId, ad, peer.establishedAt, peer.identityPublicKey, now);
    for (const hint of ad.reachableDestinations) this.attemptQueuedDelivery(hint);
  }
  private attemptQueuedDelivery(destinationHint: Uint8Array): void {
    this.purgeStaleRoutingState(); const nextHopId = this.routingTable.lookup(destinationHint, this.neighborTrust, this.authenticatedPeers); if (!nextHopId) return;
    for (const envelope of this.queue.getByDestination(destinationHint)) { const sent = this.forwardOverTransport(envelope, nextHopId); if (sent) this.queue.acknowledge(envelope.header.messageId); }
  }
  private forwardOverTransport(envelope: Envelope, nextHopId: string): boolean {
    const forwardedEnvelope: Envelope = { header: { ...envelope.header, ttl: envelope.header.ttl - 1 }, sealedPayload: envelope.sealedPayload };
    const expectsAck = envelope.header.packetType === PacketType.Data;
    if (expectsAck) this.recordPendingAck(envelope.header.messageId, nextHopId, envelope.header.destinationHint);
    const sent = this.sendEnvelopeOverTransport(nextHopId, forwardedEnvelope); if (!sent && expectsAck) this.pendingAcks.delete(bytesToHex(envelope.header.messageId)); return sent;
  }
  initiateSync(neighborId: string): boolean {
    const peer = this.authenticatedPeers.get(neighborId);
    if (!peer?.session) return false;
    const entries: SyncSummaryEntry[] = this.queue.getSummary().slice(0, MAX_SYNC_ENTRIES).map((e) => [e.messageId, e.ttlRemaining]);
    return this.sendEnvelopeOverTransport(neighborId, createSyncEnvelope(encodeEncryptedSync(this.identity.publicKey, peer.session, [0, entries])));
  }
  private peerAuthorized(fromNodeId: string, senderPublicKey: Uint8Array): boolean {
    const peer = this.authenticatedPeers.get(fromNodeId); return !!peer && bytesEqual(peer.identityPublicKey, senderPublicKey);
  }
  private handleSyncPacket(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    if (!fromNodeId) return { outcome: 'dropped', reason: 'unauthenticated sync peer' };
    const peer = this.authenticatedPeers.get(fromNodeId);
    if (!peer?.session) return { outcome: 'dropped', reason: 'sync session unavailable' };
    this.purgeStaleSyncReplayRecords();
    const authenticated = decodeEncryptedSync(envelope.sealedPayload, peer.session);
    if (!authenticated || !this.peerAuthorized(fromNodeId, authenticated.senderPublicKey)) return { outcome: 'dropped', reason: 'invalid encrypted sync authentication' };
    const replayKey = `${bytesToHex(authenticated.senderPublicKey)}:${bytesToHex(sha256(envelope.sealedPayload))}`;
    if (this.seenSyncPackets.has(replayKey)) return { outcome: 'dropped', reason: 'sync packet replayed' };
    if (this.seenSyncPackets.size >= MAX_SEEN_SYNC_PACKETS) { const oldestKey = this.seenSyncPackets.keys().next().value; if (oldestKey !== undefined) this.seenSyncPackets.delete(oldestKey); }
    this.seenSyncPackets.set(replayKey, Date.now());
    const tuple = authenticated.inner;
    if (tuple[0] === 0) {
      if (!Array.isArray(tuple[1]) || tuple[1].length > MAX_SYNC_ENTRIES) return { outcome: 'dropped', reason: 'sync summary too large' };
      const entries: SyncSummaryEntry[] = tuple[1].map(([id, ttl]) => [Uint8Array.from(id), ttl]);
      if (entries.some(([id, ttl]) => id.length !== 16 || !Number.isSafeInteger(ttl) || ttl < 0)) return { outcome: 'dropped', reason: 'invalid sync summary' };
      const missingIds = entries.filter(([id]) => !this.queue.has(id)).map(([id]) => id).slice(0, MAX_SYNC_REQUESTS);
      if (missingIds.length > 0) this.sendEnvelopeOverTransport(fromNodeId, createSyncEnvelope(encodeEncryptedSync(this.identity.publicKey, peer.session!, [1, missingIds])));
      return { outcome: 'delivered', envelope };
    }
    if (tuple[0] === 1) {
      if (!Array.isArray(tuple[1]) || tuple[1].length > MAX_SYNC_REQUESTS) return { outcome: 'dropped', reason: 'sync request too large' };
      const requestedIds = tuple[1].map((id) => Uint8Array.from(id));
      if (requestedIds.some((id) => id.length !== 16)) return { outcome: 'dropped', reason: 'invalid sync request' };
      const requested = this.queue.getByIds(requestedIds).slice(0, MAX_SYNC_TRANSFER_ENVELOPES);
      const wireEnvelopes: Uint8Array[] = []; let totalBytes = 0;
      for (const item of requested) { const wire = Uint8Array.from(encodeEnvelope(item)); if (totalBytes + wire.length > MAX_SYNC_TRANSFER_BYTES) break; wireEnvelopes.push(wire); totalBytes += wire.length; }
      this.sendEnvelopeOverTransport(fromNodeId, createSyncEnvelope(encodeEncryptedSync(this.identity.publicKey, peer.session!, [2, wireEnvelopes])));
      return { outcome: 'delivered', envelope };
    }
    if (!Array.isArray(tuple[1]) || tuple[1].length > MAX_SYNC_TRANSFER_ENVELOPES) return { outcome: 'dropped', reason: 'sync transfer too large' };
    let totalBytes = 0;
    try { for (const wireBytes of tuple[1]) { const wire = Uint8Array.from(wireBytes); totalBytes += wire.length; if (totalBytes > MAX_SYNC_TRANSFER_BYTES) return { outcome: 'dropped', reason: 'sync transfer byte limit exceeded' }; this.receiveEnvelope(decodeEnvelope(wire), fromNodeId); } }
    catch { return { outcome: 'dropped', reason: 'malformed sync transfer' }; }
    return { outcome: 'delivered', envelope };
  }
  private handleBroadcastPacket(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    const key = bytesToHex(envelope.header.messageId); if (this.seenBroadcasts.has(key)) return { outcome: 'dropped', reason: 'broadcast already seen' };
    this.seenBroadcasts.set(key, Date.now()); const message = decodeBroadcastMessage(envelope.sealedPayload); if (!verifyBroadcastMessage(message)) return { outcome: 'dropped', reason: 'invalid broadcast signature' };
    for (const listener of this.broadcastListeners) listener(message);
    if (envelope.header.ttl > 0) { const forwarded: Envelope = { header: { ...envelope.header, ttl: envelope.header.ttl - 1 }, sealedPayload: envelope.sealedPayload }; for (const neighborId of this.transport.discoverNeighbors()) if (neighborId !== fromNodeId) this.sendEnvelopeOverTransport(neighborId, forwarded); }
    return { outcome: 'broadcast', message };
  }
  /** Send a packet through an authenticated direct or routed mesh path. */
  sendEnvelope(envelope: Envelope): DeliveryResult {
    this.purgeStaleRoutingState();
    if (!validateRoutingHeader(envelope.header)) return { outcome: 'dropped', reason: 'invalid header' };
    const direct = Array.from(this.authenticatedPeers.entries()).find(([id, peer]) =>
      bytesEqual(computeDestinationHint(peer.identityPublicKey), envelope.header.destinationHint)
    )?.[0];
    const nextHopId = direct ?? this.routingTable.lookup(envelope.header.destinationHint, this.neighborTrust, this.authenticatedPeers);
    if (nextHopId && this.forwardOverTransport(envelope, nextHopId)) return { outcome: 'forwarded', to: nextHopId };
    const stored = this.queue.store(envelope, 'origin');
    return stored.stored ? { outcome: 'queued' } : { outcome: 'dropped', reason: stored.reason ?? 'unknown' };
  }

  receiveEnvelope(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    this.purgeStaleRoutingState();
    if (!validateRoutingHeader(envelope.header)) return { outcome: 'dropped', reason: 'invalid header' };
    if (envelope.header.packetType === PacketType.StoreForwardSync) return this.handleSyncPacket(envelope, fromNodeId);
    if (envelope.header.packetType === PacketType.EmergencyBroadcast) return this.handleBroadcastPacket(envelope, fromNodeId);
    if (bytesEqual(envelope.header.destinationHint, this.ownDestinationHint)) {
      if (envelope.header.packetType === PacketType.Ack) {
        const verifiedAck = verifyAckEnvelope(envelope); if (!verifiedAck) return { outcome: 'dropped', reason: 'invalid ack signature' };
        const ackedIdHex = bytesToHex(verifiedAck.acknowledgedMessageId); const pending = this.pendingAcks.get(ackedIdHex);
        if (!pending) return { outcome: 'dropped', reason: 'ack for unknown message' };
        if (!bytesEqual(pending.destinationHint, verifiedAck.signerDestinationHint)) return { outcome: 'dropped', reason: 'ack signer is not the message destination' };
        const peer = this.authenticatedPeers.get(pending.neighborId);
        if (!peer) return { outcome: 'dropped', reason: 'ack route provenance mismatch' };
        // C12: destination signer proves delivery; authenticated neighbor proves the relay path.
        this.routingTable.markValidated(pending.destinationHint, verifiedAck.signerPublicKey, pending.neighborId, peer.identityPublicKey, peer.establishedAt);
        this.neighborTrust.set(pending.neighborId, (this.neighborTrust.get(pending.neighborId) ?? 0) + 1); this.pendingAcks.delete(ackedIdHex);
        for (const listener of this.ackListeners) listener(verifiedAck.acknowledgedMessageId);
      } else for (const listener of this.deliveryListeners) listener(envelope);
      return { outcome: 'delivered', envelope };
    }
    if (envelope.header.ttl <= 0) return { outcome: 'dropped', reason: 'ttl expired' };
    const nextHopId = this.routingTable.lookup(envelope.header.destinationHint, this.neighborTrust, this.authenticatedPeers);
    if (nextHopId) { const sent = this.forwardOverTransport(envelope, nextHopId); if (sent) return { outcome: 'forwarded', to: nextHopId }; }
    const result = this.queue.store(envelope, fromNodeId ?? 'origin'); if (result.stored) return { outcome: 'queued' }; return { outcome: 'dropped', reason: result.reason ?? 'unknown' };
  }
}
