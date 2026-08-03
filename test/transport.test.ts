// test/transport.test.ts

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { createIdentity } from '../src/identity/identity';
import { DoubleRatchet } from '../src/crypto/ratchet';
import {
  initiatorWriteMessage1,
  responderReadMessage1,
  responderWriteMessage2,
  initiatorReadMessage2,
} from '../src/crypto/handshake';
import {
  createDataEnvelope,
  encodeEnvelope,
  decodeEnvelope,
  openDataEnvelope,
} from '../src/envelope/envelope';
import {
  createBluetoothTransport,
  createWifiDirectTransport,
  type Transport,
} from '../src/transport/transport';

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
  const wireBytes = encodeEnvelope(envelope);

  return { wireBytes, bobRatchet };
}

describe('Transport layer (RFC-0008)', () => {
  it('reports different link characteristics for structurally different transports', () => {
    const btA = createBluetoothTransport('a');
    const btB = createBluetoothTransport('b');
    btA.connectPeer(btB);

    const wifiA = createWifiDirectTransport('a');
    const wifiB = createWifiDirectTransport('b');
    wifiA.connectPeer(wifiB);

    const btChars = btA.getLinkCharacteristics('b')!;
    const wifiChars = wifiA.getLinkCharacteristics('b')!;

    expect(btChars.maxTransmissionUnit).toBeLessThan(wifiChars.maxTransmissionUnit);
  });

  it('delivers a small envelope identically over both Bluetooth and Wi-Fi Direct (transport agnosticism, RFC-0001 Section 4.1)', () => {
    const { wireBytes, bobRatchet } = buildRealEncryptedEnvelope('hi');

    for (const [makeA, makeB] of [
      [createBluetoothTransport, createBluetoothTransport],
      [createWifiDirectTransport, createWifiDirectTransport],
    ] as const) {
      const transportA = makeA('sender');
      const transportB = makeB('receiver');
      transportA.connectPeer(transportB);

      let received: Uint8Array | null = null;
      transportB.onReceive((_from, frame) => {
        received = frame;
      });

      const sent = transportA.send('receiver', wireBytes);
      expect(sent).toBe(true);
      expect(received).not.toBeNull();
      expect(received).toEqual(wireBytes);
    }

    const decoded = decodeEnvelope(wireBytes);
    const { ratchetHeader, ciphertext } = openDataEnvelope(decoded);
    expect(decode(bobRatchet.decrypt(ratchetHeader, ciphertext))).toBe('hi');
  });

  it('Wi-Fi Direct carries a full envelope that Bluetooth cannot, exposing the real fragmentation gap (RFC-0006 Section 5)', () => {
    const longMessage = 'x'.repeat(220);
    const { wireBytes } = buildRealEncryptedEnvelope(longMessage);

    const bt = createBluetoothTransport('sender');
    const btPeer = createBluetoothTransport('receiver');
    bt.connectPeer(btPeer);

    const wifi = createWifiDirectTransport('sender');
    const wifiPeer = createWifiDirectTransport('receiver');
    wifi.connectPeer(wifiPeer);

    const bluetoothResult = bt.send('receiver', wireBytes);
    const wifiResult = wifi.send('receiver', wireBytes);

    expect(bluetoothResult).toBe(false);
    expect(wifiResult).toBe(true);
  });

  it('send fails cleanly to an unconnected neighbor', () => {
    const transport = createBluetoothTransport('a');
    expect(transport.send('nobody', new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('getLinkCharacteristics returns null for an unknown neighbor', () => {
    const transport = createBluetoothTransport('a');
    expect(transport.getLinkCharacteristics('nobody')).toBeNull();
  });
});