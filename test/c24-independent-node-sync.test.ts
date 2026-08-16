import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createIdentity } from '../src/identity/identity';
import { createDataEnvelope, encodeEnvelope } from '../src/envelope/envelope';
import { computeDestinationHint } from '../src/routing/routing';

type NodeEvent = Record<string, unknown>;
interface NodeHandle { child: ChildProcessWithoutNullStreams; events: NodeEvent[]; ready: Promise<{ host: string; port: number; publicKey: string }>; }

const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex');
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function spawnNode(identity: ReturnType<typeof createIdentity>, id: string, sessions: Array<{ peerId: string; sessionId: string; sendKey: Uint8Array; receiveKey: Uint8Array }> = []): NodeHandle {
  const events: NodeEvent[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/node/node-process.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ZAYCOMM_NODE_CONFIG: JSON.stringify({
        id,
        privateKey: hex(identity.privateKey),
        port: 0,
        sessions: sessions.map((session) => ({
          peerId: session.peerId,
          sessionId: session.sessionId,
          sendKey: hex(session.sendKey),
          receiveKey: hex(session.receiveKey),
        })),
      }),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  let readyResolve!: (value: { host: string; port: number; publicKey: string }) => void;
  let readyReject!: (reason: unknown) => void;
  let settled = false;
  const ready = new Promise<{ host: string; port: number; publicKey: string }>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    readyReject(new Error(`NODE_PROCESS_READY_TIMEOUT:${id}`));
  }, 10000);

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
        if (event.event === 'ready' && !settled) {
          settled = true;
          clearTimeout(timeout);
          readyResolve({ host: String(event.host), port: Number(event.port), publicKey: String(event.publicKey) });
        }
      } catch { /* diagnostics are intentionally ignored */ }
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const diagnostic = chunk.toString().trim();
    if (diagnostic) events.push({ event: 'stderr', nodeId: id, diagnostic });
  });
  child.once('error', (error) => {
    if (!settled) { settled = true; clearTimeout(timeout); readyReject(error); }
  });
  child.once('exit', (code, signal) => {
    if (!settled) {
      settled = true;
      clearTimeout(timeout);
      readyReject(new Error(`NODE_PROCESS_EXITED:${id}:${code ?? 'null'}:${signal ?? 'none'}`));
    }
  });
  return { child, events, ready };
}

function command(node: NodeHandle, value: Record<string, unknown>): void {
  node.child.stdin.write(`${JSON.stringify(value)}\n`);
}

async function waitFor(node: NodeHandle, predicate: (events: NodeEvent[]) => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate(node.events)) {
    if (Date.now() >= deadline) throw new Error('NODE_PROCESS_EVENT_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForQueueSize(node: NodeHandle, expected: number, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusEvents = node.events.filter((event) => event.event === 'status');
    const latest = statusEvents.at(-1);
    if (latest && Number(latest.queueSize) === expected) return;
    command(node, { op: 'status' });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`NODE_PROCESS_QUEUE_TIMEOUT:${node.events.filter((event) => event.event === 'status').map((event) => String(event.queueSize)).join(',')}`);
}

async function stop(node: NodeHandle): Promise<void> {
  if (node.child.exitCode !== null) return;
  command(node, { op: 'shutdown' });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { node.child.kill('SIGTERM'); resolve(); }, 1000);
    node.child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

describe('C24 independent node encrypted sync', () => {
  it('synchronizes a queued envelope across separate OS processes using established directional session keys', async () => {
    const aliceIdentity = createIdentity();
    const relayIdentity = createIdentity();
    const aliceToRelay = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const relayToAlice = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const sessionId = 'c24-independent-session';
    const alice = spawnNode(aliceIdentity, 'alice', [{ peerId: 'relay', sessionId, sendKey: aliceToRelay, receiveKey: relayToAlice }]);
    const relay = spawnNode(relayIdentity, 'relay', [{ peerId: 'alice', sessionId, sendKey: relayToAlice, receiveKey: aliceToRelay }]);

    try {
      const [aliceAddr, relayAddr] = await Promise.all([alice.ready, relay.ready]);
      command(alice, { op: 'add-peer', peer: { id: 'relay', host: relayAddr.host, port: relayAddr.port, publicKey: hex(relayIdentity.publicKey) } });
      command(relay, { op: 'add-peer', peer: { id: 'alice', host: aliceAddr.host, port: aliceAddr.port, publicKey: hex(aliceIdentity.publicKey) } });

      const unreachableDestination = computeDestinationHint(createIdentity().publicKey);
      const envelope = createDataEnvelope(
        unreachableDestination,
        { dhPublicKey: new Uint8Array(32), previousChainLength: 0, messageNumber: 0 },
        text('sync-secret-payload'),
        8,
      );
      command(alice, { op: 'send-envelope', envelope: hex(encodeEnvelope(envelope)) });
      await waitFor(alice, (events) => events.some((event) => event.event === 'send-result' && (event.result as Record<string, unknown> | undefined)?.outcome === 'queued'));

      command(alice, { op: 'initiate-sync', peerId: 'relay' });
      await waitFor(alice, (events) => events.some((event) => event.event === 'sync-result' && event.initiated === true));

      // Sync is asynchronous: the relay may report queueSize=0 before it has
      // received Alice's encrypted summary, requested the missing envelope,
      // and received the encrypted transfer. Poll status instead of making the
      // test depend on a single timing-sensitive snapshot.
      await waitForQueueSize(relay, 1);

      expect(relay.events.some((event) => event.event === 'status' && Number(event.queueSize) === 1)).toBe(true);
      expect(alice.events.some((event) => event.event === 'error' || event.event === 'fatal')).toBe(false);
      expect(relay.events.some((event) => event.event === 'error' || event.event === 'fatal')).toBe(false);
    } finally {
      await Promise.all([stop(alice), stop(relay)]);
    }
  }, 15000);
});
