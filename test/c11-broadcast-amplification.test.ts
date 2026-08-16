import { describe, it, expect } from 'vitest';
import { createIdentity } from '../src/identity/identity';
import {
  createBroadcastMessage,
  encodeBroadcastMessage,
  MAX_BROADCAST_CONTENT_BYTES,
  MAX_BROADCASTS_PER_ORIGIN_PER_WINDOW,
} from '../src/broadcast/broadcast';
import { createBroadcastEnvelope } from '../src/envelope/envelope';
import { RelayNode } from '../src/routing/routing';
import { createBluetoothTransport } from '../src/transport/transport';

const text = (s: string) => new TextEncoder().encode(s);

describe('C11 broadcast amplification resistance', () => {
  it('rejects an oversized broadcast before signing it', () => {
    const identity = createIdentity();
    expect(() => createBroadcastMessage(identity, new Uint8Array(MAX_BROADCAST_CONTENT_BYTES + 1)))
      .toThrow('BROADCAST_PAYLOAD_TOO_LARGE');
  });

  it('limits unique broadcasts from one origin at each receiving node', () => {
    const origin = createIdentity();
    const relay = new RelayNode('relay-c11', createIdentity(), createBluetoothTransport('relay-c11'));
    let delivered = 0;
    relay.onBroadcastReceived(() => { delivered++; });

    const accepted = MAX_BROADCASTS_PER_ORIGIN_PER_WINDOW;
    for (let i = 0; i < accepted + 2; i++) {
      const message = createBroadcastMessage(origin, text(`unique-${i}`));
      const envelope = createBroadcastEnvelope(encodeBroadcastMessage(message), 2);
      relay.receiveEnvelope(envelope, 'origin');
    }

    expect(delivered).toBe(accepted);
  });

  it('keeps the duplicate cache separate from the origin rate budget', () => {
    const origin = createIdentity();
    const relay = new RelayNode('relay-c11-duplicate', createIdentity(), createBluetoothTransport('relay-c11-duplicate'));
    const message = createBroadcastMessage(origin, text('same-message'));
    const envelope = createBroadcastEnvelope(encodeBroadcastMessage(message), 2);

    const first = relay.receiveEnvelope(envelope, 'origin');
    const second = relay.receiveEnvelope(envelope, 'origin');

    expect(first.outcome).toBe('broadcast');
    expect(second.outcome).toBe('dropped');
  });
});
