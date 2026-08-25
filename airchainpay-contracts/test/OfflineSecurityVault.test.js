const { expect } = require("chai");
const { ethers } = require("hardhat");

// Mirrors OfflineSecurityVault.OFFLINE_PAYMENT_TYPEHASH
const OFFLINE_PAYMENT_TYPES = {
  OfflinePayment: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "logicalNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

describe("OfflineSecurityVault", function () {
  let vault, mockToken;
  let owner, alice, bob, carol;
  let vaultAddress, tokenAddress;
  let domain;
  const NATIVE = ethers.ZeroAddress;
  const COOLDOWN = 24 * 60 * 60; // WITHDRAWAL_COOLDOWN = 1 day
  let futureDeadline;
  let snapshotId;


  async function signPayment(signer, payment) {
    return signer.signTypedData(domain, OFFLINE_PAYMENT_TYPES, payment);
  }

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();

    const Vault = await ethers.getContractFactory("OfflineSecurityVault");
    const MockERC20 = await ethers.getContractFactory("MockERC20");

    vault = await Vault.deploy();
    mockToken = await MockERC20.deploy("Test Token", "TEST");
    await vault.waitForDeployment();
    await mockToken.waitForDeployment();

    vaultAddress = await vault.getAddress();
    tokenAddress = await mockToken.getAddress();

    const net = await ethers.provider.getNetwork();
    domain = {
      name: "AirChainPayOfflineVault",
      version: "1",
      chainId: net.chainId,
      verifyingContract: vaultAddress,
    };

    // Fund and approve token escrow for alice.
    await mockToken.mint(await alice.getAddress(), ethers.parseEther("100"));
    await mockToken.connect(alice).approve(vaultAddress, ethers.MaxUint256);

    const block = await ethers.provider.getBlock("latest");
    futureDeadline = block.timestamp + 3600;

    // Snapshot after setup so that any time manipulation (evm_increaseTime) in a
    // test is fully rolled back and cannot leak into other test files sharing
    // the same in-process Hardhat network clock.
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async function () {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });


  describe("Module 1: Escrow Isolation Vault", function () {
    it("accepts native deposits and tracks escrowedBalances", async function () {
      const amount = ethers.parseEther("1");
      await expect(vault.connect(alice).depositToEscrow(NATIVE, amount, { value: amount }))
        .to.emit(vault, "EscrowDeposited")
        .withArgs(await alice.getAddress(), NATIVE, amount, amount);
      expect(await vault.getEscrowBalance(await alice.getAddress())).to.equal(amount);
    });

    it("reverts native deposit when msg.value != amount", async function () {
      const amount = ethers.parseEther("1");
      await expect(
        vault.connect(alice).depositToEscrow(NATIVE, amount, { value: ethers.parseEther("0.5") })
      ).to.be.revertedWithCustomError(vault, "NativeValueMismatch");
    });

    it("accepts ERC-20 deposits and tracks tokenEscrowedBalances", async function () {
      const amount = ethers.parseEther("10");
      await expect(vault.connect(alice).depositToEscrow(tokenAddress, amount))
        .to.emit(vault, "EscrowDeposited")
        .withArgs(await alice.getAddress(), tokenAddress, amount, amount);
      expect(await vault.getTokenEscrowBalance(await alice.getAddress(), tokenAddress)).to.equal(amount);
    });

    it("reverts ERC-20 deposit when native value is attached", async function () {
      await expect(
        vault.connect(alice).depositToEscrow(tokenAddress, ethers.parseEther("1"), { value: 1 })
      ).to.be.revertedWithCustomError(vault, "UnexpectedNativeValue");
    });

    it("enforces the withdrawal cooldown", async function () {
      const amount = ethers.parseEther("1");
      await vault.connect(alice).depositToEscrow(NATIVE, amount, { value: amount });
      await vault.connect(alice).requestWithdrawal(NATIVE, amount);

      // Immediate withdrawal is blocked by the cooldown.
      await expect(vault.connect(alice).withdrawFromEscrow(NATIVE)).to.be.revertedWithCustomError(
        vault,
        "WithdrawalOnCooldown"
      );

      await ethers.provider.send("evm_increaseTime", [COOLDOWN + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(vault.connect(alice).withdrawFromEscrow(NATIVE))
        .to.emit(vault, "EscrowWithdrawn")
        .withArgs(await alice.getAddress(), NATIVE, amount, 0);
      expect(await vault.getEscrowBalance(await alice.getAddress())).to.equal(0);
    });

    it("reverts withdrawal when there is no pending request", async function () {
      await expect(vault.connect(alice).withdrawFromEscrow(NATIVE)).to.be.revertedWithCustomError(
        vault,
        "NoPendingWithdrawal"
      );
    });

    it("cancels a pending withdrawal request", async function () {
      const amount = ethers.parseEther("1");
      await vault.connect(alice).depositToEscrow(NATIVE, amount, { value: amount });
      await vault.connect(alice).requestWithdrawal(NATIVE, amount);
      await expect(vault.connect(alice).cancelWithdrawalRequest(NATIVE))
        .to.emit(vault, "WithdrawalCancelled")
        .withArgs(await alice.getAddress(), NATIVE, amount);

      await ethers.provider.send("evm_increaseTime", [COOLDOWN + 1]);
      await ethers.provider.send("evm_mine", []);
      // After cancel there is nothing to withdraw.
      await expect(vault.connect(alice).withdrawFromEscrow(NATIVE)).to.be.revertedWithCustomError(
        vault,
        "NoPendingWithdrawal"
      );
    });

    it("rejects direct native transfers (receive reverts)", async function () {
      await expect(
        alice.sendTransaction({ to: vaultAddress, value: ethers.parseEther("1") })
      ).to.be.revertedWith("Use depositToEscrow");
    });
  });

  describe("Module 2: Logical Nonce Tracking + settlement", function () {
    it("settles a native offline payment from escrow and advances the nonce", async function () {
      const deposit = ethers.parseEther("5");
      const pay = ethers.parseEther("2");
      await vault.connect(alice).depositToEscrow(NATIVE, deposit, { value: deposit });

      const payment = {
        from: await alice.getAddress(),
        to: await bob.getAddress(),
        token: NATIVE,
        amount: pay,
        logicalNonce: 0,
        deadline: futureDeadline,
      };
      const sig = await signPayment(alice, payment);

      await expect(vault.connect(owner).executeOfflinePayment(payment, sig)).to.changeEtherBalance(bob, pay);
      expect(await vault.getEscrowBalance(await alice.getAddress())).to.equal(deposit - pay);
      expect(await vault.getNextLogicalNonce(await alice.getAddress())).to.equal(1);
    });

    it("settles an ERC-20 offline payment from escrow", async function () {
      const deposit = ethers.parseEther("10");
      const pay = ethers.parseEther("3");
      await vault.connect(alice).depositToEscrow(tokenAddress, deposit);

      const payment = {
        from: await alice.getAddress(),
        to: await bob.getAddress(),
        token: tokenAddress,
        amount: pay,
        logicalNonce: 0,
        deadline: futureDeadline,
      };
      const sig = await signPayment(alice, payment);

      await expect(vault.connect(owner).executeOfflinePayment(payment, sig)).to.changeTokenBalance(
        mockToken,
        bob,
        pay
      );
      expect(await vault.getTokenEscrowBalance(await alice.getAddress(), tokenAddress)).to.equal(deposit - pay);
    });

    it("enforces strict logical nonce ordering", async function () {
      const deposit = ethers.parseEther("5");
      await vault.connect(alice).depositToEscrow(NATIVE, deposit, { value: deposit });

      // logicalNonce 1 is not the expected slot (0) yet.
      const payment = {
        from: await alice.getAddress(),
        to: await bob.getAddress(),
        token: NATIVE,
        amount: ethers.parseEther("1"),
        logicalNonce: 1,
        deadline: futureDeadline,
      };
      const sig = await signPayment(alice, payment);
      await expect(vault.connect(owner).executeOfflinePayment(payment, sig)).to.be.revertedWithCustomError(
        vault,
        "BadLogicalNonce"
      );
    });

    it("rejects an expired payment", async function () {
      const deposit = ethers.parseEther("5");
      await vault.connect(alice).depositToEscrow(NATIVE, deposit, { value: deposit });

      const block = await ethers.provider.getBlock("latest");
      const payment = {
        from: await alice.getAddress(),
        to: await bob.getAddress(),
        token: NATIVE,
        amount: ethers.parseEther("1"),
        logicalNonce: 0,
        deadline: block.timestamp - 1,
      };
      const sig = await signPayment(alice, payment);
      await expect(vault.connect(owner).executeOfflinePayment(payment, sig)).to.be.revertedWithCustomError(
        vault,
        "PaymentExpired"
      );
    });

    it("rejects a payment signed by someone other than `from`", async function () {
      const deposit = ethers.parseEther("5");
      await vault.connect(alice).depositToEscrow(NATIVE, deposit, { value: deposit });

      const payment = {
        from: await alice.getAddress(),
        to: await bob.getAddress(),
        token: NATIVE,
        amount: ethers.parseEther("1"),
        logicalNonce: 0,
        deadline: futureDeadline,
      };
      const sig = await signPayment(bob, payment); // wrong signer
      await expect(vault.connect(owner).executeOfflinePayment(payment, sig)).to.be.revertedWithCustomError(
        vault,
        "InvalidSignature"
      );
    });

    it("reverts when escrow is insufficient", async function () {
      const deposit = ethers.parseEther("1");
      await vault.connect(alice).depositToEscrow(NATIVE, deposit, { value: deposit });

      const payment = {
        from: await alice.getAddress(),
        to: await bob.getAddress(),
        token: NATIVE,
        amount: ethers.parseEther("2"), // more than escrow
        logicalNonce: 0,
        deadline: futureDeadline,
      };
      const sig = await signPayment(alice, payment);
      await expect(vault.connect(owner).executeOfflinePayment(payment, sig)).to.be.revertedWithCustomError(
        vault,
        "InsufficientEscrow"
      );
    });
  });

  describe("Module 3: Slashing & Double-Spend Proof", function () {
    it("slashes the offender and pays the victim on a valid native double-spend", async function () {
      const deposit = ethers.parseEther("5");
      await vault.connect(alice).depositToEscrow(NATIVE, deposit, { value: deposit });

      const base = {
        from: await alice.getAddress(),
        token: NATIVE,
        logicalNonce: 0,
        deadline: futureDeadline,
      };
      // Two DIFFERENT payouts for the SAME logical nonce slot.
      const payment1 = { ...base, to: await bob.getAddress(), amount: ethers.parseEther("2") };
      const payment2 = { ...base, to: await carol.getAddress(), amount: ethers.parseEther("3") };
      const sig1 = await signPayment(alice, payment1);
      const sig2 = await signPayment(alice, payment2);

      // Victim (payment1.to = bob) is compensated with the full slashed escrow.
      await expect(
        vault.connect(carol).submitDoubleSpendProof(payment1, sig1, payment2, sig2)
      )
        .to.emit(vault, "DoubleSpendSlashed")
        .withArgs(await alice.getAddress(), await bob.getAddress(), NATIVE, 0, deposit);

      expect(await vault.getEscrowBalance(await alice.getAddress())).to.equal(0);
    });

    it("slashes ERC-20 escrow and pays the victim in the token", async function () {
      const deposit = ethers.parseEther("10");
      await vault.connect(alice).depositToEscrow(tokenAddress, deposit);

      const base = {
        from: await alice.getAddress(),
        token: tokenAddress,
        logicalNonce: 0,
        deadline: futureDeadline,
      };
      const payment1 = { ...base, to: await bob.getAddress(), amount: ethers.parseEther("2") };
      const payment2 = { ...base, to: await carol.getAddress(), amount: ethers.parseEther("4") };
      const sig1 = await signPayment(alice, payment1);
      const sig2 = await signPayment(alice, payment2);

      await expect(
        vault.connect(carol).submitDoubleSpendProof(payment1, sig1, payment2, sig2)
      ).to.changeTokenBalance(mockToken, bob, deposit);
      expect(await vault.getTokenEscrowBalance(await alice.getAddress(), tokenAddress)).to.equal(0);
    });

    it("rejects identical payloads (not a double-spend)", async function () {
      const deposit = ethers.parseEther("5");
      await vault.connect(alice).depositToEscrow(NATIVE, deposit, { value: deposit });

      const payment = {
        from: await alice.getAddress(),
        to: await bob.getAddress(),
        token: NATIVE,
        amount: ethers.parseEther("2"),
        logicalNonce: 0,
        deadline: futureDeadline,
      };
      const sig = await signPayment(alice, payment);
      await expect(
        vault.connect(carol).submitDoubleSpendProof(payment, sig, payment, sig)
      ).to.be.revertedWithCustomError(vault, "NotADoubleSpend");
    });

    it("rejects conflicting payments on different logical nonces", async function () {
      const deposit = ethers.parseEther("5");
      await vault.connect(alice).depositToEscrow(NATIVE, deposit, { value: deposit });

      const from = await alice.getAddress();
      const payment1 = {
        from,
        to: await bob.getAddress(),
        token: NATIVE,
        amount: ethers.parseEther("2"),
        logicalNonce: 0,
        deadline: futureDeadline,
      };
      const payment2 = { ...payment1, to: await carol.getAddress(), logicalNonce: 1 };
      const sig1 = await signPayment(alice, payment1);
      const sig2 = await signPayment(alice, payment2);

      await expect(
        vault.connect(carol).submitDoubleSpendProof(payment1, sig1, payment2, sig2)
      ).to.be.revertedWithCustomError(vault, "NotADoubleSpend");
    });

    it("rejects proofs where the two payments are signed by different accounts", async function () {
      const deposit = ethers.parseEther("5");
      await vault.connect(alice).depositToEscrow(NATIVE, deposit, { value: deposit });

      const payment1 = {
        from: await alice.getAddress(),
        to: await bob.getAddress(),
        token: NATIVE,
        amount: ethers.parseEther("2"),
        logicalNonce: 0,
        deadline: futureDeadline,
      };
      // payment2 declares `from: alice` but is actually signed by bob.
      const payment2 = { ...payment1, to: await carol.getAddress(), amount: ethers.parseEther("3") };
      const sig1 = await signPayment(alice, payment1);
      const sig2 = await signPayment(bob, payment2);

      await expect(
        vault.connect(carol).submitDoubleSpendProof(payment1, sig1, payment2, sig2)
      ).to.be.revertedWithCustomError(vault, "InvalidSignature");
    });

    it("prevents slashing the same slot twice", async function () {
      const deposit = ethers.parseEther("5");
      await vault.connect(alice).depositToEscrow(NATIVE, deposit, { value: deposit });

      const base = {
        from: await alice.getAddress(),
        token: NATIVE,
        logicalNonce: 0,
        deadline: futureDeadline,
      };
      const payment1 = { ...base, to: await bob.getAddress(), amount: ethers.parseEther("2") };
      const payment2 = { ...base, to: await carol.getAddress(), amount: ethers.parseEther("3") };
      const sig1 = await signPayment(alice, payment1);
      const sig2 = await signPayment(alice, payment2);

      await vault.connect(carol).submitDoubleSpendProof(payment1, sig1, payment2, sig2);
      await expect(
        vault.connect(carol).submitDoubleSpendProof(payment1, sig1, payment2, sig2)
      ).to.be.revertedWithCustomError(vault, "AlreadySlashed");
    });
  });
});
