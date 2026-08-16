import { describe, it, expect } from 'vitest';
import { signMessage } from '../src/crypto/keys';
import { createIdentity } from '../src/identity/identity';
import { computeDestinationHint, createRoutingAdvertisement, verifyRoutingAdvertisement, RelayNode } from '../src/routing/routing';
import { createBluetoothTransport } from '../src/transport/transport';
import { concatBytes, u64le } from '../src/util';

const context = new TextEncoder().encode('ZAYCOMM_ROUTING_AD_V1');

function signAdvertisement(identity: ReturnType<typeof createIdentity>, timestamp: number, destinations: Uint8Array[]) {
  const message = concatBytes(context, u64le(timestamp), ...destinations);
  return {
    advertiserPublicKey: identity.publicKey,
    reachableDestinations: destinations,
    timestamp,
    signature: signMessage(message, identity.privateKey),
  };
}

describe('C7 routing advertisement freshness and replay resistance', () => {
  it('rejects a correctly signed advertisement that is too old', () => {
    const identity = createIdentity();
    const hint = computeDestinationHint(identity.publicKey);
    const oldTimestamp = Math.floor(Date.now() / 1000) - 10 * 60;
    const ad = signAdvertisement(identity, oldTimestamp, [hint]);

    expect(verifyRoutingAdvertisement(ad)).toBe(false);
  });

  it('rejects a correctly signed advertisement too far in the future', () => {
    const identity = createIdentity();
    const hint = computeDestinationHint(identity.publicKey);
    const futureTimestamp = Math.floor(Date.now() / 1000) + 120;
    const ad = signAdvertisement(identity, futureTimestamp, [hint]);

    expect(verifyRoutingAdvertisement(ad)).toBe(false);
  });

  it('rejects malformed destination hints before learning a route', () => {
    const identity = createIdentity();
    const malformed = signAdvertisement(identity, Math.floor(Date.now() / 1000), [new Uint8Array(7)]);

    expect(verifyRoutingAdvertisement(malformed)).toBe(false);
  });

  it('deduplicates a replayed advertisement from the same neighbor', () => {
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const neighbor = createIdentity();
    relay.registerAuthenticatedPeer('neighbor-a', neighbor.publicKey);
    const destination = createIdentity();
    const hint = computeDestinationHint(destination.publicKey);
    const ad = createRoutingAdvertisement(destination, [hint]);

    relay.receiveAdvertisement('neighbor-a', ad);
    relay.receiveAdvertisement('neighbor-a', ad);

    expect(relay.purgeStaleRoutingAdvertisements(0)).toBe(1);
  });

  it('keeps the same advertisement usable through distinct neighbors', () => {
    const relay = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const neighborA = createIdentity();
    const neighborB = createIdentity();
    relay.registerAuthenticatedPeer('neighbor-a', neighborA.publicKey);
    relay.registerAuthenticatedPeer('neighbor-b', neighborB.publicKey);
    const destination = createIdentity();
    const hint = computeDestinationHint(destination.publicKey);
    const ad = createRoutingAdvertisement(destination, [hint]);

    relay.receiveAdvertisement('neighbor-a', ad);
    relay.receiveAdvertisement('neighbor-b', ad);

    expect(relay.purgeStaleRoutingAdvertisements(0)).toBe(2);
    expect(relay.hasRoute(hint)).toBe(true);
  });
});
