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
     * Phase 3: adds skill publish/request/catalog on the mnemex-skills channel.
     *
     * @param peer
     * @param options — { dataDir, cortexChannels, requirePayment, nodeAddress, enableSkills }
     */
    constructor(peer, options = {}) {
        super(peer, options);
        this.dataDir = options.dataDir || './mnemex-data';
        this.skillsDir = path.join(this.dataDir, 'skills');
        this.cortexChannels = options.cortexChannels || ['cortex-crypto'];
        this.skillsChannel = 'mnemex-skills';
        this.enableSkills = options.enableSkills !== false; // default true
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
        if (this.enableSkills && !fs.existsSync(this.skillsDir)) {
            fs.mkdirSync(this.skillsDir, { recursive: true });
        }

        // Try to load registered cortex channels from contract state
        try {
            if (this.peer.base && this.peer.base.view) {
                const stream = this.peer.base.view.createReadStream({ gte: 'cortex/', lt: 'cortex0' });
                for await (const entry of stream) {
                    const key = typeof entry.key === 'string' ? entry.key
                        : Buffer.isBuffer(entry.key) ? entry.key.toString('utf8')
                        : String(entry.key);
                    const cortexName = key.slice('cortex/'.length);
                    if (entry.value && entry.value.status === 'active' && !this.cortexChannels.includes(cortexName)) {
                        this.cortexChannels.push(cortexName);
                    }
                }
            }
        } catch (_e) {
            // View may not be ready yet or no cortex channels registered
        }

        console.log('MemoryIndexer: started. Data dir:', this.dataDir);
        console.log('MemoryIndexer: cortex channels:', this.cortexChannels.join(', '));
        if (this.enableSkills) {
            console.log('MemoryIndexer: skills channel:', this.skillsChannel);
        }
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
        const isCortex = this.cortexChannels.includes(channel);
        const isSkills = this.enableSkills && channel === this.skillsChannel;
        if (!isCortex && !isSkills) return false;

        let msg;
        // Sidechannel wraps messages in an envelope: { type: "sidechannel", message: <inner>, ... }
        // Extract the inner message before parsing.
        const inner = (payload && typeof payload === 'object' && !Buffer.isBuffer(payload))
            ? payload.message ?? payload
            : payload;
        const raw = typeof inner === 'string' ? inner
            : Buffer.isBuffer(inner) ? inner.toString('utf8')
            : (typeof inner === 'object' && inner !== null) ? JSON.stringify(inner)
            : String(inner);
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

        if (msg.type === 'skill_publish') {
            this._handleSkillPublish(channel, msg).catch((err) => {
                console.error('MemoryIndexer: skill_publish error:', err?.message ?? err);
            });
            return true;
        }

        if (msg.type === 'skill_request') {
            this._handleSkillRequest(channel, msg).catch((err) => {
                console.error('MemoryIndexer: skill_request error:', err?.message ?? err);
            });
            return true;
        }

        if (msg.type === 'skill_catalog') {
            this._handleSkillCatalog(channel, msg).catch((err) => {
                console.error('MemoryIndexer: skill_catalog error:', err?.message ?? err);
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

        // Extract tags from message (array or comma-separated string)
        let tags = '';
        if (Array.isArray(msg.tags)) {
            tags = msg.tags.map(t => String(t).trim().toLowerCase()).filter(t => t.length > 0).join(',');
        } else if (typeof msg.tags === 'string') {
            tags = msg.tags;
        }

        // Inject metadata into contract via Feature mechanism (autobase consensus)
        const appendPayload = {
            memory_id: String(memory_id),
            cortex: String(cortex),
            author: String(author),
            access: String(access || 'open'),
            content_hash: contentHash,
            ts: ts
        };
        if (tags) appendPayload.tags = tags;
        await this.append('register_memory', appendPayload);
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
    // ==================== Skill Handlers ====================

    /**
     * Process a skill_publish message:
     * 1. Validate required fields
     * 2. Store the full skill package locally in ./mnemex-data/skills/
     * 3. Trigger register_skill contract TX via Feature injection
     *
     * @param channel
     * @param msg
     */
    async _handleSkillPublish(channel, msg) {
        const { skill_id, name, description, cortex, price, version, package: pkg, author, ts, sig } = msg;

        if (!skill_id || !name || !description || !cortex || !price || !version || !pkg || !author) {
            console.log('MemoryIndexer: skill_publish rejected — missing required fields');
            return;
        }

        // Store the full skill package locally
        const filePath = path.join(this.skillsDir, skill_id + '.json');
        const stored = {
            skill_id,
            name,
            description,
            cortex,
            price,
            version,
            package: pkg,
            author,
            ts: ts || Date.now(),
            sig: sig || null,
            stored_at: Date.now()
        };
        fs.writeFileSync(filePath, JSON.stringify(stored, null, 2));
        console.log('MemoryIndexer: stored skill', skill_id, '→', filePath);

        // Extract inputs/outputs from package and compute content_hash
        const inputs = Array.isArray(pkg.inputs) ? pkg.inputs.join(',') : String(pkg.inputs || '');
        const outputs = Array.isArray(pkg.outputs) ? pkg.outputs.join(',') : String(pkg.outputs || '');
        const contentHash = crypto.createHash('sha256').update(JSON.stringify(pkg)).digest('hex');

        // Register skill in contract via Feature injection
        await this.append('register_skill', {
            skill_id: String(skill_id),
            name: String(name),
            description: String(description),
            cortex: String(cortex),
            price: String(price),
            version: String(version),
            author: String(author),
            inputs,
            outputs,
            content_hash: contentHash
        });
        console.log('MemoryIndexer: appended register_skill for', skill_id);
    }

    /**
     * Process a skill_request message:
     * 1. Look up the skill package locally
     * 2. If requirePayment and no payment_txid → respond with payment_required
     * 3. If payment provided (or requirePayment is false) → deliver package
     * 4. After delivery → record skill download via contract entry
     *
     * @param channel
     * @param msg
     */
    async _handleSkillRequest(channel, msg) {
        const { skill_id, payment_txid } = msg;

        if (!skill_id) {
            console.log('MemoryIndexer: skill_request rejected — missing skill_id');
            return;
        }

        const filePath = path.join(this.skillsDir, skill_id + '.json');

        // Skill not found locally
        if (!fs.existsSync(filePath)) {
            const response = {
                v: 1,
                type: 'skill_deliver',
                skill_id,
                found: false,
                package: null,
                ts: Date.now()
            };
            if (this.peer.sidechannel) {
                this.peer.sidechannel.broadcast(channel, JSON.stringify(response));
                console.log('MemoryIndexer: skill_request for', skill_id, '— not found');
            }
            return;
        }

        // Payment gate
        if (this.requirePayment && !payment_txid) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const stored = JSON.parse(raw);
            const response = {
                v: 1,
                type: 'payment_required',
                skill_id,
                amount: stored.price || this.defaultFeeAmount,
                pay_to: this.nodeAddress,
                ts: Date.now()
            };
            if (this.peer.sidechannel) {
                this.peer.sidechannel.broadcast(channel, JSON.stringify(response));
                console.log('MemoryIndexer: payment_required for skill', skill_id);
            }
            return;
        }

        // Deliver skill package
        const raw = fs.readFileSync(filePath, 'utf8');
        const stored = JSON.parse(raw);
        const response = {
            v: 1,
            type: 'skill_deliver',
            skill_id,
            found: true,
            package: stored.package,
            ts: Date.now()
        };

        if (this.peer.sidechannel) {
            this.peer.sidechannel.broadcast(channel, JSON.stringify(response));
            console.log('MemoryIndexer: skill_deliver for', skill_id);
        }

        // Record skill download in contract if payment was provided
        if (payment_txid) {
            const buyer = msg.buyer || msg.payer || 'unknown';
            await this.append('record_skill_download', {
                skill_id: String(skill_id),
                buyer: String(buyer),
                payment_txid: String(payment_txid),
                amount: stored.price || this.defaultFeeAmount
            });
            console.log('MemoryIndexer: appended record_skill_download for', skill_id, '— txid:', payment_txid);
        }
    }

    /**
     * Process a skill_catalog message:
     * Scans local skills directory and returns metadata (no package contents).
     * Optionally filters by cortex if provided.
     *
     * @param channel
     * @param msg
     */
    async _handleSkillCatalog(channel, msg) {
        const cortexFilter = msg.cortex || null;
        const skills = [];

        if (fs.existsSync(this.skillsDir)) {
            const files = fs.readdirSync(this.skillsDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const filePath = path.join(this.skillsDir, file);
                const raw = fs.readFileSync(filePath, 'utf8');
                const stored = JSON.parse(raw);
                if (cortexFilter && stored.cortex !== cortexFilter) continue;
                skills.push({
                    skill_id: stored.skill_id,
                    name: stored.name,
                    description: stored.description,
                    cortex: stored.cortex,
                    price: stored.price,
                    version: stored.version,
                    downloads: 0 // local node doesn't track downloads, contract does
                });
            }
        }

        const response = {
            v: 1,
            type: 'skill_catalog_response',
            cortex: cortexFilter,
            skills: skills,
            ts: Date.now()
        };

        if (this.peer.sidechannel) {
            this.peer.sidechannel.broadcast(channel, JSON.stringify(response));
            console.log('MemoryIndexer: skill_catalog response —', skills.length, 'skills');
        }
    }
}

export default MemoryIndexer;
