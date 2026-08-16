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
- C9 — Routing sinkhole / blackhole resistance: IMPLEMENTED and verified in the regression suite
- C10 — Fragment-state exhaustion: IMPLEMENTED and verified in the regression suite
- C11 — Broadcast amplification: IMPLEMENTED; final regression verification pending after the latest test-fixture correction

## C9 controls
- Newly advertised routes enter probation before being trusted.
- Destination-authenticated ACK validation promotes a route.
- Probationary and validated routes expire automatically.
- Failed delivery validation demotes/invalidates the route.

## C10 controls
- Automatic stale fragment cleanup during allocation.
- Global reassembly bounds remain 128 pending sets / 2 MiB.
- Authenticated peers receive per-peer incomplete-set and byte quotas.
- Fragment message IDs are bound to their authenticated peer/session context.
- Unauthenticated transport peers cannot allocate authenticated fragment state.

## C11 controls
- Maximum broadcast payload: 4 KiB.
- Per-origin broadcast rate budget: 20 per 60-second window.
- Separate local creation and receiving budgets.
- Duplicate suppression remains separate from rate limiting.
- Rate windows are automatically purged.
- Invalid signatures do not consume a receiving-node budget.
- Forwarding budget is defined for mesh amplification control.

## Current regression baseline
- Before C11: 149/149 tests passed.
- Latest C11 run: 151/152 passed because the adversarial test generated more messages through the production creation API than its new origin quota permits.
- The test fixture has now been corrected to generate additional valid signatures directly, modelling a compromised legitimate key without bypassing the production creation quota.
- Re-run the full suite before declaring C11 complete.

## Release rule
Passing the historical regression suite is not sufficient. Zaycomm remains on `Test` until C9–C20 and the final high-adversary campaign pass.
