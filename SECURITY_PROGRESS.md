# Zaycomm Security Hardening

This document is the security-status companion for the main Zaycomm RFC README. It records implementation progress without replacing the RFC series in `README.md`.

## Completed

**C1 — Ratchet rollback/state corruption**

Failed decryptions cannot leave the ratchet permanently advanced or consume skipped-message state incorrectly.

**C2 — ACK/trust manipulation**

Trust changes require authenticated, context-valid ACK evidence rather than unauthenticated acknowledgements.

**C3 — Identity/session binding**

Established sessions are bound to the authenticated peer identity and expected handshake context.

**C4 — Hostile transport/parser input**

Malformed transport and parser inputs are rejected before they can corrupt protocol state.

**C5 — Envelope/header tampering**

Security-sensitive envelope fields are authenticated; mutable relay fields are deliberately excluded where protocol semantics require mutation.

**C6 — Fragment resource exhaustion**

Reassembly is bounded by global fragment-set and byte limits.

**C7 — Routing advertisement replay/staleness**

Routing advertisements are authenticated and freshness/replay controlled.

**C8 — Unauthorized store-forward sync**

Sync requests require authenticated peers and identity-bound authorization.

**C9 — Routing sinkhole/blackhole resistance**

Advertised routes are probationary until destination delivery is validated by an authenticated ACK. Route state expires and failed validation prevents indefinite route attraction.

**C10 — Fragment-state exhaustion/message-ID squatting**

Reassembly performs automatic stale cleanup, preserves global RFC-0006 limits, applies per-peer quotas to authenticated traffic, and binds fragment ownership to authenticated peer/session context.

**C11 — Broadcast amplification**

Broadcast content is capped at 4 KiB. Origins are rate limited to 20 broadcasts per 60 seconds, with separate creation and receiving budgets. Duplicate suppression remains distinct from rate limiting and rate windows are automatically cleaned up.

## Pending adversarial campaign

C12 routing/trust binding → C13 stale-state lifecycle → C14 sync confidentiality → C15 key encapsulation → C16 cross-phase attacks → C17 replay → C18 malicious neighbors → C19 wire fuzzing → C20 concurrency/state races.

## Release rule

The `Test` branch is not release-ready until the pending campaign and final high-adversary scan pass. Historical regression counts alone are not sufficient evidence of security.
