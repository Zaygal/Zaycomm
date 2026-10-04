// src/identity/introduction.ts
// RFC-0005 Section 2.7: QR identity introduction.
//
// A Zaycomm QR code is an identity INTRODUCTION, never an authentication.
// It carries the same public material the human-verifiable fingerprint
// comparison in RFC-0004 Section 2.7 relies on: the node's Ed25519 public
// key, plus a nonce so the exact scan is referenceable. Trust is not
// granted at scan time. `peer-trust.ts` keeps scanning and authenticating
// as separate states, and `introduction-session.ts` only promotes a peer
// once the existing Noise + session-binding gate has actually succeeded.
//
// This module therefore has exactly one job: turn bytes on a screen into a
// validated introduction, or refuse. Every rejection is typed so the UI can
// distinguish "this is not a Zaycomm code" from "this Zaycomm code is
// malformed" without re-parsing untrusted input.

import { randomBytes } from '@noble/hashes/utils.js';
import { computeFingerprint } from './identity';
import type { Identity } from './identity';
import { bytesToHex } from '../util';

export const INTRODUCTION_SCHEME = 'zaycomm';
export const INTRODUCTION_VERSION = 1;

/** Length of an Ed25519 public key in bytes (RFC-0005 Section 1). */
const ED25519_PUBLIC_KEY_LENGTH = 32;

/** Introduction nonces are 16 bytes, matching the existing Pair payload. */
const NONCE_LENGTH = 16;

/** Characters of the hex fingerprint used as the human-visible node id. */
const NODE_ID_LENGTH = 16;

/** The pair payload already emitted by the Pair screen. */
export interface NodeIntroduction {
  scheme: typeof INTRODUCTION_SCHEME;
  version: number;
  nodeId: string;
  publicKey: string;
  /** X25519 static public key. Noise IK needs the responder's static key
   *  before the first message, and RFC-0005 keeps it distinct from the
   *  Ed25519 identity, so the introduction has to carry it. */
  staticKey: string;
  capabilities: string[];
  nonce: string;
}

export type IntroductionErrorCode =
  | 'QR_EMPTY'
  | 'QR_MALFORMED'
  | 'QR_UNSUPPORTED_SCHEME'
  | 'QR_UNSUPPORTED_VERSION'
  | 'QR_INVALID_KEY'
  | 'QR_INVALID_STATIC_KEY'
  | 'QR_NODE_ID_MISMATCH'
  | 'QR_INVALID_NONCE'
  | 'QR_INVALID_CAPABILITIES';

export class IntroductionError extends Error {
  readonly code: IntroductionErrorCode;

  constructor(code: IntroductionErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'IntroductionError';
    this.code = code;
  }
}

function isHex(value: unknown, length: number): value is string {
  return typeof value === 'string' && value.length === length && /^[0-9a-f]+$/i.test(value);
}

/**
 * Derives the human-visible node id for a public key. This must stay
 * identical to the value the Pair screen prints and encodes, otherwise a
 * scanned code cannot be checked for internal consistency.
 */
export function deriveNodeId(publicKey: Uint8Array): string {
  return computeFingerprint(publicKey).replace(/\s/g, '').slice(0, NODE_ID_LENGTH);
}

/** Builds the introduction payload for this device's identity. */
export function createNodeIntroduction(
  identity: Identity,
  staticPublicKey: Uint8Array,
  options: { capabilities?: string[]; nonce?: Uint8Array } = {}
): NodeIntroduction {
  if (staticPublicKey.length !== ED25519_PUBLIC_KEY_LENGTH) {
    throw new IntroductionError('QR_INVALID_STATIC_KEY', 'Static key must be 32 bytes.');
  }
  return {
    scheme: INTRODUCTION_SCHEME,
    version: INTRODUCTION_VERSION,
    nodeId: deriveNodeId(identity.publicKey),
    publicKey: bytesToHex(identity.publicKey),
    staticKey: bytesToHex(staticPublicKey),
    capabilities: options.capabilities ?? ['ble'],
    nonce: bytesToHex(options.nonce ?? randomBytes(NONCE_LENGTH)),
  };
}

export function encodeNodeIntroduction(introduction: NodeIntroduction): string {
  return JSON.stringify(introduction);
}

/**
 * Validates a scanned introduction.
 *
 * Every field is checked against the others, not just against its own type:
 * the advertised node id must actually be the fingerprint of the advertised
 * key. Without that cross-check a code could present a familiar-looking node
 * id next to an attacker's key, and the visible comparison a user makes in
 * person would be worthless.
 */
export function decodeNodeIntroduction(raw: string): NodeIntroduction {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new IntroductionError('QR_EMPTY', 'No QR payload was captured.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new IntroductionError('QR_MALFORMED', 'QR payload is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new IntroductionError('QR_MALFORMED', 'QR payload is not a Zaycomm introduction object.');
  }

  const candidate = parsed as Record<string, unknown>;

  if (candidate.scheme !== INTRODUCTION_SCHEME) {
    throw new IntroductionError(
      'QR_UNSUPPORTED_SCHEME',
      `Not a Zaycomm code (scheme: ${String(candidate.scheme)}).`
    );
  }

  if (candidate.version !== INTRODUCTION_VERSION) {
    throw new IntroductionError(
      'QR_UNSUPPORTED_VERSION',
      `Unsupported introduction version: ${String(candidate.version)}.`
    );
  }

  if (!isHex(candidate.publicKey, ED25519_PUBLIC_KEY_LENGTH * 2)) {
    throw new IntroductionError(
      'QR_INVALID_KEY',
      'Introduction carries no usable Ed25519 public key.'
    );
  }

  if (!isHex(candidate.staticKey, ED25519_PUBLIC_KEY_LENGTH * 2)) {
    throw new IntroductionError(
      'QR_INVALID_STATIC_KEY',
      'Introduction carries no usable X25519 static key.'
    );
  }

  if (typeof candidate.nodeId !== 'string' || candidate.nodeId.length !== NODE_ID_LENGTH) {
    throw new IntroductionError('QR_NODE_ID_MISMATCH', 'Introduction node id is missing or malformed.');
  }

  const publicKey = hexToBytes(candidate.publicKey);
  if (deriveNodeId(publicKey) !== candidate.nodeId.toLowerCase()) {
    throw new IntroductionError(
      'QR_NODE_ID_MISMATCH',
      'Introduction node id does not match the advertised key.'
    );
  }

  if (!isHex(candidate.nonce, NONCE_LENGTH * 2)) {
    throw new IntroductionError('QR_INVALID_NONCE', 'Introduction nonce is missing or malformed.');
  }

  if (
    !Array.isArray(candidate.capabilities) ||
    candidate.capabilities.length === 0 ||
    !candidate.capabilities.every((c) => typeof c === 'string' && c.length > 0)
  ) {
    throw new IntroductionError(
      'QR_INVALID_CAPABILITIES',
      'Introduction capabilities list is missing or malformed.'
    );
  }

  return {
    scheme: INTRODUCTION_SCHEME,
    version: INTRODUCTION_VERSION,
    nodeId: candidate.nodeId.toLowerCase(),
    publicKey: candidate.publicKey.toLowerCase(),
    staticKey: candidate.staticKey.toLowerCase(),
    capabilities: candidate.capabilities as string[],
    nonce: candidate.nonce.toLowerCase(),
  };
}

export type IntroductionDecodeResult =
  | { ok: true; introduction: NodeIntroduction }
  | { ok: false; code: IntroductionErrorCode; message: string };

/** Non-throwing wrapper for UI call sites that must render the reason. */
export function tryDecodeNodeIntroduction(raw: string): IntroductionDecodeResult {
  try {
    return { ok: true, introduction: decodeNodeIntroduction(raw) };
  } catch (error) {
    if (error instanceof IntroductionError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return { ok: false, code: 'QR_MALFORMED', message: 'Unreadable QR payload.' };
  }
}

/** The Ed25519 public key this introduction introduces. */
export function introducedIdentityPublicKey(introduction: NodeIntroduction): Uint8Array {
  return hexToBytes(introduction.publicKey);
}

/** The X25519 static public key a Noise IK handshake should target. */
export function introducedStaticPublicKey(introduction: NodeIntroduction): Uint8Array {
  return hexToBytes(introduction.staticKey);
}

/** True when the introduction advertises the transport we would authenticate over. */
export function introducesCapability(introduction: NodeIntroduction, capability: string): boolean {
  return introduction.capabilities.includes(capability);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
