import { describe, it, expect } from 'vitest';
import { Encoder } from 'cbor-x';
import { signMessage } from '../src/crypto/keys';
import { createIdentity } from '../src/identity/identity';
import { createSyncEnvelope } from '../src/envelope/envelope';
import { RelayNode } from '../src/routing/routing';
import { createInternetTransport, type SimulatedTransport } from '../src/transport/transport';
import { concatBytes } from '../src/util';

const cbor = new Encoder();
const SYNC_AUTH_CONTEXT = new TextEncoder().encode('ZAYCOMM_SYNC_AUTH_V1');

function connectTransportOnly(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
}

function makeSignedSync(identity: ReturnType<typeof createIdentity>, inner: unknown): Uint8Array {
  const innerBytes = Uint8Array.from(cbor.encode(inner));
  const signature = signMessage(concatBytes(SYNC_AUTH_CONTEXT, identity.publicKey, innerBytes), identity.privateKey);
  return Uint8Array.from(cbor.encode([identity.publicKey, signature, innerBytes]));
}

describe('C8 store-forward sync authorization', () => {
  it('rejects sync from a transport neighbor with no authenticated session', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connectTransportOnly(a, b);

    const envelope = createSyncEnvelope(makeSignedSync(a.identity, [0, []]));
    const result = b.receiveEnvelope(envelope, 'a');

    expect(result.outcome).toBe('dropped');
    expect(b.queueSize()).toBe(0);
  });

  it('rejects a signed sync from an identity different from the authenticated peer', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const attacker = createIdentity();
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connectTransportOnly(a, b);
    b.registerAuthenticatedPeer('a', a.identity.publicKey);

    const forged = createSyncEnvelope(makeSignedSync(attacker, [0, []]));
    const result = b.receiveEnvelope(forged, 'a');

    expect(result.outcome).toBe('dropped');
    expect(b.queueSize()).toBe(0);
  });

  it('does not initiate sync toward an unauthenticated neighbor', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connectTransportOnly(a, b);

    expect(a.initiateSync('b')).toBe(false);
  });

  it('accepts a correctly signed sync only when the sender identity is registered for that neighbor', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connectTransportOnly(a, b);
    b.registerAuthenticatedPeer('a', a.identity.publicKey);

    const result = b.receiveEnvelope(createSyncEnvelope(makeSignedSync(a.identity, [0, []])), 'a');

    expect(result.outcome).toBe('delivered');
  });
});
