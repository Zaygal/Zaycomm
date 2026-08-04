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

Goal: two devices can establish a session and exchange encrypted
messages over a single direct link. No routing, no store-and-forward
yet, those are later phases. All five components below are built,
tested, and wired together, proven by a full end-to-end test that
carries a message through the entire stack, handshake, ratchet,
envelope, wire encoding, and back.

| Component | RFC reference | File | Status |
|---|---|---|---|
| X25519 / Ed25519 key generation | RFC-0004 §2.1, §2.2 | `src/crypto/keys.ts` | ✅ Done, 5 tests passing |
| Noise IK handshake | RFC-0004 §2.3 | `src/crypto/handshake.ts` | ✅ Done, 2 tests passing |
| Double ratchet | RFC-0004 §2.4 | `src/crypto/ratchet.ts` | ✅ Done, 4 tests passing |
| Packet envelope | RFC-0006 | `src/envelope/envelope.ts` | ✅ Done, 7 tests passing |
| Identity (fingerprint, device link/revocation) | RFC-0005 §1, §2.7, §3 | `src/identity/identity.ts` | ✅ Done, 9 tests passing |

**Known gaps, flagged deliberately rather than silently skipped:**
- The ratchet does not yet handle out-of-order message delivery
  (RFC-0004's real spec uses a skipped-message-key cache for this).
  Scoped out for Phase 1's in-order direct link; relevant again once
  RFC-0009's store-and-forward layer is built.
- Full sender-sealing (RFC-0004 Section 4) is only partially in place.
  `envelope.ts`'s sealed payload carries the ratchet's ephemeral key
  as an implicit sender reference rather than a properly sealed
  identity reference, since that needs `identity.ts`, which exists
  now but isn't yet wired into the envelope layer.

## Phase 2 — Identity and Multi-Device (RFC-0010, Section 4)
Substantially covered already: `identity.ts` includes fingerprint
verification and device linking/revocation (RFC-0005 §3), built ahead
of schedule while doing Phase 1's identity component. Remaining: wire
identity.ts into envelope.ts for real sealed-sender support.

## Phase 3 — Local Multi-Hop Routing (RFC-0007 §4, §5) — ✅ COMPLETE

| Component | RFC reference | File | Status |
|---|---|---|---|
| Destination hints, signed routing advertisements, relay forwarding | RFC-0007 §4, §5 | `src/routing/routing.ts` | ✅ Done, 7 tests passing |

**Known gaps, flagged deliberately:**
- Sybil-resistant routing trust (RFC-0007 §6) is not implemented. A
  routing advertisement's signature proves it came from who it claims,
  not that the claim should be trusted over an untrusted new identity.
  Deferred to whichever phase builds trust scoring.
- Advertisement propagation is manually simulated one hop at a time in
  tests, not automatic. A real mesh would have each node re-broadcast
  what it's learned continuously; that behavior isn't in `RelayNode`
  yet.

## Phase 4 — Store and Forward (RFC-0007 §2, RFC-0009) — ✅ COMPLETE

| Component | RFC reference | File | Status |
|---|---|---|---|
| Store-and-forward relay queue | RFC-0009 | `src/storage/store.ts` | ✅ Done, 11 tests passing |
| Automatic delayed delivery on RelayNode | RFC-0007 §2 | `src/routing/routing.ts` | ✅ Integrated |

Messages with no known route now queue instead of dropping, and are
automatically forwarded the moment a route is learned, no resend
required. Fair queue allocation is keyed to the **immediate neighbor**
that handed a message over, not the original sender, since RFC-0006
deliberately keeps the original sender sealed from relays; allocating
by something relays can't legitimately see would break metadata
minimization to serve a fairness rule. Flagged as a deliberate
reinterpretation of RFC-0009 §5, not an oversight.

**Known gaps:**
- Queue garbage collection is TTL-based only. RFC-0007 §7's
  acknowledgment-triggered early cleanup isn't wired up yet, that
  needs Ack packets actually flowing back through the mesh, which
  isn't built.
- `getSummary()` (RFC-0009 §6, peer-to-peer queue sync) exists but
  nothing calls it yet, no two queues have actually synced with each
  other. That's Phase 6 (Internet Synchronization) territory.

## Phase 5 — Additional Transports (RFC-0008) — ✅ COMPLETE

| Component | RFC reference | File | Status |
|---|---|---|---|
| Transport interface, simulated Bluetooth and Wi-Fi Direct | RFC-0008 §1, §2, §3 | `src/transport/transport.ts` | ✅ Done, 5 tests passing |
| Fragmentation and reassembly | RFC-0006 §5 | `src/envelope/fragment.ts` | ✅ Done, 8 tests passing |

**Real finding, not a hypothetical one:** the transport tests measured
actual encoded byte size for the first time in this project, and
caught that `envelope.ts`'s original string-keyed CBOR encoding
(`{"dhPublicKey": ..., "ciphertext": ...}`) was too large to fit a
realistic 200-byte BLE MTU even for a two-character message. Fixed by
switching `envelope.ts` to positional (array-based) CBOR encoding, no
field names travel on the wire, both sides already agree on order
from the code. This answers RFC-0010 Section 3's open question about
serialization format compactness with real evidence instead of a
guess.

Fragmentation (RFC-0006 §5) then closed the gap that same discovery
exposed: the exact 220-character message that correctly failed to
cross the simulated Bluetooth transport now succeeds, split into
ordered pieces, reassembled on the far side in any arrival order, and
decrypts correctly.

**Known gaps:**
- Long range radio and Internet gateway transports (RFC-0008 §4, §5)
  aren't modeled yet, only Bluetooth and Wi-Fi Direct.

**Resolved since:** `RelayNode` now forwards through a real `Transport`
instead of calling neighbors directly in-process (see below).

## RelayNode / Transport wiring — ✅ COMPLETE

`routing.ts` rewritten to send real bytes through `Transport.send()`.
The sender no longer sees a full multi-hop delivery path in its
return value, since a real transport can't report what a recipient
did downstream, only whether its own send succeeded. This is treated
as correct behavior, not a limitation: RFC-0002's metadata
minimization principle says a node should only ever know its own
immediate neighbor. Delivery is now observed via `onDelivered()`
listeners registered at the destination node instead of path
inspection at the sender.

## Phase 6 — Internet Synchronization (RFC-0003 §5, RFC-0009 §6)
⬜ Not started.

## Phase 7 — Extended Message Types (files, voice, broadcast)
⬜ Not started.

---

## Test count history

| Milestone | Total tests | Notes |
|---|---|---|
| Phase 1 start | 5 | keys.ts only |
| — | 7 | + handshake.ts |
| — | 11 | + ratchet.ts |
| — | 18 | + envelope.ts (includes full Phase 1 end-to-end test) |
| Phase 1 complete | 27 | + identity.ts |
| Phase 3 complete | 34 | + routing.ts |
| Phase 4 complete | 46 | + store.ts, util.ts consolidation |
| Phase 5 complete | 59 | + transport.ts, fragment.ts, envelope.ts encoding fix |
| — | 58 | RelayNode wired to real Transport; consolidated 2 overlapping routing tests into 1 |

---

## Environment notes

- Working entirely from GitHub Codespaces via mobile browser, no
  local machine involved.
- Package API surfaces have changed across major versions for this
  project's dependencies (`@noble/curves`, `@noble/hashes`,
  `@noble/ciphers`, `cbor-x` all restructured or renamed parts of
  their export surface in current major versions). Habit going
  forward: verify an unfamiliar package's actual export paths with
  `cat node_modules/<package>/package.json | grep -A 40 exports`
  before writing import statements against it, rather than guessing
  from memory or documentation that may be for an older version.
- **`cbor-x`'s `Encoder.encode()` reuses an internal buffer across
  calls**, for performance. Every call site that uses the result
  immediately, once, is fine. The moment code calls `.encode()`
  repeatedly in a loop and reads the results back later (fragment.ts
  was the first place this happened), later calls silently corrupt
  earlier results sharing the same buffer. Fix: wrap every
  `cbor.encode(...)` result in `Uint8Array.from(...)` to force an
  independent copy. Applied in `envelope.ts` and `fragment.ts`.
- Watch for autocorrect mangling package names in terminal commands
  (`@noble` -> `@nobles` has happened more than once), and for the
  mobile file-creation dialog occasionally creating a folder instead
  of a file, or a `.` turning into a `/`, when a path is typed in one
  go, prefer `mkdir -p <dir> && touch <dir>/<file>` from the terminal
  over the New File button for nested paths.

---

*Last updated: Phase 5 complete, 59 tests passing. Next up: either
wiring Transport into RelayNode's real forwarding path, or Phase 6,
Internet synchronization.*
