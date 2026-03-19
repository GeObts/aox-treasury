const { ethers } = require("hardhat");

const WSTETH_BASE = "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452";
const OWNER = "0x05592957Fb56bd230f8fa41515eD902a1D3e94D0";
const AGENT = "0x7e7f825248Ae530610F34a5deB9Bc423f6d63373";

async function main() {
  console.log("\n========================================");
  console.log("AgentTreasury Deployment - Base Mainnet");
  console.log("========================================");
  
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId);
  console.log("========================================\n");

  console.log("Owner (AOX CEO):", OWNER);
  console.log("Agent (Banker):", AGENT);
  console.log("wstETH Token:", WSTETH_BASE);
  console.log("");

  // Check deployer balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer ETH Balance:", ethers.formatEther(balance), "ETH");
  
  if (balance < ethers.parseEther("0.005")) {
    throw new Error("Insufficient ETH for deployment");
  }

  // Deploy AgentTreasury
  console.log("\nDeploying AgentTreasury...");
  const AgentTreasury = await ethers.getContractFactory("AgentTreasury");
  const treasury = await AgentTreasury.deploy(
    WSTETH_BASE,
    AGENT,
    OWNER
  );
  
  console.log("Transaction sent:", treasury.deploymentTransaction().hash);
  console.log("Waiting for confirmation...");
  
  await treasury.waitForDeployment();
  const deployedAddress = await treasury.getAddress();
  
  console.log("\n========================================");
  console.log("Deployment Complete!");
  console.log("========================================");
  console.log("AgentTreasury:", deployedAddress);
  console.log("wstETH Token:", WSTETH_BASE);
  console.log("Owner:", OWNER);
  console.log("Agent:", AGENT);
  console.log("========================================\n");
  
  // Verify deployment
  console.log("Verifying contract state...");
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
    network: "base",
    chainId: 8453,
    contractAddress: deployedAddress,
    wstETH: WSTETH_BASE,
    owner: OWNER,
    agent: AGENT,
    deploymentTime: new Date().toISOString(),
    deployer: deployer.address,
    transactionHash: treasury.deploymentTransaction().hash,
    explorerUrl: `https://basescan.org/address/${deployedAddress}`
  };
  
  const fs = require("fs");
  fs.writeFileSync(
    "deployment-mainnet.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\nDeployment info saved to deployment-mainnet.json");
  
  console.log("\n========================================");
  console.log("Next Steps:");
  console.log("========================================");
  console.log("1. Get wstETH:");
  console.log("   - Bridge stETH from Ethereum to Base");
  console.log("   - Or swap ETH → wstETH on Uniswap");
  console.log("   - Contract:", WSTETH_BASE);
  console.log("");
  console.log("2. Approve and deposit principal:");
  console.log(`   await wstETH.approve("${deployedAddress}", amount)`);
  console.log(`   await treasury.deposit(amount)`);
  console.log("");
  console.log("3. Agent withdraws yield:");
  console.log(`   await treasury.connect(agent).withdrawYield(amount)`);
  console.log("========================================");
  console.log("\nExplorer:", deploymentInfo.explorerUrl);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDeployment failed:", error.message);
    process.exit(1);
  });
