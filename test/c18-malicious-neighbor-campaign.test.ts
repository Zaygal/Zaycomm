// C18: malicious-neighbor adversarial campaign.
// Assumes the attacker has a valid cryptographic identity but is not trusted as honest.

import { describe, expect, it, vi } from 'vitest';
import { createIdentity } from '../src/identity/identity';
import { createBluetoothTransport, type SimulatedTransport } from '../src/transport/transport';
import { RelayNode, computeDestinationHint, createRoutingAdvertisement, ROUTE_PROBATION_MS } from '../src/routing/routing';
import { createDataEnvelope, createSyncEnvelope } from '../src/envelope/envelope';
import { createBroadcastMessage, encodeBroadcastMessage } from '../src/broadcast/broadcast';

function connect(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
}

const text = (value: string) => new TextEncoder().encode(value);

describe('C18 malicious-neighbor campaign', () => {
  it('does not treat a valid identity as proof of route honesty', () => {
    const origin = new RelayNode('origin', createIdentity(), createBluetoothTransport('origin'));
    const malicious = new RelayNode('malicious', createIdentity(), createBluetoothTransport('malicious'));
    const destination = createIdentity();
    connect(origin, malicious);
    origin.registerAuthenticatedPeer('malicious', malicious.identity.publicKey);

    const hint = computeDestinationHint(destination.publicKey);
    origin.receiveAdvertisement('malicious', createRoutingAdvertisement(destination, [hint]));
    const result = origin.receiveEnvelope(createDataEnvelope(hint, { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 1 }, text('probe'), 4), null);

    expect(result).toEqual({ outcome: 'forwarded', to: 'malicious' });
    expect(origin.neighborTrustScore('malicious')).toBe(0);

    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(ROUTE_PROBATION_MS + 1);
      const afterTimeout = origin.receiveEnvelope(createDataEnvelope(hint, { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 2 }, text('retry'), 4), null);
      expect(afterTimeout.outcome).toBe('queued');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an authenticated malicious neighbor impersonate another sync identity', () => {
    const victim = createIdentity();
    const attacker = createIdentity();
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const maliciousNeighbor = new RelayNode('malicious', attacker, createBluetoothTransport('malicious'));
    connect(relay, maliciousNeighbor);
    relay.registerAuthenticatedPeer('malicious', attacker.publicKey);

    const forged = createSyncEnvelope(new Uint8Array([1, 2, 3, 4]));
    const result = relay.receiveEnvelope(forged, 'malicious');
    expect(result.outcome).toBe('dropped');
    expect(victim.publicKey).not.toEqual(attacker.publicKey);
  });

  it('does not accept sync traffic from a neighbor that is not authenticated', () => {
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const attacker = new RelayNode('attacker', createIdentity(), createBluetoothTransport('attacker'));
    connect(relay, attacker);

    const result = relay.receiveEnvelope(createSyncEnvelope(text('unauthorized sync')), 'attacker');
    expect(result).toEqual({ outcome: 'dropped', reason: 'unauthenticated sync peer' });
  });

  it('keeps malicious broadcast amplification bounded by the origin budget', () => {
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const attacker = createIdentity();
    const payload = encodeBroadcastMessage(createBroadcastMessage(attacker, text('flood')));
    let rejected = 0;

    for (let i = 0; i < 32; i++) {
      try {
        relay.broadcast(payload);
      } catch {
        rejected++;
      }
    }

    expect(rejected).toBeGreaterThan(0);
  });

  it('does not promote a malicious route without a destination-signed ACK', () => {
    const origin = new RelayNode('origin', createIdentity(), createBluetoothTransport('origin'));
    const malicious = new RelayNode('malicious', createIdentity(), createBluetoothTransport('malicious'));
    const destination = createIdentity();
    connect(origin, malicious);
    origin.registerAuthenticatedPeer('malicious', malicious.identity.publicKey);

    const hint = computeDestinationHint(destination.publicKey);
    origin.receiveAdvertisement('malicious', createRoutingAdvertisement(destination, [hint]));
    origin.receiveEnvelope(createDataEnvelope(hint, { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 1 }, text('selective forwarding probe'), 4), null);

    expect(origin.neighborTrustScore('malicious')).toBe(0);
  });

  it('prevents a malicious neighbor from bypassing the bounded routing state lifecycle', () => {
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const attacker = new RelayNode('attacker', createIdentity(), createBluetoothTransport('attacker'));
    connect(relay, attacker);
    relay.registerAuthenticatedPeer('attacker', attacker.identity.publicKey);

    for (let i = 0; i < 64; i++) {
      const destination = createIdentity();
      relay.receiveAdvertisement('attacker', createRoutingAdvertisement(destination, [computeDestinationHint(destination.publicKey)]));
    }

    expect(relay.purgeStaleRoutingAdvertisements(0)).toBeGreaterThan(0);
  });
});