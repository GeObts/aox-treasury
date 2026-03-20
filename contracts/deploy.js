const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load env
function loadEnv() {
    const envPath = path.join(os.homedir(), '.openclaw', '.env');
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
        if (line.includes('=') && !line.startsWith('#')) {
            const idx = line.indexOf('=');
            const key = line.substring(0, idx);
            const val = line.substring(idx + 1).replace(/^["']|["']$/g, '');
            env[key] = val;
        }
    }
    return env;
}

async function main() {
    const env = loadEnv();
    
    // Use ethers v5 syntax (default provider pattern)
    let provider;
    let wallet;
    
    try {
        // Try v6 syntax first
        const { JsonRpcProvider } = require('ethers');
        provider = new JsonRpcProvider('https://mainnet.base.org');
    } catch {
        // Fall back to v5
        provider = new ethers.providers.JsonRpcProvider('https://mainnet.base.org');
    }
    
    const bankerAddr = '0x6350B793688221c75cfB438547B9CA47f5b0D4f1';
    const key = env.AOX_BANKER_PRIVATE_KEY;
    
    if (!key) {
        console.error('Missing AOX_BANKER_PRIVATE_KEY');
        process.exit(1);
    }
    
    // Check ethers version
    const version = ethers.version || 'v5';
    console.log('Ethers version:', version);
    
    if (version.startsWith('6.')) {
        // v6 syntax
        const { Wallet } = require('ethers');
        wallet = new Wallet(key, provider);
    } else {
        // v5 syntax
        wallet = new ethers.Wallet(key, provider);
    }
    
    console.log('Deployer:', wallet.address);
    console.log('Owner will be:', bankerAddr);
    
    const bal = await provider.getBalance(wallet.address);
    console.log(`Balance: ${ethers.utils ? ethers.utils.formatEther(bal) : ethers.formatEther(bal)} ETH`);
    
    if (bal < (ethers.utils ? ethers.utils.parseEther('0.001') : ethers.parseEther('0.001'))) {
        console.error('Insufficient balance for deployment');
        process.exit(1);
    }
    
    // Load bytecode and ABI
    const bytecode = fs.readFileSync('AgentTreasury.bin', 'utf8');
    const abi = JSON.parse(fs.readFileSync('AgentTreasury.abi', 'utf8'));
    
    // Create contract factory
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    
    console.log('\nDeploying AgentTreasury...');
    
    // Deploy with banker as owner
    const contract = await factory.deploy(bankerAddr, {
        gasLimit: 500000
    });
    
    console.log('Transaction sent:', contract.deployTransaction ? contract.deployTransaction.hash : contract.deploymentTransaction().hash);
    console.log('Waiting for confirmation...');
    
    await contract.deployed ? contract.deployed() : contract.waitForDeployment();
    
    const address = contract.address || await contract.getAddress();
    console.log('\n✅ Deployed successfully!');
    console.log('Contract address:', address);
    console.log('BaseScan: https://basescan.org/address/' + address);
    
    // Save deployment info
    const deployment = {
        contract: 'AgentTreasury',
        network: 'Base Mainnet',
        chainId: 8453,
        address: address,
        owner: bankerAddr,
        timestamp: new Date().toISOString(),
        abi: abi
    };
    
    fs.writeFileSync('deployment.json', JSON.stringify(deployment, null, 2));
    console.log('\nDeployment saved to: deployment.json');
    
    console.log('\n✅ Deployment complete!');
    console.log('\nNext steps:');
    console.log('1. Add supported tokens (wstETH, USDC)');
    console.log('2. Deposit wstETH into treasury');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
