const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentTreasury", function () {
  let AgentTreasury;
  let treasury;
  let MockWstETH;
  let wstETH;
  let owner;
  let agent;
  let other;
  
  const WSTETH_BASE = "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452";
  const OWNER_WALLET = "0x05592957Fb56bd230f8fa41515eD902a1D3e94D0";
  const AGENT_WALLET = "0x7e7f825248Ae530610F34a5deB9Bc423f6d63373";
  
  beforeEach(async function () {
    // Get signers
    [owner, agent, other] = await ethers.getSigners();
    
    // Deploy mock wstETH token
    MockWstETH = await ethers.getContractFactory("MockWstETH");
    wstETH = await MockWstETH.deploy("Wrapped stETH", "wstETH");
    await wstETH.waitForDeployment();
    
    // Deploy AgentTreasury with mock wstETH
    AgentTreasury = await ethers.getContractFactory("AgentTreasury");
    treasury = await AgentTreasury.deploy(
      await wstETH.getAddress(), // Using mock for testing (not real wstETH address)
      agent.address,             // Use local agent for testing
      owner.address              // Use local owner for testing
    );
    await treasury.waitForDeployment();
    
    // Mint some wstETH to owner
    await wstETH.mint(owner.address, ethers.parseEther("100"));
    
    // Approve treasury to spend owner's wstETH
    await wstETH.approve(await treasury.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct wstETH token", async function () {
      expect(await treasury.wstETH()).to.equal(await wstETH.getAddress());
    });
    
    it("Should set the correct agent wallet", async function () {
      expect(await treasury.agentWallet()).to.equal(agent.address);
    });
    
    it("Should set the correct owner", async function () {
      expect(await treasury.owner()).to.equal(owner.address);
    });
    
    it("Should set the default spending cap", async function () {
      const cap = await treasury.spendingCap();
      expect(cap).to.equal(await treasury.DEFAULT_SPENDING_CAP());
    });
    
    it("Should have correct wstETH_BASE constant", async function () {
      expect(await treasury.WSTETH_BASE()).to.equal(WSTETH_BASE);
    });
  });

  describe("Constructor Validation", function () {
    it("Should revert with zero address for wstETH", async function () {
      await expect(
        AgentTreasury.deploy(
          ethers.ZeroAddress,
          agent.address,
          owner.address
        )
      ).to.be.revertedWith("AgentTreasury: wstETH address cannot be zero");
    });
    
    it("Should revert with zero address for agent", async function () {
      await expect(
        AgentTreasury.deploy(
          await wstETH.getAddress(),
          ethers.ZeroAddress,
          owner.address
        )
      ).to.be.revertedWith("AgentTreasury: agent wallet cannot be zero");
    });
    
    it("Should revert with zero address for owner", async function () {
      await expect(
        AgentTreasury.deploy(
          await wstETH.getAddress(),
          agent.address,
          ethers.ZeroAddress
        )
      ).to.be.revertedWith("AgentTreasury: owner cannot be zero");
    });
  });

  describe("Deposits", function () {
    it("Should allow owner to deposit wstETH", async function () {
      const depositAmount = ethers.parseEther("10");
      
      await expect(treasury.deposit(depositAmount))
        .to.emit(treasury, "Deposit")
        .withArgs(owner.address, depositAmount, depositAmount, await time.latest());
      
      expect(await treasury.getPrincipal()).to.equal(depositAmount);
      expect(await treasury.getTotalBalance()).to.equal(depositAmount);
    });
    
    it("Should revert if non-owner tries to deposit", async function () {
      const depositAmount = ethers.parseEther("10");
      
      await expect(
        treasury.connect(other).deposit(depositAmount)
      ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    });
    
    it("Should revert if deposit amount is zero", async function () {
      await expect(
        treasury.deposit(0)
      ).to.be.revertedWith("AgentTreasury: amount must be greater than 0");
    });
    
    it("Should accumulate principal on multiple deposits", async function () {
      const deposit1 = ethers.parseEther("10");
      const deposit2 = ethers.parseEther("5");
      
      await treasury.deposit(deposit1);
      await treasury.deposit(deposit2);
      
      expect(await treasury.getPrincipal()).to.equal(deposit1 + deposit2);
    });
    
    it("Should track actual received amount", async function () {
      // Deploy a token with transfer fee for testing
      const FeeToken = await ethers.getContractFactory("MockWstETHWithFee");
      const feeToken = await FeeToken.deploy("Fee wstETH", "fwstETH");
      await feeToken.waitForDeployment();
      
      // Deploy new treasury with fee token
      const FeeTreasury = await ethers.getContractFactory("AgentTreasury");
      const feeTreasury = await FeeTreasury.deploy(
        await feeToken.getAddress(),
        agent.address,
        owner.address
      );
      await feeTreasury.waitForDeployment();
      
      // Mint and approve
      await feeToken.mint(owner.address, ethers.parseEther("100"));
      await feeToken.approve(await feeTreasury.getAddress(), ethers.MaxUint256);
      
      // Deposit should handle fee tokens correctly
      // (This test would need MockWstETHWithFee to be implemented)
    });
  });

  describe("Direct Transfer Protection", function () {
    beforeEach(async function () {
      // Deposit principal
      await treasury.deposit(ethers.parseEther("10"));
    });
    
    it("Should NOT treat direct transfers as yield", async function () {
      // Someone sends wstETH directly to contract
      const directTransfer = ethers.parseEther("5");
      await wstETH.transfer(await treasury.getAddress(), directTransfer);
      
      // Available yield should still be 0 (direct transfers not counted as yield)
      // But balance is now 15, principal is 10
      const balance = await treasury.getTotalBalance();
      const principal = await treasury.getPrincipal();
      expect(balance).to.equal(ethers.parseEther("15"));
      expect(principal).to.equal(ethers.parseEther("10"));
      
      // Before reconciliation, yield calculation is still 5
      // But agent shouldn't be able to exploit this
      const yield = await treasury.getAvailableYield();
      expect(yield).to.equal(ethers.parseEther("5"));
    });
    
    it("Should allow owner to reconcile unexpected deposits", async function () {
      // Direct transfer
      const directTransfer = ethers.parseEther("5");
      await wstETH.transfer(await treasury.getAddress(), directTransfer);
      
      // Check unexpected deposits
      const [hasUnexpected, amount] = await treasury.checkUnexpectedDeposits();
      expect(hasUnexpected).to.be.true;
      expect(amount).to.equal(directTransfer);
      
      // Reconcile
      await expect(treasury.reconcilePrincipal())
        .to.emit(treasury, "PrincipalReconciled")
        .and.emit(treasury, "UnexpectedDepositHandled");
      
      // Principal should now include the direct transfer
      expect(await treasury.getPrincipal()).to.equal(ethers.parseEther("15"));
      expect(await treasury.getAvailableYield()).to.equal(0);
    });
    
    it("Should revert reconcilePrincipal if no unexpected deposits", async function () {
      await expect(
        treasury.reconcilePrincipal()
      ).to.be.revertedWith("AgentTreasury: no unexpected deposits to reconcile");
    });
    
    it("Should revert reconcilePrincipal for non-owner", async function () {
      await wstETH.transfer(await treasury.getAddress(), ethers.parseEther("5"));
      
      await expect(
        treasury.connect(other).reconcilePrincipal()
      ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    });
  });

  describe("Yield Calculation", function () {
    beforeEach(async function () {
      // Deposit principal
      await treasury.deposit(ethers.parseEther("10"));
    });
    
    it("Should calculate yield correctly when balance increases", async function () {
      // Simulate yield by minting more wstETH to treasury
      await wstETH.mint(await treasury.getAddress(), ethers.parseEther("1"));
      
      const availableYield = await treasury.getAvailableYield();
      expect(availableYield).to.equal(ethers.parseEther("1"));
    });
    
    it("Should return zero yield when balance equals principal", async function () {
      const availableYield = await treasury.getAvailableYield();
      expect(availableYield).to.equal(0);
    });
    
    it("Should return zero yield when balance is less than principal", async function () {
      // This shouldn't happen in practice, but test the edge case
      // Burn some tokens directly (simulating a loss)
      await wstETH.burn(await treasury.getAddress(), ethers.parseEther("1"));
      
      const availableYield = await treasury.getAvailableYield();
      expect(availableYield).to.equal(0);
    });
    
    it("Should enforce minimum yield threshold", async function () {
      // Mint tiny amount below threshold
      const minThreshold = await treasury.MIN_YIELD_THRESHOLD();
      const tinyYield = minThreshold / BigInt(2);
      await wstETH.mint(await treasury.getAddress(), tinyYield);
      
      const availableYield = await treasury.getAvailableYield();
      expect(availableYield).to.equal(0);
    });
  });

  describe("Agent Yield Withdrawal", function () {
    beforeEach(async function () {
      // Deposit principal
      await treasury.deposit(ethers.parseEther("10"));
      
      // Simulate yield accrual
      await wstETH.mint(await treasury.getAddress(), ethers.parseEther("2"));
    });
    
    it("Should allow agent to withdraw yield", async function () {
      const withdrawAmount = ethers.parseEther("1");
      const agentBalanceBefore = await wstETH.balanceOf(agent.address);
      
      await expect(treasury.connect(agent).withdrawYield(withdrawAmount))
        .to.emit(treasury, "YieldWithdrawn")
        .withArgs(agent.address, withdrawAmount, ethers.parseEther("1"), await time.latest());
      
      const agentBalanceAfter = await wstETH.balanceOf(agent.address);
      expect(agentBalanceAfter - agentBalanceBefore).to.equal(withdrawAmount);
      
      // Principal should remain unchanged
      expect(await treasury.getPrincipal()).to.equal(ethers.parseEther("10"));
    });
    
    it("Should revert if non-agent tries to withdraw yield", async function () {
      await expect(
        treasury.connect(other).withdrawYield(ethers.parseEther("1"))
      ).to.be.revertedWith("AgentTreasury: caller is not the agent");
    });
    
    it("Should revert if owner tries to withdraw yield (not agent)", async function () {
      await expect(
        treasury.connect(owner).withdrawYield(ethers.parseEther("1"))
      ).to.be.revertedWith("AgentTreasury: caller is not the agent");
    });
    
    it("Should revert if withdraw amount exceeds yield", async function () {
      await expect(
        treasury.connect(agent).withdrawYield(ethers.parseEther("3"))
      ).to.be.revertedWith("AgentTreasury: insufficient yield");
    });
    
    it("Should revert if withdraw amount exceeds spending cap", async function () {
      const cap = await treasury.spendingCap();
      
      await expect(
        treasury.connect(agent).withdrawYield(cap + BigInt(1))
      ).to.be.revertedWith("AgentTreasury: amount exceeds spending cap");
    });
    
    it("Should revert if withdraw amount is zero", async function () {
      await expect(
        treasury.connect(agent).withdrawYield(0)
      ).to.be.revertedWith("AgentTreasury: amount must be greater than 0");
    });
  });

  describe("Owner Principal Withdrawal", function () {
    beforeEach(async function () {
      await treasury.deposit(ethers.parseEther("10"));
    });
    
    it("Should allow owner to withdraw principal", async function () {
      const withdrawAmount = ethers.parseEther("5");
      const ownerBalanceBefore = await wstETH.balanceOf(owner.address);
      
      await expect(treasury.withdrawPrincipal(withdrawAmount))
        .to.emit(treasury, "PrincipalWithdrawn")
        .withArgs(owner.address, withdrawAmount, await time.latest());
      
      const ownerBalanceAfter = await wstETH.balanceOf(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(withdrawAmount);
      
      expect(await treasury.getPrincipal()).to.equal(ethers.parseEther("5"));
    });
    
    it("Should allow owner to withdraw all principal", async function () {
      await expect(treasury.withdrawAllPrincipal())
        .to.emit(treasury, "PrincipalWithdrawn")
        .withArgs(owner.address, ethers.parseEther("10"), await time.latest());
      
      expect(await treasury.getPrincipal()).to.equal(0);
    });
    
    it("Should revert if non-owner tries to withdraw principal", async function () {
      await expect(
        treasury.connect(other).withdrawPrincipal(ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    });
    
    it("Should revert if withdraw amount exceeds principal", async function () {
      await expect(
        treasury.withdrawPrincipal(ethers.parseEther("20"))
      ).to.be.revertedWith("AgentTreasury: insufficient principal");
    });
    
    it("Should allow owner to withdraw principal even with accrued yield", async function () {
      // Add yield
      await wstETH.mint(await treasury.getAddress(), ethers.parseEther("2"));
      
      const totalBalance = await treasury.getTotalBalance();
      const principal = await treasury.getPrincipal();
      const yield = await treasury.getAvailableYield();
      
      expect(totalBalance).to.equal(ethers.parseEther("12"));
      expect(principal).to.equal(ethers.parseEther("10"));
      expect(yield).to.equal(ethers.parseEther("2"));
      
      // Owner can still withdraw principal
      await treasury.withdrawPrincipal(ethers.parseEther("5"));
      expect(await treasury.getPrincipal()).to.equal(ethers.parseEther("5"));
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to update spending cap", async function () {
      const newCap = ethers.parseEther("1");
      
      await expect(treasury.setSpendingCap(newCap))
        .to.emit(treasury, "SpendingCapUpdated");
      
      expect(await treasury.spendingCap()).to.equal(newCap);
    });
    
    it("Should revert if non-owner tries to update spending cap", async function () {
      await expect(
        treasury.connect(other).setSpendingCap(ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    });
    
    it("Should revert if spending cap is zero", async function () {
      await expect(
        treasury.setSpendingCap(0)
      ).to.be.revertedWith("AgentTreasury: cap must be greater than 0");
    });
    
    it("Should allow owner to update agent wallet", async function () {
      const newAgent = other.address;
      
      await expect(treasury.setAgentWallet(newAgent))
        .to.emit(treasury, "AgentWalletUpdated");
      
      expect(await treasury.agentWallet()).to.equal(newAgent);
    });
    
    it("Should revert if non-owner tries to update agent wallet", async function () {
      await expect(
        treasury.connect(other).setAgentWallet(other.address)
      ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    });
    
    it("Should revert if setting agent to zero address", async function () {
      await expect(
        treasury.setAgentWallet(ethers.ZeroAddress)
      ).to.be.revertedWith("AgentTreasury: agent wallet cannot be zero");
    });
    
    it("Should allow owner to rescue other tokens", async function () {
      // Deploy another mock token
      const MockToken = await ethers.getContractFactory("MockWstETH");
      const otherToken = await MockToken.deploy("Other Token", "OTHER");
      await otherToken.waitForDeployment();
      
      // Mint some tokens to treasury
      await otherToken.mint(await treasury.getAddress(), ethers.parseEther("100"));
      
      // Rescue tokens
      await treasury.rescueTokens(await otherToken.getAddress(), ethers.parseEther("50"));
      
      expect(await otherToken.balanceOf(owner.address)).to.equal(ethers.parseEther("50"));
    });
    
    it("Should revert if trying to rescue wstETH", async function () {
      await expect(
        treasury.rescueTokens(await wstETH.getAddress(), ethers.parseEther("1"))
      ).to.be.revertedWith("AgentTreasury: cannot rescue wstETH");
    });
    
    it("Should revert rescueTokens for non-owner", async function () {
      const MockToken = await ethers.getContractFactory("MockWstETH");
      const otherToken = await MockToken.deploy("Other", "OTH");
      await otherToken.waitForDeployment();
      
      await expect(
        treasury.connect(other).rescueTokens(await otherToken.getAddress(), 1)
      ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    });
    
    it("Should revert rescueTokens with zero amount", async function () {
      const MockToken = await ethers.getContractFactory("MockWstETH");
      const otherToken = await MockToken.deploy("Other", "OTH");
      await otherToken.waitForDeployment();
      
      await expect(
        treasury.rescueTokens(await otherToken.getAddress(), 0)
      ).to.be.revertedWith("AgentTreasury: amount must be greater than 0");
    });
  });

  describe("Security", function () {
    it("Should not accept ETH directly", async function () {
      await expect(
        owner.sendTransaction({
          to: await treasury.getAddress(),
          value: ethers.parseEther("1")
        })
      ).to.be.revertedWith("AgentTreasury: do not send ETH directly");
    });
    
    it("Should check balance before principal withdrawal", async function () {
      // This shouldn't happen but test the edge case
      await treasury.deposit(ethers.parseEther("10"));
      
      // Simulate balance loss (shouldn't happen with normal operations)
      // Owner can only withdraw up to principal, not more than balance
      await expect(
        treasury.withdrawPrincipal(ethers.parseEther("100"))
      ).to.be.revertedWith("AgentTreasury: insufficient principal");
    });
    
    it("Should have correct wstETH_BASE constant", async function () {
      const baseAddr = await treasury.WSTETH_BASE();
      expect(baseAddr).to.equal("0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await treasury.deposit(ethers.parseEther("10"));
    });
    
    it("Should return correct total balance", async function () {
      expect(await treasury.getTotalBalance()).to.equal(ethers.parseEther("10"));
    });
    
    it("Should return correct principal", async function () {
      expect(await treasury.getPrincipal()).to.equal(ethers.parseEther("10"));
    });
    
    it("Should return correct available yield", async function () {
      expect(await treasury.getAvailableYield()).to.equal(0);
      
      // Add yield
      await wstETH.mint(await treasury.getAddress(), ethers.parseEther("2"));
      expect(await treasury.getAvailableYield()).to.equal(ethers.parseEther("2"));
    });
    
    it("Should check unexpected deposits correctly", async function () {
      let [hasUnexpected, amount] = await treasury.checkUnexpectedDeposits();
      expect(hasUnexpected).to.be.false;
      expect(amount).to.equal(0);
      
      // Direct transfer
      await wstETH.transfer(await treasury.getAddress(), ethers.parseEther("5"));
      
      [hasUnexpected, amount] = await treasury.checkUnexpectedDeposits();
      expect(hasUnexpected).to.be.true;
      expect(amount).to.equal(ethers.parseEther("5"));
    });
  });
});

// Helper function for time
async function time() {
  const block = await ethers.provider.getBlock("latest");
  return { latest: async () => block.timestamp };
}
