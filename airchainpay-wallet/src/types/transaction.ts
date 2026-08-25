export interface Transaction {
  id: string;
  to: string;
  amount: string;
  status: string;
  chainId: string;
  timestamp: number;
  signedTx?: string;
  transport?: string;
  error?: string;
  token?: {
    address: string;
    symbol: string;
    decimals: number;
    isNative: boolean;
  };
  paymentReference?: string;
  metadata?: {
    merchant?: string;
    location?: string;
    maxAmount?: string;
    minAmount?: string;
    timestamp?: number;
    expiry?: number;
  };
  /**
   * Logical nonce for escrow-backed offline payments (OfflineSecurityVault
   * Module 2). Present only for payments signed against the vault; legacy
   * payments leave this undefined. Used to order/settle offline payments in a
   * strict, gap-free sequence independent of the on-chain EVM nonce.
   */
  logicalNonce?: number;
  /** Escrow owner / sender address for logical-nonce offline payments. */
  from?: string;
  /** EIP-712 signature authorizing an escrow-backed offline payment. */
  offlineSignature?: string;
  [key: string]: unknown;
}

