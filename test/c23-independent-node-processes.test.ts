import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createIdentity, type Identity } from '../src/identity/identity';
import { createDataEnvelope, encodeEnvelope } from '../src/envelope/envelope';
import { computeDestinationHint, createRoutingAdvertisement } from '../src/routing/routing';

type NodeEvent = Record<string, unknown>;
interface NodeHandle { child: ChildProcessWithoutNullStreams; events: NodeEvent[]; ready: Promise<{ host: string; port: number; publicKey: string }>; }

const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex');
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function wireAdvertisement(identity: Identity, destinationHint: Uint8Array) {
  const advertisement = createRoutingAdvertisement(identity, [destinationHint]);
  return {
    advertiserPublicKey: hex(advertisement.advertiserPublicKey),
    reachableDestinations: advertisement.reachableDestinations.map(hex),
    timestamp: advertisement.timestamp,
    signature: hex(advertisement.signature),
  };
}

function spawnNode(identity: Identity): NodeHandle {
  const events: NodeEvent[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/node/node-process.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, ZAYCOMM_NODE_CONFIG: JSON.stringify({ id: `node-${Math.random().toString(16).slice(2)}`, privateKey: hex(identity.privateKey), port: 0 }) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  let readyResolve!: (value: { host: string; port: number; publicKey: string }) => void;
  let readyReject!: (reason: unknown) => void;
  const ready = new Promise<{ host: string; port: number; publicKey: string }>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timeout = setTimeout(() => readyReject(new Error('NODE_PROCESS_READY_TIMEOUT')), 3000);

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line) as NodeEvent;
        events.push(event);
        if (event.event === 'ready') {
          clearTimeout(timeout);
          readyResolve({ host: String(event.host), port: Number(event.port), publicKey: String(event.publicKey) });
        }
      } catch { /* child diagnostics are intentionally ignored here */ }
    }
  });
  child.stderr.on('data', () => undefined);
  child.once('error', readyReject);
  return { child, events, ready };
}

function command(node: NodeHandle, value: Record<string, unknown>): void {
  node.child.stdin.write(`${JSON.stringify(value)}\n`);
}

async function waitFor(node: NodeHandle, predicate: (events: NodeEvent[]) => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate(node.events)) {
    if (Date.now() >= deadline) throw new Error('NODE_PROCESS_EVENT_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function stop(node: NodeHandle): Promise<void> {
  if (node.child.exitCode !== null) return;
  command(node, { op: 'shutdown' });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { node.child.kill('SIGTERM'); resolve(); }, 1000);
    node.child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

describe('C23 independent node processes', () => {
  it('carries Alice → Relay → Bob and Bob → Relay → Alice across separate OS processes', async () => {
    const aliceIdentity = createIdentity();
    const relayIdentity = createIdentity();
    const bobIdentity = createIdentity();
    const alice = spawnNode(aliceIdentity);
    const relay = spawnNode(relayIdentity);
    const bob = spawnNode(bobIdentity);

    try {
      const [aliceAddr, relayAddr, bobAddr] = await Promise.all([alice.ready, relay.ready, bob.ready]);
      const aliceHint = computeDestinationHint(aliceIdentity.publicKey);
      const bobHint = computeDestinationHint(bobIdentity.publicKey);

      command(alice, { op: 'add-peer', peer: { id: 'relay', host: relayAddr.host, port: relayAddr.port, publicKey: hex(relayIdentity.publicKey) } });
      command(relay, { op: 'add-peer', peer: { id: 'alice', host: aliceAddr.host, port: aliceAddr.port, publicKey: hex(aliceIdentity.publicKey) } });
      command(relay, { op: 'add-peer', peer: { id: 'bob', host: bobAddr.host, port: bobAddr.port, publicKey: hex(bobIdentity.publicKey) } });
      command(bob, { op: 'add-peer', peer: { id: 'relay', host: relayAddr.host, port: relayAddr.port, publicKey: hex(relayIdentity.publicKey) } });

      const bobAdvertisement = wireAdvertisement(bobIdentity, bobHint);
      const aliceAdvertisement = wireAdvertisement(aliceIdentity, aliceHint);
      command(relay, { op: 'advertise', fromPeerId: 'bob', advertisement: bobAdvertisement });
      command(alice, { op: 'advertise', fromPeerId: 'relay', advertisement: bobAdvertisement });
      command(relay, { op: 'advertise', fromPeerId: 'alice', advertisement: aliceAdvertisement });
      command(bob, { op: 'advertise', fromPeerId: 'relay', advertisement: aliceAdvertisement });

      const envelope = createDataEnvelope(
        bobHint,
        { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
        text('hello independent nodes'),
        8,
      );
      command(alice, { op: 'send-envelope', envelope: hex(encodeEnvelope(envelope)) });

      await waitFor(bob, (events) => events.some((event) => event.event === 'delivered' && event.plaintext === 'hello independent nodes'));
      await waitFor(alice, (events) => events.some((event) => event.event === 'ack'));

      expect(bob.events.some((event) => event.event === 'delivered' && event.plaintext === 'hello independent nodes')).toBe(true);
      expect(alice.events.some((event) => event.event === 'ack')).toBe(true);
      expect(relay.events.some((event) => event.event === 'error' || event.event === 'fatal')).toBe(false);
    } finally {
      await Promise.all([stop(alice), stop(relay), stop(bob)]);
    }
  });
});
