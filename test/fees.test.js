import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import MnemexContract from '../contract/contract.js';
import { MemoryIndexer } from '../features/memory-indexer/index.js';

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

        it('should split 60/40 for read_open', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-001', 'author-aaa');
            ctx.value = {
                memory_id: 'mem-001',
                operation: 'read_open',
                payer: 'payer-xxx',
                payment_txid: 'tx-001',
                amount: '100000000000000000', // 0.1 TNK
                ts: 1708617600000,
            };

            const result = await callContract('record_fee', ctx);
            assert.equal(result, undefined, 'Should not return error');

            const fee = ctx.state['fee/tx-001'];
            assert.ok(fee, 'Fee record should exist');
            assert.equal(fee.creator_share, '60000000000000000');  // 60%
            assert.equal(fee.node_share, '40000000000000000');     // 40%
            assert.equal(ctx.state['balance/author-aaa'], '60000000000000000');
            assert.equal(ctx.state['balance_nodes'], '40000000000000000');
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
                operation: 'read_open',
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
                operation: 'read_open',
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
                operation: 'read_open',
                payer: 'p1',
                payment_txid: 'tx-a',
                amount: '100000000000000000',
                ts: 1,
            };
            await callContract('record_fee', ctx);

            // Second fee
            ctx.value = {
                memory_id: 'mem-multi',
                operation: 'read_open',
                payer: 'p2',
                payment_txid: 'tx-b',
                amount: '200000000000000000',
                ts: 2,
            };
            await callContract('record_fee', ctx);

            // 60% of 100 + 60% of 200 = 60 + 120 = 180
            assert.equal(ctx.state['balance/author-multi'], '180000000000000000');
            // 40% of 100 + 40% of 200 = 40 + 80 = 120
            assert.equal(ctx.state['balance_nodes'], '120000000000000000');
        });
    });

    // ========== Stats accumulation ==========

    describe('Stats accumulation', () => {
        it('total_fees and fee_count should accumulate correctly', async () => {
            const ctx = createMockContract();
            seedMemory(ctx.state, 'mem-stats', 'author-stats');

            ctx.value = {
                memory_id: 'mem-stats',
                operation: 'read_open',
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

    // ========== MemoryIndexer Payment Gate tests ==========

    describe('MemoryIndexer Payment Gate', () => {
        const TEST_DATA_DIR = './test-mnemex-data-fees-' + Date.now();
        let indexer;
        let appendCalls;
        let broadcastCalls;

        const mockPeer = {
            base: { writable: true, append: async () => {} },
            protocol: { instance: { generateNonce: () => 'nonce-' + Date.now() } },
            wallet: { publicKey: 'cc'.repeat(32), sign: () => 'fake-sig', address: 'trac1testnode' },
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
            });

            indexer.key = 'memory_indexer';
            indexer.append = async (key, value) => {
                appendCalls.push({ key, value });
            };

            await indexer.start();

            // Pre-store a memory for read tests
            await indexer._handleMemoryWrite('cortex-crypto', {
                v: 1,
                type: 'memory_write',
                memory_id: 'paid-mem-001',
                cortex: 'crypto',
                data: { key: 'ETH/USD', value: 3200 },
                author: 'cc'.repeat(32),
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

        it('should return payment_required when no payment_txid', async () => {
            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'paid-mem-001',
                // no payment_txid
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'payment_required');
            assert.equal(response.memory_id, 'paid-mem-001');
            assert.equal(response.amount, '30000000000000000');
            assert.equal(response.pay_to, 'trac1testnode');
            assert.equal(typeof response.ts, 'number');
        });

        it('should serve data when payment_txid provided', async () => {
            broadcastCalls = [];
            appendCalls = [];

            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'paid-mem-001',
                payment_txid: 'msb-tx-hash-123',
                payer: 'dd'.repeat(32),
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'memory_response');
            assert.equal(response.memory_id, 'paid-mem-001');
            assert.equal(response.found, true);
            assert.deepEqual(response.data, { key: 'ETH/USD', value: 3200 });
            assert.equal(response.fee_recorded, true);

            // Verify record_fee was appended
            assert.equal(appendCalls.length, 1);
            assert.equal(appendCalls[0].key, 'record_fee');
            const feeVal = appendCalls[0].value;
            assert.equal(feeVal.memory_id, 'paid-mem-001');
            assert.equal(feeVal.operation, 'read_open');
            assert.equal(feeVal.payer, 'dd'.repeat(32));
            assert.equal(feeVal.payment_txid, 'msb-tx-hash-123');
            assert.equal(feeVal.amount, '30000000000000000');
        });

        it('should return found:false for non-existent memory even with payment', async () => {
            broadcastCalls = [];

            await indexer._handleMemoryRead('cortex-crypto', {
                v: 1,
                type: 'memory_read',
                memory_id: 'nonexistent-paid',
                payment_txid: 'msb-tx-ghost',
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'memory_response');
            assert.equal(response.found, false);
        });
    });
});
