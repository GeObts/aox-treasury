const { ethers } = require("hardhat");

const WSTETH_BASE = "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452";
const OWNER = "0x05592957Fb56bd230f8fa41515eD902a1D3e94D0";
const AGENT = "0x7e7f825248Ae530610F34a5deB9Bc423f6d63373";

async function main() {
  console.log("\n========================================");
  console.log("AgentTreasuryV2 Deployment - Base Mainnet");
  console.log("========================================");
  console.log("Deployer:", (await ethers.getSigners())[0].address);
  console.log("Network:", network.name);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId);
  console.log("========================================\n");

  console.log("Owner (CEO):", OWNER);
  console.log("Agent (Banker):", AGENT);
  console.log("wstETH:", WSTETH_BASE);
  console.log("");

  // Deploy
  console.log("Deploying AgentTreasuryV2...");
  const AgentTreasuryV2 = await ethers.getContractFactory("AgentTreasuryV2");
  const treasury = await AgentTreasuryV2.deploy(WSTETH_BASE, AGENT, OWNER);
  
  console.log("Transaction:", treasury.deploymentTransaction().hash);
  console.log("Waiting for confirmation...");
  
  await treasury.waitForDeployment();
  const deployedAddress = await treasury.getAddress();
  
  console.log("\n========================================");
  console.log("Deployment Complete!");
  console.log("========================================");
  console.log("AgentTreasuryV2:", deployedAddress);
  console.log("Transaction:", treasury.deploymentTransaction().hash);
  console.log("========================================\n");
  
  // Save deployment
  const deploymentInfo = {
    network: "base",
    chainId: 8453,
    contractAddress: deployedAddress,
    wstETH: WSTETH_BASE,
    owner: OWNER,
    agent: AGENT,
    deploymentTime: new Date().toISOString(),
    transactionHash: treasury.deploymentTransaction().hash,
    explorerUrl: `https://basescan.org/address/${deployedAddress}`
  };
  
  const fs = require("fs");
  fs.writeFileSync("deployment-v2.json", JSON.stringify(deploymentInfo, null, 2));
  console.log("Saved to deployment-v2.json");
  console.log("\nExplorer:", deploymentInfo.explorerUrl);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDeployment failed:", error.message);
    process.exit(1);
  });
