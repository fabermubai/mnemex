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
        this.msb = options.msb || null; // raw MSB instance for tx verification
        this.defaultFeeAmount = '30000000000000000'; // 0.03 TNK in smallest unit

        // P2P relay: when a memory isn't found locally, broadcast to the network
        this.pendingRelays = new Map(); // request_id → { replyFn, channel, timer }
        this.relayTimeoutMs = options.relayTimeoutMs || 10_000; // 10 seconds
        this.peerId = peer.wallet?.publicKey || null;
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

        if (msg.type === 'memory_search') {
            this._handleMemorySearch(channel, msg).catch((err) => {
                console.error('MemoryIndexer: memory_search error:', err?.message ?? err);
            });
            return true;
        }

        if (msg.type === 'memory_list') {
            this._handleMemoryList(channel, msg).catch((err) => {
                console.error('MemoryIndexer: memory_list error:', err?.message ?? err);
            });
            return true;
        }

        if (msg.type === 'skill_search') {
            this._handleSkillSearch(channel, msg).catch((err) => {
                console.error('MemoryIndexer: skill_search error:', err?.message ?? err);
            });
            return true;
        }

        // P2P relay: another peer is asking the network for a memory
        if (msg.type === 'memory_read_relay') {
            this._handleRelayRequest(channel, msg).catch((err) => {
                console.error('MemoryIndexer: memory_read_relay error:', err?.message ?? err);
            });
            return true;
        }

        // P2P relay: a peer responded to our relay request
        if (msg.type === 'memory_read_relay_response') {
            this._handleRelayResponse(channel, msg);
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

        // Check if memory already exists locally — only the original author can update
        const filePath = path.join(this.dataDir, memory_id + '.json');
        if (fs.existsSync(filePath)) {
            const existingRaw = fs.readFileSync(filePath, 'utf8');
            const existing = JSON.parse(existingRaw);
            if (existing.author && existing.author !== author) {
                console.log('MemoryIndexer: memory_write rejected — not the author (' + author.slice(0, 8) + '… vs ' + existing.author.slice(0, 8) + '…)');
                if (this.peer.sidechannel) {
                    this.peer.sidechannel.broadcast(channel, JSON.stringify({
                        v: 1,
                        type: 'memory_update_rejected',
                        memory_id,
                        reason: 'Not the author',
                        ts: Date.now()
                    }));
                }
                return;
            }
        }

        // Compute content hash from data payload
        const dataStr = JSON.stringify(data);
        const contentHash = crypto.createHash('sha256').update(dataStr).digest('hex');
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
     * Resolve a creator pubkey hex to a bech32m trac1 address.
     * Uses peer.msbClient if available, falls back to raw pubkey hex.
     */
    _getCreatorAddress(authorPubKeyHex) {
        if (this.peer.msbClient?.pubKeyHexToAddress) {
            return this.peer.msbClient.pubKeyHexToAddress(authorPubKeyHex);
        }
        return authorPubKeyHex;
    }

    /**
     * Compute fee split amounts based on memory access type.
     * - open:  60% creator, 40% node
     * - gated: 70% creator, 30% node
     */
    _computeFeeSplit(access) {
        const total = BigInt(this.defaultFeeAmount);
        const creatorPct = access === 'gated' ? 70n : 60n;
        const nodePct = access === 'gated' ? 30n : 40n;
        return {
            creator_share: (total * creatorPct / 100n).toString(),
            node_share: (total * nodePct / 100n).toString()
        };
    }

    /**
     * Send a response to the requester.
     * If replyFn is provided (SC-Bridge path), call it directly.
     * Otherwise broadcast on the sidechannel (P2P path).
     */
    _respond(channel, response, replyFn) {
        const data = JSON.stringify(response);
        if (replyFn) {
            replyFn(data);
        } else if (this.peer.sidechannel) {
            this.peer.sidechannel.broadcast(channel, data);
        }
    }

    /**
     * Process a memory_read message — immediate fee split flow:
     *
     * 1. Look up the data locally
     * 2. If requirePayment and no payment txids → respond with payment_required
     *    including split amounts + two pay-to addresses (creator + node)
     * 3. Agent sends 2 TNK transfers and retries with payment_txid_creator + payment_txid_node
     * 4. Verify both txids on MSB (if msb available)
     * 5. If both confirmed → serve data and record fee
     *
     * @param channel
     * @param msg
     * @param replyFn — optional callback(dataStr) for direct reply (SC-Bridge)
     */
    async _handleMemoryRead(channel, msg, replyFn) {
        const { memory_id, payment_txid_creator, payment_txid_node } = msg;

        if (!memory_id) {
            console.log('MemoryIndexer: memory_read rejected — missing memory_id');
            return;
        }

        const filePath = path.join(this.dataDir, memory_id + '.json');

        // Memory not found locally
        if (!fs.existsSync(filePath)) {
            // If this is a local/SC-Bridge request (has replyFn) and NOT already a relay,
            // broadcast to the P2P network instead of returning found:false immediately.
            if (replyFn && !msg.is_relay) {
                this._initiateRelay(channel, msg, replyFn);
                return;
            }
            const response = {
                v: 1,
                type: 'memory_response',
                memory_id,
                found: false,
                data: null
            };
            this._respond(channel, response, replyFn);
            console.log('MemoryIndexer: memory_read response for', memory_id, '— found: false');
            return;
        }

        // Read stored data to get author + access type for fee computation
        const raw = fs.readFileSync(filePath, 'utf8');
        const stored = JSON.parse(raw);
        const hasPayment = !!(payment_txid_creator && payment_txid_node);

        // Payment gate: no payment txids → return payment_required with split info
        if (this.requirePayment && !hasPayment) {
            const split = this._computeFeeSplit(stored.access);
            const creatorAddress = this._getCreatorAddress(stored.author);
            const response = {
                v: 1,
                type: 'payment_required',
                memory_id,
                amount: this.defaultFeeAmount,
                creator_share: split.creator_share,
                node_share: split.node_share,
                pay_to_creator: creatorAddress,
                pay_to_node: this.nodeAddress,
                ts: Date.now()
            };
            this._respond(channel, response, replyFn);
            console.log('MemoryIndexer: payment_required for', memory_id);
            return;
        }

        // Verify both payments on MSB if msb is available
        if (this.requirePayment && hasPayment && this.msb) {
            const confirmedCreator = await this.msb.state.getTransactionConfirmedLength(payment_txid_creator);
            if (confirmedCreator === null) {
                const response = {
                    v: 1,
                    type: 'payment_not_confirmed',
                    memory_id,
                    payment_txid: payment_txid_creator,
                    which: 'creator',
                    ts: Date.now()
                };
                this._respond(channel, response, replyFn);
                console.log('MemoryIndexer: payment_not_confirmed (creator) for', memory_id, '— txid:', payment_txid_creator);
                return;
            }

            const confirmedNode = await this.msb.state.getTransactionConfirmedLength(payment_txid_node);
            if (confirmedNode === null) {
                const response = {
                    v: 1,
                    type: 'payment_not_confirmed',
                    memory_id,
                    payment_txid: payment_txid_node,
                    which: 'node',
                    ts: Date.now()
                };
                this._respond(channel, response, replyFn);
                console.log('MemoryIndexer: payment_not_confirmed (node) for', memory_id, '— txid:', payment_txid_node);
                return;
            }
        }

        // Serve data
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
            fee_recorded: hasPayment
        };

        this._respond(channel, response, replyFn);
        console.log('MemoryIndexer: memory_read response for', memory_id, '— found: true');

        // Record fee in contract if payment was provided
        if (hasPayment) {
            const payer = msg.payer || 'unknown';
            const split = this._computeFeeSplit(stored.access);
            const feeEntry = {
                memory_id: String(memory_id),
                operation: stored.access === 'gated' ? 'read_gated' : 'read_open',
                payer: String(payer),
                payment_txid: String(payment_txid_creator),
                payment_txid_creator: String(payment_txid_creator),
                payment_txid_node: String(payment_txid_node),
                amount: this.defaultFeeAmount,
                creator_share: split.creator_share,
                node_share: split.node_share,
                ts: Date.now()
            };
            if (this.nodeAddress) feeEntry.served_by = String(this.nodeAddress);
            await this.append('record_fee', feeEntry);
            console.log('MemoryIndexer: appended record_fee for', memory_id, '— creator_txid:', payment_txid_creator, '— node_txid:', payment_txid_node);
        }
    }
    // ==================== P2P Relay ====================

    /**
     * Initiate a P2P relay: broadcast a memory_read_relay request to the network
     * and store the pending replyFn with a timeout.
     *
     * @param channel — cortex channel
     * @param msg — original memory_read message
     * @param replyFn — callback to deliver the response to the SC-Bridge client
     */
    _initiateRelay(channel, msg, replyFn) {
        const request_id = crypto.randomBytes(16).toString('hex');
        const memory_id = msg.memory_id;

        // Timeout: if no relay response within relayTimeoutMs, return found:false
        const timer = setTimeout(() => {
            const pending = this.pendingRelays.get(request_id);
            if (!pending) return;
            this.pendingRelays.delete(request_id);
            console.log('MemoryIndexer: relay timeout for', memory_id, '— request_id:', request_id);
            const response = { v: 1, type: 'memory_response', memory_id, found: false, data: null };
            pending.replyFn(JSON.stringify(response));
        }, this.relayTimeoutMs);

        this.pendingRelays.set(request_id, { replyFn, channel, timer, memory_id });

        // Broadcast relay request to P2P network
        const relayMsg = {
            v: 1,
            type: 'memory_read_relay',
            memory_id,
            request_id,
            requester_id: this.peerId,
            payment_txid_creator: msg.payment_txid_creator || undefined,
            payment_txid_node: msg.payment_txid_node || undefined,
            payer: msg.payer || undefined,
        };
        if (this.peer.sidechannel) {
            this.peer.sidechannel.broadcast(channel, JSON.stringify(relayMsg));
        }
        console.log('MemoryIndexer: relay request broadcast for', memory_id, '— request_id:', request_id);
    }

    /**
     * Handle an incoming memory_read_relay from another peer.
     * If we have the memory locally, process the read and broadcast the response.
     * If not, do nothing (let the requester's timeout handle it).
     *
     * @param channel
     * @param msg — { v, type, memory_id, request_id, requester_id, payment_txid_creator?, payment_txid_node?, payer? }
     */
    async _handleRelayRequest(channel, msg) {
        // Anti-loop: ignore our own relay requests
        if (msg.requester_id && msg.requester_id === this.peerId) return;

        const { memory_id, request_id } = msg;
        if (!memory_id || !request_id) return;

        const filePath = path.join(this.dataDir, memory_id + '.json');
        if (!fs.existsSync(filePath)) return; // We don't have it either, stay silent

        console.log('MemoryIndexer: relay request from', (msg.requester_id || 'unknown').slice(0, 8) + '…', 'for', memory_id);

        // Process the read locally with is_relay=true to prevent re-relay
        const relayReplyFn = (dataStr) => {
            // Wrap the response in a relay_response envelope and broadcast back
            let parsed;
            try { parsed = JSON.parse(dataStr); } catch (_e) { return; }
            const relayResponse = {
                v: 1,
                type: 'memory_read_relay_response',
                request_id,
                response: parsed,
            };
            if (this.peer.sidechannel) {
                this.peer.sidechannel.broadcast(channel, JSON.stringify(relayResponse));
            }
        };

        await this._handleMemoryRead(channel, {
            v: 1,
            type: 'memory_read',
            memory_id,
            is_relay: true,
            payment_txid_creator: msg.payment_txid_creator || undefined,
            payment_txid_node: msg.payment_txid_node || undefined,
            payer: msg.payer || undefined,
        }, relayReplyFn);
    }

    /**
     * Handle an incoming memory_read_relay_response from a peer that has the data.
     * Match it to a pending relay request and deliver to the waiting client.
     *
     * @param channel
     * @param msg — { v, type, request_id, response }
     */
    _handleRelayResponse(channel, msg) {
        const { request_id, response } = msg;
        if (!request_id || !response) return;

        const pending = this.pendingRelays.get(request_id);
        if (!pending) return; // Timed out or duplicate

        // Deliver the response to the waiting SC-Bridge client
        clearTimeout(pending.timer);
        this.pendingRelays.delete(request_id);
        pending.replyFn(JSON.stringify(response));
        console.log('MemoryIndexer: relay response received for', pending.memory_id, '— request_id:', request_id);
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
        const { skill_id, payment_txid_creator, payment_txid_node } = msg;
        const hasPayment = !!(payment_txid_creator && payment_txid_node);

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

        // Read stored data for fee computation
        const raw = fs.readFileSync(filePath, 'utf8');
        const stored = JSON.parse(raw);

        // Payment gate
        if (this.requirePayment && !hasPayment) {
            const skillPrice = stored.price || this.defaultFeeAmount;
            const total = BigInt(skillPrice);
            const creatorShare = (total * 80n / 100n).toString();
            const nodeShare = (total * 20n / 100n).toString();
            const creatorAddress = this._getCreatorAddress(stored.author);
            const response = {
                v: 1,
                type: 'payment_required',
                skill_id,
                amount: skillPrice,
                creator_share: creatorShare,
                node_share: nodeShare,
                pay_to_creator: creatorAddress,
                pay_to_node: this.nodeAddress,
                ts: Date.now()
            };
            if (this.peer.sidechannel) {
                this.peer.sidechannel.broadcast(channel, JSON.stringify(response));
                console.log('MemoryIndexer: payment_required for skill', skill_id);
            }
            return;
        }

        // Deliver skill package
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
        if (hasPayment) {
            const buyer = msg.buyer || msg.payer || 'unknown';
            const dlEntry = {
                skill_id: String(skill_id),
                buyer: String(buyer),
                payment_txid: String(payment_txid_creator),
                amount: stored.price || this.defaultFeeAmount
            };
            if (this.nodeAddress) dlEntry.served_by = String(this.nodeAddress);
            await this.append('record_skill_download', dlEntry);
            console.log('MemoryIndexer: appended record_skill_download for', skill_id, '— txid:', payment_txid_creator);
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
    // ==================== Search & List Handlers ====================

    /**
     * Process a memory_search message:
     * Scan local mnemex-data/ files and match query against memory_id,
     * keys and values of the stored JSON content. Case-insensitive substring.
     *
     * @param channel
     * @param msg — { v, type, query, cortex?, author? }
     * @param replyFn — optional callback(dataStr) for direct reply (SC-Bridge)
     */
    async _handleMemorySearch(channel, msg, replyFn) {
        const query = typeof msg.query === 'string' ? msg.query.trim().toLowerCase() : '';
        const cortexFilter = msg.cortex || null;
        const authorFilter = msg.author || null;
        const limit = Number.isInteger(msg.limit) && msg.limit > 0 ? Math.min(msg.limit, 50) : 20;

        if (!query) {
            this._respond(channel, {
                v: 1,
                type: 'memory_search_response',
                query: '',
                results: [],
                total: 0,
                ts: Date.now()
            }, replyFn);
            return;
        }

        const results = [];
        if (!fs.existsSync(this.dataDir)) {
            this._respond(channel, {
                v: 1, type: 'memory_search_response', query: msg.query,
                results: [], total: 0, ts: Date.now()
            }, replyFn);
            return;
        }

        const files = fs.readdirSync(this.dataDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            const filePath = path.join(this.dataDir, file);
            let stored;
            try {
                stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (_e) { continue; }

            // Filter by cortex
            if (cortexFilter && stored.cortex !== cortexFilter) continue;
            // Filter by author
            if (authorFilter && stored.author !== authorFilter) continue;

            // Search in memory_id
            const mid = (stored.memory_id || '').toLowerCase();
            let matched = mid.includes(query);

            // Search in data keys and values (shallow)
            if (!matched && stored.data && typeof stored.data === 'object') {
                for (const [k, v] of Object.entries(stored.data)) {
                    const kLower = String(k).toLowerCase();
                    const vLower = String(v).toLowerCase();
                    if (kLower.includes(query) || vLower.includes(query)) {
                        matched = true;
                        break;
                    }
                }
            }

            if (matched) {
                results.push({
                    memory_id: stored.memory_id,
                    cortex: stored.cortex,
                    author: stored.author,
                    preview: stored.data || null,
                    ts: stored.ts || null
                });
                if (results.length >= limit) break;
            }
        }

        const response = {
            v: 1,
            type: 'memory_search_response',
            query: msg.query,
            results,
            total: results.length,
            ts: Date.now()
        };

        this._respond(channel, response, replyFn);
        console.log('MemoryIndexer: memory_search "' + msg.query + '" —', results.length, 'results');
    }

    /**
     * Process a memory_list message:
     * List all memories stored locally, optionally filtered by cortex and/or author.
     *
     * @param channel
     * @param msg — { v, type, cortex?, author?, limit? }
     * @param replyFn — optional callback(dataStr) for direct reply (SC-Bridge)
     */
    async _handleMemoryList(channel, msg, replyFn) {
        const cortexFilter = msg.cortex || null;
        const authorFilter = msg.author || null;
        const limit = Number.isInteger(msg.limit) && msg.limit > 0 ? Math.min(msg.limit, 100) : 20;

        const memories = [];
        if (fs.existsSync(this.dataDir)) {
            const files = fs.readdirSync(this.dataDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const filePath = path.join(this.dataDir, file);
                let stored;
                try {
                    stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                } catch (_e) { continue; }

                if (cortexFilter && stored.cortex !== cortexFilter) continue;
                if (authorFilter && stored.author !== authorFilter) continue;

                memories.push({
                    memory_id: stored.memory_id,
                    cortex: stored.cortex,
                    author: stored.author,
                    access: stored.access || 'open',
                    ts: stored.ts || null
                });
                if (memories.length >= limit) break;
            }
        }

        const response = {
            v: 1,
            type: 'memory_list_response',
            memories,
            total: memories.length,
            ts: Date.now()
        };

        this._respond(channel, response, replyFn);
        console.log('MemoryIndexer: memory_list —', memories.length, 'memories');
    }

    /**
     * Process a skill_search message:
     * Search registered skills by matching query against name and description.
     * Uses local skills directory (not contract state) for fast lookup.
     *
     * @param channel
     * @param msg — { v, type, query, cortex? }
     * @param replyFn — optional callback(dataStr) for direct reply (SC-Bridge)
     */
    async _handleSkillSearch(channel, msg, replyFn) {
        const query = typeof msg.query === 'string' ? msg.query.trim().toLowerCase() : '';
        const cortexFilter = msg.cortex || null;
        const limit = Number.isInteger(msg.limit) && msg.limit > 0 ? Math.min(msg.limit, 50) : 20;

        if (!query) {
            this._respond(channel, {
                v: 1, type: 'skill_search_response', query: '',
                results: [], total: 0, ts: Date.now()
            }, replyFn);
            return;
        }

        const results = [];
        if (fs.existsSync(this.skillsDir)) {
            const files = fs.readdirSync(this.skillsDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const filePath = path.join(this.skillsDir, file);
                let stored;
                try {
                    stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                } catch (_e) { continue; }

                if (cortexFilter && stored.cortex !== cortexFilter) continue;

                const nameLower = (stored.name || '').toLowerCase();
                const descLower = (stored.description || '').toLowerCase();
                if (nameLower.includes(query) || descLower.includes(query)) {
                    results.push({
                        skill_id: stored.skill_id,
                        name: stored.name,
                        description: stored.description,
                        cortex: stored.cortex,
                        price: stored.price,
                        version: stored.version,
                        author: stored.author
                    });
                    if (results.length >= limit) break;
                }
            }
        }

        const response = {
            v: 1,
            type: 'skill_search_response',
            query: msg.query,
            results,
            total: results.length,
            ts: Date.now()
        };

        this._respond(channel, response, replyFn);
        console.log('MemoryIndexer: skill_search "' + msg.query + '" —', results.length, 'results');
    }
}

export default MemoryIndexer;
