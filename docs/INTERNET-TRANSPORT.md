# Zaycomm — Internet transport design note

Status: design only. Nothing here is scheduled and nothing here touches the
pairing path that ships today.

## 1. The question

Pairing completes over a live radio link. Two devices that are not in the same
room cannot pair, and the app says so honestly:

```
code: 'PEER_NOT_NEARBY'
message: 'That node is not visible over Bluetooth yet. Start its transport and keep both devices close.'
```

What would it take to remove that constraint?

## 2. What already exists

More than expected. The Internet transport is **already written and already
tested** — the mobile binding is the only missing piece.

| Piece | Where | State |
|---|---|---|
| Core `Transport` contract | `src/transport/transport.ts` (RFC-0008 §1) | Exists |
| **A real UDP transport** | `src/transport/udp.ts` | **Exists** — `createUdpTransport(ownId, {host, port, maxTransmissionUnit, reliability})`, MTU 1200, reliability 0.99 |
| UDP exercised end to end | `test/c22-real-node-communication.test.ts` | **Passing** — the protocol already runs node-to-node over IP in the suite |
| Mobile `MobileTransport` contract | `mobile/src/transport.ts` | Exists |
| A mobile binding to copy | `mobile/src/androidBleTransport.ts` | Exists — **82 lines** |

The core is explicit that this is cheap by design:

> A transport moves opaque bytes between two directly reachable nodes and reports
> its own basic characteristics. It must NOT know or care what's inside those
> bytes, that's the whole point of transport agnosticism (RFC-0001 Section 4.1):
> the routing, session, and crypto layers built in earlier phases should work
> completely unchanged regardless of which transport is underneath.

So this is a wiring job, not a rewrite. That claim is testable, and section 8
says how.

## 3. The blocker, precisely

```
src/transport/udp.ts:7:  import * as dgram from 'node:dgram';
```

**`node:dgram` does not exist in React Native.** The phone has no UDP socket in
JavaScript. Everything else in `udp.ts` — the peer table, MTU handling, the
receive callback — is portable. The socket is not.

That single line is the whole reason the protocol runs over IP in tests and over
BLE on the device.

## 4. Two mismatches a binding must absorb

**Sync core, async mobile.** `Transport.send()` returns `boolean` synchronously.
`MobileTransport.send()` returns `Promise<void>`, and adds `start` / `stop` /
`connect` / `disconnect` / `onPeerChanged`, because radios and sockets are
asynchronous and callers must be told when peers appear. The binding owns that
difference. It must not leak upward — nothing in `peerAuth.ts` should change.

**MTU.** BLE gives ~200 bytes, which is why `frameChannel.ts` exists at all
(4-byte header, `DEFAULT_FRAME_MTU = 180`) — the 336-byte handshake and ~600-byte
identity message do not fit. UDP gives 1200. The framing layer currently assumes
BLE's ceiling as a constant; it should derive the MTU from
`getLinkCharacteristics(peerId)` instead. This is needed by **every** option
below, so it is worth doing first and in isolation.

## 5. Three options

| | Approach | Native code | Works across NAT | Cost |
|---|---|---|---|---|
| **A** | Native UDP module (Kotlin `DatagramSocket`) behind a JS bridge, mirroring `AndroidBleBridge` | Yes | **Poorly** — UDP needs hole-punching or port-forward | Module + 82-line binding |
| **B** | **WebSocket relay** — React Native's built-in `WebSocket`, plus a relay process | **None** | **Yes, by construction** | Relay + hosting |
| **C** | Native TCP module (Kotlin `Socket`) | Yes | Poorly — still needs reachability | Module + connection lifecycle |

**Recommendation: B.**

Three reasons, in order of weight:

1. **It actually works on a phone.** Option A is the architecturally pure one and
   the one that will most often fail in the field: two handsets behind carrier
   NAT cannot reach each other without hole-punching, and Nigeria's mobile
   networks are overwhelmingly carrier-NATed. A transport that works only on
   Wi-Fi is not a solution to "two devices that aren't in the same room."
2. **No native code.** No new bridge to maintain, no APK size increase, no build
   risk on a project already carrying a 117 MB artifact.
3. **The relay is blind by contract — not by policy.** The RFC text above is
   load-bearing here: a transport "must NOT know or care what's inside those
   bytes." The relay routes opaque frames. The identity session and everything
   after it are end-to-end encrypted by the existing handshake and ratchet, so a
   relay operator can read **metadata** — which node ids connect, when, and how
   much — but not content. That is a real and honest limitation, and it belongs
   in the README next to the threat model rather than in a footnote.

## 6. What does not change: the trust model

This is the part worth being precise about, because "pairing over the internet"
sounds like a security regression and is not one.

The QR gate is **anti-noise, not the security boundary**:

```
const peer = findNearbyPeer(peers, introduction.nodeId);
if (!peer) → PEER_NOT_NEARBY
```

It exists so a scan cannot latch onto whatever happens to be advertising. Trust
is established one step later, and independently:

```
// Step 2: can the peer prove it holds that identity?
→ store.markVerified(publicKey, { sessionHash })
```

Proof of possession of the private key. An Internet transport does not weaken
that at all — it changes the failure mode from *"not in range"* to *"reachable,
and must still prove itself."* Reachability was never what made a peer
trustworthy. This is exactly what the two-step design was for, and this is the
first change that collects on it.

## 7. What does change

**Sybil and denial-of-service surface.** Reachability becomes unbounded: anyone
on the internet can send an introduction. That does not break authentication, but
it does mean framing and rate limits matter, where on BLE the radio did that work
for free. `store.markFailed(publicKey, code)` already records per-peer failure —
the natural place for a limiter.

**A product claim.** `App.tsx:179` renders `Internet dependency: none`. That file
is dead code — the bundled entry point is `AppV2` — so **nothing currently
misstates the product.** But the moment an Internet transport ships, that
distinction has to be preserved deliberately: **BLE-only must remain the
default, and the Internet path opt-in.** Zaycomm's proposition is an offline mesh
that needs no infrastructure, and adding a server is the one change that could
quietly invert it.

**Pairing copy.** "Keep both devices close" becomes conditional on which
transport is active. Small, but it is user-facing text that would otherwise
become false.

## 8. Phasing

- **Phase 0 — decision, no code.** Does the default stay BLE-only? Recommended yes.
- **Phase 1 — MTU awareness.** `frameChannel` derives MTU from
  `getLinkCharacteristics()` instead of the constant `180`. Small, isolated,
  testable, and required by all three options. Do this on its own.
- **Phase 2 — `mobile/src/relayTransport.ts`**, implementing `MobileTransport`
  over WebSocket. Model it on `androidBleTransport.ts`; that file is 82 lines.
- **Phase 3 — the relay process**, reusing the core's frame handling.
- **Phase 4 — tests.** Follow the existing campaign style and add a hostile-relay
  campaign asserting what section 5 claims: a relay that drops, reorders and
  duplicates frames must be unable to impersonate a peer or read a frame. If that
  test cannot be written, recommendation B is wrong and the note should be
  rewritten.

The test in Phase 4 is the point. Everything above it is a plan; that campaign is
the evidence.

## 9. Not deadline work

Clock In's demo film is shot tomorrow and Zaycomm's next move is the
second-device pairing test, which is BLE and needs no code change. This note
exists so that when the Internet transport is the right thing to build, the
decision is already made and the first two phases are already scoped.
