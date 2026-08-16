# Zaycomm — Execution Memory & Forward Roadmap

> Working memory for future Zaycomm implementation sessions.
> This file records verified progress, current architectural boundaries, and the next execution plan.
>
> **Rule:** A planned phase is not implemented until the corresponding code and acceptance tests exist and pass. A simulated transport is not a real hardware transport.

## 1. Current Mission

Zaycomm is being built as an **offline-first, secure, transport-agnostic communication protocol/network**.

Core requirement:

> Real mobile devices must be able to exchange end-to-end encrypted Zaycomm messages without requiring Internet access.

The network must support intermittent connectivity and store-and-forward behavior. If a node happens to have Internet access, it may opportunistically use that connectivity to accelerate delivery, but Internet remains optional to the protocol.

Target architecture:

```text
                    ZAYCOMM ENCRYPTED MESSAGE
                              |
                    Envelope / Packet Layer
                              |
                         Routing Layer
                              |
                      Transport Interface
                              |
          +-------------------+-------------------+
          |                   |                   |
         BLE              Wi-Fi P2P          Internet
          |                   |                   |
          +-------------------+-------------------+
                              |
                       Real Mobile Node
                              |
               +--------------+--------------+
               |                             |
          offline path                 opportunistic
               |                         online path
        local/physical nodes          Internet gateway
```

The protocol must not depend on one physical transport.

---

## 2. Verified Security Memory

### Active branch

- Active development branch: `Test`.
- `main` must not receive these changes until the intended release/adversarial gate is satisfied.

### Security milestones

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
- C12–C20 security hardening campaign: COMPLETE based on the current repository/test baseline and subsequent adversarial campaign work.

### Important security controls already established

- Newly advertised routes enter probation before being trusted.
- Destination-authenticated ACK validation promotes a route.
- Probationary and validated routes expire automatically.
- Failed delivery validation demotes or invalidates a route.
- Global fragment reassembly bounds remain enforced.
- Authenticated peers receive per-peer incomplete-set/byte quotas.
- Fragment message IDs are bound to authenticated peer/session context.
- Unauthenticated transport peers cannot allocate protected fragment state.
- Broadcast payload and per-origin budgets are bounded.
- Duplicate suppression remains separate from rate limiting.
- Replay protection and authenticated session binding are covered by the test suite.

### Release rule

Passing the historical regression suite alone is not sufficient for release. Security work must remain protected by the adversarial campaign and full regression suite.

---

## 3. Verified Real-Node Milestones

The project has now progressed beyond pure in-process protocol tests.

- C21 — RelayNode integration: COMPLETE.
- C22 — Real UDP communication: COMPLETE.
- C23 — Independent OS-process nodes: COMPLETE.
- C24 — Independent-node encrypted sync: COMPLETE.

Recent verified baseline:

```text
41 test files passed
203 tests passed
working tree clean
Test branch synchronized with origin/Test
```

C24 specifically demonstrated encrypted synchronization between independently running OS processes using established directional session keys.

### What this does NOT prove

It does not yet prove communication between physical mobile devices over real phone radios.

---

## 4. Transport Architecture Reality Check

The transport abstraction in `src/transport/transport.ts` intentionally moves opaque frames and reports basic link characteristics such as MTU/reliability.

Existing simulated transport concepts include:

- Bluetooth LE
- Wi-Fi Direct
- Internet

These are currently useful for protocol testing. They are **not** evidence of real phone-radio support.

Therefore:

```text
Simulated Bluetooth != real Bluetooth
Simulated Wi-Fi != real Wi-Fi
Simulated Internet != real Internet
```

The protocol layers above transport must remain independent of transport-specific implementation details.

---

# 5. EXECUTION ROADMAP FROM HERE

Do not invent unrelated milestones. Follow this sequence unless repository evidence requires a documented change.

## C25 — Real Mobile Transport Foundation

**Goal:** run the Zaycomm node engine on a real mobile device and connect a real hardware transport to the existing transport interface.

### C25.1 — Mobile node runtime

Create the minimum mobile runtime that can:

- initialize a Zaycomm identity;
- create/load secure node state;
- initialize the existing protocol stack;
- expose node status;
- start/stop transports;
- receive/send opaque Zaycomm frames.

Keep the mobile UI thin. The protocol/node engine must remain independent of UI concerns.

### C25.2 — Android-first target

Implement Android first as the first physical-device target.

Keep the core protocol portable so iOS can later provide its own native transport adapters.

### C25.3 — Real Bluetooth transport

Implement a real BLE adapter around the existing transport contract.

Required behavior:

- peer/device discovery;
- Zaycomm-level authenticated peer association;
- frame send/receive;
- MTU-aware behavior;
- connection/disconnection handling;
- unreliable-link tolerance;
- integration with existing fragmentation/reassembly where required.

Do not move cryptographic decisions into the BLE adapter.

### C25.4 — First two-device field test

Two real phones:

```text
PHONE A                         PHONE B
Alice                           Bob
  |                               |
  +------ real local radio ------>|
  |       encrypted frame        |
  |<------ authenticated ACK -----|
```

Initial acceptance conditions:

- Internet disabled on both devices;
- cellular data disabled;
- no cloud relay required;
- message travels through the real local transport;
- recipient decrypts successfully;
- destination-signed/authenticated delivery confirmation returns;
- transport cannot decrypt the application payload;
- test is repeatable.

This is the first **real-world Zaycomm communication proof**.

---

# C26 — Real Multi-Node Mobile Mesh

**Goal:** prove that physical devices form a Zaycomm network rather than merely two directly connected endpoints.

Topology:

```text
Alice ---- Bob ---- Charlie
```

Alice sends Charlie a message while Alice and Charlie cannot directly communicate.

Bob is a relay.

Acceptance conditions:

- message crosses multiple physical devices;
- routing works through the intermediate node;
- end-to-end encryption remains intact;
- relay cannot decrypt the application payload;
- destination ACK returns through the mesh;
- replay/duplicate protections remain active;
- nodes can join/leave without corrupting protocol state.

---

# C27 — Persistent Store-and-Forward / Moving Nodes

**Goal:** prove delay-tolerant communication over physical movement and intermittent contact.

Example:

```text
Alice -> Relay phone

Relay phone physically moves

Relay phone -> Bob
```

The relay stores the encrypted envelope while Bob is unavailable and forwards it when a valid contact becomes available.

Field scenarios:

- person walking between communities;
- vehicle carrying a relay phone;
- intermittent radio contact;
- relay goes offline after receiving a message;
- relay restarts before forwarding;
- repeated encounters;
- stale/expired messages;
- reconnect after temporary loss.

Physical movement is simply another delivery opportunity; it must not require special application-level routing logic.

---

# C28 — Opportunistic Internet Gateway

**Goal:** allow an Internet-connected Zaycomm node to accelerate delivery without making Internet mandatory.

Example:

```text
Alice
  |
  | offline local transport
  v
Bob (Internet available)
  |
  | optional Internet transport
  v
Zaycomm gateway/node
  |
  v
Charlie
```

Required semantics:

- Alice does not need Internet.
- Bob may discover Internet availability.
- Bob may forward the encrypted Zaycomm packet over the Internet path.
- Internet is an optimization/transport opportunity, not a protocol dependency.
- If Internet disappears, offline routing/store-and-forward continues.
- An Internet gateway never receives plaintext merely because it is a gateway.

Test both conditions:

```text
Internet available -> opportunistic acceleration
Internet unavailable -> offline behavior continues
```

---

# C29 — Multi-Transport Real Node

**Goal:** a physical node can use multiple real transports without changing the core protocol.

Target set:

```text
BLE
Wi-Fi peer-to-peer / Wi-Fi Direct where supported
Internet
```

Example:

```text
                 +-- BLE -------- peer
                 |
Zaycomm Node ----+-- Wi-Fi ------ peer
                 |
                 +-- Internet -- gateway
```

The transport manager handles transport availability/characteristics. Routing remains responsible for protocol-level forwarding decisions.

---

# C30 — Real Field Network Test Campaign

This is a physical-device test campaign, not just a unit-test suite.

Use multiple phones and deliberately change network conditions.

### Connectivity

- direct contact;
- no contact;
- intermittent contact;
- repeated encounters;
- node disappearance;
- node return;
- Internet toggled on/off.

### Mobility

- stationary nodes;
- walking relay;
- vehicle-mounted relay;
- changing encounter distance;
- changing topology.

### Reliability

- packet loss;
- radio disconnect;
- process restart;
- device restart;
- platform background restrictions where testable;
- delayed delivery;
- duplicate arrival.

### Security

- unauthenticated neighbor;
- malicious relay;
- replay attempt;
- malformed frame;
- wrong destination;
- relay attempting to inspect payload.

Record actual delivery time, path, transport used, failures, retries, and final delivery status.

---

# C31+ — Additional Physical Transports

Only begin these after the real mobile baseline is working.

## Long-range radio

Potential adapters may include appropriate long-range radio hardware supported by the eventual transport specification.

LoRa-class or other purpose-built radios may be investigated, but no specific hardware is considered part of Zaycomm until it is actually implemented and tested.

## Cellular

Treat cellular in two distinct ways:

1. **Cellular Internet:** an online transport/gateway opportunity.
2. **Direct cellular-network capability:** only if a legitimate, technically available mechanism is defined and implemented.

Ordinary cellular Internet must not be described as offline.

## Satellite

Satellite is a future transport/gateway capability.

Do not assume a normal smartphone can arbitrarily transmit Zaycomm packets through satellites. Real support requires compatible device hardware, service, or an external satellite-capable node/gateway.

Target architecture:

```text
Zaycomm node
    |
Satellite transport adapter
    |
Satellite-capable hardware/service
    |
Satellite network
    |
Remote Zaycomm gateway/node
```

The encrypted envelope and routing semantics should not need to change merely because the physical transport changes.

---

# 6. Definition of "Offline"

For Zaycomm, **offline-first** means:

> The protocol can originate, carry, relay, store, and eventually deliver encrypted messages without requiring Internet connectivity.

It does not mean every possible physical transport is disconnected from infrastructure.

```text
BLE                 = offline-capable
Wi-Fi Direct/P2P    = offline-capable
Moving relay        = offline-capable
Long-range radio    = potentially offline-capable
Satellite gateway   = depends on physical satellite system
Cellular Internet   = online transport, opportunistic
Wi-Fi Internet      = online transport, opportunistic
```

Keep this distinction explicit in code, tests, documentation, and product claims.

---

# 7. Testing Ladder

Every major capability should move through:

```text
1. Unit test
       |
2. Integration test
       |
3. Simulated transport test
       |
4. Independent OS-process test
       |
5. Real transport test
       |
6. Two physical devices
       |
7. Three+ physical devices
       |
8. Mobility/intermittency test
       |
9. Hybrid offline + Internet gateway test
       |
10. Field test
```

A simulated transport test can never be used as evidence that the corresponding physical radio works.

---

# 8. Execution Rules for Future Sessions

When continuing Zaycomm work:

1. Read this `MEMORY.md` first.
2. Inspect the current repository state before proposing implementation.
3. Do not invent completed phases, RFC sections, transports, APIs, or hardware capabilities.
4. If something is only planned, label it **PLANNED**.
5. If something is simulated, label it **SIMULATED**.
6. If something has been tested on real hardware, record the exact device/platform/transport and acceptance result.
7. Preserve the transport-agnostic protocol architecture.
8. Keep cryptography/end-to-end security above the transport layer.
9. Prefer small milestones with explicit acceptance criteria.
10. After each implementation milestone:
   - run focused tests;
   - run the complete suite;
   - inspect `git status`;
   - commit the verified change;
   - update this memory/progress documentation when roadmap status changes.
11. Never call a milestone complete because code merely exists. It is complete only after its acceptance criteria are demonstrated.
12. For real-device work, document platform permissions, lifecycle restrictions, and hardware limitations instead of hiding them behind abstractions.
13. Do not move to the next C-phase merely because the previous code compiles; require the stated acceptance test.

---

# 9. Immediate Next Action

**Start C25 — Real Mobile Transport Foundation.**

Do not create another abstract transport simulation as a substitute for the first physical-device proof.

First target:

```text
Android phone A
      |
   real BLE
      |
Android phone B
```

with:

- Internet disabled;
- real Zaycomm node runtime;
- real encrypted envelope;
- real hardware transport adapter;
- successful message delivery;
- authenticated/destination-signed ACK;
- repeatable field-test procedure.

After that succeeds, expand to Wi-Fi peer-to-peer and multi-node routing.

Long-term target:

```text
                    ZAYCOMM NETWORK
                           |
        +------------------+------------------+
        |                  |                  |
       BLE              Wi-Fi P2P        Long-range
        |                  |                  |
        +------------------+------------------+
                           |
                    Mobile relay mesh
                           |
             +-------------+-------------+
             |                           |
       moving nodes                Internet gateway
             |                           |
             +-------------+-------------+
                           |
                    future satellite
```

**The protocol survives without the Internet. Connectivity is opportunistic. Security is end-to-end. Transports are interchangeable. Real phones—not simulations—are the next proof point.**
