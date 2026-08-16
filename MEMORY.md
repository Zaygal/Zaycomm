# Zaycomm Security Memory

## Current branch
- Active security-hardening branch: `Test`
- `main` must not receive these changes until the final adversarial release gate passes.

## Verified security milestones
- C1 — Ratchet rollback / state corruption: COMPLETE
- C2 — ACK / trust manipulation: COMPLETE
- C3 — Identity ↔ session binding: COMPLETE
- C4 — Hostile transport / parser input: COMPLETE
- C5 — Envelope / header tampering: COMPLETE
- C6 — Fragment resource exhaustion: COMPLETE
- C7 — Routing advertisement replay / staleness: COMPLETE
- C8 — Unauthorized store-forward sync: COMPLETE
- C9 — Routing sinkhole / blackhole resistance: COMPLETE and verified
- C10 — Fragment-state exhaustion / message-ID squatting: COMPLETE and verified
- C11 — Broadcast amplification: COMPLETE and verified

## Current regression baseline
- C9: 145/145 tests passed.
- C10: 149/149 tests passed.
- C11: 152/152 tests passed.

## C9 controls
- Newly advertised routes enter probation before being trusted.
- Destination-authenticated ACK validation promotes a route.
- Probationary and validated routes expire automatically.
- Failed delivery validation demotes or invalidates the route.

## C10 controls
- Automatic stale fragment cleanup during allocation.
- Global reassembly bounds remain 128 pending sets / 2 MiB.
- Authenticated peers receive per-peer incomplete-set and byte quotas.
- Fragment message IDs are bound to authenticated peer/session context.
- Unauthenticated transport peers cannot allocate protected fragment state.

## C11 controls
- Maximum broadcast payload: 4 KiB.
- Per-origin broadcast budget: 20 per 60-second window.
- Separate local creation and receiving budgets.
- Duplicate suppression remains separate from rate limiting.
- Rate windows are automatically purged.
- Invalid signatures do not consume a receiving-node budget.

## Next security phase
C12 — routing/trust cryptographic binding.

After C12: C13 stale-state lifecycle → C14 sync confidentiality → C15 key encapsulation → C16 cross-phase attacks → C17 replay → C18 malicious-neighbor campaign → C19 fuzzing → C20 concurrency/state-race campaign → final high-adversary scan.

## Release rule
Passing the historical regression suite is not sufficient. Zaycomm remains on `Test` until C1–C20 and the final high-adversary campaign pass.
