// test/fragment.test.ts

import { describe, it, expect } from 'vitest';
import { Encoder } from 'cbor-x';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { DoubleRatchet } from '../src/crypto/ratchet';
import {
  initiatorWriteMessage1,
  responderReadMessage1,
  responderWriteMessage2,
  initiatorReadMessage2,
} from '../src/crypto/handshake';
import { createDataEnvelope, encodeEnvelope, openDataEnvelope } from '../src/envelope/envelope';
import {
  fragmentEnvelope,
  FragmentReassembler,
  MAX_FRAGMENT_COUNT,
  MAX_FRAGMENT_SIZE,
  MAX_PENDING_FRAGMENT_SETS,
  MAX_PENDING_FRAGMENT_BYTES,
} from '../src/envelope/fragment';
import { createBluetoothTransport } from '../src/transport/transport';

const cbor = new Encoder();
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

function maliciousFragment(messageId: Uint8Array, fragmentIndex: number, fragmentCount: number, data: Uint8Array) {
  return Uint8Array.from(cbor.encode([messageId, fragmentIndex, fragmentCount, data]));
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

  it('rejects a fragment count above the protocol limit without allocating state', () => {
    const reassembler = new FragmentReassembler();
    const id = new Uint8Array(16).fill(7);
    const wire = maliciousFragment(id, 0, MAX_FRAGMENT_COUNT + 1, new Uint8Array([1]));

    expect(reassembler.addFragment(wire)).toBeNull();
    expect(reassembler.pendingCount()).toBe(0);
    expect(reassembler.pendingBytesCount()).toBe(0);
  });

  it('rejects an oversized fragment before it reaches the reassembly store', () => {
    const reassembler = new FragmentReassembler();
    const id = new Uint8Array(16).fill(8);
    const data = new Uint8Array(MAX_FRAGMENT_SIZE + 1);
    const wire = maliciousFragment(id, 0, 2, data);

    expect(reassembler.addFragment(wire)).toBeNull();
    expect(reassembler.pendingCount()).toBe(0);
    expect(reassembler.pendingBytesCount()).toBe(0);
  });

  it('caps the number of incomplete message sets', () => {
    const reassembler = new FragmentReassembler();

    for (let i = 0; i < MAX_PENDING_FRAGMENT_SETS; i++) {
      const id = new Uint8Array(16);
      id[0] = (i >>> 8) & 0xff;
      id[1] = i & 0xff;
      const wire = maliciousFragment(id, 0, 2, new Uint8Array([i & 0xff]));
      expect(reassembler.addFragment(wire)).toBeNull();
    }

    expect(reassembler.pendingCount()).toBe(MAX_PENDING_FRAGMENT_SETS);

    const extraId = new Uint8Array(16).fill(0xee);
    expect(reassembler.addFragment(maliciousFragment(extraId, 0, 2, new Uint8Array([1])))).toBeNull();
    expect(reassembler.pendingCount()).toBe(MAX_PENDING_FRAGMENT_SETS);
  });

  it('caps aggregate pending bytes even within one message set', () => {
    const reassembler = new FragmentReassembler();
    const id = new Uint8Array(16).fill(9);
    const chunk = new Uint8Array(MAX_FRAGMENT_SIZE);
    const fragmentsNeededToExceed = Math.floor(MAX_PENDING_FRAGMENT_BYTES / MAX_FRAGMENT_SIZE) + 1;

    for (let i = 0; i < fragmentsNeededToExceed - 1; i++) {
      expect(reassembler.addFragment(maliciousFragment(id, i, fragmentsNeededToExceed, chunk))).toBeNull();
    }

    expect(reassembler.pendingBytesCount()).toBe((fragmentsNeededToExceed - 1) * MAX_FRAGMENT_SIZE);
    expect(reassembler.addFragment(maliciousFragment(id, fragmentsNeededToExceed - 1, fragmentsNeededToExceed, chunk))).toBeNull();
    expect(reassembler.pendingBytesCount()).toBeLessThanOrEqual(MAX_PENDING_FRAGMENT_BYTES);
  });

  it('does not double-count duplicate fragments against resource limits', () => {
    const reassembler = new FragmentReassembler();
    const id = new Uint8Array(16).fill(10);
    const wire = maliciousFragment(id, 0, 2, new Uint8Array([1, 2, 3]));

    expect(reassembler.addFragment(wire)).toBeNull();
    const bytesAfterFirst = reassembler.pendingBytesCount();
    expect(reassembler.addFragment(wire)).toBeNull();

    expect(reassembler.pendingCount()).toBe(1);
    expect(reassembler.pendingBytesCount()).toBe(bytesAfterFirst);
  });

  it('releases reserved bytes when an incomplete set is purged', async () => {
    const reassembler = new FragmentReassembler();
    const id = new Uint8Array(16).fill(11);
    const wire = maliciousFragment(id, 0, 2, new Uint8Array(100));

    expect(reassembler.addFragment(wire)).toBeNull();
    expect(reassembler.pendingBytesCount()).toBe(100);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reassembler.purgeStale(1)).toBe(1);
    expect(reassembler.pendingCount()).toBe(0);
    expect(reassembler.pendingBytesCount()).toBe(0);
  });
});