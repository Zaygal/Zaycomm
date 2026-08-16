# Zaycomm Security Progress

## Security hardening status — `Test` branch

This file records **what has actually been implemented and verified**. It is not the protocol architecture specification; the architecture and long-term security plan belong in `README.md` and the RFC series.

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
| C9 | Routing sinkhole / blackhole resistance | ✅ Complete |
| C10 | Fragment-state exhaustion / message-ID squatting | ✅ Complete |
| C11 | Broadcast amplification | ✅ Complete |
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

- C8 baseline: **143/143** tests passed.
- C9 verification: **145/145** tests passed.
- C10 verification: **149/149** tests passed.
- C11 final verification: **152/152** tests passed.

The C11 test fixture was corrected after the first run exposed a test-design problem: the adversarial test was trying to create more broadcasts through the production origin-creation API than the newly enforced origin quota permits. The final adversarial test models a legitimate but malicious identity producing valid signed traffic at the receiving node, while preserving the production creation limit.

## Implemented security controls

### C1 — Ratchet rollback / state corruption

Ratchet failure paths are tested so failed decryptions cannot leave the ratchet permanently advanced or consume skipped-message state incorrectly.

### C2 — ACK / trust manipulation

Trust changes require authenticated, context-valid ACK evidence rather than unauthenticated acknowledgements.

### C3 — Identity ↔ session binding

Established sessions are bound to the authenticated peer identity and expected handshake context.

### C4 — Hostile transport / parser input

Malformed transport and parser inputs are rejected before they can corrupt protocol state.

### C5 — Envelope / header tampering

Security-sensitive envelope fields are authenticated; relay-mutable fields remain mutable only where protocol semantics require it.

### C6 — Fragment resource exhaustion

Reassembly has bounded global fragment-set and byte limits.

### C7 — Routing advertisement replay / staleness

Routing advertisements are authenticated and protected against replay and stale-state abuse.

### C8 — Unauthorized store-forward sync

Store-forward synchronization requires authenticated peers and identity-bound authorization.

### C9 — Routing sinkhole / blackhole resistance

Newly advertised routes begin in probation. A route is promoted only after delivery validation using a destination-authenticated ACK. Probationary and validated route state has bounded lifetime, preventing a malicious relay from retaining an attractive route indefinitely without successful delivery.

### C10 — Fragment-state exhaustion / message-ID squatting

Fragment reassembly automatically purges stale state during allocation. Global RFC-0006 limits remain intact. Authenticated peers receive per-peer incomplete-set and byte quotas. Fragment ownership is bound to authenticated peer/session context, and unauthenticated transport peers cannot allocate protected reassembly state.

### C11 — Broadcast amplification

Broadcast payloads are capped at 4 KiB. A single origin has a bounded 20-broadcast/60-second budget. Local creation and inbound receiving budgets are separate. Duplicate suppression remains separate from rate limiting, rate windows are automatically cleaned up, and invalid signatures do not consume an inbound origin budget.

## Current release position

- Active hardening branch: `Test`
- `main`: **do not merge yet**
- Completed through: **C11**
- Next implementation target: **C12**
- Release gate: C1–C20 implemented and adversarially verified, followed by a final high-adversary scan with no unresolved critical/high findings.

Passing the historical regression suite alone is not considered a security release gate.
