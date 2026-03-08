import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MemoryIndexer } from '../features/memory-indexer/index.js';

const TEST_DATA_DIR = './test-mnemex-data-' + Date.now();

describe('Memory Flow — Phase 1 MVP', () => {
    let indexer;
    let appendCalls;
    let broadcastCalls;

    const mockPeer = {
        base: {
            writable: true,
            append: async () => {},
        },
        protocol: {
            instance: {
                generateNonce: () => 'test-nonce-' + Date.now(),
            },
        },
        wallet: {
            publicKey: 'aa'.repeat(32),
            sign: () => 'fake-sig',
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
        });

        // Simulate what addFeature does: sets the key used by append()
        indexer.key = 'memory_indexer';

        // Patch append() to capture calls instead of hitting autobase
        indexer.append = async (key, value) => {
            appendCalls.push({ key, value });
        };

        await indexer.start();
    });

    after(() => {
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true });
        }
    });

    it('start() should create the data directory', () => {
        assert.ok(fs.existsSync(TEST_DATA_DIR), 'Data directory should exist after start()');
    });

    it('handleMessage should ignore non-cortex channels', () => {
        const result = indexer.handleMessage('some-other-channel', JSON.stringify({
            v: 1, type: 'memory_write', memory_id: 'x', cortex: 'crypto',
            data: {}, author: 'aa', ts: 1
        }));
        assert.equal(result, false);
    });

    it('handleMessage should ignore invalid JSON', () => {
        const result = indexer.handleMessage('cortex-crypto', 'not-json{{{');
        assert.equal(result, false);
    });

    it('handleMessage should ignore messages with wrong version', () => {
        const result = indexer.handleMessage('cortex-crypto', JSON.stringify({ v: 99, type: 'memory_write' }));
        assert.equal(result, false);
    });

    it('memory_write should store data locally and append to contract', async () => {
        const data = { key: 'BTC/USD', value: 65000, source: 'binance' };
        const msg = {
            v: 1,
            type: 'memory_write',
            memory_id: 'test-memory-001',
            cortex: 'crypto',
            data,
            author: 'aa'.repeat(32),
            ts: 1708617600000,
            sig: 'test-signature-hex',
        };

        // Call _handleMemoryWrite directly to await it
        await indexer._handleMemoryWrite('cortex-crypto', msg);

        // 1. Verify file stored on disk
        const filePath = path.join(TEST_DATA_DIR, 'test-memory-001.json');
        assert.ok(fs.existsSync(filePath), 'Memory file should exist on disk');

        const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.equal(stored.memory_id, 'test-memory-001');
        assert.equal(stored.cortex, 'crypto');
        assert.deepEqual(stored.data, data);
        assert.equal(stored.author, 'aa'.repeat(32));
        assert.equal(stored.ts, 1708617600000);
        assert.equal(stored.sig, 'test-signature-hex');
        assert.equal(stored.access, 'open');
        assert.equal(typeof stored.stored_at, 'number');

        // 2. Verify content_hash is SHA256 of JSON.stringify(data)
        const expectedHash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
        assert.equal(stored.content_hash, expectedHash);

        // 3. Verify append() was called with correct metadata
        assert.equal(appendCalls.length, 1);
        assert.equal(appendCalls[0].key, 'register_memory');
        const meta = appendCalls[0].value;
        assert.equal(meta.memory_id, 'test-memory-001');
        assert.equal(meta.cortex, 'crypto');
        assert.equal(meta.author, 'aa'.repeat(32));
        assert.equal(meta.access, 'open');
        assert.equal(meta.content_hash, expectedHash);
        assert.equal(meta.ts, 1708617600000);
    });

    it('memory_read should respond with stored data', () => {
        broadcastCalls = [];

        indexer._handleMemoryRead('cortex-crypto', {
            v: 1,
            type: 'memory_read',
            memory_id: 'test-memory-001',
        });

        assert.equal(broadcastCalls.length, 1);
        assert.equal(broadcastCalls[0].channel, 'cortex-crypto');

        const response = JSON.parse(broadcastCalls[0].message);
        assert.equal(response.v, 1);
        assert.equal(response.type, 'memory_response');
        assert.equal(response.memory_id, 'test-memory-001');
        assert.equal(response.found, true);
        assert.deepEqual(response.data, { key: 'BTC/USD', value: 65000, source: 'binance' });
        assert.equal(response.cortex, 'crypto');
        assert.equal(response.author, 'aa'.repeat(32));
        assert.equal(response.ts, 1708617600000);
        assert.equal(typeof response.content_hash, 'string');
        assert.equal(response.content_hash.length, 64);
    });

    it('memory_read should respond with found:false for unknown memory', () => {
        broadcastCalls = [];

        indexer._handleMemoryRead('cortex-crypto', {
            v: 1,
            type: 'memory_read',
            memory_id: 'nonexistent-memory-id',
        });

        assert.equal(broadcastCalls.length, 1);
        const response = JSON.parse(broadcastCalls[0].message);
        assert.equal(response.type, 'memory_response');
        assert.equal(response.memory_id, 'nonexistent-memory-id');
        assert.equal(response.found, false);
        assert.equal(response.data, null);
    });

    it('memory_write should reject messages with missing fields', async () => {
        const prevLength = appendCalls.length;

        await indexer._handleMemoryWrite('cortex-crypto', {
            v: 1, type: 'memory_write',
            memory_id: 'bad-msg',
            // missing cortex, data, author, ts
        });

        // append should NOT have been called
        assert.equal(appendCalls.length, prevLength);
    });

    it('handleMessage should dispatch memory_write and return true', () => {
        const result = indexer.handleMessage('cortex-crypto', JSON.stringify({
            v: 1,
            type: 'memory_write',
            memory_id: 'dispatch-test',
            cortex: 'crypto',
            data: { test: true },
            author: 'bb'.repeat(32),
            ts: Date.now(),
        }));
        assert.equal(result, true);
    });

    it('handleMessage should dispatch memory_read and return true', () => {
        const result = indexer.handleMessage('cortex-crypto', JSON.stringify({
            v: 1,
            type: 'memory_read',
            memory_id: 'test-memory-001',
        }));
        assert.equal(result, true);
    });

    it('memory_write update by same author should overwrite file', async () => {
        appendCalls = [];

        // test-memory-001 was written by 'aa'.repeat(32) in a previous test
        await indexer._handleMemoryWrite('cortex-crypto', {
            v: 1,
            type: 'memory_write',
            memory_id: 'test-memory-001',
            cortex: 'crypto',
            data: { key: 'BTC/USD', value: 99000, source: 'updated' },
            author: 'aa'.repeat(32), // same author
            ts: 1708617700000,
        });

        // File should be updated
        const filePath = path.join(TEST_DATA_DIR, 'test-memory-001.json');
        const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.deepEqual(stored.data, { key: 'BTC/USD', value: 99000, source: 'updated' });
        assert.equal(stored.ts, 1708617700000);

        // append() should have been called for the update
        assert.equal(appendCalls.length, 1);
        assert.equal(appendCalls[0].key, 'register_memory');
    });

    it('memory_write update by different author should be rejected', async () => {
        appendCalls = [];
        broadcastCalls = [];

        // test-memory-001 is owned by 'aa'.repeat(32)
        await indexer._handleMemoryWrite('cortex-crypto', {
            v: 1,
            type: 'memory_write',
            memory_id: 'test-memory-001',
            cortex: 'crypto',
            data: { key: 'BTC/USD', value: 0, source: 'attacker' },
            author: 'ff'.repeat(32), // different author
            ts: 1708617800000,
        });

        // append() should NOT have been called
        assert.equal(appendCalls.length, 0);

        // File should be unchanged (still the update from same author test)
        const filePath = path.join(TEST_DATA_DIR, 'test-memory-001.json');
        const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.deepEqual(stored.data, { key: 'BTC/USD', value: 99000, source: 'updated' });
        assert.equal(stored.author, 'aa'.repeat(32));

        // Should have broadcast a rejection
        assert.equal(broadcastCalls.length, 1);
        const response = JSON.parse(broadcastCalls[0].message);
        assert.equal(response.type, 'memory_update_rejected');
        assert.equal(response.memory_id, 'test-memory-001');
        assert.equal(response.reason, 'Not the author');
    });

    // ==================== Hash Verification ====================

    it('hash verification passes for untampered memory', async () => {
        const replies = [];
        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read', memory_id: 'test-memory-001',
        }, (data) => replies.push(JSON.parse(data)));

        assert.equal(replies.length, 1);
        const res = replies[0];
        assert.equal(res.found, true);
        assert.ok(res.content_hash, 'response should include content_hash');

        const recomputedHash = crypto.createHash('sha256')
            .update(JSON.stringify(res.data))
            .digest('hex');
        assert.equal(recomputedHash, res.content_hash, 'hash should match untampered data');
    });

    it('hash verification fails for tampered data', async () => {
        const replies = [];
        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read', memory_id: 'test-memory-001',
        }, (data) => replies.push(JSON.parse(data)));

        const res = replies[0];
        // Simulate tampering: modify data after receiving response
        const tamperedData = { ...res.data, value: 999999 };
        const recomputedHash = crypto.createHash('sha256')
            .update(JSON.stringify(tamperedData))
            .digest('hex');
        assert.notEqual(recomputedHash, res.content_hash, 'hash should NOT match tampered data');
    });
});
