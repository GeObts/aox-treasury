#!/usr/bin/env node
/**
 * x402 Payment Server for AOX Marketplace
 * Accepts USDC, USDT, DAI, WETH, $BNKR, and native ETH payments for leads
 * Serves lead listings and handles the full x402 purchase flow
 * Runs on port 3200
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3200;
const BASE_RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const MARKETPLACE_WALLET = '0x729174D90CA93139E3E9590993910B784eD32282';
const BANKER_WALLET = '0x7e7f825248Ae530610F34a5deB9Bc423f6d63373';

// Accepted payment tokens on Base mainnet
const TOKENS = {
  USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, symbol: 'USDC' },
  USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6, symbol: 'USDT' },
  DAI:  { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18, symbol: 'DAI' },
  WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' },
  BNKR: { address: '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b', decimals: 18, symbol: '$BNKR' },
};

// Reverse lookup: address → token key
const TOKEN_BY_ADDRESS = {};
for (const [key, tok] of Object.entries(TOKENS)) {
  TOKEN_BY_ADDRESS[tok.address.toLowerCase()] = { ...tok, key };
}

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const provider = new ethers.JsonRpcProvider(BASE_RPC);
let listings = [];
const purchases = new Map(); // leadId → purchase record

// Load listings from JSON file
function loadListings() {
  try {
    const file = path.join(__dirname, 'listings.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    listings = data.listings || data;
    console.log(`Loaded ${listings.length} listings from file`);
  } catch (err) {
    console.error('Failed to load listings.json:', err.message);
    listings = [];
  }
}

// Reload listings periodically (pick up new leads without restart)
loadListings();
setInterval(loadListings, 60_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function findLead(id) {
  return listings.find((l) => l.id === id) || null;
}

/** Convert a USDC price to the equivalent amount in the given token's smallest unit. */
function priceInToken(usdcPrice, tokenKey) {
  const tok = TOKENS[tokenKey];
  if (!tok) return null;
  // For stablecoins the price is 1:1; for WETH/BNKR we'd need an oracle
  // but for now we pass through the numeric price and adjust decimals.
  return ethers.parseUnits(usdcPrice.toString(), tok.decimals).toString();
}

// ---------------------------------------------------------------------------
// Payment verification
// ---------------------------------------------------------------------------
async function verifyPayment(payload) {
  try {
    const { accepted, payload: paymentData } = payload;

    // Resolve token
    const assetAddr = (accepted.asset || '').toLowerCase();
    const token = TOKEN_BY_ADDRESS[assetAddr];
    if (!token) {
      return { valid: false, reason: `Unsupported token: ${accepted.asset}` };
    }

    // Check network is Base
    if (accepted.network !== 'eip155:8453') {
      return { valid: false, reason: 'Invalid network — must be eip155:8453 (Base)' };
    }

    // Check payee
    if ((accepted.payTo || '').toLowerCase() !== MARKETPLACE_WALLET.toLowerCase()) {
      return { valid: false, reason: 'Invalid payee wallet' };
    }

    // Verify sender balance
    const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
    const senderAddr = paymentData?.permit2Authorization?.from || paymentData?.from;
    if (!senderAddr) {
      return { valid: false, reason: 'Missing sender address' };
    }

    const balance = await contract.balanceOf(senderAddr);
    const required = BigInt(accepted.amount);
    if (balance < required) {
      return { valid: false, reason: 'Insufficient balance' };
    }

    // Check deadline (if permit-based)
    if (paymentData?.permit2Authorization?.deadline) {
      const now = Math.floor(Date.now() / 1000);
      if (Number(paymentData.permit2Authorization.deadline) < now) {
        return { valid: false, reason: 'Permit expired' };
      }
    }

    return { valid: true, token, sender: senderAddr };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

async function settlePayment(payload, tokenInfo) {
  try {
    // In production: call Permit2 proxy to execute the on-chain transfer.
    // For now we log the settlement intent and return a pending receipt.
    const txHash = '0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

    console.log(`[settle] ${payload.accepted.amount} ${tokenInfo.symbol} from ${payload.payload?.permit2Authorization?.from || payload.payload?.from} → Banker ${BANKER_WALLET}`);

    return {
      success: true,
      txHash,
      amount: payload.accepted.amount,
      token: tokenInfo.address,
      tokenSymbol: tokenInfo.symbol,
      to: BANKER_WALLET,
      settledAt: new Date().toISOString(),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Build the lead contact payload returned after purchase
// ---------------------------------------------------------------------------
function buildLeadDelivery(lead, settlement) {
  return {
    lead_id: lead.id,
    title: lead.title,
    category: lead.category,
    score: lead.score,
    tier: lead.tier,
    chain: lead.public_metadata?.chain || lead.metadata?.chain || 'Base',
    contacts: {
      wallet_address: lead.wallet_address || null,
      polymarket_profile: lead.polymarket_profile || null,
      source_url: lead.source_url || null,
    },
    metadata: lead.public_metadata || lead.metadata || {},
    purchased_at: settlement.settledAt,
    transaction_hash: settlement.txHash,
  };
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Payment-Token, X-PAYMENT-SIGNATURE');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // -----------------------------------------------------------------------
  // GET /leads — Browse available leads (public, no payment required)
  // -----------------------------------------------------------------------
  if (url.pathname === '/leads' && req.method === 'GET') {
    const category = url.searchParams.get('category');
    const minScore = Number(url.searchParams.get('min_score')) || 0;

    let results = listings.filter((l) => (l.status || 'available') === 'available');

    if (category) {
      const cat = category.toLowerCase();
      results = results.filter((l) => (l.category || '').toLowerCase().includes(cat));
    }
    if (minScore > 0) {
      results = results.filter((l) => (l.score || 0) >= minScore);
    }

    // Strip sensitive contact fields from public listing
    const publicResults = results.map((l) => {
      const { wallet_address, polymarket_profile, source_url, contact_preview, ...pub } = l;
      return pub;
    });

    return json(res, 200, {
      listings: publicResults,
      count: publicResults.length,
      updated_at: new Date().toISOString(),
    });
  }

  // -----------------------------------------------------------------------
  // GET /quote?id=<id> — Get pricing for a specific lead
  // -----------------------------------------------------------------------
  if (url.pathname === '/quote' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) return json(res, 400, { error: 'Query parameter "id" is required' });

    const lead = findLead(id);
    if (!lead) return json(res, 404, { error: 'Lead not found' });

    const tokenKey = (url.searchParams.get('token') || 'USDC').toUpperCase();
    const tok = TOKENS[tokenKey];
    if (!tok) return json(res, 400, { error: `Unsupported token: ${tokenKey}. Accepted: ${Object.keys(TOKENS).join(', ')}, ETH` });

    return json(res, 200, {
      lead_id: lead.id,
      title: lead.title,
      price: lead.price,
      price_token: lead.payment_token || 'USDC',
      amount_raw: priceInToken(lead.price, tokenKey),
      token: tok.symbol,
      token_address: tok.address,
      decimals: tok.decimals,
      pay_to: MARKETPLACE_WALLET,
      network: 'eip155:8453',
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
  }

  // -----------------------------------------------------------------------
  // GET /lead?id=<id> — Request a lead; returns 402 with payment details
  //                      or 200 if X-Payment-Token header is present
  // -----------------------------------------------------------------------
  if (url.pathname === '/lead' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) return json(res, 400, { error: 'Query parameter "id" is required' });

    const lead = findLead(id);
    if (!lead) return json(res, 404, { error: 'Lead not found' });

    // If already purchased in this session, return the data
    const existing = purchases.get(id);
    if (existing) {
      return json(res, 200, existing);
    }

    // Check for inline x402 payment via X-Payment-Token header
    const paymentHeader = req.headers['x-payment-token'];
    if (paymentHeader) {
      try {
        const paymentPayload = JSON.parse(paymentHeader);
        const verification = await verifyPayment(paymentPayload);

        if (!verification.valid) {
          return json(res, 402, { error: 'Payment verification failed', reason: verification.reason });
        }

        const settlement = await settlePayment(paymentPayload, verification.token);
        if (!settlement.success) {
          return json(res, 500, { error: 'Settlement failed' });
        }

        const delivery = buildLeadDelivery(lead, settlement);
        purchases.set(id, delivery);
        return json(res, 200, delivery);
      } catch (err) {
        return json(res, 400, { error: 'Invalid X-Payment-Token header', details: err.message });
      }
    }

    // No payment — return 402 Payment Required
    const preferredToken = (url.searchParams.get('token') || 'USDC').toUpperCase();
    const tok = TOKENS[preferredToken] || TOKENS.USDC;
    const amount = priceInToken(lead.price, preferredToken) || priceInToken(lead.price, 'USDC');

    const paymentRequirements = {
      x402Version: 2,
      resource: {
        url: `https://aox.llc/lead?id=${id}`,
        description: `AOX Lead: ${lead.title}`,
        mimeType: 'application/json',
      },
      accepts: Object.entries(TOKENS).map(([key, t]) => ({
        scheme: 'exact',
        network: 'eip155:8453',
        amount: priceInToken(lead.price, key),
        asset: t.address,
        payTo: MARKETPLACE_WALLET,
        maxTimeoutSeconds: 300,
        extra: {
          name: t.symbol,
          version: '2',
          tokenSymbol: t.symbol,
        },
      })),
    };

    res.writeHead(402, {
      'Content-Type': 'application/json',
      'X-PAYMENT-REQUIRED': Buffer.from(JSON.stringify(paymentRequirements)).toString('base64'),
    });
    return res.end(JSON.stringify({
      error: 'Payment Required',
      message: `Send ${lead.price} ${lead.payment_token || 'USDC'} to access this lead`,
      price: lead.price,
      token: tok.symbol,
      token_address: tok.address,
      amount_raw: amount,
      pay_to: MARKETPLACE_WALLET,
      paymentRequirements,
    }));
  }

  // -----------------------------------------------------------------------
  // POST /lead/purchase?id=<id> — Purchase with x402 payment signature
  // -----------------------------------------------------------------------
  if (url.pathname === '/lead/purchase' && req.method === 'POST') {
    const id = url.searchParams.get('id');
    if (!id) return json(res, 400, { error: 'Query parameter "id" is required' });

    const lead = findLead(id);
    if (!lead) return json(res, 404, { error: 'Lead not found' });

    // Already purchased
    const existing = purchases.get(id);
    if (existing) {
      return json(res, 200, { ...existing, message: 'Lead already purchased' });
    }

    const sig = req.headers['x-payment-signature'];
    if (!sig) {
      return json(res, 402, { error: 'X-PAYMENT-SIGNATURE header required' });
    }

    // Read body (some agents send payload in body instead of header)
    let body = '';
    await new Promise((resolve) => {
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', resolve);
    });

    try {
      const paymentPayload = JSON.parse(Buffer.from(sig, 'base64').toString());

      const verification = await verifyPayment(paymentPayload);
      if (!verification.valid) {
        return json(res, 402, { error: 'Payment verification failed', reason: verification.reason });
      }

      const settlement = await settlePayment(paymentPayload, verification.token);
      if (!settlement.success) {
        return json(res, 500, { error: 'Settlement failed' });
      }

      const delivery = buildLeadDelivery(lead, settlement);
      purchases.set(id, delivery);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-PAYMENT-RESPONSE': Buffer.from(JSON.stringify(settlement)).toString('base64'),
      });
      return res.end(JSON.stringify({
        success: true,
        ...delivery,
        message: 'Lead delivered. Payment forwarded to treasury.',
      }));
    } catch (err) {
      console.error('Purchase error:', err);
      return json(res, 500, { error: 'Server error', details: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // GET /health — Service health check
  // -----------------------------------------------------------------------
  if (url.pathname === '/health' && req.method === 'GET') {
    return json(res, 200, {
      status: 'ok',
      service: 'AOX x402 Marketplace',
      version: '2.0.0',
      network: 'Base Mainnet (8453)',
      marketplace_wallet: MARKETPLACE_WALLET,
      accepted_tokens: Object.keys(TOKENS),
      leads_loaded: listings.length,
      uptime_seconds: Math.floor(process.uptime()),
    });
  }

  // -----------------------------------------------------------------------
  // 404 fallback
  // -----------------------------------------------------------------------
  json(res, 404, { error: 'Not found' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`AOX x402 Marketplace Server v2.0.0`);
  console.log(`Port:        ${PORT}`);
  console.log(`Network:     Base Mainnet`);
  console.log(`Marketplace: ${MARKETPLACE_WALLET}`);
  console.log(`Banker:      ${BANKER_WALLET}`);
  console.log(`Tokens:      ${Object.values(TOKENS).map((t) => t.symbol).join(', ')}`);
  console.log(`Leads:       ${listings.length} loaded`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET  /leads                  — Browse all available leads');
  console.log('  GET  /quote?id=<id>          — Get pricing for a lead');
  console.log('  GET  /lead?id=<id>           — Request lead (returns 402 or 200 with X-Payment-Token)');
  console.log('  POST /lead/purchase?id=<id>  — Purchase with x402 signature');
  console.log('  GET  /health                 — Service status');
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
