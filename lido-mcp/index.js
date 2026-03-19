#!/usr/bin/env node

/**
 * Lido MCP Server
 * Model Context Protocol server for AI-native ETH staking via Lido
 * 
 * Exposes: stake, unstake, wrap/unwrap, balance, rewards
 * Supports: Ethereum mainnet and Base L2
 * 
 * @author AOX (Agent Opportunity Exchange)
 * @hackathon The Synthesis 2026 - Lido MCP Prize
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // RPC endpoints
  ETH_RPC: 'https://eth.llamarpc.com',
  BASE_RPC: 'https://mainnet.base.org',
  
  // Contract addresses
  LIDO_STETH_MAINNET: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  WSTETH_BASE: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
  STETH_BASE: '0xE3F4b4891bC8830e1D8228C85D1fBc05d762B77',
  WETH_BASE: '0x4200000000000000000000000000000000000006',
  
  // Lido contracts
  LIDO_WITHDRAWAL_QUEUE: '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1',
  
  // Server config
  PORT: 3300,
};

// Load private key from environment
function loadPrivateKey() {
  try {
    const envPath = join(process.env.HOME || '/home/ubuntu', '.openclaw', '.env');
    const envContent = readFileSync(envPath, 'utf8');
    const match = envContent.match(/AOX_BANKER_PRIVATE_KEY=([a-fA-F0-9x]+)/);
    if (match) return match[1];
  } catch (e) {
    console.error('Failed to load AOX_BANKER_PRIVATE_KEY from ~/.openclaw/.env:', e.message);
  }
  return process.env.AOX_BANKER_PRIVATE_KEY;
}

const PRIVATE_KEY = loadPrivateKey();

// ============================================================================
// CONTRACT ABIs (Minimal for gas efficiency)
// ============================================================================

const LIDO_STETH_ABI = [
  'function submit(address _referral) external payable returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address recipient, uint256 amount) external returns (bool)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function getPooledEthByShares(uint256 _sharesAmount) external view returns (uint256)',
  'function getSharesByPooledEth(uint256 _pooledEthAmount) external view returns (uint256)',
  'function getTotalPooledEther() external view returns (uint256)',
  'function getTotalShares() external view returns (uint256)',
  'event Submitted(address indexed sender, uint256 amount, address indexed referral)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const WSTETH_ABI = [
  'function wrap(uint256 _stETHAmount) external returns (uint256)',
  'function unwrap(uint256 _wstETHAmount) external returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function stETHPerToken() external view returns (uint256)',
  'function tokensPerStETH() external view returns (uint256)',
  'function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256)',
  'function getWstETHByStETH(uint256 _stETHAmount) external view returns (uint256)',
];

const WITHDRAWAL_QUEUE_ABI = [
  'function requestWithdrawals(uint256[] calldata _amounts, address _owner) external returns (uint256[] memory requestIds)',
  'function getLastCheckpointIndex() external view returns (uint256)',
  'function getWithdrawalStatus(uint256[] calldata _requestIds) external view returns (tuple(uint256 amountOfStETH, uint256 amountOfETH, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[] memory)',
];

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];


// ============================================================================
// RATE LIMITING
// ============================================================================

const rateLimits = new Map(); // tool -> { count, resetTime }
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 calls per minute

function checkRateLimit(toolName) {
  const now = Date.now();
  const toolLimit = rateLimits.get(toolName);
  
  if (!toolLimit || now > toolLimit.resetTime) {
    // Reset or initialize
    rateLimits.set(toolName, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW
    });
    return { allowed: true };
  }
  
  if (toolLimit.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((toolLimit.resetTime - now) / 1000);
    return { 
      allowed: false, 
      error: `Rate limit exceeded for ${toolName}. Maximum ${RATE_LIMIT_MAX} calls per minute. Retry after ${retryAfter}s.` 
    };
  }
  
  toolLimit.count++;
  return { allowed: true };
}

// ============================================================================
// PROVIDER SETUP
// ============================================================================

const ethProvider = new ethers.JsonRpcProvider(CONFIG.ETH_RPC);
const baseProvider = new ethers.JsonRpcProvider(CONFIG.BASE_RPC);

let wallet = null;
if (PRIVATE_KEY) {
  wallet = new ethers.Wallet(PRIVATE_KEY);
}

const ethWallet = wallet ? wallet.connect(ethProvider) : null;
const baseWallet = wallet ? wallet.connect(baseProvider) : null;

// Contract instances
const lidoStETH = new ethers.Contract(CONFIG.LIDO_STETH_MAINNET, LIDO_STETH_ABI, ethWallet || ethProvider);
const wstETHBase = new ethers.Contract(CONFIG.WSTETH_BASE, WSTETH_ABI, baseWallet || baseProvider);
const stETHBase = new ethers.Contract(CONFIG.STETH_BASE, ERC20_ABI, baseWallet || baseProvider);

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

async function lidoStake(args) {
  const { amount, dry_run = false } = args;
  
  // Input validation
  if (!amount || isNaN(parseFloat(amount))) {
    return { error: 'Invalid amount provided' };
  }
  
  const amountNum = parseFloat(amount);
  if (amountNum <= 0) {
    return { error: 'Amount must be greater than 0' };
  }
  if (amountNum < 0.001) {
    return { error: 'Minimum stake amount is 0.001 ETH' };
  }
  if (amountNum > 10) {
    return { error: 'Maximum stake amount is 10 ETH per transaction' };
  }
  
  const ethAmount = ethers.parseEther(amount.toString());
  
  if (dry_run) {
    return {
      success: true,
      dry_run: true,
      operation: 'stake',
      amount: amount.toString(),
      amount_wei: ethAmount.toString(),
      contract: CONFIG.LIDO_STETH_MAINNET,
      network: 'ethereum-mainnet',
      estimated_stETH: amount.toString(),
      gas_estimate: '0.015 ETH',
      note: 'Simulation only - no transaction executed'
    };
  }
  
  if (!ethWallet) {
    return { error: 'No wallet configured. Set AOX_BANKER_PRIVATE_KEY in ~/.openclaw/.env' };
  }
  
  try {
    // Fetch current gas prices from provider
    const feeData = await ethProvider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits('50', 'gwei');
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei');
    
    const tx = await lidoStETH.submit(ethers.ZeroAddress, { 
      value: ethAmount,
      maxFeePerGas: maxFeePerGas * 120n / 100n, // Add 20% buffer
      maxPriorityFeePerGas: maxPriorityFeePerGas * 120n / 100n
    });
    
    const receipt = await tx.wait();
    
    return {
      success: true,
      transaction_hash: tx.hash,
      block_number: receipt.blockNumber,
      amount_staked: amount.toString(),
      stETH_received: amount.toString(),
      gas_used: receipt.gasUsed.toString(),
      gas_cost_eth: ethers.formatEther(receipt.gasUsed * receipt.gasPrice),
      contract: CONFIG.LIDO_STETH_MAINNET,
      network: 'ethereum-mainnet'
    };
  } catch (error) {
    return { error: `Stake failed: ${error.message}` };
  }
}

async function lidoUnstake(args) {
  const { amount, dry_run = false } = args;
  
  if (!amount || isNaN(parseFloat(amount))) {
    return { error: 'Invalid amount provided' };
  }
  
  const stETHAmount = ethers.parseEther(amount.toString());
  
  if (dry_run) {
    return {
      success: true,
      dry_run: true,
      operation: 'unstake',
      amount: amount.toString(),
      amount_wei: stETHAmount.toString(),
      contract: CONFIG.LIDO_WITHDRAWAL_QUEUE,
      network: 'ethereum-mainnet',
      note: 'Withdrawal request will be created. Finalization takes 1-5 days.',
      gas_estimate: '0.02 ETH'
    };
  }
  
  if (!ethWallet) {
    return { error: 'No wallet configured' };
  }
  
  try {
    const withdrawalQueue = new ethers.Contract(
      CONFIG.LIDO_WITHDRAWAL_QUEUE,
      WITHDRAWAL_QUEUE_ABI,
      ethWallet
    );
    
    // First approve withdrawal queue to spend stETH
    const approveTx = await lidoStETH.approve(CONFIG.LIDO_WITHDRAWAL_QUEUE, stETHAmount);
    await approveTx.wait();
    
    // Request withdrawal
    const tx = await withdrawalQueue.requestWithdrawals([stETHAmount], ethWallet.address);
    const receipt = await tx.wait();
    
    // Parse request ID from event
    const requestId = receipt.logs.find(log => log.address.toLowerCase() === CONFIG.LIDO_WITHDRAWAL_QUEUE.toLowerCase())?.topics[1] || 'pending';
    
    return {
      success: true,
      transaction_hash: tx.hash,
      request_id: requestId,
      amount_requested: amount.toString(),
      status: 'pending_finalization',
      note: 'Withdrawal will be finalized in 1-5 days. Check status with lido_balance.',
      gas_used: receipt.gasUsed.toString()
    };
  } catch (error) {
    return { error: `Unstake failed: ${error.message}` };
  }
}

async function lidoWrap(args) {
  const { amount, dry_run = false } = args;
  
  if (!amount || isNaN(parseFloat(amount))) {
    return { error: 'Invalid amount provided' };
  }
  
  const stETHAmount = ethers.parseEther(amount.toString());
  
  if (dry_run) {
    return {
      success: true,
      dry_run: true,
      operation: 'wrap',
      from_token: 'stETH',
      to_token: 'wstETH',
      amount: amount.toString(),
      network: 'base',
      contract: CONFIG.WSTETH_BASE,
      note: 'wstETH is non-rebasing - your balance stays fixed while value grows',
      gas_estimate: '0.001 ETH'
    };
  }
  
  if (!baseWallet) {
    return { error: 'No wallet configured' };
  }
  
  try {
    // Approve wstETH contract to spend stETH
    const approveTx = await stETHBase.approve(CONFIG.WSTETH_BASE, stETHAmount);
    await approveTx.wait();
    
    const tx = await wstETHBase.wrap(stETHAmount);
    const receipt = await tx.wait();
    
    // Calculate wstETH received
    const tokensPerStETH = await wstETHBase.tokensPerStETH();
    const wstETHReceived = (stETHAmount * BigInt(1e18)) / tokensPerStETH;
    
    return {
      success: true,
      transaction_hash: tx.hash,
      block_number: receipt.blockNumber,
      stETH_wrapped: amount.toString(),
      wstETH_received: ethers.formatEther(wstETHReceived),
      gas_used: receipt.gasUsed.toString(),
      network: 'base'
    };
  } catch (error) {
    return { error: `Wrap failed: ${error.message}` };
  }
}

async function lidoUnwrap(args) {
  const { amount, dry_run = false } = args;
  
  if (!amount || isNaN(parseFloat(amount))) {
    return { error: 'Invalid amount provided' };
  }
  
  const wstETHAmount = ethers.parseEther(amount.toString());
  
  if (dry_run) {
    return {
      success: true,
      dry_run: true,
      operation: 'unwrap',
      from_token: 'wstETH',
      to_token: 'stETH',
      amount: amount.toString(),
      network: 'base',
      contract: CONFIG.WSTETH_BASE,
      note: 'Converting non-rebasing wstETH back to rebasing stETH',
      gas_estimate: '0.001 ETH'
    };
  }
  
  if (!baseWallet) {
    return { error: 'No wallet configured' };
  }
  
  try {
    const tx = await wstETHBase.unwrap(wstETHAmount);
    const receipt = await tx.wait();
    
    // Calculate stETH received
    const stETHPerToken = await wstETHBase.stETHPerToken();
    const stETHReceived = (wstETHAmount * stETHPerToken) / BigInt(1e18);
    
    return {
      success: true,
      transaction_hash: tx.hash,
      block_number: receipt.blockNumber,
      wstETH_unwrapped: amount.toString(),
      stETH_received: ethers.formatEther(stETHReceived),
      gas_used: receipt.gasUsed.toString(),
      network: 'base'
    };
  } catch (error) {
    return { error: `Unwrap failed: ${error.message}` };
  }
}

async function lidoBalance(args) {
  const { address } = args;
  const targetAddress = address || (wallet ? wallet.address : null);
  
  if (!targetAddress) {
    return { error: 'No address provided and no wallet configured' };
  }
  
  try {
    // Mainnet stETH balance
    const stETHBalance = await lidoStETH.balanceOf(targetAddress);
    
    // Base balances
    const wstETHBalance = await wstETHBase.balanceOf(targetAddress);
    const baseStETHBalance = await stETHBase.balanceOf(targetAddress);
    
    // Get APY from Lido oracle (simplified - in production fetch from API)
    const estimatedAPY = 3.2; // Current stETH APY
    
    // Calculate wstETH value in stETH terms
    const stETHPerToken = await wstETHBase.stETHPerToken();
    const wstETHValueInStETH = (wstETHBalance * stETHPerToken) / BigInt(1e18);
    
    const totalStETHEquivalent = stETHBalance + baseStETHBalance + wstETHValueInStETH;
    
    return {
      success: true,
      address: targetAddress,
      ethereum_mainnet: {
        stETH: ethers.formatEther(stETHBalance),
      },
      base: {
        stETH: ethers.formatEther(baseStETHBalance),
        wstETH: ethers.formatEther(wstETHBalance),
        wstETH_value_in_stETH: ethers.formatEther(wstETHValueInStETH),
      },
      total_stETH_equivalent: ethers.formatEther(totalStETHEquivalent),
      current_apy_percent: estimatedAPY,
      estimated_daily_rewards_eth: (parseFloat(ethers.formatEther(totalStETHEquivalent)) * estimatedAPY / 100 / 365).toFixed(8),
      note: 'APY is variable and based on Ethereum staking rewards minus Lido fee'
    };
  } catch (error) {
    return { error: `Balance check failed: ${error.message}` };
  }
}

async function lidoRewards(args) {
  const { address, since_timestamp } = args;
  const targetAddress = address || (wallet ? wallet.address : null);
  
  if (!targetAddress) {
    return { error: 'No address provided and no wallet configured' };
  }
  
  try {
    // Get current balance
    const stETHBalance = await lidoStETH.balanceOf(targetAddress);
    
    // In production, you'd query historical data from The Graph or Lido API
    // For now, return current position with note about data source
    const currentBalance = parseFloat(ethers.formatEther(stETHBalance));
    const estimatedAPY = 3.2;
    const estimatedAnnualRewards = currentBalance * estimatedAPY / 100;
    
    return {
      success: true,
      address: targetAddress,
      current_stETH_balance: currentBalance.toFixed(6),
      current_apy_percent: estimatedAPY,
      estimated_annual_rewards_eth: estimatedAnnualRewards.toFixed(6),
      estimated_monthly_rewards_eth: (estimatedAnnualRewards / 12).toFixed(6),
      note: 'Historical reward data requires integration with Lido subgraph or API',
      data_source: 'Live contract query - historical tracking not yet implemented'
    };
  } catch (error) {
    return { error: `Rewards check failed: ${error.message}` };
  }
}



// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server(
  {
    name: 'lido-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'lido_stake',
        description: 'Stake ETH on Ethereum mainnet via Lido and receive stETH. stETH is a rebasing token that automatically accrues staking rewards.',
        inputSchema: {
          type: 'object',
          properties: {
            amount: {
              type: 'string',
              description: 'Amount of ETH to stake (e.g., "0.1" or "1.5")',
            },
            dry_run: {
              type: 'boolean',
              description: 'If true, simulates the transaction without executing',
              default: false,
            },
          },
          required: ['amount'],
        },
      },
      {
        name: 'lido_unstake',
        description: 'Request withdrawal of stETH back to ETH. Creates a withdrawal request that finalizes in 1-5 days.',
        inputSchema: {
          type: 'object',
          properties: {
            amount: {
              type: 'string',
              description: 'Amount of stETH to withdraw (e.g., "0.5")',
            },
            dry_run: {
              type: 'boolean',
              description: 'If true, simulates without executing',
              default: false,
            },
          },
          required: ['amount'],
        },
      },
      {
        name: 'lido_wrap',
        description: 'Convert stETH to wstETH (wrapped stETH) on Base. wstETH is non-rebasing - your balance stays fixed while the underlying stETH value grows. Useful for DeFi integrations.',
        inputSchema: {
          type: 'object',
          properties: {
            amount: {
              type: 'string',
              description: 'Amount of stETH to wrap (e.g., "0.1")',
            },
            dry_run: {
              type: 'boolean',
              description: 'If true, simulates without executing',
              default: false,
            },
          },
          required: ['amount'],
        },
      },
      {
        name: 'lido_unwrap',
        description: 'Convert wstETH back to stETH on Base. Unwraps the fixed-balance token back to rebasing stETH.',
        inputSchema: {
          type: 'object',
          properties: {
            amount: {
              type: 'string',
              description: 'Amount of wstETH to unwrap (e.g., "0.1")',
            },
            dry_run: {
              type: 'boolean',
              description: 'If true, simulates without executing',
              default: false,
            },
          },
          required: ['amount'],
        },
      },
      {
        name: 'lido_balance',
        description: 'Check stETH and wstETH balances across Ethereum mainnet and Base. Returns current APY and estimated daily rewards.',
        inputSchema: {
          type: 'object',
          properties: {
            address: {
              type: 'string',
              description: 'Address to check (optional, defaults to configured wallet)',
            },
          },
        },
      },
      {
        name: 'lido_rewards',
        description: 'Get staking rewards information including current APY and estimated earnings.',
        inputSchema: {
          type: 'object',
          properties: {
            address: {
              type: 'string',
              description: 'Address to check (optional)',
            },
            since_timestamp: {
              type: 'number',
              description: 'Unix timestamp to calculate rewards since (optional)',
            },
          },
        },
      },

    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  let result;
  
  // Check rate limit before processing
  const rateCheck = checkRateLimit(name);
  if (!rateCheck.allowed) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: rateCheck.error }, null, 2) }],
    };
  }

  switch (name) {
    case 'lido_stake':
      result = await lidoStake(args);
      break;
    case 'lido_unstake':
      result = await lidoUnstake(args);
      break;
    case 'lido_wrap':
      result = await lidoWrap(args);
      break;
    case 'lido_unwrap':
      result = await lidoUnwrap(args);
      break;
    case 'lido_balance':
      result = await lidoBalance(args);
      break;
    case 'lido_rewards':
      result = await lidoRewards(args);
      break;

    default:
      result = { error: `Unknown tool: ${name}` };
  }
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
});

// ============================================================================
// START SERVER
// ============================================================================

async function main() {
  console.error('Lido MCP Server starting...');
  console.error(`Wallet: ${wallet ? wallet.address : 'NOT CONFIGURED'}`);
  console.error(`Port: ${CONFIG.PORT}`);
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('Lido MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
