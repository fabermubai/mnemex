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

// Seed a skill entry in mock state
function seedSkill(state, skillId, author, opts = {}) {
    state['skill/' + skillId] = {
        author,
        name: opts.name || 'Test Skill',
        description: opts.description || 'A test skill',
        cortex: opts.cortex || 'crypto',
        price: opts.price || '100000000000000000',
        version: opts.version || '1.0.0',
        ts: opts.ts || 0,
        status: opts.status || 'active',
        downloads: opts.downloads || 0,
    };
}

// ---------------------------------------------------------------------------
// Phase 3 Tests
// ---------------------------------------------------------------------------

describe('Phase 3 — Skills & Multi-Cortex', () => {

    // ========== register_skill tests ==========

    describe('register_skill', () => {

        it('should create skill entry with all fields', async () => {
            const ctx = createMockContract();
            ctx.address = 'author-skill-1';
            ctx.value = {
                skill_id: 'sk-001',
                name: 'BTC Momentum Strategy',
                description: 'Detects momentum shifts using RSI + MACD',
                cortex: 'crypto',
                price: '100000000000000000',
                version: '1.0.0',
            };

            const result = await callContract('register_skill', ctx);
            assert.equal(result, undefined, 'Should not return error');

            const skill = ctx.state['skill/sk-001'];
            assert.ok(skill, 'Skill record should exist');
            assert.equal(skill.author, 'author-skill-1');
            assert.equal(skill.name, 'BTC Momentum Strategy');
            assert.equal(skill.description, 'Detects momentum shifts using RSI + MACD');
            assert.equal(skill.cortex, 'crypto');
            assert.equal(skill.price, '100000000000000000');
            assert.equal(skill.version, '1.0.0');
            assert.equal(skill.status, 'active');
            assert.equal(skill.downloads, 0);

            // Check indexes
            assert.equal(ctx.state['skill_by_author/author-skill-1/sk-001'], true);
            assert.equal(ctx.state['skill_by_cortex/crypto/sk-001'], true);
        });

        it('should reject duplicate skill_id', async () => {
            const ctx = createMockContract();
            seedSkill(ctx.state, 'sk-dup', 'author-dup');
            ctx.address = 'author-other';
            ctx.value = {
                skill_id: 'sk-dup',
                name: 'Duplicate Skill',
                description: 'Should be rejected',
                cortex: 'crypto',
                price: '0',
                version: '1.0.0',
            };

            const result = await callContract('register_skill', ctx);
            assert.ok(result instanceof Error, 'Should return error for duplicate');
            assert.match(result.message, /already exists/i);
        });
    });

    // ========== update_skill tests ==========

    describe('update_skill', () => {

        it('should update only provided fields', async () => {
            const ctx = createMockContract();
            seedSkill(ctx.state, 'sk-upd', 'author-upd', {
                name: 'Original Name',
                description: 'Original desc',
                price: '50000000000000000',
                version: '1.0.0',
            });
            ctx.address = 'author-upd';
            ctx.value = {
                skill_id: 'sk-upd',
                description: 'Updated description',
                version: '1.1.0',
                // price and status NOT provided — should keep existing
            };

            const result = await callContract('update_skill', ctx);
            assert.equal(result, undefined, 'Should not return error');

            const skill = ctx.state['skill/sk-upd'];
            assert.equal(skill.description, 'Updated description');
            assert.equal(skill.version, '1.1.0');
            assert.equal(skill.price, '50000000000000000', 'Price should be unchanged');
            assert.equal(skill.status, 'active', 'Status should be unchanged');
            assert.equal(skill.name, 'Original Name', 'Name should be unchanged');
        });

        it('should reject non-author', async () => {
            const ctx = createMockContract();
            seedSkill(ctx.state, 'sk-upd-deny', 'real-author');
            ctx.address = 'wrong-author';
            ctx.value = {
                skill_id: 'sk-upd-deny',
                description: 'Hacked description',
            };

            const result = await callContract('update_skill', ctx);
            assert.ok(result instanceof Error, 'Should return error for wrong author');
            assert.match(result.message, /author/i);
        });
    });

    // ========== record_skill_download tests ==========

    describe('record_skill_download', () => {

        it('should increment download counter', async () => {
            const ctx = createMockContract();
            seedSkill(ctx.state, 'sk-dl-1', 'author-dl', { downloads: 5 });
            ctx.value = {
                skill_id: 'sk-dl-1',
                buyer: 'buyer-aaa',
                payment_txid: 'dl-tx-001',
                amount: '100000000000000000',
            };

            const result = await callContract('record_skill_download', ctx);
            assert.equal(result, undefined, 'Should not return error');

            const skill = ctx.state['skill/sk-dl-1'];
            assert.equal(skill.downloads, 6, 'Downloads should be incremented');
        });

        it('should apply 80/20 fee split', async () => {
            const ctx = createMockContract();
            seedSkill(ctx.state, 'sk-dl-2', 'author-fee');
            ctx.value = {
                skill_id: 'sk-dl-2',
                buyer: 'buyer-bbb',
                payment_txid: 'dl-tx-002',
                amount: '100000000000000000', // 0.1 TNK
            };

            const result = await callContract('record_skill_download', ctx);
            assert.equal(result, undefined, 'Should not return error');

            const dl = ctx.state['skill_download/dl-tx-002'];
            assert.ok(dl, 'Download record should exist');
            assert.equal(dl.creator_share, '80000000000000000');  // 80%
            assert.equal(dl.node_share, '20000000000000000');     // 20%

            assert.equal(ctx.state['balance/author-fee'], '80000000000000000');
            assert.equal(ctx.state['balance_nodes'], '20000000000000000');
            assert.equal(ctx.state['stats/total_fees'], '100000000000000000');
            assert.equal(ctx.state['stats/fee_count'], 1);
        });

        it('should reject duplicate payment_txid', async () => {
            const ctx = createMockContract();
            seedSkill(ctx.state, 'sk-dl-3', 'author-dup-dl');
            ctx.state['skill_download/dl-tx-dup'] = { skill_id: 'sk-dl-3' };
            ctx.value = {
                skill_id: 'sk-dl-3',
                buyer: 'buyer-ccc',
                payment_txid: 'dl-tx-dup',
                amount: '100000000000000000',
            };

            const result = await callContract('record_skill_download', ctx);
            assert.ok(result instanceof Error, 'Should return error for duplicate');
            assert.match(result.message, /already recorded/i);
        });

        it('should reject inactive skill', async () => {
            const ctx = createMockContract();
            seedSkill(ctx.state, 'sk-dl-inactive', 'author-inactive', { status: 'deprecated' });
            ctx.value = {
                skill_id: 'sk-dl-inactive',
                buyer: 'buyer-ddd',
                payment_txid: 'dl-tx-inactive',
                amount: '100000000000000000',
            };

            const result = await callContract('record_skill_download', ctx);
            assert.ok(result instanceof Error, 'Should return error for inactive skill');
            assert.match(result.message, /not active/i);
        });

        it('should reject non-existent skill', async () => {
            const ctx = createMockContract();
            ctx.value = {
                skill_id: 'sk-does-not-exist',
                buyer: 'buyer-eee',
                payment_txid: 'dl-tx-ghost',
                amount: '100000000000000000',
            };

            const result = await callContract('record_skill_download', ctx);
            assert.ok(result instanceof Error, 'Should return error for missing skill');
            assert.match(result.message, /not found/i);
        });

        it('should track per-node balance when served_by is provided', async () => {
            const ctx = createMockContract();
            seedSkill(ctx.state, 'sk-dl-node', 'author-dlnode');
            ctx.value = {
                skill_id: 'sk-dl-node',
                buyer: 'buyer-node',
                payment_txid: 'dl-tx-node-001',
                amount: '100000000000000000',
                served_by: 'node-pubkey-skill',
            };

            await callContract('record_skill_download', ctx);

            // 20% of 0.1 TNK to this node
            assert.equal(ctx.state['balance/node/node-pubkey-skill'], '20000000000000000');
            // Global pool still updated
            assert.equal(ctx.state['balance_nodes'], '20000000000000000');
            // Download record includes served_by
            const dl = ctx.state['skill_download/dl-tx-node-001'];
            assert.equal(dl.served_by, 'node-pubkey-skill');
        });
    });

    // ========== MemoryIndexer Skill tests ==========

    describe('MemoryIndexer Skills', () => {
        const TEST_DATA_DIR = './test-mnemex-data-skills-' + Date.now();
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
                enableSkills: true,
            });

            indexer.key = 'memory_indexer';
            indexer.append = async (key, value) => {
                appendCalls.push({ key, value });
            };

            await indexer.start();

            // Reset calls after setup
            appendCalls = [];
            broadcastCalls = [];
        });

        after(() => {
            if (fs.existsSync(TEST_DATA_DIR)) {
                fs.rmSync(TEST_DATA_DIR, { recursive: true });
            }
        });

        it('should handle skill_publish — store package and trigger contract TX', async () => {
            await indexer._handleSkillPublish('mnemex-skills', {
                v: 1,
                type: 'skill_publish',
                skill_id: 'test-skill-001',
                name: 'BTC Momentum',
                description: 'Momentum strategy',
                cortex: 'crypto',
                price: '100000000000000000',
                version: '1.0.0',
                package: { format: 'mnemex-skill-v1', type: 'strategy', content: { logic: 'rsi > 70' } },
                author: 'cc'.repeat(32),
                ts: 1708617600000,
            });

            // Verify local storage
            const filePath = path.join(TEST_DATA_DIR, 'skills', 'test-skill-001.json');
            assert.ok(fs.existsSync(filePath), 'Skill file should exist');
            const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            assert.equal(stored.skill_id, 'test-skill-001');
            assert.equal(stored.name, 'BTC Momentum');
            assert.deepEqual(stored.package, { format: 'mnemex-skill-v1', type: 'strategy', content: { logic: 'rsi > 70' } });

            // Verify contract TX
            assert.equal(appendCalls.length, 1);
            assert.equal(appendCalls[0].key, 'register_skill');
            assert.equal(appendCalls[0].value.skill_id, 'test-skill-001');
            assert.equal(appendCalls[0].value.name, 'BTC Momentum');
            assert.equal(appendCalls[0].value.cortex, 'crypto');
        });

        it('should handle skill_request with payment — deliver package', async () => {
            broadcastCalls = [];
            appendCalls = [];

            await indexer._handleSkillRequest('mnemex-skills', {
                v: 1,
                type: 'skill_request',
                skill_id: 'test-skill-001',
                payment_txid_creator: 'pay-tx-creator-001',
                payment_txid_node: 'pay-tx-node-001',
                buyer: 'dd'.repeat(32),
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'skill_deliver');
            assert.equal(response.skill_id, 'test-skill-001');
            assert.equal(response.found, true);
            assert.deepEqual(response.package, { format: 'mnemex-skill-v1', type: 'strategy', content: { logic: 'rsi > 70' } });

            // Verify record_skill_download was appended
            assert.equal(appendCalls.length, 1);
            assert.equal(appendCalls[0].key, 'record_skill_download');
            assert.equal(appendCalls[0].value.skill_id, 'test-skill-001');
            assert.equal(appendCalls[0].value.buyer, 'dd'.repeat(32));
            assert.equal(appendCalls[0].value.payment_txid, 'pay-tx-creator-001');
        });

        it('should handle skill_request without payment — return payment_required', async () => {
            broadcastCalls = [];
            appendCalls = [];

            await indexer._handleSkillRequest('mnemex-skills', {
                v: 1,
                type: 'skill_request',
                skill_id: 'test-skill-001',
                // no payment_txid
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'payment_required');
            assert.equal(response.skill_id, 'test-skill-001');
            assert.equal(response.amount, '100000000000000000'); // skill's price
            assert.equal(response.creator_share, '80000000000000000'); // 80%
            assert.equal(response.node_share, '20000000000000000'); // 20%
            assert.ok(response.pay_to_creator); // creator address
            assert.equal(response.pay_to_node, 'trac1testnode');

            // No contract TX should be appended
            assert.equal(appendCalls.length, 0);
        });

        it('should handle skill_catalog — return skill list for cortex', async () => {
            broadcastCalls = [];

            // Publish a second skill in a different cortex
            appendCalls = [];
            await indexer._handleSkillPublish('mnemex-skills', {
                v: 1,
                type: 'skill_publish',
                skill_id: 'test-skill-002',
                name: 'DeFi Yield Scanner',
                description: 'Scans DeFi yields',
                cortex: 'defi',
                price: '50000000000000000',
                version: '1.0.0',
                package: { format: 'mnemex-skill-v1', type: 'scanner', content: {} },
                author: 'ee'.repeat(32),
                ts: 1708617600000,
            });

            broadcastCalls = [];

            // Request catalog for crypto cortex only
            await indexer._handleSkillCatalog('mnemex-skills', {
                v: 1,
                type: 'skill_catalog',
                cortex: 'crypto',
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'skill_catalog_response');
            assert.equal(response.cortex, 'crypto');
            assert.equal(response.skills.length, 1, 'Should only return crypto skills');
            assert.equal(response.skills[0].skill_id, 'test-skill-001');
            assert.equal(response.skills[0].name, 'BTC Momentum');

            // Request catalog for all cortexes (no filter)
            broadcastCalls = [];
            await indexer._handleSkillCatalog('mnemex-skills', {
                v: 1,
                type: 'skill_catalog',
            });

            const allResponse = JSON.parse(broadcastCalls[0].message);
            assert.equal(allResponse.skills.length, 2, 'Should return all skills');
        });
    });

    // ========== register_cortex tests ==========

    describe('register_cortex', () => {

        it('should create cortex entry (admin only)', async () => {
            const ctx = createMockContract();
            ctx.state['admin'] = 'admin-key';
            ctx.address = 'admin-key';
            ctx.value = {
                cortex_name: 'cortex-defi',
                description: 'DeFi protocol analysis cortex',
            };

            const result = await callContract('register_cortex', ctx);
            assert.equal(result, undefined, 'Should not return error');

            const cortex = ctx.state['cortex/cortex-defi'];
            assert.ok(cortex, 'Cortex record should exist');
            assert.equal(cortex.description, 'DeFi protocol analysis cortex');
            assert.equal(cortex.created_by, 'admin-key');
            assert.equal(cortex.status, 'active');
        });

        it('should reject non-admin', async () => {
            const ctx = createMockContract();
            ctx.state['admin'] = 'admin-key';
            ctx.address = 'not-admin';
            ctx.value = {
                cortex_name: 'cortex-hacked',
                description: 'Should be rejected',
            };

            const result = await callContract('register_cortex', ctx);
            assert.ok(result instanceof Error, 'Should return error for non-admin');
            assert.match(result.message, /admin/i);
        });
    });
});
