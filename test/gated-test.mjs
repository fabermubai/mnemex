import crypto from 'node:crypto';

const ws = new WebSocket('ws://127.0.0.1:49222');
const queue = [];
let resolver = null;

function waitCliResult() {
  return new Promise((resolve) => {
    if (queue.length > 0) { resolve(queue.shift()); return; }
    resolver = resolve;
  });
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'cli_result') {
    if (resolver) { const r = resolver; resolver = null; r(msg); }
    else queue.push(msg);
  }
};

function sendCli(command) {
  ws.send(JSON.stringify({ type: 'cli', command }));
  return waitCliResult();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

ws.onopen = async () => {
  ws.send(JSON.stringify({ type: 'auth', token: 'testtoken123' }));
  await sleep(500);

  const author = '975a7dcce9ceb6ab8e743e18baa98b90046742ecab44c81141d12dbafd50214f';

  // ═══════════════════════════════════════════════════
  // STEP 1: Register gated memory
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 1: Register gated memory "gated-analysis-1"');
  console.log('═══════════════════════════════════════════════════════════\n');

  const data = {
    agent: 'mnemex-claude-agent-v1',
    type: 'trading_strategy',
    subject: 'BTC Mean-Reversion Strategy — Post-Capitulation Entry',
    date: '2026-02-23',
    access_tier: 'premium',
    strategy: {
      name: 'BTC Post-Capitulation Mean Reversion',
      thesis: 'After a 49% drawdown from ATH with ETF outflows exceeding $3.8B over 5 weeks, historical patterns suggest a mean-reversion toward the 200-day moving average. Retail accumulation signals (small wallets at highest share since mid-2024) confirm bottom-fishing behavior that precedes recovery.',
      entry: {
        trigger: 'BTC daily close above $65,000 after holding $58,000-$64,000 range for 5+ days',
        confirmation: 'ETF daily inflows turn positive for 3 consecutive days',
        position_size: '15% of portfolio',
      },
      exit: {
        take_profit_1: '$78,000 (50% of position — retest of Feb 1 level)',
        take_profit_2: '$92,000 (remaining 50% — 200-day MA reversion target)',
        stop_loss: '$55,500 (below January 2026 support, ~8.5% risk)',
      },
      risk_management: {
        max_drawdown: '8.5%',
        risk_reward_ratio: '2.7:1 (TP1) / 5.4:1 (TP2)',
        invalidation: 'Blockfills-style contagion event or Fed hawkish surprise',
      },
      timeframe: '2-8 weeks',
      confidence: 0.62,
    },
    disclaimer: 'This is AI-generated analysis for research purposes only. Not financial advice.',
    tags: ['bitcoin', 'trading-strategy', 'mean-reversion', 'premium', 'gated'],
  };

  const dataStr = JSON.stringify(data);
  const contentHash = crypto.createHash('sha256').update(dataStr).digest('hex');

  console.log('  cortex: cortex-crypto');
  console.log('  access: gated');
  console.log('  strategy:', data.strategy.name);
  console.log('  content_hash:', contentHash);
  console.log('  data size:', dataStr.length, 'bytes');
  console.log('  tags: bitcoin, trading-strategy, mean-reversion, premium, gated\n');

  const txCmd = JSON.stringify({
    op: 'register_memory',
    memory_id: 'gated-analysis-1',
    cortex: 'cortex-crypto',
    author: author,
    access: 'gated',
    content_hash: contentHash,
    ts: Date.now(),
    tags: 'bitcoin,trading-strategy,mean-reversion,premium,gated'
  });

  console.log('  Broadcasting TX...');
  const txResult = await sendCli("/tx --command '" + txCmd + "'");
  const txHash = txResult.result?.txo?.tx;
  for (const line of txResult.output) console.log('  ', line);
  console.log('  TX hash:', txHash);
  console.log('');

  // Poll for confirmation
  console.log('  Waiting for confirmation...');
  for (let i = 1; i <= 15; i++) {
    await sleep(5000);
    const poll = await sendCli('/query_memory --memory_id "gated-analysis-1"');
    const out = poll.output.join(' ');
    if (!out.includes('null')) {
      console.log('  Confirmed at poll #' + i);
      break;
    }
    console.log('  Poll #' + i + '... pending');
    if (i === 15) { console.log('  Not confirmed'); ws.close(); process.exit(1); }
  }
  console.log('');

  // ═══════════════════════════════════════════════════
  // STEP 2: query_memory — full on-chain metadata
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 2: query_memory "gated-analysis-1" — on-chain metadata');
  console.log('═══════════════════════════════════════════════════════════');
  const q1 = await sendCli('/query_memory --memory_id "gated-analysis-1"');
  for (const line of q1.output) {
    const match = line.match(/query_memory .+?: (.+)/);
    if (match) {
      const obj = JSON.parse(match[1]);
      console.log('  author:', obj.author.slice(0, 20) + '...');
      console.log('  cortex:', obj.cortex);
      console.log('  access:', obj.access, obj.access === 'gated' ? '← GATED' : '');
      console.log('  content_hash:', obj.content_hash);
      console.log('  tags:', JSON.stringify(obj.tags));
      console.log('  ts:', new Date(obj.ts).toISOString());
    } else {
      console.log(' ', line);
    }
  }
  console.log('');

  // ═══════════════════════════════════════════════════
  // STEP 3: Compare open vs gated — query both side by side
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 3: Compare open vs gated on-chain');
  console.log('═══════════════════════════════════════════════════════════');

  const openQ = await sendCli('/query_memory --memory_id "btc-analysis-tagged"');
  const openLine = openQ.output.join(' ');
  const openMatch = openLine.match(/query_memory .+?: (.+)/);
  if (openMatch) {
    const o = JSON.parse(openMatch[1]);
    console.log('  [OPEN]  btc-analysis-tagged   → access:', o.access, '| cortex:', o.cortex, '| tags:', o.tags?.length || 0);
  }

  const gatedQ = await sendCli('/query_memory --memory_id "gated-analysis-1"');
  const gatedLine = gatedQ.output.join(' ');
  const gatedMatch = gatedLine.match(/query_memory .+?: (.+)/);
  if (gatedMatch) {
    const g = JSON.parse(gatedMatch[1]);
    console.log('  [GATED] gated-analysis-1       → access:', g.access, '| cortex:', g.cortex, '| tags:', g.tags?.length || 0);
  }

  console.log('');
  console.log('  OBSERVATION: Both return FULL metadata from the contract.');
  console.log('  The contract stores access="gated" as metadata but does NOT');
  console.log('  enforce access control at the query level — query_memory is');
  console.log('  a local read-only function that returns whatever is in state.');
  console.log('');
  console.log('  The ACTUAL gate happens in the MemoryIndexer (off-chain):');
  console.log('  when requirePayment=true and a peer sends memory_read for a');
  console.log('  gated memory, the indexer returns "payment_required" with the');
  console.log('  fee amount. The contract only RECORDS the fee split (70/30');
  console.log('  for gated vs 60/40 for open) after payment is verified.');
  console.log('');

  // ═══════════════════════════════════════════════════
  // STEP 4: Verify gated tag indexing
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 4: /query_by_tag --tag "gated"');
  console.log('═══════════════════════════════════════════════════════════');
  const q4 = await sendCli('/query_by_tag --tag "gated"');
  for (const line of q4.output) console.log(' ', line);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 5: /query_by_tag --tag "premium"');
  console.log('═══════════════════════════════════════════════════════════');
  const q5 = await sendCli('/query_by_tag --tag "premium"');
  for (const line of q5.output) console.log(' ', line);
  console.log('');

  // ═══════════════════════════════════════════════════
  // STEP 6: Simulate what happens on the MemoryIndexer side
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 6: Where the gate ACTUALLY lives');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Contract layer (on-chain):');
  console.log('    register_memory → stores access="gated" in mem/<id>');
  console.log('    record_fee      → 70/30 split for read_gated (vs 60/40 open)');
  console.log('    query_memory    → returns metadata freely (no gate)');
  console.log('');
  console.log('  MemoryIndexer layer (off-chain, P2P):');
  console.log('    memory_read + requirePayment=true:');
  console.log('      → no payment_txid? respond "payment_required"');
  console.log('      → payment_txid?    serve data + append record_fee');
  console.log('');
  console.log('  Summary: access="gated" is an ECONOMIC gate, not a');
  console.log('  cryptographic one. The metadata is public (anyone can');
  console.log('  see the memory exists), but the DATA payload is held');
  console.log('  by Memory Nodes who enforce payment before serving it.');
  console.log('');

  // Final balance
  const msb = await sendCli('/msb');
  const msbData = JSON.parse(msb.output[0]);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Final balance:', msbData.peerMsbBalance, 'TNK');
  console.log('═══════════════════════════════════════════════════════════');

  ws.close();
  setTimeout(() => process.exit(0), 300);
};

ws.onerror = (err) => { console.error('Error:', err.message); process.exit(1); };
setTimeout(() => { console.log('Global timeout'); process.exit(1); }, 300000);
