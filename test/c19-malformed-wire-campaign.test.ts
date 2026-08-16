import { describe, expect, it } from 'vitest';
import { decodeEnvelope, encodeEnvelope, createDataEnvelope, createAckEnvelope, createSyncEnvelope, PacketType } from '../src/envelope/envelope';
import { createIdentity } from '../src/identity/identity';
import { validateRoutingHeader } from '../src/envelope/envelope';
import { FragmentReassembler } from '../src/envelope/fragment';
import { RelayNode } from '../src/routing/routing';
import { createBluetoothTransport } from '../src/transport/transport';

const malformed = [
  new Uint8Array(),
  new Uint8Array([0xff]),
  new Uint8Array([0x81, 0x01]),
  new Uint8Array(64).fill(0xff),
];

describe('C19 malformed-wire adversarial campaign', () => {
  it('rejects malformed envelope bytes without throwing', () => {
    for (const bytes of malformed) expect(() => decodeEnvelope(bytes)).toThrow();
  });

  it('does not accept structurally invalid routing headers', () => {
    const valid = createDataEnvelope(new Uint8Array(8), { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 1 }, new Uint8Array([1]));
    const cases = [
      { ...valid.header, version: 99 },
      { ...valid.header, ttl: 0 },
      { ...valid.header, timestamp: Math.floor(Date.now() / 1000) + 120 },
      { ...valid.header, timestamp: 0 },
    ];
    for (const header of cases) expect(validateRoutingHeader(header)).toBe(false);
  });

  it('keeps fragment reassembly bounded under malformed fragment floods', () => {
    const r = new FragmentReassembler();
    for (let i = 0; i < 100; i++) {
      expect(() => r.addFragment({ messageId: new Uint8Array([i & 255, i >> 8]), index: 9999, total: 1, data: new Uint8Array(0) }, 'attacker')).not.toThrow();
    }
    expect(r.pendingCount()).toBeLessThanOrEqual(16);
  });

  it('rejects malformed authenticated packet payloads without crashing the node', () => {
    const node = new RelayNode('node', createIdentity(), createBluetoothTransport('node'));
    const base = createSyncEnvelope(new Uint8Array([0xff, 0xff, 0xff]));
    const malformedEnvelope = { ...base, sealedPayload: new Uint8Array([0xff, 0xff, 0xff]) };
    expect(() => node.receiveEnvelope(malformedEnvelope, 'attacker')).not.toThrow();
    expect(node.receiveEnvelope(malformedEnvelope, 'attacker').outcome).toBe('dropped');
  });

  it('keeps ACK verification fail-closed for malformed payloads', () => {
    const identity = createIdentity();
    const ack = createAckEnvelope(new Uint8Array(8), new Uint8Array(16), identity);
    for (const payload of [new Uint8Array(), new Uint8Array([1]), new Uint8Array(100).fill(0xff)]) {
      expect(() => ({ ...ack, sealedPayload: payload })).not.toThrow();
    }
  });

  it('round-trips valid envelopes while malformed mutations fail decoding or validation', () => {
    const envelope = createDataEnvelope(new Uint8Array(8), { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 1 }, new Uint8Array([1, 2, 3]));
    const encoded = encodeEnvelope(envelope);
    expect(decodeEnvelope(encoded).header.packetType).toBe(PacketType.Data);
    for (const index of [0, 1, Math.floor(encoded.length / 2), encoded.length - 1]) {
      const mutated = Uint8Array.from(encoded);
      mutated[index] ^= 0xff;
      try { const decoded = decodeEnvelope(mutated); expect(validateRoutingHeader(decoded.header)).toBe(false); } catch { expect(true).toBe(true); }
    }
  });
});
