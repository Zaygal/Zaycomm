import { describe, expect, it } from 'vitest';
import { createIdentity } from '../src/identity/identity';
import { createDataEnvelope, openDataEnvelope } from '../src/envelope/envelope';
import {
  computeDestinationHint,
  createRoutingAdvertisement,
  RelayNode,
} from '../src/routing/routing';
import { createBluetoothTransport, type SimulatedTransport } from '../src/transport/transport';

const text = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);

function connect(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
}

function buildThreeNodePath() {
  const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
  const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
  const bob = new RelayNode('bob', createIdentity(), createBluetoothTransport('bob'));

  connect(alice, relay);
  connect(relay, bob);

  alice.registerAuthenticatedPeer('relay', relay.identity.publicKey);
  relay.registerAuthenticatedPeer('alice', alice.identity.publicKey);
  relay.registerAuthenticatedPeer('bob', bob.identity.publicKey);
  bob.registerAuthenticatedPeer('relay', relay.identity.publicKey);

  const aliceHint = computeDestinationHint(alice.identity.publicKey);
  const bobHint = computeDestinationHint(bob.identity.publicKey);

  // Each hop authenticates the identity that directly advertised reachability.
  relay.receiveAdvertisement('bob', createRoutingAdvertisement(bob.identity, [bobHint]));
  alice.receiveAdvertisement('relay', createRoutingAdvertisement(relay.identity, [bobHint]));

  relay.receiveAdvertisement('alice', createRoutingAdvertisement(alice.identity, [aliceHint]));
  bob.receiveAdvertisement('relay', createRoutingAdvertisement(relay.identity, [aliceHint]));

  return { alice, relay, bob, aliceHint, bobHint };
}

describe('C12/C14 real node communication', () => {
  it('completes A → B → C → B → A with destination-signed ACK and relay-bound trust', () => {
    const { alice, relay, bob, aliceHint, bobHint } = buildThreeNodePath();
    let delivered = false;
    let acknowledged = false;

    bob.onDelivered((envelope) => {
      delivered = true;
      const opened = openDataEnvelope(envelope);
      expect(decode(opened.ciphertext)).toBe('hello through relay');
      bob.sendAck(aliceHint, envelope.header.messageId);
    });
    alice.onAckReceived(() => { acknowledged = true; });

    const envelope = createDataEnvelope(
      bobHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
      text('hello through relay'),
      8,
    );

    const result = alice.sendEnvelope(envelope);

    expect(result).toEqual({ outcome: 'forwarded', to: 'relay' });
    expect(delivered).toBe(true);
    expect(acknowledged).toBe(true);
    expect(relay.neighborTrustScore('bob')).toBeGreaterThan(0);
    expect(alice.neighborTrustScore('relay')).toBeGreaterThan(0);
  });

  it('does not require the destination signer to equal the relay neighbor', () => {
    const { alice, bob, aliceHint, bobHint } = buildThreeNodePath();
    let acknowledged = false;
    alice.onAckReceived(() => { acknowledged = true; });

    const envelope = createDataEnvelope(
      bobHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
      text('binding check'),
      8,
    );
    bob.onDelivered((received) => bob.sendAck(aliceHint, received.header.messageId));

    alice.sendEnvelope(envelope);

    expect(acknowledged).toBe(true);
    expect(alice.isAuthenticatedPeer('relay')).toBe(true);
  });

  it('performs encrypted store-forward synchronization between real nodes', () => {
    const alice = new RelayNode('alice', createIdentity(), createBluetoothTransport('alice'));
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const bob = new RelayNode('bob', createIdentity(), createBluetoothTransport('bob'));

    connect(alice, relay);
    connect(relay, bob);

    const bobHint = computeDestinationHint(bob.identity.publicKey);

    const sessionId = 'c14-a-b';
    const aToB = new Uint8Array(32).fill(0x11);
    const bToA = new Uint8Array(32).fill(0x22);

    alice.registerAuthenticatedSession('relay', relay.identity.publicKey, {
      sessionId,
      sendKey: aToB,
      receiveKey: bToA,
    });
    relay.registerAuthenticatedSession('alice', alice.identity.publicKey, {
      sessionId,
      sendKey: bToA,
      receiveKey: aToB,
    });
    relay.registerAuthenticatedPeer('bob', bob.identity.publicKey);
    bob.registerAuthenticatedPeer('relay', relay.identity.publicKey);

    relay.receiveAdvertisement('bob', createRoutingAdvertisement(bob.identity, [bobHint]));

    const queued = createDataEnvelope(
      bobHint,
      { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 1 },
      text('synced payload'),
      8,
    );
    expect(alice.receiveEnvelope(queued, null).outcome).toBe('queued');
    expect(alice.queueSize()).toBe(1);

    let deliveredAtBob = false;
    bob.onDelivered((envelope) => {
      deliveredAtBob = true;
      expect(envelope.header.destinationHint).toEqual(bobHint);
    });

    expect(alice.initiateSync('relay')).toBe(true);
    expect(deliveredAtBob).toBe(true);
    expect(alice.queueSize()).toBe(1);
  });
});
