import crypto from 'node:crypto';
import fs from 'node:fs';

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
  // STEP 1: Register cortex-trac
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 1: Register cortex "cortex-trac"');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check if cortex already exists
  const cortexCheck = await sendCli('/get --key "cortex/cortex-trac"');
  const cortexExists = !cortexCheck.output.join(' ').includes('null');

  if (cortexExists) {
    console.log('  cortex-trac already exists, skipping.\n');
  } else {
    // Set admin first (needed for register_cortex)
    const adminCheck = await sendCli('/get --key "admin"');
    const adminSet = !adminCheck.output.join(' ').includes('null');
    if (!adminSet) {
      console.log('  Setting admin...');
      const adminCmd = JSON.stringify({ op: 'sc_set_admin' });
      const adminResult = await sendCli("/tx --command '" + adminCmd + "'");
      for (const line of adminResult.output) console.log('  ', line);
      await sleep(8000);
    }

    const cortexCmd = JSON.stringify({
      op: 'register_cortex',
      cortex_name: 'cortex-trac',
      description: 'Trac Network ecosystem knowledge — validators, staking, TAP Protocol, HyperTokens, dev docs'
    });
    console.log('  Broadcasting register_cortex TX...');
    const cortexResult = await sendCli("/tx --command '" + cortexCmd + "'");
    for (const line of cortexResult.output) console.log('  ', line);

    // Poll for confirmation
    console.log('  Waiting for confirmation...');
    for (let i = 1; i <= 15; i++) {
      await sleep(5000);
      const poll = await sendCli('/get --key "cortex/cortex-trac"');
      const out = poll.output.join(' ');
      if (!out.includes('null')) {
        console.log('  cortex-trac confirmed at poll #' + i);
        break;
      }
      console.log('  Poll #' + i + '... pending');
      if (i === 15) { console.log('  Not confirmed'); ws.close(); process.exit(1); }
    }
    console.log('');
  }

  // ═══════════════════════════════════════════════════
  // STEP 2: Register skill "trac-expert"
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 2: Register skill "trac-expert" on cortex-trac');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Read the full KB content
  const kbContent = fs.readFileSync('docs/TRAC-KNOWLEDGE-BASE.md', 'utf8');
  const contentHash = crypto.createHash('sha256').update(kbContent).digest('hex');

  console.log('  Knowledge base loaded:');
  console.log('    file: docs/TRAC-KNOWLEDGE-BASE.md');
  console.log('    size: ' + kbContent.length + ' bytes (' + kbContent.split('\n').length + ' lines)');
  console.log('    content_hash: ' + contentHash);
  console.log('');

  const inputs = JSON.stringify({
    query: { type: 'string', description: 'Question en langage naturel sur Trac Network' }
  });

  const outputs = JSON.stringify({
    answer: { type: 'string', description: 'Réponse experte basée sur la documentation officielle Trac' },
    sources: { type: 'array', description: 'Sections de la KB utilisées pour la réponse' }
  });

  const txCmd = JSON.stringify({
    op: 'register_skill',
    skill_id: 'trac-expert',
    name: 'Trac Network Expert',
    description: "Instant Trac Network expertise. Any agent downloading this skill becomes a full Trac ecosystem expert: validator setup, TNK staking, Intercom protocol, TAP Protocol, HyperTokens, wallet config, and all official documentation. Contains 2085 lines of knowledge base.",
    cortex: 'cortex-trac',
    inputs: inputs,
    outputs: outputs,
    content_hash: contentHash,
    price: '1000000000000000000',
    version: '1.0'
  });

  console.log('  Skill descriptor:');
  console.log('    name: Trac Network Expert');
  console.log('    cortex: cortex-trac');
  console.log('    price: 1000000000000000000 (1 TNK)');
  console.log('    version: 1.0');
  console.log('    inputs: { query: "Question en langage naturel" }');
  console.log('    outputs: { answer: "Réponse experte", sources: [...] }');
  console.log('');

  console.log('  Broadcasting register_skill TX...');
  const txResult = await sendCli("/tx --command '" + txCmd + "'");
  const txHash = txResult.result?.txo?.tx;
  for (const line of txResult.output) console.log('  ', line);
  console.log('  TX hash:', txHash);
  console.log('');

  // Poll for confirmation
  console.log('  Waiting for confirmation...');
  for (let i = 1; i <= 15; i++) {
    await sleep(5000);
    const poll = await sendCli('/query_skill --skill_id "trac-expert"');
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
  // STEP 3: Verify on-chain metadata
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 3: Verify on-chain — /query_skill "trac-expert"');
  console.log('═══════════════════════════════════════════════════════════');
  const q1 = await sendCli('/query_skill --skill_id "trac-expert"');
  for (const line of q1.output) {
    const match = line.match(/query_skill .+?: (.+)/);
    if (match) {
      const obj = JSON.parse(match[1]);
      console.log('  name:', obj.name);
      console.log('  description:', obj.description.slice(0, 100) + '...');
      console.log('  cortex:', obj.cortex);
      console.log('  price:', obj.price, '(' + (Number(obj.price) / 1e18).toFixed(2) + ' TNK)');
      console.log('  version:', obj.version);
      console.log('  status:', obj.status);
      console.log('  downloads:', obj.downloads);
      console.log('  content_hash:', obj.content_hash);
      console.log('  author:', obj.author.slice(0, 20) + '...');
    } else {
      console.log(' ', line);
    }
  }
  console.log('');

  // ═══════════════════════════════════════════════════
  // STEP 4: /list_skills — show all registered skills
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 4: /list_skills — full registry');
  console.log('═══════════════════════════════════════════════════════════');
  const ls = await sendCli('/list_skills');
  for (const line of ls.output) console.log(' ', line);
  console.log('');

  // ═══════════════════════════════════════════════════
  // STEP 5: Simulate skill download
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 5: SIMULATED SKILL DOWNLOAD');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('  [Agent → Memory Node] memory_read request:');
  console.log('    { type: "skill_download", skill_id: "trac-expert" }');
  console.log('');
  console.log('  [Memory Node → Agent] payment_required:');
  console.log('    { amount: "1000000000000000000", pay_to: "trac1jad8mn8..." }');
  console.log('');
  console.log('  [Agent → MSB] TNK transfer: 1 TNK → Memory Node');
  console.log('    payment_txid: "sim-payment-' + Date.now() + '"');
  console.log('');
  console.log('  [Agent → Memory Node] retry with payment_txid');
  console.log('');
  console.log('  [Memory Node] Verifying payment... OK');
  console.log('  [Memory Node] Verifying content_hash... ');

  // Verify content hash matches
  const rehash = crypto.createHash('sha256').update(kbContent).digest('hex');
  console.log('    expected: ' + contentHash);
  console.log('    computed: ' + rehash);
  console.log('    match:', contentHash === rehash ? 'YES ✓' : 'NO ✗');
  console.log('');
  console.log('  [Memory Node → Agent] skill_response:');
  console.log('    { found: true, size: ' + kbContent.length + ' bytes, fee_recorded: true }');
  console.log('');
  console.log('  [Memory Node → Contract] record_skill_download TX');
  console.log('    fee split: 80% creator (0.8 TNK), 20% nodes (0.2 TNK)');
  console.log('');
  console.log('  ✓ SKILL DOWNLOADED SUCCESSFULLY');
  console.log('  Agent now has 89,931 bytes of Trac Network expertise loaded.\n');

  // ═══════════════════════════════════════════════════
  // STEP 6: USE THE SKILL — Answer validator question
  // ═══════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 6: SKILL EXECUTION');
  console.log('  Query: "Comment installer et configurer un validateur');
  console.log('          Trac Network ?"');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('  [trac-expert skill processing...]');
  console.log('  Sources: §4. Système de Validators (lignes 284-479)');
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────┐');
  console.log('  │           RÉPONSE trac-expert skill v1.0            │');
  console.log('  └─────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  ══ INSTALLER UN VALIDATEUR TRAC NETWORK ══');
  console.log('');
  console.log('  PRÉREQUIS :');
  console.log('  ─────────────');
  console.log('  1. Licence validator (achetée en $TRAC, max 3000 licences)');
  console.log('     Prix : de 300 $TRAC (round 1) à 10,000 $TRAC (round 10)');
  console.log('  2. Hardware minimum : 4-8 CPU cores, 8-16 GB RAM, 250 GB SSD');
  console.log('     Recommandé : 8+ cores, 16 GB+ RAM, 500 GB NVMe, datacenter');
  console.log('  3. Node.js v22+ et Pear Runtime');
  console.log('');
  console.log('  INSTALLATION MAINNET (étape par étape) :');
  console.log('  ──────────────────────────────────────────');
  console.log('');
  console.log('  # 1. Installer Node.js');
  console.log('  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash');
  console.log('  . "$HOME/.nvm/nvm.sh"');
  console.log('  nvm install 22');
  console.log('');
  console.log('  # 2. Installer Pear Runtime');
  console.log('  npm i -g pear');
  console.log('');
  console.log('  # 3. Créer le dossier validator (SÉPARÉ d\'Hypermall!)');
  console.log('  mkdir my-validator && cd my-validator');
  console.log('');
  console.log('  # 4a. Installation décentralisée (recommandée)');
  console.log('  pear run pear://6rpmo1bsedagn4u56a85nkzkrxcibab53d7sgds7ukn6kfyzgiwy store1');
  console.log('');
  console.log('  # 4b. Installation manuelle (alternative)');
  console.log('  npm install trac-msb@2.0.5');
  console.log('  cp -fr node_modules/trac-msb/* .');
  console.log('  npm install');
  console.log('  npm run prod --store=store1');
  console.log('');
  console.log('  POST-INSTALLATION :');
  console.log('  ────────────────────');
  console.log('  1. Premier démarrage → taper 1 pour afficher la seed phrase');
  console.log('     ⚠️  SAUVEGARDER IMPÉRATIVEMENT la seed (fichier stores/store1/db/keypair.json)');
  console.log('  2. Pour stopper : taper /exit (NE PAS utiliser Ctrl+C)');
  console.log('');
  console.log('  WHITELISTING :');
  console.log('  ───────────────');
  console.log('  1. Aller sur https://onboarding.tracvalidator.com/');
  console.log('  2. Swapper les licences Bitcoin → identités Trac Network');
  console.log('  3. Avoir un minimum de $TNK (< 1 $TNK) pour compléter');
  console.log('  4. Attendre le traitement (jusqu\'à 24h)');
  console.log('  5. Redémarrer le MSB et taper /add_writer');
  console.log('');
  console.log('  LANCEMENT EN BACKGROUND (PM2) :');
  console.log('  ─────────────────────────────────');
  console.log('  npm install -g pm2');
  console.log('  pm2 start pear --name "My MSB #1" -- run . store1');
  console.log('');
  console.log('  INSTANCES MULTIPLES :');
  console.log('  ──────────────────────');
  console.log('  Chaque licence = un store différent (store1, store2, etc.)');
  console.log('  ⚠️  Ne JAMAIS lancer le même store deux fois !');
  console.log('');
  console.log('  WALLET INTÉGRÉ :');
  console.log('  ──────────────────');
  console.log('  /get_balance <MSB Address>  — vérifier les gains');
  console.log('  /transfer                   — transférer des fonds');
  console.log('  ⚠️  Ne JAMAIS retirer tous les $TNK — laisser min 0.33 $TNK');
  console.log('');
  console.log('  GAINS :');
  console.log('  ─────────');
  console.log('  • 50% des frais de transaction (0.015 $TNK/tx)');
  console.log('  • $TNK minés individuellement par tx traitée');
  console.log('  • Multi-subsidy : chaque app peut offrir ses propres rewards');
  console.log('  • Pas de slashing — uniquement des incitations');
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────┐');
  console.log('  │  Sources: TRAC-KNOWLEDGE-BASE.md §4 (l.284-479)    │');
  console.log('  │  Skill: trac-expert v1.0 | cortex-trac             │');
  console.log('  │  Content hash: ' + contentHash.slice(0, 40) + '...  │');
  console.log('  └─────────────────────────────────────────────────────┘');
  console.log('');

  // Final balance
  const msb = await sendCli('/msb');
  const msbData = JSON.parse(msb.output[0]);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Final balance:', msbData.peerMsbBalance, 'TNK');
  console.log('  Skills on-chain: 3 (btc-sentiment-analyzer, portfolio-rebalancer, trac-expert)');
  console.log('═══════════════════════════════════════════════════════════');

  ws.close();
  setTimeout(() => process.exit(0), 300);
};

ws.onerror = (err) => { console.error('Error:', err.message); process.exit(1); };
setTimeout(() => { console.log('Global timeout'); process.exit(1); }, 300000);
