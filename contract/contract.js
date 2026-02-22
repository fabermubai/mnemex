import {Contract} from 'trac-peer'

class MnemexContract extends Contract {
    /**
     * MnemexContract — state machine for the Mnemex memory protocol.
     *
     * Handles memory registration, indexing, and querying on the Trac subnet.
     * All state changes go through MSB consensus. Read-only operations are local.
     *
     * Contract rules (inherited from Trac):
     * - No try-catch, no throws, no random values, no HTTP/API calls
     * - Never modify this.op or this.value — use safeClone() for mutations
     * - All this.put() calls go at the END of function execution
     * - Functions must be deterministic
     *
     * @param protocol
     * @param options
     */
    constructor(protocol, options = {}) {
        super(protocol, options);

        // register_memory — records a memory entry in contract state (TX command)
        this.addSchema('register_memory', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                memory_id: { type: "string", min: 1, max: 256 },
                cortex: { type: "string", min: 1, max: 256 },
                author: { type: "string", min: 1, max: 256 },
                access: { type: "enum", values: ["open", "gated"] },
                content_hash: { type: "string", min: 64, max: 64 },
                ts: { type: "number", positive: true, integer: true }
            }
        });

        // query_memory — read-only lookup of a memory entry (local command)
        this.addSchema('query_memory', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                memory_id: { type: "string", min: 1, max: 256 }
            }
        });

        // Feature entry schema for timer and future features
        this.addSchema('feature_entry', {
            key: { type: "string", min: 1, max: 256 },
            value: { type: "any" }
        });

        const _this = this;

        // Timer feature handler — stores currentTime from the Timer feature
        this.addFeature('timer_feature', async function() {
            if (false === _this.check.validateSchema('feature_entry', _this.op)) return;
            if (_this.op.key === 'currentTime') {
                if (null === await _this.get('currentTime')) console.log('timer started at', _this.op.value);
                await _this.put(_this.op.key, _this.op.value);
            }
        });

        // Memory indexer feature handler — stores memory metadata injected by the MemoryIndexer feature.
        // This is the Phase 1 path (no MSB fees). The MemoryIndexer calls this.append()
        // which triggers this handler via autobase consensus.
        this.addFeature('memory_indexer_feature', async function() {
            if (false === _this.check.validateSchema('feature_entry', _this.op)) return;
            if (_this.op.key === 'register_memory') {
                const val = _this.op.value;
                if (!val || !val.memory_id || !val.cortex || !val.author || !val.content_hash || !val.ts) return;

                const memoryId = val.memory_id;
                const existing = await _this.get('mem/' + memoryId);
                if (existing !== null) return;

                const metadata = {
                    author: val.author,
                    cortex: val.cortex,
                    access: val.access || 'open',
                    content_hash: val.content_hash,
                    ts: val.ts
                };

                await _this.put('mem/' + memoryId, metadata);
                await _this.put('mem_by_author/' + val.author + '/' + memoryId, true);
                await _this.put('mem_by_cortex/' + val.cortex + '/' + memoryId, true);
            }
        });
    }

    /**
     * register_memory — record a memory entry in contract state.
     *
     * Creates three storage entries:
     * - mem/<memory_id>: the memory metadata
     * - mem_by_author/<author>/<memory_id>: author index
     * - mem_by_cortex/<cortex>/<memory_id>: cortex index
     */
    async register_memory() {
        const memoryId = this.value.memory_id;
        const author = this.value.author;
        const cortex = this.value.cortex;

        // Check if memory already exists
        const existing = await this.get('mem/' + memoryId);
        if (existing !== null) return new Error('Memory already exists');

        // Build the metadata object (read from this.value, never mutate it)
        const metadata = {
            author: author,
            cortex: cortex,
            access: this.value.access,
            content_hash: this.value.content_hash,
            ts: this.value.ts
        };

        // All put() calls at the end
        await this.put('mem/' + memoryId, metadata);
        await this.put('mem_by_author/' + author + '/' + memoryId, true);
        await this.put('mem_by_cortex/' + cortex + '/' + memoryId, true);
    }

    /**
     * query_memory — read-only function to check if a memory exists.
     * Logs the result to the terminal.
     */
    async query_memory() {
        const memoryId = this.value.memory_id;
        const memory = await this.get('mem/' + memoryId);
        console.log('query_memory', memoryId + ':', memory);
    }
}

export default MnemexContract;
