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

        // record_fee — tracks fee payments and splits revenue (TX command)
        this.addSchema('record_fee', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                memory_id: { type: "string", min: 1, max: 256 },
                operation: { type: "enum", values: ["read_open", "read_gated", "skill_download"] },
                payer: { type: "string", min: 1, max: 256 },
                payment_txid: { type: "string", min: 1, max: 256 },
                amount: { type: "string", min: 1, max: 64 },
                ts: { type: "number", positive: true, integer: true }
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
                if (val.operation === 'read_open') creatorPct = 60n;
                else if (val.operation === 'read_gated') creatorPct = 70n;
                else creatorPct = 80n;

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

                await _this.put('fee/' + val.payment_txid, {
                    memory_id: val.memory_id,
                    operation: val.operation,
                    payer: val.payer,
                    amount: val.amount,
                    creator_share: creatorShare.toString(),
                    node_share: nodeShare.toString(),
                    ts: val.ts
                });
                await _this.put('balance/' + author, newCreatorBal);
                await _this.put('balance_nodes', newNodeBal);
                await _this.put('stats/total_fees', newTotalFees);
                await _this.put('stats/fee_count', newFeeCount);
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

    /**
     * record_fee — record a fee payment and split revenue between creator and node pool.
     *
     * Fee splits by operation type:
     * - read_open:      60% creator, 40% node pool
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
        if (operation === 'read_open') creatorPct = 60n;
        else if (operation === 'read_gated') creatorPct = 70n;
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

        // All put() calls at the end
        await this.put('fee/' + paymentTxid, {
            memory_id: memoryId,
            operation: operation,
            payer: payer,
            amount: amountStr,
            creator_share: creatorShare.toString(),
            node_share: nodeShare.toString(),
            ts: ts
        });
        await this.put('balance/' + author, newCreatorBal);
        await this.put('balance_nodes', newNodeBal);
        await this.put('stats/total_fees', newTotalFees);
        await this.put('stats/fee_count', newFeeCount);
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
        console.log('stats:', {
            total_fees: totalFees !== null ? totalFees : '0',
            fee_count: feeCount !== null ? feeCount : 0
        });
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
}

export default MnemexContract;
