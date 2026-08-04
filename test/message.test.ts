// test/message.test.ts

import { describe, it, expect } from 'vitest';
import { encodeTextMessage, decodeTextMessage, decodeApplicationMessage, MessageType } from '../src/message/message';

describe('Application message types (RFC-0003 Section 7)', () => {
  it('round-trips a text message', () => {
    const encoded = encodeTextMessage('hello there');
    expect(decodeTextMessage(encoded)).toBe('hello there');
  });

  it('tags the message with the correct type', () => {
    const encoded = encodeTextMessage('anything');
    const { type } = decodeApplicationMessage(encoded);
    expect(type).toBe(MessageType.Text);
  });

  it('throws when decoding a non-text message as text', () => {
    const fileChunkLike = new Uint8Array([MessageType.FileChunk, 1, 2, 3]);
    expect(() => decodeTextMessage(fileChunkLike)).toThrow();
  });
});