const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
    const provider = new ethers.providers.JsonRpcProvider('https://mainnet.base.org');
    
    const bankerAddr = '0x6350B793688221c75cfB438547B9CA47f5b0D4f1';
    const key = env.AOX_BANKER_PRIVATE_KEY;
    
    const wallet = new ethers.Wallet(key, provider);
    console.log('Deployer:', wallet.address);
    
    const bytecode = fs.readFileSync('AgentTreasury.bin', 'utf8');
    const abi = JSON.parse(fs.readFileSync('AgentTreasury.abi', 'utf8'));
    
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    
    console.log('\nDeploying AgentTreasury with 1M gas limit...');
    
    const contract = await factory.deploy(bankerAddr, {
        gasLimit: 1000000  // Increased from 500k
    });
    
    console.log('Transaction:', contract.deployTransaction.hash);
    console.log('Waiting...');
    
    await contract.deployed();
    
    const address = contract.address;
    console.log('\n✅ Deployed successfully!');
    console.log('Address:', address);
    console.log('BaseScan: https://basescan.org/address/' + address);
    
    // Save
    const deployment = {
        contract: 'AgentTreasury',
        network: 'Base Mainnet',
        address: address,
        owner: bankerAddr,
        txHash: contract.deployTransaction.hash,
        timestamp: new Date().toISOString()
    };
    fs.writeFileSync('deployment.json', JSON.stringify(deployment, null, 2));
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
