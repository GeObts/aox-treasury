const solc = require('solc');
const fs = require('fs');
const path = require('path');

// Read source
const contractPath = path.join(__dirname, 'AgentTreasury.sol');
const source = fs.readFileSync(contractPath, 'utf8');

// Helper to find imports
function findImports(importPath) {
    if (importPath.startsWith('@openzeppelin/')) {
        const fullPath = path.join(__dirname, 'node_modules', importPath);
        return { contents: fs.readFileSync(fullPath, 'utf8') };
    }
    return { error: 'File not found' };
}

const input = {
    language: 'Solidity',
    sources: {
        'AgentTreasury.sol': {
            content: source
        }
    },
    settings: {
        outputSelection: {
            '*': {
                '*': ['abi', 'evm.bytecode']
            }
        },
        optimizer: {
            enabled: true,
            runs: 200
        }
    }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)), { import: findImports });

if (output.errors) {
    const hasError = output.errors.some(e => e.severity === 'error');
    output.errors.forEach(e => console.error(e.formattedMessage));
    if (hasError) process.exit(1);
}

const contract = output.contracts['AgentTreasury.sol']['AgentTreasury'];

fs.writeFileSync('AgentTreasury.abi', JSON.stringify(contract.abi));
fs.writeFileSync('AgentTreasury.bin', contract.evm.bytecode.object);

console.log('Compilation successful!');
console.log('Bytecode size:', contract.evm.bytecode.object.length / 2, 'bytes');
