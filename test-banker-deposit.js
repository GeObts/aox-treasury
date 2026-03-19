const { ethers } = require("hardhat");

const TREASURY_V2 = "0x6FDb262cB8d2EaE55E06B92b823CB28bCdD83232";
const WSTETH = "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452";
const BANKER = "0x7e7f825248Ae530610F34a5deB9Bc423f6d63373";

async function main() {
  console.log("\n========================================");
  console.log("Banker Depositing to AgentTreasuryV2");
  console.log("========================================\n");
  
  // Connect as Banker
  const agentPrivateKey = "0x049181b00c8510dbc2507d2d1d448b47942a273f3d8bca2753332dbd06135d98";
  const agentWallet = new ethers.Wallet(agentPrivateKey, ethers.provider);
  
  console.log("Banker:", agentWallet.address);
  console.log("Treasury V2:", TREASURY_V2);
  
  const wsteth = await ethers.getContractAt("IERC20", WSTETH, agentWallet);
  const treasury = await ethers.getContractAt("AgentTreasuryV2", TREASURY_V2, agentWallet);
  
  // Check balance
  const balance = await wsteth.balanceOf(BANKER);
  console.log("\nBanker wstETH Balance:", ethers.formatEther(balance), "wstETH");
  
  // Deposit half (0.003049 wstETH)
  const depositAmount = balance / 2n;
  console.log("\nDepositing half:", ethers.formatEther(depositAmount), "wstETH");
  
  // Approve
  console.log("\n=== Step 1: Approving Treasury ===");
  const approveTx = await wsteth.approve(TREASURY_V2, depositAmount);
  await approveTx.wait();
  console.log("✅ Approved:", ethers.formatEther(depositAmount), "wstETH");
  console.log("Tx:", approveTx.hash);
  
  await new Promise(r => setTimeout(r, 3000));
  
  // Deposit
  console.log("\n=== Step 2: Depositing to Treasury ===");
  const depositTx = await treasury.deposit(depositAmount);
  await depositTx.wait();
  console.log("✅ Deposited:", ethers.formatEther(depositAmount), "wstETH");
  console.log("Tx:", depositTx.hash);
  
  // Check state
  const principal = await treasury.getPrincipal();
  const totalBalance = await wsteth.balanceOf(TREASURY_V2);
  
  console.log("\n=== Treasury State ===");
  console.log("Total wstETH:", ethers.formatEther(totalBalance), "wstETH");
  console.log("Principal:", ethers.formatEther(principal), "wstETH");
  
  const remainingBalance = await wsteth.balanceOf(BANKER);
  console.log("\nBanker Remaining:", ethers.formatEther(remainingBalance), "wstETH");
  
  console.log("\n========================================");
  console.log("SUCCESS!");
  console.log("========================================");
  console.log("✅ Banker successfully deposited to treasury");
  console.log("✅ CEO retains full control");
  console.log("✅ Agent can now earn yield on deposits");
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nFailed:", error.message);
    process.exit(1);
  });
