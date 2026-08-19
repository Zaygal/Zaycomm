export type PairResult = {
  nodeId: string;
  publicKey: string;
  introducedAt: number;
};

export function createPairResult(nodeId: string, publicKey: Uint8Array): PairResult {
  return {
    nodeId,
    publicKey: Array.from(publicKey).map((b) => b.toString(16).padStart(2, '0')).join(''),
    introducedAt: Date.now(),
  };
}
