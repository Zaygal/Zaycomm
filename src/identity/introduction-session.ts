// src/identity/introduction-session.ts
// RFC-0004 Section 2.3 + RFC-0005: QR introduction to authenticated peer.
//
// This is the missing half of the QR flow. The Pair screen has always
// emitted an introduction; nothing consumed one. This module consumes it.
//
// The roles are deliberately asymmetric, because the assurances are:
//
//   Scanner (initiator)  scanned a code, so it holds an EXPECTATION. It pins
//                        expectedPeerIdentityPublicKey to the encoded key and
//                        the existing session gate rejects anything else.
//   Displayer (responder) holds no prior expectation. It authenticates on
//                        first contact, and additionally requires that the
//                        initiator's introduction and its session binding name
//                        the same key, so the two independent statements agree.
//
// Neither side is trusted until establishAuthenticatedSession returns. Nothing
// here re-implements cryptography: the Noise IK handshake, the identity
// binding and the session gate are the existing implementations, unchanged.

import {
  createLocalSessionBinding,
  establishAuthenticatedSession,
  type AuthenticatedSession,
} from '../crypto/session';
import {
  initiatorReadMessage2,
  initiatorWriteMessage1,
  responderReadMessage1,
  responderWriteMessage2,
  type HandshakeMessage2,
  type HandshakeResult,
} from '../crypto/handshake';
import type { X25519KeyPair } from '../crypto/keys';
import { Encoder } from 'cbor-x';
import type { Identity, SessionIdentityBinding } from './identity';
import { bytesToHex, concatBytes } from '../util';
import {
  createNodeIntroduction,
  decodeNodeIntroduction,
  encodeNodeIntroduction,
  introducedIdentityPublicKey,
  introducedStaticPublicKey,
  introducesCapability,
  type NodeIntroduction,
} from './introduction';

/** Opaque frame channel: one send, one receive, in order. BLE satisfies this. */
export interface IntroductionChannel {
  send(frame: Uint8Array): Promise<void>;
  receive(): Promise<Uint8Array>;
}

export interface LocalNodeKeys {
  identity: Identity;
  staticKeyPair: X25519KeyPair;
}

export type IntroductionSessionErrorCode =
  | 'INTRODUCTION_NOT_USABLE'
  | 'PEER_INTRODUCTION_MISMATCH'
  | 'HANDSHAKE_FAILED'
  | 'CHANNEL_FAILED';

export class IntroductionSessionError extends Error {
  readonly code: IntroductionSessionErrorCode;

  constructor(code: IntroductionSessionErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'IntroductionSessionError';
    this.code = code;
  }
}

function packFields(...fields: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const field of fields) {
    const length = new Uint8Array(2);
    new DataView(length.buffer).setUint16(0, field.length, false);
    parts.push(length, field);
  }
  return concatBytes(...parts);
}

function unpackFields(frame: Uint8Array, count: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 2 > frame.length) throw new IntroductionSessionError('HANDSHAKE_FAILED', 'Truncated frame.');
    const view = new DataView(frame.buffer, frame.byteOffset + offset, 2);
    const length = view.getUint16(0, false);
    offset += 2;
    if (offset + length > frame.length) throw new IntroductionSessionError('HANDSHAKE_FAILED', 'Truncated frame.');
    out.push(frame.slice(offset, offset + length));
    offset += length;
  }
  return out;
}

function encodeIdentityMessage(introduction: NodeIntroduction, binding: Uint8Array): Uint8Array {
  const intro = new TextEncoder().encode(encodeNodeIntroduction(introduction));
  return packFields(intro, binding);
}

/**
 * The post-handshake exchange carries an introduction AND the session binding,
 * because the binding alone would make the "expected peer identity" check
 * vacuous. Requiring the encoded introduction to name the same key the binding
 * signs makes the two statements corroborate each other.
 */
function decodeIdentityMessage(frame: Uint8Array): { introduction: NodeIntroduction; binding: Uint8Array } {
  const [introBytes, binding] = unpackFields(frame, 2);
  let introduction: NodeIntroduction;
  try {
    introduction = decodeNodeIntroduction(new TextDecoder().decode(introBytes));
  } catch (error) {
    throw new IntroductionSessionError(
      'PEER_INTRODUCTION_MISMATCH',
      `Peer sent an unusable introduction: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return { introduction, binding };
}

// Bindings carry raw keys and signatures, so they travel as CBOR like every
// other signed struct in the protocol. JSON would reduce Uint8Array fields to
// index-keyed objects and silently drop the binary content.
const cbor = new Encoder();

function decodeBinding(bytes: Uint8Array): SessionIdentityBinding {
  return cbor.decode(bytes) as SessionIdentityBinding;
}

function encodeBinding(binding: SessionIdentityBinding): Uint8Array {
  return Uint8Array.from(cbor.encode(binding));
}

function assertUsable(introduction: NodeIntroduction, requiredCapability: string): void {
  if (!introducesCapability(introduction, requiredCapability)) {
    throw new IntroductionSessionError(
      'INTRODUCTION_NOT_USABLE',
      `Peer introduction does not advertise the "${requiredCapability}" transport.`
    );
  }
}

export interface ScannedPeerAuthentication {
  local: LocalNodeKeys;
  /** The introduction decoded from the scanned QR code. */
  introduction: NodeIntroduction;
  channel: IntroductionChannel;
  /** Transport this session actually runs over, e.g. 'ble'. */
  requiredCapability?: string;
}

/**
 * Scanner side. Pins the identity from the scanned code and completes the
 * handshake. Resolves only when the peer has proved control of the advertised
 * Ed25519 identity; any other outcome throws and the peer stays untrusted.
 */
export async function authenticateScannedPeer(
  input: ScannedPeerAuthentication
): Promise<AuthenticatedSession> {
  const required = input.requiredCapability ?? 'ble';
  assertUsable(input.introduction, required);

  const expectedPeerIdentity = introducedIdentityPublicKey(input.introduction);
  const peerStaticPublicKey = introducedStaticPublicKey(input.introduction);
  const localIntroduction = createNodeIntroduction(input.local.identity, input.local.staticKeyPair.publicKey);

  const { message, state, initiatorEphemeral } = initiatorWriteMessage1(
    input.local.staticKeyPair,
    peerStaticPublicKey,
    new TextEncoder().encode(encodeNodeIntroduction(localIntroduction))
  );

  try {
    await input.channel.send(
      packFields(message.ephemeralPublicKey, message.encryptedStaticKey, message.encryptedPayload)
    );
  } catch (error) {
    throw new IntroductionSessionError('CHANNEL_FAILED', `Handshake send failed: ${String(error)}`);
  }

  let responderEphemeral: Uint8Array;
  let responderPayload: Uint8Array;
  try {
    [responderEphemeral, responderPayload] = unpackFields(await input.channel.receive(), 2);
  } catch (error) {
    throw new IntroductionSessionError('CHANNEL_FAILED', `Handshake receive failed: ${String(error)}`);
  }

  let handshake: HandshakeResult;
  try {
    handshake = initiatorReadMessage2(state, input.local.staticKeyPair, initiatorEphemeral, {
      ephemeralPublicKey: responderEphemeral,
      encryptedPayload: responderPayload,
    });
  } catch (error) {
    throw new IntroductionSessionError('HANDSHAKE_FAILED', `Handshake failed: ${String(error)}`);
  }

  const localBinding = createLocalSessionBinding(
    input.local.identity,
    input.local.staticKeyPair.publicKey,
    handshake,
    'initiator'
  );

  await input.channel.send(encodeIdentityMessage(localIntroduction, encodeBinding(localBinding)));

  const { introduction: responderIntroduction, binding: responderBindingBytes } = decodeIdentityMessage(
    await input.channel.receive()
  );

  // The responder's introduction must be the one that was scanned. A peer that
  // completed the handshake with the advertised transport key but names a
  // different identity here is refused before the session gate is reached.
  if (responderIntroduction.publicKey !== input.introduction.publicKey) {
    throw new IntroductionSessionError(
      'PEER_INTRODUCTION_MISMATCH',
      'Authenticated peer does not match the scanned introduction.'
    );
  }

  return establishAuthenticatedSession(
    {
      identity: input.local.identity,
      localX25519PublicKey: input.local.staticKeyPair.publicKey,
      peerX25519PublicKey: peerStaticPublicKey,
      expectedPeerIdentityPublicKey: expectedPeerIdentity,
      peerBinding: decodeBinding(responderBindingBytes),
      handshake,
      role: 'initiator',
    },
    localBinding
  );
}

export interface ResponderAuthentication {
  local: LocalNodeKeys;
  /** The peer's introduction, when this device also scanned the peer's code. */
  expectedIntroduction?: NodeIntroduction;
  channel: IntroductionChannel;
  /** Transport this session actually runs over, e.g. 'ble'. */
  requiredCapability?: string;
}

/**
 * Displayer side. It holds no prior expectation unless it also scanned the
 * peer's code, so the expectation comes from the introduction the initiator
 * sent INSIDE the authenticated handshake, cross-checked against the session
 * binding. Possession is still proved through the unchanged session gate.
 */
export async function respondToScannedPeer(
  input: ResponderAuthentication
): Promise<AuthenticatedSession> {
  const required = input.requiredCapability ?? 'ble';

  const [initiatorEphemeral, initiatorEncryptedStatic, initiatorEncryptedPayload] = unpackFields(
    await input.channel.receive(),
    3
  );

  let opening;
  try {
    opening = responderReadMessage1(input.local.staticKeyPair, {
      ephemeralPublicKey: initiatorEphemeral,
      encryptedStaticKey: initiatorEncryptedStatic,
      encryptedPayload: initiatorEncryptedPayload,
    });
  } catch (error) {
    throw new IntroductionSessionError('HANDSHAKE_FAILED', `Handshake failed: ${String(error)}`);
  }

  const peerIntroduction = decodeNodeIntroduction(new TextDecoder().decode(opening.payload));
  assertUsable(peerIntroduction, required);

  if (
    input.expectedIntroduction &&
    input.expectedIntroduction.publicKey !== peerIntroduction.publicKey
  ) {
    throw new IntroductionSessionError(
      'PEER_INTRODUCTION_MISMATCH',
      'Session peer does not match the introduction this device scanned.'
    );
  }

  const localIntroduction = createNodeIntroduction(input.local.identity, input.local.staticKeyPair.publicKey);

  const m2 = responderWriteMessage2(
    opening.state,
    initiatorEphemeral,
    opening.initiatorStaticPublicKey,
    new TextEncoder().encode(encodeNodeIntroduction(localIntroduction))
  );

  try {
    await input.channel.send(packFields(m2.message.ephemeralPublicKey, m2.message.encryptedPayload));
  } catch (error) {
    throw new IntroductionSessionError('CHANNEL_FAILED', `Handshake send failed: ${String(error)}`);
  }

  const localBinding = createLocalSessionBinding(
    input.local.identity,
    input.local.staticKeyPair.publicKey,
    m2.result,
    'responder'
  );

  const { introduction: claimedIntroduction, binding: peerBindingBytes } = decodeIdentityMessage(
    await input.channel.receive()
  );

  const peerBinding = decodeBinding(peerBindingBytes);
  const expectedPeerIdentity = readBindingIdentity(peerBinding, claimedIntroduction);

  const session = establishAuthenticatedSession(
    {
      identity: input.local.identity,
      localX25519PublicKey: input.local.staticKeyPair.publicKey,
      peerX25519PublicKey: opening.initiatorStaticPublicKey,
      expectedPeerIdentityPublicKey: expectedPeerIdentity,
      peerBinding,
      handshake: m2.result,
      role: 'responder',
    },
    localBinding
  );

  await input.channel.send(encodeIdentityMessage(localIntroduction, encodeBinding(localBinding)));
  return session;
}

/**
 * Requires the introduction and the binding to name the same key before the
 * gate runs, so the two independent statements cannot be mixed and matched.
 */
function readBindingIdentity(
  binding: SessionIdentityBinding,
  introduction: NodeIntroduction
): Uint8Array {
  const fromIntroduction = introducedIdentityPublicKey(introduction);
  if (!binding || !(binding.identityPublicKey instanceof Uint8Array)) {
    throw new IntroductionSessionError('PEER_INTRODUCTION_MISMATCH', 'Peer sent no usable session binding.');
  }
  if (bytesToHex(binding.identityPublicKey) !== bytesToHex(fromIntroduction)) {
    throw new IntroductionSessionError(
      'PEER_INTRODUCTION_MISMATCH',
      'Peer session binding does not correspond to its introduction.'
    );
  }
  return fromIntroduction;
}
