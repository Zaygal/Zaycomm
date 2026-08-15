import { describe, expect, it } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { createIdentity } from '../src/identity/identity';
import {
  createLocalSessionBinding,
  establishAuthenticatedSession,
  type SessionEstablishmentInput,
} from '../src/crypto/session';
import type { HandshakeResult } from '../src/crypto/handshake';

function handshake(): HandshakeResult {
  return {
    sendKey: new Uint8Array(32).fill(1),
    receiveKey: new Uint8Array(32).fill(2),
    rootKey: new Uint8Array(32).fill(3),
    handshakeHash: new Uint8Array(32).fill(4),
  };
}

describe('C3 session establishment', () => {
  function setup() {
    const alice = createIdentity();
    const bob = createIdentity();
    const aliceX = generateX25519KeyPair();
    const bobX = generateX25519KeyPair();
    const hs = handshake();

    const aliceBinding = createLocalSessionBinding(alice, aliceX.publicKey, hs, 'initiator');
    const bobBinding = createLocalSessionBinding(bob, bobX.publicKey, hs, 'responder');

    const input: SessionEstablishmentInput = {
      identity: alice,
      localX25519PublicKey: aliceX.publicKey,
      peerX25519PublicKey: bobX.publicKey,
      expectedPeerIdentityPublicKey: bob.publicKey,
      peerBinding: bobBinding,
      handshake: hs,
      role: 'initiator',
    };

    return { alice, bob, aliceX, bobX, hs, aliceBinding, bobBinding, input };
  }

  it('establishes a session when both identity bindings match the handshake', () => {
    const { input, aliceBinding } = setup();
    const session = establishAuthenticatedSession(input, aliceBinding);
    expect(session.peerIdentityPublicKey).toEqual(input.expectedPeerIdentityPublicKey);
    expect(session.handshakeHash).toEqual(input.handshake.handshakeHash);
  });

  it('rejects a peer identity that is not the pinned identity', () => {
    const s = setup();
    const attacker = createIdentity();
    const fakeBinding = createLocalSessionBinding(attacker, s.bobX.publicKey, s.hs, 'responder');
    expect(() => establishAuthenticatedSession(
      { ...s.input, peerBinding: fakeBinding }, s.aliceBinding
    )).toThrow('PEER_IDENTITY_MISMATCH');
  });

  it('rejects a valid identity bound to the wrong X25519 session key', () => {
    const s = setup();
    const wrongX = generateX25519KeyPair();
    const fakeBinding = createLocalSessionBinding(s.bob, wrongX.publicKey, s.hs, 'responder');
    expect(() => establishAuthenticatedSession(
      { ...s.input, peerBinding: fakeBinding }, s.aliceBinding
    )).toThrow('PEER_SESSION_BINDING_INVALID');
  });

  it('rejects a binding from another Noise transcript', () => {
    const s = setup();
    const otherHs = handshake();
    otherHs.handshakeHash = new Uint8Array(32).fill(9);
    const fakeBinding = createLocalSessionBinding(s.bob, s.bobX.publicKey, otherHs, 'responder');
    expect(() => establishAuthenticatedSession(
      { ...s.input, peerBinding: fakeBinding }, s.aliceBinding
    )).toThrow('PEER_SESSION_BINDING_INVALID');
  });

  it('rejects a role-swapped binding', () => {
    const s = setup();
    const wrongRoleBinding = createLocalSessionBinding(s.bob, s.bobX.publicKey, s.hs, 'initiator');
    expect(() => establishAuthenticatedSession(
      { ...s.input, peerBinding: wrongRoleBinding }, s.aliceBinding
    )).toThrow('PEER_SESSION_BINDING_INVALID');
  });

  it('rejects a locally forged binding before trusting the session', () => {
    const s = setup();
    const forgedLocal = createLocalSessionBinding(s.bob, s.aliceX.publicKey, s.hs, 'initiator');
    expect(() => establishAuthenticatedSession(s.input, forgedLocal))
      .toThrow('SESSION_IDENTITY_MISMATCH');
  });
});
