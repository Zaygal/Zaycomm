// src/identity/identity.ts
// RFC-0005: Identity Architecture.
//
// A Zaycomm identity is, at its core, just an Ed25519 key pair
// (RFC-0005 Section 1). No username registry, no phone number, no
// email. This file adds three things on top of the raw key pair from
// keys.ts: a human-verifiable fingerprint (Section 2), signed
// statements for linking/revoking devices (Section 3), and a
// cryptographic binding between an Ed25519 identity and a completed
// Noise/X25519 session.

import { sha256 } from '@noble/hashes/sha2.js';
import {
  generateEd25519KeyPair,
  signMessage,
  verifySignature,
} from '../crypto/keys';
import { concatBytes, u64le, bytesToHex } from '../util';

const DEVICE_LINK_CONTEXT = 'ZAYCOMM_DEVICE_LINK_V1';
const DEVICE_REVOKE_CONTEXT = 'ZAYCOMM_DEVICE_REVOKE_V1';
const SESSION_BINDING_CONTEXT = 'ZAYCOMM_SESSION_BINDING_V1';

export interface Identity {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface DeviceLinkStatement {
  devicePublicKey: Uint8Array;
  timestamp: number;
  signature: Uint8Array;
}

export interface DeviceRevocationStatement {
  devicePublicKey: Uint8Array;
  timestamp: number;
  signature: Uint8Array;
}

/** A proof that an Ed25519 identity controls the X25519 static key used by a specific Noise session. */
export interface SessionIdentityBinding {
  identityPublicKey: Uint8Array;
  x25519PublicKey: Uint8Array;
  handshakeHash: Uint8Array;
  role: 'initiator' | 'responder';
  signature: Uint8Array;
}

export function createIdentity(): Identity {
  const keyPair = generateEd25519KeyPair();
  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
}

export function computeFingerprint(publicKey: Uint8Array): string {
  const hash = sha256(publicKey);
  const hex = bytesToHex(hash);
  return hex.match(/.{1,4}/g)!.join(' ');
}

export function fingerprintsMatch(a: string, b: string): boolean {
  return a.replace(/\s/g, '') === b.replace(/\s/g, '');
}

function buildLinkMessage(devicePublicKey: Uint8Array, timestamp: number): Uint8Array {
  const context = new TextEncoder().encode(DEVICE_LINK_CONTEXT);
  return concatBytes(context, devicePublicKey, u64le(timestamp));
}

function buildRevocationMessage(devicePublicKey: Uint8Array, timestamp: number): Uint8Array {
  const context = new TextEncoder().encode(DEVICE_REVOKE_CONTEXT);
  return concatBytes(context, devicePublicKey, u64le(timestamp));
}

function buildSessionBindingMessage(
  x25519PublicKey: Uint8Array,
  handshakeHash: Uint8Array,
  role: 'initiator' | 'responder'
): Uint8Array {
  const context = new TextEncoder().encode(SESSION_BINDING_CONTEXT);
  const roleBytes = new TextEncoder().encode(role);
  return concatBytes(context, roleBytes, x25519PublicKey, handshakeHash);
}

export function createDeviceLinkStatement(
  primaryIdentity: Identity,
  devicePublicKey: Uint8Array
): DeviceLinkStatement {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = buildLinkMessage(devicePublicKey, timestamp);
  const signature = signMessage(message, primaryIdentity.privateKey);
  return { devicePublicKey, timestamp, signature };
}

export function verifyDeviceLinkStatement(
  primaryPublicKey: Uint8Array,
  statement: DeviceLinkStatement
): boolean {
  const message = buildLinkMessage(statement.devicePublicKey, statement.timestamp);
  return verifySignature(statement.signature, message, primaryPublicKey);
}

export function createDeviceRevocationStatement(
  primaryIdentity: Identity,
  devicePublicKey: Uint8Array
): DeviceRevocationStatement {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = buildRevocationMessage(devicePublicKey, timestamp);
  const signature = signMessage(message, primaryIdentity.privateKey);
  return { devicePublicKey, timestamp, signature };
}

export function verifyDeviceRevocationStatement(
  primaryPublicKey: Uint8Array,
  statement: DeviceRevocationStatement
): boolean {
  const message = buildRevocationMessage(statement.devicePublicKey, statement.timestamp);
  return verifySignature(statement.signature, message, primaryPublicKey);
}

/**
 * Creates a proof binding the application's Ed25519 identity to the
 * X25519 static key and exact completed Noise handshake transcript.
 * The handshake hash already commits to both static keys and all
 * handshake messages, so the proof cannot be transplanted to another
 * session without invalidating the signature.
 */
export function createSessionIdentityBinding(
  identity: Identity,
  x25519PublicKey: Uint8Array,
  handshakeHash: Uint8Array,
  role: 'initiator' | 'responder'
): SessionIdentityBinding {
  const message = buildSessionBindingMessage(x25519PublicKey, handshakeHash, role);
  const signature = signMessage(message, identity.privateKey);
  return {
    identityPublicKey: identity.publicKey,
    x25519PublicKey,
    handshakeHash,
    role,
    signature,
  };
}

/**
 * Verifies both the Ed25519 signature and that the claimed X25519 static
 * key/hash/role are exactly the values expected for this Noise session.
 */
export function verifySessionIdentityBinding(
  binding: SessionIdentityBinding,
  expectedX25519PublicKey: Uint8Array,
  expectedHandshakeHash: Uint8Array,
  expectedRole: 'initiator' | 'responder'
): boolean {
  if (binding.role !== expectedRole) return false;
  if (binding.x25519PublicKey.length !== expectedX25519PublicKey.length) return false;
  if (binding.handshakeHash.length !== expectedHandshakeHash.length) return false;

  for (let i = 0; i < expectedX25519PublicKey.length; i++) {
    if (binding.x25519PublicKey[i] !== expectedX25519PublicKey[i]) return false;
  }
  for (let i = 0; i < expectedHandshakeHash.length; i++) {
    if (binding.handshakeHash[i] !== expectedHandshakeHash[i]) return false;
  }

  const message = buildSessionBindingMessage(
    binding.x25519PublicKey,
    binding.handshakeHash,
    binding.role
  );
  return verifySignature(binding.signature, message, binding.identityPublicKey);
}