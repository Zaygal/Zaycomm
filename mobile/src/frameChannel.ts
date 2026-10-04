// mobile/src/frameChannel.ts
// Adapts the existing mobile transport to the introduction-session channel.
//
// The BLE transport advertises a ~200 byte MTU and refuses larger frames, but
// the QR authentication exchange needs a 336 byte handshake message and a
// ~600 byte identity message. Envelope fragmentation cannot be reused here:
// fragmentEnvelope() operates on Envelope messages, and these frames are
// pre-session handshake messages that have no envelope.
//
// So this module adds the smallest framing that fits: a four byte header
// carrying the chunk index and total chunk count. It is transport plumbing
// only. No identity, session or crypto logic lives here.

import type { MobileTransport } from './transport';
import type { IntroductionChannel } from '../../src/identity/introduction-session';

/** Chunk payload ceiling, below the 200 byte transport MTU with room for the header. */
export const DEFAULT_FRAME_MTU = 180;

const HEADER_LENGTH = 4;
const MAX_CHUNKS = 256;

/** Splits one message into MTU-sized chunks, each with its index and count. */
export function chunkFrame(frame: Uint8Array, mtu: number = DEFAULT_FRAME_MTU): Uint8Array[] {
  if (frame.length === 0) throw new Error('Refusing to send an empty frame');
  const chunkSize = Math.max(1, mtu - HEADER_LENGTH);
  const count = Math.ceil(frame.length / chunkSize);
  if (count > MAX_CHUNKS) throw new Error(`Frame requires too many chunks: ${count}`);

  const chunks: Uint8Array[] = [];
  for (let index = 0; index < count; index++) {
    const slice = frame.slice(index * chunkSize, (index + 1) * chunkSize);
    const chunk = new Uint8Array(HEADER_LENGTH + slice.length);
    new DataView(chunk.buffer).setUint16(0, index, false);
    new DataView(chunk.buffer).setUint16(2, count, false);
    chunk.set(slice, HEADER_LENGTH);
    chunks.push(chunk);
  }
  return chunks;
}

interface PendingFrame {
  count: number;
  parts: (Uint8Array | null)[];
}

/**
 * Reassembles chunked messages from one peer and exposes the result as the
 * ordered byte channel the authentication exchange expects.
 */
export class FrameChannel implements IntroductionChannel {
  private readonly pending = new Map<string, PendingFrame>();
  private readonly complete: Uint8Array[] = [];
  private readonly waiters: ((frame: Uint8Array) => void)[] = [];

  constructor(
    private readonly transport: MobileTransport,
    private readonly peerId: string,
    private readonly mtu: number = DEFAULT_FRAME_MTU
  ) {}

  async send(frame: Uint8Array): Promise<void> {
    for (const chunk of chunkFrame(frame, this.mtu)) {
      await this.transport.send(this.peerId, chunk);
    }
  }

  receive(): Promise<Uint8Array> {
    const ready = this.complete.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * Feeds one raw transport frame. Partial sets are kept per peer so two
   * simultaneous introductions cannot interleave into a corrupt message.
   */
  accept(peerId: string, chunk: Uint8Array): void {
    if (chunk.length < HEADER_LENGTH) return;
    const view = new DataView(chunk.buffer, chunk.byteOffset, HEADER_LENGTH);
    const index = view.getUint16(0, false);
    const count = view.getUint16(2, false);
    if (count === 0 || count > MAX_CHUNKS || index >= count) return;

    let entry = this.pending.get(peerId);
    if (!entry || entry.count !== count) {
      entry = { count, parts: new Array(count).fill(null) };
      this.pending.set(peerId, entry);
    }
    entry.parts[index] = chunk.slice(HEADER_LENGTH);

    if (entry.parts.some((part) => part === null)) return;

    this.pending.delete(peerId);
    const total = entry.parts.reduce((sum, part) => sum + (part as Uint8Array).length, 0);
    const message = new Uint8Array(total);
    let offset = 0;
    for (const part of entry.parts as Uint8Array[]) {
      message.set(part, offset);
      offset += part.length;
    }

    const waiter = this.waiters.shift();
    if (waiter) waiter(message);
    else this.complete.push(message);
  }

  /** Drops partial reassembly state, e.g. after a disconnect. */
  reset(): void {
    this.pending.clear();
  }
}
