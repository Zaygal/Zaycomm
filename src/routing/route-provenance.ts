// C12: explicit cryptographic binding between destination identity,
// authenticated neighbor, and authenticated session epoch.

import { bytesEqual, bytesToHex } from '../util';

export type RouteProvenance = {
  destinationPublicKey: Uint8Array;
  destinationHint: Uint8Array;
  advertiserPublicKey: Uint8Array;
  neighborId: string;
  sessionEpoch: number;
};

export type RouteTrustBinding = RouteProvenance & {
  validatedAt: number;
};

export function createRouteProvenance(
  destinationPublicKey: Uint8Array,
  destinationHint: Uint8Array,
  advertiserPublicKey: Uint8Array,
  neighborId: string,
  sessionEpoch: number,
): RouteProvenance {
  if (destinationPublicKey.length !== 32) throw new Error('INVALID_DESTINATION_IDENTITY');
  if (destinationHint.length !== 8) throw new Error('INVALID_DESTINATION_HINT');
  if (advertiserPublicKey.length !== 32) throw new Error('INVALID_ADVERTISER_IDENTITY');
  if (!Number.isSafeInteger(sessionEpoch) || sessionEpoch < 0) throw new Error('INVALID_SESSION_EPOCH');
  if (neighborId.length === 0) throw new Error('INVALID_NEIGHBOR');

  return {
    destinationPublicKey: Uint8Array.from(destinationPublicKey),
    destinationHint: Uint8Array.from(destinationHint),
    advertiserPublicKey: Uint8Array.from(advertiserPublicKey),
    neighborId,
    sessionEpoch,
  };
}

export function bindRouteTrust(provenance: RouteProvenance, validatedAt: number = Date.now()): RouteTrustBinding {
  if (!Number.isSafeInteger(validatedAt) || validatedAt < 0) throw new Error('INVALID_VALIDATION_TIME');
  return { ...provenance, validatedAt };
}

export function matchesRouteTrustBinding(
  binding: RouteTrustBinding,
  expected: RouteProvenance,
): boolean {
  return binding.neighborId === expected.neighborId
    && binding.sessionEpoch === expected.sessionEpoch
    && bytesEqual(binding.destinationPublicKey, expected.destinationPublicKey)
    && bytesEqual(binding.destinationHint, expected.destinationHint)
    && bytesEqual(binding.advertiserPublicKey, expected.advertiserPublicKey);
}

export function routeProvenanceKey(provenance: RouteProvenance): string {
  return [
    bytesToHex(provenance.destinationPublicKey),
    bytesToHex(provenance.destinationHint),
    bytesToHex(provenance.advertiserPublicKey),
    provenance.neighborId,
    String(provenance.sessionEpoch),
  ].join(':');
}
