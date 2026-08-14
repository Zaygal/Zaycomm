// src/message/voice.ts
// RFC-0001's voice goal, RFC-0003 Section 7.
//
// Voice is a genuinely different problem from file chunking, not a
// smaller version of it. A file with a missing chunk isn't a file
// yet, waiting is correct. A voice frame that arrives late is
// worthless for playback, real-time audio has to skip it and keep
// going, never block. So this gets its own reassembly structure, a
// jitter buffer that explicitly does NOT wait for completeness the
// way FileReassembler (file.ts) deliberately does.
//
// This is only viable to build honestly now that ratchet.ts has the
// skipped-message-key cache (RFC-0004 Section 2.4). Before that, a
// single dropped voice frame, which happens constantly in any real
// lossy link, would have desynced every frame after it, the exact
// bug Phase 7's file test uncovered, except voice would have hit it
// on nearly every call instead of as an edge case.

import { Encoder } from 'cbor-x';
import { randomBytes } from '@noble/hashes/utils.js';
import { bytesToHex } from '../util';
import { wrapApplicationMessage, decodeApplicationMessage, MessageType } from './message';

const cbor = new Encoder();

export interface VoiceFrame {
  callId: Uint8Array;
  sequenceNumber: number;
  timestamp: number;
  audioData: Uint8Array;
}

type VoiceFrameTuple = [Uint8Array, number, number, Uint8Array];

/** Starts a new call, generating a fresh call id to tag every frame in it. */
export function startCall(): Uint8Array {
  return randomBytes(16);
}

export function encodeVoiceFrameMessage(frame: VoiceFrame): Uint8Array {
  const tuple: VoiceFrameTuple = [frame.callId, frame.sequenceNumber, frame.timestamp, frame.audioData];
  const encoded = Uint8Array.from(cbor.encode(tuple));
  return wrapApplicationMessage(MessageType.VoiceFrame, encoded);
}

export function decodeVoiceFrameMessage(data: Uint8Array): VoiceFrame {
  const { type, payload } = decodeApplicationMessage(data);
  if (type !== MessageType.VoiceFrame) {
    throw new Error(`Expected a voice frame message, got type ${type}`);
  }
  const tuple = cbor.decode(payload) as VoiceFrameTuple;
  return {
    callId: Uint8Array.from(tuple[0]),
    sequenceNumber: tuple[1],
    timestamp: tuple[2],
    audioData: Uint8Array.from(tuple[3]),
  };
}

/**
 * A real-time jitter buffer, not a reassembler. Frames arrive and get
 * stored, but pulling the next frame for playout NEVER blocks
 * waiting for a missing one. The caller decides, per pull, whether to
 * give up on a missing frame and move on (skipMissing: true, normal
 * real-time playout) or wait a little longer (skipMissing: false,
 * e.g. still within the jitter tolerance window).
 */
export class VoiceJitterBuffer {
  private calls = new Map<string, { frames: Map<number, VoiceFrame>; nextSequenceNumber: number }>();

  addFrame(frame: VoiceFrame): void {
    const key = bytesToHex(frame.callId);
    let entry = this.calls.get(key);
    if (!entry) {
      // Calls start at sequence 0 by convention. This must NOT be
      // inferred from whichever frame happens to arrive first, that
      // was the bug: if frame 0 is the one that's lost and frame 1
      // is the first thing the buffer ever sees, inferring the start
      // point from it would wrongly conclude "this call starts at 1"
      // and hand back a frame instead of correctly reporting the gap.
      entry = { frames: new Map(), nextSequenceNumber: 0 };
      this.calls.set(key, entry);
    }
    entry.frames.set(frame.sequenceNumber, frame);
  }

  pullNextFrame(callId: Uint8Array, skipMissing: boolean): VoiceFrame | null {
    const key = bytesToHex(callId);
    const entry = this.calls.get(key);
    if (!entry) return null;

    const frame = entry.frames.get(entry.nextSequenceNumber);
    if (frame) {
      entry.frames.delete(entry.nextSequenceNumber);
      entry.nextSequenceNumber++;
      return frame;
    }

    if (skipMissing) {
      entry.nextSequenceNumber++;
    }
    return null;
  }

  bufferedFrameCount(callId: Uint8Array): number {
    const entry = this.calls.get(bytesToHex(callId));
    return entry ? entry.frames.size : 0;
  }

  endCall(callId: Uint8Array): void {
    this.calls.delete(bytesToHex(callId));
  }
}