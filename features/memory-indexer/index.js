import {Feature} from 'trac-peer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class MemoryIndexer extends Feature {

    /**
     * MemoryIndexer — listens to sidechannel messages on cortex channels,
     * stores memory data locally, and records metadata on-chain via the contract.
     *
     * Phase 1: uses Feature injection (this.append) for on-chain registration, no fees.
     * Phase 2: adds payment gate — requires payment_txid before serving data,
     *          records fee splits via record_fee contract entry.
     *
     * @param peer
     * @param options — { dataDir, cortexChannels, requirePayment, nodeAddress }
     */
    constructor(peer, options = {}) {
        super(peer, options);
        this.dataDir = options.dataDir || './mnemex-data';
        this.cortexChannels = options.cortexChannels || ['cortex-crypto'];
        this.requirePayment = options.requirePayment || false;
        this.nodeAddress = options.nodeAddress || null;
        this.defaultFeeAmount = '30000000000000000'; // 0.03 TNK in smallest unit
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
            this._handleMemoryRead(channel, msg).catch((err) => {
                console.error('MemoryIndexer: memory_read error:', err?.message ?? err);
            });
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
     * 2. If requirePayment and no payment_txid → respond with payment_required
     * 3. If payment provided (or requirePayment is false) → serve data
     * 4. After serving → record fee via contract entry (if payment_txid present)
     *
     * Expected message format:
     * { v: 1, type: "memory_read", memory_id, payment_txid? }
     *
     * @param channel
     * @param msg
     */
    async _handleMemoryRead(channel, msg) {
        const { memory_id, payment_txid } = msg;

        if (!memory_id) {
            console.log('MemoryIndexer: memory_read rejected — missing memory_id');
            return;
        }

        const filePath = path.join(this.dataDir, memory_id + '.json');

        // Memory not found locally
        if (!fs.existsSync(filePath)) {
            const response = {
                v: 1,
                type: 'memory_response',
                memory_id,
                found: false,
                data: null
            };
            if (this.peer.sidechannel) {
                this.peer.sidechannel.broadcast(channel, JSON.stringify(response));
                console.log('MemoryIndexer: memory_read response for', memory_id, '— found: false');
            }
            return;
        }

        // Payment gate: if requirePayment and no payment_txid, return payment_required
        if (this.requirePayment && !payment_txid) {
            const response = {
                v: 1,
                type: 'payment_required',
                memory_id,
                amount: this.defaultFeeAmount,
                pay_to: this.nodeAddress,
                ts: Date.now()
            };
            if (this.peer.sidechannel) {
                this.peer.sidechannel.broadcast(channel, JSON.stringify(response));
                console.log('MemoryIndexer: payment_required for', memory_id);
            }
            return;
        }

        // Serve data
        const raw = fs.readFileSync(filePath, 'utf8');
        const stored = JSON.parse(raw);
        const response = {
            v: 1,
            type: 'memory_response',
            memory_id,
            found: true,
            data: stored.data,
            cortex: stored.cortex,
            author: stored.author,
            ts: stored.ts,
            content_hash: stored.content_hash,
            fee_recorded: !!payment_txid
        };

        if (this.peer.sidechannel) {
            this.peer.sidechannel.broadcast(channel, JSON.stringify(response));
            console.log('MemoryIndexer: memory_read response for', memory_id, '— found: true');
        }

        // Record fee in contract if payment was provided
        if (payment_txid) {
            const payer = msg.payer || 'unknown';
            await this.append('record_fee', {
                memory_id: String(memory_id),
                operation: stored.access === 'gated' ? 'read_gated' : 'read_open',
                payer: String(payer),
                payment_txid: String(payment_txid),
                amount: this.defaultFeeAmount,
                ts: Date.now()
            });
            console.log('MemoryIndexer: appended record_fee for', memory_id, '— txid:', payment_txid);
        }
    }
}

export default MemoryIndexer;
