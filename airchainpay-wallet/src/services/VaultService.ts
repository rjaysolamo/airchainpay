import { ethers } from 'ethers';
import { MultiChainWalletManager } from '../wallet/MultiChainWalletManager';
import { OFFLINE_VAULT_ABI } from '../constants/abi';
import { SUPPORTED_CHAINS } from '../constants/AppConfig';
import { logger } from '../utils/Logger';

/**
 * Canonical address used by {@link OfflineSecurityVault} to denote the chain's
 * native currency in its escrow / logical-nonce mappings.
 */
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Snapshot of a user's on-chain escrow position for a single asset on a single
 * chain, as surfaced by the Vault/Escrow Manager UI.
 */
export interface EscrowPosition {
  /** Asset address (`NATIVE_TOKEN_ADDRESS` for native currency). */
  token: string;
  /** Human-readable symbol (e.g. "ETH", "USDC"). */
  symbol: string;
  /** Token decimals used for formatting. */
  decimals: number;
  /** Total amount currently escrowed (formatted, base units). */
  escrowed: string;
  /** Amount pending a cooldown-gated withdrawal (formatted, base units). */
  pendingWithdrawal: string;
  /**
   * Amount that is escrowed but NOT reserved by a pending withdrawal, i.e.
   * still backing offline payments. `escrowed - pendingWithdrawal`.
   */
  available: string;
  /** Unix seconds after which a pending withdrawal can complete, or 0. */
  unlockTime: number;
}

/**
 * A single offline-signed payment authorization plus its signature. Mirrors the
 * `OfflinePayment` struct in {@link OfflineSecurityVault}. Amounts are raw
 * on-chain integers encoded as strings so the object is JSON/BLE-serializable.
 */
export interface SignedOfflinePayment {
  from: string;
  to: string;
  token: string;
  amount: string;
  logicalNonce: number;
  deadline: number;
  signature: string;
}

/**
 * VaultService
 *
 * Wallet-side facade over the {@link OfflineSecurityVault} contract. It owns:
 *   - Escrow deposits/withdrawals and balance reads (Module 1).
 *   - EIP-712 signing + settlement of logical-nonce offline payments (Module 2).
 *
 * The service is intentionally thin: it resolves the per-chain vault address
 * from {@link SUPPORTED_CHAINS} and obtains a signer via
 * {@link MultiChainWalletManager.getSigner}, so it never touches private key
 * material directly. When a chain has no configured `vaultAddress`, read/write
 * calls throw a descriptive, user-surfaceable error instead of failing deep in
 * ethers.
 */
export class VaultService {
  private static instance: VaultService;

  private constructor() {}

  public static getInstance(): VaultService {
    if (!VaultService.instance) {
      VaultService.instance = new VaultService();
    }
    return VaultService.instance;
  }

  /**
   * Whether the given chain has a configured vault. UI can use this to hide or
   * disable vault features rather than letting calls throw.
   */
  public isVaultConfigured(chainId: string): boolean {
    const chain = SUPPORTED_CHAINS[chainId];
    return !!chain?.vaultAddress && ethers.isAddress(chain.vaultAddress);
  }

  /**
   * Resolve and validate the vault address for a chain.
   * @throws if the chain is unknown or has no valid vault address configured.
   */
  public getVaultAddress(chainId: string): string {
    const chain = SUPPORTED_CHAINS[chainId];
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const address = chain.vaultAddress;
    if (!address || !ethers.isAddress(address)) {
      throw new Error(
        `Offline vault is not configured for ${chain.name}. Set "vaultAddress" for this chain to enable escrow features.`
      );
    }
    return address;
  }

  /** Build a read-only contract bound to the chain's provider. */
  private getReadContract(chainId: string): ethers.Contract {
    const provider = MultiChainWalletManager.getInstance().getProvider(chainId);
    return new ethers.Contract(this.getVaultAddress(chainId), OFFLINE_VAULT_ABI, provider);
  }

  /** Build a signer-connected contract for state-changing calls. */
  private async getWriteContract(chainId: string): Promise<ethers.Contract> {
    const signer = await MultiChainWalletManager.getInstance().getSigner(chainId);
    return new ethers.Contract(this.getVaultAddress(chainId), OFFLINE_VAULT_ABI, signer);
  }

  // -------------------------------------------------------------------------
  // Module 1: escrow reads
  // -------------------------------------------------------------------------

  /**
   * Read the caller's escrow position for a single asset, combining the escrow
   * balance with any pending (cooldown-gated) withdrawal so the UI can show
   * total / reserved / available at a glance.
   */
  public async getEscrowPosition(
    chainId: string,
    token: string,
    symbol: string,
    decimals: number
  ): Promise<EscrowPosition> {
    const contract = this.getReadContract(chainId);
    const user = await MultiChainWalletManager.getInstance().getWalletAddress();
    const isNative = token === NATIVE_TOKEN_ADDRESS;

    const escrowedRaw: bigint = isNative
      ? await contract.getEscrowBalance(user)
      : await contract.getTokenEscrowBalance(user, token);

    const request = isNative
      ? await contract.nativeWithdrawalRequests(user)
      : await contract.tokenWithdrawalRequests(user, token);

    // Clamp the pending withdrawal to the actual escrow (it may have been
    // partially slashed since the request was made).
    const requestedRaw: bigint = request.amount as bigint;
    const pendingRaw = requestedRaw > escrowedRaw ? escrowedRaw : requestedRaw;
    const availableRaw = escrowedRaw - pendingRaw;

    return {
      token,
      symbol,
      decimals,
      escrowed: ethers.formatUnits(escrowedRaw, decimals),
      pendingWithdrawal: ethers.formatUnits(pendingRaw, decimals),
      available: ethers.formatUnits(availableRaw, decimals),
      unlockTime: Number(request.unlockTime ?? 0n),
    };
  }

  /** Next expected logical nonce (sequence slot) for the caller on a chain. */
  public async getNextLogicalNonce(chainId: string): Promise<number> {
    const contract = this.getReadContract(chainId);
    const user = await MultiChainWalletManager.getInstance().getWalletAddress();
    const nonce: bigint = await contract.getNextLogicalNonce(user);
    return Number(nonce);
  }

  /** The withdrawal cooldown for a chain's vault, in seconds. */
  public async getWithdrawalCooldownSeconds(chainId: string): Promise<number> {
    const contract = this.getReadContract(chainId);
    const cooldown: bigint = await contract.WITHDRAWAL_COOLDOWN();
    return Number(cooldown);
  }

  // -------------------------------------------------------------------------
  // Module 1: escrow writes
  // -------------------------------------------------------------------------

  /**
   * Lock funds into escrow. For native deposits pass `token =
   * NATIVE_TOKEN_ADDRESS`; the value is attached automatically. For ERC-20 the
   * caller must have approved the vault for `amount` beforehand.
   */
  public async depositToEscrow(
    chainId: string,
    token: string,
    amount: string,
    decimals: number
  ): Promise<string> {
    const amountRaw = ethers.parseUnits(amount, decimals);
    if (amountRaw <= 0n) {
      throw new Error('Deposit amount must be greater than zero');
    }

    const contract = await this.getWriteContract(chainId);
    const isNative = token === NATIVE_TOKEN_ADDRESS;

    logger.info('[VaultService] Depositing to escrow', { chainId, token, amount, isNative });

    const tx = isNative
      ? await contract.depositToEscrow(token, amountRaw, { value: amountRaw })
      : await contract.depositToEscrow(token, amountRaw);

    logger.info('[VaultService] Escrow deposit submitted', { hash: tx.hash });
    return tx.hash;
  }

  /**
   * Begin the cooldown to reclaim escrowed funds. The amount stays escrowed
   * (and slashable) until {@link withdrawFromEscrow} after the cooldown.
   */
  public async requestWithdrawal(
    chainId: string,
    token: string,
    amount: string,
    decimals: number
  ): Promise<string> {
    const amountRaw = ethers.parseUnits(amount, decimals);
    if (amountRaw <= 0n) {
      throw new Error('Withdrawal amount must be greater than zero');
    }
    const contract = await this.getWriteContract(chainId);
    logger.info('[VaultService] Requesting withdrawal', { chainId, token, amount });
    const tx = await contract.requestWithdrawal(token, amountRaw);
    return tx.hash;
  }

  /** Cancel a pending withdrawal request, keeping funds escrowed. */
  public async cancelWithdrawalRequest(chainId: string, token: string): Promise<string> {
    const contract = await this.getWriteContract(chainId);
    logger.info('[VaultService] Cancelling withdrawal request', { chainId, token });
    const tx = await contract.cancelWithdrawalRequest(token);
    return tx.hash;
  }

  /** Complete a previously-requested withdrawal once its cooldown has elapsed. */
  public async withdrawFromEscrow(chainId: string, token: string): Promise<string> {
    const contract = await this.getWriteContract(chainId);
    logger.info('[VaultService] Withdrawing from escrow', { chainId, token });
    const tx = await contract.withdrawFromEscrow(token);
    return tx.hash;
  }

  // -------------------------------------------------------------------------
  // Module 2: logical-nonce offline payments
  // -------------------------------------------------------------------------

  /** EIP-712 domain for the vault on a given chain. */
  private getDomain(chainId: string): ethers.TypedDataDomain {
    const chain = SUPPORTED_CHAINS[chainId];
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    return {
      name: 'AirChainPayOfflineVault',
      version: '1',
      chainId: chain.chainId,
      verifyingContract: this.getVaultAddress(chainId),
    };
  }

  private static readonly OFFLINE_PAYMENT_TYPES = {
    OfflinePayment: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'logicalNonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };

  /**
   * Sign an offline payment for the next logical-nonce slot. The signed payload
   * can be transmitted over BLE/QR and later settled on-chain by anyone via
   * {@link executeOfflinePayment}. Uses the vault's escrow as the funding
   * source, giving strict, gap-free ordering independent of the EVM nonce.
   */
  public async signOfflinePayment(params: {
    chainId: string;
    to: string;
    token: string;
    amount: string;
    decimals: number;
    logicalNonce: number;
    /** Absolute Unix-seconds expiry. Defaults to 24h from now. */
    deadline?: number;
  }): Promise<SignedOfflinePayment> {
    const { chainId, to, token, amount, decimals, logicalNonce } = params;

    if (!ethers.isAddress(to)) {
      throw new Error('Invalid recipient address');
    }
    const amountRaw = ethers.parseUnits(amount, decimals);
    if (amountRaw <= 0n) {
      throw new Error('Payment amount must be greater than zero');
    }

    const signer = await MultiChainWalletManager.getInstance().getSigner(chainId);
    const from = await signer.getAddress();
    const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    const value = {
      from,
      to,
      token,
      amount: amountRaw,
      logicalNonce: BigInt(logicalNonce),
      deadline: BigInt(deadline),
    };

    const signature = await signer.signTypedData(
      this.getDomain(chainId),
      VaultService.OFFLINE_PAYMENT_TYPES,
      value
    );

    logger.info('[VaultService] Signed offline payment', { chainId, to, logicalNonce, deadline });

    return {
      from,
      to,
      token,
      amount: amountRaw.toString(),
      logicalNonce,
      deadline,
      signature,
    };
  }

  /**
   * Settle a previously-signed offline payment on-chain. Callable by any party
   * (typically the recipient once back online); funds are drawn from the
   * sender's escrow.
   */
  public async executeOfflinePayment(
    chainId: string,
    payment: SignedOfflinePayment
  ): Promise<string> {
    const contract = await this.getWriteContract(chainId);
    const struct = {
      from: payment.from,
      to: payment.to,
      token: payment.token,
      amount: BigInt(payment.amount),
      logicalNonce: BigInt(payment.logicalNonce),
      deadline: BigInt(payment.deadline),
    };
    logger.info('[VaultService] Executing offline payment', {
      chainId,
      from: payment.from,
      to: payment.to,
      logicalNonce: payment.logicalNonce,
    });
    const tx = await contract.executeOfflinePayment(struct, payment.signature);
    return tx.hash;
  }

  // -------------------------------------------------------------------------
  // Module 2: BLE / QR transport helpers
  // -------------------------------------------------------------------------

  /**
   * Map a {@link SignedOfflinePayment} onto the subset of fields the BLE/QR
   * `BLEPaymentData` proto carries for logical-nonce settlement. Spread the
   * result into the transport payload so a receiver can reconstruct and settle
   * the payment via {@link executeOfflinePayment} once back online.
   *
   * `token` in the transport payload is display metadata; the authoritative
   * settlement asset is `tokenAddress` here (zero address for native).
   */
  public toBlePaymentFields(payment: SignedOfflinePayment): {
    from: string;
    tokenAddress: string;
    logicalNonce: number;
    deadline: number;
    signature: string;
  } {
    return {
      from: payment.from,
      tokenAddress: payment.token,
      logicalNonce: payment.logicalNonce,
      deadline: payment.deadline,
      signature: payment.signature,
    };
  }

  /**
   * Reconstruct a {@link SignedOfflinePayment} from a decompressed BLE/QR
   * payload, or return `null` when no offline authorization is attached (legacy
   * payment). A payload is considered an offline payment only when it carries a
   * non-empty `signature`; callers should fall back to the legacy path
   * otherwise. Numeric fields may arrive as strings (protobuf `longs: String`),
   * so they are normalized here.
   */
  public fromBlePayload(payload: {
    from?: string;
    to?: string;
    tokenAddress?: string;
    amount?: string;
    logicalNonce?: number | string;
    deadline?: number | string;
    signature?: string;
  }): SignedOfflinePayment | null {
    if (!payload || !payload.signature || payload.signature.length === 0) {
      return null;
    }
    if (!payload.from || !payload.to) {
      logger.warn('[VaultService] Offline BLE payload missing from/to; ignoring');
      return null;
    }
    return {
      from: payload.from,
      to: payload.to,
      token: payload.tokenAddress ?? NATIVE_TOKEN_ADDRESS,
      amount: payload.amount ?? '0',
      logicalNonce: Number(payload.logicalNonce ?? 0),
      deadline: Number(payload.deadline ?? 0),
      signature: payload.signature,
    };
  }
}

export default VaultService;

