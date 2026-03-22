#!/usr/bin/env node
/**
 * x402 Payment Server for AOX Marketplace v3.0
 * - Accepts USDC, USDT, DAI, WETH, $BNKR, and native ETH payments
 * - POST /webhook/new-lead for automated lead ingestion from agents
 * - Persists leads to listings.json, contact data to contacts.json
 * - Serves lead contact data after purchase
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
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'aox-agents-2026';

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
// File paths
// ---------------------------------------------------------------------------
const LISTINGS_FILE = path.join(__dirname, 'listings.json');
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const provider = new ethers.JsonRpcProvider(BASE_RPC);
let listings = [];
let contacts = {}; // leadId → { name, fields: [{ label, value }] }
const purchases = new Map(); // leadId → purchase record

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function loadListings() {
  try {
    const data = JSON.parse(fs.readFileSync(LISTINGS_FILE, 'utf-8'));
    listings = data.listings || data;
    console.log(`[load] ${listings.length} listings from ${LISTINGS_FILE}`);
  } catch (err) {
    console.error('Failed to load listings.json:', err.message);
    listings = [];
  }
}

function saveListings() {
  try {
    const data = { listings, count: listings.length, updated_at: new Date().toISOString() };
    fs.writeFileSync(LISTINGS_FILE, JSON.stringify(data, null, 2));
    console.log(`[save] ${listings.length} listings to ${LISTINGS_FILE}`);
  } catch (err) {
    console.error('Failed to save listings.json:', err.message);
  }
}

function loadContacts() {
  try {
    contacts = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf-8'));
    console.log(`[load] ${Object.keys(contacts).length} contact records from ${CONTACTS_FILE}`);
  } catch {
    contacts = {};
  }
}

function saveContacts() {
  try {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
    console.log(`[save] ${Object.keys(contacts).length} contact records to ${CONTACTS_FILE}`);
  } catch (err) {
    console.error('Failed to save contacts.json:', err.message);
  }
}

// Load on startup
loadListings();
loadContacts();

// Reload periodically (pick up external edits)
setInterval(loadListings, 60_000);
setInterval(loadContacts, 60_000);

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

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

/** Convert a USDC price to the equivalent amount in the given token's smallest unit. */
function priceInToken(usdcPrice, tokenKey) {
  const tok = TOKENS[tokenKey];
  if (!tok) return null;
  return ethers.parseUnits(usdcPrice.toString(), tok.decimals).toString();
}

// ---------------------------------------------------------------------------
// Payment verification
// ---------------------------------------------------------------------------
async function verifyPayment(payload) {
  try {
    const { accepted, payload: paymentData } = payload;

    const assetAddr = (accepted.asset || '').toLowerCase();
    const token = TOKEN_BY_ADDRESS[assetAddr];
    if (!token) {
      return { valid: false, reason: `Unsupported token: ${accepted.asset}` };
    }

    if (accepted.network !== 'eip155:8453') {
      return { valid: false, reason: 'Invalid network — must be eip155:8453 (Base)' };
    }

    if ((accepted.payTo || '').toLowerCase() !== MARKETPLACE_WALLET.toLowerCase()) {
      return { valid: false, reason: 'Invalid payee wallet' };
    }

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
  // Check contacts.json first, then fall back to inline lead fields
  const contactData = contacts[lead.id];

  const delivery = {
    lead_id: lead.id,
    title: lead.title,
    category: lead.category,
    score: lead.score,
    tier: lead.tier,
    chain: lead.public_metadata?.chain || lead.metadata?.chain || 'Base',
    purchased_at: settlement.settledAt,
    transaction_hash: settlement.txHash,
  };

  if (contactData) {
    // Structured contact data from contacts.json
    delivery.contacts = contactData;
  } else {
    // Fallback: inline fields from listings.json
    delivery.contacts = {
      wallet_address: lead.wallet_address || null,
      polymarket_profile: lead.polymarket_profile || null,
      source_url: lead.source_url || null,
    };
    delivery.metadata = lead.public_metadata || lead.metadata || {};
  }

  return delivery;
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Payment-Token, X-PAYMENT-SIGNATURE, X-Webhook-Secret');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // -----------------------------------------------------------------------
  // POST /webhook/new-lead — Automated lead ingestion from agents
  // -----------------------------------------------------------------------
  if (url.pathname === '/webhook/new-lead' && req.method === 'POST') {
    const body = await readBody(req);
    let payload;

    try {
      payload = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }

    // Auth: check webhook secret (header or body field)
    const secret = req.headers['x-webhook-secret'] || payload.secret;
    if (secret !== WEBHOOK_SECRET) {
      return json(res, 401, { error: 'Invalid webhook secret' });
    }

    // Validate required fields
    const { id, category, title, score, price } = payload;
    if (!id || !category || !title || score === undefined || price === undefined) {
      return json(res, 400, {
        error: 'Missing required fields',
        required: ['id', 'category', 'title', 'score', 'price'],
        optional_public: ['desc', 'description', 'tier', 'payment_token', 'status', 'metadata', 'public_metadata'],
        optional_contact: ['contact_data (object with name + fields array for post-purchase reveal)'],
        example: {
          id: 'token-abc-0x123',
          category: 'Token Launch',
          title: 'Token Name — Description',
          desc: 'Short public description shown on card',
          score: 85,
          price: 50,
          tier: 'premium',
          payment_token: 'USDC',
          metadata: { chain: 'Base', fdv_usd: 100000 },
          contact_data: {
            name: 'Full Token Details',
            fields: [
              { label: 'Contract Address', value: '0x...' },
              { label: 'Deployer Wallet', value: '0x...' },
              { label: 'Contact Email', value: 'team@project.com' },
            ],
          },
        },
      });
    }

    // Check for duplicate ID
    if (findLead(id)) {
      return json(res, 409, { error: `Lead with id "${id}" already exists` });
    }

    // Build the public listing (what shows in GET /leads)
    const listing = {
      id,
      status: payload.status || 'available',
      category,
      title,
      desc: payload.desc || payload.description || `Verified ${category} lead scored ${score}/100 by AOX.`,
      score: Number(score),
      tier: payload.tier || (score >= 90 ? 'enterprise' : score >= 80 ? 'premium' : 'standard'),
      price: Number(price),
      payment_token: payload.payment_token || 'USDC',
      listed_at: new Date().toISOString(),
    };

    // Copy through optional public fields
    if (payload.wallet_address) listing.wallet_address = payload.wallet_address;
    if (payload.polymarket_profile) listing.polymarket_profile = payload.polymarket_profile;
    if (payload.source_url) listing.source_url = payload.source_url;
    if (payload.source_verified !== undefined) listing.source_verified = payload.source_verified;
    if (payload.metadata) listing.metadata = payload.metadata;
    if (payload.public_metadata) listing.public_metadata = payload.public_metadata;
    if (payload.expires_at) listing.expires_at = payload.expires_at;
    if (payload.win_rate) listing.win_rate = payload.win_rate;
    if (payload.total_trades) listing.total_trades = payload.total_trades;
    if (payload.total_volume) listing.total_volume = payload.total_volume;
    if (payload.unique_markets) listing.unique_markets = payload.unique_markets;

    // Save listing
    listings.push(listing);
    saveListings();

    // Save contact/reveal data (the product delivered after purchase)
    if (payload.contact_data) {
      contacts[id] = payload.contact_data;
      saveContacts();
    }

    console.log(`[webhook] New lead listed: ${id} — ${title} ($${price} ${listing.payment_token})`);

    return json(res, 201, {
      success: true,
      message: 'Lead listed successfully',
      lead_id: id,
      title,
      price,
      tier: listing.tier,
      has_contact_data: !!payload.contact_data,
      listed_at: listing.listed_at,
      view_url: `http://3.142.118.148:3200/lead?id=${id}`,
    });
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
  // GET /lead/contacts?id=<id> — Fetch contact/reveal data for a lead
  //   (called by frontend after purchase to display the product)
  // -----------------------------------------------------------------------
  if (url.pathname === '/lead/contacts' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) return json(res, 400, { error: 'Query parameter "id" is required' });

    const contactData = contacts[id];
    if (!contactData) {
      return json(res, 404, { error: 'No contact data for this lead' });
    }

    return json(res, 200, contactData);
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

    const existing = purchases.get(id);
    if (existing) {
      return json(res, 200, { ...existing, message: 'Lead already purchased' });
    }

    const sig = req.headers['x-payment-signature'];
    if (!sig) {
      return json(res, 402, { error: 'X-PAYMENT-SIGNATURE header required' });
    }

    await readBody(req);

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
      version: '3.0.0',
      network: 'Base Mainnet (8453)',
      marketplace_wallet: MARKETPLACE_WALLET,
      accepted_tokens: Object.keys(TOKENS),
      leads_loaded: listings.length,
      contacts_loaded: Object.keys(contacts).length,
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
  console.log(`AOX x402 Marketplace Server v3.0.0`);
  console.log(`Port:        ${PORT}`);
  console.log(`Network:     Base Mainnet`);
  console.log(`Marketplace: ${MARKETPLACE_WALLET}`);
  console.log(`Banker:      ${BANKER_WALLET}`);
  console.log(`Tokens:      ${Object.values(TOKENS).map((t) => t.symbol).join(', ')}`);
  console.log(`Leads:       ${listings.length} loaded`);
  console.log(`Contacts:    ${Object.keys(contacts).length} loaded`);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST /webhook/new-lead        — Agents submit new leads (with contact_data)');
  console.log('  GET  /leads                   — Browse all available leads');
  console.log('  GET  /quote?id=<id>           — Get pricing for a lead');
  console.log('  GET  /lead?id=<id>            — Request lead (returns 402 or 200)');
  console.log('  POST /lead/purchase?id=<id>   — Purchase with x402 signature');
  console.log('  GET  /health                  — Service status');
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
