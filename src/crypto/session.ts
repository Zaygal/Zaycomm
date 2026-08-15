// src/crypto/session.ts
// C3: Session establishment gate.
//
// A completed Noise handshake is not considered an authenticated Zaycomm
// session until both sides prove control of their Ed25519 identities and
// bind those identities to the exact X25519 static keys and transcript hash
// produced by that handshake.

import {
  type Identity,
  type SessionIdentityBinding,
  createSessionIdentityBinding,
  verifySessionIdentityBinding,
} from '../identity/identity';
import type { HandshakeResult } from './handshake';

export interface AuthenticatedSession {
  sendKey: Uint8Array;
  receiveKey: Uint8Array;
  rootKey: Uint8Array;
  handshakeHash: Uint8Array;
  localIdentityPublicKey: Uint8Array;
  peerIdentityPublicKey: Uint8Array;
  localX25519PublicKey: Uint8Array;
  peerX25519PublicKey: Uint8Array;
  role: 'initiator' | 'responder';
}

export interface SessionEstablishmentInput {
  identity: Identity;
  localX25519PublicKey: Uint8Array;
  peerX25519PublicKey: Uint8Array;
  expectedPeerIdentityPublicKey: Uint8Array;
  peerBinding: SessionIdentityBinding;
  handshake: HandshakeResult;
  role: 'initiator' | 'responder';
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Creates the local proof that must accompany session establishment.
 * This is deliberately separate from the Noise handshake because the
 * completed handshake hash is only known after the final Noise message.
 */
export function createLocalSessionBinding(
  identity: Identity,
  localX25519PublicKey: Uint8Array,
  handshake: HandshakeResult,
  role: 'initiator' | 'responder'
): SessionIdentityBinding {
  return createSessionIdentityBinding(
    identity,
    localX25519PublicKey,
    handshake.handshakeHash,
    role
  );
}

/**
 * The security boundary for a Zaycomm session.
 *
 * No AuthenticatedSession is returned unless:
 *  1. the local identity really signs the local X25519 key + transcript;
 *  2. the peer identity signature is valid;
 *  3. the peer binding matches the exact handshake hash;
 *  4. the peer binding matches the expected peer X25519 key;
 *  5. the peer binding has the opposite Noise role; and
 *  6. the peer identity is the identity we expected/pinned.
 */
export function establishAuthenticatedSession(
  input: SessionEstablishmentInput,
  localBinding: SessionIdentityBinding
): AuthenticatedSession {
  const expectedPeerRole = input.role === 'initiator' ? 'responder' : 'initiator';

  if (!equalBytes(localBinding.identityPublicKey, input.identity.publicKey)) {
    throw new Error('SESSION_IDENTITY_MISMATCH');
  }

  if (!verifySessionIdentityBinding(
    localBinding,
    input.localX25519PublicKey,
    input.handshake.handshakeHash,
    input.role
  )) {
    throw new Error('LOCAL_SESSION_BINDING_INVALID');
  }

  if (!equalBytes(input.peerBinding.identityPublicKey, input.expectedPeerIdentityPublicKey)) {
    throw new Error('PEER_IDENTITY_MISMATCH');
  }

  if (!verifySessionIdentityBinding(
    input.peerBinding,
    input.peerX25519PublicKey,
    input.handshake.handshakeHash,
    expectedPeerRole
  )) {
    throw new Error('PEER_SESSION_BINDING_INVALID');
  }

  return {
    sendKey: input.handshake.sendKey,
    receiveKey: input.handshake.receiveKey,
    rootKey: input.handshake.rootKey,
    handshakeHash: input.handshake.handshakeHash,
    localIdentityPublicKey: input.identity.publicKey,
    peerIdentityPublicKey: input.peerBinding.identityPublicKey,
    localX25519PublicKey: input.localX25519PublicKey,
    peerX25519PublicKey: input.peerX25519PublicKey,
    role: input.role,
  };
}
