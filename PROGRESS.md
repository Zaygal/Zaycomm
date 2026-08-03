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
- `handshake.ts`, `ratchet.ts`, and now `identity.ts` each contain
  their own local copy of small byte helpers (`buildNonce`,
  `concatBytes`, `bytesEqual`, `u32le`/`u64le`). Three files now
  duplicate this, which is the threshold that justifies factoring
  them into a shared `src/crypto/util.ts`. Deliberately not done yet,
  touching three already-tested, passing files to save a few
  duplicate lines carries real risk for cosmetic benefit. Worth doing
  as its own small, isolated cleanup pass, not bundled into feature
  work.
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

## Phase 4 — Store and Forward (RFC-0007 §2, RFC-0009)
⬜ Not started.

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




## Phase 5 — Additional Transports (RFC-0008)
⬜ Not started.

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
- Watch for autocorrect mangling package names in terminal commands
  (`@noble` -> `@nobles` has happened more than once), and for the
  mobile file-creation dialog occasionally creating a folder instead
  of a file when a path is typed in one go, prefer `mkdir -p <dir> &&
  touch <dir>/<file>` from the terminal over the New File button for
  nested paths.

---

*Last updated: Phase 1 complete, 27 tests passing. Next up: Phase 3, local multi-hop routing (RFC-0007 §4).*