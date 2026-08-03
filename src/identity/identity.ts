// src/identity/identity.ts
// RFC-0005: Identity Architecture.
//
// A Zaycomm identity is, at its core, just an Ed25519 key pair
// (RFC-0005 Section 1). No username registry, no phone number, no
// email. This file adds three things on top of the raw key pair from
// keys.ts: a human-verifiable fingerprint (Section 2), and signed
// statements for linking and revoking additional devices (Section 3).
//
// Both link and revoke statements are signed with the SAME primary
// key, which creates a real risk: without something distinguishing
// the two message types, a signature valid for one could be replayed
// as if it were valid for the other. Every message signed here is
// prefixed with a distinct context string before signing, exactly to
// prevent that. See the domain-separation test in identity.test.ts
// for a concrete demonstration of what this actually prevents.

import { sha256 } from '@noble/hashes/sha2.js';
import {
  generateEd25519KeyPair,
  signMessage,
  verifySignature,
} from '../crypto/keys';
import { concatBytes, u64le, bytesToHex } from '../util';




const DEVICE_LINK_CONTEXT = 'ZAYCOMM_DEVICE_LINK_V1';
const DEVICE_REVOKE_CONTEXT = 'ZAYCOMM_DEVICE_REVOKE_V1';




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

/** A new Zaycomm identity is nothing more than a fresh Ed25519 key pair. */
export function createIdentity(): Identity {
  const keyPair = generateEd25519KeyPair();
  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
}

/**
 * Human-verifiable fingerprint (RFC-0004 Section 2.7, RFC-0005
 * Section 2). Two people compare this out of band, reading it aloud
 * or scanning a QR code, to upgrade a provisionally-trusted contact
 * (trust on first use) to a verified one.
 */
export function computeFingerprint(publicKey: Uint8Array): string {
  const hash = sha256(publicKey);
  const hex = bytesToHex(hash);
  return hex.match(/.{1,4}/g)!.join(' ');
}

/** Compares two fingerprints ignoring whitespace/formatting differences. */
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

/**
 * The primary identity vouches for a new device (RFC-0005 Section 3).
 * Other users' clients treat a validly-linked device key as equivalent
 * to the primary identity for sending and receiving.
 */
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

/**
 * Revokes a single linked device (lost phone, etc.) without needing
 * to change the identity itself, per RFC-0005 Section 3. Propagates
 * through the mesh the same way any other signed protocol message
 * does, no central directory required.
 */
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