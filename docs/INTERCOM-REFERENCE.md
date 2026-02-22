# Intercom Codebase Reference

> Annotated guide to the Intercom codebase. Read this to understand the patterns
> before modifying any file.

## File Map

### `index.js` (534 lines) — The App Runner

**What it does:** Wires everything together and starts the peer.

**Key sections:**
1. **Lines 1-17: Imports** — `trac-peer` (Peer, Wallet, config), `trac-msb` (MainSettlementBus), `trac-wallet` (PeerWallet), then local contract/protocol/features.
2. **Lines 18-320: Flag parsing** — Reads CLI flags and env vars. Every config option has a flag equivalent. Pattern: `flags['name'] || env.NAME || default`.
3. **Lines 352-374: MSB + Peer config** — Creates configs using `createMsbConfig(ENV.MAINNET, {...})` and `createPeerConfig(ENV.MAINNET, {...})`.
4. **Lines 376-389: Keypair generation** — Ensures keypair files exist for both MSB and Peer.
5. **Lines 391-403: Start MSB then Peer** — Sequential: MSB must be ready before Peer starts.

```javascript
const msb = new MainSettlementBus(msbConfig);
await msb.ready();

const peer = new Peer({
  config: peerConfig,
  msb,                    // MSB instance passed to Peer
  wallet: new Wallet(),
  protocol: SampleProtocol,  // ← CHANGE TO MnemexProtocol
  contract: SampleContract,  // ← CHANGE TO MnemexContract
});
await peer.ready();
```

6. **Lines 448-453: Timer feature** — Only starts if this peer is admin.

```javascript
const admin = await peer.base.view.get('admin');
if (admin && admin.value === peer.wallet.publicKey && peer.base.writable) {
  const timer = new Timer(peer, { update_interval: 60_000 });
  await peer.protocol.instance.addFeature('timer', timer);
  timer.start();
}
```

7. **Lines 455-530: SC-Bridge + Sidechannel** — Creates and starts both.
8. **Lines 532-533: Terminal** — Starts the interactive CLI.

**Key insight:** The MemoryIndexer feature should be added AFTER peer.ready() and BEFORE terminal.start(), similar to how Timer is added.

---

### `contract/contract.js` (240 lines) — The Smart Contract

**What it does:** Defines the deterministic state machine. Every peer runs the same contract code and must produce the same state.

**Key patterns:**

```javascript
class SampleContract extends Contract {
  constructor(protocol, options = {}) {
    super(protocol, options);

    // Register a function WITHOUT schema (no parameters)
    this.addFunction('storeSomething');

    // Register a function WITH schema (validates input)
    this.addSchema('submitSomething', {
      value: {
        $$strict: true,         // reject unknown fields
        $$type: "object",
        op: { type: "string", min: 1, max: 128 },
        some_key: { type: "string", min: 1, max: 128 }
      }
    });

    // Register a feature handler (receives data from Feature instances)
    this.addFeature('timer_feature', async function() {
      if (false === _this.check.validateSchema('feature_entry', _this.op)) return;
      if (_this.op.key === 'currentTime') {
        await _this.put(_this.op.key, _this.op.value);
      }
    });

    // Register a message handler (receives chat messages)
    this.messageHandler(async function() {
      // _this.op contains the message
    });
  }

  // Contract function — called when TX is processed
  async submitSomething() {
    // this.value = the validated payload from the TX
    // this.address = pubkey hex of TX sender

    const cloned = this.protocol.safeClone(this.value);  // NEVER mutate this.value
    cloned.timestamp = await this.get('currentTime');

    await this.put('submitted_by/' + this.address, cloned);  // put() at END
  }
}
```

**Available contract APIs:**
- `this.get(key)` → returns value or `null`
- `this.put(key, value)` → stores value (must be at end of function)
- `this.address` → pubkey hex of TX sender
- `this.value` → validated TX payload (DO NOT MODIFY)
- `this.op` → raw operation data
- `this.protocol.safeClone(obj)` → deep clone
- `this.protocol.safeBigInt(str)` → safe BigInt conversion
- `this.protocol.safeJsonParse(str)` → safe JSON parse
- `this.protocol.safeJsonStringify(obj)` → safe JSON stringify
- `this.assert(condition, error)` → assertion helper

---

### `contract/protocol.js` (523 lines) — The Protocol / Command Mapper

**What it does:** Maps CLI commands to contract functions, builds TX payloads, handles signing/verification.

**Key sections:**

1. **Constructor** — registers CLI commands, maps them to contract functions
2. **`mapTxCommand(command)`** — translates a CLI command string into a TX payload object with `{ type, value }` where `type` must match a registered contract function name
3. **Signing/verification helpers** — for invites, welcomes, etc.

**The critical method to understand:**
```javascript
mapTxCommand(command) {
  // Parse command string → extract function name and parameters
  // Return { type: 'functionName', value: { op: '...', key: '...' } }
  // The 'type' must match this.addSchema('functionName', ...) in contract
}
```

**For Mnemex:** We need to add `register_memory` and `query_memory` to mapTxCommand, and register corresponding CLI commands.

---

### `features/timer/index.js` (~100 lines) — Example Feature

**What it does:** Periodically injects the current timestamp into the contract.

**Pattern to follow for MemoryIndexer:**

```javascript
export class Timer {
  constructor(peer, options = {}) {
    this.peer = peer;
    this.options = options;
    this.interval = null;
  }

  async start() {
    this.interval = setInterval(async () => {
      // Inject data into the contract via the feature system
      await this.peer.protocol.instance.submitFeature('timer', {
        key: 'currentTime',
        value: Date.now()
      });
    }, this.options.update_interval || 60_000);
  }

  async stop() {
    if (this.interval) clearInterval(this.interval);
  }
}
```

**Key API:** `peer.protocol.instance.submitFeature(featureName, data)` — sends data from a Feature into the contract's feature handler.

---

### `features/sidechannel/` — P2P Messaging

**DO NOT MODIFY.** But understand the API:

- `peer.sidechannel` — the sidechannel instance
- `peer.sidechannel.send(channel, message)` — send to a channel (not documented but inferred)
- Messages arrive via the `onMessage` callback configured in index.js
- Channels are strings (e.g., `0000intercom`, `cortex-crypto`)
- Messages are raw buffers/strings, typically JSON

---

## How intercom-swap Extended Intercom (Reference)

The intercom-swap fork shows the pattern for building on top of Intercom:

1. **Contract is EMPTY** — intercom-swap deliberately does NOT use the contract layer. All logic is in sidechannels + external scripts.
2. **src/ directory added** — contains swap logic, RFQ bots, price oracles, Lightning/Solana integration.
3. **scripts/ directory added** — operational tooling (bash + Node scripts).
4. **features/price/ added** — a new Feature for price feed data.

**Mnemex differs from intercom-swap:** We DO use the contract (for reputation, staking, registry). This makes Mnemex the first project to use the full Trac stack (contract + MSB + sidechannels).

---

## Dependency Chain

```
mnemex (our app)
├── trac-peer       ← Peer runtime, Contract base class, Protocol base class
│   └── trac-msb    ← MSB client (transaction submission, state reading)
├── trac-wallet     ← Keypair generation, signing, address encoding
├── b4a             ← Buffer utilities (used everywhere)
└── pear (runtime)  ← P2P networking (Hyperswarm, HyperDHT, Autobase)
```

**Never install or update these manually.** They're pinned via git commits in package.json.
