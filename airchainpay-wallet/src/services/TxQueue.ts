import AsyncStorage from '@react-native-async-storage/async-storage';
import { Transaction } from '../types/transaction';

const TX_QUEUE_KEY = 'tx_queue';

/**
 * A chain's worth of escrow-backed offline payments, ordered by logical nonce,
 * plus any detected gaps in the sequence. A "gap" means an earlier logical
 * nonce is missing locally, so later payments cannot settle until it arrives —
 * the UI surfaces this as a Pending Sequence warning.
 */
export interface LogicalNonceGroup {
  chainId: string;
  /** Sender/escrow owner these payments are sequenced against. */
  from?: string;
  /** Offline payments on this chain, sorted ascending by logical nonce. */
  transactions: Transaction[];
  /** Logical nonces that are missing between the min and max present. */
  missingNonces: number[];
  /** Lowest logical nonce present in the group. */
  minNonce: number;
  /** Highest logical nonce present in the group. */
  maxNonce: number;
  /** True when there are no gaps and the sequence can settle in order. */
  isContiguous: boolean;
}

export class TxQueue {
  static async getPendingTransactions(): Promise<Transaction[]> {
    try {
      const queueStr = await AsyncStorage.getItem(TX_QUEUE_KEY);
      if (!queueStr) return [];
      const queue = JSON.parse(queueStr);
      return queue.filter((tx: Transaction) => tx.status === 'pending');
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error getting pending transactions:', error);
      } else {
        console.error('Error getting pending transactions:', error);
      }
      return [];
    }
  }

  static async addTransaction(tx: Transaction): Promise<void> {
    try {
      const queueStr = await AsyncStorage.getItem(TX_QUEUE_KEY);
      const queue = queueStr ? JSON.parse(queueStr) : [];
      queue.push(tx);
      await AsyncStorage.setItem(TX_QUEUE_KEY, JSON.stringify(queue));
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error adding transaction to queue:', error);
      } else {
        console.error('Error adding transaction to queue:', error);
      }
    }
  }

  static async updateTransaction(txId: string, updates: Partial<Transaction>): Promise<void> {
    try {
      const queueStr = await AsyncStorage.getItem(TX_QUEUE_KEY);
      if (!queueStr) return;
      const queue = JSON.parse(queueStr);
      const index = queue.findIndex((tx: Transaction) => tx.id === txId);
      if (index === -1) return;
      queue[index] = { ...queue[index], ...updates };
      await AsyncStorage.setItem(TX_QUEUE_KEY, JSON.stringify(queue));
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error updating transaction:', error);
      } else {
        console.error('Error updating transaction:', error);
      }
    }
  }

  static async clearQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(TX_QUEUE_KEY, JSON.stringify([]));
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error clearing transaction queue:', error);
      } else {
        console.error('Error clearing transaction queue:', error);
      }
    }
  }

  static async getQueuedTransactions(): Promise<Transaction[]> {
    try {
      const queueStr = await AsyncStorage.getItem(TX_QUEUE_KEY);
      if (!queueStr) return [];
      const queue = JSON.parse(queueStr);
      return queue.filter((tx: Transaction) => tx.status === 'queued');
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error getting queued transactions:', error);
      } else {
        console.error('Error getting queued transactions:', error);
      }
      return [];
    }
  }

  static async removeTransaction(txId: string): Promise<void> {
    try {
      const queueStr = await AsyncStorage.getItem(TX_QUEUE_KEY);
      if (!queueStr) return;
      let queue = JSON.parse(queueStr);
      queue = queue.filter((tx: Transaction) => tx.id !== txId);
      await AsyncStorage.setItem(TX_QUEUE_KEY, JSON.stringify(queue));
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error removing transaction from queue:', error);
      } else {
        console.error('Error removing transaction from queue:', error);
      }
    }
  }

  static async getQueueStatus(): Promise<{
    total: number;
    queued: number;
    pending: number;
    failed: number;
  }> {
    try {
      const queueStr = await AsyncStorage.getItem(TX_QUEUE_KEY);
      if (!queueStr) return { total: 0, queued: 0, pending: 0, failed: 0 };
      
      const queue = JSON.parse(queueStr);
      const queued = queue.filter((tx: Transaction) => tx.status === 'queued').length;
      const pending = queue.filter((tx: Transaction) => tx.status === 'pending').length;
      const failed = queue.filter((tx: Transaction) => tx.status === 'failed').length;
      
      return {
        total: queue.length,
        queued,
        pending,
        failed
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error getting queue status:', error);
      } else {
        console.error('Error getting queue status:', error);
      }
      return { total: 0, queued: 0, pending: 0, failed: 0 };
    }
  }

  /**
   * Return only escrow-backed offline payments (those carrying a
   * `logicalNonce`) that have not yet settled — i.e. still `queued` or
   * `pending`. Legacy payments without a logical nonce are excluded.
   */
  static async getOfflineNonceTransactions(): Promise<Transaction[]> {
    try {
      const queueStr = await AsyncStorage.getItem(TX_QUEUE_KEY);
      if (!queueStr) return [];
      const queue: Transaction[] = JSON.parse(queueStr);
      return queue.filter(
        (tx) =>
          typeof tx.logicalNonce === 'number' &&
          (tx.status === 'queued' || tx.status === 'pending')
      );
    } catch (error: unknown) {
      console.error('Error getting offline nonce transactions:', error);
      return [];
    }
  }

  /**
   * Group unsettled offline payments by chain (and sender), ordered by logical
   * nonce, and compute any gaps in each sequence. Consumers use this to render
   * the offline queue grouped by sequence and to raise a Pending Sequence
   * warning when `missingNonces` is non-empty (a later payment can't settle
   * until the missing earlier ones are received/settled).
   */
  static async getLogicalNonceGroups(): Promise<LogicalNonceGroup[]> {
    const txs = await this.getOfflineNonceTransactions();
    return TxQueue.buildLogicalNonceGroups(txs);
  }

  /**
   * Pure grouping/gap-detection over a set of transactions. Extracted from
   * {@link getLogicalNonceGroups} so it is trivially unit-testable without
   * touching AsyncStorage. Grouping key is `chainId` + `from` (sequences are
   * per-sender, per-chain in the vault).
   */
  static buildLogicalNonceGroups(txs: Transaction[]): LogicalNonceGroup[] {
    const buckets = new Map<string, Transaction[]>();

    for (const tx of txs) {
      if (typeof tx.logicalNonce !== 'number') continue;
      const key = `${tx.chainId}::${tx.from ?? ''}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(tx);
      } else {
        buckets.set(key, [tx]);
      }
    }

    const groups: LogicalNonceGroup[] = [];
    for (const [key, bucketTxs] of buckets) {
      const sorted = [...bucketTxs].sort(
        (a, b) => (a.logicalNonce as number) - (b.logicalNonce as number)
      );
      const nonces = sorted.map((t) => t.logicalNonce as number);
      const minNonce = nonces[0];
      const maxNonce = nonces[nonces.length - 1];

      // Detect gaps within [minNonce, maxNonce]. A duplicate nonce is not a gap
      // but is still worth surfacing; here we only report missing values.
      const present = new Set(nonces);
      const missingNonces: number[] = [];
      for (let n = minNonce; n <= maxNonce; n++) {
        if (!present.has(n)) missingNonces.push(n);
      }

      const [chainId, from] = key.split('::');
      groups.push({
        chainId,
        from: from || undefined,
        transactions: sorted,
        missingNonces,
        minNonce,
        maxNonce,
        isContiguous: missingNonces.length === 0,
      });
    }

    // Show chains with gaps first so the warning is prominent.
    return groups.sort((a, b) => Number(a.isContiguous) - Number(b.isContiguous));
  }
}

export type TxRow = Transaction;


export async function getAllTransactions(): Promise<Transaction[]> {
  try {
    const queueStr = await AsyncStorage.getItem(TX_QUEUE_KEY);
    if (!queueStr) return [];
    return JSON.parse(queueStr);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error getting all transactions:', error);
    } else {
      console.error('Error getting all transactions:', error);
    }
    return [];
  }
} 