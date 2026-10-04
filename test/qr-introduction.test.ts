// test/qr-introduction.test.ts
// QR identity introduction: what a Zaycomm code may and may not say.

import { describe, expect, it } from 'vitest';
import {
  IntroductionError,
  createNodeIntroduction,
  decodeNodeIntroduction,
  deriveNodeId,
  encodeNodeIntroduction,
  introducedIdentityPublicKey,
  introducedStaticPublicKey,
  introducesCapability,
  tryDecodeNodeIntroduction,
} from '../src/identity/introduction';
import { createIdentity, computeFingerprint } from '../src/identity/identity';
import { generateX25519KeyPair } from '../src/crypto/keys';
import { bytesToHex } from '../src/util';

function makeNode() {
  const identity = createIdentity();
  const staticKeyPair = generateX25519KeyPair();
  const introduction = createNodeIntroduction(identity, staticKeyPair.publicKey);
  return { identity, staticKeyPair, introduction };
}

function expectCode(raw: string, code: string) {
  const result = tryDecodeNodeIntroduction(raw);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe(code);
}

describe('QR identity introduction', () => {
  it('round-trips an introduction', () => {
    const { introduction } = makeNode();
    const decoded = decodeNodeIntroduction(encodeNodeIntroduction(introduction));
    expect(decoded).toEqual(introduction);
  });

  it('derives the node id from the fingerprint of the advertised key', () => {
    const { identity, introduction } = makeNode();
    const expected = computeFingerprint(identity.publicKey).replace(/\s/g, '').slice(0, 16);
    expect(introduction.nodeId).toBe(expected);
    expect(deriveNodeId(identity.publicKey)).toBe(expected);
  });

  it('exposes 32 byte identity and static keys', () => {
    const { introduction } = makeNode();
    expect(introducedIdentityPublicKey(introduction)).toHaveLength(32);
    expect(introducedStaticPublicKey(introduction)).toHaveLength(32);
    expect(introducesCapability(introduction, 'ble')).toBe(true);
    expect(introducesCapability(introduction, 'wifi')).toBe(false);
  });

  it('defaults to the ble capability', () => {
    const { introduction } = makeNode();
    expect(introduction.capabilities).toEqual(['ble']);
  });

  describe('rejections', () => {
    it('rejects an empty payload', () => {
      expectCode('', 'QR_EMPTY');
      expectCode('   ', 'QR_EMPTY');
    });

    it('rejects non-JSON', () => {
      expectCode('hello world', 'QR_MALFORMED');
    });

    it('rejects JSON that is not an object', () => {
      expectCode('[1,2,3]', 'QR_MALFORMED');
      expectCode('"zaycomm"', 'QR_MALFORMED');
    });

    it('rejects a foreign scheme', () => {
      const { introduction } = makeNode();
      expectCode(JSON.stringify({ ...introduction, scheme: 'bitcoin' }), 'QR_UNSUPPORTED_SCHEME');
    });

    it('rejects an unsupported version', () => {
      const { introduction } = makeNode();
      expectCode(JSON.stringify({ ...introduction, version: 2 }), 'QR_UNSUPPORTED_VERSION');
    });

    it('rejects an unusable identity key', () => {
      const { introduction } = makeNode();
      expectCode(JSON.stringify({ ...introduction, publicKey: 'abcd' }), 'QR_INVALID_KEY');
      expectCode(JSON.stringify({ ...introduction, publicKey: 'zz'.repeat(32) }), 'QR_INVALID_KEY');
      expectCode(JSON.stringify({ ...introduction, publicKey: undefined }), 'QR_INVALID_KEY');
    });

    it('rejects a missing or unusable static key', () => {
      const { introduction } = makeNode();
      expectCode(JSON.stringify({ ...introduction, staticKey: undefined }), 'QR_INVALID_STATIC_KEY');
      expectCode(JSON.stringify({ ...introduction, staticKey: '00' }), 'QR_INVALID_STATIC_KEY');
    });

    it('rejects a node id that does not match the advertised key', () => {
      const { introduction } = makeNode();
      const other = makeNode();
      expectCode(
        JSON.stringify({ ...introduction, nodeId: other.introduction.nodeId }),
        'QR_NODE_ID_MISMATCH'
      );
    });

    it('rejects a malformed node id', () => {
      const { introduction } = makeNode();
      expectCode(JSON.stringify({ ...introduction, nodeId: 'short' }), 'QR_NODE_ID_MISMATCH');
    });

    it('rejects a malformed nonce', () => {
      const { introduction } = makeNode();
      expectCode(JSON.stringify({ ...introduction, nonce: 'ff' }), 'QR_INVALID_NONCE');
    });

    it('rejects a missing or empty capability list', () => {
      const { introduction } = makeNode();
      expectCode(JSON.stringify({ ...introduction, capabilities: [] }), 'QR_INVALID_CAPABILITIES');
      expectCode(JSON.stringify({ ...introduction, capabilities: undefined }), 'QR_INVALID_CAPABILITIES');
      expectCode(JSON.stringify({ ...introduction, capabilities: [1, 2] }), 'QR_INVALID_CAPABILITIES');
    });

    it('throws a typed error from the strict decoder', () => {
      expect(() => decodeNodeIntroduction('nope')).toThrow(IntroductionError);
    });
  });

  it('rejects a static key that is not 32 bytes when creating an introduction', () => {
    const identity = createIdentity();
    expect(() => createNodeIntroduction(identity, new Uint8Array(16))).toThrow(IntroductionError);
  });

  it('never encodes private material', () => {
    const { identity, staticKeyPair, introduction } = makeNode();
    const encoded = encodeNodeIntroduction(introduction);
    const privateIdentity = identity.privateKey;
    const privateStatic = staticKeyPair.privateKey;
    expect(encoded.includes(bytesToHex(privateIdentity))).toBe(false);
    expect(encoded.includes(bytesToHex(privateStatic))).toBe(false);
    expect(Object.keys(introduction).sort()).toEqual(
      ['capabilities', 'nodeId', 'nonce', 'publicKey', 'scheme', 'staticKey', 'version'].sort()
    );
  });
});
