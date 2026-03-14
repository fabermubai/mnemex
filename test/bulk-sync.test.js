import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { MemoryIndexer } from '../features/memory-indexer/index.js';

const TEST_DATA_DIR = './test-bulk-sync-data-' + Date.now();

describe('Bulk sync — memory_sync_request / memory_sync_response', () => {
    let indexer;
    let broadcastCalls;

    const PEER_ID = 'aa'.repeat(32);
    const OTHER_PEER_ID = 'bb'.repeat(32);

    const mockPeer = {
        base: { writable: true, append: async () => {} },
        protocol: { instance: { generateNonce: () => 'nonce-' + Date.now() } },
        wallet: { publicKey: PEER_ID, sign: () => 'fake-sig' },
        sidechannel: {
            broadcast: (channel, message) => {
                broadcastCalls.push({ channel, message });
            },
        },
    };

    before(async () => {
        broadcastCalls = [];

        indexer = new MemoryIndexer(mockPeer, {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
            relayTimeoutMs: 500,
        });
        indexer.key = 'memory_indexer';
        indexer.append = async (key, value) => {};
        await indexer.start();

        // Pre-store test memories: 2 open, 1 gated
        fs.writeFileSync(path.join(TEST_DATA_DIR, 'open-memory-1.json'), JSON.stringify({
            memory_id: 'open-memory-1',
            cortex: 'cortex-crypto',
            data: { key: 'BTC/USD', value: 65000 },
            author: PEER_ID,
            ts: 1700000000000,
            sig: null,
            access: 'open',
            content_hash: 'hash1',
            stored_at: Date.now(),
        }, null, 2));

        fs.writeFileSync(path.join(TEST_DATA_DIR, 'open-memory-2.json'), JSON.stringify({
            memory_id: 'open-memory-2',
            cortex: 'cortex-crypto',
            data: { key: 'ETH/USD', value: 3200 },
            author: OTHER_PEER_ID,
            ts: 1700000001000,
            sig: null,
            access: 'open',
            content_hash: 'hash2',
            stored_at: Date.now(),
        }, null, 2));

        fs.writeFileSync(path.join(TEST_DATA_DIR, 'gated-memory-1.json'), JSON.stringify({
            memory_id: 'gated-memory-1',
            cortex: 'cortex-crypto',
            data: { key: 'SECRET', value: 42 },
            author: OTHER_PEER_ID,
            ts: 1700000002000,
            sig: null,
            access: 'gated',
            content_hash: 'hash3',
            stored_at: Date.now(),
        }, null, 2));

        fs.writeFileSync(path.join(TEST_DATA_DIR, 'public-memory-1.json'), JSON.stringify({
            memory_id: 'public-memory-1',
            cortex: 'cortex-crypto',
            data: { key: 'BTC/USD', value: 97000 },
            author: PEER_ID,
            ts: 1700000003000,
            sig: null,
            access: 'open',
            content_hash: 'hash4',
            stored_at: Date.now(),
        }, null, 2));
    });

    beforeEach(() => {
        broadcastCalls = [];
    });

    after(() => {
        if (indexer) indexer.stop();
        // Clean up pending timers
        for (const [id, pending] of indexer.pendingRelays) {
            clearTimeout(pending.timer);
        }
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true });
        }
    });

    // ==================== _handleSyncRequest ====================

    it('_handleSyncRequest returns open and public memories', async () => {
        await indexer._handleSyncRequest(
            { v: 1, type: 'memory_sync_request', peer_key: OTHER_PEER_ID, ts: Date.now() },
            null
        );

        assert.equal(broadcastCalls.length, 1);
        const response = JSON.parse(broadcastCalls[0].message);
        assert.equal(response.type, 'memory_sync_response');
        assert.equal(response.peer_key, PEER_ID);

        // Should include 2 open + 1 public memories, NOT the gated one
        const ids = response.memories.map(m => m.memory_id).sort();
        assert.deepEqual(ids, ['open-memory-1', 'open-memory-2', 'public-memory-1']);
    });

    it('_handleSyncRequest excludes gated memories', async () => {
        await indexer._handleSyncRequest(
            { v: 1, type: 'memory_sync_request', peer_key: OTHER_PEER_ID, ts: Date.now() },
            null
        );

        const response = JSON.parse(broadcastCalls[0].message);
        const ids = response.memories.map(m => m.memory_id);
        assert.ok(!ids.includes('gated-memory-1'), 'gated memory should not be included');
    });

    it('_handleSyncRequest includes public memories in bulk sync', async () => {
        await indexer._handleSyncRequest(
            { v: 1, type: 'memory_sync_request', peer_key: OTHER_PEER_ID, ts: Date.now() },
            null
        );

        const response = JSON.parse(broadcastCalls[0].message);
        const ids = response.memories.map(m => m.memory_id);
        assert.ok(ids.includes('public-memory-1'), 'public memory should be included in sync');
    });

    it('_handleSyncRequest ignores own peer_key', async () => {
        await indexer._handleSyncRequest(
            { v: 1, type: 'memory_sync_request', peer_key: PEER_ID, ts: Date.now() },
            null
        );

        assert.equal(broadcastCalls.length, 0, 'should not respond to own sync request');
    });

    it('_handleSyncRequest returns metadata only (no data field)', async () => {
        await indexer._handleSyncRequest(
            { v: 1, type: 'memory_sync_request', peer_key: OTHER_PEER_ID, ts: Date.now() },
            null
        );

        const response = JSON.parse(broadcastCalls[0].message);
        for (const mem of response.memories) {
            assert.equal(mem.data, undefined, 'metadata should not include data');
            assert.ok(mem.memory_id, 'should have memory_id');
            assert.ok(mem.cortex, 'should have cortex');
        }
    });

    // ==================== _handleSyncResponse ====================

    it('_handleSyncResponse ignores own peer_key', async () => {
        await indexer._handleSyncResponse(
            {
                v: 1, type: 'memory_sync_response', peer_key: PEER_ID, ts: Date.now(),
                memories: [{ memory_id: 'new-mem', cortex: 'cortex-crypto', access: 'open' }],
            },
            null
        );

        // Should not broadcast any relay request
        assert.equal(broadcastCalls.length, 0, 'should ignore own sync response');
    });

    it('_handleSyncResponse skips memories already present locally', async () => {
        await indexer._handleSyncResponse(
            {
                v: 1, type: 'memory_sync_response', peer_key: OTHER_PEER_ID, ts: Date.now(),
                memories: [
                    { memory_id: 'open-memory-1', cortex: 'cortex-crypto', access: 'open' },
                    { memory_id: 'open-memory-2', cortex: 'cortex-crypto', access: 'open' },
                ],
            },
            null
        );

        // Both exist locally, so no relay requests should be broadcast
        assert.equal(broadcastCalls.length, 0, 'should not fetch already-present memories');
    });

    it('_handleSyncResponse initiates relay for missing memories', async () => {
        await indexer._handleSyncResponse(
            {
                v: 1, type: 'memory_sync_response', peer_key: OTHER_PEER_ID, ts: Date.now(),
                memories: [
                    { memory_id: 'missing-memory-xyz', cortex: 'cortex-crypto', access: 'open' },
                ],
            },
            null
        );

        // Should have broadcast a memory_read_relay for the missing memory
        assert.ok(broadcastCalls.length >= 1, 'should broadcast relay request');
        const relayMsg = JSON.parse(broadcastCalls[0].message);
        assert.equal(relayMsg.type, 'memory_read_relay');
        assert.equal(relayMsg.memory_id, 'missing-memory-xyz');

        // Clean up pending relay timer
        for (const [id, pending] of indexer.pendingRelays) {
            clearTimeout(pending.timer);
        }
        indexer.pendingRelays.clear();
    });

    it('_handleSyncResponse skips gated memories even if missing', async () => {
        await indexer._handleSyncResponse(
            {
                v: 1, type: 'memory_sync_response', peer_key: OTHER_PEER_ID, ts: Date.now(),
                memories: [
                    { memory_id: 'some-gated-mem', cortex: 'cortex-crypto', access: 'gated' },
                ],
            },
            null
        );

        assert.equal(broadcastCalls.length, 0, 'should not fetch gated memories');
    });

    // ==================== handleMessage routing ====================

    it('handleMessage routes memory_sync_request correctly', () => {
        const result = indexer.handleMessage('0000mnemex', JSON.stringify({
            v: 1, type: 'memory_sync_request', peer_key: OTHER_PEER_ID, ts: Date.now(),
        }), null);

        assert.equal(result, true, 'should handle memory_sync_request');
    });

    it('handleMessage routes memory_sync_response correctly', () => {
        // Clean any pending timers first
        for (const [id, pending] of indexer.pendingRelays) {
            clearTimeout(pending.timer);
        }
        indexer.pendingRelays.clear();

        const result = indexer.handleMessage('0000mnemex', JSON.stringify({
            v: 1, type: 'memory_sync_response', peer_key: OTHER_PEER_ID, ts: Date.now(),
            memories: [],
        }), null);

        assert.equal(result, true, 'should handle memory_sync_response');
    });
});
