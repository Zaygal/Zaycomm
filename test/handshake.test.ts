// test/handshake.test.ts

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import {
  initiatorWriteMessage1,
  responderReadMessage1,
  responderWriteMessage2,
  initiatorReadMessage2,
} from '../src/crypto/handshake';

describe('Noise IK handshake (RFC-0004 Section 2.3)', () => {
  it('both sides derive matching, correctly swapped transport keys', () => {
    const initiatorStatic = generateX25519KeyPair();
    const responderStatic = generateX25519KeyPair();

    const { message: message1, state: initiatorState, initiatorEphemeral } =
      initiatorWriteMessage1(initiatorStatic, responderStatic.publicKey);

    const { state: responderState, initiatorStaticPublicKey, payload: firstPayload } =
      responderReadMessage1(responderStatic, message1);

    expect(initiatorStaticPublicKey).toEqual(initiatorStatic.publicKey);
    expect(firstPayload.length).toBe(0);

    const { message: message2, result: responderResult } = responderWriteMessage2(
      responderState,
      message1.ephemeralPublicKey,
      initiatorStaticPublicKey
    );

    const initiatorResult = initiatorReadMessage2(
      initiatorState,
      initiatorStatic,
      initiatorEphemeral,
      message2
    );

    expect(initiatorResult.handshakeHash).toEqual(responderResult.handshakeHash);
    expect(initiatorResult.sendKey).toEqual(responderResult.receiveKey);
    expect(initiatorResult.receiveKey).toEqual(responderResult.sendKey);
    expect(initiatorResult.sendKey).not.toEqual(initiatorResult.receiveKey);
  });

  it('produces a different handshake hash for a different initiator identity', () => {
    const responderStatic = generateX25519KeyPair();
    const initiatorA = generateX25519KeyPair();
    const initiatorB = generateX25519KeyPair();

    const { message: msg1A, state: stateA, initiatorEphemeral: ephA } =
      initiatorWriteMessage1(initiatorA, responderStatic.publicKey);
    const { state: rStateA, initiatorStaticPublicKey: rKeyA } =
      responderReadMessage1(responderStatic, msg1A);
    const { message: msg2A } = responderWriteMessage2(rStateA, msg1A.ephemeralPublicKey, rKeyA);
    const resultA = initiatorReadMessage2(stateA, initiatorA, ephA, msg2A);

    const { message: msg1B, state: stateB, initiatorEphemeral: ephB } =
      initiatorWriteMessage1(initiatorB, responderStatic.publicKey);
    const { state: rStateB, initiatorStaticPublicKey: rKeyB } =
      responderReadMessage1(responderStatic, msg1B);
    const { message: msg2B } = responderWriteMessage2(rStateB, msg1B.ephemeralPublicKey, rKeyB);
    const resultB = initiatorReadMessage2(stateB, initiatorB, ephB, msg2B);

    expect(resultA.handshakeHash).not.toEqual(resultB.handshakeHash);
  });
});