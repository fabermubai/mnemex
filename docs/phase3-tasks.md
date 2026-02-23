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
