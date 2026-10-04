// test/qr-peer-authentication.test.ts
// The two-device flow: QR introduction -> Noise IK -> session gate -> trusted peer.
//
// Runs two real nodes over an in-memory frame channel. Nothing is mocked:
// the handshake, the identity bindings and the session gate are the existing
// implementations. A separate physical-device run is still required to prove
// the BLE transport itself; this proves the protocol half.

import { describe, expect, it } from 'vitest';
import { Encoder } from 'cbor-x';
import {
  authenticateScannedPeer,
  respondToScannedPeer,
  type IntroductionChannel,
  type LocalNodeKeys,
} from '../src/identity/introduction-session';
import {
  createNodeIntroduction,
  encodeNodeIntroduction,
  type NodeIntroduction,
} from '../src/identity/introduction';
import { PeerTrustError, PeerTrustStore, type PeerTrustRecord } from '../src/identity/peer-trust';
import { createIdentity, type Identity } from '../src/identity/identity';
import { createLocalSessionBinding } from '../src/crypto/session';
import { responderReadMessage1, responderWriteMessage2 } from '../src/crypto/handshake';
import { generateX25519KeyPair, type X25519KeyPair } from '../src/crypto/keys';
import { bytesToHex, concatBytes } from '../src/util';

const cbor = new Encoder();

class Queue {
  private readonly items: Uint8Array[] = [];
  private readonly waiters: ((frame: Uint8Array) => void)[] = [];

  push(frame: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(frame);
    else this.items.push(frame);
  }

  next(): Promise<Uint8Array> {
    const item = this.items.shift();
    if (item) return Promise.resolve(item);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

function channelPair(): [IntroductionChannel, IntroductionChannel] {
  const a = new Queue();
  const b = new Queue();
  return [
    { send: async (f) => a.push(f), receive: () => b.next() },
    { send: async (f) => b.push(f), receive: () => a.next() },
  ];
}

function pack(...fields: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const field of fields) {
    const length = new Uint8Array(2);
    new DataView(length.buffer).setUint16(0, field.length, false);
    parts.push(length, field);
  }
  return concatBytes(...parts);
}

function unpack(frame: Uint8Array, count: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const length = new DataView(frame.buffer, frame.byteOffset + offset, 2).getUint16(0, false);
    offset += 2;
    out.push(frame.slice(offset, offset + length));
    offset += length;
  }
  return out;
}

function node(): LocalNodeKeys & { introduction: NodeIntroduction } {
  const identity = createIdentity();
  const staticKeyPair = generateX25519KeyPair();
  return { identity, staticKeyPair, introduction: createNodeIntroduction(identity, staticKeyPair.publicKey) };
}

const TIMEOUT = 2000;

async function settled<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
  return Promise.race([
    promise.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error: error as Error })
    ),
    new Promise<{ ok: false; error: Error }>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: new Error('TEST_TIMEOUT') }), TIMEOUT)
    ),
  ]);
}

describe('QR introduction to authenticated peer', () => {
  it('authenticates a scanned peer end to end', async () => {
    const scanner = node();
    const displayer = node();
    const [scannerChannel, displayerChannel] = channelPair();

    const [scannerOutcome, displayerOutcome] = await Promise.all([
      settled(
        authenticateScannedPeer({
          local: scanner,
          introduction: displayer.introduction,
          channel: scannerChannel,
        })
      ),
      settled(respondToScannedPeer({ local: displayer, channel: displayerChannel })),
    ]);

    expect(scannerOutcome.ok).toBe(true);
    expect(displayerOutcome.ok).toBe(true);
    if (!scannerOutcome.ok || !displayerOutcome.ok) return;

    const scannerSession = scannerOutcome.value;
    const displayerSession = displayerOutcome.value;

    // Each side ends up with the other's proven Ed25519 identity.
    expect(bytesToHex(scannerSession.peerIdentityPublicKey)).toBe(
      bytesToHex(displayer.identity.publicKey)
    );
    expect(bytesToHex(displayerSession.peerIdentityPublicKey)).toBe(
      bytesToHex(scanner.identity.publicKey)
    );

    // Both sides committed to the same transcript.
    expect(bytesToHex(scannerSession.handshakeHash)).toBe(bytesToHex(displayerSession.handshakeHash));

    // Opposite Noise roles, and handed opposite transport keys.
    expect(scannerSession.role).toBe('initiator');
    expect(displayerSession.role).toBe('responder');
    expect(bytesToHex(scannerSession.sendKey)).toBe(bytesToHex(displayerSession.receiveKey));
    expect(bytesToHex(scannerSession.receiveKey)).toBe(bytesToHex(displayerSession.sendKey));
  });

  it('keeps the scanned peer untrusted until authentication completes', async () => {
    const scanner = node();
    const displayer = node();
    const store = new PeerTrustStore();

    store.introduce(displayer.introduction);
    expect(store.get(displayer.identity.publicKey)?.trust).toBe('introduced');
    expect(store.isVerified(displayer.identity.publicKey)).toBe(false);
    expect(store.verified()).toHaveLength(0);

    const [scannerChannel, displayerChannel] = channelPair();
    const [scannerOutcome] = await Promise.all([
      settled(
        authenticateScannedPeer({
          local: scanner,
          introduction: displayer.introduction,
          channel: scannerChannel,
        })
      ),
      settled(respondToScannedPeer({ local: displayer, channel: displayerChannel })),
    ]);

    expect(scannerOutcome.ok).toBe(true);
    if (!scannerOutcome.ok) return;

    store.markVerified(displayer.identity.publicKey, { sessionHash: scannerOutcome.value.handshakeHash });
    expect(store.isVerified(displayer.identity.publicKey)).toBe(true);
    expect(store.verified()[0]?.sessionHash).toBe(bytesToHex(scannerOutcome.value.handshakeHash));
  });

  it('refuses a peer that does not hold the Ed25519 identity from the QR', async () => {
    // The attacker holds the X25519 static key the QR advertises, so it can
    // complete the handshake. It does not hold the Ed25519 identity, so it
    // cannot produce a binding the scanner will accept. It forges the
    // introduction in an attempt to paper over the difference.
    const scanner = node();
    const displayer = node();
    const impostorIdentity = createIdentity();
    const [scannerChannel, impostorChannel] = channelPair();
    const store = new PeerTrustStore();
    store.introduce(displayer.introduction);

    const impostor = (async () => {
      const opening = unpack(await impostorChannel.receive(), 3);
      const read1 = responderReadMessage1(
        { ...displayer.staticKeyPair } as X25519KeyPair,
        {
          ephemeralPublicKey: opening[0],
          encryptedStaticKey: opening[1],
          encryptedPayload: opening[2],
        }
      );
      const m2 = responderWriteMessage2(
        read1.state,
        opening[0],
        read1.initiatorStaticPublicKey,
        new TextEncoder().encode(encodeNodeIntroduction(displayer.introduction))
      );
      await impostorChannel.send(pack(m2.message.ephemeralPublicKey, m2.message.encryptedPayload));

      const localBinding = createLocalSessionBinding(
        { publicKey: impostorIdentity.publicKey, privateKey: impostorIdentity.privateKey } as Identity,
        displayer.staticKeyPair.publicKey,
        m2.result,
        'responder'
      );

      await impostorChannel.send(
        pack(
          new TextEncoder().encode(encodeNodeIntroduction(displayer.introduction)),
          Uint8Array.from(cbor.encode(localBinding))
        )
      );
    })();

    const outcome = await settled(
      authenticateScannedPeer({
        local: scanner,
        introduction: displayer.introduction,
        channel: scannerChannel,
      })
    );

    await settled(impostor);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toMatch(/PEER_IDENTITY_MISMATCH|PEER_SESSION_BINDING_INVALID/);

    // The failed peer never becomes trusted.
    expect(store.isVerified(displayer.identity.publicKey)).toBe(false);
    expect(store.verified()).toHaveLength(0);
  });

  it('refuses a peer that presents a different identity than the scanned code', async () => {
    const scanner = node();
    const displayer = node();
    const impostor = node();
    const [scannerChannel, impostorChannel] = channelPair();

    const outcome = await Promise.all([
      settled(
        authenticateScannedPeer({
          local: scanner,
          introduction: displayer.introduction,
          channel: scannerChannel,
        })
      ),
      settled(
        respondToScannedPeer({
          local: { identity: impostor.identity, staticKeyPair: displayer.staticKeyPair },
          channel: impostorChannel,
        })
      ),
    ]);

    const scannerOutcome = outcome[0];
    expect(scannerOutcome.ok).toBe(false);
    if (!scannerOutcome.ok) {
      expect(scannerOutcome.error.message).toMatch(/PEER_INTRODUCTION_MISMATCH|PEER_IDENTITY_MISMATCH/);
    }
  });

  it('fails the handshake against a peer using an unexpected static key', async () => {
    const scanner = node();
    const displayer = node();
    const stranger = node();
    const [scannerChannel, strangerChannel] = channelPair();

    const [scannerOutcome] = await Promise.all([
      settled(
        authenticateScannedPeer({
          local: scanner,
          introduction: displayer.introduction,
          channel: scannerChannel,
        })
      ),
      settled(respondToScannedPeer({ local: stranger, channel: strangerChannel })),
    ]);

    expect(scannerOutcome.ok).toBe(false);
  });

  it('rejects an introduction that does not advertise the transport in use', async () => {
    const scanner = node();
    const displayer = node();
    const [scannerChannel] = channelPair();
    await expect(
      authenticateScannedPeer({
        local: scanner,
        introduction: { ...displayer.introduction, capabilities: ['wifi'] },
        channel: scannerChannel,
        requiredCapability: 'ble',
      })
    ).rejects.toThrow(/INTRODUCTION_NOT_USABLE|QR_/);
  });
});

describe('peer trust store', () => {
  const record = (): PeerTrustRecord => ({
    identityPublicKey: 'aa',
    nodeId: 'node',
    capabilities: ['ble'],
    introducedAt: 1,
    trust: 'introduced',
    verifiedAt: null,
    sessionHash: null,
    lastFailure: null,
  });

  it('never verifies a peer that was not introduced by a scan', () => {
    const store = new PeerTrustStore();
    expect(() => store.markVerified(new Uint8Array(32).fill(7), { sessionHash: new Uint8Array(32) })).toThrow(
      PeerTrustError
    );
  });

  it('keeps a peer untrusted after a failure', () => {
    const scanner = node();
    const displayer = node();
    const store = new PeerTrustStore();
    store.introduce(displayer.introduction);
    store.markFailed(displayer.identity.publicKey, 'PEER_IDENTITY_MISMATCH');
    expect(store.isVerified(displayer.identity.publicKey)).toBe(false);
    expect(store.get(displayer.identity.publicKey)?.lastFailure).toBe('PEER_IDENTITY_MISMATCH');
  });

  it('does not downgrade a verified peer on re-scan', () => {
    const store = new PeerTrustStore();
    const peer = node();
    store.introduce(peer.introduction);
    store.markVerified(peer.identity.publicKey, { sessionHash: new Uint8Array(32).fill(1) });
    store.introduce(peer.introduction);
    expect(store.isVerified(peer.identity.publicKey)).toBe(true);
  });

  it('round-trips through serialization without inventing trust', () => {
    const store = new PeerTrustStore();
    const peer = node();
    store.introduce(peer.introduction);
    const reloaded = PeerTrustStore.load(JSON.parse(JSON.stringify(store.toJSON())) as PeerTrustRecord[]);
    expect(reloaded.isVerified(peer.identity.publicKey)).toBe(false);
    expect(reloaded.get(peer.identity.publicKey)?.trust).toBe('introduced');
  });

  it('ignores malformed persisted records', () => {
    const reloaded = PeerTrustStore.load([null as never, { nodeId: 'x' } as never, record()]);
    expect(reloaded.list()).toHaveLength(1);
  });
});
