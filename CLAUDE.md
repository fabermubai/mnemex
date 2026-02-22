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
