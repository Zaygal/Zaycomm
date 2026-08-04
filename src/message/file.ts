// src/message/file.ts
// RFC-0003 Section 7: file transfer as an application-layer message
// type, riding the existing session, routing, and storage layers.
//
// This is a different concern from RFC-0006 Section 5's transport
// fragmentation. Fragmentation splits ONE envelope's bytes to fit
// one transport's MTU, reassembled almost immediately at the very
// next hop. File chunking here splits ONE FILE into MANY separate,
// independently ratchet-encrypted and routed messages, each taking
// its own path through the mesh, possibly arriving minutes or days
// apart via store-and-forward, reassembled only at the final
// destination.
//
// Honest limitation, not worked around: true out-of-order delivery
// of encrypted chunks isn't possible yet, because the double ratchet
// (ratchet.ts) still has the gap flagged back in Phase 1, no
// skipped-message-key cache, it advances its chain key strictly
// sequentially with every decrypt() call. The FileReassembler below
// is fully order-independent on its own and tested that way
// directly. The full encrypted end-to-end path is not, and the test
// for it sends chunks in order, honestly reflecting what currently
// works rather than demonstrating something that would actually fail
// in a real deployment where store-and-forward paths diverge.

import { Encoder } from 'cbor-x';
import { randomBytes } from '@noble/hashes/utils.js';
import { concatBytes, bytesToHex } from '../util';
import { wrapApplicationMessage, decodeApplicationMessage, MessageType } from './message';

const cbor = new Encoder();
const DEFAULT_CHUNK_DATA_SIZE = 32000;

export interface FileChunk {
  fileId: Uint8Array;
  chunkIndex: number;
  chunkCount: number;
  data: Uint8Array;
}

type FileChunkTuple = [Uint8Array, number, number, Uint8Array];

export function encodeFileChunkMessage(chunk: FileChunk): Uint8Array {
  const tuple: FileChunkTuple = [chunk.fileId, chunk.chunkIndex, chunk.chunkCount, chunk.data];
  const encoded = Uint8Array.from(cbor.encode(tuple));
  return wrapApplicationMessage(MessageType.FileChunk, encoded);
}

export function decodeFileChunkMessage(data: Uint8Array): FileChunk {
  const { type, payload } = decodeApplicationMessage(data);
  if (type !== MessageType.FileChunk) {
    throw new Error(`Expected a file chunk message, got type ${type}`);
  }
  const tuple = cbor.decode(payload) as FileChunkTuple;
  return { fileId: tuple[0], chunkIndex: tuple[1], chunkCount: tuple[2], data: tuple[3] };
}

/** Splits a file into ordered chunks sharing one random file id. */
export function splitFileIntoChunks(fileBytes: Uint8Array, chunkDataSize: number = DEFAULT_CHUNK_DATA_SIZE): FileChunk[] {
  const fileId = randomBytes(16);
  const chunkCount = Math.max(1, Math.ceil(fileBytes.length / chunkDataSize));
  const chunks: FileChunk[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const data = fileBytes.slice(i * chunkDataSize, (i + 1) * chunkDataSize);
    chunks.push({ fileId, chunkIndex: i, chunkCount, data });
  }
  return chunks;
}

/**
 * Accumulates chunks as they arrive, in any order, over any span of
 * time, and reassembles the original file once every chunk for a
 * given file id has been seen. Multiple in-flight files are tracked
 * independently by file id.
 */
export class FileReassembler {
  private pending = new Map<string, { chunkCount: number; received: Map<number, Uint8Array> }>();

  addChunk(chunk: FileChunk): Uint8Array | null {
    const key = bytesToHex(chunk.fileId);
    let entry = this.pending.get(key);
    if (!entry) {
      entry = { chunkCount: chunk.chunkCount, received: new Map() };
      this.pending.set(key, entry);
    }
    entry.received.set(chunk.chunkIndex, chunk.data);

    if (entry.received.size < entry.chunkCount) return null;

    const parts: Uint8Array[] = [];
    for (let i = 0; i < entry.chunkCount; i++) {
      const part = entry.received.get(i);
      if (!part) return null;
      parts.push(part);
    }
    this.pending.delete(key);
    return concatBytes(...parts);
  }

  pendingFileCount(): number {
    return this.pending.size;
  }
}