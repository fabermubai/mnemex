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
  // STEP 1: Register a Skill on cortex-crypto
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 1: Register skill "btc-sentiment-analyzer-v1"');
  console.log('═══════════════════════════════════════════════════════════\n');

  const skillContent = {
    type: 'prompt_chain',
    runtime: 'mnemex-agent-v1',
    steps: [
      {
        id: 'fetch_data',
        action: 'web_search',
        query: 'Bitcoin sentiment {date} crypto market fear greed',
        output: 'raw_articles'
      },
      {
        id: 'analyze',
        action: 'llm_analyze',
        input: '{raw_articles}',
        prompt: 'Analyze the overall Bitcoin market sentiment from these sources. Score from -1 (extreme fear) to +1 (extreme greed). Identify key drivers.',
        output: 'sentiment_report'
      },
      {
        id: 'store',
        action: 'mnemex_write',
        cortex: 'cortex-crypto',
        data: '{sentiment_report}',
        tags: 'bitcoin,sentiment,daily'
      }
    ]
  };

  const contentStr = JSON.stringify(skillContent);
  const contentHash = crypto.createHash('sha256').update(contentStr).digest('hex');

  const inputs = JSON.stringify({
    date: { type: 'string', format: 'YYYY-MM-DD', description: 'Target date for sentiment analysis' },
    sources: { type: 'array', optional: true, description: 'Override default news sources' }
  });

  const outputs = JSON.stringify({
    sentiment_score: { type: 'number', range: [-1, 1], description: 'Aggregate sentiment score' },
    drivers: { type: 'array', description: 'Key sentiment drivers identified' },
    memory_id: { type: 'string', description: 'ID of the stored memory on Mnemex' }
  });

  console.log('  name: BTC Sentiment Analyzer');
  console.log('  cortex: cortex-crypto');
  console.log('  price: 50000000000000000 (0.05 TNK)');
  console.log('  content_hash:', contentHash);
  console.log('  content size:', contentStr.length, 'bytes');
  console.log('  inputs:', inputs.slice(0, 80) + '...');
  console.log('  outputs:', outputs.slice(0, 80) + '...\n');

  const txCmd = JSON.stringify({
    op: 'register_skill',
    skill_id: 'btc-sentiment-analyzer-v1',
    name: 'BTC Sentiment Analyzer',
    description: 'Automated Bitcoin market sentiment analysis using web search + LLM. Produces daily sentiment scores and stores results in Mnemex.',
    cortex: 'cortex-crypto',
    inputs: inputs,
    outputs: outputs,
    content_hash: contentHash,
    price: '50000000000000000',
    version: '1.0'
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
    const poll = await sendCli('/query_skill --skill_id "btc-sentiment-analyzer-v1"');
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
  // STEP 2: Query the skill
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 2: /query_skill "btc-sentiment-analyzer-v1"');
  console.log('═══════════════════════════════════════════════════════════');
  const q1 = await sendCli('/query_skill --skill_id "btc-sentiment-analyzer-v1"');
  for (const line of q1.output) {
    const match = line.match(/query_skill .+?: (.+)/);
    if (match) {
      const obj = JSON.parse(match[1]);
      console.log('  name:', obj.name);
      console.log('  description:', obj.description);
      console.log('  cortex:', obj.cortex);
      console.log('  price:', obj.price, '(' + (Number(obj.price) / 1e18).toFixed(3) + ' TNK)');
      console.log('  version:', obj.version);
      console.log('  status:', obj.status);
      console.log('  downloads:', obj.downloads);
      console.log('  content_hash:', obj.content_hash);
      console.log('  inputs:', obj.inputs);
      console.log('  outputs:', obj.outputs);
      console.log('  author:', obj.author.slice(0, 20) + '...');
    } else {
      console.log(' ', line);
    }
  }
  console.log('');

  // ═══════════════════════════════════════════════════
  // STEP 3: Register a second skill
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 3: Register second skill "portfolio-rebalancer-v1"');
  console.log('═══════════════════════════════════════════════════════════\n');

  const skill2Content = {
    type: 'computation',
    runtime: 'mnemex-agent-v1',
    steps: [
      { id: 'read_portfolio', action: 'input', fields: ['holdings', 'target_allocation'] },
      { id: 'compute', action: 'rebalance', strategy: 'threshold_5pct', output: 'trades' },
      { id: 'report', action: 'mnemex_write', cortex: 'cortex-crypto', data: '{trades}', tags: 'portfolio,rebalance' }
    ]
  };
  const content2Str = JSON.stringify(skill2Content);
  const content2Hash = crypto.createHash('sha256').update(content2Str).digest('hex');

  const inputs2 = JSON.stringify({
    holdings: { type: 'object', description: 'Current portfolio holdings { symbol: amount }' },
    target_allocation: { type: 'object', description: 'Target allocation percentages { symbol: pct }' }
  });
  const outputs2 = JSON.stringify({
    trades: { type: 'array', description: 'List of trades to execute for rebalancing' },
    delta: { type: 'object', description: 'Deviation from target before/after rebalance' }
  });

  const txCmd2 = JSON.stringify({
    op: 'register_skill',
    skill_id: 'portfolio-rebalancer-v1',
    name: 'Portfolio Rebalancer',
    description: 'Computes optimal rebalancing trades for a crypto portfolio based on target allocation with 5% threshold trigger.',
    cortex: 'cortex-crypto',
    inputs: inputs2,
    outputs: outputs2,
    content_hash: content2Hash,
    price: '100000000000000000',
    version: '1.0'
  });

  console.log('  Broadcasting TX...');
  const tx2Result = await sendCli("/tx --command '" + txCmd2 + "'");
  for (const line of tx2Result.output) console.log('  ', line);
  console.log('');

  console.log('  Waiting for confirmation...');
  for (let i = 1; i <= 15; i++) {
    await sleep(5000);
    const poll = await sendCli('/query_skill --skill_id "portfolio-rebalancer-v1"');
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
  // STEP 4: /list_skills — show all registered skills
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 4: /list_skills');
  console.log('═══════════════════════════════════════════════════════════');
  const ls = await sendCli('/list_skills');
  for (const line of ls.output) console.log(' ', line);
  console.log('');

  // ═══════════════════════════════════════════════════
  // STEP 5: /list_skills_by_cortex
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 5: /list_skills_by_cortex --cortex "cortex-crypto"');
  console.log('═══════════════════════════════════════════════════════════');
  const lsc = await sendCli('/list_skills_by_cortex --cortex "cortex-crypto"');
  for (const line of lsc.output) console.log(' ', line);
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
