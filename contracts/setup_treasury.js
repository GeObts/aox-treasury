const ethers = require('ethers');
const fs = require('fs');

const CONTRACT_ADDR = '0xeB747c50eD3b327480228E18ffD4bd9Cf8646B47';
const WSTETH = '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452';

function loadEnv() {
    const content = fs.readFileSync(require('path').join(require('os').homedir(), '.openclaw', '.env'), 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
        if (line.includes('=') && !line.startsWith('#')) {
            const idx = line.indexOf('=');
            env[line.substring(0, idx)] = line.substring(idx + 1).replace(/^["']|["']$/g, '');
        }
    }
    return env;
}

async function main() {
    const env = loadEnv();
    const provider = new ethers.providers.JsonRpcProvider('https://mainnet.base.org');
    const wallet = new ethers.Wallet(env.AOX_BANKER_PRIVATE_KEY, provider);
    
    const abi = JSON.parse(fs.readFileSync('AgentTreasury.abi', 'utf8'));
    const contract = new ethers.Contract(CONTRACT_ADDR, abi, wallet);
    
    console.log('Setting up AgentTreasury...');
    console.log('Contract:', CONTRACT_ADDR);
    console.log('Owner:', await contract.owner());
    
    // Add wstETH as supported
    console.log('\nAdding wstETH as supported token...');
    const tx1 = await contract.addSupportedToken(WSTETH, { gasLimit: 100000 });
    await tx1.wait();
    console.log('✅ wstETH added');
    
    // Check wstETH balance
    const wstethAbi = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
    const wsteth = new ethers.Contract(WSTETH, wstethAbi, wallet);
    const balance = await wsteth.balanceOf(wallet.address);
    console.log(`\nBanker wstETH balance: ${ethers.utils.formatUnits(balance, 18)}`);
    
    if (balance > 0) {
        console.log('Approving treasury to spend wstETH...');
        const tx2 = await wsteth.approve(CONTRACT_ADDR, balance, { gasLimit: 100000 });
        await tx2.wait();
        console.log('✅ Approved');
        
        console.log('Depositing wstETH to treasury...');
        const tx3 = await contract.deposit(WSTETH, balance, { gasLimit: 200000 });
        await tx3.wait();
        console.log('✅ Deposited');
        
        const treasuryBalance = await contract.getContractBalance(WSTETH);
        console.log(`Treasury wstETH: ${ethers.utils.formatUnits(treasuryBalance, 18)}`);
    }
    
    console.log('\n✅ Setup complete!');
    console.log('Treasury is ready for deposits.');
}

main().catch(console.error);
