import {Feature} from 'trac-peer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class MemoryIndexer extends Feature {

    /**
     * MemoryIndexer — listens to sidechannel messages on cortex channels,
     * stores memory data locally, and records metadata on-chain via the contract.
     *
     * Phase 1 (MVP): uses Feature injection (this.append) for on-chain registration.
     * Phase 2: will switch to MSB TX submission with fees.
     *
     * @param peer
     * @param options — { dataDir, cortexChannels }
     */
    constructor(peer, options = {}) {
        super(peer, options);
        this.dataDir = options.dataDir || './mnemex-data';
        this.cortexChannels = options.cortexChannels || ['cortex-crypto'];
    }

    /**
     * Initialize the feature: ensure data directory exists.
     *
     * @returns {Promise<void>}
     */
    async start() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        console.log('MemoryIndexer: started. Data dir:', this.dataDir);
        console.log('MemoryIndexer: cortex channels:', this.cortexChannels.join(', '));
    }

    async stop() { }

    /**
     * Handle an incoming sidechannel message.
     * Called by index.js via the sidechannel onMessage callback.
     *
     * @param channel — the sidechannel name (e.g. "cortex-crypto")
     * @param payload — raw message (string or buffer)
     * @param connection — the Hyperswarm connection object
     */
    handleMessage(channel, payload, connection) {
        if (!this.cortexChannels.includes(channel)) return false;

        let msg;
        const raw = typeof payload === 'string' ? payload
            : Buffer.isBuffer(payload) ? payload.toString('utf8')
            : String(payload);
        try {
            msg = JSON.parse(raw);
        } catch (_e) {
            return false;
        }

        if (!msg || msg.v !== 1) return false;

        if (msg.type === 'memory_write') {
            this._handleMemoryWrite(channel, msg).catch((err) => {
                console.error('MemoryIndexer: memory_write error:', err?.message ?? err);
            });
            return true;
        }

        if (msg.type === 'memory_read') {
            this._handleMemoryRead(channel, msg);
            return true;
        }

        return false;
    }

    /**
     * Process a memory_write message:
     * 1. Validate required fields
     * 2. Compute content_hash from data
     * 3. Store the full payload locally as JSON
     * 4. Inject metadata into contract via Feature mechanism (this.append)
     *
     * Expected message format:
     * { v: 1, type: "memory_write", memory_id, cortex, data, author, ts, sig }
     *
     * @param channel
     * @param msg
     */
    async _handleMemoryWrite(channel, msg) {
        const { memory_id, cortex, data, author, ts, sig, access } = msg;

        if (!memory_id || !cortex || !data || !author || !ts) {
            console.log('MemoryIndexer: memory_write rejected — missing required fields');
            return;
        }

        // Compute content hash from data payload
        const dataStr = JSON.stringify(data);
        const contentHash = crypto.createHash('sha256').update(dataStr).digest('hex');

        // Store the full payload locally
        const filePath = path.join(this.dataDir, memory_id + '.json');
        const stored = {
            memory_id,
            cortex,
            data,
            author,
            ts,
            sig: sig || null,
            access: access || 'open',
            content_hash: contentHash,
            stored_at: Date.now()
        };
        fs.writeFileSync(filePath, JSON.stringify(stored, null, 2));
        console.log('MemoryIndexer: stored', memory_id, '→', filePath);

        // Inject metadata into contract via Feature mechanism (autobase consensus)
        await this.append('register_memory', {
            memory_id: String(memory_id),
            cortex: String(cortex),
            author: String(author),
            access: String(access || 'open'),
            content_hash: contentHash,
            ts: ts
        });
        console.log('MemoryIndexer: appended register_memory for', memory_id);
    }

    /**
     * Process a memory_read message:
     * 1. Look up the data locally
     * 2. Respond on the same sidechannel with a memory_response message
     *
     * Expected message format:
     * { v: 1, type: "memory_read", memory_id }
     *
     * @param channel
     * @param msg
     */
    _handleMemoryRead(channel, msg) {
        const { memory_id } = msg;

        if (!memory_id) {
            console.log('MemoryIndexer: memory_read rejected — missing memory_id');
            return;
        }

        const filePath = path.join(this.dataDir, memory_id + '.json');
        let response;

        if (!fs.existsSync(filePath)) {
            response = {
                v: 1,
                type: 'memory_response',
                memory_id,
                found: false,
                data: null
            };
        } else {
            const raw = fs.readFileSync(filePath, 'utf8');
            const stored = JSON.parse(raw);
            response = {
                v: 1,
                type: 'memory_response',
                memory_id,
                found: true,
                data: stored.data,
                cortex: stored.cortex,
                author: stored.author,
                ts: stored.ts,
                content_hash: stored.content_hash
            };
        }

        // Respond on the same sidechannel
        if (this.peer.sidechannel) {
            this.peer.sidechannel.broadcast(channel, JSON.stringify(response));
            console.log('MemoryIndexer: memory_read response for', memory_id, '— found:', response.found);
        }
    }
}

export default MemoryIndexer;
