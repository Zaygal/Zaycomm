export type QrValidationResult =
  | { valid: true; nodeId: string; publicKey: Uint8Array }
  | { valid: false; reason: 'empty' | 'invalid-json' | 'invalid-scheme' | 'invalid-version' | 'invalid-node-id' | 'invalid-public-key' };

export function validateZaycommQr(raw: string): QrValidationResult {
  if (!raw.trim()) return { valid: false, reason: 'empty' };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { valid: false, reason: 'invalid-json' };
  }

  if (!value || typeof value !== 'object') return { valid: false, reason: 'invalid-json' };
  const qr = value as Record<string, unknown>;
  if (qr.scheme !== 'zaycomm') return { valid: false, reason: 'invalid-scheme' };
  if (qr.version !== 1) return { valid: false, reason: 'invalid-version' };
  if (typeof qr.nodeId !== 'string' || !/^[0-9a-f]{16}$/i.test(qr.nodeId)) {
    return { valid: false, reason: 'invalid-node-id' };
  }

  if (typeof qr.publicKey !== 'string' || !/^[0-9a-f]{64}$/i.test(qr.publicKey)) {
    return { valid: false, reason: 'invalid-public-key' };
  }

  const publicKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    publicKey[i] = Number.parseInt(qr.publicKey.slice(i * 2, i * 2 + 2), 16);
  }

  return { valid: true, nodeId: qr.nodeId, publicKey };
}

export function invalidQrMessage(reason: Exclude<QrValidationResult, { valid: true }>['reason']): string {
  switch (reason) {
    case 'empty': return 'No QR payload detected.';
    case 'invalid-json': return 'This is not a readable Zaycomm QR code.';
    case 'invalid-scheme': return 'This QR code is not a Zaycomm node.';
    case 'invalid-version': return 'This Zaycomm QR version is not supported.';
    case 'invalid-node-id': return 'The Zaycomm node identity is invalid.';
    case 'invalid-public-key': return 'The Zaycomm public key is invalid.';
  }
}
