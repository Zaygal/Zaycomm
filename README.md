# Zaycomm Protocol: Complete RFC Series
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-v1.0-blue)](https://github.com/yourusername/Zaycomm/releases/tag/v1.0)
[![Tests](https://img.shields.io/badge/tests-104%20passing-brightgreen)](https://github.com/yourusername/Zaycomm)
## A Roadmap for a Secure, Decentralized, Transport Agnostic Mesh Communication Protocol

This document combines RFC 0001 through RFC 0010 of the Zaycomm project into a single reference, intended to be used as a build roadmap. Each original RFC remains intact and in order below; nothing has been shortened or altered from the individually issued versions except for the addition of a small number of architecture diagrams at points where a visual helps tie sections together. Cross references between sections (for example, "per RFC 0004, Section 2.3") still work exactly as written, since the numbering scheme is unchanged.

---

## Table of Contents

1. RFC 0001, Project Constitution
2. RFC 0002, Threat Model
3. RFC 0003, Protocol Overview
4. RFC 0004, Cryptographic Architecture
5. RFC 0005, Identity Architecture
6. RFC 0006, Packet Specification
7. RFC 0007, Routing Algorithm
8. RFC 0008, Transport Layer
9. RFC 0009, Storage Layer
10. RFC 0010, Reference Architecture and Implementation Plan

---

# RFC-0001: Project Constitution

**Project:** Zaycomm
**Status:** Draft
**Series:** Zaycomm RFC Series (RFC-0001 through RFC-0010)
**Supersedes:** None
**Depends on:** None

---

## 0. Preface

This document is the foundational charter for Zaycomm. It does not specify wire formats, cryptographic primitives, or routing algorithms — those live in later RFCs. This document exists to answer a narrower but more important question first: **what is this system for, and what rules will every later engineering decision be judged against.**

Every subsequent RFC must be traceable back to a principle stated here. If a future design decision cannot be justified against this document, either the decision is wrong or this document needs a formal amendment — not a silent exception.

---

## 1. Mission

Zaycomm exists to let people exchange authenticated, end-to-end encrypted messages with each other when the normal infrastructure they'd use to do that — cellular networks, ISPs, the public Internet — is unavailable, untrusted, or actively hostile.

It is a **protocol**, not an app. The app is one possible client built on top of it.

## 2. Vision

A future in which:

- A disaster response team can coordinate over a multi-hop mesh after cell towers go down, with no dependency on any surviving infrastructure.
- A rural community with no reliable broadband can still run store-and-forward messaging between villages, syncing to the wider Internet whenever any single node gets connectivity.
- A journalist or organizer in a network under surveillance or restriction can communicate with the same cryptographic guarantees as someone with a trusted ISP.
- None of the above requires the user to trust Zaycomm's operators, because there are no operators — only the protocol and the people running nodes.

Zaycomm succeeds if it becomes boring, unglamorous infrastructure that other applications build on — the way TCP/IP is infrastructure, not a product.

## 3. Design Philosophy

**Protocol first, transport second.** The core protocol must not know or care whether bytes moved over Bluetooth Low Energy, Wi-Fi Direct, LoRa, a USB stick carried by hand, or the Internet. Transports are pluggable adapters that deliver opaque encrypted frames. This is the single most important architectural constraint in this project — see Section 4.1.

**Assume hostility, not just unreliability.** Distributed-systems thinking alone (handle partitions, handle latency) is not sufficient. Every component must also be designed as if an adversary controls some fraction of the network, some fraction of the nodes, and possibly has physical access to a device. Reliability engineering and security engineering are treated as one discipline here, not two.

**Small, auditable, composable pieces over clever monoliths.** A protocol that is going to ask people to bet their safety on it must be reviewable by someone who is not its author. Complexity is a security cost, not just an engineering cost.

**Store-and-forward is the default, not a fallback.** Zaycomm is not "internet messaging that also works offline." It is offline-first, delay-tolerant messaging that can optionally use the Internet as one transport among several when available.

**Long-range is a routing problem, not a radio problem — mostly.** A 600–1000 km delivery distance is achieved primarily through multi-hop store-and-forward relay across many nodes, not by any single transport's raw range. BLE and Wi-Fi Direct realistically deliver tens to low hundreds of meters per hop. Reaching hundreds of kilometers means either (a) chaining many short hops across a populated mesh, (b) incorporating a long-range transport (e.g. LoRa-class radio, HF packet radio, or satellite store-and-forward) as one of the pluggable transports in Section 4.1, or, most realistically, (c) both. RFC-0008 (Transport Layer) will treat long-range radio as a first-class transport candidate rather than an afterthought. This constitution does not promise 600–1000 km over Bluetooth alone, because that promise would be false.

## 4. Core Principles

### 4.1 Transport Agnosticism
The protocol operates on an abstract "link" concept. Any medium capable of moving bytes between two nodes — even intermittently, even asymmetrically — is a valid link. No protocol-layer decision may assume properties specific to one transport (e.g. Bluetooth's connection model, or the Internet's assumption of near-always-available low-latency paths).

### 4.2 Decentralization by Default
No mandatory servers, brokers, or coordinators. Optional infrastructure (rendezvous points, relay servers, directory services) may exist to *improve* the network but the protocol must remain fully functional — messaging, routing, sync — without any of them.

### 4.3 Zero Trust in the Network
Every intermediate hop is assumed to be potentially malicious, compromised, or merely nosy. Confidentiality and integrity must hold even when every relay between sender and recipient is hostile. Only endpoints are trusted, and only after cryptographic authentication.

### 4.4 Minimal Metadata Exposure
What an adversary observing traffic can learn should be minimized deliberately, not as an afterthought. This is a design constraint on packet formats and routing (RFC-0006, RFC-0007), not a marketing claim.

### 4.5 Graceful Degradation
The system should degrade in capability, not in safety, as conditions worsen. Losing connectivity should mean "messages queue" — not "messages get exposed" or "messages get silently dropped without recourse."

### 4.6 Progressive Disclosure of Complexity
A two-node direct link should be nearly trivial to reason about. Multi-hop mesh routing, delay-tolerant sync, and future features (voice, broadcast) are layered on top rather than baked into the foundation, so the core stays auditable even as the system grows.

## 5. Security Principles

1. **No home-grown cryptography, ever.** Only well-studied, independently reviewed primitives and constructions (detailed with rationale in RFC-0004). Novel cryptographic design is explicitly out of scope for this project at any stage.
2. **Forward secrecy is mandatory, not optional,** for interactive sessions. Compromise of a long-term identity key must not retroactively expose past message content.
3. **Authentication before trust.** A device or identity must be cryptographically verified before its messages, routing advertisements, or store-and-forward contributions are trusted, weighted, or relayed preferentially.
4. **Compromise containment.** The architecture should assume some nodes *will* be compromised or malicious and must limit the blast radius of any single compromised node — it should not be able to deanonymize other users, forge messages from other identities, or poison routing for the whole mesh.
5. **Fail closed, not open.** When a security invariant cannot be verified (e.g. a signature fails, a key is unknown), the default behavior is to reject or quarantine, never to silently degrade to an insecure mode.
6. **Auditability is a first-class feature.** Every cryptographic and routing decision must be specifiable precisely enough that an independent auditor can verify an implementation against the spec without needing to ask the original authors what was "meant."

## 6. Threat Model Overview

This is a summary; the full threat model with actors, capabilities, and specific attack trees is RFC-0002. At a constitutional level, Zaycomm is designed to resist:

- **Passive network observers** — logging traffic, timing, and volume across links or at chokepoints.
- **Active on-path adversaries** — malicious or coerced relay nodes that can drop, delay, duplicate, reorder, or attempt to tamper with traffic.
- **Malicious participants** — legitimately enrolled nodes/identities that behave adversarially (spam, routing poisoning, Sybil attempts, store-and-forward flooding).
- **Device compromise (bounded)** — the architecture should limit what an attacker who compromises one device or one node's storage can do to *other* users, even though it cannot protect the compromised device's own data.
- **Infrastructure denial** — the loss or blocking of the Internet, cellular networks, or specific transports must degrade capability, not security.

Explicitly **not** fully addressed at the protocol layer (see Non-Goals, Section 7): nation-state-level traffic correlation across an entire physical mesh, and endpoint/device security (malware on the user's device) — these are acknowledged, bounded, and documented, not solved.

## 7. Non-Goals

Being explicit about what Zaycomm is *not* trying to be is as important as the mission statement.

- **Not** an app-layer product decision document — this series specifies protocol, not UI/UX.
- **Not** claiming perfect anonymity or resistance to global passive adversaries with full network visibility (that is a Tor/mixnet-class problem with different tradeoffs); Zaycomm targets confidentiality, integrity, and censorship-resilience, and will document anonymity limitations honestly rather than overclaim.
- **Not** inventing new cryptographic primitives or protocols where proven ones (e.g. Noise, Signal-derived double ratchet, X25519, Ed25519) suffice.
- **Not** promising specific point-to-point range figures for any single transport that physics doesn't support; range claims are always about the *mesh*, with transport-level numbers stated honestly per RFC-0008.
- **Not** dependent on any single transport, vendor SDK, or platform-specific API at the protocol layer.
- **Not**, at this stage, attempting to solve endpoint compromise, device theft, or coerced disclosure — these are acknowledged threats addressed by operational guidance later, not by this protocol.

## 8. Success Criteria

Zaycomm's constitution is upheld if, at each milestone:

- The protocol specification can be implemented independently by a second party from the RFCs alone, without needing to consult the original authors, and interoperate with a reference implementation.
- Every cryptographic claim in the spec cites the specific proven primitive/construction used and the reasoning for choosing it over alternatives (per the system-level instruction to never invent crypto).
- A security researcher unfamiliar with the project can read RFC-0002 through RFC-0007 and construct a meaningful attack-tree review without needing implementation source code.
- The protocol functions correctly in a pure offline multi-hop scenario (no Internet, no single always-on node) in test scenarios before any Internet-sync feature is considered complete.
- Adding a new transport (e.g. going from Bluetooth-only to Bluetooth + Wi-Fi Direct + LoRa) requires no change to the core protocol layer — only a new transport adapter.

## 9. Development Standards

- **Spec before code.** No implementation work begins on a component until its RFC is in at least "Draft — stable enough to implement against" status.
- **Primitive justification required.** Any PR or design doc introducing a cryptographic primitive, library, or construction must document why it was chosen and what alternatives were considered (this constitution mandates it; RFC-0004 will hold the running record).
- **No silent protocol deviations.** Implementation-specific shortcuts must be flagged in code and tracked against the spec, not merged silently.
- **Security-relevant changes require explicit threat-model review** against RFC-0002 before merge, not after.
- **Reference implementation and spec evolve together** but the spec is the source of truth; when they conflict, that is treated as a bug in one of the two, resolved explicitly, not by letting code become the de facto spec.

## 10. Documentation Standards

- All architecture decisions live in the numbered RFC series (RFC-0001–RFC-0010 initially; the series is extensible).
- Each RFC has a `Status` field (`Draft`, `Stable`, `Superseded`, `Deprecated`) and a `Supersedes` / `Depends on` field so the dependency graph between documents is always explicit — as used at the top of this document.
- Changes to a `Stable` RFC require a new RFC that formally supersedes it — no silent edits to documents once implementations depend on them.
- Every cryptographic or routing decision documented in later RFCs must be written so that "why" is answered, not just "what" — future maintainers and auditors need the reasoning, not just the conclusion.

---

*End of RFC-0001. Next: RFC-0002 — Threat Model.*
# RFC 0002: Threat Model

Project: Zaycomm
Status: Draft
Series: Zaycomm RFC Series
Supersedes: None
Depends on: RFC 0001 (Project Constitution)

---

## 0. Preface

RFC 0001 stated, at a constitutional level, the classes of adversary Zaycomm is meant to resist. This document expands that into a working threat model: concrete assets, trust boundaries, adversary capabilities, and a structured catalog of attacks each later RFC must answer to. Every cryptographic choice in RFC 0004, every routing rule in RFC 0007, and every packet field in RFC 0006 should trace back to something in this document. If it does not, it is speculative engineering rather than threat driven design.

## 1. Purpose and Scope

This threat model covers the protocol layer only: message confidentiality and integrity, identity authentication, routing, and store and forward storage as they exist between nodes. It does not cover application level UI decisions, and it does not attempt to fully solve endpoint compromise, which RFC 0001 already placed outside the protocol's responsibility. Where endpoint compromise interacts with protocol design (for example, what a compromised device can do to other users through the network), that interaction is in scope.

## 2. System Assets

What Zaycomm is protecting, in priority order:

1. Message content confidentiality between the intended sender and recipient(s).
2. Message and sender authenticity, so a recipient can trust who actually sent something.
3. Message integrity in transit and in storage, so content cannot be altered undetected.
4. Identity key material on each device, since compromise of a long term key undermines everything built on it.
5. Availability of delivery, meaning a message that is queued should eventually reach its recipient given enough time and any working path through the mesh.
6. Metadata about who is talking to whom, when, and how often, treated as a lower but still real priority asset.
7. Routing and network topology information, which if fully exposed could let an adversary target specific nodes physically or digitally.

## 3. Trust Boundaries

Zaycomm defines three trust zones:

**Zone A, the device itself.** Everything inside a user's device, including key storage and the local message store, is trusted by that device's own client. This zone is not protected by the protocol; it is the user's own security responsibility, acknowledged in RFC 0001's non goals.

**Zone B, the link between two directly connected nodes.** A single hop transport connection (Bluetooth, Wi Fi Direct, LoRa, or otherwise). This zone is assumed untrusted by default; even a directly connected peer may be malicious.

**Zone C, the wider mesh.** Every node beyond the immediate link, reached through some number of intermediate relays. This zone is assumed fully hostile: any relay may inspect, drop, duplicate, delay, or attempt to modify traffic it forwards.

The core design rule that follows from this: cryptographic guarantees must hold at the boundary between Zone A and everything outside it. No intermediate zone is ever trusted for confidentiality or integrity, only for delivery.

```
        ZONE A                ZONE B                 ZONE C
      (trusted)            (one hop link,          (the wider mesh,
                             untrusted)              fully hostile)

   +-----------+          +-----------+          +-----------+   +-----------+
   |  Device   |==========|   Peer    |==========|  Relay 1  |===|  Relay 2  |==...
   | (keys,    |  direct  | (device   |  further  | (cannot   |   | (cannot   |
   |  local    |  link    |  next to  |   hops    |  read     |   |  read     |
   |  store)   |          |  you)     |           |  content) |   |  content) |
   +-----------+          +-----------+          +-----------+   +-----------+
        ^                                                              |
        |                                                              v
        |                                                        +-----------+
        +========================================================|  Device B |
                     end to end encrypted, authenticated          | (trusted, |
                     regardless of hop count or path taken        |  Zone A)  |
                                                                   +-----------+
```
*Confidentiality and integrity hold only between the two Zone A endpoints. Everything in between, however many hops, is Zone B or Zone C and is never trusted with plaintext.*

## 4. Adversary Classes

### 4.1 Passive Network Observer
Capability: can see traffic on one or more links or at a specific physical location, including timing, volume, and packet metadata, but cannot alter, inject, or drop traffic.
Goal: build a picture of who communicates with whom, when, and how much, even without reading content.

### 4.2 Active On Path Adversary
Capability: everything a passive observer can do, plus the ability to drop, delay, duplicate, reorder, or attempt to modify packets it relays or intercepts.
Goal: disrupt delivery, deny service to specific participants, or attempt to tamper with content, forcing detection to rely entirely on cryptographic integrity checks rather than trust in the transport.

### 4.3 Malicious or Coerced Relay Node
Capability: a fully participating node in the mesh, legitimately enrolled, that behaves adversarially in routing, storage, or forwarding decisions. May be a device whose owner is hostile, or a legitimate device that has been coerced or subpoenaed.
Goal: poison routing tables, selectively withhold store and forward delivery to specific targets, or attempt Sybil style attacks by presenting many apparent identities.

### 4.4 Compromised Endpoint (bounded)
Capability: full control of one user's device, including its key material and local storage, but only that device.
Goal: read that user's own past and future messages (accepted as unavoidable per RFC 0001), and, more importantly for this threat model, attempt to use that compromise to attack other users, for example by forging messages under the compromised identity, or by using local trust to attack peers.
Boundary: the protocol's job here is containment, not prevention. A single compromised device must not be able to impersonate other identities, decrypt other users' past traffic (forward secrecy), or gain outsized influence over routing for the whole mesh.

### 4.5 Infrastructure Denial Adversary
Capability: can block or degrade specific transports, for example jamming radio frequencies, blocking Bluetooth at a physical location, or cutting Internet access entirely.
Goal: force the network into a degraded or unreachable state.
Design implication: this is why Zaycomm's transport agnosticism from RFC 0001 is a security property, not just an engineering convenience. Denial of one transport must not be denial of the protocol.

### 4.6 Global or Near Global Passive Adversary (explicitly bounded, not solved)
Capability: visibility across a very large fraction of the physical mesh at once, enabling traffic correlation attacks that no single relay level defense can fully prevent.
Status: acknowledged as a real threat class, explicitly out of full scope per RFC 0001's non goals. Zaycomm will document what protection it does and does not offer against this adversary rather than making an unearned claim of anonymity.

## 5. Attack Surface by Component

**Transport layer.** Exposed to Zone B and C adversaries directly. Attack surface includes connection level metadata leakage, denial of service against the physical medium, and any transport specific weaknesses (for example Bluetooth pairing flaws) that must be prevented from leaking into the protocol layer above.

**Routing layer.** Exposed to Zone C. Attack surface includes route advertisement forgery, Sybil identity flooding, selective forwarding or blackholing by malicious relays, and topology inference by adversaries observing routing traffic.

**Store and forward storage.** Exposed to any node holding queued messages on behalf of others. Attack surface includes unauthorized reading of stored ciphertext (mitigated by end to end encryption so storage nodes never hold plaintext), storage exhaustion or flooding attacks, and selective drop of specific users' queued messages by a hostile storage node.

**Identity and key management.** Exposed to Zone A primarily, with Zone C relevant for key distribution and verification. Attack surface includes key compromise, impersonation through weak identity binding, and the difficulty of key verification without any central authority.

**Cryptographic session layer.** Exposed conceptually to all zones since it is the layer everything else must trust. Attack surface includes any implementation or protocol level failure that would undermine confidentiality, integrity, authentication, or forward secrecy, which is why RFC 0004 restricts itself entirely to proven primitives.

## 6. Threat Catalog

Organized loosely by category. Each entry states the threat, the affected asset from Section 2, and which later RFC is responsible for the mitigation.

| Threat | Asset affected | Primary mitigating RFC |
|---|---|---|
| Eavesdropping on message content | Confidentiality | RFC 0004 |
| Message tampering in transit or storage | Integrity | RFC 0004, RFC 0006 |
| Sender impersonation | Authenticity | RFC 0004, RFC 0005 |
| Long term key compromise exposing past sessions | Confidentiality | RFC 0004 (forward secrecy) |
| Malicious relay dropping or delaying specific users' traffic | Availability | RFC 0007 |
| Sybil identity flooding to gain routing influence | Availability, routing integrity | RFC 0005, RFC 0007 |
| Traffic analysis revealing communication patterns | Metadata | RFC 0006, RFC 0007 |
| Topology exposure enabling physical targeting of nodes | Routing metadata | RFC 0007 |
| Store and forward flooding or storage exhaustion | Availability | RFC 0009 |
| Transport level denial of service against one medium | Availability | RFC 0008 |
| Replay of previously valid messages or routing advertisements | Integrity | RFC 0004, RFC 0006 |
| Compromised device forging messages under its own identity | Bounded, accepted | RFC 0001 non goals |
| Compromised device attacking other identities through the mesh | Containment | RFC 0005, RFC 0007 |

## 7. Trust Assumptions

Stated explicitly so later RFCs can be checked against them:

1. A device's own key material, while uncompromised, is trustworthy for that device.
2. No relay, anywhere in Zone B or Zone C, is assumed trustworthy for confidentiality or integrity, only for best effort delivery.
3. Cryptographic primitives chosen in RFC 0004 are assumed sound as currently understood by the wider cryptographic community; Zaycomm does not attempt to independently validate primitive level security, only correct use of already proven primitives.
4. Physical security of a device (theft, coercion, seizure) is outside protocol scope and is the responsibility of the user and, eventually, operational guidance documentation, not the protocol itself.
5. The mesh will, at times, contain some fraction of actively malicious nodes, and the protocol must remain secure and functional under that assumption rather than assuming good faith participation.

## 8. Residual Risks and Explicitly Out of Scope

Carried forward from RFC 0001's non goals and made explicit here:

- Full resistance to a global passive adversary performing traffic correlation across the entire mesh is not claimed.
- Endpoint compromise (malware, physical device access while unlocked) is not prevented by the protocol.
- Coerced disclosure of a user's own keys by legal or physical means is not something any protocol can prevent; Zaycomm will not claim otherwise.
- Denial of service against the mesh as a whole by an adversary with resources to attack many nodes simultaneously is reduced in impact by decentralization but not eliminated.

These residual risks will be restated, not hidden, in any future audit facing documentation.

## 9. Review and Update Process

This threat model is a living document once implementation begins. Any new feature proposed in a later RFC that introduces a new attack surface must be reviewed against this catalog before merge, and if it introduces a genuinely new threat class, this document must be formally updated through a superseding RFC rather than an informal patch, consistent with the documentation standards set in RFC 0001.

---

End of RFC 0002. Next: RFC 0003, Protocol Overview.
# RFC 0003: Protocol Overview

Project: Zaycomm
Status: Draft
Series: Zaycomm RFC Series
Supersedes: None
Depends on: RFC 0001 (Project Constitution), RFC 0002 (Threat Model)

---

## 0. Preface

This document describes the shape of the protocol before any single layer is specified in full detail. It exists so that RFC 0004 through RFC 0009 can each be read as "the detailed spec for one box in this diagram" rather than as isolated documents. No cryptographic primitives, packet fields, or routing algorithms are finalized here; those belong to later RFCs and are only referenced by name.

## 1. Layered Architecture

Zaycomm is organized into five logical layers. Each layer only depends on the interface exposed by the layer below it, never on implementation details of that layer.

1. **Transport layer.** Moves opaque bytes between two directly reachable nodes over some physical or virtual medium. Fully specified in RFC 0008.
2. **Session and cryptographic layer.** Establishes authenticated, encrypted sessions between identities, independent of which transport carried the bytes. Fully specified in RFC 0004.
3. **Routing layer.** Decides how a message gets from a source identity to a destination identity across zero or more intermediate relay nodes. Fully specified in RFC 0007.
4. **Storage layer.** Handles local message persistence and store and forward queuing on behalf of others while offline delivery is pending. Fully specified in RFC 0009.
5. **Application layer.** Text messaging today, with files, voice, and emergency broadcast planned as future message types riding the same lower layers, per RFC 0001's extensibility principle.

A message traveling from sender to recipient touches every layer at the source node, only transport and routing at each intermediate relay (relays never see plaintext or session state, per the zero trust principle in RFC 0002), and every layer again at the destination node.

```
   SOURCE NODE                RELAY NODE(S)              DESTINATION NODE
  +----------------+        +----------------+          +----------------+
  | Application     |        |                |          | Application     |
  +----------------+        |                |          +----------------+
  | Storage         |        |                |          | Storage         |
  +----------------+        |                |          +----------------+
  | Routing         |<------>| Routing        |<-------->| Routing         |
  +----------------+        +----------------+          +----------------+
  | Session/Crypto  |        |  (no access to |          | Session/Crypto  |
  +----------------+        |   session or    |          +----------------+
  | Transport       |<------>|   plaintext)    |<-------->| Transport       |
  +----------------+        +----------------+          +----------------+
                             | Transport       |
                             +----------------+
```
*Only the Transport and Routing layers are touched at a relay. Session, Storage of relayed queues, and Application layers only ever operate meaningfully at the two endpoints, consistent with the zero trust trust boundary from RFC 0002.*

## 2. Node Roles

Zaycomm does not distinguish node types at the protocol level; any device can act in any of the following roles simultaneously, since decentralization by default (RFC 0001, Section 4.2) rules out fixed server roles.

- **Endpoint role.** Originating or receiving messages addressed to that node's own identity.
- **Relay role.** Forwarding traffic on behalf of other identities, participating in multihop routing without reading plaintext.
- **Store and forward host role.** Temporarily holding encrypted messages for a recipient that is not currently reachable, until either the recipient becomes reachable or a retention limit expires.
- **Gateway role.** A node that happens to have Internet connectivity at a given moment and can bridge mesh traffic to Internet based transports and back, purely as one more transport option, never as a required central point.

Any device can hold zero, one, or several of these roles at once, and roles can change moment to moment as connectivity changes.

## 3. Message Lifecycle

At a high level, independent of which transport or route is used:

1. **Compose.** The application layer produces plaintext content and a destination identity.
2. **Encrypt.** The session layer encrypts the content for that destination using an established or newly negotiated session, per RFC 0004.
3. **Envelope.** The routing layer wraps the ciphertext in a packet envelope containing only the minimal metadata needed for routing, per RFC 0006.
4. **Route.** The routing layer determines a next hop or set of candidate next hops, per RFC 0007.
5. **Transmit.** The transport layer delivers the envelope to the chosen next hop over whatever medium is currently available, per RFC 0008.
6. **Relay or store.** An intermediate node either forwards the envelope onward immediately if it knows a next hop, or queues it in its store and forward layer if the destination or a further relay is not currently reachable, per RFC 0009.
7. **Deliver.** The destination node receives the envelope, and its session layer decrypts and authenticates the content before handing it to the application layer.
8. **Acknowledge (optional).** Depending on message type, an acknowledgment may travel back along a route, itself subject to the same encryption and routing rules.

This lifecycle is identical whether the message crosses zero intermediate hops on a direct link or many hops across a delay tolerant mesh spanning hours or days; only the timing and number of relay and store steps differ.

```
 Compose --> Encrypt --> Envelope --> Route --> Transmit --> Relay/Store --> Deliver --> Acknowledge
   (App)     (Session)   (Routing)   (Routing)  (Transport)   (repeats N     (Session)   (optional,
                                                                times across               same path
                                                                the mesh)                  in reverse)
```

## 4. Connectivity Model

Zaycomm assumes connectivity is intermittent, asymmetric, and heterogeneous by default, not as an edge case:

- Two nodes may be connected briefly (a passing Bluetooth contact), for an extended period (two nodes sharing a room over Wi Fi Direct), or never directly, only through a chain of others.
- A node's set of reachable neighbors changes constantly and is not assumed to be known in advance.
- The presence of Internet connectivity at any single node is treated as an opportunistic transport availability event, not as a special network state that other logic depends on.

This is why the routing layer (RFC 0007) is built on delay tolerant networking principles rather than assuming the always connected model that conventional IP based routing relies on.

## 5. Synchronization Model

When a node gains Internet connectivity, it may act as a gateway (Section 2) allowing:

- Its own queued outbound messages to be delivered toward destinations reachable through Internet connected relays.
- Its own store and forward queue, held on behalf of other identities, to be synchronized toward other gateway nodes, effectively using the Internet as a high bandwidth, long range transport alongside Bluetooth, Wi Fi Direct, and future radio transports.

Synchronization never requires a central server; it is peer to peer gateway to gateway exchange using the same session and routing layers as any other link, per the transport agnosticism principle in RFC 0001.

## 6. Versioning and Compatibility

Every packet envelope carries a protocol version field, specified fully in RFC 0006. Zaycomm's compatibility policy:

- A node must be able to detect a version mismatch and decline to process a packet it cannot safely interpret, per the fail closed principle in RFC 0001, Section 5.
- Backward incompatible protocol changes require a new major version and a formally documented migration path in a superseding RFC, never a silent behavior change.
- The reference implementation and the specification version must always be traceable to each other, consistent with RFC 0001's documentation standards.

## 7. Extensibility Points

Per RFC 0001's future extensibility principle, three seams are deliberately kept open from this overview stage onward:

1. **New transports** plug into the transport layer interface (RFC 0008) without touching anything above it.
2. **New message types** (files, voice, emergency broadcast) are new application layer payload types riding the existing session, routing, and storage layers, not new protocol stacks.
3. **New cryptographic agility** is bounded and deliberate: RFC 0004 will define how a future primitive upgrade (for example, a post quantum key exchange) could be introduced through version negotiation, without requiring a ground up redesign.

---

End of RFC 0003. Next: RFC 0004, Cryptographic Architecture.
# RFC 0004: Cryptographic Architecture

Project: Zaycomm
Status: Draft
Series: Zaycomm RFC Series
Supersedes: None
Depends on: RFC 0001, RFC 0002, RFC 0003

---

## 0. Preface

Per RFC 0001, Section 5 and the governing instruction for this entire project, Zaycomm never invents cryptographic algorithms or novel constructions. Every primitive named here is a widely deployed, independently reviewed building block. Where a choice is made between plausible alternatives, the reasoning is stated explicitly so a future auditor can evaluate the decision rather than simply trust it.

## 1. Design Goals for This Layer

Directly traceable to RFC 0002's threat catalog:

- Confidentiality of message content against every relay in Zone B and Zone C.
- Forward secrecy so that long term key compromise does not expose past session content.
- Authentication of both parties in a session, resisting impersonation.
- Integrity and replay protection for every message and control packet.
- Suitability for constrained, intermittently connected mobile devices, since this is a mesh protocol running on phones over Bluetooth and similar low bandwidth links, not a data center protocol.

## 2. Primitive Selection

### 2.1 Key Exchange: X25519
X25519 (Curve25519 Diffie Hellman) is selected for all ephemeral and static key agreement. It is chosen over NIST P 256 because it has simpler, safer implementation properties (no need for point validation the way P curves require, resistance to common implementation pitfalls that have historically caused real world vulnerabilities in P curve deployments), it is fast on mobile class hardware without dedicated cryptographic acceleration, and it is the de facto standard in modern secure messaging protocols that this project draws lineage from conceptually (Signal Protocol, WireGuard, Noise based systems), giving it a strong track record of independent scrutiny.

### 2.2 Signatures: Ed25519
Ed25519 is selected for identity key signatures (device authentication, identity binding, and signing of routing advertisements in RFC 0007). It shares Curve25519's implementation safety properties, is deterministic (removing an entire class of nonce reuse vulnerabilities that has affected ECDSA deployments), and is fast enough for frequent signing operations on mobile devices, which matters because routing advertisements in a mesh network may need to be signed frequently.

### 2.3 Session Establishment Framework: Noise Protocol Framework
Rather than designing a custom handshake, Zaycomm adopts the Noise Protocol Framework, specifically a mutually authenticated pattern in the family of Noise IK or Noise XX depending on whether the recipient's static key is already known ahead of time (IK, minimizing round trips when identity is already known through prior contact or a directory lookup) or must be exchanged during the handshake (XX, for first contact between previously unknown identities). Noise is chosen because it is a formally analyzed framework with machine checked security proofs for its handshake patterns, is already the basis of widely deployed systems (WireGuard among them), and gives Zaycomm a documented, auditable handshake instead of an ad hoc one, directly satisfying the auditability principle in RFC 0001.

### 2.4 Forward Secrecy for Ongoing Sessions: Double Ratchet
For sustained conversations between two identities, Zaycomm adopts a double ratchet construction in the style popularized by the Signal Protocol: a combination of a Diffie Hellman ratchet (fresh X25519 exchanges per message round trip) and a symmetric key derivation ratchet (via HKDF, Section 2.6) for per message keys. This is chosen over a single static session key because it provides both forward secrecy (past messages remain safe even if a later key is compromised) and a degree of post compromise recovery (future messages regain safety once fresh randomness is reintroduced through subsequent Diffie Hellman ratchet steps), which directly satisfies the mandatory forward secrecy requirement in RFC 0001, Section 5 and the compromise containment goal in RFC 0002, Section 4.4.

### 2.5 Authenticated Encryption: XChaCha20 Poly1305
XChaCha20 Poly1305 is selected as the authenticated encryption with associated data (AEAD) construction for message payloads. It is chosen over AES 256 GCM primarily because Zaycomm's target devices include phones and embedded or radio adapter hardware that may lack AES hardware acceleration; ChaCha20 performs consistently well in pure software across a much wider range of hardware without the timing side channel risks that unaccelerated AES software implementations can carry. The extended nonce variant (XChaCha20 rather than plain ChaCha20) is used specifically because it tolerates random nonce generation safely across a decentralized network of many independent nodes generating nonces without coordination, removing a class of nonce collision risk that a protocol with a central sequence counter authority would not have to worry about but Zaycomm, being fully decentralized per RFC 0001, does.

### 2.6 Key Derivation: HKDF (based on SHA 256 or BLAKE2b)
HKDF is used throughout for deriving session keys, ratchet keys, and any subkeys from shared secrets, following the same approach as the Noise Framework and Signal Protocol designs it draws from. The underlying hash function is SHA 256, a widely audited standard, with BLAKE2b considered as a documented alternative for performance sensitive contexts on mobile hardware; the final choice will be pinned in the reference implementation plan (RFC 0010) after benchmarking, but both are proven, non experimental primitives, satisfying the "never invent cryptography" mandate either way.

### 2.7 Identity Key Fingerprinting: SHA 256
Human verifiable identity fingerprints (used in RFC 0005's identity verification flow) are derived using SHA 256 over the identity's public key material, following the same pattern used by Signal style safety numbers, chosen for its ubiquity and the fact that it needs no special properties beyond collision resistance for this use.

## 3. What Is Deliberately Not Included

- No custom cipher, no custom hash, no custom signature scheme, at any point, per the standing project rule.
- No use of algorithms considered weakened or deprecated by current cryptographic consensus (for example, no RC4, no unauthenticated encryption modes, no MD5 or SHA 1 for anything security relevant).
- No reliance on obscurity of the protocol design itself as a security property; per RFC 0001's auditability principle, the entire cryptographic design is intended to be public and independently reviewable.

## 4. Sealed Metadata Considerations

Per RFC 0002's metadata minimization asset, sender identity within a message envelope should not be trivially visible to relay nodes that are not the final recipient. Zaycomm will apply a sealed sender style approach (encrypting sender identifying information as part of the payload rather than the envelope header, so only the recipient's session layer can determine the sender) wherever the routing layer in RFC 0007 can still function without that information being visible to relays. The precise envelope field boundary between what must be visible for routing versus what can be sealed is finalized in RFC 0006.

## 5. Key Management Overview

Full identity and multi device key architecture is specified in RFC 0005. At the cryptographic layer, the relevant constraint is: identity keys (Ed25519) are long lived and rarely rotated by design, since they anchor a user's identity across time, while session keys and ratchet keys are short lived by design, rotating continuously through normal use. This split is what allows forward secrecy to hold even though identity itself must remain stable and verifiable over time.

## 6. Cryptographic Agility and Future Extensibility

Per RFC 0003, Section 7, the Noise handshake's built in pattern and algorithm negotiation is the seam through which a future primitive upgrade, most plausibly a post quantum key exchange used alongside X25519 in a hybrid mode, could be introduced without a ground up protocol redesign. This is noted as a forward looking design constraint now so that RFC 0006's packet format reserves the necessary version and algorithm identifier fields from the start, rather than needing a breaking change later to add them.

## 7. Summary Table

| Purpose | Primitive | Chosen over | Primary reason |
|---|---|---|---|
| Key exchange | X25519 | NIST P 256 | Simpler safe implementation, strong deployed track record |
| Signatures | Ed25519 | ECDSA | Deterministic, avoids nonce reuse class of bugs |
| Handshake framework | Noise Protocol (IK / XX patterns) | Custom handshake | Formally analyzed, auditable, proven in deployed systems |
| Ongoing session forward secrecy | Double ratchet (Signal style) | Static session key | Forward secrecy plus post compromise recovery |
| Payload encryption | XChaCha20 Poly1305 | AES 256 GCM | Software performance without hardware acceleration, safe random nonces |
| Key derivation | HKDF (SHA 256 or BLAKE2b) | Custom KDF | Standard, proven, matches Noise and Signal lineage |
| Identity fingerprinting | SHA 256 | Custom hash | Ubiquity, sufficient collision resistance for this use |

---

End of RFC 0004. Next: RFC 0005, Identity Architecture.
# RFC 0005: Identity Architecture

Project: Zaycomm
Status: Draft
Series: Zaycomm RFC Series
Supersedes: None
Depends on: RFC 0001, RFC 0002, RFC 0004

---

## 0. Preface

Zaycomm has no central authority, per RFC 0001's decentralization principle, which means identity cannot be issued or verified by any server. This document specifies how identity is created, verified, linked across multiple devices, and revoked, entirely through cryptographic means and peer verification rather than institutional trust.

## 1. Identity Is a Key Pair

A Zaycomm identity is, at its core, an Ed25519 key pair (RFC 0004, Section 2.2). There is no username registry, no phone number, and no email requirement, consistent with the minimal metadata principle in RFC 0002. The public key, or a fingerprint derived from it, is the identity as far as the protocol is concerned. Human friendly display names are a purely local, application layer convenience with no protocol level meaning or global uniqueness guarantee.

## 2. Trust on First Use and Out of Band Verification

Since there is no central authority to vouch for a key belonging to a specific person, Zaycomm follows the trust on first use model already proven in Signal and similar systems:

- The first time two identities establish a session (RFC 0004, Section 2.3), each learns the other's public key through the Noise handshake.
- This first contact is trusted provisionally; the protocol layer cannot itself prove the key belongs to the person the user believes they are talking to.
- Zaycomm defines a human verifiable fingerprint (RFC 0004, Section 2.7) that two users can compare out of band, for example by reading it aloud in person or scanning a QR code when physically together, to upgrade provisional trust to verified trust.
- Once verified, a client should retain that verification state locally and warn the user if the counterpart's key ever changes unexpectedly, which is the primary defense against a relay attempting impersonation after the fact.

## 3. Multi Device Identity

A single human user may reasonably want to use Zaycomm from more than one device. Rather than sharing one private key across devices, which would weaken forward secrecy and containment guarantees from RFC 0002, Zaycomm treats multi device support as an explicit linking construction:

- Each device generates its own device level key pair.
- A user's primary identity key signs a device linking statement authorizing a specific device key to act on behalf of that identity.
- Other users' clients can then treat any properly linked device key as equivalent to the primary identity for purposes of sending and receiving, while still being able to tell, if needed, which physical device a given message actually came from.
- Revoking a single device (lost phone, for example) means signing a revocation statement with the primary identity key, without needing to change the identity itself and without needing any central directory to propagate that revocation, since it propagates the same way any other signed protocol message does, through the mesh itself.

This keeps the containment property from RFC 0002, Section 4.4 intact: compromise of one linked device can be revoked without invalidating the user's whole identity, and revocation does not require trusting any third party.

## 4. Identity Directory and Discovery

Because there is no mandatory central directory, discovering another user's identity happens through one of several non exclusive mechanisms, each with different trust implications:

- **Direct exchange**, in person or over a trusted channel, is the strongest form, since it allows immediate out of band fingerprint verification per Section 2.
- **Introduction through a mutual contact**, where an already trusted identity vouches for a new one, forming an informal web of trust rather than a hierarchical one. This is explicitly opportunistic and never a required part of the protocol's core function.
- **Opportunistic mesh discovery**, where identities become known through participating in the same mesh over time. This is treated as unverified by default and must be explicitly upgraded by the user through fingerprint comparison before being treated as a verified contact.

No discovery mechanism is ever required for the protocol to function; two people who have exchanged fingerprints in person, with no network path between them, can still queue messages for eventual delivery once any path exists, consistent with the store and forward model in RFC 0003.

## 5. Sybil Resistance

RFC 0002 identifies Sybil identity flooding, where an adversary creates many apparent identities to gain outsized influence, as a threat to routing integrity. Because identity creation is free (any device can generate a new key pair), Zaycomm does not attempt to prevent Sybil identity creation outright; instead it limits what a large number of unverified identities can achieve:

- Routing influence (RFC 0007) is weighted by factors that are costly to fake at scale, such as sustained observed relay reliability over time, rather than by raw identity count.
- Store and forward resource allocation (RFC 0009) applies fair sharing and rate limiting per identity rather than assuming identity count reflects legitimate distinct users.
- Verified contacts (Section 2) are never given more protocol level routing privilege purely for being verified; verification is a user trust signal, not a routing privilege signal, keeping the two concerns cleanly separated.

## 6. Key Compromise and Revocation

If a primary identity key itself, not just a linked device, is believed compromised, the user faces the same fundamental limitation any decentralized identity system has: without a central authority, a compromised key cannot be forcibly invalidated against an attacker who already holds it. Zaycomm's answer, consistent with being honest about limitations per RFC 0001's non goals:

- A user can generate a new identity key pair and, for already verified contacts, sign a transition statement with the old key vouching for the new one, allowing contacts who see that statement to migrate trust.
- This transition statement is only trustworthy if it reaches contacts before an attacker can act, which is an inherent limitation of decentralized identity, documented here rather than glossed over.
- Contacts who verified the old key out of band (Section 2) are the strongest position to safely evaluate a transition statement or, if suspicious, to re verify out of band before trusting the new key.

## 7. Relationship to Anonymity

Zaycomm identity is pseudonymous by default, not anonymous. A key pair does not require any real world identifying information, but sustained use of the same key pair does create a linkable pattern of activity over time, consistent with the residual risks acknowledged in RFC 0002, Section 8. Users wanting stronger anonymity guarantees may rotate identities entirely, at the cost of losing continuity of verified trust relationships, a tradeoff the protocol makes possible but does not make automatically for the user.

---

End of RFC 0005. Next: RFC 0006, Packet Specification.
# RFC 0006: Packet Specification

Project: Zaycomm
Status: Draft
Series: Zaycomm RFC Series
Supersedes: None
Depends on: RFC 0001, RFC 0002, RFC 0003, RFC 0004, RFC 0005

---

## 0. Preface

This document defines the structure of data on the wire, at the level of field names, purposes, and boundaries, without committing to a specific serialization format (protocol buffers, CBOR, and a custom compact binary encoding are all viable candidates evaluated in RFC 0010). The goal here is to define what must be in a packet and why, and specifically what must not be in a packet, following the metadata minimization principle from RFC 0002.

## 1. Design Constraints

- Must fit within small transport MTUs; Bluetooth Low Energy in particular imposes tight per packet size limits, so the envelope must support fragmentation and reassembly (Section 5) rather than assuming large single packets.
- Must expose the minimum information relays need to route, and nothing more, per the sealed metadata approach introduced in RFC 0004, Section 4.
- Must be versioned from the start, per RFC 0003, Section 6, so future extensibility does not require breaking changes to already deployed nodes.
- Must be self describing enough for a receiving node to safely reject anything it cannot fully validate, per the fail closed principle in RFC 0001, Section 5.

## 2. Envelope Structure

Every unit of data moving through the mesh is wrapped in a single envelope with two conceptual parts: a routing header, visible to relays, and a sealed payload, opaque to everyone except the final recipient's session layer.

### 2.1 Routing Header Fields (visible to relays)

- **Protocol version.** Identifies which version of this specification the packet conforms to, allowing graceful rejection of incompatible versions per RFC 0003, Section 6.
- **Packet type.** Identifies the category of packet (Section 4), since handshake, data, acknowledgment, routing advertisement, and store and forward sync packets each need different relay handling.
- **Message identifier.** A unique identifier for this packet, used for deduplication (a packet may arrive via multiple paths in a mesh, and relays must recognize duplicates) and for acknowledgment correlation, generated so as not to leak sequential ordering information about a sender's total traffic volume.
- **Time to live or hop count.** Bounds how many further hops a packet may travel, preventing indefinite forwarding loops and unbounded resource consumption on the mesh, directly addressing the flooding and storage exhaustion threats catalogued in RFC 0002.
- **Destination routing hint.** The minimum information a relay needs to make a forwarding decision (RFC 0007), which by design is not the full destination identity in plaintext where the routing algorithm can function on a less revealing hint instead, such as a bucketed or blinded identifier.
- **Timestamp or freshness marker.** Coarse grained, not high precision, to support replay protection and store and forward expiry (RFC 0009) without revealing precise timing metadata beyond what routing genuinely requires.

### 2.2 Sealed Payload (opaque to relays, decrypted only by the recipient's session layer)

- **Sender identity reference,** sealed per RFC 0004, Section 4, so relays cannot determine who originated a message, only where it is headed next.
- **Session or ratchet state reference,** needed by the recipient to select the correct decryption key material per the double ratchet construction in RFC 0004, Section 2.4.
- **Encrypted application content,** the actual message, file chunk, voice frame, or emergency broadcast content, encrypted with XChaCha20 Poly1305 per RFC 0004, Section 2.5.
- **Authentication tag,** produced by the AEAD construction, allowing the recipient to detect any tampering, satisfying the integrity requirement from RFC 0002.

```
+==========================================================================+
|                          ROUTING HEADER (visible to relays)              |
|  version | packet type | message id | ttl/hop count |                   |
|  destination routing hint | coarse timestamp                            |
+==========================================================================+
|                    SEALED PAYLOAD (opaque to relays)                    |
|  +----------------------------------------------------------------+     |
|  |  sender identity reference   (sealed, RFC 0004 Section 4)      |     |
|  |  session/ratchet state reference                               |     |
|  |  encrypted application content   (XChaCha20 Poly1305)          |     |
|  |  authentication tag                                            |     |
|  +----------------------------------------------------------------+     |
+==========================================================================+
```
*Relays read only the top section. Everything below the double line is opaque ciphertext that only the intended recipient's session layer can open.*

## 3. What Is Explicitly Excluded From the Routing Header

Consistent with RFC 0002's metadata minimization asset and RFC 0004's sealed sender approach:

- No plaintext sender identity.
- No plaintext application content or content type beyond the coarse packet type category needed for relay handling logic (for example, distinguishing a small text message from a large file chunk for scheduling purposes, without revealing content itself).
- No precise geolocation or device identifying information beyond what a specific transport adapter (RFC 0008) unavoidably exposes at the physical layer, which is documented as a residual risk per RFC 0002, Section 8, rather than something the packet format itself introduces.

## 4. Packet Types

- **Handshake packets,** carrying Noise Protocol handshake messages (RFC 0004, Section 2.3) to establish or re establish a session between two identities.
- **Data packets,** carrying sealed application content as described in Section 2.2.
- **Acknowledgment packets,** confirming receipt, themselves encrypted and routed like any other packet, never sent in plaintext.
- **Routing advertisement packets,** used by the routing layer (RFC 0007) to propagate reachability information between nodes, signed with the advertising node's identity key (RFC 0004, Section 2.2) so forged advertisements can be detected and rejected.
- **Store and forward synchronization packets,** used between two nodes, especially gateway nodes per RFC 0003, Section 5, to exchange queued messages held on behalf of others.
- **Emergency broadcast packets,** a distinct type reserved for the future broadcast capability named in RFC 0001's goals, deliberately given its own type now so that relay priority and flood based delivery rules (appropriate for broadcast, inappropriate for normal one to one traffic) can be defined without overloading the data packet type later.

## 5. Fragmentation and Reassembly

Given small transport MTUs, particularly over Bluetooth Low Energy, any payload exceeding a single transport frame is split into ordered fragments at the envelope level, each carrying enough header information for the recipient to reassemble the original envelope and detect missing or corrupted fragments. Fragmentation is a property of the envelope layer, not of any single transport adapter, so that the same fragmentation logic works identically regardless of which transport from RFC 0008 is in use, consistent with transport agnosticism.

## 6. Deduplication and Loop Prevention

Because the mesh may deliver the same packet to a relay more than once through different paths, every relay maintains a short lived cache of recently seen message identifiers (Section 2.1) to detect and silently drop duplicates rather than re relaying them, which both prevents wasted resources and prevents an amplification style denial of service vector.

## 7. Integrity and Validation Order

On receipt, a node performs validation in this order, consistent with the fail closed principle:

1. Protocol version check; unsupported versions are rejected immediately without further parsing.
2. Structural validation of the routing header; malformed packets are dropped.
3. Time to live and freshness check; expired or clearly stale packets are dropped before further processing.
4. For routing advertisement packets specifically, signature verification against the advertising identity's known key before the advertisement is trusted at all.
5. Only after all header level checks pass does a relay forward the packet onward; only the intended recipient proceeds to attempt decryption of the sealed payload.

---

End of RFC 0006. Next: RFC 0007, Routing Algorithm.
# RFC 0007: Routing Algorithm

Project: Zaycomm
Status: Draft
Series: Zaycomm RFC Series
Supersedes: None
Depends on: RFC 0001, RFC 0002, RFC 0003, RFC 0006

---

## 0. Preface

This is the document that most directly addresses the long distance requirement discussed earlier: reaching hundreds of kilometers through many short hops rather than any single long range transport alone. It specifies how a message finds its way from a source identity to a destination identity across an intermittently connected, partially hostile mesh, consistent with the delay tolerant connectivity model in RFC 0003, Section 4 and the trust assumptions in RFC 0002, Section 7.

## 1. Why Conventional Routing Does Not Apply

Traditional routing protocols (link state, distance vector, and similar approaches used on the Internet) assume a mostly stable topology and near continuous connectivity between routing updates. Zaycomm's environment violates that assumption by design: nodes connect briefly and unpredictably, a full end to end path between sender and recipient may never exist at any single instant, and long distance delivery is expected to happen over minutes, hours, or days as intermediate nodes physically move and re encounter each other. This places Zaycomm firmly in the delay tolerant networking family of problems rather than conventional packet routing.

## 2. Routing Model: Opportunistic Store, Carry, and Forward

Zaycomm routing follows a store, carry, and forward model:

- A node holding a message for a destination it cannot currently reach stores it (RFC 0009) rather than dropping it.
- The node carries that message as it physically moves and encounters new neighbors, which is how geographic distance is actually covered in a mesh with no long range transport, and remains the underlying mechanism even when a long range transport (RFC 0008) is present, since even long range radio has finite reach per hop.
- When the node encounters a neighbor that is a better candidate to eventually reach the destination than itself, judged by the metrics in Section 3, it forwards a copy onward.

This is the mechanism by which a message can, in principle, travel the full 600 to 1000 kilometer distance discussed earlier, accumulated across many such hops and carries, rather than through any single transport's raw range, consistent with the design philosophy stated in RFC 0001, Section 3.

```
 Time  T0            T1              T2              T3              T4
       |             |               |               |               |
 Node A o--BLE-->o Node B    Node B  o--carries-->    Node C  o--LoRa/WiFi-->  Node D
       msg stored   msg relayed      (physically       msg forwarded          msg
       and carried   at contact      moves, msg        at contact             delivered
                                      stored)

       <------------------  distance covered over many hops and time  ------------------>
                        (this is how 600 to 1000 km is reached, per RFC 0001 Section 3)

 Alternative, using a mobile relay platform (Section 10, RFC 0008 Section 7):

 Node A o--BLE-->o  [Aircraft, in flight, 1 to 2 hrs]  o--BLE-->o  Node D
       msg picked up      covers the full 600 to 1000 km        msg dropped off
       at departure       distance in a single fast hop         at arrival
```
*The upper diagram shows distance built up through many short, slow hops. The lower diagram shows the same distance covered in one fast hop by a mobile relay platform. Both are valid paths in the same routing model; the routing layer picks whichever gets a message there faster.*

## 3. Forwarding Decision Metrics

Rather than flooding every message to every neighbor unconditionally, which does not scale and creates the flooding and storage exhaustion risks catalogued in RFC 0002, each node scores candidate next hops using a combination of factors, similar in spirit to established delay tolerant networking approaches such as PRoPHET style predictability routing:

- **Historical encounter frequency** with the destination identity or with relays known to have recently reached it, used as a probabilistic signal of who is likely to make progress toward delivery.
- **Observed reliability of a candidate relay over time,** which also serves as the Sybil resistance mechanism named in RFC 0005, Section 5, since a newly created identity has no track record and is scored accordingly rather than being trusted by default.
- **Remaining time to live** on the packet itself (RFC 0006, Section 2.1), so that packets close to expiry are forwarded more aggressively while fresher packets can wait for a higher quality candidate.
- **Local resource pressure,** so a node under storage or battery constraint (RFC 0009) can decline to accept additional store and forward responsibility even from an otherwise good candidate exchange.

No single metric is authoritative; the routing layer combines them into a bounded, locally computed score, deliberately avoiding any global optimization that would require full topology knowledge no node actually has.

## 4. Multi Hop Delivery Within a Connected Session

When a full path between sender and an eventually reachable relay chain does exist within a short connectivity window, for example several nodes simultaneously in Bluetooth or Wi Fi Direct range of each other, Zaycomm additionally supports conventional multi hop forwarding along the routing advertisements (RFC 0006, Section 4) exchanged between currently connected neighbors, so that messages do not need to wait for the store and carry mechanism when a live path is already available. This is treated as an optimization on top of the store, carry, and forward model in Section 2, not a separate protocol.

## 5. Routing Advertisements

Nodes periodically exchange signed routing advertisements (RFC 0006, Section 4) with currently connected neighbors, containing:

- The advertising node's identity reference.
- A bounded summary of destinations it has recently had good encounter history with, supporting the predictability metric in Section 3.
- Its current resource pressure signal, supporting the local resource pressure metric.

Because these advertisements are signed with the advertising identity's key (RFC 0004, Section 2.2), a relay receiving one can verify it was not forged by an intermediate hop, addressing the routing advertisement forgery threat in RFC 0002's catalog. Advertisements are deliberately coarse and bounded rather than a full routing table, so that a malicious or compromised node cannot use them to reconstruct fine grained topology or precise contact history of other users, consistent with the metadata minimization principle.

## 6. Handling Malicious and Sybil Relays

Following the containment principle from RFC 0002, Section 4.4 and the Sybil resistance approach from RFC 0005, Section 5:

- New or unverified identities begin with low routing trust and earn higher forwarding priority only through sustained, observed reliable behavior over time, making Sybil flooding expensive to make effective rather than free.
- A relay that is repeatedly observed dropping or failing to forward messages it accepted responsibility for is deprioritized by its neighbors' local scoring, without requiring any central blacklist or authority.
- Because store and forward responsibility is copy based rather than exclusive by default (Section 7), a single malicious relay withholding a message does not guarantee non delivery as long as at least one honest copy exists elsewhere in the mesh.

## 7. Replication Strategy

To balance delivery reliability against the flooding risk in RFC 0002's catalog, Zaycomm uses bounded replication rather than either single copy routing (fragile against a single malicious or failed relay) or unbounded epidemic flooding (resource exhausting):

- Each message carries a replication budget, decremented as copies are handed to additional candidate relays, bounding total resource consumption across the mesh regardless of how many hops or carriers are involved.
- Once a delivery confirmation (an acknowledgment packet, RFC 0006, Section 4) propagates back through the mesh, remaining stored copies can be garbage collected (RFC 0009), so successful delivery does not leave indefinite redundant copies consuming storage across the network.

## 8. Gateway Assisted Long Distance Routing

Per RFC 0003, Section 5, any node with momentary Internet access can act as a gateway. For long distance delivery specifically, a gateway node effectively acts as an extremely high reliability, high range relay candidate, since it can hand a message to another gateway anywhere in the world nearly instantly rather than waiting for physical carrying. The scoring model in Section 3 naturally favors gateway relays when available, without the protocol treating them as structurally special or required, preserving the fully decentralized, gateway optional operation mandated in RFC 0001.

## 9. Long Range Radio as a First Class Routing Participant

Where a long range radio transport is present (RFC 0008), it participates in this same routing model as just another link type between two nodes, distinguished mainly by covering a much larger single hop distance than Bluetooth or Wi Fi Direct. This means the 600 to 1000 kilometer goal is most realistically achieved through a combination of Section 2's store, carry, and forward model across a populated mesh and this section's longer individual hops where long range radio nodes exist, rather than through either mechanism alone, which is the honest framing already established in RFC 0001, Section 3.

## 10. Mobile Relay Platforms in the Routing Model

RFC 0008, Section 7 introduces mobile relay platforms, vehicles such as cars, helicopters, and airliners carrying a Zaycomm capable node as part of their normal travel. This section specifies how the routing layer treats them, since their movement pattern is different enough from an ordinary pedestrian carried node to affect the forwarding decision metrics in Section 3 directly.

- **Velocity as a scoring input.** A mobile relay platform's high speed relative to a walking carried node means a message handed to it can cover the same physical distance in a small fraction of the time. Where a candidate relay reports itself as a mobile relay platform (via the generic link characteristics signal in RFC 0008, Section 1), the forwarding decision in Section 3 should weight it favorably for messages whose destination lies along or near that platform's likely path, subject to the same historical encounter and reliability scoring already applied to any other relay.
- **Route predictability.** A vehicle on a fixed or repeated route (a commercial flight path, a regular delivery route, a daily commute) is highly predictable, strengthening the predictability metric in Section 3 in the same way a frequently encountered pedestrian node would, but at much greater range. A vehicle on an unpredictable route is still usable opportunistically, simply scored with lower confidence, consistent with how any low information relay candidate is already handled.
- **Dual role during transit.** While in motion, a mobile relay platform with a long range uplink (RFC 0008, Section 7) can act simultaneously as a physical carrier of previously queued envelopes and as a live gateway (Section 8) for envelopes that can reach it over that uplink, meaning it participates in both the store, carry, and forward model of Section 2 and the gateway assisted model of Section 8 at once, whichever path gets a given message to its destination faster.
- **No special trust.** A mobile relay platform earns forwarding priority the same way any relay does, through the trust and reliability scoring in Section 6, not by virtue of being a vehicle. An unknown or newly seen mobile relay platform is treated with the same low initial trust as any newly seen identity, preventing the high velocity property from being used to bypass the Sybil resistance protections already in place.

This treatment means the 600 to 1000 kilometer target from RFC 0001, Section 3 is most efficiently reached through a combination of three mechanisms working together: ordinary store, carry, and forward across a populated mesh (Section 2), long range radio hops where available (Section 9), and mobile relay platforms, especially aircraft, covering large stretches of that distance in a single fast moving hop (this section). None of the three is required on its own; a deployment gains delivery speed and reliability as it gains access to more of them.

---

End of RFC 0007. Next: RFC 0008, Transport Layer.
# RFC 0008: Transport Layer

Project: Zaycomm
Status: Draft
Series: Zaycomm RFC Series
Supersedes: None
Depends on: RFC 0001, RFC 0003, RFC 0006, RFC 0007

---

## 0. Preface

This document specifies the transport abstraction that lets every layer above it (session, routing, storage) remain completely unaware of whether bytes moved over Bluetooth, Wi Fi Direct, long range radio, the Internet, or physically carried storage media. This is the direct implementation of the transport agnosticism principle stated in RFC 0001, Section 4.1, and it is also where the honest treatment of the 600 to 1000 kilometer requirement, introduced in RFC 0001 and detailed in RFC 0007, becomes concrete.

## 1. Transport Interface Contract

Every transport adapter must implement a small, uniform interface regardless of its underlying medium:

- **Discover neighbors,** producing a list of currently reachable nodes on this transport, however that transport defines reachability.
- **Send a frame** of bounded size to a specific discovered neighbor, returning success or failure.
- **Receive frames** from any connected or discovered neighbor, delivering them upward to the envelope layer (RFC 0006) unmodified and un interpreted.
- **Report link characteristics,** at minimum an approximate maximum transmission unit and a rough reliability or bandwidth signal, which the routing layer (RFC 0007, Section 3) may use as one input among several, without ever depending on transport specific details beyond this generic signal.

No layer above this interface is permitted to branch its logic based on which specific transport is in use; if a behavior needs to differ by transport, that difference belongs inside the adapter, not in the routing or session layers.

## 2. Bluetooth Low Energy Adapter

Short range, low power, widely available on essentially all target devices, making it the default and most universally usable transport. Realistic single hop range is on the order of tens of meters, occasionally more in open outdoor conditions with favorable antenna placement, far short of the long distance goal on its own, which is precisely why RFC 0007's store, carry, and forward model exists. BLE's small MTU is the primary reason RFC 0006, Section 5 defines fragmentation at the envelope level rather than assuming large packets.

## 3. Wi Fi Direct Adapter

Higher bandwidth and moderately longer range than Bluetooth Low Energy, on the order of up to roughly two hundred meters in favorable conditions, making it well suited for larger payloads such as file transfer once that message type is introduced per RFC 0001's future extensibility goals. Treated as a peer of Bluetooth in the transport interface, selected opportunistically by the routing layer based on the generic link characteristics signal from Section 1 rather than being given special protocol level status.

## 4. Long Range Radio Adapter

This is the transport most directly relevant to reaching hundreds of kilometers within a reasonable number of hops. Rather than picking one radio technology prematurely, this RFC names the class of transport and the tradeoffs, leaving the specific hardware and protocol choice to the reference implementation plan in RFC 0010 once real world testing constraints (regulatory spectrum rules, power budget, antenna size) are known:

- **LoRa class radio** offers single hop ranges commonly in the low tens of kilometers in favorable line of sight conditions, at very low bandwidth, well suited to Zaycomm's small envelope sizes (RFC 0006) but not to larger payload types without significant fragmentation overhead.
- **HF packet radio** can achieve far longer single hop ranges, potentially hundreds of kilometers under suitable propagation conditions, at the cost of specialized hardware, licensing considerations in many jurisdictions, and lower reliability tied to atmospheric conditions.
- **Satellite store and forward** can act as an extreme case gateway node (RFC 0007, Section 8) with effectively global single hop reach, at the cost of requiring specialized hardware and, typically, some ongoing service dependency, which is why it is treated as an optional gateway style transport rather than a core assumption.

None of these are treated as mandatory; a Zaycomm deployment with only Bluetooth and Wi Fi Direct nodes remains fully functional and secure, just slower to cover long distances, achieving reach purely through the multi hop carrying model in RFC 0007, Section 2. A deployment that adds any long range radio option shortens the number of hops needed to cover the same distance. The 600 to 1000 kilometer goal should be treated as achievable primarily through a mesh that includes at least some long range radio capable nodes acting as backbone relays within an otherwise Bluetooth and Wi Fi Direct populated mesh, rather than as a property guaranteed by the protocol regardless of deployment.

## 5. Internet Adapter

Used opportunistically by gateway nodes (RFC 0003, Section 5) whenever conventional Internet connectivity is available. From the protocol's perspective this is simply another transport with very high effective range and bandwidth and generally strong reliability, scored accordingly by the routing layer's generic link signal (Section 1), never assumed to be present and never required for core functionality, consistent with RFC 0001's non goals.

## 6. Physical Carry Adapter (Sneakernet)

A deliberately included transport class covering removable storage media physically carried between two never otherwise connected nodes. Because the envelope format (RFC 0006) is fully self contained and transport independent, a batch of envelopes written to a USB drive or memory card and physically carried is a completely valid, if extreme latency, transport under this same interface. This is included explicitly because it is directly relevant to the disaster and rural connectivity use cases named in RFC 0001's vision, where even radio transports may be unavailable but physical travel between locations is not.

## 7. Mobile Relay Platform Adapter

A distinct and important transport class: any vehicle already moving between locations for its own purposes, a car, a helicopter, an airliner, that carries a Zaycomm capable node as part of its normal operation or as a passenger's device. This is not a new physical medium in the way Bluetooth or LoRa are; it is a mobility pattern layered on top of whichever adapters (Sections 2 through 5) the vehicle mounted or passenger carried device happens to have. It is named as its own adapter category because that mobility pattern changes the routing math enough to matter on its own, addressed fully in RFC 0007, Section 9.

A mobile relay platform typically combines two connectivity modes at once, and the adapter interface (Section 1) simply reports both as available links when present:

- **Short range pickup and drop off,** using Bluetooth Low Energy or Wi Fi Direct (Sections 2 and 3) to exchange queued envelopes with other nodes during the brief window the vehicle is stationary or near other nodes, for example at an airport gate, a bus stop, or a checkpoint.
- **Long range in transit uplink,** where available, using cellular network connectivity, satellite connectivity, or long range radio (Section 4) while the vehicle is actually moving, allowing it to also act as a gateway (RFC 0003, Section 5) during the journey itself, not only at its endpoints.

An aircraft is the extreme case of this pattern: it can cover the entire 600 to 1000 kilometer range target named in RFC 0001, Section 3 in a single flight leg lasting one or two hours, picking up queued envelopes from nodes near the departure location and dropping them off near the arrival location, which is a fundamentally faster way to cover that distance than any chain of pedestrian carried Bluetooth hops. Cars and other ground vehicles offer a smaller but still meaningful version of the same benefit over shorter distances and more frequent, more predictable routes (for example, a regular delivery route or commuting pattern), which strengthens the encounter predictability metric already used in RFC 0007, Section 3.

## 8. Internet Adapter

Used opportunistically by gateway nodes (RFC 0003, Section 5) whenever conventional Internet connectivity is available. From the protocol's perspective this is simply another transport with very high effective range and bandwidth and generally strong reliability, scored accordingly by the routing layer's generic link signal (Section 1), never assumed to be present and never required for core functionality, consistent with RFC 0001's non goals.

## 9. Transport Selection and Multiplexing

A node may have multiple transports active simultaneously (for example Bluetooth and Wi Fi Direct both enabled on the same phone). The routing layer, not the transport layer itself, decides which available transport to use for a given outgoing frame to a given neighbor, based on the generic link characteristics each active transport reports (Section 1) combined with the forwarding decision metrics in RFC 0007, Section 3. A single logical message may have its fragments (RFC 0006, Section 5) sent over different transports to different neighbors simultaneously if that improves delivery odds, since fragments are self describing and independently routable.

## 10. Transport Level Denial of Service Considerations

Per the infrastructure denial adversary in RFC 0002, Section 4.5, no single transport being blocked, jammed, or otherwise denied should deny the protocol as a whole. This RFC's contribution to that guarantee is structural: because every transport implements the identical interface from Section 1, a node experiencing denial on one transport simply has fewer available neighbors to route through, a capacity degradation handled naturally by the routing layer's existing scoring model, rather than a special case requiring dedicated denial of service handling logic at the transport layer itself.

---

End of RFC 0008. Next: RFC 0009, Storage Layer.
# RFC 0009: Storage Layer

Project: Zaycomm
Status: Draft
Series: Zaycomm RFC Series
Supersedes: None
Depends on: RFC 0001, RFC 0002, RFC 0004, RFC 0006, RFC 0007

---

## 0. Preface

This document specifies how a node persists its own messages and, critically for the store, carry, and forward routing model in RFC 0007, how it holds messages on behalf of other identities while delivery is pending. It addresses the storage exhaustion and flooding threats catalogued in RFC 0002 directly.

## 1. Two Categories of Stored Data

- **Own message store.** Content a node's own identity sent or received, kept for the user's own access, governed by application layer retention preferences rather than protocol level rules, and explicitly acknowledged as living in Zone A (RFC 0002, Section 3), the user's own trusted device, not something the protocol layer protects beyond what encryption at rest provides.
- **Store and forward relay queue.** Sealed envelopes (RFC 0006) a node is temporarily holding on behalf of other identities as part of the routing model in RFC 0007, Section 2. This is the data category this RFC is primarily concerned with, since it involves a node holding data it cannot read, on behalf of users it may not know, under adversarial conditions.

## 2. Confidentiality of Relayed Storage

Because envelopes are sealed end to end per RFC 0004, a node holding another identity's message in its relay queue never has access to plaintext content or, per RFC 0004, Section 4 and RFC 0006, Section 3, even the sender's identity. Storage layer security therefore does not need to defend content confidentiality against the storing node itself, that guarantee already comes from the cryptographic layer; it needs to defend against denial, tampering, and resource exhaustion instead.

## 3. Tamper Evidence for Stored Envelopes

Even though a storing node cannot read a queued envelope, it could attempt to corrupt or truncate it before forwarding. Because the AEAD authentication tag (RFC 0004, Section 2.5) covers the full sealed payload, any such tampering is detected by the eventual recipient's session layer and the corrupted envelope is simply rejected, consistent with the fail closed principle in RFC 0001. The storage layer additionally maintains a local integrity check (a straightforward cryptographic hash of stored envelope bytes) so a node can detect its own storage corruption, for example from a failing disk, before wasting a forwarding attempt on data it can already tell is damaged.

## 4. Retention and Expiry

Every envelope carries a time to live field (RFC 0006, Section 2.1). The storage layer enforces this directly:

- Envelopes are purged once their time to live expires, regardless of whether delivery succeeded, preventing indefinite accumulation of undeliverable data across the mesh.
- A node may additionally apply local retention limits stricter than an envelope's stated time to live, if under resource pressure, since RFC 0007, Section 3 already accounts for local resource pressure as a routing signal, meaning early local expiry degrades delivery probability gracefully rather than causing a hard failure.
- Acknowledgment packets (RFC 0006, Section 4) that successfully propagate back allow a node to garbage collect a stored envelope early, once it is confirmed no longer needed, per RFC 0007, Section 7.

## 5. Fair Resource Allocation

To directly counter the storage exhaustion and flooding threats in RFC 0002's catalog, and to complement the Sybil resistance approach in RFC 0005, Section 5:

- Storage capacity offered to the relay queue is allocated per source identity with bounded fair sharing, so a single identity, whether malicious or simply misbehaving, cannot consume a disproportionate share of a relaying node's storage.
- New or low trust identities (per the routing trust model in RFC 0007, Section 6) are allocated a smaller default storage share than identities with an established reliable track record, making large scale flooding by freshly created Sybil identities materially harder to sustain.
- A node under storage pressure is always permitted, per its own local policy, to decline additional relay queue responsibility entirely, consistent with graceful degradation (RFC 0001, Section 4.5): the mesh as a whole loses some capacity, not any security guarantee.

## 6. Synchronization Between Store and Forward Peers

When two nodes with relay queues connect, whether briefly over Bluetooth or at length through an Internet gateway session (RFC 0003, Section 5; RFC 0008, Section 5), they exchange queue summaries (message identifiers and time to live remaining, not content, per the same metadata minimization principle applied throughout) to determine which envelopes are worth exchanging, avoiding redundant transfer of envelopes both nodes already hold, which matters given the bandwidth constraints of transports like Bluetooth Low Energy and long range radio (RFC 0008).

## 7. Conflict and Duplicate Handling

Because the same envelope may arrive at a node through multiple paths (RFC 0007's bounded replication), the storage layer deduplicates by message identifier before persisting, consistent with the deduplication behavior already defined at the routing layer in RFC 0006, Section 6, so the two layers share one consistent notion of "already seen" rather than maintaining divergent state.

## 8. Local Own Message Store Considerations

For a user's own message history (Section 1, first category), the storage layer applies:

- Encryption at rest, keyed from material derived from the device's own local key material, so that a lost or stolen device does not trivially expose message history to whoever finds it, while acknowledging per RFC 0001's non goals that full protection against a sophisticated attacker with the unlocked device is a device security problem, not a protocol problem.
- User controlled retention, allowing deletion of local history independent of protocol level time to live rules, since those rules only govern the relay queue category, not a user's own kept messages.

---

End of RFC 0009. Next: RFC 0010, Reference Architecture.
# RFC 0010: Reference Architecture and Implementation Plan

Project: Zaycomm
Status: Draft
Series: Zaycomm RFC Series
Supersedes: None
Depends on: RFC 0001 through RFC 0009 (entire series to date)

---

## 0. Preface

This is the final volume of the initial RFC series and the first document that begins to point toward implementation, while still deliberately not writing code, per the original project instruction. It exists to translate nine specification documents into a sequenced, auditable engineering plan, consistent with the development standards set in RFC 0001, Section 9: spec before code, at every stage.

## 1. Purpose of This Document

Where RFC 0001 through RFC 0009 answer "what must be true," this document answers "in what order do we build it, and how do we know each stage is actually done." It is the bridge between the constitution and an eventual reference codebase.

## 2. Guiding Constraints Carried Forward

- No implementation work begins on a component before its governing RFC reaches at least a stable enough to implement against status (RFC 0001, Section 9).
- Every cryptographic primitive used in code must trace directly to RFC 0004's summary table, with no substitutions made silently during implementation.
- The reference implementation and the specification evolve together, and any divergence discovered during implementation is treated as a bug requiring a formal RFC amendment, not a silent code level workaround (RFC 0001, Section 9).

## 3. Proposed Technology Stack Considerations

Named here as considerations to evaluate, not final commitments, since that evaluation is itself part of the implementation work this plan sequences:

- A memory safe systems language for the core protocol implementation (Rust and Go are both plausible candidates) is strongly preferred over a memory unsafe language, given that this is security critical networking code handling untrusted input from potentially hostile relays, directly serving the auditability and security principles in RFC 0001.
- Mobile platform bindings (for iOS and Android clients) generated from the core implementation rather than reimplemented per platform, to avoid divergence between platforms in security critical logic.
- Well established, independently maintained libraries for the cryptographic primitives named in RFC 0004, never a hand rolled implementation of any primitive, consistent with the standing project rule against inventing cryptography.
- A serialization format for the packet envelope (RFC 0006) chosen for compactness (given Bluetooth Low Energy and long range radio MTU constraints from RFC 0008) and for deterministic encoding, since deterministic encoding matters for anything that gets signed (routing advertisements, device linking statements) so that signature verification is unambiguous.

## 4. Phased Implementation Roadmap

Each phase produces a working, testable system with a narrower scope than the full protocol, so that security review can happen incrementally rather than only at the very end.

**Phase 1, direct link core.** Implement the session and cryptographic layer (RFC 0004) and packet envelope (RFC 0006) for a single direct link between two nodes over one transport, with no routing or store and forward yet. Success criterion: two devices can establish a Noise handshake, exchange double ratchet protected messages, and detect tampering, fully matching RFC 0004's specification, independently verifiable against the spec.

**Phase 2, identity and multi device.** Implement identity creation, fingerprint verification, and device linking and revocation from RFC 0005, layered on top of Phase 1. Success criterion: two users can verify each other out of band, and a linked second device can be added and later revoked, with revocation correctly propagating to existing sessions.

**Phase 3, local multi hop routing.** Implement the routing advertisement exchange and multi hop forwarding described in RFC 0007, Section 4, for nodes simultaneously connected over a single transport (Bluetooth or Wi Fi Direct). Success criterion: a message correctly reaches a destination two or more hops away within a single connectivity window, with relays unable to read content per RFC 0004's guarantees.

**Phase 4, store and forward.** Implement the storage layer from RFC 0009 and the full store, carry, and forward routing model from RFC 0007, Section 2, allowing delivery across disconnected time windows. Success criterion: a message queued while the destination is unreachable is correctly delivered once any path, direct or multi hop, eventually exists, with correct expiry and deduplication behavior.

**Phase 5, additional transports.** Implement the Wi Fi Direct, Internet gateway, and physical carry adapters from RFC 0008, followed by an initial long range radio adapter once a specific hardware target is selected. Success criterion: the routing layer correctly selects among multiple simultaneously available transports per RFC 0008, Section 7, with no protocol layer code changes required to add each new transport, directly testing the transport agnosticism claim from RFC 0001.

**Phase 6, Internet synchronization.** Implement gateway to gateway store and forward synchronization from RFC 0003, Section 5 and RFC 0009, Section 6. Success criterion: two disconnected regions of the mesh, each with no direct path to the other, successfully exchange messages once any node in each region gains simultaneous Internet access.

**Phase 7, extended message types.** Implement file transfer, voice, and emergency broadcast as new application layer payload types and, for broadcast specifically, the distinct flood appropriate delivery rules named in RFC 0006, Section 4, without modifying the underlying session, routing, or storage layers, again directly testing the extensibility claims from RFC 0001 and RFC 0003.

## 5. Testing Strategy

- **Specification conformance tests** for each layer, written directly against the relevant RFC's stated requirements, independent of implementation internals, so a second independent implementation could in principle be validated against the same test suite.
- **Adversarial simulation testing,** deliberately introducing malicious relay behavior (dropping, tampering, delaying, Sybil identity flooding) in a controlled test mesh, verifying the containment and resistance properties claimed in RFC 0002 and RFC 0007 actually hold in implementation, not just on paper.
- **Constrained environment testing,** running real device to device tests over actual Bluetooth Low Energy hardware with its real world MTU and range limitations, since RFC 0006 and RFC 0008's assumptions about those constraints need empirical validation, not just theoretical design.
- **Long duration disconnection testing,** to validate the store, carry, and forward model in RFC 0007 actually delivers correctly across extended offline periods, not just short simulated gaps.

## 6. Audit Readiness

Per RFC 0001's success criteria, the project is intended to eventually undergo independent security audit. This plan supports that goal by ensuring:

- Every phase in Section 4 produces a scoped, independently reviewable unit of functionality rather than one large monolithic delivery.
- The specification to implementation traceability required by RFC 0001, Section 9 is maintained continuously, not reconstructed after the fact for audit purposes.
- The threat catalog in RFC 0002, Section 6 is kept as a living checklist, with each threat entry eventually linked to the specific test from Section 5 above that validates its mitigation, giving an auditor a direct path from threat to mitigation to test evidence.

## 7. Open Questions for Future RFCs

Explicitly deferred rather than resolved here, to be addressed by future RFCs building on this series as the project matures:

- Final selection of long range radio hardware and protocol (RFC 0008, Section 4) once regulatory and field testing constraints in target deployment regions are known.
- Final serialization format selection for the packet envelope (Section 3 above), pending compactness and determinism benchmarking.
- Formal specification of the emergency broadcast delivery rules only introduced conceptually in RFC 0006, Section 4.
- Evaluation criteria and timeline for introducing post quantum key exchange agility, the seam for which was reserved in RFC 0004, Section 6.

---

End of RFC 0010. This concludes the initial Zaycomm RFC series, RFC 0001 through RFC 0010. Future work proceeds either through amendments to these documents via superseding RFCs, or through new RFCs numbered RFC 0011 onward, per the documentation standards established in RFC 0001, Section 10.
