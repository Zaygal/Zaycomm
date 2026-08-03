// test/fragment.test.ts

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { DoubleRatchet } from '../src/crypto/ratchet';
import {
  initiatorWriteMessage1,
  responderReadMessage1,
  responderWriteMessage2,
  initiatorReadMessage2,
} from '../src/crypto/handshake';
import { createDataEnvelope, encodeEnvelope, openDataEnvelope } from '../src/envelope/envelope';
import { fragmentEnvelope, FragmentReassembler } from '../src/envelope/fragment';
import { createBluetoothTransport } from '../src/transport/transport';

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

function buildRealEncryptedEnvelope(plaintext: string) {
  const aliceStatic = generateX25519KeyPair();
  const bobStatic = generateX25519KeyPair();

  const { message: msg1, state: aliceHandshakeState, initiatorEphemeral } =
    initiatorWriteMessage1(aliceStatic, bobStatic.publicKey);
  const { state: bobHandshakeState, initiatorStaticPublicKey } =
    responderReadMessage1(bobStatic, msg1);
  const { message: msg2, result: bobHandshakeResult, initialRatchetKeyPair } =
    responderWriteMessage2(bobHandshakeState, msg1.ephemeralPublicKey, initiatorStaticPublicKey);
  const aliceHandshakeResult = initiatorReadMessage2(aliceHandshakeState, aliceStatic, initiatorEphemeral, msg2);

  const aliceRatchet = DoubleRatchet.initAsInitiator(aliceHandshakeResult.rootKey, msg2.ephemeralPublicKey);
  const bobRatchet = DoubleRatchet.initAsResponder(bobHandshakeResult.rootKey, initialRatchetKeyPair);

  const { header, ciphertext } = aliceRatchet.encrypt(text(plaintext));
  const envelope = createDataEnvelope(new Uint8Array(8).fill(1), header, ciphertext, 10);

  return { envelope, bobRatchet };
}

describe('Fragmentation (RFC-0006 Section 5)', () => {
  it('a small envelope fragments into exactly one piece', () => {
    const { envelope } = buildRealEncryptedEnvelope('hi');
    const fragments = fragmentEnvelope(envelope, 4096);
    expect(fragments).toHaveLength(1);
  });

  it('every produced fragment fits under the given MTU', () => {
    const longMessage = 'x'.repeat(220);
    const { envelope } = buildRealEncryptedEnvelope(longMessage);
    const mtu = 200;
    const fragments = fragmentEnvelope(envelope, mtu);

    expect(fragments.length).toBeGreaterThan(1);
    for (const fragment of fragments) {
      expect(fragment.length).toBeLessThanOrEqual(mtu);
    }
  });

  it('reassembles correctly when fragments arrive in order', () => {
    const { envelope } = buildRealEncryptedEnvelope('a message split into pieces');
    const fragments = fragmentEnvelope(envelope, 60);
    expect(fragments.length).toBeGreaterThan(1);

    const reassembler = new FragmentReassembler();
    let result = null;
    for (const fragment of fragments) {
      result = reassembler.addFragment(fragment);
    }

    expect(result).not.toBeNull();
    expect(result!.header.messageId).toEqual(envelope.header.messageId);
  });

  it('reassembles correctly when fragments arrive out of order', () => {
    const { envelope } = buildRealEncryptedEnvelope('order should not matter here at all');
    const fragments = fragmentEnvelope(envelope, 50);
    expect(fragments.length).toBeGreaterThan(2);

    const shuffled = [...fragments].reverse();
    const reassembler = new FragmentReassembler();
    let result = null;
    for (const fragment of shuffled) {
      result = reassembler.addFragment(fragment);
    }

    expect(result).not.toBeNull();
    expect(encodeEnvelope(result!)).toEqual(encodeEnvelope(envelope));
  });

  it('returns null until every fragment has arrived', () => {
    const { envelope } = buildRealEncryptedEnvelope('waiting on the rest of this');
    const fragments = fragmentEnvelope(envelope, 40);
    expect(fragments.length).toBeGreaterThan(2);

    const reassembler = new FragmentReassembler();
    for (let i = 0; i < fragments.length - 1; i++) {
      expect(reassembler.addFragment(fragments[i])).toBeNull();
    }
    expect(reassembler.pendingCount()).toBe(1);
  });

  it('purges incomplete fragment sets older than maxAgeMs', async () => {
    const { envelope } = buildRealEncryptedEnvelope('this sender vanished mid transmission');
    const fragments = fragmentEnvelope(envelope, 40);
    const reassembler = new FragmentReassembler();
    reassembler.addFragment(fragments[0]);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const purged = reassembler.purgeStale(10);
    expect(purged).toBe(1);
    expect(reassembler.pendingCount()).toBe(0);
  });

  it('tracks multiple in-flight messages independently', () => {
    const messageA = buildRealEncryptedEnvelope('first independent message here');
    const messageB = buildRealEncryptedEnvelope('second independent message here');

    const fragmentsA = fragmentEnvelope(messageA.envelope, 50);
    const fragmentsB = fragmentEnvelope(messageB.envelope, 50);

    const reassembler = new FragmentReassembler();
    reassembler.addFragment(fragmentsA[0]);
    reassembler.addFragment(fragmentsB[0]);

    let resultA = null;
    for (let i = 1; i < fragmentsA.length; i++) resultA = reassembler.addFragment(fragmentsA[i]);
    let resultB = null;
    for (let i = 1; i < fragmentsB.length; i++) resultB = reassembler.addFragment(fragmentsB[i]);

    expect(resultA!.header.messageId).toEqual(messageA.envelope.header.messageId);
    expect(resultB!.header.messageId).toEqual(messageB.envelope.header.messageId);
  });

  it('closes the Phase 5 gap: the exact message that failed to cross Bluetooth now succeeds, fragmented, over the real simulated transport, and decrypts correctly', () => {
    const longMessage = 'x'.repeat(220);
    const { envelope, bobRatchet } = buildRealEncryptedEnvelope(longMessage);

    const sender = createBluetoothTransport('sender');
    const receiver = createBluetoothTransport('receiver');
    sender.connectPeer(receiver);

    const mtu = sender.getLinkCharacteristics('receiver')!.maxTransmissionUnit;
    const fragments = fragmentEnvelope(envelope, mtu);
    expect(fragments.length).toBeGreaterThan(1);

    const reassembler = new FragmentReassembler();
    let reassembledEnvelope: ReturnType<typeof reassembler.addFragment> = null;
    receiver.onReceive((_from, frame) => {
      reassembledEnvelope = reassembler.addFragment(frame);
    });

    for (const fragment of fragments) {
      const sent = sender.send('receiver', fragment);
      expect(sent).toBe(true);
    }

    expect(reassembledEnvelope).not.toBeNull();
    const { ratchetHeader, ciphertext } = openDataEnvelope(reassembledEnvelope!);
    expect(decode(bobRatchet.decrypt(ratchetHeader, ciphertext))).toBe(longMessage);
  });
});