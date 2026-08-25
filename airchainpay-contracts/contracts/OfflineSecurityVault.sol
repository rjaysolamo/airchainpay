// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title OfflineSecurityVault
 * @notice On-chain balance isolation and sequence enforcement for AirChainPay's
 *         offline payment flow.
 *
 * The three cooperating modules implemented here are:
 *
 *   1. Escrow Isolation Vault
 *      Users sequester funds (native or ERC-20) into the contract *before* they
 *      go offline. Reclaiming unused funds is gated behind a cooldown so an
 *      actor cannot deposit, sign offline payments, then instantly withdraw the
 *      backing collateral online to bypass their offline commitments.
 *
 *   2. Logical Nonce Tracking
 *      Every sender has a sequential `nextLogicalNonce`, tracked independently of
 *      the native EVM account nonce. An offline-signed payment only settles when
 *      its `logicalNonce` exactly matches the sender's expected slot, and the
 *      slot is advanced on success. This gives strict, gap-free ordering for
 *      offline transactions.
 *
 *   3. Slashing & Double-Spend Proof
 *      Because offline recipients cannot see chain state at signing time, a
 *      malicious sender could sign two *different* payments for the *same*
 *      logical nonce slot (a double-spend). Anyone can submit both signed
 *      payloads as a fraud proof; if valid, the fraudster's escrowed collateral
 *      (in the asset that was defrauded) is slashed and paid directly to the
 *      victim of the submitted payment.
 *
 * @dev The contract is intentionally trustless (no owner/admin). All settlement
 *      draws exclusively from the sender's own escrowed balance, so the vault can
 *      never move funds a user did not explicitly sequester.
 */
contract OfflineSecurityVault is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /**
     * @dev A single offline-signed payment authorization. `token == address(0)`
     *      denotes a native-currency payment; otherwise it is the ERC-20 token
     *      address. The struct is signed off-chain via EIP-712.
     */
    struct OfflinePayment {
        address from;
        address to;
        address token;
        uint256 amount;
        uint256 logicalNonce;
        uint256 deadline;
    }

    /// @dev A pending, cooldown-gated request to reclaim escrowed funds.
    struct WithdrawalRequest {
        uint256 amount;
        uint256 unlockTime;
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice EIP-712 type hash for {OfflinePayment}.
    bytes32 public constant OFFLINE_PAYMENT_TYPEHASH = keccak256(
        "OfflinePayment(address from,address to,address token,uint256 amount,uint256 logicalNonce,uint256 deadline)"
    );

    /// @notice Time that must elapse between requesting and completing a withdrawal.
    uint256 public constant WITHDRAWAL_COOLDOWN = 1 days;

    /// @dev Sentinel used as the mapping key for native currency escrow.
    address private constant NATIVE = address(0);

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /**
     * @notice Native-currency escrow ("security deposit") per user. This is the
     *         collateral slashed on a proven double-spend of a native payment.
     */
    mapping(address => uint256) public escrowedBalances;

    /// @notice ERC-20 escrow per user, per token address.
    mapping(address => mapping(address => uint256)) public tokenEscrowedBalances;

    /// @notice Next expected logical nonce (sequence slot) per sender.
    mapping(address => uint256) public nextLogicalNonce;

    /// @notice Pending native-currency withdrawal request per user.
    mapping(address => WithdrawalRequest) public nativeWithdrawalRequests;

    /// @notice Pending ERC-20 withdrawal request per user, per token.
    mapping(address => mapping(address => WithdrawalRequest)) public tokenWithdrawalRequests;

    /**
     * @notice Records whether a given (sender, logicalNonce) slot has already
     *         been slashed, preventing a fraud proof from being replayed.
     */
    mapping(address => mapping(uint256 => bool)) public slashedNonce;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event EscrowDeposited(address indexed user, address indexed token, uint256 amount, uint256 newBalance);
    event WithdrawalRequested(address indexed user, address indexed token, uint256 amount, uint256 unlockTime);
    event WithdrawalCancelled(address indexed user, address indexed token, uint256 amount);
    event EscrowWithdrawn(address indexed user, address indexed token, uint256 amount, uint256 newBalance);
    event OfflinePaymentSettled(
        address indexed from,
        address indexed to,
        address indexed token,
        uint256 amount,
        uint256 logicalNonce
    );
    event DoubleSpendSlashed(
        address indexed offender,
        address indexed victim,
        address indexed token,
        uint256 logicalNonce,
        uint256 slashedAmount
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error InvalidAmount();
    error InvalidRecipient();
    error NativeValueMismatch();
    error UnexpectedNativeValue();
    error InsufficientEscrow();
    error NoPendingWithdrawal();
    error WithdrawalOnCooldown();
    error PaymentExpired();
    error InvalidSignature();
    error BadLogicalNonce();
    error NotADoubleSpend();
    error AlreadySlashed();
    error NothingToSlash();
    error NativeTransferFailed();

    constructor() EIP712("AirChainPayOfflineVault", "1") {}

    // ---------------------------------------------------------------------
    // Module 1: Escrow Isolation Vault
    // ---------------------------------------------------------------------

    /**
     * @notice Lock native currency or ERC-20 tokens into escrow before going
     *         offline. For native deposits pass `token == address(0)` and send
     *         `msg.value == amount`; for ERC-20 deposits `msg.value` must be 0
     *         and the caller must have approved this contract for `amount`.
     * @param token The asset to escrow (address(0) for native currency).
     * @param amount The amount to escrow.
     */
    function depositToEscrow(address token, uint256 amount) external payable nonReentrant {
        if (amount == 0) revert InvalidAmount();

        if (token == NATIVE) {
            if (msg.value != amount) revert NativeValueMismatch();
            escrowedBalances[msg.sender] += amount;
            emit EscrowDeposited(msg.sender, NATIVE, amount, escrowedBalances[msg.sender]);
        } else {
            if (msg.value != 0) revert UnexpectedNativeValue();
            // Credit only what actually arrives, so fee-on-transfer tokens cannot
            // desynchronize internal accounting from real balances.
            IERC20 erc20 = IERC20(token);
            uint256 balanceBefore = erc20.balanceOf(address(this));
            erc20.safeTransferFrom(msg.sender, address(this), amount);
            uint256 received = erc20.balanceOf(address(this)) - balanceBefore;
            if (received == 0) revert InvalidAmount();
            tokenEscrowedBalances[msg.sender][token] += received;
            emit EscrowDeposited(msg.sender, token, received, tokenEscrowedBalances[msg.sender][token]);
        }
    }

    /**
     * @notice Begin the cooldown to reclaim escrowed funds. The requested amount
     *         remains in escrow (and slashable) until {withdrawFromEscrow} is
     *         called after the cooldown elapses. Re-calling overwrites the prior
     *         request and restarts the cooldown.
     * @param token The escrowed asset (address(0) for native currency).
     * @param amount The amount the user intends to withdraw.
     */
    function requestWithdrawal(address token, uint256 amount) external {
        if (amount == 0) revert InvalidAmount();

        uint256 balance = token == NATIVE
            ? escrowedBalances[msg.sender]
            : tokenEscrowedBalances[msg.sender][token];
        if (balance < amount) revert InsufficientEscrow();

        WithdrawalRequest memory req = WithdrawalRequest({
            amount: amount,
            unlockTime: block.timestamp + WITHDRAWAL_COOLDOWN
        });

        if (token == NATIVE) {
            nativeWithdrawalRequests[msg.sender] = req;
        } else {
            tokenWithdrawalRequests[msg.sender][token] = req;
        }

        emit WithdrawalRequested(msg.sender, token, amount, req.unlockTime);
    }

    /**
     * @notice Cancel a pending withdrawal request, keeping the funds escrowed.
     * @param token The escrowed asset (address(0) for native currency).
     */
    function cancelWithdrawalRequest(address token) external {
        WithdrawalRequest storage req = token == NATIVE
            ? nativeWithdrawalRequests[msg.sender]
            : tokenWithdrawalRequests[msg.sender][token];

        if (req.amount == 0) revert NoPendingWithdrawal();
        uint256 amount = req.amount;
        if (token == NATIVE) {
            delete nativeWithdrawalRequests[msg.sender];
        } else {
            delete tokenWithdrawalRequests[msg.sender][token];
        }
        emit WithdrawalCancelled(msg.sender, token, amount);
    }

    /**
     * @notice Complete a previously-requested withdrawal once the cooldown has
     *         elapsed. If the escrow was partially slashed while the request was
     *         pending, the withdrawal is clamped to the remaining balance.
     * @param token The escrowed asset (address(0) for native currency).
     */
    function withdrawFromEscrow(address token) external nonReentrant {
        WithdrawalRequest memory req = token == NATIVE
            ? nativeWithdrawalRequests[msg.sender]
            : tokenWithdrawalRequests[msg.sender][token];

        if (req.amount == 0) revert NoPendingWithdrawal();
        if (block.timestamp < req.unlockTime) revert WithdrawalOnCooldown();

        // Clear the request before moving funds (checks-effects-interactions).
        if (token == NATIVE) {
            delete nativeWithdrawalRequests[msg.sender];
        } else {
            delete tokenWithdrawalRequests[msg.sender][token];
        }

        if (token == NATIVE) {
            uint256 available = escrowedBalances[msg.sender];
            uint256 amount = req.amount < available ? req.amount : available;
            if (amount == 0) revert InsufficientEscrow();
            escrowedBalances[msg.sender] = available - amount;
            emit EscrowWithdrawn(msg.sender, NATIVE, amount, escrowedBalances[msg.sender]);
            (bool ok, ) = payable(msg.sender).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            uint256 available = tokenEscrowedBalances[msg.sender][token];
            uint256 amount = req.amount < available ? req.amount : available;
            if (amount == 0) revert InsufficientEscrow();
            tokenEscrowedBalances[msg.sender][token] = available - amount;
            emit EscrowWithdrawn(msg.sender, token, amount, tokenEscrowedBalances[msg.sender][token]);
            IERC20(token).safeTransfer(msg.sender, amount);
        }
    }

    // ---------------------------------------------------------------------
    // Module 2: Logical Nonce Tracking + settlement
    // ---------------------------------------------------------------------

    /**
     * @notice Settle an offline-signed payment out of the sender's escrow. The
     *         payment's `logicalNonce` must equal the sender's expected slot; the
     *         slot is advanced on success, enforcing strict, gap-free ordering of
     *         offline transactions independent of the EVM account nonce.
     * @param payment The signed payment authorization.
     * @param signature The sender's EIP-712 signature over `payment`.
     */
    function executeOfflinePayment(OfflinePayment calldata payment, bytes calldata signature)
        external
        nonReentrant
    {
        if (payment.to == address(0) || payment.from == address(0)) revert InvalidRecipient();
        if (payment.amount == 0) revert InvalidAmount();
        if (block.timestamp > payment.deadline) revert PaymentExpired();

        // Verify the signature binds to `from`.
        bytes32 digest = _hashOfflinePayment(payment);
        if (digest.recover(signature) != payment.from) revert InvalidSignature();

        // Enforce the logical sequence slot.
        if (payment.logicalNonce != nextLogicalNonce[payment.from]) revert BadLogicalNonce();
        nextLogicalNonce[payment.from] = payment.logicalNonce + 1;

        // Settle strictly from the sender's escrowed collateral.
        if (payment.token == NATIVE) {
            uint256 bal = escrowedBalances[payment.from];
            if (bal < payment.amount) revert InsufficientEscrow();
            escrowedBalances[payment.from] = bal - payment.amount;
            (bool ok, ) = payable(payment.to).call{value: payment.amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            uint256 bal = tokenEscrowedBalances[payment.from][payment.token];
            if (bal < payment.amount) revert InsufficientEscrow();
            tokenEscrowedBalances[payment.from][payment.token] = bal - payment.amount;
            IERC20(payment.token).safeTransfer(payment.to, payment.amount);
        }

        emit OfflinePaymentSettled(payment.from, payment.to, payment.token, payment.amount, payment.logicalNonce);
    }

    // ---------------------------------------------------------------------
    // Module 3: Slashing & Double-Spend Proof
    // ---------------------------------------------------------------------

    /**
     * @notice Submit two conflicting offline payments as proof of a double-spend
     *         and slash the offender's escrowed collateral to compensate the
     *         victim. A valid proof requires that both payloads:
     *           - carry valid signatures from the *same* sender, and
     *           - share the *same* `logicalNonce` (the same sequence slot), and
     *           - hash differently (i.e. authorize two different payouts).
     *
     *         Because a well-behaved signer only ever signs one payload per slot,
     *         only a genuine double-signer can be slashed. The victim compensated
     *         is `payment1.to`, paid in the asset of `payment1.token` from the
     *         offender's escrow of that asset (capped at the available balance).
     *
     * @param payment1 The first conflicting payment (its recipient is the victim).
     * @param signature1 The offender's signature over `payment1`.
     * @param payment2 The second conflicting payment for the same slot.
     * @param signature2 The offender's signature over `payment2`.
     */
    function submitDoubleSpendProof(
        OfflinePayment calldata payment1,
        bytes calldata signature1,
        OfflinePayment calldata payment2,
        bytes calldata signature2
    ) external nonReentrant {
        bytes32 digest1 = _hashOfflinePayment(payment1);
        bytes32 digest2 = _hashOfflinePayment(payment2);

        // (a) Different payouts: identical digests are the same authorization,
        //     not a double-spend.
        if (digest1 == digest2) revert NotADoubleSpend();

        // (b) Same signer for both signatures.
        address offender = digest1.recover(signature1);
        if (offender == address(0)) revert InvalidSignature();
        if (digest2.recover(signature2) != offender) revert InvalidSignature();

        // (c) Both payloads must genuinely originate from the offender and occupy
        //     the same logical sequence slot.
        if (payment1.from != offender || payment2.from != offender) revert InvalidSignature();
        if (payment1.logicalNonce != payment2.logicalNonce) revert NotADoubleSpend();

        uint256 logicalNonce = payment1.logicalNonce;
        if (slashedNonce[offender][logicalNonce]) revert AlreadySlashed();

        address victim = payment1.to;
        if (victim == address(0)) revert InvalidRecipient();

        // Effects: mark the slot slashed before any external transfer.
        slashedNonce[offender][logicalNonce] = true;

        address token = payment1.token;
        uint256 slashAmount;
        if (token == NATIVE) {
            slashAmount = escrowedBalances[offender];
            if (slashAmount == 0) revert NothingToSlash();
            escrowedBalances[offender] = 0;
        } else {
            slashAmount = tokenEscrowedBalances[offender][token];
            if (slashAmount == 0) revert NothingToSlash();
            tokenEscrowedBalances[offender][token] = 0;
        }

        emit DoubleSpendSlashed(offender, victim, token, logicalNonce, slashAmount);

        // Interactions: pay the slashed collateral directly to the victim.
        if (token == NATIVE) {
            (bool ok, ) = payable(victim).call{value: slashAmount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(victim, slashAmount);
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Current native escrow balance for `user`.
    function getEscrowBalance(address user) external view returns (uint256) {
        return escrowedBalances[user];
    }

    /// @notice Current ERC-20 escrow balance for `user` and `token`.
    function getTokenEscrowBalance(address user, address token) external view returns (uint256) {
        return tokenEscrowedBalances[user][token];
    }

    /// @notice Next expected logical nonce for `user`.
    function getNextLogicalNonce(address user) external view returns (uint256) {
        return nextLogicalNonce[user];
    }

    /// @notice EIP-712 domain separator, exposed for off-chain signing/testing.
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Compute the EIP-712 digest for an {OfflinePayment} (testing aid).
    function hashOfflinePayment(OfflinePayment calldata payment) external view returns (bytes32) {
        return _hashOfflinePayment(payment);
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _hashOfflinePayment(OfflinePayment calldata payment) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                OFFLINE_PAYMENT_TYPEHASH,
                payment.from,
                payment.to,
                payment.token,
                payment.amount,
                payment.logicalNonce,
                payment.deadline
            )
        );
        return _hashTypedDataV4(structHash);
    }

    /// @notice Accept native deposits routed through {depositToEscrow} only.
    receive() external payable {
        revert("Use depositToEscrow");
    }
}
