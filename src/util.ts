// src/util.ts
// Small byte-manipulation helpers shared across the codebase. Pulled
// out once concatBytes hit three separate files with identical
// copies (ratchet.ts, identity.ts, routing.ts), and bytesEqual,
// bytesToHex, and u64le were each duplicated in two. Done as its own
// isolated pass between phases, not bundled into feature work.

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function u32le(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

export function u64le(n: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return out;
}

/**
 * Builds a 24 byte XChaCha20 nonce from a monotonic counter: 16 zero
 * bytes followed by an 8 byte little endian counter. Safe to reuse
 * across different keys since a nonce only needs to be unique per
 * key, never reused with the SAME key twice.
 */
export function buildNonce(counter: number): Uint8Array {
  const nonce = new Uint8Array(24);
  const view = new DataView(nonce.buffer);
  view.setBigUint64(16, BigInt(counter), true);
  return nonce;
}