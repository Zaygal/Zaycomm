import { describe, it, expect } from 'vitest';
import { createIdentity } from '../src/identity/identity';
import { createSyncEnvelope, createBroadcastEnvelope, decodeEnvelope } from '../src/envelope/envelope';
import { RelayNode, computeDestinationHint, createRoutingAdvertisement } from '../src/routing/routing';
import { createInternetTransport, type SimulatedTransport } from '../src/transport/transport';
import { createBroadcastMessage, encodeBroadcastMessage } from '../src/broadcast/broadcast';

const SESSION_ID = 'c17-replay-session';
const SEND_KEY = new Uint8Array(32).fill(51);
const RECEIVE_KEY = new Uint8Array(32).fill(52);

function connectSession(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
  a.registerAuthenticatedSession(b.id, b.identity.publicKey, {
    sessionId: SESSION_ID,
    sendKey: SEND_KEY,
    receiveKey: RECEIVE_KEY,
  });
  b.registerAuthenticatedSession(a.id, a.identity.publicKey, {
    sessionId: SESSION_ID,
    sendKey: RECEIVE_KEY,
    receiveKey: SEND_KEY,
  });
}

function captureSync(a: RelayNode, neighborId: string): Uint8Array {
  let captured: Uint8Array | null = null;
  const transport = a.transport as SimulatedTransport;
  const originalSend = transport.send.bind(transport);
  transport.send = (targetNeighborId: string, frame: Uint8Array) => {
    if (targetNeighborId === neighborId && frame[0] === 0) captured = Uint8Array.from(frame);
    // Capture only. Each test explicitly injects the packet below so replay
    // state is established at a controlled point rather than as a side effect
    // of creating the fixture.
    return true;
  };
  try {
    expect(a.initiateSync(neighborId)).toBe(true);
  } finally {
    transport.send = originalSend;
  }
  expect(captured).not.toBeNull();
  return decodeEnvelope(captured!.slice(1));
}

describe('C17 replay campaign', () => {
  it('rejects exact replay of an authenticated encrypted sync packet in the same session', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connectSession(a, b);
    const envelope = captureSync(a, 'b');

    expect(b.receiveEnvelope(envelope, 'a').outcome).toBe('delivered');
    expect(b.receiveEnvelope(envelope, 'a')).toEqual({ outcome: 'dropped', reason: 'sync packet replayed' });
  });

  it('rejects a sync replay after the authenticated session is re-established', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connectSession(a, b);
    const envelope = captureSync(a, 'b');
    expect(b.receiveEnvelope(envelope, 'a').outcome).toBe('delivered');

    b.unregisterAuthenticatedPeer('a');
    b.registerAuthenticatedSession('a', a.identity.publicKey, {
      sessionId: SESSION_ID,
      sendKey: RECEIVE_KEY,
      receiveKey: SEND_KEY,
    });
    expect(b.receiveEnvelope(envelope, 'a')).toEqual({ outcome: 'dropped', reason: 'sync packet replayed' });
  });

  it('rejects the same authenticated sync packet when replayed through a different neighbor', () => {
    const senderIdentity = createIdentity();
    const relay = new RelayNode('relay', createIdentity(), createInternetTransport('relay'));
    const n1 = new RelayNode('n1', senderIdentity, createInternetTransport('n1'));
    const n2 = new RelayNode('n2', senderIdentity, createInternetTransport('n2'));
    (relay.transport as SimulatedTransport).connectPeer(n1.transport as SimulatedTransport);
    (relay.transport as SimulatedTransport).connectPeer(n2.transport as SimulatedTransport);
    relay.registerAuthenticatedSession('n1', senderIdentity.publicKey, {
      sessionId: SESSION_ID,
      sendKey: RECEIVE_KEY,
      receiveKey: SEND_KEY,
    });
    relay.registerAuthenticatedSession('n2', senderIdentity.publicKey, {
      sessionId: SESSION_ID,
      sendKey: RECEIVE_KEY,
      receiveKey: SEND_KEY,
    });
    n1.registerAuthenticatedSession('relay', relay.identity.publicKey, {
      sessionId: SESSION_ID,
      sendKey: SEND_KEY,
      receiveKey: RECEIVE_KEY,
    });

    const envelope = captureSync(n1, 'relay');
    expect(relay.receiveEnvelope(envelope, 'n1').outcome).toBe('delivered');
    expect(relay.receiveEnvelope(envelope, 'n2')).toEqual({ outcome: 'dropped', reason: 'sync packet replayed' });
  });

  it('expires replay state so a fresh sync packet can be accepted after the replay window', () => {
    const a = new RelayNode('a', createIdentity(), createInternetTransport('a'));
    const b = new RelayNode('b', createIdentity(), createInternetTransport('b'));
    connectSession(a, b);
    const envelope = captureSync(a, 'b');

    expect(b.receiveEnvelope(envelope, 'a').outcome).toBe('delivered');
    expect(b.purgeStaleSyncReplayRecords(-1)).toBe(1);
    expect(b.receiveEnvelope(envelope, 'a').outcome).toBe('delivered');
  });

  it('keeps routing and broadcast replay domains independent', () => {
    const relay = new RelayNode('relay', createIdentity(), createInternetTransport('relay'));
    const neighbor = createIdentity();
    relay.registerAuthenticatedPeer('neighbor-a', neighbor.publicKey);
    const destination = createIdentity();
    const hint = computeDestinationHint(destination.publicKey);
    const ad = createRoutingAdvertisement(destination, [hint]);
    relay.receiveAdvertisement('neighbor-a', ad);
    relay.receiveAdvertisement('neighbor-a', ad);
    expect(relay.purgeStaleRoutingAdvertisements(0)).toBe(1);

    const broadcast = createBroadcastEnvelope(
      encodeBroadcastMessage(createBroadcastMessage(destination, new Uint8Array([1, 2, 3]))),
      2,
    );
    expect(relay.receiveEnvelope(broadcast, 'neighbor-a').outcome).toBe('broadcast');
    expect(relay.receiveEnvelope(broadcast, 'neighbor-a').outcome).toBe('dropped');
  });
});