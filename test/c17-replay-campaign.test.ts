import { describe, it, expect, vi } from 'vitest';
import { Encoder } from 'cbor-x';
import { signMessage } from '../src/crypto/keys';
import { createIdentity } from '../src/identity/identity';
import { createSyncEnvelope, createBroadcastEnvelope } from '../src/envelope/envelope';
import { RelayNode, computeDestinationHint, createRoutingAdvertisement } from '../src/routing/routing';
import { createInternetTransport, type SimulatedTransport } from '../src/transport/transport';
import { concatBytes } from '../src/util';
import { createBroadcastMessage, encodeBroadcastMessage } from '../src/broadcast/broadcast';

const cbor = new Encoder();
const SYNC_AUTH_CONTEXT = new TextEncoder().encode('ZAYCOMM_SYNC_AUTH_V1');

function connect(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
}

function makeSignedSync(identity: ReturnType<typeof createIdentity>, inner: unknown): Uint8Array {
  const innerBytes = Uint8Array.from(cbor.encode(inner));
  const signature = signMessage(concatBytes(SYNC_AUTH_CONTEXT, identity.publicKey, innerBytes), identity.privateKey);
  return Uint8Array.from(cbor.encode([identity.publicKey, signature, innerBytes]));
}

describe('C17 replay campaign', () => {
  it('rejects an exact replay of an authenticated sync packet', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connect(a, b);
    b.registerAuthenticatedPeer('a', a.identity.publicKey);

    const envelope = createSyncEnvelope(makeSignedSync(a.identity, [0, []]));
    expect(b.receiveEnvelope(envelope, 'a').outcome).toBe('delivered');
    expect(b.receiveEnvelope(envelope, 'a')).toEqual({ outcome: 'dropped', reason: 'sync packet replayed' });
  });

  it('rejects a sync replay after the authenticated session is torn down and re-established', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connect(a, b);
    b.registerAuthenticatedPeer('a', a.identity.publicKey);

    const envelope = createSyncEnvelope(makeSignedSync(a.identity, [0, []]));
    expect(b.receiveEnvelope(envelope, 'a').outcome).toBe('delivered');
    b.unregisterAuthenticatedPeer('a');
    b.registerAuthenticatedPeer('a', a.identity.publicKey);

    expect(b.receiveEnvelope(envelope, 'a')).toEqual({ outcome: 'dropped', reason: 'sync packet replayed' });
  });

  it('rejects the same authenticated sync packet when replayed through a different neighbor', () => {
    const sender = createIdentity();
    const relay = new RelayNode('relay', createIdentity(), createInternetTransport('relay'));
    const n1 = new RelayNode('n1', createIdentity(), createInternetTransport('n1'));
    const n2 = new RelayNode('n2', createIdentity(), createInternetTransport('n2'));
    connect(relay, n1);
    connect(relay, n2);
    relay.registerAuthenticatedPeer('n1', sender.publicKey);
    relay.registerAuthenticatedPeer('n2', sender.publicKey);

    const envelope = createSyncEnvelope(makeSignedSync(sender, [0, []]));
    expect(relay.receiveEnvelope(envelope, 'n1').outcome).toBe('delivered');
    expect(relay.receiveEnvelope(envelope, 'n2')).toEqual({ outcome: 'dropped', reason: 'sync packet replayed' });
  });

  it('expires replay state so a fresh sync packet can be accepted after the replay window', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connect(a, b);
    b.registerAuthenticatedPeer('a', a.identity.publicKey);
    const envelope = createSyncEnvelope(makeSignedSync(a.identity, [0, []]));

    expect(b.receiveEnvelope(envelope, 'a').outcome).toBe('delivered');
    expect(b.purgeStaleSyncReplayRecords(0)).toBe(1);
    expect(b.receiveEnvelope(envelope, 'a').outcome).toBe('delivered');
  });

  it('keeps routing and broadcast replay domains independent', () => {
    const relay = new RelayNode('relay', createIdentity(), createInternetTransport('relay'));
    const destination = createIdentity();
    const hint = computeDestinationHint(destination.publicKey);
    const ad = createRoutingAdvertisement(destination, [hint]);
    relay.receiveAdvertisement('neighbor-a', ad);
    relay.receiveAdvertisement('neighbor-a', ad);
    expect(relay.purgeStaleRoutingAdvertisements(0)).toBe(1);

    const broadcast = createBroadcastEnvelope(
      encodeBroadcastMessage(createBroadcastMessage(destination, new Uint8Array([1, 2, 3]))),
      2,
    );
    expect(relay.receiveEnvelope(broadcast, 'neighbor-a').outcome).toBe('broadcast');
    expect(relay.receiveEnvelope(broadcast, 'neighbor-a')).toEqual({ outcome: 'dropped', reason: 'broadcast already seen' });
  });
});
