import type { PairResult } from './pairResult';

export type PairNavigationState =
  | { status: 'scanning' }
  | { status: 'success'; result: PairResult }
  | { status: 'closed' };

export function completePair(result: PairResult): PairNavigationState {
  return { status: 'success', result };
}

export function closePairScanner(): PairNavigationState {
  return { status: 'closed' };
}
