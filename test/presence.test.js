import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { MemoryIndexer } from '../features/memory-indexer/index.js';

const TEST_DATA_DIR = './test-mnemex-data-presence-' + Date.now();

describe('Presence — peer_announce & getOnlinePeers', () => {
    let indexer;

    const mockPeer = {
        base: { writable: true, isIndexer: true, append: async () => {} },
        protocol: { instance: { generateNonce: () => 'nonce-' + Date.now() } },
        wallet: { publicKey: 'aa'.repeat(32), sign: () => 'fake-sig' },
        sidechannel: { broadcast: () => {} },
    };

    before(async () => {
        indexer = new MemoryIndexer(mockPeer, {
            dataDir: TEST_DATA_DIR,
            cortexChannels: ['cortex-crypto'],
        });
        indexer.key = 'memory_indexer';
        indexer.append = async () => {};
        await indexer.start();
    });

    after(() => {
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true });
        }
    });

    it('_handlePeerAnnounce should update presenceMap', () => {
        const peerKey = 'bb'.repeat(32);
        indexer._handlePeerAnnounce({
            v: 1,
            type: 'peer_announce',
            peer_key: peerKey,
            address: 'trac1testaddr',
            nick: 'Agent2',
            capabilities: ['memory_node'],
            ts: Date.now(),
        }, null);

        assert.ok(indexer.presenceMap.has(peerKey));
        const entry = indexer.presenceMap.get(peerKey);
        assert.equal(entry.nick, 'Agent2');
        assert.equal(entry.address, 'trac1testaddr');
        assert.deepEqual(entry.capabilities, ['memory_node']);
        assert.ok(entry.lastSeen <= Date.now());
    });

    it('_handlePeerAnnounce should ignore self (own peer_key)', () => {
        const selfKey = 'aa'.repeat(32); // same as mockPeer.wallet.publicKey
        indexer._handlePeerAnnounce({
            v: 1,
            type: 'peer_announce',
            peer_key: selfKey,
            nick: 'SelfNode',
            ts: Date.now(),
        }, null);

        assert.ok(!indexer.presenceMap.has(selfKey));
    });

    it('getOnlinePeers should return peers seen within 5 minutes', () => {
        const recentKey = 'cc'.repeat(32);
        indexer.presenceMap.set(recentKey, {
            address: 'trac1recent',
            nick: 'RecentPeer',
            capabilities: [],
            lastSeen: Date.now(),
            ts: Date.now(),
        });

        const staleKey = 'dd'.repeat(32);
        indexer.presenceMap.set(staleKey, {
            address: 'trac1stale',
            nick: 'StalePeer',
            capabilities: [],
            lastSeen: Date.now() - 6 * 60 * 1000, // 6 minutes ago
            ts: Date.now() - 6 * 60 * 1000,
        });

        const online = indexer.getOnlinePeers();
        const onlineKeys = online.map(p => p.peerKey);

        assert.ok(onlineKeys.includes(recentKey), 'recent peer should be online');
        assert.ok(!onlineKeys.includes(staleKey), 'stale peer should not be online');
    });

    it('handleMessage should ignore peer_announce without v:1', () => {
        const peerKey = 'ee'.repeat(32);
        const payload = JSON.stringify({
            type: 'peer_announce',
            peer_key: peerKey,
            nick: 'BadVersion',
            ts: Date.now(),
            // missing v: 1
        });

        const result = indexer.handleMessage('0000mnemex', payload, null);
        assert.equal(result, false);
        assert.ok(!indexer.presenceMap.has(peerKey));
    });

    it('handleMessage should accept peer_announce with v:1 on entry channel', () => {
        const peerKey = 'ff'.repeat(32);
        const payload = JSON.stringify({
            v: 1,
            type: 'peer_announce',
            peer_key: peerKey,
            address: 'trac1entry',
            nick: 'EntryPeer',
            capabilities: [],
            ts: Date.now(),
        });

        const result = indexer.handleMessage('0000mnemex', payload, null);
        assert.equal(result, true);
        assert.ok(indexer.presenceMap.has(peerKey));
        assert.equal(indexer.presenceMap.get(peerKey).nick, 'EntryPeer');
    });
});
