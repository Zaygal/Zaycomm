import { describe, expect, it } from 'vitest';
import { createIdentity } from '../src/identity/identity';
import { createDataEnvelope, openDataEnvelope } from '../src/envelope/envelope';
import { computeDestinationHint, createRoutingAdvertisement, RelayNode } from '../src/routing/routing';
import { createUdpTransport, type UdpTransport } from '../src/transport/udp';

const text = (value: string) => new TextEncoder().encode(value);

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('TIMED_OUT_WAITING_FOR_NODE_COMMUNICATION');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function closeAll(...transports: UdpTransport[]): Promise<void> {
  await Promise.all(transports.map((transport) => transport.close()));
}

describe('C22 real node communication', () => {
  it('carries A → relay → B and the destination-signed ACK returns B → relay → A over real UDP sockets', async () => {
    const aliceTransport = createUdpTransport('alice');
    const relayTransport = createUdpTransport('relay');
    const bobTransport = createUdpTransport('bob');
    await Promise.all([aliceTransport.ready(), relayTransport.ready(), bobTransport.ready()]);

    try {
      aliceTransport.addPeer('relay', relayTransport.address);
      relayTransport.addPeer('alice', aliceTransport.address);
      relayTransport.addPeer('bob', bobTransport.address);
      bobTransport.addPeer('relay', relayTransport.address);

      const alice = new RelayNode('alice', createIdentity(), aliceTransport);
      const relay = new RelayNode('relay', createIdentity(), relayTransport);
      const bob = new RelayNode('bob', createIdentity(), bobTransport);

      alice.registerAuthenticatedPeer('relay', relay.identity.publicKey);
      relay.registerAuthenticatedPeer('alice', alice.identity.publicKey);
      relay.registerAuthenticatedPeer('bob', bob.identity.publicKey);
      bob.registerAuthenticatedPeer('relay', relay.identity.publicKey);

      const aliceHint = computeDestinationHint(alice.identity.publicKey);
      const bobHint = computeDestinationHint(bob.identity.publicKey);
      relay.receiveAdvertisement('bob', createRoutingAdvertisement(bob.identity, [bobHint]));
      alice.receiveAdvertisement('relay', createRoutingAdvertisement(relay.identity, [bobHint]));
      relay.receiveAdvertisement('alice', createRoutingAdvertisement(alice.identity, [aliceHint]));
      bob.receiveAdvertisement('relay', createRoutingAdvertisement(relay.identity, [aliceHint]));

      let delivered = false;
      let acknowledged = false;
      bob.onDelivered((envelope) => {
        delivered = true;
        const opened = openDataEnvelope(envelope);
        expect(new TextDecoder().decode(opened.ciphertext)).toBe('hello real nodes');
        bob.sendAck(aliceHint, envelope.header.messageId);
      });
      alice.onAckReceived(() => { acknowledged = true; });

      const envelope = createDataEnvelope(
        bobHint,
        { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
        text('hello real nodes'),
        8,
      );

      expect(alice.sendEnvelope(envelope)).toEqual({ outcome: 'forwarded', to: 'relay' });
      await waitFor(() => delivered && acknowledged);

      expect(delivered).toBe(true);
      expect(acknowledged).toBe(true);
      expect(alice.neighborTrustScore('relay')).toBeGreaterThan(0);
      expect(aliceTransport.discoverNeighbors()).toEqual(['relay']);
      expect(relayTransport.discoverNeighbors()).toEqual(['alice', 'bob']);
    } finally {
      await closeAll(aliceTransport, relayTransport, bobTransport);
    }
  });

  it('keeps the transport opaque and enforces its configured MTU', async () => {
    const sender = createUdpTransport('sender', { maxTransmissionUnit: 32 });
    const receiver = createUdpTransport('receiver', { maxTransmissionUnit: 32 });
    await Promise.all([sender.ready(), receiver.ready()]);
    try {
      sender.addPeer('receiver', receiver.address);
      receiver.addPeer('sender', sender.address);
      let received: Uint8Array | null = null;
      receiver.onReceive((_from, frame) => { received = frame; });

      const payload = new Uint8Array([1, 2, 3, 4]);
      expect(sender.send('receiver', payload)).toBe(true);
      await waitFor(() => received !== null);
      expect(Array.from(received!)).toEqual([1, 2, 3, 4]);
      expect(sender.send('receiver', new Uint8Array(33))).toBe(false);
    } finally {
      await closeAll(sender, receiver);
    }
  });
});
