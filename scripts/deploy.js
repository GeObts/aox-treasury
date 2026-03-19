const { ethers } = require("hardhat");

/**
 * @title AgentTreasury Deployment Script
 * @notice Deploys the AgentTreasury contract for AOX
 * @dev Built for The Synthesis Ethereum Agent Hackathon 2026
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("========================================");
  console.log("AgentTreasury Deployment");
  console.log("========================================");
  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId);
  console.log("========================================\n");

  // Contract addresses
  const WSTETH_BASE = "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452"; // wstETH on Base
  const WSTETH_SEPOLIA = "0xBde8bE36b3fd38Ebf4A7bD52D2c76e4B4B5E2b3e"; // wstETH on Sepolia (if available)
  
  // AOX wallets
  const OWNER_WALLET = "0x05592957Fb56bd230f8fa41515eD902a1D3e94D0"; // AOX CEO
  const AGENT_WALLET = "0x7e7f825248Ae530610F34a5deB9Bc423f6d63373"; // Banker Agent
  
  // Determine which wstETH address to use
  const chainId = (await ethers.provider.getNetwork()).chainId;
  let wstETHAddress;
  
  if (chainId === 8453) {
    // Base mainnet
    wstETHAddress = WSTETH_BASE;
    console.log("Using wstETH on Base Mainnet:", wstETHAddress);
  } else if (chainId === 84532) {
    // Base Sepolia
    wstETHAddress = WSTETH_SEPOLIA;
    console.log("Using wstETH on Base Sepolia:", wstETHAddress);
  } else {
    // For other networks, use the Base address or prompt
    console.log("Warning: Unknown network. Using Base mainnet wstETH address.");
    wstETHAddress = WSTETH_BASE;
  }
  
  console.log("Owner (AOX CEO):", OWNER_WALLET);
  console.log("Agent (Banker):", AGENT_WALLET);
  console.log("");

  // Deploy the contract
  console.log("Deploying AgentTreasury...");
  
  const AgentTreasury = await ethers.getContractFactory("AgentTreasury");
  const treasury = await AgentTreasury.deploy(
    wstETHAddress,
    AGENT_WALLET,
    OWNER_WALLET
  );
  
  await treasury.waitForDeployment();
  
  const deployedAddress = await treasury.getAddress();
  
  console.log("\n========================================");
  console.log("Deployment Complete!");
  console.log("========================================");
  console.log("Contract Address:", deployedAddress);
  console.log("wstETH Token:", wstETHAddress);
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
  
  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: chainId,
    contractAddress: deployedAddress,
    wstETH: wstETHAddress,
    owner: OWNER_WALLET,
    agent: AGENT_WALLET,
    deploymentTime: new Date().toISOString(),
    deployer: deployer.address
  };
  
  const fs = require("fs");
  fs.writeFileSync(
    "deployment-info.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\nDeployment info saved to deployment-info.json");
  
  // Instructions for verification
  console.log("\n========================================");
  console.log("Next Steps:");
  console.log("========================================");
  console.log("1. Verify contract on Basescan:");
  console.log(`   npx hardhat verify --network base ${deployedAddress} ${wstETHAddress} ${AGENT_WALLET} ${OWNER_WALLET}`);
  console.log("");
  console.log("2. Deposit wstETH principal:");
  console.log(`   - Approve: wstETH.approve(${deployedAddress}, amount)`);
  console.log(`   - Deposit: AgentTreasury.deposit(amount)`);
  console.log("");
  console.log("3. Agent can withdraw yield:");
  console.log(`   - AgentTreasury.connect(agent).withdrawYield(amount)`);
  console.log("========================================\n");
  
  return { treasury, deployedAddress };
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
