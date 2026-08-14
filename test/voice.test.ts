// test/voice.test.ts

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { DoubleRatchet } from '../src/crypto/ratchet';
import {
  initiatorWriteMessage1,
  responderReadMessage1,
  responderWriteMessage2,
  initiatorReadMessage2,
} from '../src/crypto/handshake';
import { createDataEnvelope, openDataEnvelope } from '../src/envelope/envelope';
import { RelayNode, computeDestinationHint, createRoutingAdvertisement } from '../src/routing/routing';
import { createIdentity } from '../src/identity/identity';
import { createBluetoothTransport, type SimulatedTransport } from '../src/transport/transport';
import {
  startCall,
  encodeVoiceFrameMessage,
  decodeVoiceFrameMessage,
  VoiceJitterBuffer,
  type VoiceFrame,
} from '../src/message/voice';

function connectNodes(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
}

function makeFrame(callId: Uint8Array, seq: number): VoiceFrame {
  return { callId, sequenceNumber: seq, timestamp: seq * 20, audioData: new Uint8Array([seq, seq, seq]) };
}

describe('Voice frame encoding (RFC-0003 Section 7)', () => {
  it('round-trips a voice frame', () => {
    const callId = startCall();
    const frame = makeFrame(callId, 3);
    const encoded = encodeVoiceFrameMessage(frame);
    const decoded = decodeVoiceFrameMessage(encoded);
    expect(decoded).toEqual(frame);
  });
});

describe('VoiceJitterBuffer (real-time, never blocks on completeness)', () => {
  it('pulls frames in order when nothing is missing', () => {
    const callId = startCall();
    const buffer = new VoiceJitterBuffer();
    buffer.addFrame(makeFrame(callId, 0));
    buffer.addFrame(makeFrame(callId, 1));

    expect(buffer.pullNextFrame(callId, false)?.sequenceNumber).toBe(0);
    expect(buffer.pullNextFrame(callId, false)?.sequenceNumber).toBe(1);
  });

  it('returns null without advancing when a frame is missing and skipMissing is false', () => {
    const callId = startCall();
    const buffer = new VoiceJitterBuffer();
    buffer.addFrame(makeFrame(callId, 1));

    expect(buffer.pullNextFrame(callId, false)).toBeNull();
    expect(buffer.pullNextFrame(callId, false)).toBeNull();
  });

  it('skips a permanently missing frame and continues, unlike FileReassembler', () => {
    const callId = startCall();
    const buffer = new VoiceJitterBuffer();
    buffer.addFrame(makeFrame(callId, 1));

    expect(buffer.pullNextFrame(callId, true)).toBeNull();
    expect(buffer.pullNextFrame(callId, false)?.sequenceNumber).toBe(1);
  });

  it('tracks multiple calls independently', () => {
    const callA = startCall();
    const callB = startCall();
    const buffer = new VoiceJitterBuffer();
    buffer.addFrame(makeFrame(callA, 0));
    buffer.addFrame(makeFrame(callB, 0));

    expect(buffer.pullNextFrame(callA, false)?.callId).toEqual(callA);
    expect(buffer.pullNextFrame(callB, false)?.callId).toEqual(callB);
  });

  it('endCall clears buffered state for that call', () => {
    const callId = startCall();
    const buffer = new VoiceJitterBuffer();
    buffer.addFrame(makeFrame(callId, 5));
    expect(buffer.bufferedFrameCount(callId)).toBe(1);

    buffer.endCall(callId);
    expect(buffer.bufferedFrameCount(callId)).toBe(0);
  });
});

describe('Real end-to-end call, over a real relay, surviving a dropped frame', () => {
  it('the call keeps playing through a permanently lost frame, only viable because of the skipped-message-key cache', () => {
    const aliceStatic = generateX25519KeyPair();
    const bobStatic = generateX25519KeyPair();
    const aliceIdentity = createIdentity();
    const bobIdentity = createIdentity();

    const { message: msg1, state: aliceHandshakeState, initiatorEphemeral } =
      initiatorWriteMessage1(aliceStatic, bobStatic.publicKey);
    const { state: bobHandshakeState, initiatorStaticPublicKey } =
      responderReadMessage1(bobStatic, msg1);
    const { message: msg2, result: bobHandshakeResult, initialRatchetKeyPair } =
      responderWriteMessage2(bobHandshakeState, msg1.ephemeralPublicKey, initiatorStaticPublicKey);
    const aliceHandshakeResult = initiatorReadMessage2(aliceHandshakeState, aliceStatic, initiatorEphemeral, msg2);

    const aliceRatchet = DoubleRatchet.initAsInitiator(aliceHandshakeResult.rootKey, msg2.ephemeralPublicKey);
    const bobRatchet = DoubleRatchet.initAsResponder(bobHandshakeResult.rootKey, initialRatchetKeyPair);

    const aliceNode = new RelayNode('alice', aliceIdentity, createBluetoothTransport('alice'));
    const relayNode = new RelayNode('relay', createIdentity(), createBluetoothTransport('relay'));
    const bobNode = new RelayNode('bob', bobIdentity, createBluetoothTransport('bob'));
    connectNodes(aliceNode, relayNode);
    connectNodes(relayNode, bobNode);

    const bobHint = computeDestinationHint(bobIdentity.publicKey);
    const bobAd = createRoutingAdvertisement(bobIdentity, [bobHint]);
    relayNode.receiveAdvertisement('bob', bobAd);
    aliceNode.receiveAdvertisement('relay', bobAd);

    const callId = startCall();
    const jitterBuffer = new VoiceJitterBuffer();

    bobNode.onDelivered((envelope) => {
      const { ratchetHeader, ciphertext } = openDataEnvelope(envelope);
      const plaintext = bobRatchet.decrypt(ratchetHeader, ciphertext);
      const frame = decodeVoiceFrameMessage(plaintext);
      jitterBuffer.addFrame(frame);
    });

    const allFrames = [0, 1, 2, 3, 4].map((seq) => {
      const message = encodeVoiceFrameMessage(makeFrame(callId, seq));
      const { header, ciphertext } = aliceRatchet.encrypt(message);
      return createDataEnvelope(bobHint, header, ciphertext, 10);
    });

    for (const seq of [0, 2, 3, 4]) {
      aliceNode.receiveEnvelope(allFrames[seq], null);
    }

    const played: number[] = [];
    for (let i = 0; i < 5; i++) {
      const frame = jitterBuffer.pullNextFrame(callId, true);
      if (frame) played.push(frame.sequenceNumber);
    }

    expect(played).toEqual([0, 2, 3, 4]);
  });
});