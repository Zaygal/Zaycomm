// test/identity.test.ts

import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair } from '../src/crypto/keys';
import {
  createIdentity,
  computeFingerprint,
  fingerprintsMatch,
  createDeviceLinkStatement,
  verifyDeviceLinkStatement,
  createDeviceRevocationStatement,
  verifyDeviceRevocationStatement,
  type DeviceRevocationStatement,
} from '../src/identity/identity';

describe('Identity (RFC-0005 Section 1)', () => {
  it('creates a valid Ed25519 identity key pair', () => {
    const identity = createIdentity();
    expect(identity.publicKey.length).toBe(32);
    expect(identity.privateKey.length).toBe(32);
  });
});

describe('Fingerprint (RFC-0005 Section 2, RFC-0004 Section 2.7)', () => {
  it('produces a consistent, correctly formatted fingerprint', () => {
    const identity = createIdentity();
    const fp = computeFingerprint(identity.publicKey);
    expect(fp).toBe(computeFingerprint(identity.publicKey));
    expect(fp).toMatch(/^([0-9a-f]{4} )+[0-9a-f]{4}$/);
  });

  it('produces different fingerprints for different keys', () => {
    const a = createIdentity();
    const b = createIdentity();
    expect(computeFingerprint(a.publicKey)).not.toBe(computeFingerprint(b.publicKey));
  });

  it('matches fingerprints regardless of whitespace differences', () => {
    const identity = createIdentity();
    const fp = computeFingerprint(identity.publicKey);
    expect(fingerprintsMatch(fp, fp.replace(/ /g, ''))).toBe(true);
  });
});

describe('Device linking and revocation (RFC-0005 Section 3)', () => {
  it('creates and verifies a valid device link statement', () => {
    const identity = createIdentity();
    const device = generateEd25519KeyPair();

    const statement = createDeviceLinkStatement(identity, device.publicKey);
    expect(verifyDeviceLinkStatement(identity.publicKey, statement)).toBe(true);
  });

  it('rejects a link statement verified against the wrong identity', () => {
    const identity = createIdentity();
    const impostor = createIdentity();
    const device = generateEd25519KeyPair();

    const statement = createDeviceLinkStatement(identity, device.publicKey);
    expect(verifyDeviceLinkStatement(impostor.publicKey, statement)).toBe(false);
  });

  it('rejects a link statement whose device key was tampered with', () => {
    const identity = createIdentity();
    const device = generateEd25519KeyPair();
    const otherDevice = generateEd25519KeyPair();

    const statement = createDeviceLinkStatement(identity, device.publicKey);
    const tampered = { ...statement, devicePublicKey: otherDevice.publicKey };
    expect(verifyDeviceLinkStatement(identity.publicKey, tampered)).toBe(false);
  });

  it('creates and verifies a valid revocation statement', () => {
    const identity = createIdentity();
    const device = generateEd25519KeyPair();

    const statement = createDeviceRevocationStatement(identity, device.publicKey);
    expect(verifyDeviceRevocationStatement(identity.publicKey, statement)).toBe(true);
  });

  it('domain separation: a link signature does not validate as a revocation', () => {
    const identity = createIdentity();
    const device = generateEd25519KeyPair();

    const linkStatement = createDeviceLinkStatement(identity, device.publicKey);

    const forgedRevocation: DeviceRevocationStatement = {
      devicePublicKey: linkStatement.devicePublicKey,
      timestamp: linkStatement.timestamp,
      signature: linkStatement.signature,
    };

    expect(verifyDeviceRevocationStatement(identity.publicKey, forgedRevocation)).toBe(false);
  });
});