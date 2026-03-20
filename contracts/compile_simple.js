const solc = require('solc');
const fs = require('fs');

const source = fs.readFileSync('AgentTreasurySimple.sol', 'utf8');

const input = {
    language: 'Solidity',
    sources: {
        'AgentTreasurySimple.sol': { content: source }
    },
    settings: {
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
        optimizer: { enabled: true, runs: 200 }
    }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
    output.errors.forEach(e => console.log(e.formattedMessage));
}

const contract = output.contracts['AgentTreasurySimple.sol']['AgentTreasury'];
fs.writeFileSync('AgentTreasury.abi', JSON.stringify(contract.abi));
fs.writeFileSync('AgentTreasury.bin', contract.evm.bytecode.object);

console.log('✅ Compiled successfully!');
console.log('Size:', contract.evm.bytecode.object.length / 2, 'bytes');
