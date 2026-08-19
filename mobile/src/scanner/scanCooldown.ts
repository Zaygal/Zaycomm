export type ScanDecision =
  | { accepted: true }
  | { accepted: false; reason: 'cooldown' };

export class ScanCooldown {
  private lastAcceptedKey: string | null = null;
  private lastAcceptedAt = 0;

  constructor(private readonly cooldownMs = 1500) {}

  tryAccept(nodeId: string, now = Date.now()): ScanDecision {
    const key = nodeId.trim();
    if (!key) return { accepted: false, reason: 'cooldown' };

    if (
      this.lastAcceptedKey === key &&
      now - this.lastAcceptedAt < this.cooldownMs
    ) {
      return { accepted: false, reason: 'cooldown' };
    }

    this.lastAcceptedKey = key;
    this.lastAcceptedAt = now;
    return { accepted: true };
  }

  reset(): void {
    this.lastAcceptedKey = null;
    this.lastAcceptedAt = 0;
  }
}
