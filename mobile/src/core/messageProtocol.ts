export const MESSAGE_PROTOCOL_VERSION = 1;
export const MAX_LOGICAL_MESSAGE_BYTES = 256 * 1024;

export type MessageFrame = {
  version: 1;
  type: 'message';
  messageId: string;
  senderId: string;
  recipientId: string;
  createdAt: number;
  payload: string;
};

export type AckFrame = {
  version: 1;
  type: 'ack';
  messageId: string;
  recipientId: string;
  createdAt: number;
};

export type WireFrame = MessageFrame | AckFrame;

function makeMessageId(): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 12);
  return `${time}-${random}`;
}

function assertNodeId(value: string): void {
  if (!/^[0-9a-f]{16}$/i.test(value)) throw new Error('INVALID_NODE_ID');
}

export function createMessageFrame(senderId: string, recipientId: string, payload: string, now = Date.now()): MessageFrame {
  assertNodeId(senderId);
  assertNodeId(recipientId);
  if (typeof payload !== 'string' || payload.length === 0) throw new Error('EMPTY_MESSAGE');
  if (new TextEncoder().encode(payload).byteLength > MAX_LOGICAL_MESSAGE_BYTES) throw new Error('MESSAGE_TOO_LARGE');
  return {
    version: MESSAGE_PROTOCOL_VERSION,
    type: 'message',
    messageId: makeMessageId(),
    senderId: senderId.toLowerCase(),
    recipientId: recipientId.toLowerCase(),
    createdAt: now,
    payload,
  };
}

export function createAckFrame(messageId: string, recipientId: string, now = Date.now()): AckFrame {
  assertNodeId(recipientId);
  if (!/^[a-z0-9-]{8,64}$/i.test(messageId)) throw new Error('INVALID_MESSAGE_ID');
  return { version: MESSAGE_PROTOCOL_VERSION, type: 'ack', messageId, recipientId: recipientId.toLowerCase(), createdAt: now };
}

export function encodeWireFrame(frame: WireFrame): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(frame));
}

export function decodeWireFrame(bytes: Uint8Array): WireFrame {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_FRAME');
  const value = parsed as Record<string, unknown>;
  if (value.version !== MESSAGE_PROTOCOL_VERSION || (value.type !== 'message' && value.type !== 'ack')) throw new Error('INVALID_FRAME');
  if (typeof value.messageId !== 'string' || !/^[a-z0-9-]{8,64}$/i.test(value.messageId)) throw new Error('INVALID_MESSAGE_ID');
  if (typeof value.recipientId !== 'string' || !/^[0-9a-f]{16}$/i.test(value.recipientId)) throw new Error('INVALID_NODE_ID');
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) throw new Error('INVALID_TIMESTAMP');
  if (value.type === 'message') {
    if (typeof value.senderId !== 'string' || !/^[0-9a-f]{16}$/i.test(value.senderId)) throw new Error('INVALID_NODE_ID');
    if (typeof value.payload !== 'string' || new TextEncoder().encode(value.payload).byteLength > MAX_LOGICAL_MESSAGE_BYTES) throw new Error('INVALID_PAYLOAD');
    return value as unknown as MessageFrame;
  }
  return value as unknown as AckFrame;
}
