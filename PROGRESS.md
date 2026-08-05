# Zaycomm — Implementation Progress

This tracks what's actually built and tested, against the RFC series
(`Zaycomm-Complete-RFC-Series.md`). Update this file as each piece
lands, it's the map between "what the spec says" and "what code
actually exists right now."

**Stack:** TypeScript, Node, vitest. Chosen over Rust/Go for Phase 1
because the whole workflow runs from a phone via GitHub Codespaces,
where a lighter npm-based toolchain matters more than raw performance.
See RFC-0010, Section 3 for the full reasoning, including when a Rust
rewrite of the core might become worth it later.

**Repo:** `/workspaces/Zaycomm`
**Run all tests:** `npx vitest run`

---

## Phase 1 — Direct Link Core (RFC-0010, Section 4) — ✅ COMPLETE

| Component | RFC reference | File | Status |
|---|---|---|---|
| X25519 / Ed25519 key generation | RFC-0004 §2.1, §2.2 | `src/crypto/keys.ts` | ✅ Done, 5 tests passing |
| Noise IK handshake | RFC-0004 §2.3 | `src/crypto/handshake.ts` | ✅ Done, 2 tests passing |
| Double ratchet | RFC-0004 §2.4 | `src/crypto/ratchet.ts` | ✅ Done, 4 tests passing |
| Packet envelope | RFC-0006 | `src/envelope/envelope.ts` | ✅ Done, 7 tests passing |
| Identity (fingerprint, device link/revocation) | RFC-0005 §1, §2.7, §3 | `src/identity/identity.ts` | ✅ Done, 9 tests passing |

**Known gaps:**
- The ratchet does not yet handle out-of-order message delivery
  (RFC-0004's real spec uses a skipped-message-key cache for this).
  **This is no longer theoretical**: Phase 7's file chunking hit it
  directly, a real end-to-end test had to send chunks in strict order
  because decrypting out of order currently fails. Worth prioritizing.
- Full sender-sealing (RFC-0004 Section 4) is only partially in place.
  `envelope.ts`'s sealed payload carries the ratchet's ephemeral key
  as an implicit sender reference, not a properly sealed identity
  reference, since `identity.ts` isn't wired into the envelope layer.

## Phase 2 — Identity and Multi-Device
Substantially covered inside `identity.ts` (fingerprints, device
linking/revocation) ahead of schedule. Remaining: wire into envelope.ts
for real sealed-sender support.

## Phase 3 — Local Multi-Hop Routing (RFC-0007 §4, §5) — ✅ COMPLETE

| Component | RFC reference | File | Status |
|---|---|---|---|
| Destination hints, signed routing advertisements, relay forwarding | RFC-0007 §4, §5 | `src/routing/routing.ts` | ✅ Done, 7 tests passing |

**Known gaps:**
- Sybil-resistant routing trust (RFC-0007 §6) not implemented, a
  signature proves who sent an advertisement, not that it should be
  trusted over an untrusted new identity.
- Advertisement propagation is manually simulated one hop at a time,
  not automatic continuous re-broadcast.

## Phase 4 — Store and Forward (RFC-0007 §2, RFC-0009) — ✅ COMPLETE

| Component | RFC reference | File | Status |
|---|---|---|---|
| Store-and-forward relay queue | RFC-0009 | `src/storage/store.ts` | ✅ Done, 11 tests passing |
| Automatic delayed delivery on RelayNode | RFC-0007 §2 | `src/routing/routing.ts` | ✅ Integrated |

Fair queue allocation is keyed to the **immediate neighbor** that
handed a message over, not the original sender, since RFC-0006 keeps
the original sender sealed from relays. Deliberate reinterpretation
of RFC-0009 §5, not an oversight.

**Known gaps:**
- Queue GC is TTL-based only, RFC-0007 §7's ack-triggered early
  cleanup needs real Ack packets flowing back through the mesh,
  not built.
- `getSummary()` existed unused until Phase 6 wired it up.

## Phase 5 — Additional Transports (RFC-0008) — ✅ COMPLETE

| Component | RFC reference | File | Status |
|---|---|---|---|
| Transport interface, simulated Bluetooth, Wi-Fi Direct, Internet | RFC-0008 §1, §2, §3, §5 | `src/transport/transport.ts` | ✅ Done |
| Fragmentation and reassembly | RFC-0006 §5 | `src/envelope/fragment.ts` | ✅ Done, 8 tests passing |

**Real finding:** transport tests measured actual encoded byte size
for the first time and caught that `envelope.ts`'s original
string-keyed CBOR encoding was too large for a realistic 200-byte BLE
MTU even for a 2-character message. Fixed with positional (array)
CBOR encoding, no field names travel on the wire.

**RelayNode / Transport wiring — ✅ COMPLETE.** `routing.ts` now sends
real bytes through `Transport.send()` instead of calling neighbors
directly in-process. The sender no longer sees a full multi-hop
delivery path in its return value, a real transport can't report what
a recipient did downstream, only whether its own send succeeded. This
is correct behavior, not a limitation: RFC-0002's metadata
minimization says a node should only know its own immediate neighbor.
Delivery is observed via `onDelivered()` listeners at the destination
instead of path inspection at the sender.

**Known gaps:**
- Long range radio (RFC-0008 §4) not modeled.
- Fragmentation exists but isn't wired into the transport `send()`
  path automatically, callers must fragment manually before sending.
  Phase 7's file test hit the consequence of this directly (see
  environment notes below).

## Phase 6 — Internet Synchronization (RFC-0003 §5, RFC-0009 §6) — ✅ COMPLETE

| Component | RFC reference | File | Status |
|---|---|---|---|
| Gateway-to-gateway sync (summary/request/transfer) | RFC-0009 §6 | `src/routing/routing.ts` | ✅ Done, 5 tests passing |

Two gateways exchange bounded summaries (message ids and TTL only,
never content) first, then each requests only what it's missing,
verified on the actual bandwidth-saving property: when both sides
already fully overlap, no request/transfer round trip happens at all.

**Known gaps:**
- `initiateSync()` is a manual trigger, "whenever a node gains
  Internet connectivity" (RFC-0003 §5) is a lifecycle decision left
  to the caller.
- Sync is point-to-point between direct neighbors only, not routed
  multi-hop.

## Phase 7 — Extended Message Types — 🔧 IN PROGRESS

| Component | RFC reference | File | Status |
|---|---|---|---|
| Application-layer message type tagging | RFC-0003 §7 | `src/message/message.ts` | ✅ Done, 3 tests passing |
| Emergency broadcast (signed, flooded, loop-prevented) | RFC-0006 §4 | `src/broadcast/broadcast.ts` | ✅ Done, 6 tests passing |
| File chunking + order-independent reassembly | RFC-0003 §7 | `src/message/file.ts` | ✅ Done, 6 tests passing |
| Voice frames | RFC-0001 goals | — | ⬜ Not started |

Broadcast content is signed, not ratchet-encrypted, there's no single
recipient to ratchet with. Flooding uses a seen-message-id set per
node to prevent infinite re-flooding.

**Real finding, not a hypothetical one:** the full encrypted file
transfer test initially failed with an "invalid tag" decryption
error on a chunk that had nothing wrong with it. Root cause: an
earlier chunk's full envelope exceeded the simulated Bluetooth
transport's 200-byte MTU and silently failed to send, but
`ratchet.encrypt()` had already advanced Alice's sending chain before
that failed send. Bob's receiving chain was then one step behind, so
the next chunk that did arrive decrypted against the wrong position
in the chain. Fixed for now by using Wi-Fi Direct (larger MTU) for
the file transfer test. Real fix, deferred: fragmentation needs to be
wired into the transport send path itself so an oversized message
can never silently vanish without the ratchet knowing, tracked
alongside the Phase 5 fragmentation gap above.

**Known gaps:**
- Voice frames not started.
- File chunks currently require in-order delivery end to end (see
  Phase 1's ratchet gap above, now a concrete blocker, not a
  theoretical one).

---

## Test count history

| Milestone | Total tests | Notes |
|---|---|---|
| Phase 1 start | 5 | keys.ts only |
| — | 7 | + handshake.ts |
| — | 11 | + ratchet.ts |
| — | 18 | + envelope.ts (full Phase 1 end-to-end test) |
| Phase 1 complete | 27 | + identity.ts |
| Phase 3 complete | 34 | + routing.ts |
| Phase 4 complete | 46 | + store.ts, util.ts consolidation |
| Phase 5 complete | 59 | + transport.ts, fragment.ts, envelope.ts encoding fix |
| — | 58 | RelayNode wired to real Transport |
| Phase 6 complete | 63 | + sync protocol, createInternetTransport |
| — | 72 | + message.ts, broadcast.ts |
| Phase 7 (partial) | 78 | + file.ts |

---

## Environment notes

- Working entirely from GitHub Codespaces via mobile browser, no
  local machine involved.
- Verify unfamiliar package export paths before writing imports:
  `cat node_modules/<package>/package.json | grep -A 40 exports`.
- **`cbor-x`'s `Encoder` reuses an internal buffer across calls**,
  both `.encode()` and `.decode()`. Every result pulled out that
  isn't used immediately, once, needs `Uint8Array.from(...)` to force
  an independent copy. This bit us twice: once on encode (caught by
  `fragment.ts`'s loop), once on decode (caught by `file.test.ts`'s
  multi-chunk loop). Applied everywhere now: envelope.ts, routing.ts,
  broadcast.ts, fragment.ts, file.ts.
- **A transport `send()` failure (oversized frame) can silently
  desync the ratchet.** `ratchet.encrypt()` advances the sending
  chain unconditionally, before the caller knows whether the send
  will actually succeed. If it doesn't, the receiver's chain falls
  out of step with the next message that does arrive, surfacing as
  an unrelated-looking "invalid tag" failure later, not where the
  real problem happened. Diagnosed by isolating with a single chunk
  first rather than guessing at the multi-chunk failure directly.
- Multi-line text in mobile find-and-replace doesn't reliably match,
  even when it displays correctly, split any multi-line find into
  separate single-line edits.
- Watch for autocorrect mangling package names (`@noble` → `@nobles`)
  and the mobile file-creation flow occasionally turning a `.` into a
  `/` or creating a folder instead of a file for nested paths, prefer
  `mkdir -p <dir> && touch <dir>/<file>` from the terminal.

---

*Last updated: Phase 7 in progress, 78 tests passing. Remaining:
voice frames, then the ratchet out-of-order gap and
fragmentation-in-transport gap both now have concrete, demonstrated
justification for prioritizing them.*
