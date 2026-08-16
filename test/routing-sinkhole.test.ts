// C9: routing sinkhole / blackhole adversarial tests.

import { describe, it, expect, vi } from 'vitest';
import { createDataEnvelope } from '../src/envelope/envelope';
import { RelayNode, computeDestinationHint, createRoutingAdvertisement, ROUTE_PROBATION_MS } from '../src/routing/routing';
import { createIdentity } from '../src/identity/identity';
import { createBluetoothTransport, type SimulatedTransport } from '../src/transport/transport';

function connectNodes(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
}

const text = (s: string) => new TextEncoder().encode(s);

describe('C9 routing sinkhole / blackhole resistance', () => {
  it('treats an advertised route as probationary until the destination ACK validates the path', () => {
    const origin = new RelayNode('origin', createIdentity(), createBluetoothTransport('origin'));
    const maliciousRelay = new RelayNode('maliciousRelay', createIdentity(), createBluetoothTransport('maliciousRelay'));
    const destination = new RelayNode('destination', createIdentity(), createBluetoothTransport('destination'));
    connectNodes(origin, maliciousRelay);

    const destinationHint = computeDestinationHint(destination.identity.publicKey);
    origin.receiveAdvertisement('maliciousRelay', createRoutingAdvertisement(destination.identity, [destinationHint]));

    const envelope = createDataEnvelope(
      destinationHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 1 },
      text('probe'),
      10
    );
    const result = origin.receiveEnvelope(envelope, null);

    expect(result.outcome).toBe('forwarded');
    expect((result as { outcome: 'forwarded'; to: string }).to).toBe('maliciousRelay');
    expect(origin.neighborTrustScore('maliciousRelay')).toBe(0);

    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(ROUTE_PROBATION_MS + 1);
      const nextEnvelope = createDataEnvelope(
        destinationHint,
        { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 2 },
        text('must not keep probing the dead route'),
        10
      );
      const nextResult = origin.receiveEnvelope(nextEnvelope, null);
      expect(nextResult.outcome).toBe('queued');
    } finally {
      vi.useRealTimers();
    }
  });

  it('promotes only the neighbor that carried a route to a destination-signed ACK', () => {
    const origin = new RelayNode('origin', createIdentity(), createBluetoothTransport('origin'));
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const destination = new RelayNode('destination', createIdentity(), createBluetoothTransport('destination'));
    connectNodes(origin, relay);
    connectNodes(relay, destination);

    const originHint = computeDestinationHint(origin.identity.publicKey);
    const destinationHint = computeDestinationHint(destination.identity.publicKey);
    origin.receiveAdvertisement('relay', createRoutingAdvertisement(destination.identity, [destinationHint]));
    relay.receiveAdvertisement('destination', createRoutingAdvertisement(destination.identity, [destinationHint]));
    relay.receiveAdvertisement('origin', createRoutingAdvertisement(origin.identity, [originHint]));
    // The destination needs a return route to the origin so its signed ACK can
    // traverse the same relay path back to the sender.
    destination.receiveAdvertisement('relay', createRoutingAdvertisement(origin.identity, [originHint]));

    destination.onDelivered((delivered) => {
      destination.sendAck(originHint, delivered.header.messageId);
    });

    const envelope = createDataEnvelope(
      destinationHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 7 },
      text('validated path'),
      10
    );
    const result = origin.receiveEnvelope(envelope, null);
    expect(result.outcome).toBe('forwarded');
    expect(origin.neighborTrustScore('relay')).toBe(1);

    const later = createDataEnvelope(
      destinationHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 8 },
      text('reuse validated path'),
      10
    );
    const laterResult = origin.receiveEnvelope(later, null);
    expect(laterResult.outcome).toBe('forwarded');
    expect((laterResult as { outcome: 'forwarded'; to: string }).to).toBe('relay');
  });
});
