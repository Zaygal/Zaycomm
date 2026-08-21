import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MessageFrame } from './messageProtocol';

export type OutboxStatus = 'queued' | 'sending' | 'awaiting_ack' | 'failed' | 'delivered';

export type OutboxMessage = {
  frame: MessageFrame;
  status: OutboxStatus;
  attempts: number;
  queuedAt: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  deliveredAt?: number;
  lastError?: string;
};

const OUTBOX_KEY = '@zaycomm/messages/outbox/v1';
const RECEIVED_KEY = '@zaycomm/messages/received/v1';
const MAX_RECEIVED_IDS = 2000;
const MAX_ATTEMPTS = 8;

async function readOutbox(): Promise<Record<string, OutboxMessage>> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, OutboxMessage>;
  } catch {
    return {};
  }
}

async function writeOutbox(value: Record<string, OutboxMessage>): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(value));
}

async function readReceived(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECEIVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function enqueueMessage(frame: MessageFrame): Promise<OutboxMessage> {
  const outbox = await readOutbox();
  const existing = outbox[frame.messageId];
  if (existing) return existing;
  const entry: OutboxMessage = { frame, status: 'queued', attempts: 0, queuedAt: Date.now() };
  outbox[frame.messageId] = entry;
  await writeOutbox(outbox);
  return entry;
}

export async function getPendingMessages(now = Date.now()): Promise<OutboxMessage[]> {
  const outbox = await readOutbox();
  return Object.values(outbox)
    .filter((entry) => entry.status !== 'delivered' && entry.attempts < MAX_ATTEMPTS && (entry.nextAttemptAt ?? 0) <= now)
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function markMessageSending(messageId: string): Promise<OutboxMessage | null> {
  const outbox = await readOutbox();
  const entry = outbox[messageId];
  if (!entry || entry.status === 'delivered') return null;
  entry.status = 'sending';
  entry.attempts += 1;
  entry.lastAttemptAt = Date.now();
  entry.nextAttemptAt = Date.now() + Math.min(60_000, 2_000 * 2 ** Math.max(0, entry.attempts - 1));
  await writeOutbox(outbox);
  return entry;
}

export async function markAwaitingAck(messageId: string): Promise<void> {
  const outbox = await readOutbox();
  const entry = outbox[messageId];
  if (!entry || entry.status === 'delivered') return;
  entry.status = 'awaiting_ack';
  await writeOutbox(outbox);
}

export async function markMessageDelivered(messageId: string): Promise<void> {
  const outbox = await readOutbox();
  const entry = outbox[messageId];
  if (!entry) return;
  entry.status = 'delivered';
  entry.deliveredAt = Date.now();
  entry.lastError = undefined;
  await writeOutbox(outbox);
}

export async function markMessageFailed(messageId: string, error: string): Promise<void> {
  const outbox = await readOutbox();
  const entry = outbox[messageId];
  if (!entry) return;
  entry.status = entry.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
  entry.lastError = error.slice(0, 256);
  await writeOutbox(outbox);
}

export async function hasReceivedMessage(messageId: string): Promise<boolean> {
  const ids = await readReceived();
  return ids.includes(messageId);
}

export async function recordReceivedMessage(messageId: string): Promise<boolean> {
  const ids = await readReceived();
  if (ids.includes(messageId)) return false;
  const next = [...ids, messageId].slice(-MAX_RECEIVED_IDS);
  await AsyncStorage.setItem(RECEIVED_KEY, JSON.stringify(next));
  return true;
}

export async function clearDeliveredMessages(): Promise<void> {
  const outbox = await readOutbox();
  const remaining = Object.fromEntries(Object.entries(outbox).filter(([, entry]) => entry.status !== 'delivered'));
  await writeOutbox(remaining);
}
