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
