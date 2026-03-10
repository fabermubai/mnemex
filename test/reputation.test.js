import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import MnemexContract from '../contract/contract.js';

// ---------------------------------------------------------------------------
// Mock contract context — same pattern as fees.test.js
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

async function callContract(methodName, ctx) {
    return MnemexContract.prototype[methodName].call(ctx);
}

function seedMemory(state, memoryId, author) {
    state['mem/' + memoryId] = {
        author,
        cortex: 'crypto',
        access: 'open',
        content_hash: 'a'.repeat(64),
        ts: 1708617600000,
    };
}

// ---------------------------------------------------------------------------
// Phase 6 — Reputation Tests
// ---------------------------------------------------------------------------

describe('Phase 6 — Reputation Scores', () => {

    it('rep/<author>/reads increments on each record_fee', async () => {
        const ctx = createMockContract();
        seedMemory(ctx.state, 'mem-001', 'author-aaa');

        // First fee
        ctx.value = {
            memory_id: 'mem-001',
            operation: 'read_open',
            payer: 'payer-xxx',
            payment_txid: 'tx-001',
            amount: '100000000000000000',
            ts: 1708617600000,
        };
        await callContract('record_fee', ctx);
        assert.equal(ctx.state['rep/author-aaa/reads'], 1);

        // Second fee
        ctx.value = {
            memory_id: 'mem-001',
            operation: 'read_open',
            payer: 'payer-yyy',
            payment_txid: 'tx-002',
            amount: '100000000000000000',
            ts: 1708617600001,
        };
        await callContract('record_fee', ctx);
        assert.equal(ctx.state['rep/author-aaa/reads'], 2);
    });

    it('rep/<author>/slashes increments on each slash_stake', async () => {
        const ctx = createMockContract();
        seedMemory(ctx.state, 'mem-001', 'author-aaa');
        ctx.state['admin'] = 'admin-key';

        // Seed an active stake
        ctx.state['stake/mem-001'] = {
            author: 'author-aaa',
            stake_txid: 'stake-tx-001',
            stake_amount: '50000000000000000',
            ts: 1708617600000,
            status: 'active',
        };
        ctx.state['staked_by/author-aaa'] = '50000000000000000';

        ctx.address = 'admin-key';
        ctx.value = { memory_id: 'mem-001', reason: 'bad data' };
        await callContract('slash_stake', ctx);
        assert.equal(ctx.state['rep/author-aaa/slashes'], 1);

        // Second slash on a different memory
        seedMemory(ctx.state, 'mem-002', 'author-aaa');
        ctx.state['stake/mem-002'] = {
            author: 'author-aaa',
            stake_txid: 'stake-tx-002',
            stake_amount: '50000000000000000',
            ts: 1708617600000,
            status: 'active',
        };
        ctx.state['staked_by/author-aaa'] = '50000000000000000';

        ctx.value = { memory_id: 'mem-002', reason: 'spam' };
        await callContract('slash_stake', ctx);
        assert.equal(ctx.state['rep/author-aaa/slashes'], 2);
    });

    it('get_reputation returns correct score (reads - slashes*10)', async () => {
        const ctx = createMockContract();
        ctx.state['rep/author-bbb/reads'] = 25;
        ctx.state['rep/author-bbb/slashes'] = 2;
        ctx.value = { address: 'author-bbb' };

        // Capture console.log output
        const logs = [];
        const origLog = console.log;
        console.log = (...args) => logs.push(args);
        await callContract('get_reputation', ctx);
        console.log = origLog;

        const result = logs[0][1];
        assert.equal(result.address, 'author-bbb');
        assert.equal(result.reads, 25);
        assert.equal(result.slashes, 2);
        assert.equal(result.score, 5); // 25 - (2 * 10) = 5
    });

    it('get_reputation returns 0 for author with no history', async () => {
        const ctx = createMockContract();
        ctx.value = { address: 'unknown-author' };

        const logs = [];
        const origLog = console.log;
        console.log = (...args) => logs.push(args);
        await callContract('get_reputation', ctx);
        console.log = origLog;

        const result = logs[0][1];
        assert.equal(result.reads, 0);
        assert.equal(result.slashes, 0);
        assert.equal(result.score, 0);
    });
});
