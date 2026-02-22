# CLAUDE.md — Mnemex Development Guide

## Project Identity

Mnemex is a **decentralized memory protocol for AI agents** built on Trac Network. It's a fork of Intercom (Trac's P2P agent messaging stack) that adds persistent memory, reputation, and a Skill marketplace. Agents write knowledge to the network, other agents read it and pay micro-fees in $TNK. Validators run Memory Nodes that store and serve this data.

**One-liner:** Intercom lets agents talk. Mnemex lets agents remember.

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
