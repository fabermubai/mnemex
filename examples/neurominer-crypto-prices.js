/**
 * Mnemex Neurominer Template — Crypto Price Puller
 *
 * This is a starter template for Neurominers.
 * Fetch any real-world data, write it as Mnemex memories, earn TNK.
 *
 * Setup:
 *   SC_BRIDGE_TOKEN=<your-token> node examples/neurominer-crypto-prices.js
 *
 * Customize:
 *   - Replace Binance fetch with any data source
 *   - Set access: "gated" + price: "..." to monetize premium data
 *   - Change INTERVAL_MS for your update frequency
 *
 * Note: trust_level is "unverified" — Phase 6 will add consensus validation.
 */

import WebSocket from 'ws';

// ─── Configuration (edit these) ──────────────────────────────────────────────

const SC_BRIDGE_HOST = process.env.SC_BRIDGE_HOST || '127.0.0.1';
const SC_BRIDGE_PORT = process.env.SC_BRIDGE_PORT || 49222;
const SC_BRIDGE_TOKEN = process.env.SC_BRIDGE_TOKEN || 'your-token-here';
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CORTEX = 'cortex-crypto';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

// Map Binance symbols to human-readable pairs
const SYMBOL_MAP = {
  BTCUSDT: { pair: 'BTC/USD', tags: 'bitcoin,price,realtime' },
  ETHUSDT: { pair: 'ETH/USD', tags: 'ethereum,price,realtime' },
  SOLUSDT: { pair: 'SOL/USD', tags: 'solana,price,realtime' },
};

// ─── Binance price fetch ─────────────────────────────────────────────────────

async function fetchPrices() {
  const symbolsParam = JSON.stringify(SYMBOLS);
  const url = `https://api.binance.com/api/v3/ticker/price?symbols=${symbolsParam}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  return res.json(); // [{ symbol: "BTCUSDT", price: "97250.12000000" }, ...]
}

// ─── SC-Bridge connection ────────────────────────────────────────────────────

function connectAndPublish(memories) {
  return new Promise((resolve, reject) => {
    const wsUrl = `ws://${SC_BRIDGE_HOST}:${SC_BRIDGE_PORT}?token=${SC_BRIDGE_TOKEN}`;
    const ws = new WebSocket(wsUrl);
    let authed = false;
    let published = 0;
    const total = memories.length;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('SC-Bridge connection timeout (10s)'));
    }, 10_000);

    ws.on('open', () => {
      // Server sends hello on connect, then we auth
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());

      // Step 1: receive hello, send auth
      if (msg.type === 'hello' && !authed) {
        ws.send(JSON.stringify({ type: 'auth', token: SC_BRIDGE_TOKEN }));
        return;
      }

      // Step 2: auth confirmed, start publishing
      if (msg.type === 'auth_ok') {
        authed = true;
        for (const mem of memories) {
          ws.send(JSON.stringify(mem));
        }
        return;
      }

      // Step 3: count write confirmations
      if (msg.type === 'memory_write_ok') {
        published++;
        if (published >= total) {
          clearTimeout(timeout);
          ws.close();
          resolve(published);
        }
        return;
      }

      // Handle errors
      if (msg.type === 'error') {
        console.error('[Neurominer] SC-Bridge error:', msg.error);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ─── Main loop ───────────────────────────────────────────────────────────────

async function cycle() {
  const now = Date.now();
  console.log(`[Neurominer] Fetching prices from Binance...`);

  let prices;
  try {
    prices = await fetchPrices();
  } catch (err) {
    console.error('[Neurominer] Fetch failed:', err.message);
    return;
  }

  const memories = [];
  for (const item of prices) {
    const info = SYMBOL_MAP[item.symbol];
    if (!info) continue;

    const value = parseFloat(item.price);
    const memoryId = `${info.pair.replace('/', '-').toLowerCase()}-${now}`;

    memories.push({
      type: 'memory_write',
      memory_id: memoryId,
      cortex: CORTEX,
      data: { symbol: info.pair, value, source: 'binance', ts_fetch: now },
      // "public" = free read, no TNK fee — use for commodity data available freely on internet
      // Use "open" (0.03 TNK) for your own analysis, "gated" for premium content
      access: 'public',
      tags: info.tags,
      trust_level: 'unverified',
      ts: now,
    });

    console.log(`[Neurominer] ${info.pair}: ${value} -> memory_id: ${memoryId}`);
  }

  if (memories.length === 0) {
    console.log('[Neurominer] No prices to publish.');
    return;
  }

  try {
    const count = await connectAndPublish(memories);
    console.log(`[Neurominer] Published ${count} memories.`);
  } catch (err) {
    console.error('[Neurominer] Publish failed:', err.message);
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

console.log('[Neurominer] Crypto Price Puller started');
console.log(`[Neurominer] SC-Bridge: ws://${SC_BRIDGE_HOST}:${SC_BRIDGE_PORT}`);
console.log(`[Neurominer] Symbols: ${SYMBOLS.join(', ')}`);
console.log(`[Neurominer] Interval: ${INTERVAL_MS / 1000}s`);
console.log('');

// Run immediately, then on interval
cycle();
setInterval(cycle, INTERVAL_MS);
