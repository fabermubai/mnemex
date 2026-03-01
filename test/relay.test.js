import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { MemoryIndexer } from '../features/memory-indexer/index.js';

const TEST_DATA_DIR = './test-relay-data-' + Date.now();

describe('P2P Relay — memory_read relay mechanism', () => {
    let indexer;
    let appendCalls;
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
        appendCalls = [];
        broadcastCalls = [];

        indexer = new MemoryIndexer(mockPeer, {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
            relayTimeoutMs: 500, // fast timeout for tests
        });
        indexer.key = 'memory_indexer';
        indexer.append = async (key, value) => { appendCalls.push({ key, value }); };
        await indexer.start();

        // Pre-store a test memory for relay-serve tests
        const data = { key: 'ETH/USD', value: 3200, source: 'test' };
        fs.writeFileSync(path.join(TEST_DATA_DIR, 'local-memory.json'), JSON.stringify({
            memory_id: 'local-memory',
            cortex: 'cortex-crypto',
            data,
            author: PEER_ID,
            ts: 1700000000000,
            sig: null,
            access: 'open',
            content_hash: 'abcd'.repeat(16),
            stored_at: Date.now()
        }, null, 2));
    });

    beforeEach(() => {
        broadcastCalls = [];
        // Clean up any pending relays from previous tests
        for (const [id, pending] of indexer.pendingRelays) {
            clearTimeout(pending.timer);
        }
        indexer.pendingRelays.clear();
    });

    after(() => {
        // Clean up pending timers
        for (const [id, pending] of indexer.pendingRelays) {
            clearTimeout(pending.timer);
        }
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true });
        }
    });

    // ==================== Relay Initiation ====================

    it('should NOT relay when memory found locally (no regression)', async () => {
        const replies = [];
        const replyFn = (data) => replies.push(JSON.parse(data));

        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read', memory_id: 'local-memory',
        }, replyFn);

        // Should respond directly, no broadcast
        assert.equal(replies.length, 1);
        assert.equal(replies[0].found, true);
        assert.equal(replies[0].data.key, 'ETH/USD');
        assert.equal(broadcastCalls.length, 0); // no relay broadcast
        assert.equal(indexer.pendingRelays.size, 0);
    });

    it('should NOT relay when no replyFn (P2P path) — return found:false', async () => {
        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read', memory_id: 'nonexistent',
        });

        // Should broadcast found:false on sidechannel (old behavior)
        assert.equal(broadcastCalls.length, 1);
        const resp = JSON.parse(broadcastCalls[0].message);
        assert.equal(resp.found, false);
        assert.equal(indexer.pendingRelays.size, 0);
    });

    it('should NOT relay when is_relay=true — return found:false', async () => {
        const replies = [];
        const replyFn = (data) => replies.push(JSON.parse(data));

        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read', memory_id: 'nonexistent', is_relay: true,
        }, replyFn);

        // Should respond with found:false directly (anti-loop)
        assert.equal(replies.length, 1);
        assert.equal(replies[0].found, false);
        assert.equal(broadcastCalls.length, 0); // no relay broadcast
        assert.equal(indexer.pendingRelays.size, 0);
    });

    it('should initiate relay when memory not found + replyFn + no is_relay', async () => {
        const replies = [];
        const replyFn = (data) => replies.push(JSON.parse(data));

        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read', memory_id: 'unknown-memory',
        }, replyFn);

        // Should NOT have replied yet (waiting for relay)
        assert.equal(replies.length, 0);

        // Should have broadcast a relay request
        assert.equal(broadcastCalls.length, 1);
        const relayMsg = JSON.parse(broadcastCalls[0].message);
        assert.equal(relayMsg.type, 'memory_read_relay');
        assert.equal(relayMsg.memory_id, 'unknown-memory');
        assert.equal(relayMsg.requester_id, PEER_ID);
        assert.equal(typeof relayMsg.request_id, 'string');
        assert.equal(relayMsg.request_id.length, 32); // 16 bytes hex

        // Should have a pending relay
        assert.equal(indexer.pendingRelays.size, 1);
    });

    it('should pass payment fields through relay request', async () => {
        const replyFn = () => {};

        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read', memory_id: 'paid-memory',
            payment_txid_creator: 'txid-creator-123',
            payment_txid_node: 'txid-node-456',
            payer: 'cc'.repeat(32),
        }, replyFn);

        const relayMsg = JSON.parse(broadcastCalls[0].message);
        assert.equal(relayMsg.payment_txid_creator, 'txid-creator-123');
        assert.equal(relayMsg.payment_txid_node, 'txid-node-456');
        assert.equal(relayMsg.payer, 'cc'.repeat(32));
    });

    // ==================== Relay Request Handling ====================

    it('_handleRelayRequest should ignore own requester_id (anti-loop)', async () => {
        broadcastCalls = [];

        await indexer._handleRelayRequest('cortex-crypto', {
            v: 1, type: 'memory_read_relay',
            memory_id: 'local-memory',
            request_id: 'req-001',
            requester_id: PEER_ID, // same as our peerId
        });

        // Should not broadcast any response
        assert.equal(broadcastCalls.length, 0);
    });

    it('_handleRelayRequest should stay silent when we do not have the memory', async () => {
        broadcastCalls = [];

        await indexer._handleRelayRequest('cortex-crypto', {
            v: 1, type: 'memory_read_relay',
            memory_id: 'nonexistent',
            request_id: 'req-002',
            requester_id: OTHER_PEER_ID,
        });

        // Should not broadcast any response (stay silent, let timeout handle it)
        assert.equal(broadcastCalls.length, 0);
    });

    it('_handleRelayRequest should respond with data when we have the memory', async () => {
        broadcastCalls = [];

        await indexer._handleRelayRequest('cortex-crypto', {
            v: 1, type: 'memory_read_relay',
            memory_id: 'local-memory',
            request_id: 'req-003',
            requester_id: OTHER_PEER_ID,
        });

        // Should broadcast a relay response
        assert.equal(broadcastCalls.length, 1);
        const relayResp = JSON.parse(broadcastCalls[0].message);
        assert.equal(relayResp.type, 'memory_read_relay_response');
        assert.equal(relayResp.request_id, 'req-003');
        assert.equal(relayResp.response.found, true);
        assert.equal(relayResp.response.data.key, 'ETH/USD');
        assert.equal(relayResp.response.memory_id, 'local-memory');
    });

    // ==================== Relay Response Handling ====================

    it('_handleRelayResponse should deliver response to waiting replyFn', () => {
        const replies = [];
        const replyFn = (data) => replies.push(JSON.parse(data));
        const timer = setTimeout(() => {}, 10000);

        indexer.pendingRelays.set('req-100', {
            replyFn,
            channel: 'cortex-crypto',
            timer,
            memory_id: 'test-mem',
        });

        indexer._handleRelayResponse('cortex-crypto', {
            v: 1, type: 'memory_read_relay_response',
            request_id: 'req-100',
            response: { v: 1, type: 'memory_response', memory_id: 'test-mem', found: true, data: { x: 1 } },
        });

        assert.equal(replies.length, 1);
        assert.equal(replies[0].found, true);
        assert.equal(replies[0].data.x, 1);
        assert.equal(indexer.pendingRelays.size, 0); // cleaned up
    });

    it('_handleRelayResponse should ignore unknown request_id', () => {
        // No pending relay for this ID
        indexer._handleRelayResponse('cortex-crypto', {
            v: 1, type: 'memory_read_relay_response',
            request_id: 'unknown-id',
            response: { found: true, data: {} },
        });

        // No crash, no error — just ignored
        assert.equal(indexer.pendingRelays.size, 0);
    });

    it('_handleRelayResponse should relay payment_required correctly', () => {
        const replies = [];
        const replyFn = (data) => replies.push(JSON.parse(data));
        const timer = setTimeout(() => {}, 10000);

        indexer.pendingRelays.set('req-200', {
            replyFn, channel: 'cortex-crypto', timer, memory_id: 'gated-mem',
        });

        indexer._handleRelayResponse('cortex-crypto', {
            v: 1, type: 'memory_read_relay_response',
            request_id: 'req-200',
            response: {
                v: 1, type: 'payment_required', memory_id: 'gated-mem',
                amount: '30000000000000000', pay_to_creator: 'trac1creator', pay_to_node: 'trac1node',
            },
        });

        assert.equal(replies.length, 1);
        assert.equal(replies[0].type, 'payment_required');
        assert.equal(replies[0].amount, '30000000000000000');
        assert.equal(replies[0].pay_to_creator, 'trac1creator');
    });

    // ==================== Timeout ====================

    it('should return found:false after relay timeout', async () => {
        const replies = [];
        const replyFn = (data) => replies.push(JSON.parse(data));

        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read', memory_id: 'timeout-test',
        }, replyFn);

        // Not replied yet
        assert.equal(replies.length, 0);
        assert.equal(indexer.pendingRelays.size, 1);

        // Wait for timeout (500ms in test config)
        await new Promise((resolve) => setTimeout(resolve, 700));

        // Should have timed out with found:false
        assert.equal(replies.length, 1);
        assert.equal(replies[0].found, false);
        assert.equal(replies[0].memory_id, 'timeout-test');
        assert.equal(indexer.pendingRelays.size, 0); // cleaned up
    });

    // ==================== handleMessage dispatch ====================

    it('handleMessage should dispatch memory_read_relay', () => {
        broadcastCalls = [];
        const result = indexer.handleMessage('cortex-crypto', JSON.stringify({
            v: 1, type: 'memory_read_relay',
            memory_id: 'local-memory',
            request_id: 'dispatch-relay-001',
            requester_id: OTHER_PEER_ID,
        }));
        assert.equal(result, true);
    });

    it('handleMessage should dispatch memory_read_relay_response', () => {
        const result = indexer.handleMessage('cortex-crypto', JSON.stringify({
            v: 1, type: 'memory_read_relay_response',
            request_id: 'dispatch-resp-001',
            response: { found: true },
        }));
        assert.equal(result, true);
    });

    // ==================== Full round-trip ====================

    it('full round-trip: relay request → remote response → client receives data', async () => {
        const clientReplies = [];
        const clientReplyFn = (data) => clientReplies.push(JSON.parse(data));
        broadcastCalls = [];

        // Step 1: Client requests a memory we don't have
        await indexer._handleMemoryRead('cortex-crypto', {
            v: 1, type: 'memory_read', memory_id: 'remote-only-memory',
        }, clientReplyFn);

        assert.equal(clientReplies.length, 0); // waiting
        assert.equal(broadcastCalls.length, 1);
        const relayReq = JSON.parse(broadcastCalls[0].message);
        assert.equal(relayReq.type, 'memory_read_relay');
        const request_id = relayReq.request_id;

        // Step 2: Simulate a remote peer responding via P2P
        indexer._handleRelayResponse('cortex-crypto', {
            v: 1, type: 'memory_read_relay_response',
            request_id,
            response: {
                v: 1, type: 'memory_response', memory_id: 'remote-only-memory',
                found: true, data: { answer: 42 }, author: OTHER_PEER_ID,
            },
        });

        // Step 3: Client should have received the data
        assert.equal(clientReplies.length, 1);
        assert.equal(clientReplies[0].found, true);
        assert.equal(clientReplies[0].data.answer, 42);
        assert.equal(clientReplies[0].author, OTHER_PEER_ID);
        assert.equal(indexer.pendingRelays.size, 0);
    });
});
