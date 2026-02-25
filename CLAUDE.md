# CLAUDE.md — Mnemex Development Guide

## Project Identity

Mnemex is a **decentralized memory protocol for AI agents** built on Trac Network. It's a fork of Intercom (Trac's P2P agent messaging stack) that adds persistent memory, reputation, and a Skill marketplace. Agents write knowledge to the network, other agents read it and pay micro-fees in $TNK. Validators run Memory Nodes that store and serve this data.

**One-liner:** Intercom lets agents talk. Mnemex lets agents remember.

---

## Workflow Orchestration

### 1. Plan Mode Default
- Entrer en plan mode pour TOUTE tâche non triviale (3+ étapes ou décisions d'architecture)
- Si quelque chose dérape, STOP et re-planifier immédiatement — ne pas insister
- Utiliser le plan mode pour les étapes de vérification, pas juste le build
- Écrire les specs détaillées en amont dans `tasks/todo.md`

### 2. Subagent Strategy
- Utiliser des sous-agents pour garder le contexte principal propre
- Déléguer la recherche, l'exploration et l'analyse en parallèle aux sous-agents
- Pour les problèmes complexes, répartir le compute via sous-agents
- Une tâche par sous-agent pour une exécution ciblée

### 3. Self-Improvement Loop
- Après CHAQUE correction de l'utilisateur: mettre à jour `tasks/lessons.md` avec le pattern
- Écrire des règles qui empêchent de refaire la même erreur
- Itérer sur ces leçons jusqu'à ce que le taux d'erreur baisse
- Relire lessons.md au début de chaque session pour le projet concerné

### 4. Verification Before Done
- Ne JAMAIS marquer une tâche comme terminée sans prouver qu'elle fonctionne
- Diff entre main et les changements quand c'est pertinent
- Se demander: "Est-ce qu'un staff engineer approuverait ça?"
- Lancer les tests, vérifier les logs, démontrer la correctness
- Les 3 phases doivent rester à 40/40 tests minimum

### 5. Demand Elegance (Balanced)
- Pour les changements non triviaux: pause et demander "y a-t-il une façon plus élégante?"
- Si un fix semble hacky: "Sachant tout ce que je sais maintenant, implémenter la solution élégante"
- Sauter ça pour les fixes simples et évidents — ne pas sur-ingénierer
- Challenger son propre travail avant de le présenter

### 6. Autonomous Bug Fixing
- Quand un bug est reporté: le corriger directement, pas de hand-holding
- Pointer les logs, erreurs, tests qui échouent — puis les résoudre
- Zéro context switching requis de la part de l'utilisateur
- EXCEPTION: toujours montrer le diff avant de toucher à la logique contract ou aux transactions TNK

## Task Management
1. **Plan First**: écrire le plan dans `tasks/todo.md` avec des items cochables
2. **Verify Plan**: valider avec l'utilisateur avant de commencer l'implémentation
3. **Track Progress**: marquer les items complétés au fur et à mesure
4. **Explain Changes**: résumé haut niveau à chaque étape
5. **Document Results**: ajouter une section review dans `tasks/todo.md`
6. **Capture Lessons**: mettre à jour `tasks/lessons.md` après corrections

## Core Principles
- **Simplicité first**: chaque changement aussi simple que possible, impact minimal du code
- **No Laziness**: trouver les causes racines, pas de fixes temporaires, standards de dev senior
- **Impact minimal**: ne toucher que ce qui est nécessaire, éviter d'introduire des bugs
- **Sécurité**: JAMAIS écrire de clés privées ou secrets dans les fichiers trackés

---

## Repository Structure

```
mnemex/
├── CLAUDE.md              ← YOU ARE HERE
├── docs/
│   ├── WHITEPAPER.md      ← Full Mnemex whitepaper (vision, architecture, economics)
│   ├── TRAC-KNOWLEDGE-BASE.md  ← Complete Trac Network technical documentation
│   ├── TECHNICAL-ARCHITECTURE.md ← Implementation plan mapping whitepaper → code
│   └── INTERCOM-REFERENCE.md    ← Annotated guide to the Intercom codebase we forked
├── contract/
│   ├── protocol.js        ← MnemexProtocol — command mapping, CLI, TX entrypoints
│   └── contract.js        ← MnemexContract — state machine (reputation, staking, registry)
├── features/
│   ├── sidechannel/       ← DO NOT MODIFY — upstream Intercom sidechannel feature
│   ├── sc-bridge/         ← DO NOT MODIFY — upstream Intercom WebSocket bridge
│   ├── timer/             ← DO NOT MODIFY — upstream Intercom timer feature
│   └── memory-indexer/    ← NEW — Mnemex memory indexing feature
├── src/
│   ├── memory/            ← NEW — memory storage engine (SQLite)
│   ├── cortex/            ← NEW — cortex routing logic
│   ├── skills/            ← NEW — skill packaging and registry
│   └── fees/              ← NEW — fee calculation and MSB integration
├── index.js               ← App runner — wires peer + MSB + contract + features
├── package.json
└── SKILL.md               ← Operational guide (from upstream Intercom, will be adapted)
```

---

## STRICT RULES — Do Not Violate

### Code Rules
1. **NEVER modify files in `features/sidechannel/`, `features/sc-bridge/`, `features/timer/`** — these are upstream Intercom and must stay pristine for compatibility.
2. **NEVER change dependency versions** of `trac-peer`, `trac-msb`, `trac-wallet` in package.json unless explicitly asked.
3. **Follow Trac contract rules** (from contract.js comments):
   - No try-catch in contract functions
   - No throws
   - No random values
   - No HTTP/API calls
   - No expensive computations
   - Never modify `this.op` or `this.value` — use `safeClone()` for mutations
   - All `this.put()` calls go at the END of function execution
4. **Contract functions must be deterministic** — every peer must produce the same result for the same input.
5. **Use `this.addSchema()` for all functions that accept user input** — validate everything.
6. **Use `this.addFunction()` only for parameterless functions.**
7. **Sidechannel messages are ephemeral and off-contract** — they don't go through consensus. Use them for queries and data transfer, NOT for state changes.
8. **State changes (reputation, staking, skill registry) MUST go through contract transactions** — they need MSB consensus.

### Architecture Rules
9. **Mnemex is a Trac app (subnet)** — it runs on `trac-peer` with its own contract, connected to the MSB for TNK transactions.
10. **Memory Nodes = Trac validators running a Mnemex peer as indexer** — they store data locally and serve it via sidechannels.
11. **Neurominers = any agent (peer) that publishes data** — they're writers on the subnet.
12. **All fees are in $TNK** — no separate Mnemex token exists or will ever exist.
13. **The entry sidechannel is `0000mnemex`** — this is the discovery/rendezvous point.

### Style Rules
14. Use ES modules (`import`/`export`), not CommonJS.
15. Match the coding style of Intercom's existing files (see `contract/contract.js` and `index.js` for reference).
16. Prefer `const` over `let`. Never use `var`.
17. Use `b4a` (buffer-to-anything) for buffer operations, as Intercom does.
18. Comments in English.

### Transaction Confirmation Rule
19. **ALWAYS show estimated cost and ask for confirmation BEFORE any action that spends TNK.**
    - Display: the action, the Mnemex cost, the network fee (0.03 $TNK), and the total
    - Wait for an explicit "yes" before executing
    - AFTER execution: display the amount spent and the remaining balance
    - Applies to: `register_memory`, `record_fee`, `register_stake`, `record_skill_download`, `register_skill`, `register_cortex`, and any TNK transfer

---

## Key Trac Concepts (Quick Reference)

Read `docs/TRAC-KNOWLEDGE-BASE.md` for full details. Critical concepts:

- **MSB (Main Settlement Bus):** The value/transaction layer. Handles TNK transfers. Fee: 0.03 $TNK/tx (50% validators, 25% deployers, 25% reserved).
- **Subnet:** An app's own P2P network with its contract + state. Peers replicate via Autobase.
- **Peer:** A node in a subnet. Has roles: admin, writer, indexer.
- **Contract + Protocol:** Always a pair. Contract = state machine. Protocol = command mapping + TX format.
- **Feature:** Injectable module that feeds external data into the contract (like an oracle).
- **Sidechannel:** Fast P2P messaging over Hyperswarm. Not consensus-backed. Ephemeral.
- **SC-Bridge:** WebSocket bridge that lets external clients (agents, UIs) interact with sidechannels.
- **`this.put(key, value)` / `this.get(key)`:** Contract state storage (key-value, persisted via Autobase).
- **`this.address`:** The Trac address (pubkey hex) of whoever submitted the current transaction.

---

## Current Development Phase

### PHASE 1 — MVP: Memory Write + Read (NO fees, NO staking)

**Goal:** Prove the core flow works — an agent writes a memory entry, it gets indexed, another agent reads it.

#### Task 1: MnemexContract (`contract/contract.js`)
Transform the example Intercom contract into MnemexContract:
- `register_memory` — record a memory entry in contract state
  - Schema: `{ op, memory_id (string), cortex (string), author (pubkey hex), access ("open"|"gated"), content_hash (string, sha256 of data), ts (number) }`
  - Storage: `put('mem/' + memory_id, { author, cortex, access, content_hash, ts })`
  - Storage: `put('mem_by_author/' + author + '/' + memory_id, true)` (index)
  - Storage: `put('mem_by_cortex/' + cortex + '/' + memory_id, true)` (index)
- `query_memory` — read-only function to check if a memory exists
  - Schema: `{ op, memory_id (string) }`
  - Just does `this.get('mem/' + memory_id)` and logs result
- Keep the `timer_feature` handler from the original (we still use the timer)
- Remove all example functions (`storeSomething`, `submitSomething`, `readSnapshot`, etc.)

#### Task 2: MnemexProtocol (`contract/protocol.js`)
Transform the example Intercom protocol:
- Map `register_memory` as a TX command (requires MSB signature)
- Map `query_memory` as a local command (no TX needed)
- Add CLI commands: `/register_memory`, `/query_memory`, `/list_memories`
- Keep all system commands from the original protocol (admin, writers, indexers, etc.)
- Remove example commands (`storeSomething`, `submitSomething`, etc.)

#### Task 3: MemoryIndexer Feature (`features/memory-indexer/index.js`)
Create a new Feature that:
- Listens to sidechannel messages on cortex channels
- When it receives a `memory_write` message:
  - Stores the actual data payload locally (in `./mnemex-data/` directory, JSON files for MVP)
  - Triggers a contract transaction via `register_memory` to record metadata on-chain
- When it receives a `memory_read` message:
  - Looks up the data locally
  - Responds on the sidechannel with the data
- Message format (sidechannel JSON):
  ```json
  {
    "v": 1,
    "type": "memory_write",
    "memory_id": "sha256-of-content",
    "cortex": "crypto",
    "data": { "key": "BTC/USD", "value": 65000, "source": "binance" },
    "author": "pubkey-hex",
    "ts": 1708617600000,
    "sig": "signature-hex"
  }
  ```

#### Task 4: Wire Everything (`index.js`)
Modify index.js to:
- Import MnemexProtocol and MnemexContract instead of SampleProtocol/SampleContract
- Create and register the MemoryIndexer feature
- Add `--cortex-channels` flag for configurable cortex channels
- Default cortex channel: `cortex-crypto`
- Default entry channel: `0000mnemex`
- Keep ALL existing Intercom wiring (MSB, sidechannel, sc-bridge, timer)

#### Task 5: Basic Test
Create a `test/memory-flow.test.js`:
- Simulate a memory_write message
- Verify it's stored locally
- Simulate a memory_read request
- Verify the response contains the data

### PHASE 2 — Neuronomics: Fees, Staking & Revenue Distribution

**Goal:** Add the economic layer — agents pay TNK to read memories, creators earn revenue, Memory Nodes take a cut. This transforms the MVP into a real protocol with incentives.

**CRITICAL CONSTRAINT:** Contract TXs (MSB type 12) CANNOT transfer TNK. They have no `to`/`amount` fields. Therefore:
- TNK payments happen as **regular MSB transfers** (agent → Mnemex protocol address)
- The **contract tracks accounting** (who earned what, internal balances)
- **Actual TNK payouts** happen via separate MSB transfers (batch, periodic)
- The Memory Node **verifies payment on MSB** before serving data

**Fee structure (from whitepaper):**
- Open Memory Read: 0.06 $TNK total (0.03 Trac network fee + 0.03 Mnemex fee)
- Mnemex fee distribution: 60% creator, 40% Memory Nodes
- Gated Memory: creator sets price, 70% creator / 30% Memory Nodes
- Skill Download: creator sets price, 80% creator / 20% Memory Nodes
- All amounts in smallest unit: 1 $TNK = 1_000_000_000_000_000_000 (18 decimals)
- 0.03 $TNK = "30000000000000000" in bigint string

---

#### Task 6: Fee Accounting in Contract (`contract/contract.js`)

Add fee tracking functions to MnemexContract:

- `record_fee` — called by Memory Nodes after serving data to record the fee split
  - Schema: `{ op, memory_id (string), operation ("read_open"|"read_gated"|"skill_download"), payer (pubkey hex), payment_txid (string, MSB tx hash), amount (string, bigint), ts (number) }`
  - Validation: memory_id must exist in state (`mem/<memory_id>`)
  - Validation: payment_txid must not already be recorded (prevent double-counting)
  - Look up the memory's author from state
  - Calculate split based on operation type:
    - `read_open`: 60% creator, 40% node pool
    - `read_gated`: 70% creator, 30% node pool
    - `skill_download`: 80% creator, 20% node pool
  - Storage: `put('fee/' + payment_txid, { memory_id, operation, payer, amount, creator_share, node_share, ts })`
  - Storage: update `put('balance/' + author, accumulated_creator_balance)` — add creator_share
  - Storage: update `put('balance_nodes', accumulated_node_balance)` — add node_share
  - Storage: update `put('stats/total_fees', running_total)`
  - Storage: update `put('stats/fee_count', running_count)`

- `get_balance` — read-only function to check earnings
  - Schema: `{ op, address (pubkey hex) }`
  - Does `this.get('balance/' + address)` and logs result

- `get_stats` — read-only function for protocol stats
  - No params, reads `stats/total_fees` and `stats/fee_count`

**Important patterns:**
- Use `this.protocol.safeBigInt()` for all amount calculations
- Use bigint strings for all stored amounts (never floating point)
- Always null-check existing balances before adding (default to "0")
- All `put()` calls at end of function

---

#### Task 7: Staking in Contract (`contract/contract.js`)

Add staking functions:

- `register_stake` — Neurominer stakes TNK when publishing a memory
  - Schema: `{ op, memory_id (string), stake_txid (string, MSB transfer hash), stake_amount (string, bigint) }`
  - Validation: memory_id must exist in state
  - Validation: `this.address` must match the memory's author
  - Validation: stake_txid must not already be used
  - Storage: `put('stake/' + memory_id, { author: this.address, stake_txid, stake_amount, ts, status: "active" })`
  - Storage: update `put('staked_by/' + this.address, total_staked_amount)`

- `slash_stake` — penalize bad data (admin-only for MVP)
  - Schema: `{ op, memory_id (string), reason (string, max 256) }`
  - Validation: caller must be admin (check `this.address` against `admin` in state)
  - Validation: stake must exist and be "active"
  - Updates stake status to "slashed"
  - Reduces author's total staked amount

- `release_stake` — release stake after verification period (admin-only for MVP)
  - Schema: `{ op, memory_id (string) }`
  - Validation: admin only
  - Validation: stake must exist and be "active"
  - Updates stake status to "released"

---

#### Task 8: Payment Gate in MemoryIndexer (`features/memory-indexer/index.js`)

Modify the MemoryIndexer to require payment before serving data:

- When receiving a `memory_read` message, the new flow is:
  1. Check if the requested memory exists locally
  2. Check the message for `payment_txid` field
  3. If no `payment_txid` → respond with `{ type: "payment_required", amount: "30000000000000000", pay_to: <node_mnemex_address> }`
  4. If `payment_txid` provided → verify it (for MVP: trust the txid, log it, serve data)
  5. After serving data → trigger a contract TX via `record_fee` to track the fee

- Updated sidechannel message formats:
  ```json
  // Request (with payment)
  {
    "v": 1,
    "type": "memory_read",
    "memory_id": "sha256-hash",
    "payment_txid": "msb-tx-hash",
    "ts": 1708617600000
  }

  // Response (payment required)
  {
    "v": 1,
    "type": "payment_required",
    "memory_id": "sha256-hash",
    "amount": "30000000000000000",
    "pay_to": "trac1...",
    "ts": 1708617600000
  }

  // Response (data delivered)
  {
    "v": 1,
    "type": "memory_response",
    "memory_id": "sha256-hash",
    "found": true,
    "data": { ... },
    "fee_recorded": true,
    "ts": 1708617600000
  }
  ```

- Add a `--require-payment` flag (default: false for testing, true for production)
  - When false: serves data without payment (Phase 1 behavior, for development)
  - When true: requires payment_txid in memory_read requests

---

#### Task 9: Protocol Updates (`contract/protocol.js`)

Add CLI commands for the new contract functions:

- `/record_fee --memory-id <id> --operation <type> --payer <key> --payment-txid <hash> --amount <bigint>`
- `/get_balance --address <pubkey>`
- `/get_stats`
- `/register_stake --memory-id <id> --stake-txid <hash> --stake-amount <bigint>`
- `/slash_stake --memory-id <id> --reason <text>`
- `/release_stake --memory-id <id>`
- `/list_fees` — show recent fee records (read from state, last 10)
- `/list_stakes` — show stakes for current peer address

Map each to the corresponding contract function in `mapTxCommand()`.
State-changing commands (record_fee, register_stake, slash_stake, release_stake) → TX commands.
Read-only commands (get_balance, get_stats, list_fees, list_stakes) → local commands.

---

#### Task 10: Phase 2 Tests (`test/fees.test.js`)

Create tests:

- `record_fee` correctly splits 60/40 for open memory reads
- `record_fee` correctly splits 70/30 for gated memory reads
- `record_fee` correctly splits 80/20 for skill downloads
- `record_fee` rejects duplicate payment_txid
- `record_fee` rejects non-existent memory_id
- Balance accumulates correctly across multiple fees
- `register_stake` links stake to memory and author
- `register_stake` rejects wrong author
- `slash_stake` requires admin role
- `slash_stake` marks stake as slashed
- MemoryIndexer returns `payment_required` when no payment_txid
- MemoryIndexer serves data when payment_txid provided
- Stats (total_fees, fee_count) accumulate correctly

After all tests pass → git commit "Phase 2 complete — Neuronomics fees and staking" and push.

### PHASE 3 — Skills & Multi-Cortex

**Goal:** Add procedural memory — agents don't just read data, they download *capabilities*. A Skill is a packaged piece of knowledge or logic that an agent can purchase and use. Also add dynamic cortex channel management so the network can grow beyond crypto.

**What already exists from Phase 2:**
- `record_fee` already handles `skill_download` operation type (80% creator / 20% nodes)
- Payment gate in MemoryIndexer (require payment_txid pattern)
- All fee accounting and staking infrastructure

**Skill concept:** A Skill is a JSON package with metadata + payload. Think of it like an npm package for agent capabilities: trading strategies, prompt templates, data analysis pipelines, API integration guides, etc.

---

#### Task 11: Skill Registry in Contract (`contract/contract.js`)

Add skill management functions:

- `register_skill` — publish a new Skill to the registry
  - Schema: `{ op, skill_id (string, sha256 of package), name (string, max 128), description (string, max 1024), cortex (string, max 64), price (string, bigint TNK — "0" for free), version (string, max 16, e.g. "1.0.0") }`
  - Validation: `this.address` is the author (recorded automatically)
  - Validation: skill_id must not already exist
  - Storage: `put('skill/' + skill_id, { author: this.address, name, description, cortex, price, version, ts, status: "active", downloads: 0 })`
  - Storage: `put('skill_by_author/' + this.address + '/' + skill_id, true)`
  - Storage: `put('skill_by_cortex/' + cortex + '/' + skill_id, true)`

- `update_skill` — update metadata of an existing Skill (author only)
  - Schema: `{ op, skill_id (string), description (string, max 1024, optional), price (string, bigint, optional), version (string, max 16, optional), status ("active"|"deprecated", optional) }`
  - Validation: `this.address` must match skill's author
  - Validation: skill must exist
  - Only update fields that are provided (keep existing values for others)
  - Storage: `put('skill/' + skill_id, updated_skill_object)`

- `record_skill_download` — track a completed skill download (called by Memory Node after delivery)
  - Schema: `{ op, skill_id (string), buyer (pubkey hex), payment_txid (string), amount (string, bigint) }`
  - Validation: skill must exist and be "active"
  - Validation: payment_txid must not already be recorded
  - Increment skill's download counter
  - Trigger fee split via same logic as `record_fee` with operation `skill_download` (80/20)
  - Storage: `put('skill_download/' + payment_txid, { skill_id, buyer, amount, ts })`
  - Storage: update `put('skill/' + skill_id, ...)` with incremented downloads
  - Storage: update balances (same as record_fee: balance/<author>, balance_nodes, stats)

- `query_skill` — read-only, look up a skill by ID
  - Schema: `{ op, skill_id (string) }`
  - Does `this.get('skill/' + skill_id)` and logs result

---

#### Task 12: Skill Storage & Delivery in MemoryIndexer (`features/memory-indexer/index.js`)

Extend the MemoryIndexer to handle skills:

- **New message types on sidechannel:**

  `skill_publish` — Neurominer publishes a skill package to Memory Nodes
  ```json
  {
    "v": 1,
    "type": "skill_publish",
    "skill_id": "sha256-of-package",
    "name": "BTC Momentum Strategy",
    "description": "Detects momentum shifts using...",
    "cortex": "crypto",
    "price": "100000000000000000",
    "version": "1.0.0",
    "package": {
      "format": "mnemex-skill-v1",
      "type": "strategy",
      "content": { ... },
      "dependencies": [],
      "entry_point": "execute"
    },
    "author": "pubkey-hex",
    "ts": 1708617600000,
    "sig": "signature-hex"
  }
  ```

  `skill_request` — Agent requests to download a skill
  ```json
  {
    "v": 1,
    "type": "skill_request",
    "skill_id": "sha256-hash",
    "payment_txid": "msb-tx-hash",
    "ts": 1708617600000
  }
  ```

  `skill_deliver` — Memory Node delivers the skill package
  ```json
  {
    "v": 1,
    "type": "skill_deliver",
    "skill_id": "sha256-hash",
    "found": true,
    "package": { ... },
    "ts": 1708617600000
  }
  ```

  `skill_catalog` — Agent requests available skills for a cortex
  ```json
  {
    "v": 1,
    "type": "skill_catalog",
    "cortex": "crypto",
    "ts": 1708617600000
  }
  ```

  `skill_catalog_response` — Memory Node responds with skill list
  ```json
  {
    "v": 1,
    "type": "skill_catalog_response",
    "cortex": "crypto",
    "skills": [
      { "skill_id": "...", "name": "...", "description": "...", "price": "...", "version": "...", "downloads": 0 }
    ],
    "ts": 1708617600000
  }
  ```

- **Implementation details:**
  - Store skill packages in `./mnemex-data/skills/<skill_id>.json`
  - On `skill_publish`: save package locally, trigger `register_skill` contract TX
  - On `skill_request`: check payment (same pattern as memory_read payment gate), deliver package, trigger `record_skill_download` contract TX
  - On `skill_catalog`: scan local `./mnemex-data/skills/` directory, return metadata list (no package contents)
  - Skills channel: listen on `mnemex-skills` channel in addition to cortex channels

- **Add `mnemex-skills` to default listened channels** in the MemoryIndexer constructor

---

#### Task 13: Protocol Updates (`contract/protocol.js`)

Add CLI commands for skill functions:

- `/register_skill --skill-id <hash> --name <name> --description <desc> --cortex <cortex> --price <bigint> --version <ver>` → TX command
- `/update_skill --skill-id <hash> [--description <desc>] [--price <bigint>] [--version <ver>] [--status <active|deprecated>]` → TX command
- `/record_skill_download --skill-id <hash> --buyer <pubkey> --payment-txid <hash> --amount <bigint>` → TX command
- `/query_skill --skill-id <hash>` → local command
- `/list_skills` → local command (scan `skill/` prefix in state, show last 10)
- `/list_skills_by_cortex --cortex <name>` → local command (scan `skill_by_cortex/<cortex>/` prefix)

Map state-changing commands to TX in `mapTxCommand()`.
Read-only commands as local in `customCommand()`.

Add a new section in `printOptions()`: "Mnemex Skill Commands".

---

#### Task 14: Multi-Cortex Channel Management

Currently cortex channels are passed via `--cortex-channels` flag at startup. Add dynamic management:

- **In `contract/contract.js`:**
  - `register_cortex` — register a new cortex channel (admin only for MVP)
    - Schema: `{ op, cortex_name (string, max 64), description (string, max 256) }`
    - Validation: admin only
    - Validation: cortex_name must not already exist
    - Storage: `put('cortex/' + cortex_name, { description, created_by: this.address, ts, status: "active" })`

  - `list_cortex` — read-only, list all registered cortex channels
    - No params, scans `cortex/` prefix

- **In `contract/protocol.js`:**
  - `/register_cortex --name <name> --description <desc>` → TX command (admin only)
  - `/list_cortex` → local command

- **In `features/memory-indexer/index.js`:**
  - On startup, read registered cortex channels from contract state (via `this.peer.base.view.get()`)
  - Listen to all active cortex channels + `mnemex-skills` + `mnemex-ops`
  - Log which channels are being monitored

- **In `index.js`:**
  - Keep `--cortex-channels` as override/bootstrap, but MemoryIndexer should also check contract state
  - Add `--enable-skills` flag (default: true) — whether to listen on `mnemex-skills` channel

---

#### Task 15: Phase 3 Tests (`test/skills.test.js`)

Create tests:

- `register_skill` creates skill entry with all fields
- `register_skill` rejects duplicate skill_id
- `update_skill` updates only provided fields
- `update_skill` rejects non-author
- `record_skill_download` increments download counter
- `record_skill_download` applies 80/20 fee split
- `record_skill_download` rejects duplicate payment_txid
- `record_skill_download` rejects inactive/non-existent skill
- MemoryIndexer handles `skill_publish` (stores package, triggers contract TX)
- MemoryIndexer handles `skill_request` with payment (delivers package)
- MemoryIndexer handles `skill_request` without payment (returns payment_required)
- MemoryIndexer handles `skill_catalog` (returns skill list for cortex)
- `register_cortex` creates cortex entry (admin only)
- `register_cortex` rejects non-admin

After all tests pass → git commit "Phase 3 complete — Skills registry and multi-cortex" and push.

---

## Intercom Code Patterns (FOLLOW THESE)

### How to add a contract function with schema:
```javascript
// In constructor:
this.addSchema('my_function', {
    value: {
        $$strict: true,
        $$type: "object",
        op: { type: "string", min: 1, max: 128 },
        my_field: { type: "string", min: 1, max: 256 }
    }
});

// As class method:
async my_function() {
    const existing = await this.get('my_key/' + this.value.my_field);
    if (existing !== null) return new Error('Already exists');

    // Mutations: always clone, never modify this.value
    const entry = this.protocol.safeClone(this.value);
    entry.timestamp = await this.get('currentTime');

    // put() always at the end
    await this.put('my_key/' + this.value.my_field, entry);
}
```

### How to add a Feature:
```javascript
// features/my-feature/index.js
export class MyFeature {
    constructor(peer, options = {}) {
        this.peer = peer;
        this.options = options;
    }

    async start() {
        // Feature logic here
    }
}

// In contract constructor, register the feature handler:
this.addFeature('my_feature_feature', async function() {
    if (false === _this.check.validateSchema('feature_entry', _this.op)) return;
    if (_this.op.key === 'my_data') {
        await _this.put(_this.op.key, _this.op.value);
    }
});

// In index.js, wire it:
const myFeature = new MyFeature(peer, { /* opts */ });
await peer.protocol.instance.addFeature('my_feature', myFeature);
myFeature.start();
```

### How sidechannel messages work:
```javascript
// Sending (from any peer):
peer.sidechannel.send('cortex-crypto', JSON.stringify({
    v: 1,
    type: 'memory_write',
    // ...payload
}));

// Receiving (via onMessage callback or SC-Bridge):
// Messages arrive as JSON on the channel, parsed by the listener
```

### How MSB transactions work:
```javascript
// The protocol's mapTxCommand() defines which commands create MSB transactions.
// When a user runs /register_memory, the protocol:
// 1. Builds the TX payload
// 2. Signs it with the peer's wallet
// 3. Submits to MSB
// 4. MSB validators confirm it (0.03 $TNK fee)
// 5. Contract function executes on all peers
```

---

## Reference Files

| File | When to read | What it contains |
|------|-------------|------------------|
| `tasks/todo.md` | Au début de chaque session | Plan courant, items à faire, suivi de progression |
| `tasks/lessons.md` | Au début de chaque session | Erreurs passées à ne pas répéter, patterns appris |
| `docs/WHITEPAPER.md` | For understanding WHY | Vision, problem, economics, use cases |
| `docs/TRAC-KNOWLEDGE-BASE.md` | For Trac API details | MSB commands, RPC API, peer setup, contract rules |
| `docs/TECHNICAL-ARCHITECTURE.md` | For implementation plan | Mapping of whitepaper concepts to code modules |
| `docs/INTERCOM-REFERENCE.md` | For code patterns | Annotated walkthrough of Intercom's codebase |
| `SKILL.md` | For operational details | How to run peers, flags, SC-Bridge config |
| `contract/contract.js` | For contract patterns | Example contract with schemas, features, handlers |
| `contract/protocol.js` | For protocol patterns | Command mapping, TX building, CLI registration |
| `index.js` | For wiring patterns | How peer + MSB + features are assembled |

---

## Vocabulary

| Whitepaper Term | Code Equivalent |
|-----------------|-----------------|
| Memory Node | Peer with indexer role running MemoryIndexer feature |
| Neurominer | Any peer (writer) that publishes data via sidechannel |
| Cortex | A sidechannel topic/channel (e.g. `cortex-crypto`) |
| Open Memory | Memory entry with `access: "open"` |
| Gated Memory | Memory entry with `access: "gated"` |
| Skill | A registered package in the contract's skill registry |
| Neuronomics | The fee distribution system (Phase 2) |
| $TNK | Trac Network's native token, used for all fees |
| MSB | Main Settlement Bus — Trac's transaction/settlement layer |
