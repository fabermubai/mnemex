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

        // MSB payment verification retry settings
        this.paymentRetryMs = options.paymentRetryMs ?? 3000;
        this.paymentMaxAttempts = options.paymentMaxAttempts ?? 10;
        this.paymentVerifyTimeoutMs = options.paymentVerifyTimeoutMs ?? 8000; // per-call timeout

        // P2P relay: when a memory isn't found locally, broadcast to the network
        this.pendingRelays = new Map(); // request_id → { replyFn, channel, timer }
        this.relayTimeoutMs = options.relayTimeoutMs || 30_000; // 30s — MSB verification can take 16s+
        this.peerId = peer.wallet?.publicKey || null;

        // Rate limiting: max writes per author per time window
        this.rateLimitWindow = options.rateLimitWindow || 3600_000; // 1h in ms
        this.rateLimitMax = options.rateLimitMax || 100;             // max 100 writes/h/author
        this.writeCounters = new Map(); // author → { count, windowStart }

        // Presence tracking
        this.presenceMap = new Map(); // peerKey → { address, nick, capabilities, lastSeen, ts }
        this.presenceTTL = 10 * 60 * 1000; // 10 minutes

        // Bootstrap peer flag — only the bootstrap processes append_relay messages
        this._isBootstrapPeer = options.isBootstrapPeer || false;
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

        // ── Append: direct or relay ─────────────────────────────────────
        // Only the bootstrap peer appends directly — its writes are always
        // processed by the Autobase indexer (itself). All other peers relay
        // via sidechannel, because Autobase remote core replication is
        // unreliable (cores opened with active:false are never announced).
        const origAppend = this.append.bind(this);

        if (!this._isBootstrapPeer) {
            this.append = async (key, value) => {
                // Relay via first cortex channel — proven to work for
                // memory_write broadcasts between remote peers.
                if (this.peer.sidechannel) {
                    const ch = this.cortexChannels[0] || '0000mnemex';
                    this.peer.sidechannel.broadcast(ch, JSON.stringify({
                        v: 1, type: 'append_relay', key, value,
                        origin: this.peer.wallet?.publicKey || 'unknown',
                        ts: Date.now(),
                    }));
                }
            };
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

        // Presence cleanup every 5 minutes (unref so it doesn't prevent process exit in tests)
        this._presenceCleanupInterval = setInterval(() => {
            const cutoff = Date.now() - this.presenceTTL;
            for (const [key, entry] of this.presenceMap) {
                if (entry.lastSeen < cutoff) this.presenceMap.delete(key);
            }
        }, 5 * 60 * 1000);
        this._presenceCleanupInterval.unref();
    }

    async stop() {
        if (this._presenceCleanupInterval) clearInterval(this._presenceCleanupInterval);
    }

    /**
     * Handle an incoming sidechannel message.
     * Called by index.js via the sidechannel onMessage callback.
     *
     * @param channel — the sidechannel name (e.g. "cortex-crypto")
     * @param payload — raw message (string or buffer)
     * @param connection — the Hyperswarm connection object
     */
    handleMessage(channel, payload, connection) {
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

        // Presence: handle peer_announce on any channel (including entry channel 0000mnemex)
        if (msg.type === 'peer_announce' && msg.peer_key) {
            this._handlePeerAnnounce(msg, connection);
            return true;
        }

        // Bulk sync: handle on any channel (like peer_announce)
        if (msg.type === 'memory_sync_request' && msg.peer_key) {
            this._handleSyncRequest(msg, connection).catch((err) => {
                console.error('MemoryIndexer: memory_sync_request error:', err?.message ?? err);
            });
            return true;
        }

        if (msg.type === 'memory_sync_response' && msg.peer_key) {
            this._handleSyncResponse(msg, connection).catch((err) => {
                console.error('MemoryIndexer: memory_sync_response error:', err?.message ?? err);
            });
            return true;
        }

        // Append relay: only the bootstrap peer processes relays.
        if (msg.type === 'append_relay' && msg.key && msg.value) {
            if (this._isBootstrapPeer) {
                this.append(msg.key, msg.value).then(() => {
                    console.log(`MemoryIndexer: executed relayed append (${msg.key}) from ${(msg.origin || '?').slice(0, 12)}...`);
                }).catch((err) => {
                    console.error('MemoryIndexer: relayed append failed:', err?.message ?? err);
                });
            }
            return true;
        }

        // Fee record broadcast: a non-bootstrap peer served a paid read
        // and broadcasts the fee details so the bootstrap can record on-chain.
        if (msg.type === 'fee_record' && msg.memory_id && msg.payment_txid_creator) {
            if (this._isBootstrapPeer) {
                // Look up memory to compute fee split
                const memPath = path.join(this.dataDir, msg.memory_id + '.json');
                const memData = fs.existsSync(memPath) ? JSON.parse(fs.readFileSync(memPath, 'utf8')) : null;
                if (memData) {
                    const feeAmount = (memData.access === 'gated' && memData.price) ? memData.price : this.defaultFeeAmount;
                    const split = this._computeFeeSplit(memData.access, feeAmount);
                    const feeEntry = {
                        memory_id: String(msg.memory_id),
                        operation: 'read_gated',
                        payer: String(msg.payer || 'unknown'),
                        payment_txid: String(msg.payment_txid_creator),
                        payment_txid_creator: String(msg.payment_txid_creator),
                        payment_txid_node: String(msg.payment_txid_node),
                        amount: feeAmount,
                        creator_share: split.creator_share,
                        node_share: split.node_share,
                        ts: Date.now()
                    };
                    if (this.nodeAddress) feeEntry.served_by = String(this.nodeAddress);
                    this.append('record_fee', feeEntry).then(() => {
                        console.log('MemoryIndexer: recorded fee from broadcast for', msg.memory_id);
                    }).catch((err) => {
                        console.error('MemoryIndexer: fee_record append failed:', err?.message ?? err);
                    });
                }
            }
            return true;
        }

        // P2P relay: handle BEFORE channel filter — relays use entry channel (0000mnemex)
        // which is not in the cortex list.
        if (msg.type === 'memory_read_relay') {
            this._handleRelayRequest(channel, msg).catch((err) => {
                console.error('MemoryIndexer: memory_read_relay error:', err?.message ?? err);
            });
            return true;
        }

        if (msg.type === 'memory_read_relay_response') {
            this._handleRelayResponse(channel, msg);
            return true;
        }

        // Channel filter: only process cortex/skills messages below
        const isCortex = this.cortexChannels.includes(channel);
        const isSkills = this.enableSkills && channel === this.skillsChannel;
        if (!isCortex && !isSkills) return false;

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

        if (!memory_id || !cortex || !author || !ts) {
            console.log('MemoryIndexer: memory_write rejected — missing required fields');
            return;
        }

        // Metadata-only write (gated memory from another peer — no data field).
        // Register on-chain but don't store any local file.
        const isMetadataOnly = !data;

        // Rate limiting: max N writes per author per time window
        const now = Date.now();
        const counter = this.writeCounters.get(author);
        if (counter && (now - counter.windowStart) < this.rateLimitWindow) {
            if (counter.count >= this.rateLimitMax) {
                console.log('MemoryIndexer: rate limit exceeded for', author.slice(0, 8) + '…');
                return;
            }
            counter.count++;
        } else {
            this.writeCounters.set(author, { count: 1, windowStart: now });
        }

        // Check if memory already exists locally — only the original author can update
        const filePath = path.join(this.dataDir, memory_id + '.json');
        if (!isMetadataOnly && fs.existsSync(filePath)) {
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

        // Compute content hash from data payload (or use provided hash for metadata-only)
        const contentHash = isMetadataOnly
            ? (msg.content_hash || 'metadata-only')
            : crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
        const stored = {
            memory_id,
            cortex,
            data: data || null,
            author,
            ts,
            sig: sig || null,
            access: access || 'open',
            content_hash: contentHash,
            price: (access === 'gated' && msg.price) ? msg.price : null,
            stored_at: Date.now()
        };
        if (!isMetadataOnly) {
            fs.writeFileSync(filePath, JSON.stringify(stored, null, 2));
            console.log('MemoryIndexer: stored', memory_id, '→', filePath);
        } else {
            console.log('MemoryIndexer: metadata-only registration for', memory_id, '(gated — no data stored)');
        }

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
        if (access === 'gated' && msg.price) appendPayload.price = String(msg.price);
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
    /**
     * Get reputation data for an author from contract state.
     * Returns { reads, slashes, followers, score } or null if state is unavailable.
     */
    async _getAuthorReputation(author) {
        const view = this.peer.base?.view;
        if (!view) return null;
        const readsEntry = await view.get('rep/' + author + '/reads');
        const slashesEntry = await view.get('rep/' + author + '/slashes');
        const followersEntry = await view.get('follower_count/' + author);
        const reads = readsEntry?.value ?? 0;
        const slashes = slashesEntry?.value ?? 0;
        const followers = followersEntry?.value ?? 0;
        return {
            reads,
            slashes,
            followers,
            score: reads - (slashes * 10)
        };
    }

    _computeFeeSplit(access, customAmount = null) {
        const total = BigInt(customAmount || this.defaultFeeAmount);
        // Only gated memories go through the payment gate (70/30 split)
        // Skills use 80/20 but are handled separately in skill_request
        const creatorPct = 70n;
        const nodePct = 30n;
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
            console.log('MemoryIndexer: file not found for', memory_id, '— replyFn:', !!replyFn, '— is_relay:', !!msg.is_relay);
            // If this is a local/SC-Bridge request (has replyFn) and NOT already a relay,
            // broadcast to the P2P network instead of returning found:false immediately.
            if (replyFn && !msg.is_relay) {
                console.log('MemoryIndexer: initiating relay for', memory_id);
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
        const isAuthorRead = !!(msg.payer && msg.payer === stored.author);
        const hasPayment = !!(payment_txid_creator && payment_txid_node);

        // Fetch author reputation (non-blocking — null if state unavailable)
        const authorReputation = await this._getAuthorReputation(stored.author);

        // Author self-read: bypass payment entirely — no fee for reading your own data
        if (isAuthorRead && this.requirePayment && !hasPayment) {
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
                fee_recorded: false,
                author_reputation: authorReputation
            };
            this._respond(channel, response, replyFn);
            console.log('MemoryIndexer: author self-read (free) for', memory_id);
            return;
        }

        // Open memories: always free, no payment gate
        // (also handles legacy 'public' and missing access field)
        if (stored.access === 'open' || stored.access === 'public' || !stored.access) {
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
                fee_recorded: false,
                author_reputation: authorReputation
            };
            this._respond(channel, response, replyFn);
            console.log('MemoryIndexer: open read (free) for', memory_id);
            return;
        }

        // Payment gate: only gated memories reach here
        // No payment txids → return payment_required with split info
        if (this.requirePayment && !hasPayment) {
            const feeAmount = (stored.access === 'gated' && stored.price) ? stored.price : this.defaultFeeAmount;
            const split = this._computeFeeSplit(stored.access, feeAmount);
            const creatorAddress = this._getCreatorAddress(stored.author);
            const response = {
                v: 1,
                type: 'payment_required',
                memory_id,
                amount: feeAmount,
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

        // Verify both payments on MSB if msb is available.
        // getTransactionConfirmedLength does a linear scan of MSB history which can
        // be very slow (28K+ entries). We add a per-call timeout to prevent hanging.
        // If verification times out, we trust the txids — payments were already
        // confirmed by the MSB transfer handler.
        if (this.requirePayment && hasPayment && this.msb) {
            const verifyTimeoutMs = this.paymentVerifyTimeoutMs || 8000;
            const maxAttempts = this.paymentMaxAttempts;
            const retryDelayMs = this.paymentRetryMs;
            let creatorConfirmed = false;
            let nodeConfirmed = false;

            const verifyWithTimeout = (txid) => {
                return Promise.race([
                    this.msb.state.getTransactionConfirmedLength(txid),
                    new Promise(resolve => setTimeout(() => resolve('timeout'), verifyTimeoutMs))
                ]);
            };

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                if (!creatorConfirmed) {
                    const result = await verifyWithTimeout(payment_txid_creator);
                    if (result === 'timeout') {
                        console.log('MemoryIndexer: MSB verification timeout for creator txid — trusting payment');
                        creatorConfirmed = true;
                    } else if (result !== null) {
                        creatorConfirmed = true;
                    }
                }
                if (!nodeConfirmed) {
                    const result = await verifyWithTimeout(payment_txid_node);
                    if (result === 'timeout') {
                        console.log('MemoryIndexer: MSB verification timeout for node txid — trusting payment');
                        nodeConfirmed = true;
                    } else if (result !== null) {
                        nodeConfirmed = true;
                    }
                }
                if (creatorConfirmed && nodeConfirmed) break;
                if (attempt < maxAttempts) {
                    console.log('MemoryIndexer: payment verification attempt', attempt + '/' + maxAttempts,
                        'for', memory_id, '— creator:', creatorConfirmed, 'node:', nodeConfirmed, '— retrying in 3s');
                    await new Promise(r => setTimeout(r, retryDelayMs));
                }
            }

            if (!creatorConfirmed || !nodeConfirmed) {
                const which = !creatorConfirmed ? 'creator' : 'node';
                const txid = !creatorConfirmed ? payment_txid_creator : payment_txid_node;
                const response = {
                    v: 1,
                    type: 'payment_not_confirmed',
                    memory_id,
                    payment_txid: txid,
                    which,
                    ts: Date.now()
                };
                this._respond(channel, response, replyFn);
                console.log('MemoryIndexer: payment_not_confirmed (' + which + ') for', memory_id,
                    '— txid:', txid, '— exhausted', maxAttempts, 'attempts');
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
            fee_recorded: hasPayment,
            author_reputation: authorReputation
        };

        this._respond(channel, response, replyFn);
        console.log('MemoryIndexer: memory_read response for', memory_id, '— found: true');

        // Record fee in contract if payment was provided
        if (hasPayment) {
            const payer = msg.payer || 'unknown';
            const feeAmount = (stored.access === 'gated' && stored.price) ? stored.price : this.defaultFeeAmount;
            const split = this._computeFeeSplit(stored.access, feeAmount);
            const feeEntry = {
                memory_id: String(memory_id),
                operation: 'read_gated',
                payer: String(payer),
                payment_txid: String(payment_txid_creator),
                payment_txid_creator: String(payment_txid_creator),
                payment_txid_node: String(payment_txid_node),
                amount: feeAmount,
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
        // Broadcast on entry channel (0000mnemex) — always reliable between peers.
        // Cortex channels may not be paired between remote peers.
        const entryChannel = '0000mnemex';
        if (this.peer.sidechannel) {
            this.peer.sidechannel.broadcast(entryChannel, JSON.stringify(relayMsg));
        }
        console.log('MemoryIndexer: relay request broadcast for', memory_id, '— request_id:', request_id, '— channel:', entryChannel);
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

        // Bulk sync bypass: serve open memories without payment
        if (msg.is_sync === true) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const stored = JSON.parse(raw);
            if (stored.access === 'open' || stored.access === 'public' || !stored.access) {
                const relayResponse = {
                    v: 1,
                    type: 'memory_read_relay_response',
                    request_id,
                    response: {
                        v: 1,
                        type: 'memory_response',
                        memory_id,
                        found: true,
                        data: stored.data,
                        cortex: stored.cortex,
                        author: stored.author,
                        ts: stored.ts,
                        content_hash: stored.content_hash,
                        fee_recorded: false,
                    },
                };
                if (this.peer.sidechannel) {
                    this.peer.sidechannel.broadcast('0000mnemex', JSON.stringify(relayResponse));
                }
                console.log('[sync] served open memory', memory_id, 'to', (msg.requester_id || 'unknown').slice(0, 8) + '…');
                return;
            }
            // Gated memory with is_sync → ignore (don't serve, don't payment_required)
            return;
        }

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
                this.peer.sidechannel.broadcast('0000mnemex', JSON.stringify(relayResponse));
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

        if (!skill_id || !name || !description || !cortex || (price == null || price === '') || !version || !pkg || !author) {
            console.log('MemoryIndexer: skill_publish rejected — missing required fields');
            return;
        }

        // Validate field constraints
        if (String(name).length > 128) {
            console.log('MemoryIndexer: skill_publish rejected — name exceeds 128 chars');
            return;
        }
        if (String(description).length > 512) {
            console.log('MemoryIndexer: skill_publish rejected — description exceeds 512 chars');
            return;
        }
        if (!/^\d+\.\d+\.\d+$/.test(String(version))) {
            console.log('MemoryIndexer: skill_publish rejected — version must be semver (x.y.z)');
            return;
        }

        // Validate package format
        if (pkg.format && pkg.format !== 'mnemex-skill-v1') {
            console.log('MemoryIndexer: skill_publish rejected — unsupported format:', pkg.format);
            return;
        }
        if (pkg.entry_point != null && (typeof pkg.entry_point !== 'string' || !pkg.entry_point.trim())) {
            console.log('MemoryIndexer: skill_publish rejected — entry_point must be a non-empty string');
            return;
        }
        if (pkg.tags != null && (!Array.isArray(pkg.tags) || !pkg.tags.every(t => typeof t === 'string'))) {
            console.log('MemoryIndexer: skill_publish rejected — tags must be an array of strings');
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
        const skillPrice = (stored.price != null && stored.price !== '') ? stored.price : this.defaultFeeAmount;
        const isFreeSkill = BigInt(skillPrice) === 0n;
        if (this.requirePayment && !hasPayment && !isFreeSkill) {
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
    async _handleSkillCatalog(channel, msg, replyFn) {
        const cortexFilter = msg.cortex || msg.channel || null;
        const skills = [];
        const baseView = this.peer?.base?.view || null;

        if (fs.existsSync(this.skillsDir)) {
            const files = fs.readdirSync(this.skillsDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const filePath = path.join(this.skillsDir, file);
                const raw = fs.readFileSync(filePath, 'utf8');
                const stored = JSON.parse(raw);
                if (cortexFilter && stored.cortex !== cortexFilter) continue;
                let downloads = 0;
                if (baseView) {
                    try {
                        const entry = await baseView.get('skill/' + stored.skill_id);
                        if (entry?.value?.downloads != null) downloads = entry.value.downloads;
                        else if (entry?.downloads != null) downloads = entry.downloads;
                    } catch (_e) { /* fallback to 0 */ }
                }
                skills.push({
                    skill_id: stored.skill_id,
                    name: stored.name,
                    description: stored.description,
                    cortex: stored.cortex,
                    price: stored.price,
                    version: stored.version,
                    downloads: downloads
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

        this._respond(channel, response, replyFn);
        console.log('MemoryIndexer: skill_catalog response —', skills.length, 'skills');
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
        const cortexFilter = msg.cortex || msg.channel || null;
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
        const cortexFilter = msg.cortex || msg.channel || null;
        const authorFilter = msg.author || null;
        const limit = Number.isInteger(msg.limit) && msg.limit > 0 ? Math.min(msg.limit, 100) : 20;

        const memories = [];
        const seenIds = new Set();

        // 1. Scan local data files (open memories + gated we own)
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
                seenIds.add(stored.memory_id);
                if (memories.length >= limit) break;
            }
        }

        // 2. Scan contract state for memories without local files (e.g. remote gated)
        if (memories.length < limit && this.peer.base?.view) {
            try {
                const prefix = cortexFilter ? 'mem_by_cortex/' + cortexFilter + '/' : 'mem/';
                const stream = this.peer.base.view.createReadStream({ gte: prefix, lt: prefix + '\xff' });
                for await (const entry of stream) {
                    if (memories.length >= limit) break;
                    const key = typeof entry.key === 'string' ? entry.key : entry.key.toString('utf8');
                    // Extract memory_id from key
                    const memId = cortexFilter
                        ? key.slice(('mem_by_cortex/' + cortexFilter + '/').length)
                        : key.slice('mem/'.length);
                    if (seenIds.has(memId)) continue;

                    // Look up full metadata
                    const metaEntry = cortexFilter
                        ? await this.peer.base.view.get('mem/' + memId)
                        : entry;
                    if (!metaEntry?.value) continue;
                    const meta = metaEntry.value;

                    if (authorFilter && meta.author !== authorFilter) continue;
                    if (cortexFilter && meta.cortex !== cortexFilter) continue;

                    memories.push({
                        memory_id: memId,
                        cortex: meta.cortex,
                        author: meta.author,
                        access: meta.access || 'open',
                        ts: meta.ts || null
                    });
                    seenIds.add(memId);
                }
            } catch (_e) {
                // Contract state may not be ready
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
                const cortexLower = (stored.cortex || '').toLowerCase();
                const authorLower = (stored.author || '').toLowerCase();
                const sidLower = (stored.skill_id || '').toLowerCase();
                const tags = Array.isArray(stored.package?.tags) ? stored.package.tags.map(t => String(t).toLowerCase()) : [];
                const matched = nameLower.includes(query) || descLower.includes(query) ||
                    cortexLower.includes(query) || authorLower === query || sidLower === query ||
                    tags.some(t => t.includes(query));
                if (matched) {
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

    /**
     * Handle a memory_sync_request — respond with metadata of all open memories we have locally.
     * Gated memories are never included (paid content).
     */
    async _handleSyncRequest(msg, _connection) {
        // Don't respond to our own sync requests
        if (msg.peer_key === this.peerId) return;

        const memories = [];
        if (fs.existsSync(this.dataDir)) {
            const files = fs.readdirSync(this.dataDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const filePath = path.join(this.dataDir, file);
                let stored;
                try {
                    stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                } catch (_e) { continue; }

                // Only open/public memories — never sync gated content
                if (stored.access && stored.access !== 'open' && stored.access !== 'public') continue;

                memories.push({
                    memory_id: stored.memory_id,
                    cortex: stored.cortex,
                    author: stored.author,
                    access: 'open',
                    ts: stored.ts || null,
                });
            }
        }

        if (memories.length === 0) return; // Nothing to share

        const response = {
            v: 1,
            type: 'memory_sync_response',
            memories,
            peer_key: this.peerId,
            ts: Date.now(),
        };

        if (this.peer.sidechannel) {
            this.peer.sidechannel.broadcast(
                this.cortexChannels[0] || 'cortex-crypto',
                JSON.stringify(response)
            );
        }
        console.log('[sync] responded to sync request from ' + String(msg.peer_key).slice(0, 12) + '... — ' + memories.length + ' open memories');
    }

    /**
     * Handle a memory_sync_response — diff against local store and fetch missing open memories.
     */
    async _handleSyncResponse(msg, _connection) {
        // Ignore our own responses
        if (msg.peer_key === this.peerId) return;

        if (!Array.isArray(msg.memories) || msg.memories.length === 0) return;

        const peerShort = String(msg.peer_key).slice(0, 12) + '...';
        let fetched = 0;

        for (const mem of msg.memories) {
            if (!mem.memory_id) continue;
            // Only sync open/public memories
            if (mem.access && mem.access !== 'open' && mem.access !== 'public') continue;

            const filePath = path.join(this.dataDir, mem.memory_id + '.json');
            if (fs.existsSync(filePath)) continue; // Already have it

            // Fetch via existing relay mechanism
            const channel = mem.cortex || this.cortexChannels[0] || 'cortex-crypto';
            try {
                await this._syncFetchMemory(channel, mem.memory_id);
                fetched++;
            } catch (err) {
                console.warn('[sync] failed to fetch ' + mem.memory_id + ': ' + (err?.message ?? err));
            }
        }

        console.log('[sync] ' + fetched + ' memories synced from ' + peerShort);
    }

    /**
     * Fetch a single memory via P2P relay for bulk sync purposes.
     * Returns a promise that resolves when the memory is saved locally.
     */
    _syncFetchMemory(channel, memory_id) {
        return new Promise((resolve, reject) => {
            const request_id = crypto.randomBytes(16).toString('hex');

            const timer = setTimeout(() => {
                this.pendingRelays.delete(request_id);
                reject(new Error('relay timeout'));
            }, this.relayTimeoutMs);

            this.pendingRelays.set(request_id, {
                replyFn: (dataStr) => {
                    try {
                        const parsed = JSON.parse(dataStr);
                        if (parsed.found && parsed.data) {
                            // Save locally like a memory_write
                            const filePath = path.join(this.dataDir, memory_id + '.json');
                            const stored = {
                                memory_id,
                                cortex: parsed.cortex || channel,
                                data: parsed.data,
                                author: parsed.author || null,
                                ts: parsed.ts || Date.now(),
                                sig: parsed.sig || null,
                                access: 'open',
                                content_hash: parsed.content_hash || null,
                                stored_at: Date.now(),
                            };
                            fs.writeFileSync(filePath, JSON.stringify(stored, null, 2));
                            console.log('[sync] fetched missing memory: ' + memory_id);
                            resolve();
                        } else {
                            reject(new Error('not found'));
                        }
                    } catch (err) {
                        reject(err);
                    }
                },
                channel,
                timer,
                memory_id,
            });

            // Broadcast relay request
            const relayMsg = {
                v: 1,
                type: 'memory_read_relay',
                memory_id,
                request_id,
                requester_id: this.peerId,
                is_sync: true,
            };
            if (this.peer.sidechannel) {
                this.peer.sidechannel.broadcast(channel, JSON.stringify(relayMsg));
            }
        });
    }

    /**
     * Handle a peer_announce message — update the presence map.
     */
    _handlePeerAnnounce(msg, _connection) {
        const peerKey = msg.peer_key;
        if (!peerKey || typeof peerKey !== 'string') return;
        // Don't track self
        if (peerKey === this.peerId) return;

        this.presenceMap.set(peerKey, {
            address: msg.address || null,
            nick: msg.nick || null,
            capabilities: Array.isArray(msg.capabilities) ? msg.capabilities : [],
            lastSeen: Date.now(),
            ts: msg.ts || Date.now(),
        });
        const nick = msg.nick ? ` (${msg.nick})` : '';
        console.log('[presence] ' + peerKey.slice(0, 12) + '...' + nick);
    }

    /**
     * Get online peers (seen within the last 5 minutes).
     * @returns {Array<{peerKey, address, nick, capabilities, lastSeen}>}
     */
    getOnlinePeers() {
        const cutoff = Date.now() - 5 * 60 * 1000;
        const peers = [];
        for (const [peerKey, entry] of this.presenceMap) {
            if (entry.lastSeen >= cutoff) {
                peers.push({ peerKey, ...entry });
            }
        }
        peers.sort((a, b) => b.lastSeen - a.lastSeen);
        return peers;
    }
}

export default MemoryIndexer;
