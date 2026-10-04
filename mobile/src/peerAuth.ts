// mobile/src/peerAuth.ts
// The QR identity introduction flow, from scanned bytes to a trusted peer.
//
// Pairing is two steps, and the UI must show them as two steps:
//
//   1. Decode and validate the scanned introduction. This only proves the
//      code is a well-formed Zaycomm code. It grants nothing.
//   2. Authenticate. The peer must prove it holds the Ed25519 identity the
//      code advertised, through the existing session gate. Only then does the
//      peer become trusted.
//
// A validated code with a failed handshake leaves the peer untrusted. This
// module never fabricates a success and never bypasses the gate.

import { authenticateScannedPeer } from '../../src/identity/introduction-session';
import { tryDecodeNodeIntroduction } from '../../src/identity/introduction';
import { PeerTrustStore, type PeerTrustRecord } from '../../src/identity/peer-trust';
import { FrameChannel } from './frameChannel';
import type { MobilePeer, MobileTransport } from './transport';
import type { Identity } from '../../src/identity/identity';
import type { X25519KeyPair } from '../../src/crypto/keys';

export type PeerAuthStage =
  | 'idle'
  | 'scanning'
  | 'captured'
  | 'validating'
  | 'authenticating'
  | 'verified'
  | 'failed';

export interface PeerAuthResult {
  ok: boolean;
  stage: PeerAuthStage;
  /** Failure code, either an introduction code or a session gate code. */
  code?: string;
  message?: string;
  peer?: PeerTrustRecord;
}

export interface AuthenticateOptions {
  transport: MobileTransport;
  /** Peers currently seen over BLE, used to locate the scanned node. */
  peers: MobilePeer[];
  store: PeerTrustStore;
  identity: Identity;
  staticKeyPair: X25519KeyPair;
  onStage?: (stage: PeerAuthStage) => void;
  /** Handshake budget in milliseconds. */
  timeoutMs?: number;
}

let activeChannel: FrameChannel | null = null;
let receiverInstalled = false;

/**
 * Routes incoming transport frames into the active authentication channel.
 * Installed once per transport; frames for other peers are ignored.
 */
function installReceiver(transport: MobileTransport): void {
  if (receiverInstalled) return;
  receiverInstalled = true;
  transport.onReceive((peerId, frame) => activeChannel?.accept(peerId, frame));
}

/** Scanned node identities that are currently visible over BLE. */
export function findNearbyPeer(peers: MobilePeer[], nodeId: string): MobilePeer | null {
  return peers.find((peer) => peer.id.toLowerCase() === nodeId.toLowerCase()) ?? null;
}

export async function authenticateScannedPayload(
  raw: string,
  options: AuthenticateOptions
): Promise<PeerAuthResult> {
  const { transport, peers, store, identity, staticKeyPair, onStage } = options;

  // Step 1: is this a well-formed introduction at all?
  onStage?.('validating');
  const decoded = tryDecodeNodeIntroduction(raw);
  if (!decoded.ok) {
    onStage?.('failed');
    return { ok: false, stage: 'failed', code: decoded.code, message: decoded.message };
  }

  const introduction = decoded.introduction;

  if (introduction.publicKey === toHex(identity.publicKey)) {
    onStage?.('failed');
    return {
      ok: false,
      stage: 'failed',
      code: 'QR_SELF',
      message: 'That is this device\'s own code.',
    };
  }

  // The introduction says who the peer is, not how to reach it. The reachable
  // address comes from BLE discovery, matched on the advertised node id.
  const peer = findNearbyPeer(peers, introduction.nodeId);
  if (!peer) {
    onStage?.('failed');
    return {
      ok: false,
      stage: 'failed',
      code: 'PEER_NOT_NEARBY',
      message: 'That node is not visible over Bluetooth yet. Start its transport and keep both devices close.',
    };
  }

  // Recorded as an introduction only. Nothing is trusted at this point.
  store.introduce(introduction);

  // Step 2: can the peer prove it holds that identity?
  onStage?.('authenticating');
  installReceiver(transport);

  try {
    await transport.connect(peer);
  } catch (error) {
    store.markFailed(introduction.publicKey, 'CONNECT_FAILED');
    onStage?.('failed');
    return {
      ok: false,
      stage: 'failed',
      code: 'CONNECT_FAILED',
      message: `Could not open a link to that node: ${describe(error)}`,
    };
  }

  const channel = new FrameChannel(transport, peer.id);
  activeChannel = channel;

  try {
    const session = await withTimeout(
      authenticateScannedPeer({
        local: { identity, staticKeyPair },
        introduction,
        channel,
        requiredCapability: 'ble',
      }),
      options.timeoutMs ?? 15000
    );

    const record = store.markVerified(introduction.publicKey, { sessionHash: session.handshakeHash });
    onStage?.('verified');
    return { ok: true, stage: 'verified', peer: record };
  } catch (error) {
    const code = errorCode(error);
    store.markFailed(introduction.publicKey, code);
    onStage?.('failed');
    return {
      ok: false,
      stage: 'failed',
      code,
      message: failureMessage(code),
      peer: store.get(introduction.publicKey) ?? undefined,
    };
  } finally {
    activeChannel = null;
    try {
      await transport.disconnect(peer.id);
    } catch {
      // A failed disconnect must not mask the authentication outcome.
    }
  }
}

function withTimeout<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('AUTHENTICATION_TIMEOUT')), milliseconds);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function errorCode(error: unknown): string {
  const message = describe(error);
  const known = [
    'PEER_IDENTITY_MISMATCH',
    'PEER_SESSION_BINDING_INVALID',
    'LOCAL_SESSION_BINDING_INVALID',
    'SESSION_IDENTITY_MISMATCH',
    'PEER_INTRODUCTION_MISMATCH',
    'HANDSHAKE_FAILED',
    'CHANNEL_FAILED',
    'INTRODUCTION_NOT_USABLE',
    'AUTHENTICATION_TIMEOUT',
  ];
  return known.find((code) => message.includes(code)) ?? 'AUTHENTICATION_FAILED';
}

function failureMessage(code: string): string {
  switch (code) {
    case 'PEER_IDENTITY_MISMATCH':
    case 'PEER_SESSION_BINDING_INVALID':
      return 'The other device could not prove it holds the identity in that code. Peer not trusted.';
    case 'PEER_INTRODUCTION_MISMATCH':
      return 'The device that answered is not the device that code introduced. Peer not trusted.';
    case 'AUTHENTICATION_TIMEOUT':
      return 'Authentication timed out. Peer not trusted.';
    default:
      return 'Authentication failed. Peer not trusted.';
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
