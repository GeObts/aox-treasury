const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("========================================");
  console.log("AgentTreasury Deployment - Base Sepolia");
  console.log("========================================");
  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId);
  console.log("========================================\n");

  const OWNER_WALLET = "0x05592957Fb56bd230f8fa41515eD902a1D3e94D0";
  const AGENT_WALLET = "0x7e7f825248Ae530610F34a5deB9Bc423f6d63373";
  
  console.log("Owner (AOX CEO):", OWNER_WALLET);
  console.log("Agent (Banker):", AGENT_WALLET);
  console.log("");

  // Deploy mock wstETH token
  console.log("Deploying MockWstETH...");
  const MockWstETH = await ethers.getContractFactory("MockWstETH");
  const mockWstETH = await MockWstETH.deploy("Mock Wrapped stETH", "mwstETH");
  await mockWstETH.waitForDeployment();
  const mockWstETHAddress = await mockWstETH.getAddress();
  console.log("MockWstETH deployed to:", mockWstETHAddress);
  
  // Deploy AgentTreasuryTestnet
  console.log("\nDeploying AgentTreasuryTestnet...");
  const AgentTreasury = await ethers.getContractFactory("AgentTreasuryTestnet");
  const treasury = await AgentTreasury.deploy(
    mockWstETHAddress,
    AGENT_WALLET,
    OWNER_WALLET
  );
  await treasury.waitForDeployment();
  
  const deployedAddress = await treasury.getAddress();
  
  console.log("\n========================================");
  console.log("Deployment Complete!");
  console.log("========================================");
  console.log("AgentTreasuryTestnet:", deployedAddress);
  console.log("Mock wstETH:", mockWstETHAddress);
  console.log("Owner:", OWNER_WALLET);
  console.log("Agent:", AGENT_WALLET);
  console.log("========================================\n");
  
  // Verify deployment
  console.log("Verifying deployment...");
  const contractWstETH = await treasury.wstETH();
  const contractAgent = await treasury.agentWallet();
  const contractOwner = await treasury.owner();
  const spendingCap = await treasury.spendingCap();
  
  console.log("\nContract State:");
  console.log("  wstETH:", contractWstETH);
  console.log("  agentWallet:", contractAgent);
  console.log("  owner:", contractOwner);
  console.log("  spendingCap:", ethers.formatEther(spendingCap), "wstETH");
  
  // Mint some tokens for testing
  console.log("\nMinting test tokens to owner...");
  await mockWstETH.mint(OWNER_WALLET, ethers.parseEther("100"));
  console.log("Minted 100 mwstETH to", OWNER_WALLET);
  
  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: Number(await ethers.provider.getNetwork().then(n => n.chainId)),
    contractAddress: deployedAddress,
    mockWstETH: mockWstETHAddress,
    owner: OWNER_WALLET,
    agent: AGENT_WALLET,
    deploymentTime: new Date().toISOString(),
    deployer: deployer.address
  };
  
  const fs = require("fs");
  fs.writeFileSync(
    "deployment-sepolia.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\nDeployment info saved to deployment-sepolia.json");
  
  console.log("\n========================================");
  console.log("Next Steps:");
  console.log("========================================");
  console.log("1. Approve treasury to spend your tokens:");
  console.log(`   await mockWstETH.approve("${deployedAddress}", ethers.MaxUint256)`);
  console.log("");
  console.log("2. Deposit principal:");
  console.log(`   await treasury.deposit(ethers.parseEther("10"))`);
  console.log("");
  console.log("3. Check available yield:");
  console.log(`   await treasury.getAvailableYield()`);
  console.log("");
  console.log("4. Agent withdraws yield:");
  console.log(`   await treasury.connect(agentWallet).withdrawYield(ethers.parseEther("0.001"))`);
  console.log("========================================\n");
  
  return { treasury, deployedAddress, mockWstETH };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
