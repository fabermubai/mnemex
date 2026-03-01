import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { MemoryIndexer } from '../features/memory-indexer/index.js';

// ---------------------------------------------------------------------------
// Test fixtures — mock peer, indexer setup, seed helpers
// ---------------------------------------------------------------------------

const TEST_DATA_DIR = './test-mnemex-data-search-' + Date.now();

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

function seedMemory(dataDir, memoryId, opts = {}) {
    const stored = {
        memory_id: memoryId,
        cortex: opts.cortex || 'cortex-crypto',
        data: opts.data || { key: 'BTC/USD', value: 65000 },
        author: opts.author || 'aa'.repeat(32),
        access: opts.access || 'open',
        ts: opts.ts || 1708617600000,
        content_hash: 'hash-' + memoryId,
        stored_at: Date.now(),
    };
    fs.writeFileSync(path.join(dataDir, memoryId + '.json'), JSON.stringify(stored, null, 2));
}

function seedSkillFile(skillsDir, skillId, opts = {}) {
    const stored = {
        skill_id: skillId,
        name: opts.name || 'Test Skill',
        description: opts.description || 'A test skill description',
        cortex: opts.cortex || 'crypto',
        price: opts.price || '100000000000000000',
        version: opts.version || '1.0.0',
        package: opts.package || { format: 'mnemex-skill-v1', content: {} },
        author: opts.author || 'bb'.repeat(32),
        ts: opts.ts || 1708617600000,
        stored_at: Date.now(),
    };
    fs.writeFileSync(path.join(skillsDir, skillId + '.json'), JSON.stringify(stored, null, 2));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Search & List handlers', () => {

    before(async () => {
        appendCalls = [];
        broadcastCalls = [];

        indexer = new MemoryIndexer(mockPeer, {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto', 'cortex-dev'],
            requirePayment: false,
            nodeAddress: 'trac1testnode',
            enableSkills: true,
        });

        indexer.key = 'memory_indexer';
        indexer.append = async (key, value) => {
            appendCalls.push({ key, value });
        };

        await indexer.start();

        // Seed test memories
        seedMemory(TEST_DATA_DIR, 'btc-price-2024', {
            cortex: 'cortex-crypto',
            data: { key: 'BTC/USD', value: 65000, source: 'binance' },
            author: 'aa'.repeat(32),
        });
        seedMemory(TEST_DATA_DIR, 'eth-gas-tracker', {
            cortex: 'cortex-crypto',
            data: { key: 'ETH/gas', value: 25, source: 'etherscan' },
            author: 'aa'.repeat(32),
        });
        seedMemory(TEST_DATA_DIR, 'gold-spot-price', {
            cortex: 'cortex-crypto',
            data: { key: 'XAU/USD', value: 2340, source: 'metals-api', category: 'métaux précieux' },
            author: 'bb'.repeat(32),
        });
        seedMemory(TEST_DATA_DIR, 'react-patterns', {
            cortex: 'cortex-dev',
            data: { key: 'react-hooks', value: 'useEffect patterns', source: 'docs' },
            author: 'cc'.repeat(32),
        });

        // Seed test skills
        const skillsDir = path.join(TEST_DATA_DIR, 'skills');
        seedSkillFile(skillsDir, 'sk-btc-momentum', {
            name: 'BTC Momentum Strategy',
            description: 'Detects momentum shifts using RSI + MACD for crypto trading',
            cortex: 'crypto',
        });
        seedSkillFile(skillsDir, 'sk-immo-estimator', {
            name: 'Immobilier Estimator',
            description: 'Estime la valeur immobilière basée sur les données du marché français',
            cortex: 'immobilier',
        });
        seedSkillFile(skillsDir, 'sk-eth-defi', {
            name: 'ETH DeFi Yield Scanner',
            description: 'Scans DeFi protocols for best yield opportunities on Ethereum',
            cortex: 'crypto',
        });

        appendCalls = [];
        broadcastCalls = [];
    });

    after(() => {
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true });
        }
    });

    // ========== memory_search ==========

    describe('memory_search', () => {

        it('should find memories by query matching data values', async () => {
            broadcastCalls = [];
            await indexer._handleMemorySearch('cortex-crypto', {
                v: 1, type: 'memory_search',
                query: 'métaux précieux',
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'memory_search_response');
            assert.equal(response.query, 'métaux précieux');
            assert.equal(response.total, 1);
            assert.equal(response.results[0].memory_id, 'gold-spot-price');
        });

        it('should find memories by query matching memory_id', async () => {
            broadcastCalls = [];
            await indexer._handleMemorySearch('cortex-crypto', {
                v: 1, type: 'memory_search',
                query: 'btc-price',
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 1);
            assert.equal(response.results[0].memory_id, 'btc-price-2024');
        });

        it('should find memories by query matching data keys', async () => {
            broadcastCalls = [];
            await indexer._handleMemorySearch('cortex-crypto', {
                v: 1, type: 'memory_search',
                query: 'ETH/gas',
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 1);
            assert.equal(response.results[0].memory_id, 'eth-gas-tracker');
        });

        it('should be case-insensitive', async () => {
            broadcastCalls = [];
            await indexer._handleMemorySearch('cortex-crypto', {
                v: 1, type: 'memory_search',
                query: 'BINANCE',
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 1);
            assert.equal(response.results[0].memory_id, 'btc-price-2024');
        });

        it('should filter by cortex', async () => {
            broadcastCalls = [];
            await indexer._handleMemorySearch('cortex-dev', {
                v: 1, type: 'memory_search',
                query: 'react',
                cortex: 'cortex-dev',
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 1);
            assert.equal(response.results[0].memory_id, 'react-patterns');
            assert.equal(response.results[0].cortex, 'cortex-dev');
        });

        it('should filter by author', async () => {
            broadcastCalls = [];
            await indexer._handleMemorySearch('cortex-crypto', {
                v: 1, type: 'memory_search',
                query: 'price',
                author: 'bb'.repeat(32),
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 1);
            assert.equal(response.results[0].memory_id, 'gold-spot-price');
        });

        it('should return empty results for no match', async () => {
            broadcastCalls = [];
            await indexer._handleMemorySearch('cortex-crypto', {
                v: 1, type: 'memory_search',
                query: 'nonexistent-xyz-123',
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 0);
            assert.deepEqual(response.results, []);
        });

        it('should return empty for empty query', async () => {
            broadcastCalls = [];
            await indexer._handleMemorySearch('cortex-crypto', {
                v: 1, type: 'memory_search',
                query: '',
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 0);
        });

        it('should respect limit', async () => {
            broadcastCalls = [];
            // Query that matches multiple results
            await indexer._handleMemorySearch('cortex-crypto', {
                v: 1, type: 'memory_search',
                query: 'price',
                limit: 1,
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.ok(response.total <= 1, 'Should respect limit');
        });

        it('should include preview data in results', async () => {
            broadcastCalls = [];
            await indexer._handleMemorySearch('cortex-crypto', {
                v: 1, type: 'memory_search',
                query: 'btc-price',
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.results[0].memory_id, 'btc-price-2024');
            assert.ok(response.results[0].preview, 'Should include preview');
            assert.equal(response.results[0].preview.key, 'BTC/USD');
            assert.equal(response.results[0].preview.value, 65000);
        });
    });

    // ========== memory_list ==========

    describe('memory_list', () => {

        it('should list all memories', async () => {
            broadcastCalls = [];
            await indexer._handleMemoryList('cortex-crypto', {
                v: 1, type: 'memory_list',
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'memory_list_response');
            assert.equal(response.total, 4); // all 4 seeded memories
            // Each entry should have required fields
            for (const mem of response.memories) {
                assert.ok(mem.memory_id, 'Should have memory_id');
                assert.ok(mem.cortex, 'Should have cortex');
                assert.ok(mem.author, 'Should have author');
            }
        });

        it('should filter by cortex', async () => {
            broadcastCalls = [];
            await indexer._handleMemoryList('cortex-dev', {
                v: 1, type: 'memory_list',
                cortex: 'cortex-dev',
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 1);
            assert.equal(response.memories[0].memory_id, 'react-patterns');
            assert.equal(response.memories[0].cortex, 'cortex-dev');
        });

        it('should filter by author', async () => {
            broadcastCalls = [];
            await indexer._handleMemoryList('cortex-crypto', {
                v: 1, type: 'memory_list',
                author: 'bb'.repeat(32),
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 1);
            assert.equal(response.memories[0].memory_id, 'gold-spot-price');
        });

        it('should filter by cortex AND author', async () => {
            broadcastCalls = [];
            await indexer._handleMemoryList('cortex-crypto', {
                v: 1, type: 'memory_list',
                cortex: 'cortex-crypto',
                author: 'aa'.repeat(32),
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 2); // btc-price + eth-gas (both by aa)
            for (const mem of response.memories) {
                assert.equal(mem.cortex, 'cortex-crypto');
                assert.equal(mem.author, 'aa'.repeat(32));
            }
        });

        it('should respect limit', async () => {
            broadcastCalls = [];
            await indexer._handleMemoryList('cortex-crypto', {
                v: 1, type: 'memory_list',
                limit: 2,
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.ok(response.total <= 2);
        });

        it('should include access field', async () => {
            broadcastCalls = [];
            await indexer._handleMemoryList('cortex-crypto', {
                v: 1, type: 'memory_list',
            });

            const response = JSON.parse(broadcastCalls[0].message);
            for (const mem of response.memories) {
                assert.ok(mem.access, 'Should have access field');
            }
        });
    });

    // ========== skill_search ==========

    describe('skill_search', () => {

        it('should find skills by name', async () => {
            broadcastCalls = [];
            await indexer._handleSkillSearch('mnemex-skills', {
                v: 1, type: 'skill_search',
                query: 'momentum',
            });

            assert.equal(broadcastCalls.length, 1);
            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.type, 'skill_search_response');
            assert.equal(response.query, 'momentum');
            assert.equal(response.total, 1);
            assert.equal(response.results[0].skill_id, 'sk-btc-momentum');
            assert.equal(response.results[0].name, 'BTC Momentum Strategy');
        });

        it('should find skills by description', async () => {
            broadcastCalls = [];
            await indexer._handleSkillSearch('mnemex-skills', {
                v: 1, type: 'skill_search',
                query: 'immobilière',
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 1);
            assert.equal(response.results[0].skill_id, 'sk-immo-estimator');
        });

        it('should be case-insensitive', async () => {
            broadcastCalls = [];
            await indexer._handleSkillSearch('mnemex-skills', {
                v: 1, type: 'skill_search',
                query: 'DEFI',
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 1);
            assert.equal(response.results[0].skill_id, 'sk-eth-defi');
        });

        it('should filter by cortex', async () => {
            broadcastCalls = [];
            await indexer._handleSkillSearch('mnemex-skills', {
                v: 1, type: 'skill_search',
                query: 'estimat',
                cortex: 'crypto', // immobilier skill is cortex "immobilier", not "crypto"
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 0, 'Should not find immobilier skill when filtering by crypto cortex');
        });

        it('should return multiple results', async () => {
            broadcastCalls = [];
            // "strategy" is not in any skill, but "Estimat" matches immo
            // Use a broad term that matches multiple — "Scans" only 1, try "defi" only 1
            // Both sk-btc-momentum and sk-eth-defi mention their domains
            // Search for a term in multiple skills: both descriptions contain strategies/protocols
            await indexer._handleSkillSearch('mnemex-skills', {
                v: 1, type: 'skill_search',
                query: 'est',  // matches "Detects" (btc), "Estime" (immo), "best" (eth-defi)
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.ok(response.total >= 2, 'Should find multiple skills matching "est"');
        });

        it('should return empty for no match', async () => {
            broadcastCalls = [];
            await indexer._handleSkillSearch('mnemex-skills', {
                v: 1, type: 'skill_search',
                query: 'nonexistent-skill-xyz',
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 0);
            assert.deepEqual(response.results, []);
        });

        it('should return empty for empty query', async () => {
            broadcastCalls = [];
            await indexer._handleSkillSearch('mnemex-skills', {
                v: 1, type: 'skill_search',
                query: '',
            });

            const response = JSON.parse(broadcastCalls[0].message);
            assert.equal(response.total, 0);
        });

        it('should include skill metadata in results', async () => {
            broadcastCalls = [];
            await indexer._handleSkillSearch('mnemex-skills', {
                v: 1, type: 'skill_search',
                query: 'immobilier',
            });

            const response = JSON.parse(broadcastCalls[0].message);
            const skill = response.results[0];
            assert.ok(skill.skill_id, 'Should have skill_id');
            assert.ok(skill.name, 'Should have name');
            assert.ok(skill.description, 'Should have description');
            assert.ok(skill.cortex, 'Should have cortex');
            assert.ok(skill.price, 'Should have price');
            assert.ok(skill.version, 'Should have version');
        });
    });

    // ========== handleMessage routing ==========

    describe('handleMessage routing', () => {

        it('should route memory_search via handleMessage', () => {
            broadcastCalls = [];
            const result = indexer.handleMessage('cortex-crypto', {
                message: JSON.stringify({ v: 1, type: 'memory_search', query: 'btc' }),
            }, null);
            assert.equal(result, true, 'Should return true for handled message');
        });

        it('should route memory_list via handleMessage', () => {
            broadcastCalls = [];
            const result = indexer.handleMessage('cortex-crypto', {
                message: JSON.stringify({ v: 1, type: 'memory_list' }),
            }, null);
            assert.equal(result, true, 'Should return true for handled message');
        });

        it('should route skill_search via handleMessage', () => {
            broadcastCalls = [];
            const result = indexer.handleMessage('mnemex-skills', {
                message: JSON.stringify({ v: 1, type: 'skill_search', query: 'test' }),
            }, null);
            assert.equal(result, true, 'Should return true for handled message');
        });
    });
});
