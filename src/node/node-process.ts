import * as readline from 'node:readline';
import { ed25519 } from '@noble/curves/ed25519.js';
import { createUdpTransport } from '../transport/udp';
import { RelayNode, type RoutingAdvertisement } from '../routing/routing';
import { openDataEnvelope, decodeEnvelope } from '../envelope/envelope';
import type { Identity } from '../identity/identity';

interface PeerConfig { id: string; host: string; port: number; publicKey: string; }
interface SessionConfig { peerId: string; sessionId: string; sendKey: string; receiveKey: string; }
interface NodeConfig { id: string; privateKey: string; port?: number; host?: string; peers?: PeerConfig[]; sessions?: SessionConfig[]; ackDestinationHint?: string; }
interface AdvertisementWire { advertiserPublicKey: string; reachableDestinations: string[]; timestamp: number; signature: string; }

type Command =
  | { op: 'add-peer'; peer: PeerConfig }
  | { op: 'auth-peer'; peerId: string; publicKey: string }
  | { op: 'advertise'; fromPeerId: string; advertisement: AdvertisementWire }
  | { op: 'send-envelope'; envelope: string }
  | { op: 'shutdown' };

const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, 'hex'));
const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex');
const emit = (event: Record<string, unknown>): void => process.stdout.write(`${JSON.stringify(event)}\n`);

function decodeAdvertisement(wire: AdvertisementWire): RoutingAdvertisement {
  return {
    advertiserPublicKey: bytes(wire.advertiserPublicKey),
    reachableDestinations: wire.reachableDestinations.map(bytes),
    timestamp: wire.timestamp,
    signature: bytes(wire.signature),
  };
}

async function main(): Promise<void> {
  const raw = process.env.ZAYCOMM_NODE_CONFIG;
  if (!raw) throw new Error('ZAYCOMM_NODE_CONFIG_REQUIRED');
  const config = JSON.parse(raw) as NodeConfig;
  const privateKey = bytes(config.privateKey);
  const identity: Identity = { privateKey, publicKey: ed25519.getPublicKey(privateKey) };
  const transport = createUdpTransport(config.id, { host: config.host ?? '127.0.0.1', port: config.port ?? 0 });
  await transport.ready();
  const node = new RelayNode(config.id, identity, transport);

  const configurePeer = (peer: PeerConfig): void => {
    transport.addPeer(peer.id, { host: peer.host, port: peer.port });
    node.registerAuthenticatedPeer(peer.id, bytes(peer.publicKey));
  };
  for (const peer of config.peers ?? []) configurePeer(peer);
  for (const session of config.sessions ?? []) {
    const peer = (config.peers ?? []).find((candidate) => candidate.id === session.peerId);
    if (!peer) throw new Error(`SESSION_PEER_NOT_FOUND:${session.peerId}`);
    node.registerAuthenticatedSession(session.peerId, bytes(peer.publicKey), {
      sessionId: session.sessionId,
      sendKey: bytes(session.sendKey),
      receiveKey: bytes(session.receiveKey),
    });
  }

  node.onDelivered((envelope) => {
    try {
      const opened = openDataEnvelope(envelope);
      emit({ event: 'delivered', messageId: hex(envelope.header.messageId), plaintext: new TextDecoder().decode(opened.ciphertext) });
      if (config.ackDestinationHint) node.sendAck(bytes(config.ackDestinationHint), envelope.header.messageId);
    } catch {
      emit({ event: 'delivered', messageId: hex(envelope.header.messageId) });
    }
  });
  node.onAckReceived((messageId) => emit({ event: 'ack', messageId: hex(messageId) }));

  emit({ event: 'ready', id: config.id, host: transport.address.host, port: transport.address.port, publicKey: hex(identity.publicKey) });

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const shutdown = async (): Promise<void> => { rl.close(); await transport.close(); process.exit(0); };
  rl.on('line', (line) => {
    void (async () => {
      try {
        const command = JSON.parse(line) as Command;
        switch (command.op) {
          case 'add-peer':
            configurePeer(command.peer);
            emit({ event: 'peer-added', peerId: command.peer.id });
            break;
          case 'auth-peer':
            node.registerAuthenticatedPeer(command.peerId, bytes(command.publicKey));
            emit({ event: 'peer-authenticated', peerId: command.peerId });
            break;
          case 'advertise':
            node.receiveAdvertisement(command.fromPeerId, decodeAdvertisement(command.advertisement));
            emit({ event: 'advertisement-processed', fromPeerId: command.fromPeerId });
            break;
          case 'send-envelope': {
            const result = node.sendEnvelope(decodeEnvelope(bytes(command.envelope)));
            emit({ event: 'send-result', result });
            break;
          }
          case 'shutdown':
            await shutdown();
            break;
        }
      } catch (error) {
        emit({ event: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}

void main().catch((error) => { emit({ event: 'fatal', error: error instanceof Error ? error.message : String(error) }); process.exit(1); });
