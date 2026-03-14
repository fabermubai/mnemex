import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import MnemexContract from '../contract/contract.js';
import { MemoryIndexer } from '../features/memory-indexer/index.js';

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
            operation: 'read_gated',
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
            operation: 'read_gated',
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

    it('rep/<author>/reads increments via Feature handler (production path)', async () => {
        // The Feature handler is the real production path (this.append → memory_indexer_feature).
        // The handler is a closure over _this from the constructor. We instantiate MnemexContract
        // with all methods stubbed, then override _this's state access to use our mock.
        let featureHandler = null;
        const origAddFeature = MnemexContract.prototype.addFeature;
        MnemexContract.prototype.addFeature = function(name, fn) {
            if (name === 'memory_indexer_feature') featureHandler = fn.bind(this);
            // call original so check schemas are compiled
            return origAddFeature.call(this, name, fn);
        };
        const contract = new MnemexContract();
        MnemexContract.prototype.addFeature = origAddFeature;

        // Inject mock state into the contract instance
        const state = {};
        seedMemory(state, 'feat-mem-001', 'feat-author');
        contract.get = async (key) => state[key] !== undefined ? state[key] : null;
        contract.put = async (key, value) => { state[key] = value; };
        contract.protocol = {
            safeBigInt: (str) => {
                if (str === null || str === undefined) return null;
                try { return BigInt(str); } catch { return null; }
            },
        };

        // First record_fee via Feature path
        contract.op = {
            key: 'record_fee',
            value: {
                memory_id: 'feat-mem-001',
                operation: 'read_gated',
                payer: 'payer-feat',
                payment_txid: 'feat-tx-001',
                amount: '100000000000000000',
                ts: Date.now(),
            }
        };
        await featureHandler();
        assert.equal(state['rep/feat-author/reads'], 1, 'Feature path should increment reads');

        // Second fee
        contract.op = {
            key: 'record_fee',
            value: {
                memory_id: 'feat-mem-001',
                operation: 'read_gated',
                payer: 'payer-feat-2',
                payment_txid: 'feat-tx-002',
                amount: '100000000000000000',
                ts: Date.now(),
            }
        };
        await featureHandler();
        assert.equal(state['rep/feat-author/reads'], 2, 'Feature path should accumulate reads');
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

// ---------------------------------------------------------------------------
// Phase 7 — Follow / Unfollow
// ---------------------------------------------------------------------------

describe('Phase 7 — Follow / Unfollow', () => {

    it('follow_agent creates bidirectional entries and increments counters', async () => {
        const ctx = createMockContract();
        ctx.address = 'follower-aaa';
        ctx.value = { op: 'follow_agent', target: 'target-bbb' };

        const result = await callContract('follow_agent', ctx);
        assert.equal(result, undefined, 'Should not return error');

        assert.deepEqual(ctx.state['follows/follower-aaa/target-bbb'], { ts: 0 });
        assert.deepEqual(ctx.state['followers/target-bbb/follower-aaa'], { ts: 0 });
        assert.equal(ctx.state['following_count/follower-aaa'], 1);
        assert.equal(ctx.state['follower_count/target-bbb'], 1);
    });

    it('follow_agent rejects self-follow', async () => {
        const ctx = createMockContract();
        ctx.address = 'agent-aaa';
        ctx.value = { op: 'follow_agent', target: 'agent-aaa' };

        const result = await callContract('follow_agent', ctx);
        assert.ok(result instanceof Error);
        assert.match(result.message, /yourself/i);
    });

    it('follow_agent rejects double follow', async () => {
        const ctx = createMockContract();
        ctx.address = 'follower-aaa';
        ctx.state['follows/follower-aaa/target-bbb'] = { ts: 100 };
        ctx.value = { op: 'follow_agent', target: 'target-bbb' };

        const result = await callContract('follow_agent', ctx);
        assert.ok(result instanceof Error);
        assert.match(result.message, /already/i);
    });

    it('follow_agent increments counters across multiple follows', async () => {
        const ctx = createMockContract();
        ctx.address = 'follower-aaa';

        ctx.value = { op: 'follow_agent', target: 'target-bbb' };
        await callContract('follow_agent', ctx);

        ctx.value = { op: 'follow_agent', target: 'target-ccc' };
        await callContract('follow_agent', ctx);

        assert.equal(ctx.state['following_count/follower-aaa'], 2);
        assert.equal(ctx.state['follower_count/target-bbb'], 1);
        assert.equal(ctx.state['follower_count/target-ccc'], 1);
    });

    it('unfollow_agent removes entries and decrements counters', async () => {
        const ctx = createMockContract();
        ctx.address = 'follower-aaa';

        // First follow
        ctx.value = { op: 'follow_agent', target: 'target-bbb' };
        await callContract('follow_agent', ctx);
        assert.equal(ctx.state['following_count/follower-aaa'], 1);

        // Then unfollow
        ctx.value = { op: 'unfollow_agent', target: 'target-bbb' };
        const result = await callContract('unfollow_agent', ctx);
        assert.equal(result, undefined, 'Should not return error');

        assert.equal(ctx.state['follows/follower-aaa/target-bbb'], null);
        assert.equal(ctx.state['followers/target-bbb/follower-aaa'], null);
        assert.equal(ctx.state['following_count/follower-aaa'], 0);
        assert.equal(ctx.state['follower_count/target-bbb'], 0);
    });

    it('unfollow_agent rejects if not following', async () => {
        const ctx = createMockContract();
        ctx.address = 'follower-aaa';
        ctx.value = { op: 'unfollow_agent', target: 'target-bbb' };

        const result = await callContract('unfollow_agent', ctx);
        assert.ok(result instanceof Error);
        assert.match(result.message, /not following/i);
    });

    it('follower_count does not go below zero', async () => {
        const ctx = createMockContract();
        ctx.address = 'follower-aaa';
        ctx.state['follows/follower-aaa/target-bbb'] = { ts: 100 };
        ctx.state['following_count/follower-aaa'] = 0;
        ctx.state['follower_count/target-bbb'] = 0;
        ctx.value = { op: 'unfollow_agent', target: 'target-bbb' };

        await callContract('unfollow_agent', ctx);
        assert.equal(ctx.state['following_count/follower-aaa'], 0);
        assert.equal(ctx.state['follower_count/target-bbb'], 0);
    });
});

// ---------------------------------------------------------------------------
// Phase 7 — Rate Limiting
// ---------------------------------------------------------------------------

describe('Phase 7 — Rate Limiting', () => {
    const TEST_DATA_DIR = './test-mnemex-data-ratelimit-' + Date.now();
    let appendCalls;

    const makeMockPeer = () => ({
        base: { writable: true, append: async () => {} },
        protocol: { instance: { generateNonce: () => 'nonce-' + Date.now() } },
        wallet: { publicKey: 'aa'.repeat(32), sign: () => 'fake-sig', address: 'trac1ratelimit' },
        msbClient: { pubKeyHexToAddress: (hex) => 'trac1_' + hex.slice(0, 8) },
        sidechannel: { broadcast: () => {} },
    });

    after(() => {
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true });
        }
    });

    it('should accept writes under the limit', async () => {
        appendCalls = [];
        const indexer = new MemoryIndexer(makeMockPeer(), {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
            rateLimitMax: 5,
            rateLimitWindow: 60_000,
        });
        indexer.key = 'memory_indexer';
        indexer.append = async (key, value) => { appendCalls.push({ key, value }); };
        await indexer.start();

        for (let i = 0; i < 5; i++) {
            await indexer._handleMemoryWrite('cortex-crypto', {
                v: 1, type: 'memory_write',
                memory_id: 'rl-mem-' + i, cortex: 'crypto',
                data: { i }, author: 'bb'.repeat(32), ts: Date.now(),
            });
        }

        // All 5 should produce register_memory appends
        const regCalls = appendCalls.filter(c => c.key === 'register_memory');
        assert.equal(regCalls.length, 5);
    });

    it('should reject writes beyond the limit', async () => {
        appendCalls = [];
        const indexer = new MemoryIndexer(makeMockPeer(), {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
            rateLimitMax: 3,
            rateLimitWindow: 60_000,
        });
        indexer.key = 'memory_indexer';
        indexer.append = async (key, value) => { appendCalls.push({ key, value }); };
        await indexer.start();

        for (let i = 0; i < 6; i++) {
            await indexer._handleMemoryWrite('cortex-crypto', {
                v: 1, type: 'memory_write',
                memory_id: 'rl-over-' + i, cortex: 'crypto',
                data: { i }, author: 'cc'.repeat(32), ts: Date.now(),
            });
        }

        // Only 3 should go through
        const regCalls = appendCalls.filter(c => c.key === 'register_memory');
        assert.equal(regCalls.length, 3);
    });

    it('should reset counter after window expires', async () => {
        appendCalls = [];
        const indexer = new MemoryIndexer(makeMockPeer(), {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
            rateLimitMax: 2,
            rateLimitWindow: 100, // 100ms window for test speed
        });
        indexer.key = 'memory_indexer';
        indexer.append = async (key, value) => { appendCalls.push({ key, value }); };
        await indexer.start();

        const author = 'dd'.repeat(32);

        // Write 2 (fills limit)
        for (let i = 0; i < 2; i++) {
            await indexer._handleMemoryWrite('cortex-crypto', {
                v: 1, type: 'memory_write',
                memory_id: 'rl-reset-' + i, cortex: 'crypto',
                data: { i }, author, ts: Date.now(),
            });
        }
        assert.equal(appendCalls.filter(c => c.key === 'register_memory').length, 2);

        // Wait for window to expire
        await new Promise(r => setTimeout(r, 150));

        // Should be able to write again
        await indexer._handleMemoryWrite('cortex-crypto', {
            v: 1, type: 'memory_write',
            memory_id: 'rl-reset-after', cortex: 'crypto',
            data: { after: true }, author, ts: Date.now(),
        });
        assert.equal(appendCalls.filter(c => c.key === 'register_memory').length, 3);
    });

    it('rate limit is per-author (different authors have separate counters)', async () => {
        appendCalls = [];
        const indexer = new MemoryIndexer(makeMockPeer(), {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
            rateLimitMax: 1,
            rateLimitWindow: 60_000,
        });
        indexer.key = 'memory_indexer';
        indexer.append = async (key, value) => { appendCalls.push({ key, value }); };
        await indexer.start();

        // Author 1
        await indexer._handleMemoryWrite('cortex-crypto', {
            v: 1, type: 'memory_write',
            memory_id: 'rl-auth1', cortex: 'crypto',
            data: { x: 1 }, author: 'e1'.repeat(32), ts: Date.now(),
        });
        // Author 2
        await indexer._handleMemoryWrite('cortex-crypto', {
            v: 1, type: 'memory_write',
            memory_id: 'rl-auth2', cortex: 'crypto',
            data: { x: 2 }, author: 'e2'.repeat(32), ts: Date.now(),
        });

        const regCalls = appendCalls.filter(c => c.key === 'register_memory');
        assert.equal(regCalls.length, 2);
    });
});

// ---------------------------------------------------------------------------
// Phase 7 — Author Reputation in memory_response
// ---------------------------------------------------------------------------

describe('Phase 7 — Author Reputation in Responses', () => {
    const TEST_DATA_DIR = './test-mnemex-data-rep-response-' + Date.now();
    let broadcastCalls;

    const makeMockPeer = (viewState = {}) => ({
        base: {
            writable: true,
            append: async () => {},
            view: {
                get: async (key) => viewState[key] !== undefined ? viewState[key] : null,
            },
        },
        protocol: { instance: { generateNonce: () => 'nonce-' + Date.now() } },
        wallet: { publicKey: 'aa'.repeat(32), sign: () => 'fake-sig', address: 'trac1reptest' },
        msbClient: { pubKeyHexToAddress: (hex) => 'trac1_' + hex.slice(0, 8) },
        sidechannel: {
            broadcast: (channel, message) => { broadcastCalls.push({ channel, message }); },
        },
    });

    after(() => {
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true });
        }
    });

    it('memory_response includes author_reputation for open read', async () => {
        broadcastCalls = [];
        const author = 'ff'.repeat(32);
        const viewState = {
            ['rep/' + author + '/reads']: 42,
            ['rep/' + author + '/slashes']: 1,
            ['follower_count/' + author]: 7,
        };

        const indexer = new MemoryIndexer(makeMockPeer(viewState), {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
        });
        indexer.key = 'memory_indexer';
        indexer.append = async () => {};
        await indexer.start();

        await indexer._handleMemoryWrite('cortex-crypto', {
            v: 1, type: 'memory_write',
            memory_id: 'rep-open-001', cortex: 'crypto',
            data: { key: 'test' }, author, access: 'open', ts: Date.now(),
        });
        broadcastCalls = [];

        const replies = [];
        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read', memory_id: 'rep-open-001',
        }, (data) => replies.push(JSON.parse(data)));

        assert.equal(replies.length, 1);
        const rep = replies[0].author_reputation;
        assert.ok(rep, 'Should include author_reputation');
        assert.equal(rep.reads, 42);
        assert.equal(rep.slashes, 1);
        assert.equal(rep.followers, 7);
        assert.equal(rep.score, 32); // 42 - (1 * 10)
    });

    it('author_reputation is null when view is unavailable', async () => {
        broadcastCalls = [];
        const author = 'gg'.repeat(32);

        // Peer with no base.view
        const peer = makeMockPeer();
        delete peer.base.view;

        const indexer = new MemoryIndexer(peer, {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
        });
        indexer.key = 'memory_indexer';
        indexer.append = async () => {};
        await indexer.start();

        await indexer._handleMemoryWrite('cortex-crypto', {
            v: 1, type: 'memory_write',
            memory_id: 'rep-noview-001', cortex: 'crypto',
            data: { key: 'test' }, author, access: 'open', ts: Date.now(),
        });
        broadcastCalls = [];

        const replies = [];
        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read', memory_id: 'rep-noview-001',
        }, (data) => replies.push(JSON.parse(data)));

        assert.equal(replies.length, 1);
        assert.equal(replies[0].author_reputation, null);
    });
});
