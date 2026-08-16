import { describe, expect, it } from 'vitest';
import { createIdentity } from '../src/identity/identity';
import {
  bindRouteTrust,
  createRouteProvenance,
  matchesRouteTrustBinding,
  routeProvenanceKey,
} from '../src/routing/route-provenance';

const hint = (seed: number) => new Uint8Array(8).fill(seed);

describe('C12 routing/trust cryptographic binding', () => {
  it('binds destination identity, destination hint, advertiser, neighbor and session epoch', () => {
    const destination = createIdentity();
    const advertiser = createIdentity();
    const provenance = createRouteProvenance(
      destination.publicKey,
      hint(1),
      advertiser.publicKey,
      'relay',
      100,
    );
    const binding = bindRouteTrust(provenance, 1234);

    expect(matchesRouteTrustBinding(binding, provenance)).toBe(true);
  });

  it('rejects a route when the authenticated neighbor changes', () => {
    const destination = createIdentity();
    const advertiser = createIdentity();
    const binding = bindRouteTrust(createRouteProvenance(
      destination.publicKey, hint(1), advertiser.publicKey, 'relay-a', 100,
    ));

    const forged = createRouteProvenance(
      destination.publicKey, hint(1), advertiser.publicKey, 'relay-b', 100,
    );

    expect(matchesRouteTrustBinding(binding, forged)).toBe(false);
  });

  it('rejects a route when the authenticated session epoch changes', () => {
    const destination = createIdentity();
    const advertiser = createIdentity();
    const binding = bindRouteTrust(createRouteProvenance(
      destination.publicKey, hint(1), advertiser.publicKey, 'relay', 100,
    ));

    const staleSession = createRouteProvenance(
      destination.publicKey, hint(1), advertiser.publicKey, 'relay', 101,
    );

    expect(matchesRouteTrustBinding(binding, staleSession)).toBe(false);
  });

  it('rejects identity substitution even when the neighbor and session are unchanged', () => {
    const destination = createIdentity();
    const advertiser = createIdentity();
    const impostor = createIdentity();
    const binding = bindRouteTrust(createRouteProvenance(
      destination.publicKey, hint(1), advertiser.publicKey, 'relay', 100,
    ));

    const forged = createRouteProvenance(
      destination.publicKey, hint(1), impostor.publicKey, 'relay', 100,
    );

    expect(matchesRouteTrustBinding(binding, forged)).toBe(false);
  });

  it('produces distinct stable keys for different route provenance', () => {
    const destination = createIdentity();
    const advertiser = createIdentity();
    const a = createRouteProvenance(destination.publicKey, hint(1), advertiser.publicKey, 'relay', 100);
    const b = createRouteProvenance(destination.publicKey, hint(1), advertiser.publicKey, 'relay', 101);

    expect(routeProvenanceKey(a)).not.toBe(routeProvenanceKey(b));
  });
});
