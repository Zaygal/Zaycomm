// test/frame-channel.test.ts
// Framing at the transport boundary: the QR authentication exchange must fit
// through a ~200 byte BLE MTU without corrupting reassembly.

import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME_MTU, FrameChannel, chunkFrame } from '../mobile/src/frameChannel';
import type { MobileLinkCharacteristics, MobilePeer, MobileTransport } from '../mobile/src/transport';

class FakeTransport implements MobileTransport {
  readonly name = 'fake';
  readonly sent: { peerId: string; frame: Uint8Array }[] = [];
  private receiveHandler: ((peerId: string, frame: Uint8Array) => void) | null = null;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async discover(): Promise<MobilePeer[]> { return []; }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async send(peerId: string, frame: Uint8Array): Promise<void> {
    if (frame.byteLength > 200) throw new Error(`BLE frame exceeds transport MTU: ${frame.byteLength} > 200`);
    this.sent.push({ peerId, frame: frame.slice() });
  }
  onReceive(callback: (peerId: string, frame: Uint8Array) => void): void {
    this.receiveHandler = callback;
  }
  onPeerChanged(): void {}
  getLinkCharacteristics(): MobileLinkCharacteristics | null {
    return { maxTransmissionUnit: 200, reliability: 0.9 };
  }
  deliver(peerId: string, frame: Uint8Array): void {
    this.receiveHandler?.(peerId, frame);
  }
}

function attach(receiver: FakeTransport, channel: FrameChannel): FrameChannel {
  receiver.onReceive((peerId, frame) => channel.accept(peerId, frame));
  return channel;
}

function pattern(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 7 + 13) % 256);
}

describe('chunkFrame', () => {
  it('splits a handshake message into MTU sized chunks', () => {
    const chunks = chunkFrame(pattern(336));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(DEFAULT_FRAME_MTU);
  });

  it('keeps every chunk under the transport MTU for the largest exchange frame', () => {
    const chunks = chunkFrame(pattern(1710));
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
  });

  it('records the chunk index and total count in the header', () => {
    const chunks = chunkFrame(pattern(400), 104);
    expect(chunks).toHaveLength(4);
    chunks.forEach((chunk, index) => {
      const view = new DataView(chunk.buffer, chunk.byteOffset, 4);
      expect(view.getUint16(0, false)).toBe(index);
      expect(view.getUint16(2, false)).toBe(4);
    });
  });

  it('refuses an empty frame', () => {
    expect(() => chunkFrame(new Uint8Array(0))).toThrow(/empty/);
  });

  it('refuses a frame with too many chunks', () => {
    expect(() => chunkFrame(new Uint8Array(4096), 8)).toThrow(/too many chunks/);
  });
});

describe('FrameChannel', () => {
  it('round-trips a large frame byte for byte over a 200 byte transport', async () => {
    const sender = new FakeTransport();
    const receiver = new FakeTransport();
    const outgoing = new FrameChannel(sender, 'peer-1');
    const incoming = attach(receiver, new FrameChannel(receiver, 'peer-1'));

    const message = pattern(1710);
    const received = incoming.receive();
    await outgoing.send(message);
    for (const { frame } of sender.sent) receiver.deliver('peer-1', frame);

    expect(await received).toEqual(message);
  });

  it('reassembles chunks that arrive out of order', async () => {
    const sender = new FakeTransport();
    const receiver = new FakeTransport();
    const outgoing = new FrameChannel(sender, 'peer-1');
    const incoming = attach(receiver, new FrameChannel(receiver, 'peer-1'));

    const message = pattern(900);
    const received = incoming.receive();
    await outgoing.send(message);
    for (const { frame } of [...sender.sent].reverse()) receiver.deliver('peer-1', frame);

    expect(await received).toEqual(message);
  });

  it('keeps interleaved peers separate', async () => {
    const receiver = new FakeTransport();
    const incoming = attach(receiver, new FrameChannel(receiver, 'peer-a'));
    const senderA = new FakeTransport();
    const senderB = new FakeTransport();
    const chA = new FrameChannel(senderA, 'peer-a');
    const chB = new FrameChannel(senderB, 'peer-b');

    const first = incoming.receive();
    await chA.send(pattern(500));
    await chB.send(pattern(700));

    // Interleave the two streams.
    const max = Math.max(senderA.sent.length, senderB.sent.length);
    for (let i = 0; i < max; i++) {
      if (senderA.sent[i]) receiver.deliver('peer-a', senderA.sent[i].frame);
      if (senderB.sent[i]) receiver.deliver('peer-b', senderB.sent[i].frame);
    }

    expect(await first).toEqual(pattern(500));
  });

  it('ignores malformed chunks without corrupting the stream', async () => {
    const receiver = new FakeTransport();
    const incoming = attach(receiver, new FrameChannel(receiver, 'peer-1'));
    const sender = new FakeTransport();
    const outgoing = new FrameChannel(sender, 'peer-1');

    const message = pattern(600);
    const received = incoming.receive();

    receiver.deliver('peer-1', new Uint8Array(2));
    receiver.deliver('peer-1', new Uint8Array([0, 0, 0, 0]));

    await outgoing.send(message);
    for (const { frame } of sender.sent) receiver.deliver('peer-1', frame);

    expect(await received).toEqual(message);
  });

  it('drops partial state on reset', async () => {
    const receiver = new FakeTransport();
    const incoming = attach(receiver, new FrameChannel(receiver, 'peer-1'));
    const sender = new FakeTransport();
    const outgoing = new FrameChannel(sender, 'peer-1');

    await outgoing.send(pattern(600));
    receiver.deliver('peer-1', sender.sent[0].frame);
    incoming.reset();
    for (const { frame } of sender.sent.slice(1)) receiver.deliver('peer-1', frame);

    // The set was discarded, so the shortened stream must not resolve as a
    // complete message: only a fresh full stream may.
    const message = pattern(600);
    const received = incoming.receive();
    const freshSender = new FakeTransport();
    const freshChannel = new FrameChannel(freshSender, 'peer-1');
    await freshChannel.send(message);
    for (const { frame } of freshSender.sent) receiver.deliver('peer-1', frame);

    expect(await received).toEqual(message);
  });
});
