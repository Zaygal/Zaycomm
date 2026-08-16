# Zaycomm Security Progress

## Security hardening status — Test branch

| Phase | Threat | Status |
|---|---|---|
| C1 | Ratchet rollback / state corruption | ✅ Complete |
| C2 | ACK / trust manipulation | ✅ Complete |
| C3 | Identity ↔ session binding | ✅ Complete |
| C4 | Hostile transport / parser input | ✅ Complete |
| C5 | Envelope / header tampering | ✅ Complete |
| C6 | Fragment resource exhaustion | ✅ Complete |
| C7 | Routing advertisement replay / staleness | ✅ Complete |
| C8 | Unauthorized store-forward sync | ✅ Complete |
| C9 | Routing sinkhole / blackhole | ✅ Complete |
| C10 | Fragment-state exhaustion / message-ID squatting | ✅ Complete |
| C11 | Broadcast amplification | 🟡 Implemented; final suite verification pending |
| C12 | Routing/trust cryptographic binding | 🔴 Pending |
| C13 | Automatic stale-state cleanup | 🔴 Pending |
| C14 | Sync confidentiality | 🔴 Pending |
| C15 | Handshake root-key exposure | 🔴 Pending |
| C16 | Cross-phase adversarial attacks | 🔴 Pending |
| C17 | Replay campaign | 🔴 Pending |
| C18 | Malicious-neighbor campaign | 🔴 Pending |
| C19 | Fuzzing / malformed-wire campaign | 🔴 Pending |
| C20 | Concurrency / state-race campaign | 🔴 Pending |

## Verified regression history

- C8 baseline: 143/143 tests passed.
- C9 verification: 145/145 tests passed.
- C10 verification: 149/149 tests passed.
- C11 initial run: 151/152 passed. The single failure was in the adversarial test fixture, not a failed broadcast defense: the test attempted to create more than the configured 20-per-minute origin quota through `createBroadcastMessage()` itself.
- C11 test fixture has been corrected to produce the extra valid signed broadcasts directly, modelling a compromised legitimate identity while preserving the production origin-creation quota.

## C9 implementation summary

Routes learned from advertisements begin in probation. A route is promoted only after delivery validation using a destination-authenticated ACK. Probationary and validated routes have bounded lifetimes, and failed validation prevents a malicious relay from retaining an attractive route indefinitely.

## C10 implementation summary

Fragment reassembly now performs automatic stale cleanup during allocation. Global RFC-0006 bounds remain intact. Authenticated peers receive per-peer incomplete-set and byte quotas, and fragment ownership is tied to authenticated peer/session context. The transport integration rejects unauthenticated fragmented traffic before it can allocate protected reassembly state.

## C11 implementation summary

Broadcast content is capped at 4 KiB. A single origin receives a bounded creation/receiving budget of 20 broadcasts per 60-second window. Receiving-node rate limiting is separate from duplicate suppression, and rate windows are automatically purged. Signature verification happens before an inbound origin consumes its receiving budget.

## Release gate

`Test` must not merge into `main` until C9–C20 have been implemented, adversarial tests pass, the combined regression suite is clean, and a final high-adversary review finds no unresolved critical/high findings.
