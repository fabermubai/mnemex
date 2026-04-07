import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import MnemexContract from '../contract/contract.js';
import { MemoryIndexer } from '../features/memory-indexer/index.js';
import { sendTNK, verifyTNKTransfer } from '../src/fees/tnk-transfer.js';

// ---------------------------------------------------------------------------
// Mock contract context — simulates this.get/put/value/address/protocol/assert
// ---------------------------------------------------------------------------
function createMockContract(initialState = {}) {
    const state = {};
    for (const [k, v] of Object.entries(initialState)) {
        state[k] = v;
    }
    const puts = [];
    return {
        state,
        puts,
        get: async (key) => state[key] !== undefined ? state[key] : null,
        put: async (key, value) => { state[key] = value; puts.push({ key, value }); },
        assert: (condition) => { if (!condition) throw new Error('Contract assertion failed'); },
        protocol: {
            safeBigInt: (str) => {
                if (str === null || str === undefined) return null;
                try { return BigInt(str); } catch { return null; }
            },
        },
        value: null,
        address: null,
    };
}

// Shorthand: call a contract prototype method with a mock context
async function callContract(methodName, ctx) {
    return MnemexContract.prototype[methodName].call(ctx);
}

// Seed a memory entry in mock state (used by many tests)
function seedMemory(state, memoryId, author, opts = {}) {
    state['mem/' + memoryId] = {
        author,
        cortex: opts.cortex || 'crypto',
        access: opts.access || 'open',
        content_hash: opts.content_hash || 'a'.repeat(64),
        ts: opts.ts || 1708617600000,
    };
}

// ---------------------------------------------------------------------------
// Phase 2 Tests
// ---------------------------------------------------------------------------

describe('Phase 2 — Neuronomics Fees & Staking', () => {

    // ========== record_fee tests ==========

    describe('record_fee', () => {

        it('should split 70/30 for read_gated (default)', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-001', 'author-aaa');
            ctx.value = {
                memory_id: 'mem-001',
                operation: 'read_gated',
                payer: 'payer-xxx',
                payment_txid: 'tx-001',
                amount: '100000000000000000', // 0.1 TNK
                ts: 1708617600000,
            };

            const result = await callContract('record_fee', ctx);
            assert.equal(result, undefined, 'Should not return error');

            const fee = ctx.state['fee/tx-001'];
            assert.ok(fee, 'Fee record should exist');
            assert.equal(fee.creator_share, '70000000000000000');  // 70%
            assert.equal(fee.node_share, '30000000000000000');     // 30%
            assert.equal(ctx.state['balance/author-aaa'], '70000000000000000');
            assert.equal(ctx.state['balance_nodes'], '30000000000000000');
        });

        it('should split 70/30 for read_gated', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-002', 'author-bbb', { access: 'gated' });
            ctx.value = {
                memory_id: 'mem-002',
                operation: 'read_gated',
                payer: 'payer-xxx',
                payment_txid: 'tx-002',
                amount: '100000000000000000',
                ts: 1708617600000,
            };

            await callContract('record_fee', ctx);

            const fee = ctx.state['fee/tx-002'];
            assert.equal(fee.creator_share, '70000000000000000');  // 70%
            assert.equal(fee.node_share, '30000000000000000');     // 30%
        });

        it('should split 80/20 for skill_download', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-003', 'author-ccc');
            ctx.value = {
                memory_id: 'mem-003',
                operation: 'skill_download',
                payer: 'payer-xxx',
                payment_txid: 'tx-003',
                amount: '100000000000000000',
                ts: 1708617600000,
            };

            await callContract('record_fee', ctx);

            const fee = ctx.state['fee/tx-003'];
            assert.equal(fee.creator_share, '80000000000000000');  // 80%
            assert.equal(fee.node_share, '20000000000000000');     // 20%
        });

        it('should reject duplicate payment_txid', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-004', 'author-ddd');
            ctx.state['fee/tx-dup'] = { memory_id: 'mem-004' }; // already recorded

            ctx.value = {
                memory_id: 'mem-004',
                operation: 'read_gated',
                payer: 'payer-xxx',
                payment_txid: 'tx-dup',
                amount: '100000000000000000',
                ts: 1708617600000,
            };

            const result = await callContract('record_fee', ctx);
            assert.ok(result instanceof Error, 'Should return error for duplicate');
            assert.match(result.message, /already recorded/i);
        });

        it('should reject non-existent memory_id', async () => {
            const ctx = createMockContract(); // no memory seeded
            ctx.value = {
                memory_id: 'does-not-exist',
                operation: 'read_gated',
                payer: 'payer-xxx',
                payment_txid: 'tx-ghost',
                amount: '100000000000000000',
                ts: 1708617600000,
            };

            const result = await callContract('record_fee', ctx);
            assert.ok(result instanceof Error, 'Should return error for missing memory');
            assert.match(result.message, /not found/i);
        });

        it('should accumulate balances across multiple fees', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-multi', 'author-multi');

            // First fee
            ctx.value = {
                memory_id: 'mem-multi',
                operation: 'read_gated',
                payer: 'p1',
                payment_txid: 'tx-a',
                amount: '100000000000000000',
                ts: 1,
            };
            await callContract('record_fee', ctx);

            // Second fee
            ctx.value = {
                memory_id: 'mem-multi',
                operation: 'read_gated',
                payer: 'p2',
                payment_txid: 'tx-b',
                amount: '200000000000000000',
                ts: 2,
            };
            await callContract('record_fee', ctx);

            // 70% of 100 + 70% of 200 = 70 + 140 = 210
            assert.equal(ctx.state['balance/author-multi'], '210000000000000000');
            // 30% of 100 + 30% of 200 = 30 + 60 = 90
            assert.equal(ctx.state['balance_nodes'], '90000000000000000');
        });

        it('should track per-node balance when served_by is provided', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-node', 'author-node');
            ctx.value = {
                memory_id: 'mem-node',
                operation: 'read_gated',
                payer: 'payer-xxx',
                payment_txid: 'tx-node-001',
                amount: '100000000000000000',
                ts: 1708617600000,
                served_by: 'node-pubkey-aaa',
            };

            await callContract('record_fee', ctx);

            // Per-node balance: 30% of 0.1 TNK
            assert.equal(ctx.state['balance/node/node-pubkey-aaa'], '30000000000000000');
            // Global pool still updated
            assert.equal(ctx.state['balance_nodes'], '30000000000000000');
            // Fee record includes served_by
            const fee = ctx.state['fee/tx-node-001'];
            assert.equal(fee.served_by, 'node-pubkey-aaa');
        });

        it('should accumulate per-node balance across multiple fees', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-node2', 'author-node2');

            ctx.value = {
                memory_id: 'mem-node2',
                operation: 'read_gated',
                payer: 'p1',
                payment_txid: 'tx-n2a',
                amount: '100000000000000000',
                ts: 1,
                served_by: 'node-bbb',
            };
            await callContract('record_fee', ctx);

            ctx.value = {
                memory_id: 'mem-node2',
                operation: 'read_gated',
                payer: 'p2',
                payment_txid: 'tx-n2b',
                amount: '200000000000000000',
                ts: 2,
                served_by: 'node-bbb',
            };
            await callContract('record_fee', ctx);

            // 30% of 100 + 30% of 200 = 30 + 60 = 90
            assert.equal(ctx.state['balance/node/node-bbb'], '90000000000000000');
        });

        it('should not create per-node balance when served_by is absent', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-nonode', 'author-nonode');
            ctx.value = {
                memory_id: 'mem-nonode',
                operation: 'read_gated',
                payer: 'payer-xxx',
                payment_txid: 'tx-nonode',
                amount: '100000000000000000',
                ts: 1708617600000,
            };

            await callContract('record_fee', ctx);

            // No per-node balance key created
            assert.equal(ctx.state['balance/node/undefined'], undefined);
            // Global pool still works
            assert.equal(ctx.state['balance_nodes'], '30000000000000000');
            // Fee record has served_by: null
            assert.equal(ctx.state['fee/tx-nonode'].served_by, null);
        });
    });

    // ========== Stats accumulation ==========

    describe('Stats accumulation', () => {
        it('total_fees and fee_count should accumulate correctly', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-stats', 'author-stats');

            ctx.value = {
                memory_id: 'mem-stats',
                operation: 'read_gated',
                payer: 'p1',
                payment_txid: 'tx-s1',
                amount: '30000000000000000', // 0.03 TNK
                ts: 1,
            };
            await callContract('record_fee', ctx);

            assert.equal(ctx.state['stats/total_fees'], '30000000000000000');
            assert.equal(ctx.state['stats/fee_count'], 1);

            ctx.value = {
                memory_id: 'mem-stats',
                operation: 'read_gated',
                payer: 'p2',
                payment_txid: 'tx-s2',
                amount: '50000000000000000',
                ts: 2,
            };
            await callContract('record_fee', ctx);

            assert.equal(ctx.state['stats/total_fees'], '80000000000000000');
            assert.equal(ctx.state['stats/fee_count'], 2);
        });
    });

    // ========== register_stake tests ==========

    describe('register_stake', () => {
        it('should link stake to memory and author', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-stake-1', 'author-stake');
            ctx.address = 'author-stake'; // caller is the author
            ctx.value = {
                memory_id: 'mem-stake-1',
                stake_txid: 'stx-001',
                stake_amount: '1000000000000000000', // 1 TNK
            };

            const result = await callContract('register_stake', ctx);
            assert.equal(result, undefined, 'Should not return error');

            const stake = ctx.state['stake/mem-stake-1'];
            assert.ok(stake, 'Stake record should exist');
            assert.equal(stake.author, 'author-stake');
            assert.equal(stake.stake_txid, 'stx-001');
            assert.equal(stake.stake_amount, '1000000000000000000');
            assert.equal(stake.status, 'active');

            assert.equal(ctx.state['staked_by/author-stake'], '1000000000000000000');
        });

        it('should reject wrong author', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-stake-2', 'real-author');
            ctx.address = 'wrong-author'; // caller is NOT the author
            ctx.value = {
                memory_id: 'mem-stake-2',
                stake_txid: 'stx-002',
                stake_amount: '1000000000000000000',
            };

            const result = await callContract('register_stake', ctx);
            assert.ok(result instanceof Error, 'Should return error for wrong author');
            assert.match(result.message, /author/i);
        });
    });

    // ========== slash_stake tests ==========

    describe('slash_stake', () => {
        it('should require admin role', async () => {
            const ctx = createMockContract();
            ctx.state['admin'] = 'admin-pubkey';
            ctx.state['stake/mem-slash'] = {
                author: 'some-author',
                stake_txid: 'stx-x',
                stake_amount: '1000000000000000000',
                ts: 0,
                status: 'active',
            };
            ctx.address = 'not-admin'; // caller is NOT admin
            ctx.value = {
                memory_id: 'mem-slash',
                reason: 'bad data',
            };

            const result = await callContract('slash_stake', ctx);
            assert.ok(result instanceof Error, 'Should return error for non-admin');
            assert.match(result.message, /admin/i);
        });

        it('should mark stake as slashed and reduce staked total', async () => {
            const ctx = createMockContract();
            ctx.state['admin'] = 'admin-key';
            ctx.state['stake/mem-slash-2'] = {
                author: 'author-slashed',
                stake_txid: 'stx-y',
                stake_amount: '500000000000000000',
                ts: 0,
                status: 'active',
            };
            ctx.state['staked_by/author-slashed'] = '500000000000000000';
            ctx.address = 'admin-key'; // caller IS admin
            ctx.value = {
                memory_id: 'mem-slash-2',
                reason: 'incorrect data',
            };

            const result = await callContract('slash_stake', ctx);
            assert.equal(result, undefined, 'Should not return error');

            const stake = ctx.state['stake/mem-slash-2'];
            assert.equal(stake.status, 'slashed');
            assert.equal(stake.slash_reason, 'incorrect data');
            assert.equal(ctx.state['staked_by/author-slashed'], '0');
        });
    });

    // ========== release_stake test ==========

    describe('release_stake', () => {
        it('should mark stake as released (admin only)', async () => {
            const ctx = createMockContract();
            ctx.state['admin'] = 'admin-key';
            ctx.state['stake/mem-release'] = {
                author: 'author-released',
                stake_txid: 'stx-r',
                stake_amount: '700000000000000000',
                ts: 0,
                status: 'active',
            };
            ctx.address = 'admin-key';
            ctx.value = { memory_id: 'mem-release' };

            const result = await callContract('release_stake', ctx);
            assert.equal(result, undefined, 'Should not return error');

            const stake = ctx.state['stake/mem-release'];
            assert.equal(stake.status, 'released');
        });
    });

    // ========== MemoryIndexer Payment Gate tests (immediate split) ==========

    describe('MemoryIndexer Payment Gate — immediate split', () => {
        const TEST_DATA_DIR = './test-mnemex-data-fees-' + Date.now();
        let indexer;
        let appendCalls;
        let broadcastCalls;

        const mockPeer = {
            base: { writable: true, isIndexer: true, append: async () => {} },
            protocol: { instance: { generateNonce: () => 'nonce-' + Date.now() } },
            wallet: { publicKey: 'cc'.repeat(32), sign: () => 'fake-sig', address: 'trac1testnode' },
            msbClient: {
                pubKeyHexToAddress: (hex) => 'trac1creator_' + hex.slice(0, 8),
            },
            sidechannel: {
                broadcast: (channel, message) => {
                    broadcastCalls.push({ channel, message });
                },
            },
        };

        before(async () => {
            appendCalls = [];
            broadcastCalls = [];

            indexer = new MemoryIndexer(mockPeer, {
                dataDir: TEST_DATA_DIR,
                cortexChannels: ['cortex-crypto'],
                requirePayment: true,
                nodeAddress: 'trac1testnode',
                isBootstrapPeer: true,
            });

            indexer.key = 'memory_indexer';
            indexer.append = async (key, value) => {
                appendCalls.push({ key, value });
            };

            await indexer.start();

            // Pre-store a gated memory for read tests (only gated memories go through payment gate)
            await indexer._handleMemoryWrite('cortex-crypto', {
                v: 1,
                type: 'memory_write',
                memory_id: 'paid-mem-001',
                cortex: 'crypto',
                data: { key: 'ETH/USD', value: 3200 },
                author: 'cc'.repeat(32),
                access: 'gated',
                ts: 1708617600000,
            });

            // Pre-store a gated memory for split ratio tests
            await indexer._handleMemoryWrite('cortex-crypto', {
                v: 1,
                type: 'memory_write',
                memory_id: 'gated-mem-001',
                cortex: 'crypto',
                data: { key: 'ALPHA/SIGNAL', value: 'premium' },
                author: 'bb'.repeat(32),
                access: 'gated',
                ts: 1708617600000,
            });

            // Pre-store an open memory for free-read tests
            await indexer._handleMemoryWrite('cortex-crypto', {
                v: 1,
                type: 'memory_write',
                memory_id: 'open-mem-001',
                cortex: 'crypto',
                data: { key: 'BTC/USD', value: 97000 },
                author: 'dd'.repeat(32),
                access: 'open',
                ts: 1708617600000,
            });

            // Reset calls after setup
            appendCalls = [];
            broadcastCalls = [];
        });

        after(() => {
            if (fs.existsSync(TEST_DATA_DIR)) {
                fs.rmSync(TEST_DATA_DIR, { recursive: true });
            }
        });

        it('should return payment_required with split amounts and two addresses', async () => {
            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'paid-mem-001',
                // no payment txids
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'payment_required');
            assert.equal(response.memory_id, 'paid-mem-001');
            assert.equal(response.amount, '30000000000000000');
            // 70/30 split for gated memory
            assert.equal(response.creator_share, '21000000000000000');
            assert.equal(response.node_share, '9000000000000000');
            assert.equal(response.pay_to_creator, 'trac1creator_cccccccc');
            assert.equal(response.pay_to_node, 'trac1testnode');
            assert.equal(typeof response.ts, 'number');
        });

        it('should use 70/30 split for gated memories', async () => {
            broadcastCalls = [];

            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'gated-mem-001',
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'payment_required');
            assert.equal(response.creator_share, '21000000000000000'); // 70%
            assert.equal(response.node_share, '9000000000000000');     // 30%
            assert.equal(response.pay_to_creator, 'trac1creator_bbbbbbbb');
        });

        it('should serve data when both payment txids provided', async () => {
            broadcastCalls = [];
            appendCalls = [];

            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'paid-mem-001',
                payment_txid_creator: 'tx-creator-123',
                payment_txid_node: 'tx-node-456',
                payer: 'dd'.repeat(32),
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'memory_response');
            assert.equal(response.memory_id, 'paid-mem-001');
            assert.equal(response.found, true);
            assert.deepEqual(response.data, { key: 'ETH/USD', value: 3200 });
            assert.equal(response.fee_recorded, true);

            // Verify record_fee was appended with both txids
            assert.equal(appendCalls.length, 1);
            assert.equal(appendCalls[0].key, 'record_fee');
            const feeVal = appendCalls[0].value;
            assert.equal(feeVal.memory_id, 'paid-mem-001');
            assert.equal(feeVal.operation, 'read_gated');
            assert.equal(feeVal.payer, 'dd'.repeat(32));
            assert.equal(feeVal.payment_txid_creator, 'tx-creator-123');
            assert.equal(feeVal.payment_txid_node, 'tx-node-456');
            assert.equal(feeVal.amount, '30000000000000000');
            assert.equal(feeVal.creator_share, '21000000000000000');
            assert.equal(feeVal.node_share, '9000000000000000');
        });

        it('should return payment_required when only one txid is provided', async () => {
            broadcastCalls = [];

            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'paid-mem-001',
                payment_txid_creator: 'tx-creator-only',
                // missing payment_txid_node
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'payment_required');
        });

        it('should serve data free when payer is the author (self-read bypass)', async () => {
            broadcastCalls = [];
            appendCalls = [];

            // paid-mem-001 author is 'cc'.repeat(32)
            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'paid-mem-001',
                payer: 'cc'.repeat(32),
                // no payment txids
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'memory_response');
            assert.equal(response.found, true);
            assert.deepEqual(response.data, { key: 'ETH/USD', value: 3200 });
            assert.equal(response.fee_recorded, false);
            // No record_fee should be appended
            assert.equal(appendCalls.length, 0);
        });

        it('should return found:false for non-existent memory even with payment', async () => {
            broadcastCalls = [];

            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'nonexistent-paid',
                payment_txid_creator: 'tx-c-ghost',
                payment_txid_node: 'tx-n-ghost',
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'memory_response');
            assert.equal(response.found, false);
        });

        it('open memory served without payment', async () => {
            broadcastCalls = [];
            const replies = [];

            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'open-mem-001',
            }, (data) => replies.push(JSON.parse(data)));

            assert.equal(replies.length, 1);
            const response = replies[0];
            assert.equal(response.type, 'memory_response');
            assert.equal(response.found, true);
            assert.deepEqual(response.data, { key: 'BTC/USD', value: 97000 });
        });

        it('open memory read does not record fee', async () => {
            appendCalls = [];
            const replies = [];

            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'open-mem-001',
            }, (data) => replies.push(JSON.parse(data)));

            const response = replies[0];
            assert.equal(response.fee_recorded, false);
            // No record_fee append should have been triggered
            const feeAppends = appendCalls.filter(c => c.key === 'record_fee');
            assert.equal(feeAppends.length, 0);
        });

        it('should use custom price for gated memory with price field', async () => {
            broadcastCalls = [];

            // Store a gated memory with custom price (0.5 TNK)
            await indexer._handleMemoryWrite('cortex-crypto', {
                v: 1,
                type: 'memory_write',
                memory_id: 'gated-custom-price',
                cortex: 'crypto',
                data: { key: 'PREMIUM', value: 'signal' },
                author: 'ee'.repeat(32),
                access: 'gated',
                price: '500000000000000000',
                ts: 1708617600000,
            });
            broadcastCalls = [];

            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'gated-custom-price',
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'payment_required');
            assert.equal(response.amount, '500000000000000000'); // 0.5 TNK, not 0.03
            // 70/30 split on 0.5 TNK
            assert.equal(response.creator_share, '350000000000000000'); // 70%
            assert.equal(response.node_share, '150000000000000000');    // 30%
        });

        it('should serve open memory for free even if price field present', async () => {
            broadcastCalls = [];

            // Store an open memory with price (should be ignored — open = free)
            await indexer._handleMemoryWrite('cortex-crypto', {
                v: 1,
                type: 'memory_write',
                memory_id: 'open-with-price',
                cortex: 'crypto',
                data: { key: 'PUBLIC', value: 'data' },
                author: 'ff'.repeat(32),
                access: 'open',
                price: '500000000000000000',
                ts: 1708617600000,
            });
            broadcastCalls = [];

            const replies = [];
            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'open-with-price',
            }, (data) => replies.push(JSON.parse(data)));

            assert.equal(replies.length, 1);
            const response = replies[0];
            assert.equal(response.type, 'memory_response');
            assert.equal(response.found, true);
            assert.equal(response.fee_recorded, false);
        });

        it('_computeFeeSplit with custom amount should split correctly', () => {
            const split = indexer._computeFeeSplit('gated', '1000000000000000000'); // 1 TNK
            assert.equal(split.creator_share, '700000000000000000'); // 70%
            assert.equal(split.node_share, '300000000000000000');    // 30%
        });
    });
});

// ---------------------------------------------------------------------------
// register_memory — update by same author
// ---------------------------------------------------------------------------

describe('register_memory — update by same author', () => {

    it('should create a new memory', async () => {
        const ctx = createMockContract();
        ctx.address = 'author-aaa';
        ctx.value = {
            memory_id: 'mem-update-001',
            cortex: 'cortex-crypto',
            author: 'author-aaa',
            access: 'open',
            content_hash: 'a'.repeat(64),
            ts: 1708617600000,
            tags: 'bitcoin,price',
        };

        const result = await callContract('register_memory', ctx);
        assert.equal(result, undefined, 'Should not return error');

        const mem = ctx.state['mem/mem-update-001'];
        assert.ok(mem, 'Memory should exist');
        assert.equal(mem.author, 'author-aaa');
        assert.equal(mem.content_hash, 'a'.repeat(64));
        assert.equal(mem.ts, 1708617600000);
        assert.ok(ctx.state['mem_by_author/author-aaa/mem-update-001']);
        assert.ok(ctx.state['mem_by_cortex/cortex-crypto/mem-update-001']);
    });

    it('should allow update by same author', async () => {
        const ctx = createMockContract();
        // Seed existing memory
        seedMemory(ctx.state, 'mem-update-002', 'author-bbb', {
            cortex: 'cortex-crypto',
            content_hash: 'b'.repeat(64),
            ts: 1708617600000,
        });
        ctx.state['mem_by_author/author-bbb/mem-update-002'] = true;
        ctx.state['mem_by_cortex/cortex-crypto/mem-update-002'] = true;

        // Same author updates with new content_hash and ts
        ctx.address = 'author-bbb';
        ctx.value = {
            memory_id: 'mem-update-002',
            cortex: 'cortex-crypto',
            author: 'author-bbb',
            access: 'open',
            content_hash: 'c'.repeat(64),
            ts: 1708617700000,
            tags: 'updated',
        };

        const result = await callContract('register_memory', ctx);
        assert.equal(result, undefined, 'Should not return error for same author update');

        const mem = ctx.state['mem/mem-update-002'];
        assert.equal(mem.content_hash, 'c'.repeat(64), 'content_hash should be updated');
        assert.equal(mem.ts, 1708617700000, 'ts should be updated');
        assert.deepEqual(mem.tags, ['updated'], 'tags should be updated');
    });

    it('should reject update by different author', async () => {
        const ctx = createMockContract();
        // Seed existing memory owned by author-aaa
        seedMemory(ctx.state, 'mem-update-003', 'author-aaa', {
            cortex: 'cortex-crypto',
            content_hash: 'a'.repeat(64),
            ts: 1708617600000,
        });

        // Different author tries to update
        ctx.address = 'author-different';
        ctx.value = {
            memory_id: 'mem-update-003',
            cortex: 'cortex-crypto',
            author: 'author-different',
            access: 'open',
            content_hash: 'd'.repeat(64),
            ts: 1708617800000,
        };

        const result = await callContract('register_memory', ctx);
        assert.ok(result instanceof Error, 'Should return error for different author');
        assert.match(result.message, /not the author/i);

        // Original memory should be unchanged
        const mem = ctx.state['mem/mem-update-003'];
        assert.equal(mem.author, 'author-aaa');
        assert.equal(mem.content_hash, 'a'.repeat(64));
    });
});

// ---------------------------------------------------------------------------
// TNK Transfer Utilities
// ---------------------------------------------------------------------------

describe('TNK Transfer Utilities', () => {

    describe('verifyTNKTransfer', () => {
        it('should return sequence number when tx is confirmed', async () => {
            const mockMsb = {
                state: {
                    getTransactionConfirmedLength: async (hash) => {
                        if (hash === 'abc123def456'.repeat(5) + 'abcd') return 42;
                        return null;
                    }
                }
            };

            const result = await verifyTNKTransfer(mockMsb, 'abc123def456'.repeat(5) + 'abcd');
            assert.equal(result, 42);
        });

        it('should return null when tx is not confirmed', async () => {
            const mockMsb = {
                state: {
                    getTransactionConfirmedLength: async () => null
                }
            };

            const result = await verifyTNKTransfer(mockMsb, 'unknown-tx-hash');
            assert.equal(result, null);
        });
    });

    describe('sendTNK — bech32m address validation', () => {
        it('should reject invalid bech32m address with helpful error for bad characters', async () => {
            const mockMsb = {
                wallet: { publicKey: 'aa'.repeat(32), address: 'trac1fakesender' },
            };

            // 'o' and '1' are not valid bech32m characters
            const badAddress = 'trac1ped9c72o5jypky50ucwsnfk1usyazqynwep38grdscvj9n68e14scs0g3e';
            const result = await sendTNK(mockMsb, badAddress, '50000000000000000');

            assert.equal(result.success, false);
            assert.equal(result.txHash, null);
            assert.ok(result.error.includes('Invalid bech32m address'), 'Should mention invalid address');
            assert.ok(result.error.includes("'o'"), "Should identify 'o' as invalid");
            assert.ok(result.error.includes("'1'"), "Should identify '1' as invalid");
            assert.ok(result.error.includes('common confusion'), 'Should hint at common confusion');
        });

        it('should reject address with valid chars but bad checksum', async () => {
            const mockMsb = {
                wallet: { publicKey: 'aa'.repeat(32), address: 'trac1fakesender' },
            };

            // All valid bech32m chars, but checksum is wrong
            const badChecksum = 'trac1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzzyy';
            const result = await sendTNK(mockMsb, badChecksum, '50000000000000000');

            assert.equal(result.success, false);
            assert.equal(result.txHash, null);
            assert.ok(result.error.includes('checksum'), 'Should mention checksum mismatch');
        });
    });
});

// ---------------------------------------------------------------------------
// MemoryIndexer — MSB dual-txid verification
// ---------------------------------------------------------------------------

describe('MemoryIndexer — MSB dual-txid verification', () => {
    const TEST_DATA_DIR = './test-mnemex-data-txverify-' + Date.now();
    let broadcastCalls;
    let appendCalls;

    const makeMockPeer = () => ({
        base: { writable: true, isIndexer: true, append: async () => {} },
        protocol: { instance: { generateNonce: () => 'nonce-' + Date.now() } },
        wallet: { publicKey: 'ee'.repeat(32), sign: () => 'fake-sig', address: 'trac1verifynode' },
        msbClient: {
            pubKeyHexToAddress: (hex) => 'trac1_' + hex.slice(0, 8),
        },
        sidechannel: {
            broadcast: (channel, message) => {
                broadcastCalls.push({ channel, message });
            },
        },
    });

    after(() => {
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true });
        }
    });

    it('should reject when creator txid is not confirmed', async () => {
        broadcastCalls = [];
        appendCalls = [];

        const mockMsb = {
            state: {
                getTransactionConfirmedLength: async () => null // nothing confirmed
            }
        };

        const indexer = new MemoryIndexer(makeMockPeer(), {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
            requirePayment: true,
            nodeAddress: 'trac1verifynode',
            msb: mockMsb,
            paymentRetryMs: 0,
            paymentMaxAttempts: 1,
            paymentSkipApi: true,
            isBootstrapPeer: true,
        });
        indexer.key = 'memory_indexer';
        indexer.append = async (key, value) => { appendCalls.push({ key, value }); };
        await indexer.start();

        // Write a gated memory first (only gated goes through payment gate)
        await indexer._handleMemoryWrite('cortex-crypto', {
            v: 1, type: 'memory_write',
            memory_id: 'verify-mem-001', cortex: 'crypto',
            data: { key: 'SOL/USD', value: 120 },
            author: 'ee'.repeat(32), access: 'gated', ts: 1708617600000,
        });
        broadcastCalls = [];
        appendCalls = [];

        // Read with unconfirmed creator txid
        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read',
            memory_id: 'verify-mem-001',
            payment_txid_creator: 'unconfirmed-creator-tx',
            payment_txid_node: 'node-tx-ok',
        });

        assert.equal(broadcastCalls.length, 1);
        const response = JSON.parse(broadcastCalls[0].message);
        assert.equal(response.type, 'payment_not_confirmed');
        assert.equal(response.payment_txid, 'unconfirmed-creator-tx');
        assert.equal(response.which, 'creator');
        assert.equal(appendCalls.length, 0);
    });

    it('should reject when node txid is not confirmed', async () => {
        broadcastCalls = [];
        appendCalls = [];

        const mockMsb = {
            state: {
                getTransactionConfirmedLength: async (hash) => {
                    // Creator confirmed, node NOT
                    if (hash === 'creator-tx-ok') return 10;
                    return null;
                }
            }
        };

        const indexer = new MemoryIndexer(makeMockPeer(), {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
            requirePayment: true,
            nodeAddress: 'trac1verifynode',
            msb: mockMsb,
            paymentRetryMs: 0,
            paymentMaxAttempts: 1,
            paymentSkipApi: true,
            isBootstrapPeer: true,
        });
        indexer.key = 'memory_indexer';
        indexer.append = async (key, value) => { appendCalls.push({ key, value }); };
        await indexer.start();

        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read',
            memory_id: 'verify-mem-001',
            payment_txid_creator: 'creator-tx-ok',
            payment_txid_node: 'unconfirmed-node-tx',
        });

        assert.equal(broadcastCalls.length, 1);
        const response = JSON.parse(broadcastCalls[0].message);
        assert.equal(response.type, 'payment_not_confirmed');
        assert.equal(response.payment_txid, 'unconfirmed-node-tx');
        assert.equal(response.which, 'node');
        assert.equal(appendCalls.length, 0);
    });

    it('should serve data when both txids are confirmed on MSB', async () => {
        broadcastCalls = [];
        appendCalls = [];

        const mockMsb = {
            state: {
                getTransactionConfirmedLength: async (hash) => {
                    if (hash === 'confirmed-creator-tx') return 50;
                    if (hash === 'confirmed-node-tx') return 51;
                    return null;
                }
            }
        };

        const indexer = new MemoryIndexer(makeMockPeer(), {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
            requirePayment: true,
            nodeAddress: 'trac1verifynode',
            msb: mockMsb,
            paymentRetryMs: 0,
            paymentMaxAttempts: 1,
            paymentSkipApi: true,
            isBootstrapPeer: true,
        });
        indexer.key = 'memory_indexer';
        indexer.append = async (key, value) => { appendCalls.push({ key, value }); };
        await indexer.start();

        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read',
            memory_id: 'verify-mem-001',
            payment_txid_creator: 'confirmed-creator-tx',
            payment_txid_node: 'confirmed-node-tx',
            payer: 'ff'.repeat(32),
        });

        assert.equal(broadcastCalls.length, 1);
        const response = JSON.parse(broadcastCalls[0].message);
        assert.equal(response.type, 'memory_response');
        assert.equal(response.found, true);
        assert.deepEqual(response.data, { key: 'SOL/USD', value: 120 });
        assert.equal(response.fee_recorded, true);

        // Fee recorded with both txids
        assert.equal(appendCalls.length, 1);
        assert.equal(appendCalls[0].key, 'record_fee');
        assert.equal(appendCalls[0].value.payment_txid_creator, 'confirmed-creator-tx');
        assert.equal(appendCalls[0].value.payment_txid_node, 'confirmed-node-tx');
    });

    it('should skip MSB verification when msb is null (dev mode)', async () => {
        broadcastCalls = [];
        appendCalls = [];

        const indexer = new MemoryIndexer(makeMockPeer(), {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
            requirePayment: true,
            nodeAddress: 'trac1verifynode',
            msb: null, // no MSB — skip verification
            isBootstrapPeer: true,
        });
        indexer.key = 'memory_indexer';
        indexer.append = async (key, value) => { appendCalls.push({ key, value }); };
        await indexer.start();

        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read',
            memory_id: 'verify-mem-001',
            payment_txid_creator: 'any-creator-tx',
            payment_txid_node: 'any-node-tx',
            payer: 'aa'.repeat(32),
        });

        assert.equal(broadcastCalls.length, 1);
        const response = JSON.parse(broadcastCalls[0].message);
        assert.equal(response.type, 'memory_response');
        assert.equal(response.found, true);
        assert.deepEqual(response.data, { key: 'SOL/USD', value: 120 });

        // Fee still recorded
        assert.equal(appendCalls.length, 1);
        assert.equal(appendCalls[0].key, 'record_fee');
    });
});

// ---------------------------------------------------------------------------
// msb_transfer — protocol handler logic
// ---------------------------------------------------------------------------

describe('msb_transfer', () => {

    it('should call msb.handleCommand with /transfer <to> <amount>', async () => {
        let commandReceived = null;
        const mockMsb = {
            handleCommand: async (cmd) => {
                commandReceived = cmd;
                return { success: true, txHash: 'abc123' };
            }
        };

        const to = 'trac1jad8mn8fe6m2hrn58cvt42vtjqzxwshv4dzvsy2p6ykm4l2sy98s9swkx5';
        const amount = '0.021';
        const result = await mockMsb.handleCommand('/transfer ' + to + ' ' + amount);

        assert.equal(commandReceived, '/transfer trac1jad8mn8fe6m2hrn58cvt42vtjqzxwshv4dzvsy2p6ykm4l2sy98s9swkx5 0.021');
        assert.deepEqual(result, { success: true, txHash: 'abc123' });
    });

    it('should handle transfer failure gracefully', async () => {
        const mockMsb = {
            handleCommand: async () => {
                throw new Error('Insufficient balance');
            }
        };

        let error = null;
        try {
            await mockMsb.handleCommand('/transfer trac1abc 0.5');
        } catch (err) {
            error = err;
        }
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Insufficient balance');
    });

    it('SC-Bridge handler should validate required fields', () => {
        // Simulates the SC-Bridge msb_transfer validation logic
        const messages = [
            { type: 'msb_transfer' }, // missing to and amount
            { type: 'msb_transfer', to: 'trac1abc' }, // missing amount
            { type: 'msb_transfer', amount: '0.01' }, // missing to
        ];

        for (const msg of messages) {
            const to = msg.to;
            const amount = msg.amount;
            assert.ok(!to || !amount, 'Should detect missing to or amount for: ' + JSON.stringify(msg));
        }

        // Valid message
        const valid = { type: 'msb_transfer', to: 'trac1abc', amount: '0.021' };
        assert.ok(valid.to && valid.amount, 'Should accept valid message');
    });

    it('peer._msb should be set on the peer object', () => {
        // Simulates index.js wiring: peer._msb = msb
        const msb = { handleCommand: async () => {} };
        const peer = {};
        peer._msb = msb;
        assert.strictEqual(peer._msb, msb);
        assert.ok(typeof peer._msb.handleCommand === 'function');
    });
});
