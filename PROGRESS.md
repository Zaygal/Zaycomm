# Zaycomm — Implementation Progress

This tracks what's actually built and tested, against the RFC series
(`Zaycomm-Complete-RFC-Series.md`). Update this file as each piece
lands, it's the map between "what the spec says" and "what code
actually exists right now."

**Status: v1.0 shipped.** All seven RFC-0010 phases complete, plus
every high-priority gap surfaced during implementation has been
closed. 104 tests passing across 19 files.

**Stack:** TypeScript, Node, vitest.
**Repo:** `/workspaces/Zaycomm` (public, github.com/Zaygal/Zaycomm)
**Run all tests:** `npx vitest run`

---

## Phase 1 — Direct Link Core — ✅ COMPLETE
`src/crypto/keys.ts`, `handshake.ts`, `ratchet.ts`, `src/envelope/envelope.ts`, `src/identity/identity.ts`

X25519/Ed25519 keys, Noise IK handshake, double ratchet, packet
envelope, identity with fingerprints and device linking/revocation.

## Phase 2 — Identity and Multi-Device — ✅ COMPLETE
`src/identity/identity.ts`, `src/identity/seal.ts`

Device linking/revocation from Phase 1. Sealed sender (RFC-0004 §4)
completed later: sender's identity key wrapped inside the
ratchet-encrypted plaintext, genuinely sealed via AEAD, not just
hidden from relays by convention.

## Phase 3 — Local Multi-Hop Routing — ✅ COMPLETE
`src/routing/routing.ts`

Destination hints, signed routing advertisements, relay forwarding.

## Phase 4 — Store and Forward — ✅ COMPLETE
`src/storage/store.ts`, `src/routing/routing.ts`

Queue with no known route, automatic delivery once a route appears.
Fair allocation keyed to the immediate neighbor, not the sealed
original sender (RFC-0009 §5, deliberate reinterpretation).

## Phase 5 — Additional Transports — ✅ COMPLETE
`src/transport/transport.ts`, `src/envelope/fragment.ts`

Bluetooth, Wi-Fi Direct, Internet transports. Fragmentation
(RFC-0006 §5) now wired directly into every outbound send in
`RelayNode`, one choke point checks real MTU and auto-fragments,
nothing sends raw and silently fails anymore.

**Real finding along the way:** the original string-keyed CBOR
envelope encoding was too large for a realistic BLE MTU even for a
2-character message. Fixed with positional (array) CBOR encoding.

## Phase 6 — Internet Synchronization — ✅ COMPLETE
`src/routing/routing.ts` (sync methods), `src/transport/transport.ts`

Gateway-to-gateway sync as real summary/request/transfer protocol
messages, proven on the actual bandwidth-saving property: when both
sides already overlap, no redundant transfer occurs at all.

**Known gaps (low priority, by design):**
- `initiateSync()` is a manual trigger, not automatic on Internet
  detection (RFC-0003 §5), that's a session-lifecycle decision left
  to the caller.
- Sync is point-to-point between direct neighbors only, not routed
  multi-hop across the mesh.

## Phase 7 — Extended Message Types — ✅ COMPLETE
`src/message/message.ts`, `src/broadcast/broadcast.ts`, `src/message/file.ts`, `src/message/voice.ts`

All four types built: text (application-layer tagging), emergency
broadcast (signed, flooded, loop-prevented via seen-message-id
tracking), file chunking (order-*dependent* `FileReassembler`, waits
for completeness), voice (order-*independent* `VoiceJitterBuffer`,
never blocks, skips permanently missing frames). The file/voice
contrast is deliberate: a file with a missing chunk isn't a file yet,
a late voice frame is worthless for playback either way, the two
reassembly models are opposites on purpose.

---

## Cross-cutting fixes, closed after Phase 7

These weren't separate RFC phases, they were real gaps that surfaced
during implementation and got fixed in priority order once understood
properly, not chased individually as they appeared.

### Skipped-message-key cache (RFC-0004 §2.4) — ✅ COMPLETE
`src/crypto/ratchet.ts`

Flagged since Phase 1, forced into urgency by Phase 7's file test
(had to send chunks in strict order to avoid decryption failure).
Bounded cache (`MAX_SKIP`) so a gap can't grow the cache unboundedly,
per RFC-0002's storage exhaustion concern. This is what makes voice's
frame-skipping behavior *safe* to build, not just convenient, a
dropped frame no longer desyncs everything after it.

### Sealed sender (RFC-0004 §4) — ✅ COMPLETE
`src/identity/seal.ts`

Sender's identity key wrapped inside the AEAD-protected plaintext,
not as a separate envelope field only "hidden by convention." Doesn't
add new authentication, the Noise IK handshake already proved who's
on the other end of a ratchet session, this gives the application
layer a sealed way to know *which* contact sent something once more
than one session is open.

### Fragmentation wired into the transport send path (RFC-0006 §5) — ✅ COMPLETE
`src/routing/routing.ts`, `src/envelope/fragment.ts`

Covered under Phase 5 above. Known limitation: fragment sends aren't
atomic, a partial failure leaves the receiver with an incomplete set
that `purgeStaleFragments()` eventually clears rather than ever
completing.

### Ack-triggered delivery confirmation (RFC-0007 §7) — ✅ COMPLETE (scoped)
`src/envelope/envelope.ts` (`createAckEnvelope`), `src/routing/routing.ts` (`sendAck`/`onAckReceived`)

Deliberately **not** automatic inside `RelayNode`: sealed sender means
the routing layer never decrypts anything and genuinely doesn't know
who to thank. The application layer, which decrypts and reads the
sealed sender field, calls `sendAck()` explicitly.

Scoped to **sender-facing delivery confirmation**, a real and useful
feature, rather than full multi-hop relay queue cleanup, which would
need either flooding the ack to every possible holder or path
tracking (removed deliberately for metadata minimization). Relays
already clear their own queue on successful forward (since Phase 4),
so the storage-hygiene gap this leaves is narrower than it first
looked.

### Sybil-resistant routing trust (RFC-0007 §6) — ✅ COMPLETE
`src/routing/routing.ts`

**Real vulnerability closed, not a hypothetical one:** `RoutingTable`
used to store one next-hop per destination in a plain `Map`, every
new advertisement silently overwrote it. A freshly created Sybil
identity could hijack an already-trusted route just by advertising
*later*, no signature needed breaking. Now every candidate neighbor
is remembered, and the one with the highest trust score wins, trust
earned only through real ack correlation (a neighbor a message was
routed through gets credited when an ack for that exact message id
comes back), never inferred from recency or claims alone.

---

## Remaining known gaps (lower priority)

- **Long range radio transport (RFC-0008 §4)** — LoRa, HF packet
  radio, satellite not modeled, only Bluetooth, Wi-Fi Direct, and
  Internet exist as transports.
- **Full multi-hop ack propagation** — see Ack section above, scoped
  narrower than originally framed once the sealed-sender constraint
  was understood.
- **Auto-sync trigger, multi-hop sync routing** — see Phase 6 above.

---

## Test count history

| Milestone | Total tests |
|---|---|
| Phase 1 start | 5 |
| Phase 1 complete | 27 |
| Phase 3 complete | 34 |
| Phase 4 complete | 46 |
| Phase 5 complete | 59 |
| Phase 6 complete | 63 |
| Phase 7 first slice (text, broadcast) | 72 |
| + file.ts | 78 |
| Skipped-key cache | 83 |
| Sealed sender | 87 |
| Fragmentation in transport | 91 |
| Phase 7 complete (+ voice.ts) | 98 |
| Ack-triggered confirmation | 101 |
| **Sybil-resistant trust (current)** | **104** |

---

## Environment notes

- Working entirely from GitHub Codespaces via mobile browser.
- Verify unfamiliar package export paths before importing:
  `cat node_modules/<package>/package.json | grep -A 40 exports`.
- **`cbor-x`'s `Encoder` reuses an internal buffer** across both
  `.encode()` and `.decode()`. Anything not used immediately needs
  `Uint8Array.from(...)` to force a copy. Applied everywhere now.
- **A transport `send()` failure can desync the ratchet** if the
  caller doesn't know the send will fail before encrypting. Root
  cause of the original file-chunk bug, fixed at the source by
  fragmentation-in-transport rather than worked around per-call-site.
- Full-file mobile pastes have occasionally silently failed to save,
  verify with `grep -c <a-symbol-only-in-the-new-version> <file>`
  before running tests, don't assume a paste landed.
- Multi-line text in mobile find-and-replace doesn't reliably match,
  split into single-line edits.
- Watch for autocorrect mangling package names (`@noble` → `@nobles`)
  and the file-creation flow turning `.` into `/` for nested paths,
  prefer `mkdir -p <dir> && touch <dir>/<file>`.

---

*Last updated: v1.0. All RFC-0010 phases and every high-priority
implementation gap closed. Remaining work is lower-priority breadth
(long range radio transport) rather than correctness.*
