// src/message/message.ts
// RFC-0003 Section 7: application layer message types riding the
// existing session, routing, and storage layers, not new protocol
// stacks. This is the thinnest possible slice: a one byte type tag
// prepended to plaintext before it goes into DoubleRatchet.encrypt(),
// and stripped after DoubleRatchet.decrypt(). The ratchet itself
// never changes, it already only ever saw opaque bytes.

export enum MessageType {
  Text = 0,
  FileChunk = 1,
  VoiceFrame = 2,
}

export interface DecodedApplicationMessage {
  type: MessageType;
  payload: Uint8Array;
}

export function wrapApplicationMessage(type: MessageType, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + payload.length);
  out[0] = type;
  out.set(payload, 1);
  return out;
}

export function decodeApplicationMessage(data: Uint8Array): DecodedApplicationMessage {
  return { type: data[0] as MessageType, payload: data.slice(1) };
}

export function encodeTextMessage(text: string): Uint8Array {
  return wrapApplicationMessage(MessageType.Text, new TextEncoder().encode(text));
}

export function decodeTextMessage(data: Uint8Array): string {
  const { type, payload } = decodeApplicationMessage(data);
  if (type !== MessageType.Text) {
    throw new Error(`Expected a text message, got type ${type}`);
  }
  return new TextDecoder().decode(payload);
}
