// test/file.test.ts

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
import { createWifiDirectTransport, type SimulatedTransport } from '../src/transport/transport';
import {
  splitFileIntoChunks,
  FileReassembler,
  encodeFileChunkMessage,
  decodeFileChunkMessage,
} from '../src/message/file';

function connectNodes(a: RelayNode, b: RelayNode): void {
  (a.transport as SimulatedTransport).connectPeer(b.transport as SimulatedTransport);
}

describe('File chunking (RFC-0003 Section 7)', () => {
  it('splits a file into the expected number of chunks', () => {
    const fileBytes = new Uint8Array(500).fill(7);
    const chunks = splitFileIntoChunks(fileBytes, 100);
    expect(chunks).toHaveLength(5);
    expect(chunks.every((c) => c.chunkCount === 5)).toBe(true);
  });

  it('round-trips a single file chunk through encode/decode', () => {
    const chunks = splitFileIntoChunks(new Uint8Array([1, 2, 3, 4, 5]), 2);
    const encoded = encodeFileChunkMessage(chunks[0]);
    const decoded = decodeFileChunkMessage(encoded);
    expect(decoded.chunkIndex).toBe(chunks[0].chunkIndex);
    expect(decoded.data).toEqual(chunks[0].data);
  });

  it('FileReassembler reassembles correctly when chunks arrive in order', () => {
    const fileBytes = new Uint8Array(500).fill(3);
    const chunks = splitFileIntoChunks(fileBytes, 100);
    const reassembler = new FileReassembler();

    let result: Uint8Array | null = null;
    for (const chunk of chunks) {
      result = reassembler.addChunk(chunk);
    }
    expect(result).toEqual(fileBytes);
  });

  it('FileReassembler reassembles correctly when chunks arrive out of order (order-independent by design)', () => {
    const fileBytes = new Uint8Array(500).fill(5);
    const chunks = splitFileIntoChunks(fileBytes, 100);
    const shuffled = [...chunks].reverse();
    const reassembler = new FileReassembler();

    let result: Uint8Array | null = null;
    for (const chunk of shuffled) {
      result = reassembler.addChunk(chunk);
    }
    expect(result).toEqual(fileBytes);
  });

  it('returns null until every chunk for a file has arrived', () => {
    const fileBytes = new Uint8Array(500).fill(1);
    const chunks = splitFileIntoChunks(fileBytes, 100);
    const reassembler = new FileReassembler();

    for (let i = 0; i < chunks.length - 1; i++) {
      expect(reassembler.addChunk(chunks[i])).toBeNull();
    }
    expect(reassembler.pendingFileCount()).toBe(1);
  });

  it(
    'a real file transfers end to end: chunked, individually ratchet-encrypted, routed through a relay, and reassembled. ' +
      'Chunks are sent IN ORDER, honestly reflecting the current ratchet limitation, not because order happens not to matter.',
    () => {
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

      // Wi-Fi Direct, not Bluetooth: a chunked file's full envelope
      // overhead (CBOR framing, ratchet header, routing header) does
      // not reliably fit a realistic BLE MTU without RFC-0006 Section
      // 5 fragmentation wired into the transport send path, which
      // isn't built yet, flagged as a further integration gap. Using
      // it anyway here silently desyncs the ratchet's receiving
      // chain when a message fails to send, corrupting a LATER,
      // seemingly unrelated chunk instead of failing where the real
      // problem is. Wi-Fi Direct's larger MTU sidesteps that
      // entirely, keeping this test focused on file chunking itself.
      const aliceNode = new RelayNode('alice', aliceIdentity, createWifiDirectTransport('alice'));
      const relayNode = new RelayNode('relay', createIdentity(), createWifiDirectTransport('relay'));
      const bobNode = new RelayNode('bob', bobIdentity, createWifiDirectTransport('bob'));
      connectNodes(aliceNode, relayNode);
      connectNodes(relayNode, bobNode);

      const bobHint = computeDestinationHint(bobIdentity.publicKey);
      const bobAd = createRoutingAdvertisement(bobIdentity, [bobHint]);
      relayNode.receiveAdvertisement('bob', bobAd);
      aliceNode.receiveAdvertisement('relay', bobAd);

      const originalFile = new Uint8Array(350).map((_, i) => i % 256);
      const chunks = splitFileIntoChunks(originalFile, 100);
      expect(chunks.length).toBeGreaterThan(1);

      const reassembler = new FileReassembler();
      let reassembledFile: Uint8Array | null = null;
      bobNode.onDelivered((envelope) => {
        const { ratchetHeader, ciphertext } = openDataEnvelope(envelope);
        const plaintext = bobRatchet.decrypt(ratchetHeader, ciphertext);
        const chunk = decodeFileChunkMessage(plaintext);
        const maybeComplete = reassembler.addChunk(chunk);
        if (maybeComplete) reassembledFile = maybeComplete;
      });

      for (const chunk of chunks) {
        const { header: ratchetHeader, ciphertext } = aliceRatchet.encrypt(encodeFileChunkMessage(chunk));
        const envelope = createDataEnvelope(bobHint, ratchetHeader, ciphertext, 10);
        aliceNode.receiveEnvelope(envelope, null);
      }

      expect(reassembledFile).toEqual(originalFile);
    }
  );
});