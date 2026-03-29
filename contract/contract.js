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
        // tags is optional, comma-separated string (e.g. "bitcoin,market-analysis")
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
                ts: { type: "number", positive: true, integer: true },
                tags: { type: "string", optional: true, max: 1024 },
                trust_level: { type: "enum", values: ["unverified", "consensus", "verified_crypto"], optional: true },
                source_url: { type: "string", optional: true, max: 2048 },
                source_hash: { type: "string", optional: true, max: 64 },
                proof: { type: "string", optional: true, max: 1024 },
                price: { type: "string", optional: true, max: 64 }
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

        // record_fee — tracks fee payments and splits revenue (TX command)
        this.addSchema('record_fee', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                memory_id: { type: "string", min: 1, max: 256 },
                operation: { type: "enum", values: ["read_gated", "skill_download"] },
                payer: { type: "string", min: 1, max: 256 },
                payment_txid: { type: "string", min: 1, max: 256 },
                amount: { type: "string", min: 1, max: 64 },
                ts: { type: "number", positive: true, integer: true },
                served_by: { type: "string", min: 1, max: 256, optional: true }
            }
        });

        // get_balance — read-only lookup of earnings for an address
        this.addSchema('get_balance', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                address: { type: "string", min: 1, max: 256 }
            }
        });

        // get_reputation — read-only reputation score for an address
        this.addSchema('get_reputation', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                address: { type: "string", min: 1, max: 256 }
            }
        });

        // get_stats — read-only protocol stats (no params)
        this.addFunction('get_stats');

        // register_stake — neurominer stakes TNK when publishing a memory (TX command)
        this.addSchema('register_stake', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                memory_id: { type: "string", min: 1, max: 256 },
                stake_txid: { type: "string", min: 1, max: 256 },
                stake_amount: { type: "string", min: 1, max: 64 }
            }
        });

        // slash_stake — admin penalizes bad data by slashing stake (TX command)
        this.addSchema('slash_stake', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                memory_id: { type: "string", min: 1, max: 256 },
                reason: { type: "string", min: 1, max: 256 }
            }
        });

        // release_stake — admin releases stake after verification period (TX command)
        this.addSchema('release_stake', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                memory_id: { type: "string", min: 1, max: 256 }
            }
        });

        // register_skill — publish a new Skill to the registry (TX command)
        // inputs/outputs are JSON-serialized descriptors of what the skill expects/produces
        // content_hash is the SHA256 of the skill's actual content (code, prompt, etc.)
        this.addSchema('register_skill', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                skill_id: { type: "string", min: 1, max: 256 },
                name: { type: "string", min: 1, max: 128 },
                description: { type: "string", min: 1, max: 1024 },
                cortex: { type: "string", min: 1, max: 64 },
                inputs: { type: "string", min: 0, max: 2048, optional: true },
                outputs: { type: "string", min: 0, max: 2048, optional: true },
                content_hash: { type: "string", min: 64, max: 64 },
                price: { type: "string", min: 1, max: 64 },
                version: { type: "string", min: 1, max: 16 }
            }
        });

        // update_skill — update metadata of an existing Skill (TX command)
        this.addSchema('update_skill', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                skill_id: { type: "string", min: 1, max: 256 },
                description: { type: "string", min: 0, max: 1024, optional: true },
                price: { type: "string", min: 0, max: 64, optional: true },
                version: { type: "string", min: 0, max: 16, optional: true },
                status: { type: "enum", values: ["active", "deprecated"], optional: true }
            }
        });

        // record_skill_download — track a skill download with fee split (TX command)
        this.addSchema('record_skill_download', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                skill_id: { type: "string", min: 1, max: 256 },
                buyer: { type: "string", min: 1, max: 256 },
                payment_txid: { type: "string", min: 1, max: 256 },
                amount: { type: "string", min: 1, max: 64 },
                served_by: { type: "string", min: 1, max: 256, optional: true }
            }
        });

        // query_skill — read-only lookup of a skill by ID
        this.addSchema('query_skill', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                skill_id: { type: "string", min: 1, max: 256 }
            }
        });

        // register_cortex — register a new cortex channel (admin only for MVP)
        this.addSchema('register_cortex', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                cortex_name: { type: "string", min: 1, max: 64 },
                description: { type: "string", min: 1, max: 256 }
            }
        });

        // follow_agent — follow another agent (TX command)
        this.addSchema('follow_agent', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                target: { type: "string", min: 1, max: 128 }
            }
        });

        // unfollow_agent — unfollow an agent (TX command)
        this.addSchema('unfollow_agent', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                target: { type: "string", min: 1, max: 128 }
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
                if (existing !== null) {
                    if (existing.author !== val.author) return;
                    // same author → update allowed
                }

                // Parse tags (comma-separated string or array)
                let tags = [];
                if (typeof val.tags === 'string') {
                    tags = val.tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0 && t.length <= 64);
                } else if (Array.isArray(val.tags)) {
                    tags = val.tags.map(t => String(t).trim().toLowerCase()).filter(t => t.length > 0 && t.length <= 64);
                }

                const metadata = {
                    author: val.author,
                    cortex: val.cortex,
                    access: val.access || 'open',
                    content_hash: val.content_hash,
                    ts: val.ts,
                    tags: tags,
                    trust_level: val.trust_level || 'unverified',
                    source_url: val.source_url || null,
                    source_hash: val.source_hash || null,
                    proof: val.proof || null,
                    price: (val.access === 'gated' && val.price) ? val.price : null
                };

                // Increment total_memories counter only for new entries
                if (existing === null) {
                    const existingCount = await _this.get('stats/total_memories');
                    await _this.put('stats/total_memories', (existingCount !== null ? existingCount : 0) + 1);
                }

                await _this.put('mem/' + memoryId, metadata);
                await _this.put('mem_by_author/' + val.author + '/' + memoryId, true);
                await _this.put('mem_by_cortex/' + val.cortex + '/' + memoryId, true);
                for (const tag of tags) {
                    await _this.put('mem_by_tag/' + tag + '/' + memoryId, true);
                }
            }

            if (_this.op.key === 'record_fee') {
                const val = _this.op.value;
                if (!val || !val.memory_id || !val.operation || !val.payer || !val.payment_txid || !val.amount || !val.ts) return;

                // Validate memory exists
                const memory = await _this.get('mem/' + val.memory_id);
                if (memory === null) return;

                // Prevent double-counting
                const existingFee = await _this.get('fee/' + val.payment_txid);
                if (existingFee !== null) return;

                // Parse amount as BigInt
                const amount = _this.protocol.safeBigInt(val.amount);
                if (amount === null) return;

                // Determine creator percentage based on operation type
                let creatorPct;
                if (val.operation === 'read_gated') creatorPct = 70n;
                else creatorPct = 80n; // skill_download

                const creatorShare = amount * creatorPct / 100n;
                const nodeShare = amount - creatorShare;
                const author = memory.author;

                // Fetch existing balances (default to "0" if null)
                const existingCreatorBal = await _this.get('balance/' + author);
                const existingNodeBal = await _this.get('balance_nodes');
                const existingTotalFees = await _this.get('stats/total_fees');
                const existingFeeCount = await _this.get('stats/fee_count');

                const creatorBal = _this.protocol.safeBigInt(existingCreatorBal !== null ? existingCreatorBal : "0");
                const nodeBal = _this.protocol.safeBigInt(existingNodeBal !== null ? existingNodeBal : "0");
                const totalFees = _this.protocol.safeBigInt(existingTotalFees !== null ? existingTotalFees : "0");
                if (creatorBal === null || nodeBal === null || totalFees === null) return;
                const feeCount = existingFeeCount !== null ? existingFeeCount : 0;

                const newCreatorBal = (creatorBal + creatorShare).toString();
                const newNodeBal = (nodeBal + nodeShare).toString();
                const newTotalFees = (totalFees + amount).toString();
                const newFeeCount = feeCount + 1;

                // Per-node balance if served_by is provided
                const servedBy = val.served_by || null;
                if (servedBy) {
                    const existingNodeIndBal = await _this.get('balance/node/' + servedBy);
                    const nodeIndBal = _this.protocol.safeBigInt(existingNodeIndBal !== null ? existingNodeIndBal : "0");
                    if (nodeIndBal !== null) {
                        await _this.put('balance/node/' + servedBy, (nodeIndBal + nodeShare).toString());
                    }
                }

                // Reputation: increment author read count
                const existingReads = await _this.get('rep/' + author + '/reads');
                const reads = (existingReads !== null ? existingReads : 0) + 1;

                await _this.put('fee/' + val.payment_txid, {
                    memory_id: val.memory_id,
                    operation: val.operation,
                    payer: val.payer,
                    amount: val.amount,
                    creator_share: creatorShare.toString(),
                    node_share: nodeShare.toString(),
                    served_by: servedBy,
                    ts: val.ts
                });
                await _this.put('balance/' + author, newCreatorBal);
                await _this.put('balance_nodes', newNodeBal);
                await _this.put('stats/total_fees', newTotalFees);
                await _this.put('stats/fee_count', newFeeCount);
                await _this.put('rep/' + author + '/reads', reads);
            }

            if (_this.op.key === 'register_skill') {
                const val = _this.op.value;
                if (!val || !val.skill_id || !val.name || !val.description || !val.cortex || !val.content_hash || !val.price || !val.version || !val.author) return;

                const skillId = val.skill_id;
                const existing = await _this.get('skill/' + skillId);
                if (existing !== null) return;

                const priceBI = _this.protocol.safeBigInt(val.price);
                if (priceBI === null) return;

                const currentTime = await _this.get('currentTime');
                const ts = currentTime !== null ? currentTime : 0;

                // Increment total_skills counter
                const existingSkillCount = await _this.get('stats/total_skills');
                const newSkillCount = (existingSkillCount !== null ? existingSkillCount : 0) + 1;

                await _this.put('skill/' + skillId, {
                    author: val.author,
                    name: val.name,
                    description: val.description,
                    cortex: val.cortex,
                    inputs: val.inputs,
                    outputs: val.outputs,
                    content_hash: val.content_hash,
                    price: val.price,
                    version: val.version,
                    ts: ts,
                    status: "active",
                    downloads: 0
                });
                await _this.put('skill_by_author/' + val.author + '/' + skillId, true);
                await _this.put('skill_by_cortex/' + val.cortex + '/' + skillId, true);
                await _this.put('stats/total_skills', newSkillCount);
            }

            if (_this.op.key === 'record_skill_download') {
                const val = _this.op.value;
                if (!val || !val.skill_id || !val.buyer || !val.payment_txid || !val.amount) return;

                const skill = await _this.get('skill/' + val.skill_id);
                if (skill === null || skill.status !== 'active') return;

                const existingDl = await _this.get('skill_download/' + val.payment_txid);
                if (existingDl !== null) return;

                const amount = _this.protocol.safeBigInt(val.amount);
                if (amount === null) return;

                // 80/20 split for skill_download
                const creatorShare = amount * 80n / 100n;
                const nodeShare = amount - creatorShare;
                const author = skill.author;

                const existingCreatorBal = await _this.get('balance/' + author);
                const existingNodeBal = await _this.get('balance_nodes');
                const existingTotalFees = await _this.get('stats/total_fees');
                const existingFeeCount = await _this.get('stats/fee_count');

                const creatorBal = _this.protocol.safeBigInt(existingCreatorBal !== null ? existingCreatorBal : "0");
                const nodeBal = _this.protocol.safeBigInt(existingNodeBal !== null ? existingNodeBal : "0");
                const totalFees = _this.protocol.safeBigInt(existingTotalFees !== null ? existingTotalFees : "0");
                if (creatorBal === null || nodeBal === null || totalFees === null) return;
                const feeCount = existingFeeCount !== null ? existingFeeCount : 0;

                const currentTime = await _this.get('currentTime');
                const ts = currentTime !== null ? currentTime : 0;

                // Per-node balance if served_by is provided
                const servedBy = val.served_by || null;
                if (servedBy) {
                    const existingNodeIndBal = await _this.get('balance/node/' + servedBy);
                    const nodeIndBal = _this.protocol.safeBigInt(existingNodeIndBal !== null ? existingNodeIndBal : "0");
                    if (nodeIndBal !== null) {
                        await _this.put('balance/node/' + servedBy, (nodeIndBal + nodeShare).toString());
                    }
                }

                await _this.put('skill_download/' + val.payment_txid, {
                    skill_id: val.skill_id,
                    buyer: val.buyer,
                    amount: val.amount,
                    creator_share: creatorShare.toString(),
                    node_share: nodeShare.toString(),
                    served_by: servedBy,
                    ts: ts
                });
                await _this.put('skill/' + val.skill_id, {
                    author: skill.author,
                    name: skill.name,
                    description: skill.description,
                    cortex: skill.cortex,
                    inputs: skill.inputs,
                    outputs: skill.outputs,
                    content_hash: skill.content_hash,
                    price: skill.price,
                    version: skill.version,
                    ts: skill.ts,
                    status: skill.status,
                    downloads: skill.downloads + 1
                });
                await _this.put('balance/' + author, (creatorBal + creatorShare).toString());
                await _this.put('balance_nodes', (nodeBal + nodeShare).toString());
                await _this.put('stats/total_fees', (totalFees + amount).toString());
                await _this.put('stats/fee_count', feeCount + 1);
                const existingDlCount = await _this.get('stats/total_downloads');
                await _this.put('stats/total_downloads', (existingDlCount !== null ? existingDlCount : 0) + 1);
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

        // Check if memory already exists — same author can update, others are rejected
        const existing = await this.get('mem/' + memoryId);
        if (existing !== null) {
            if (existing.author !== this.address) return new Error('Not the author');
            // same author → update allowed, put() below will overwrite
        }

        // Parse tags (comma-separated string → array of trimmed lowercase tags)
        const tagsRaw = this.value.tags || '';
        const tags = tagsRaw
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0 && t.length <= 64);

        // Build the metadata object (read from this.value, never mutate it)
        const metadata = {
            author: author,
            cortex: cortex,
            access: this.value.access,
            content_hash: this.value.content_hash,
            ts: this.value.ts,
            tags: tags,
            trust_level: this.value.trust_level || 'unverified',
            source_url: this.value.source_url || null,
            source_hash: this.value.source_hash || null,
            proof: this.value.proof || null,
            price: (this.value.access === 'gated' && this.value.price) ? this.value.price : null
        };

        // Increment total_memories counter only for new entries (not updates)
        if (existing === null) {
            const existingCount = await this.get('stats/total_memories');
            await this.put('stats/total_memories', (existingCount !== null ? existingCount : 0) + 1);
        }

        // All put() calls at the end
        await this.put('mem/' + memoryId, metadata);
        await this.put('mem_by_author/' + author + '/' + memoryId, true);
        await this.put('mem_by_cortex/' + cortex + '/' + memoryId, true);
        for (const tag of tags) {
            await this.put('mem_by_tag/' + tag + '/' + memoryId, true);
        }
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

    /**
     * record_fee — record a fee payment and split revenue between creator and node pool.
     *
     * Fee splits by operation type:
     * - read_gated:     70% creator, 30% node pool
     * - skill_download: 80% creator, 20% node pool
     *
     * All amounts are bigint strings (18 decimals, 1 TNK = 1_000_000_000_000_000_000).
     */
    async record_fee() {
        const memoryId = this.value.memory_id;
        const operation = this.value.operation;
        const payer = this.value.payer;
        const paymentTxid = this.value.payment_txid;
        const amountStr = this.value.amount;
        const ts = this.value.ts;

        // Validate memory exists
        const memory = await this.get('mem/' + memoryId);
        if (memory === null) return new Error('Memory not found');

        // Validate payment_txid not already recorded (prevent double-counting)
        const existingFee = await this.get('fee/' + paymentTxid);
        if (existingFee !== null) return new Error('Payment already recorded');

        // Parse amount as BigInt
        const amount = this.protocol.safeBigInt(amountStr);
        if (amount === null) return new Error('Invalid amount');

        // Determine creator percentage based on operation type
        let creatorPct;
        if (operation === 'read_gated') creatorPct = 70n;
        else creatorPct = 80n; // skill_download

        const creatorShare = amount * creatorPct / 100n;
        const nodeShare = amount - creatorShare;

        // Look up author from the memory metadata
        const author = memory.author;

        // Fetch existing balances (default to "0" if null)
        const existingCreatorBal = await this.get('balance/' + author);
        const existingNodeBal = await this.get('balance_nodes');
        const existingTotalFees = await this.get('stats/total_fees');
        const existingFeeCount = await this.get('stats/fee_count');

        const creatorBal = this.protocol.safeBigInt(existingCreatorBal !== null ? existingCreatorBal : "0");
        const nodeBal = this.protocol.safeBigInt(existingNodeBal !== null ? existingNodeBal : "0");
        const totalFees = this.protocol.safeBigInt(existingTotalFees !== null ? existingTotalFees : "0");
        const feeCount = existingFeeCount !== null ? existingFeeCount : 0;

        this.assert(creatorBal !== null);
        this.assert(nodeBal !== null);
        this.assert(totalFees !== null);

        const newCreatorBal = (creatorBal + creatorShare).toString();
        const newNodeBal = (nodeBal + nodeShare).toString();
        const newTotalFees = (totalFees + amount).toString();
        const newFeeCount = feeCount + 1;

        // Per-node balance if served_by is provided
        const servedBy = this.value.served_by || null;
        if (servedBy) {
            const existingNodeIndBal = await this.get('balance/node/' + servedBy);
            const nodeIndBal = this.protocol.safeBigInt(existingNodeIndBal !== null ? existingNodeIndBal : "0");
            this.assert(nodeIndBal !== null);
            await this.put('balance/node/' + servedBy, (nodeIndBal + nodeShare).toString());
        }

        // Reputation: increment author read count
        const existingReads = await this.get('rep/' + author + '/reads');
        const reads = (existingReads !== null ? existingReads : 0) + 1;

        // All put() calls at the end
        await this.put('fee/' + paymentTxid, {
            memory_id: memoryId,
            operation: operation,
            payer: payer,
            amount: amountStr,
            creator_share: creatorShare.toString(),
            node_share: nodeShare.toString(),
            served_by: servedBy,
            ts: ts
        });
        await this.put('balance/' + author, newCreatorBal);
        await this.put('balance_nodes', newNodeBal);
        await this.put('stats/total_fees', newTotalFees);
        await this.put('stats/fee_count', newFeeCount);
        await this.put('rep/' + author + '/reads', reads);
    }

    /**
     * get_balance — read-only function to check earnings for an address.
     */
    async get_balance() {
        const address = this.value.address;
        const balance = await this.get('balance/' + address);
        console.log('balance/' + address + ':', balance !== null ? balance : '0');
    }

    /**
     * get_stats — read-only function for protocol-wide fee statistics.
     */
    async get_stats() {
        const totalFees = await this.get('stats/total_fees');
        const feeCount = await this.get('stats/fee_count');
        const totalMemories = await this.get('stats/total_memories');
        const totalSkills = await this.get('stats/total_skills');
        const totalDownloads = await this.get('stats/total_downloads');
        console.log('stats:', {
            total_fees: totalFees !== null ? totalFees : '0',
            fee_count: feeCount !== null ? feeCount : 0,
            total_memories: totalMemories !== null ? totalMemories : 0,
            total_skills: totalSkills !== null ? totalSkills : 0,
            total_downloads: totalDownloads !== null ? totalDownloads : 0
        });
    }

    /**
     * get_reputation — read-only reputation score for an address.
     * Score = reads - (slashes * 10)
     */
    async get_reputation() {
        const address = this.value.address;
        const reads = await this.get('rep/' + address + '/reads');
        const slashes = await this.get('rep/' + address + '/slashes');
        const r = reads !== null ? reads : 0;
        const s = slashes !== null ? slashes : 0;
        const score = r - (s * 10);
        console.log('reputation:', { address, reads: r, slashes: s, score });
    }

    /**
     * register_stake — neurominer stakes TNK when publishing a memory.
     *
     * Validates:
     * - memory_id exists in state
     * - this.address matches the memory's author
     * - stake_txid has not already been used
     *
     * Storage:
     * - stake/<memory_id>: { author, stake_txid, stake_amount, ts, status: "active" }
     * - staked_by/<address>: accumulated total staked amount
     */
    async register_stake() {
        const memoryId = this.value.memory_id;
        const stakeTxid = this.value.stake_txid;
        const stakeAmountStr = this.value.stake_amount;

        // Validate memory exists
        const memory = await this.get('mem/' + memoryId);
        if (memory === null) return new Error('Memory not found');

        // Validate caller is the memory author
        if (this.address !== memory.author) return new Error('Only the memory author can stake');

        // Validate stake_txid not already used
        const existingStake = await this.get('stake/' + memoryId);
        if (existingStake !== null) return new Error('Stake already exists for this memory');

        // Parse stake amount as BigInt
        const stakeAmount = this.protocol.safeBigInt(stakeAmountStr);
        if (stakeAmount === null) return new Error('Invalid stake amount');

        // Get current timestamp from timer
        const currentTime = await this.get('currentTime');
        const ts = currentTime !== null ? currentTime : 0;

        // Fetch existing total staked for this author (default to "0")
        const existingTotal = await this.get('staked_by/' + this.address);
        const totalStaked = this.protocol.safeBigInt(existingTotal !== null ? existingTotal : "0");
        this.assert(totalStaked !== null);

        const newTotal = (totalStaked + stakeAmount).toString();

        // All put() calls at the end
        await this.put('stake/' + memoryId, {
            author: this.address,
            stake_txid: stakeTxid,
            stake_amount: stakeAmountStr,
            ts: ts,
            status: "active"
        });
        await this.put('staked_by/' + this.address, newTotal);
    }

    /**
     * slash_stake — admin penalizes bad data by slashing a stake.
     *
     * Validates:
     * - caller is admin
     * - stake exists and is "active"
     *
     * Updates stake status to "slashed" and reduces author's total staked amount.
     */
    async slash_stake() {
        const memoryId = this.value.memory_id;
        const reason = this.value.reason;

        // Validate caller is admin
        const admin = await this.get('admin');
        if (this.address !== admin) return new Error('Only admin can slash stakes');

        // Validate stake exists and is active
        const stake = await this.get('stake/' + memoryId);
        if (stake === null) return new Error('Stake not found');
        if (stake.status !== 'active') return new Error('Stake is not active');

        // Parse stake amount to reduce from author total
        const stakeAmount = this.protocol.safeBigInt(stake.stake_amount);
        this.assert(stakeAmount !== null);

        // Fetch author's total staked
        const existingTotal = await this.get('staked_by/' + stake.author);
        const totalStaked = this.protocol.safeBigInt(existingTotal !== null ? existingTotal : "0");
        this.assert(totalStaked !== null);

        const newTotal = (totalStaked - stakeAmount).toString();

        // Reputation: increment author slash count
        const existingSlashes = await this.get('rep/' + stake.author + '/slashes');
        const slashes = (existingSlashes !== null ? existingSlashes : 0) + 1;

        // All put() calls at the end
        await this.put('stake/' + memoryId, {
            author: stake.author,
            stake_txid: stake.stake_txid,
            stake_amount: stake.stake_amount,
            ts: stake.ts,
            status: "slashed",
            slash_reason: reason
        });
        await this.put('staked_by/' + stake.author, newTotal);
        await this.put('rep/' + stake.author + '/slashes', slashes);
    }

    /**
     * release_stake — admin releases stake after verification period.
     *
     * Validates:
     * - caller is admin
     * - stake exists and is "active"
     *
     * Updates stake status to "released".
     */
    async release_stake() {
        const memoryId = this.value.memory_id;

        // Validate caller is admin
        const admin = await this.get('admin');
        if (this.address !== admin) return new Error('Only admin can release stakes');

        // Validate stake exists and is active
        const stake = await this.get('stake/' + memoryId);
        if (stake === null) return new Error('Stake not found');
        if (stake.status !== 'active') return new Error('Stake is not active');

        // All put() calls at the end
        await this.put('stake/' + memoryId, {
            author: stake.author,
            stake_txid: stake.stake_txid,
            stake_amount: stake.stake_amount,
            ts: stake.ts,
            status: "released"
        });
    }

    /**
     * register_skill — publish a new Skill to the registry.
     *
     * Storage:
     * - skill/<skill_id>: { author, name, description, cortex, price, version, ts, status, downloads }
     * - skill_by_author/<author>/<skill_id>: true
     * - skill_by_cortex/<cortex>/<skill_id>: true
     */
    async register_skill() {
        const skillId = this.value.skill_id;
        const name = this.value.name;
        const description = this.value.description;
        const cortex = this.value.cortex;
        const inputs = this.value.inputs;
        const outputs = this.value.outputs;
        const contentHash = this.value.content_hash;
        const price = this.value.price;
        const version = this.value.version;

        // Validate price is a valid bigint string
        const priceBI = this.protocol.safeBigInt(price);
        if (priceBI === null) return new Error('Invalid price');

        // Validate skill_id does not already exist
        const existing = await this.get('skill/' + skillId);
        if (existing !== null) return new Error('Skill already exists');

        // Get current timestamp from timer
        const currentTime = await this.get('currentTime');
        const ts = currentTime !== null ? currentTime : 0;

        // Increment total_skills counter
        const existingSkillCount = await this.get('stats/total_skills');
        const newSkillCount = (existingSkillCount !== null ? existingSkillCount : 0) + 1;

        // All put() calls at the end
        await this.put('skill/' + skillId, {
            author: this.address,
            name: name,
            description: description,
            cortex: cortex,
            inputs: inputs,
            outputs: outputs,
            content_hash: contentHash,
            price: price,
            version: version,
            ts: ts,
            status: "active",
            downloads: 0
        });
        await this.put('skill_by_author/' + this.address + '/' + skillId, true);
        await this.put('skill_by_cortex/' + cortex + '/' + skillId, true);
        await this.put('stats/total_skills', newSkillCount);
    }

    /**
     * update_skill — update metadata of an existing Skill (author only).
     *
     * Only updates fields that are provided in this.value. Keeps existing values for others.
     */
    async update_skill() {
        const skillId = this.value.skill_id;

        // Validate skill exists
        const skill = await this.get('skill/' + skillId);
        if (skill === null) return new Error('Skill not found');

        // Validate caller is the skill author
        if (this.address !== skill.author) return new Error('Only the skill author can update');

        // Build updated object, keeping existing values for unset fields
        const updated = {
            author: skill.author,
            name: skill.name,
            description: this.value.description !== undefined ? this.value.description : skill.description,
            cortex: skill.cortex,
            inputs: skill.inputs,
            outputs: skill.outputs,
            content_hash: skill.content_hash,
            price: this.value.price !== undefined ? this.value.price : skill.price,
            version: this.value.version !== undefined ? this.value.version : skill.version,
            ts: skill.ts,
            status: this.value.status !== undefined ? this.value.status : skill.status,
            downloads: skill.downloads
        };

        // Validate price if provided
        if (this.value.price !== undefined) {
            const priceBI = this.protocol.safeBigInt(this.value.price);
            if (priceBI === null) return new Error('Invalid price');
        }

        // All put() calls at the end
        await this.put('skill/' + skillId, updated);
    }

    /**
     * record_skill_download — track a completed skill download with fee split.
     *
     * Applies the skill_download fee split (80% creator, 20% node pool).
     * Increments the skill's download counter.
     */
    async record_skill_download() {
        const skillId = this.value.skill_id;
        const buyer = this.value.buyer;
        const paymentTxid = this.value.payment_txid;
        const amountStr = this.value.amount;

        // Validate skill exists and is active
        const skill = await this.get('skill/' + skillId);
        if (skill === null) return new Error('Skill not found');
        if (skill.status !== 'active') return new Error('Skill is not active');

        // Validate payment_txid not already recorded
        const existingDownload = await this.get('skill_download/' + paymentTxid);
        if (existingDownload !== null) return new Error('Download already recorded');

        // Parse amount as BigInt
        const amount = this.protocol.safeBigInt(amountStr);
        if (amount === null) return new Error('Invalid amount');

        // Fee split: 80% creator, 20% node pool (skill_download)
        const creatorShare = amount * 80n / 100n;
        const nodeShare = amount - creatorShare;
        const author = skill.author;

        // Fetch existing balances (default to "0" if null)
        const existingCreatorBal = await this.get('balance/' + author);
        const existingNodeBal = await this.get('balance_nodes');
        const existingTotalFees = await this.get('stats/total_fees');
        const existingFeeCount = await this.get('stats/fee_count');

        const creatorBal = this.protocol.safeBigInt(existingCreatorBal !== null ? existingCreatorBal : "0");
        const nodeBal = this.protocol.safeBigInt(existingNodeBal !== null ? existingNodeBal : "0");
        const totalFees = this.protocol.safeBigInt(existingTotalFees !== null ? existingTotalFees : "0");
        const feeCount = existingFeeCount !== null ? existingFeeCount : 0;

        this.assert(creatorBal !== null);
        this.assert(nodeBal !== null);
        this.assert(totalFees !== null);

        const newCreatorBal = (creatorBal + creatorShare).toString();
        const newNodeBal = (nodeBal + nodeShare).toString();
        const newTotalFees = (totalFees + amount).toString();
        const newFeeCount = feeCount + 1;

        // Get current timestamp from timer
        const currentTime = await this.get('currentTime');
        const ts = currentTime !== null ? currentTime : 0;

        // Increment download counter
        const updatedSkill = {
            author: skill.author,
            name: skill.name,
            description: skill.description,
            cortex: skill.cortex,
            inputs: skill.inputs,
            outputs: skill.outputs,
            content_hash: skill.content_hash,
            price: skill.price,
            version: skill.version,
            ts: skill.ts,
            status: skill.status,
            downloads: skill.downloads + 1
        };

        // Per-node balance if served_by is provided
        const servedBy = this.value.served_by || null;
        if (servedBy) {
            const existingNodeIndBal = await this.get('balance/node/' + servedBy);
            const nodeIndBal = this.protocol.safeBigInt(existingNodeIndBal !== null ? existingNodeIndBal : "0");
            this.assert(nodeIndBal !== null);
            await this.put('balance/node/' + servedBy, (nodeIndBal + nodeShare).toString());
        }

        // All put() calls at the end
        await this.put('skill_download/' + paymentTxid, {
            skill_id: skillId,
            buyer: buyer,
            amount: amountStr,
            creator_share: creatorShare.toString(),
            node_share: nodeShare.toString(),
            served_by: servedBy,
            ts: ts
        });
        await this.put('skill/' + skillId, updatedSkill);
        await this.put('balance/' + author, newCreatorBal);
        await this.put('balance_nodes', newNodeBal);
        await this.put('stats/total_fees', newTotalFees);
        await this.put('stats/fee_count', newFeeCount);
        const existingDlCount = await this.get('stats/total_downloads');
        await this.put('stats/total_downloads', (existingDlCount !== null ? existingDlCount : 0) + 1);
    }

    /**
     * query_skill — read-only function to look up a skill by ID.
     * Logs the result to the terminal.
     */
    async query_skill() {
        const skillId = this.value.skill_id;
        const skill = await this.get('skill/' + skillId);
        console.log('query_skill', skillId + ':', skill);
    }
    /**
     * register_cortex — register a new cortex channel (admin only for MVP).
     *
     * Storage:
     * - cortex/<cortex_name>: { description, created_by, ts, status: "active" }
     */
    async register_cortex() {
        const cortexName = this.value.cortex_name;
        const description = this.value.description;

        // Validate caller is admin
        const admin = await this.get('admin');
        if (this.address !== admin) return new Error('Only admin can register cortex channels');

        // Validate cortex_name does not already exist
        const existing = await this.get('cortex/' + cortexName);
        if (existing !== null) return new Error('Cortex already exists');

        // Get current timestamp from timer
        const currentTime = await this.get('currentTime');
        const ts = currentTime !== null ? currentTime : 0;

        // All put() calls at the end
        await this.put('cortex/' + cortexName, {
            description: description,
            created_by: this.address,
            ts: ts,
            status: "active"
        });
    }

    /**
     * follow_agent — follow another agent on the network.
     *
     * Storage:
     * - follows/<follower>/<target>: { ts }
     * - followers/<target>/<follower>: { ts }
     * - following_count/<follower>: number
     * - follower_count/<target>: number
     */
    async follow_agent() {
        const target = this.value.target;
        const follower = this.address;

        if (follower === target) return new Error('Cannot follow yourself');

        const existing = await this.get('follows/' + follower + '/' + target);
        if (existing !== null) return new Error('Already following');

        const currentTime = await this.get('currentTime');
        const ts = currentTime !== null ? currentTime : 0;

        const followingCount = ((await this.get('following_count/' + follower)) || 0) + 1;
        const followerCount = ((await this.get('follower_count/' + target)) || 0) + 1;

        await this.put('follows/' + follower + '/' + target, { ts });
        await this.put('followers/' + target + '/' + follower, { ts });
        await this.put('following_count/' + follower, followingCount);
        await this.put('follower_count/' + target, followerCount);
    }

    /**
     * unfollow_agent — unfollow an agent.
     *
     * Removes bidirectional index entries and decrements counters.
     */
    async unfollow_agent() {
        const target = this.value.target;
        const follower = this.address;

        const existing = await this.get('follows/' + follower + '/' + target);
        if (existing === null) return new Error('Not following');

        const followingCount = Math.max(0, ((await this.get('following_count/' + follower)) || 0) - 1);
        const followerCount = Math.max(0, ((await this.get('follower_count/' + target)) || 0) - 1);

        await this.put('follows/' + follower + '/' + target, null);
        await this.put('followers/' + target + '/' + follower, null);
        await this.put('following_count/' + follower, followingCount);
        await this.put('follower_count/' + target, followerCount);
    }
}

export default MnemexContract;
