import { describe, it, expect } from 'vitest';
import { createIdentity } from '../src/identity/identity';
import { signMessage } from '../src/crypto/keys';
import { concatBytes, u64le } from '../src/util';
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
const BROADCAST_CONTEXT = new TextEncoder().encode('ZAYCOMM_BROADCAST_V1');

function manuallySignedBroadcast(origin: ReturnType<typeof createIdentity>, content: Uint8Array) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signingMessage = concatBytes(BROADCAST_CONTEXT, u64le(timestamp), content);
  return {
    senderPublicKey: origin.publicKey,
    content,
    timestamp,
    signature: signMessage(signingMessage, origin.privateKey),
  };
}

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
    for (let i = 0; i < accepted; i++) {
      const message = createBroadcastMessage(origin, text(`unique-${i}`));
      const envelope = createBroadcastEnvelope(encodeBroadcastMessage(message), 2);
      relay.receiveEnvelope(envelope, 'origin');
    }

    // Generate additional valid signatures without consuming the origin's
    // creation API quota; this models an attacker that already controls a
    // legitimate signing key and floods a receiving node.
    for (let i = accepted; i < accepted + 2; i++) {
      const message = manuallySignedBroadcast(origin, text(`unique-${i}`));
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
