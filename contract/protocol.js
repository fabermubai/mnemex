import {Protocol} from "trac-peer";
import { bufferToBigInt, bigIntToDecimalString, decimalStringToBigInt } from "trac-msb/src/utils/amountSerialization.js";
import { sendTNK } from "../src/fees/tnk-transfer.js";
import b4a from "b4a";
import PeerWallet from "trac-wallet";
import crypto from "crypto";
import fs from "fs";
import { saveConfig } from "../lib/config.js";

const stableStringify = (value) => {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const normalizeInvitePayload = (payload) => {
    return {
        channel: String(payload?.channel ?? ''),
        inviteePubKey: String(payload?.inviteePubKey ?? '').trim().toLowerCase(),
        inviterPubKey: String(payload?.inviterPubKey ?? '').trim().toLowerCase(),
        inviterAddress: payload?.inviterAddress ?? null,
        issuedAt: Number(payload?.issuedAt),
        expiresAt: Number(payload?.expiresAt),
        nonce: String(payload?.nonce ?? ''),
        version: Number.isFinite(payload?.version) ? Number(payload.version) : 1,
    };
};

const normalizeWelcomePayload = (payload) => {
    return {
        channel: String(payload?.channel ?? ''),
        ownerPubKey: String(payload?.ownerPubKey ?? '').trim().toLowerCase(),
        text: String(payload?.text ?? ''),
        issuedAt: Number(payload?.issuedAt),
        version: Number.isFinite(payload?.version) ? Number(payload.version) : 1,
    };
};

const parseInviteArg = (raw) => {
    if (!raw) return null;
    let text = String(raw || '').trim();
    if (!text) return null;
    if (text.startsWith('@')) {
        try {
            text = fs.readFileSync(text.slice(1), 'utf8').trim();
        } catch (_e) {
            return null;
        }
    }
    if (text.startsWith('b64:')) text = text.slice(4);
    if (text.startsWith('{')) {
        try {
            return JSON.parse(text);
        } catch (_e) {}
    }
    try {
        const decoded = b4a.toString(b4a.from(text, 'base64'));
        return JSON.parse(decoded);
    } catch (_e) {}
    return null;
};

const parseWelcomeArg = (raw) => {
    if (!raw) return null;
    let text = String(raw || '').trim();
    if (!text) return null;
    if (text.startsWith('@')) {
        try {
            text = fs.readFileSync(text.slice(1), 'utf8').trim();
        } catch (_e) {
            return null;
        }
    }
    if (text.startsWith('b64:')) text = text.slice(4);
    if (text.startsWith('{')) {
        try {
            return JSON.parse(text);
        } catch (_e) {}
    }
    try {
        const decoded = b4a.toString(b4a.from(text, 'base64'));
        return JSON.parse(decoded);
    } catch (_e) {}
    return null;
};

/**
 * Format a bigint-string amount (smallest TNK unit) to human-readable decimal.
 * E.g. "30000000000000000" → "0.03 TNK", "21000000000000000" → "0.021 TNK"
 */
const _formatTNK = (amountStr) => {
    const decimals = 18;
    const s = String(amountStr).padStart(decimals + 1, '0');
    const intPart = s.slice(0, s.length - decimals) || '0';
    let fracPart = s.slice(s.length - decimals);
    // Trim trailing zeros but keep at least 1 digit
    fracPart = fracPart.replace(/0+$/, '') || '0';
    return intPart + '.' + fracPart + ' TNK';
};

class MnemexProtocol extends Protocol{

    /**
     * MnemexProtocol — command mapping, CLI, and TX entrypoints for the Mnemex memory protocol.
     *
     * Instances of this class do NOT run in contract context.
     *
     * @param peer
     * @param base
     * @param options
     */
    constructor(peer, base, options = {}) {
        super(peer, base, options);
    }

    /**
     * Extend the built-in API with Mnemex-specific functions.
     *
     * @returns {Promise<void>}
     */
    async extendApi(){
        // Mnemex API extensions will be added as needed
    }

    /**
     * Map incoming TX commands to contract functions.
     *
     * register_memory: TX command (requires MSB signature, costs 0.03 $TNK)
     * query_memory: also mappable via TX for simulation, but primarily used as local read
     *
     * Usage:
     *   /tx --command '{"op":"register_memory","memory_id":"...","cortex":"...","author":"...","access":"open","content_hash":"...","ts":123}'
     *   /tx --command '{"op":"query_memory","memory_id":"..."}'
     *
     * @param command
     * @returns {{type: string, value: *}|null}
     */
    mapTxCommand(command){
        const obj = { type : '', value : null };
        const json = this.safeJsonParse(command);

        if (json.op === 'register_memory') {
            obj.type = 'register_memory';
            obj.value = json;
            return obj;
        }

        // query_memory is read-only — handled directly in customCommand via getSigned().
        // Not mapped here because it does not need a TX (no state change, no MSB fee).

        if (json.op === 'record_fee') {
            obj.type = 'record_fee';
            obj.value = json;
            return obj;
        }

        if (json.op === 'register_stake') {
            obj.type = 'register_stake';
            obj.value = json;
            return obj;
        }

        if (json.op === 'slash_stake') {
            obj.type = 'slash_stake';
            obj.value = json;
            return obj;
        }

        if (json.op === 'release_stake') {
            obj.type = 'release_stake';
            obj.value = json;
            return obj;
        }

        if (json.op === 'register_skill') {
            obj.type = 'register_skill';
            obj.value = json;
            return obj;
        }

        if (json.op === 'update_skill') {
            obj.type = 'update_skill';
            obj.value = json;
            return obj;
        }

        if (json.op === 'record_skill_download') {
            obj.type = 'record_skill_download';
            obj.value = json;
            return obj;
        }

        if (json.op === 'register_cortex') {
            obj.type = 'register_cortex';
            obj.value = json;
            return obj;
        }

        return null;
    }

    /**
     * Print Mnemex-specific CLI commands in the terminal help.
     *
     * @returns {Promise<void>}
     */
    async printOptions(){
        console.log(' ');
        console.log('- Mnemex Network Commands:');
        console.log('- /peers');
        console.log('    Show online agents (presence heartbeat, last 5 minutes).');
        console.log('- /my_nick "<nick>"');
        console.log('    Change your nick (3-20 chars, alphanumeric/dashes/underscores). Takes effect immediately.');
        console.log(' ');
        console.log('- Mnemex Memory Commands:');
        console.log('- /register_memory --memory_id "<id>" --cortex "<name>" --content_hash "<sha256>" [--access "open"|"gated"] [--tags "tag1,tag2"] [--price <TNK>] [--ts <ms>]');
        console.log('    Register a memory entry on-chain (submits MSB TX, costs 0.03 $TNK). --price: gated only, in TNK (e.g. 0.5), default 0.03.');
        console.log('- /query_memory --memory_id "<id>"');
        console.log('    Look up a memory entry locally (no TX, no fee).');
        console.log('- /memory_read --memory_id "<id>" [--cortex "<channel>"]');
        console.log('    Read memory data (local or P2P relay). Prompts for TNK payment if gated.');
        console.log('- /query_by_tag --tag "<tag>"');
        console.log('    List all memory IDs indexed under a tag (range scan, no fee).');
        console.log('- /list_by_cortex --cortex "<name>"');
        console.log('    List all memory IDs indexed under a cortex (range scan, no fee).');
        console.log('- /list_memories [--author "<pubkey>"] [--cortex "<name>"] --memory_id "<id>"');
        console.log('    Check memory existence in author/cortex indexes.');
        console.log(' ');
        console.log('- Mnemex Fee Commands:');
        console.log('- /record_fee --memory_id "<id>" --operation "read_open"|"read_gated"|"skill_download" --payer "<pubkey>" --payment_txid "<hash>" --amount "<bigint>"');
        console.log('    Record a fee payment and split revenue (submits MSB TX).');
        console.log('- /get_balance --address "<pubkey>"');
        console.log('    Check earnings for an address (local read).');
        console.log('- /get_stats');
        console.log('    Show protocol-wide fee statistics (local read).');
        console.log('- /mnemex_stats');
        console.log('    Show full Mnemex network stats: memories, skills, downloads, fees (local read).');
        console.log('- /list_fees [--limit <n>]');
        console.log('    Show recent fee records from state (default last 10).');
        console.log(' ');
        console.log('- Mnemex Staking Commands:');
        console.log('- /register_stake --memory_id "<id>" --stake_txid "<hash>" --stake_amount "<bigint>"');
        console.log('    Stake TNK on a memory you authored (submits MSB TX).');
        console.log('- /slash_stake --memory_id "<id>" --reason "<text>"');
        console.log('    Slash a stake for bad data — admin only (submits MSB TX).');
        console.log('- /release_stake --memory_id "<id>"');
        console.log('    Release a stake after verification — admin only (submits MSB TX).');
        console.log('- /list_stakes [--address "<pubkey>"]');
        console.log('    Show stakes for an address (defaults to current peer).');
        console.log(' ');
        console.log('- Mnemex Skill Commands:');
        console.log('- /register_skill --skill_id "<id>" --name "<name>" --description "<desc>" --cortex "<cortex>" --inputs "<json>" --outputs "<json>" --content_hash "<sha256>" --price "<bigint>" --version "<ver>"');
        console.log('    Publish a new Skill with descriptor (inputs/outputs/content) to the registry (submits MSB TX).');
        console.log('- /update_skill --skill_id "<hash>" [--description "<desc>"] [--price "<bigint>"] [--version "<ver>"] [--status "active"|"deprecated"]');
        console.log('    Update metadata of a Skill you authored (submits MSB TX).');
        console.log('- /record_skill_download --skill_id "<hash>" --buyer "<pubkey>" --payment_txid "<hash>" --amount "<bigint>"');
        console.log('    Record a completed skill download with fee split (submits MSB TX).');
        console.log('- /query_skill --skill_id "<hash>"');
        console.log('    Look up a skill by ID (local read).');
        console.log('- /list_skills');
        console.log('    List recent skills in the registry (local read, last 10).');
        console.log('- /list_skills_by_cortex --cortex "<name>"');
        console.log('    List skills registered under a cortex (local read).');
        console.log(' ');
        console.log('- Mnemex Cortex Commands:');
        console.log('- /register_cortex --name "<name>" --description "<desc>"');
        console.log('    Register a new cortex channel — admin only (submits MSB TX).');
        console.log('- /list_cortex');
        console.log('    List all registered cortex channels (local read).');
        console.log(' ');
        console.log('- System Commands:');
        console.log('- /get --key "<key>" [--confirmed true|false] | reads subnet state key (confirmed defaults to true).');
        console.log('- /my_address | prints your bech32m trac address (ready to copy).');
        console.log('- /msb_transfer --to "<trac1...>" --amount "<TNK>" | send TNK to an address via MSB.');
        console.log('- /msb | prints MSB txv + lengths (local MSB node view).');
        console.log('- /print --text "<message>" | print text to terminal.');
        console.log('- /sc_join --channel "<name>" | join an ephemeral sidechannel.');
        console.log('- /sc_open --channel "<name>" [--via "<channel>"] [--invite <json|b64|@file>] [--welcome <json|b64|@file>] | request others to open a sidechannel.');
        console.log('- /sc_send --channel "<name>" --message "<text>" [--invite <json|b64|@file>] | send message over sidechannel.');
        console.log('- /sc_invite --channel "<name>" --pubkey "<peer-pubkey-hex>" [--ttl <sec>] [--welcome <json|b64|@file>] | create a signed invite.');
        console.log('- /sc_welcome --channel "<name>" --text "<message>" | create a signed welcome.');
        console.log('- /sc_stats | show sidechannel channels + connection count.');
    }

    /**
     * Mnemex CLI commands + all system commands from Intercom.
     *
     * @param input
     * @returns {Promise<void>}
     */
    async customCommand(input) {
        await super.tokenizeInput(input);

        // ==================== Mnemex Commands ====================

        if (this.input.startsWith("/peers")) {
            const indexer = this.peer._memoryIndexer;
            if (!indexer) {
                console.log('MemoryIndexer not available.');
                return;
            }
            const onlinePeers = indexer.getOnlinePeers();
            const selfKey = this.peer.wallet.publicKey;
            const selfNick = this.peer._mnemexConfig?.nick || null;
            console.log('');
            console.log('Online Agents (' + (onlinePeers.length + 1) + '):');
            console.log('  ' + selfKey.slice(0, 12) + '...  ' + (this.peer.wallet.address || '?') + '  ' + (selfNick ? selfNick + '  ' : '') + '(self)');
            if (onlinePeers.length === 0) {
                console.log('  (no other agents seen in the last 5 minutes)');
            } else {
                for (const p of onlinePeers) {
                    const ago = Math.round((Date.now() - p.lastSeen) / 1000);
                    const agoStr = ago < 60 ? ago + 's ago' : Math.round(ago / 60) + 'min ago';
                    const nick = p.nick ? p.nick + '  ' : '';
                    const caps = p.capabilities.length > 0 ? '[' + p.capabilities.join(', ') + ']  ' : '';
                    console.log('  ' + p.peerKey.slice(0, 12) + '...  ' + (p.address || '?') + '  ' + nick + caps + 'last seen: ' + agoStr);
                }
            }
            console.log('');
            return;
        }

        if (this.input.startsWith("/my_nick")) {
            const raw = input.replace(/^\/my_nick\s*/, '').replace(/^"(.*)"$/, '$1').trim();
            if (!raw) {
                console.log('Usage: /my_nick "<nick>" (3-20 chars, alphanumeric + dashes/underscores)');
                return;
            }
            if (!/^[a-zA-Z0-9_-]{3,20}$/.test(raw)) {
                console.log('Invalid nick. Use 3-20 alphanumeric characters, dashes, or underscores.');
                return;
            }
            const storePath = this.peer._peerStorePath;
            if (!storePath) {
                console.log('Error: peer store path not available.');
                return;
            }
            saveConfig(storePath, { nick: raw });
            this.peer._mnemexConfig.nick = raw;
            console.log('✓ Nick updated: ' + raw + ' (restart not required)');
            return;
        }

        if (this.input.startsWith("/register_memory")) {
            const args = this.parseArgs(input);
            const memoryId = args.memory_id || args.id;
            const cortex = args.cortex;
            const access = args.access || 'open';
            const contentHash = args.content_hash || args.hash;
            const tags = args.tags || '';
            const priceRaw = args.price;
            const tsRaw = args.ts;
            if (!memoryId || !cortex || !contentHash) {
                console.log('Usage: /register_memory --memory_id "<id>" --cortex "<name>" --content_hash "<sha256>" [--access "open"|"gated"] [--tags "tag1,tag2"] [--price <TNK>] [--ts <ms>]');
                return;
            }
            if (access !== 'open' && access !== 'gated') {
                console.log('Error: --access must be "open" or "gated".');
                return;
            }
            if (contentHash.length !== 64) {
                console.log('Error: --content_hash must be a 64-char hex SHA256 hash.');
                return;
            }
            const author = this.peer.wallet.publicKey;
            const ts = tsRaw ? Number(tsRaw) : Date.now();
            const txPayload = {
                op: 'register_memory',
                memory_id: String(memoryId),
                cortex: String(cortex),
                author: String(author),
                access: String(access),
                content_hash: String(contentHash),
                ts: ts
            };
            if (tags) txPayload.tags = String(tags);
            if (access === 'gated' && priceRaw) {
                const priceTNK = parseFloat(priceRaw);
                if (isNaN(priceTNK) || priceTNK < 0) {
                    console.log('Error: --price must be a positive number in TNK (e.g. 0.5).');
                    return;
                }
                txPayload.price = Math.round(priceTNK * 1e18).toString();
            }
            const command = this.safeJsonStringify(txPayload);
            console.log('Submitting register_memory TX...');
            console.log('Run: /tx --command \'' + command + '\'');
            console.log('Or simulate: /tx --command \'' + command + '\' --sim 1');
            return;
        }

        if (this.input.startsWith("/query_by_tag")) {
            const args = this.parseArgs(input);
            const tag = args.tag;
            if (!tag) {
                console.log('Usage: /query_by_tag --tag "<tag>"');
                return;
            }
            const tagKey = tag.trim().toLowerCase();
            const prefix = 'mem_by_tag/' + tagKey + '/';
            const results = [];
            const view = this.peer.base.view;
            const stream = view.createReadStream({ gte: prefix, lt: prefix.slice(0, -1) + '0' });
            for await (const entry of stream) {
                const key = typeof entry.key === 'string' ? entry.key
                    : Buffer.isBuffer(entry.key) ? entry.key.toString('utf8')
                    : String(entry.key);
                const memId = key.slice(prefix.length);
                results.push(memId);
            }
            console.log('query_by_tag "' + tagKey + '": ' + results.length + ' memories');
            for (const id of results) {
                const mem = await this.getSigned('mem/' + id);
                console.log('  [' + id + ']', mem ? JSON.stringify(mem) : '(metadata missing)');
            }
            return;
        }

        if (this.input.startsWith("/query_memory")) {
            const args = this.parseArgs(input);
            const memoryId = args.memory_id || args.id;
            if (!memoryId) {
                console.log('Usage: /query_memory --memory_id "<id>"');
                return;
            }
            const memory = await this.getSigned('mem/' + memoryId);
            console.log('query_memory', memoryId + ':', memory);
            return;
        }

        if (this.input.startsWith("/memory_read")) {
            const args = this.parseArgs(input);
            const memoryId = args.memory_id || args.id;
            const cortex = args.cortex || 'cortex-crypto';
            if (!memoryId) {
                console.log('Usage: /memory_read --memory_id "<id>" [--cortex "<channel>"]');
                return;
            }
            const indexer = this.peer._memoryIndexer;
            if (!indexer) {
                console.log('Error: MemoryIndexer not available.');
                return;
            }
            const rawMsb = this.peer._msb;
            const rl = this.peer._rl;

            // Use a Promise to capture the async replyFn callback
            const response = await new Promise((resolve) => {
                indexer._handleMemoryRead(cortex, {
                    v: 1,
                    type: 'memory_read',
                    memory_id: memoryId,
                    payer: this.peer.wallet.publicKey,
                }, (data) => resolve(JSON.parse(data)));
            });

            // Case 1: data found (no payment needed or payment not required)
            if (response.found) {
                console.log('');
                console.log('Memory:', memoryId);
                console.log('Cortex:', response.cortex || cortex);
                console.log('Author:', response.author || 'unknown');
                console.log('Data:', JSON.stringify(response.data, null, 2));

                // Verify content integrity
                if (response.content_hash && response.data !== undefined) {
                    const recomputedHash = crypto.createHash('sha256')
                        .update(JSON.stringify(response.data))
                        .digest('hex');
                    if (recomputedHash === response.content_hash) {
                        console.log('Hash: verified — content integrity confirmed');
                    } else {
                        console.log('Hash: MISMATCH — content may have been tampered!');
                        console.log('   Expected:', response.content_hash);
                        console.log('   Got     :', recomputedHash);
                    }
                }
                return;
            }

            // Case 2: payment required
            if (response.type === 'payment_required') {
                console.log('');
                console.log('Payment required for memory:', memoryId);
                console.log('  Total fee:      ', _formatTNK(response.amount));
                console.log('  Creator share:   ', _formatTNK(response.creator_share));
                console.log('  Node share:      ', _formatTNK(response.node_share));
                console.log('  Pay to creator:  ', response.pay_to_creator);
                console.log('  Pay to node:     ', response.pay_to_node);
                console.log('');

                if (!rawMsb) {
                    console.log('Error: MSB not available — cannot send payment.');
                    return;
                }
                if (!rl) {
                    console.log('Error: readline not available — cannot prompt for confirmation.');
                    return;
                }

                // Interactive confirmation
                const answer = await new Promise((resolve) => {
                    rl.question('Pay ' + _formatTNK(response.amount) + ' to read this memory? (y/N) ', (ans) => {
                        resolve(ans.trim().toLowerCase());
                    });
                });

                if (answer !== 'y' && answer !== 'yes') {
                    console.log('Payment cancelled.');
                    return;
                }

                // Send creator payment
                console.log('Sending', _formatTNK(response.creator_share), 'to creator...');
                const peerWallet = this.peer.wallet;
                const creatorResult = await sendTNK(rawMsb, response.pay_to_creator, response.creator_share, peerWallet);
                if (!creatorResult.success) {
                    console.log('Error: creator payment failed —', creatorResult.error);
                    return;
                }
                console.log('Creator payment sent. TxHash:', creatorResult.txHash);

                // Send node payment
                console.log('Sending', _formatTNK(response.node_share), 'to node...');
                const nodeResult = await sendTNK(rawMsb, response.pay_to_node, response.node_share, peerWallet);
                if (!nodeResult.success) {
                    console.log('Error: node payment failed —', nodeResult.error);
                    console.log('Warning: creator payment was already sent (txid:', creatorResult.txHash + ')');
                    return;
                }
                console.log('Node payment sent. TxHash:', nodeResult.txHash);

                // Retry with payment txids
                console.log('Retrying memory_read with payment proof...');
                const retryResponse = await new Promise((resolve) => {
                    indexer._handleMemoryRead(cortex, {
                        v: 1,
                        type: 'memory_read',
                        memory_id: memoryId,
                        payment_txid_creator: creatorResult.txHash,
                        payment_txid_node: nodeResult.txHash,
                        payer: this.peer.wallet.publicKey,
                    }, (data) => resolve(JSON.parse(data)));
                });

                if (retryResponse.found) {
                    console.log('');
                    console.log('Memory:', memoryId);
                    console.log('Cortex:', retryResponse.cortex || cortex);
                    console.log('Author:', retryResponse.author || 'unknown');
                    console.log('Data:', JSON.stringify(retryResponse.data, null, 2));
                } else if (retryResponse.type === 'payment_not_confirmed') {
                    console.log('Payment not yet confirmed on MSB (txid:', retryResponse.payment_txid + '). Try again shortly.');
                } else {
                    console.log('Memory not found after payment. Response:', JSON.stringify(retryResponse));
                }
                return;
            }

            // Case 3: not found
            console.log('Memory not found:', memoryId);
            return;
        }

        if (this.input.startsWith("/list_by_cortex")) {
            const args = this.parseArgs(input);
            const cortex = args.cortex;
            if (!cortex) {
                console.log('Usage: /list_by_cortex --cortex "<name>"');
                return;
            }
            const prefix = 'mem_by_cortex/' + cortex + '/';
            const results = [];
            const view = this.peer.base.view;
            const stream = view.createReadStream({ gte: prefix, lt: prefix.slice(0, -1) + '0' });
            for await (const entry of stream) {
                const key = typeof entry.key === 'string' ? entry.key
                    : Buffer.isBuffer(entry.key) ? entry.key.toString('utf8')
                    : String(entry.key);
                const memId = key.slice(prefix.length);
                results.push(memId);
            }
            console.log('list_by_cortex "' + cortex + '": ' + results.length + ' memories');
            for (const id of results) {
                const mem = await this.getSigned('mem/' + id);
                console.log('  [' + id + ']', mem ? JSON.stringify(mem) : '(metadata missing)');
            }
            return;
        }

        if (this.input.startsWith("/list_memories")) {
            const args = this.parseArgs(input);
            const author = args.author;
            const cortex = args.cortex;
            const memoryId = args.memory_id || args.id;
            if (!memoryId) {
                console.log('Usage: /list_memories --memory_id "<id>" [--author "<pubkey>"] [--cortex "<name>"]');
                console.log('Checks if a memory exists in the specified index.');
                return;
            }
            if (author) {
                const exists = await this.getSigned('mem_by_author/' + author + '/' + memoryId);
                console.log('mem_by_author/' + author + '/' + memoryId + ':', exists);
            }
            if (cortex) {
                const exists = await this.getSigned('mem_by_cortex/' + cortex + '/' + memoryId);
                console.log('mem_by_cortex/' + cortex + '/' + memoryId + ':', exists);
            }
            if (!author && !cortex) {
                const memory = await this.getSigned('mem/' + memoryId);
                console.log('mem/' + memoryId + ':', memory);
            }
            return;
        }

        // ==================== Mnemex Fee Commands ====================

        if (this.input.startsWith("/record_fee")) {
            const args = this.parseArgs(input);
            const memoryId = args.memory_id || args.id;
            const operation = args.operation || args.op_type;
            const payer = args.payer;
            const paymentTxid = args.payment_txid || args.txid;
            const amount = args.amount;
            const tsRaw = args.ts;
            if (!memoryId || !operation || !payer || !paymentTxid || !amount) {
                console.log('Usage: /record_fee --memory_id "<id>" --operation "read_open"|"read_gated"|"skill_download" --payer "<pubkey>" --payment_txid "<hash>" --amount "<bigint>"');
                return;
            }
            if (operation !== 'read_open' && operation !== 'read_gated' && operation !== 'skill_download') {
                console.log('Error: --operation must be "read_open", "read_gated", or "skill_download".');
                return;
            }
            const ts = tsRaw ? Number(tsRaw) : Date.now();
            const servedBy = args.served_by || args.node;
            const feeObj = {
                op: 'record_fee',
                memory_id: String(memoryId),
                operation: String(operation),
                payer: String(payer),
                payment_txid: String(paymentTxid),
                amount: String(amount),
                ts: ts
            };
            if (servedBy) feeObj.served_by = String(servedBy);
            const command = this.safeJsonStringify(feeObj);
            console.log('Submitting record_fee TX...');
            console.log('Run: /tx --command \'' + command + '\'');
            return;
        }

        if (this.input.startsWith("/my_address")) {
            console.log('Peer pubkey (hex):', this.peer.wallet.publicKey);
            console.log('Peer trac address:', this.peer.wallet.address);
            return;
        }

        if (this.input.startsWith("/get_balance")) {
            const args = this.parseArgs(input);
            const address = args.address || args.addr;
            if (!address) {
                console.log('Usage: /get_balance --address "<pubkey>"');
                return;
            }
            const balance = await this.getSigned('balance/' + address);
            console.log('balance/' + address + ':', balance !== null ? balance : '0');
            return;
        }

        if (this.input.startsWith("/mnemex_stats")) {
            const totalFees = await this.getSigned('stats/total_fees');
            const feeCount = await this.getSigned('stats/fee_count');
            const totalMemories = await this.getSigned('stats/total_memories');
            const totalSkills = await this.getSigned('stats/total_skills');
            const totalDownloads = await this.getSigned('stats/total_downloads');
            console.log('Mnemex Network Stats:');
            console.log('  Memories:  ' + (totalMemories !== null ? totalMemories : 0));
            console.log('  Skills:    ' + (totalSkills !== null ? totalSkills : 0));
            console.log('  Downloads: ' + (totalDownloads !== null ? totalDownloads : 0));
            console.log('  Fees:      ' + (feeCount !== null ? feeCount : 0) + ' (' + (totalFees !== null ? totalFees : '0') + ' TNK)');
            return;
        }

        if (this.input.startsWith("/get_stats")) {
            const totalFees = await this.getSigned('stats/total_fees');
            const feeCount = await this.getSigned('stats/fee_count');
            console.log('stats:', {
                total_fees: totalFees !== null ? totalFees : '0',
                fee_count: feeCount !== null ? feeCount : 0
            });
            return;
        }

        if (this.input.startsWith("/list_fees")) {
            const args = this.parseArgs(input);
            const limit = args.limit ? Number(args.limit) : 10;
            const results = [];
            try {
                const stream = this.peer.base.view.createReadStream({ gte: 'fee/', lt: 'fee0', limit: limit });
                for await (const entry of stream) {
                    const key = typeof entry.key === 'string' ? entry.key : b4a.toString(entry.key, 'utf8');
                    results.push({ key, value: entry.value });
                }
            } catch (_e) {
                console.log('Could not read fee records (view not ready).');
                return;
            }
            if (results.length === 0) {
                console.log('No fee records found.');
            } else {
                console.log('Fee records (' + results.length + '):');
                for (const r of results) {
                    console.log(' ', r.key, '→', r.value);
                }
            }
            return;
        }

        // ==================== Mnemex Staking Commands ====================

        if (this.input.startsWith("/register_stake")) {
            const args = this.parseArgs(input);
            const memoryId = args.memory_id || args.id;
            const stakeTxid = args.stake_txid || args.txid;
            const stakeAmount = args.stake_amount || args.amount;
            if (!memoryId || !stakeTxid || !stakeAmount) {
                console.log('Usage: /register_stake --memory_id "<id>" --stake_txid "<hash>" --stake_amount "<bigint>"');
                return;
            }
            const command = this.safeJsonStringify({
                op: 'register_stake',
                memory_id: String(memoryId),
                stake_txid: String(stakeTxid),
                stake_amount: String(stakeAmount)
            });
            console.log('Submitting register_stake TX...');
            console.log('Run: /tx --command \'' + command + '\'');
            return;
        }

        if (this.input.startsWith("/slash_stake")) {
            const args = this.parseArgs(input);
            const memoryId = args.memory_id || args.id;
            const reason = args.reason;
            if (!memoryId || !reason) {
                console.log('Usage: /slash_stake --memory_id "<id>" --reason "<text>"');
                return;
            }
            const command = this.safeJsonStringify({
                op: 'slash_stake',
                memory_id: String(memoryId),
                reason: String(reason)
            });
            console.log('Submitting slash_stake TX...');
            console.log('Run: /tx --command \'' + command + '\'');
            return;
        }

        if (this.input.startsWith("/release_stake")) {
            const args = this.parseArgs(input);
            const memoryId = args.memory_id || args.id;
            if (!memoryId) {
                console.log('Usage: /release_stake --memory_id "<id>"');
                return;
            }
            const command = this.safeJsonStringify({
                op: 'release_stake',
                memory_id: String(memoryId)
            });
            console.log('Submitting release_stake TX...');
            console.log('Run: /tx --command \'' + command + '\'');
            return;
        }

        if (this.input.startsWith("/list_stakes")) {
            const args = this.parseArgs(input);
            const address = args.address || args.addr || this.peer.wallet.publicKey;
            const totalStaked = await this.getSigned('staked_by/' + address);
            console.log('Total staked by', address + ':', totalStaked !== null ? totalStaked : '0');
            const results = [];
            try {
                const stream = this.peer.base.view.createReadStream({ gte: 'stake/', lt: 'stake0' });
                for await (const entry of stream) {
                    const key = typeof entry.key === 'string' ? entry.key : b4a.toString(entry.key, 'utf8');
                    if (entry.value && entry.value.author === address) {
                        results.push({ key, value: entry.value });
                    }
                }
            } catch (_e) {
                console.log('Could not read stake records (view not ready).');
                return;
            }
            if (results.length === 0) {
                console.log('No stake records found for this address.');
            } else {
                console.log('Stakes (' + results.length + '):');
                for (const r of results) {
                    console.log(' ', r.key, '→', r.value);
                }
            }
            return;
        }

        // ==================== Mnemex Skill Commands ====================

        if (this.input.startsWith("/register_skill")) {
            const args = this.parseArgs(input);
            const skillId = args.skill_id || args.id;
            const name = args.name;
            const description = args.description || args.desc;
            const cortex = args.cortex;
            const inputs = args.inputs;
            const outputs = args.outputs;
            const contentHash = args.content_hash || args.hash;
            const price = args.price;
            const version = args.version || args.ver;
            if (!skillId || !name || !description || !cortex || !inputs || !outputs || !contentHash || !price || !version) {
                console.log('Usage: /register_skill --skill_id "<id>" --name "<name>" --description "<desc>" --cortex "<cortex>" --inputs "<json>" --outputs "<json>" --content_hash "<sha256>" --price "<bigint>" --version "<ver>"');
                return;
            }
            if (contentHash.length !== 64) {
                console.log('Error: --content_hash must be a 64-char hex SHA256 hash.');
                return;
            }
            const command = this.safeJsonStringify({
                op: 'register_skill',
                skill_id: String(skillId),
                name: String(name),
                description: String(description),
                cortex: String(cortex),
                inputs: String(inputs),
                outputs: String(outputs),
                content_hash: String(contentHash),
                price: String(price),
                version: String(version)
            });
            console.log('Submitting register_skill TX...');
            console.log('Run: /tx --command \'' + command + '\'');
            return;
        }

        if (this.input.startsWith("/update_skill")) {
            const args = this.parseArgs(input);
            const skillId = args.skill_id || args.id;
            if (!skillId) {
                console.log('Usage: /update_skill --skill_id "<hash>" [--description "<desc>"] [--price "<bigint>"] [--version "<ver>"] [--status "active"|"deprecated"]');
                return;
            }
            const payload = { op: 'update_skill', skill_id: String(skillId) };
            if (args.description || args.desc) payload.description = String(args.description || args.desc);
            if (args.price) payload.price = String(args.price);
            if (args.version || args.ver) payload.version = String(args.version || args.ver);
            if (args.status) {
                if (args.status !== 'active' && args.status !== 'deprecated') {
                    console.log('Error: --status must be "active" or "deprecated".');
                    return;
                }
                payload.status = String(args.status);
            }
            const command = this.safeJsonStringify(payload);
            console.log('Submitting update_skill TX...');
            console.log('Run: /tx --command \'' + command + '\'');
            return;
        }

        if (this.input.startsWith("/record_skill_download")) {
            const args = this.parseArgs(input);
            const skillId = args.skill_id || args.id;
            const buyer = args.buyer;
            const paymentTxid = args.payment_txid || args.txid;
            const amount = args.amount;
            if (!skillId || !buyer || !paymentTxid || !amount) {
                console.log('Usage: /record_skill_download --skill_id "<hash>" --buyer "<pubkey>" --payment_txid "<hash>" --amount "<bigint>"');
                return;
            }
            const command = this.safeJsonStringify({
                op: 'record_skill_download',
                skill_id: String(skillId),
                buyer: String(buyer),
                payment_txid: String(paymentTxid),
                amount: String(amount)
            });
            console.log('Submitting record_skill_download TX...');
            console.log('Run: /tx --command \'' + command + '\'');
            return;
        }

        if (this.input.startsWith("/query_skill")) {
            const args = this.parseArgs(input);
            const skillId = args.skill_id || args.id;
            if (!skillId) {
                console.log('Usage: /query_skill --skill_id "<id>"');
                return;
            }
            const skill = await this.getSigned('skill/' + skillId);
            if (!skill) {
                console.log('query_skill', skillId + ': null');
                return;
            }
            console.log('query_skill', skillId + ':', JSON.stringify(skill));
            return;
        }

        if (this.input.startsWith("/list_skills_by_cortex")) {
            const args = this.parseArgs(input);
            const cortex = args.cortex;
            if (!cortex) {
                console.log('Usage: /list_skills_by_cortex --cortex "<name>"');
                return;
            }
            const results = [];
            try {
                const prefix = 'skill_by_cortex/' + cortex + '/';
                const stream = this.peer.base.view.createReadStream({ gte: prefix, lt: prefix + '\xff', limit: 50 });
                for await (const entry of stream) {
                    const key = typeof entry.key === 'string' ? entry.key : b4a.toString(entry.key, 'utf8');
                    const skillId = key.slice(prefix.length);
                    const skill = await this.getSigned('skill/' + skillId);
                    if (skill) results.push({ skill_id: skillId, ...skill });
                }
            } catch (_e) {
                console.log('Could not read skill records (view not ready).');
                return;
            }
            if (results.length === 0) {
                console.log('No skills found for cortex:', cortex);
            } else {
                console.log('Skills in cortex "' + cortex + '" (' + results.length + '):');
                for (const s of results) {
                    console.log('  [' + s.skill_id + '] ' + s.name + ' v' + s.version + ' — ' + s.description);
                    console.log('    price: ' + s.price + ' | downloads: ' + s.downloads + ' | status: ' + s.status);
                    if (s.inputs) console.log('    inputs: ' + s.inputs);
                    if (s.outputs) console.log('    outputs: ' + s.outputs);
                }
            }
            return;
        }

        if (this.input.startsWith("/list_skills")) {
            const results = [];
            try {
                const stream = this.peer.base.view.createReadStream({ gte: 'skill/', lt: 'skill0', limit: 20 });
                for await (const entry of stream) {
                    const key = typeof entry.key === 'string' ? entry.key : b4a.toString(entry.key, 'utf8');
                    if (key.startsWith('skill_by_') || key.startsWith('skill_download/')) continue;
                    const skillId = key.slice('skill/'.length);
                    results.push({ skill_id: skillId, ...entry.value });
                }
            } catch (_e) {
                console.log('Could not read skill records (view not ready).');
                return;
            }
            if (results.length === 0) {
                console.log('No skills registered.');
            } else {
                console.log('Skills (' + results.length + '):');
                for (const s of results) {
                    console.log('  [' + s.skill_id + '] ' + s.name + ' v' + s.version + ' — ' + s.description);
                    console.log('    cortex: ' + s.cortex + ' | price: ' + s.price + ' | downloads: ' + s.downloads + ' | status: ' + s.status);
                    if (s.inputs) console.log('    inputs: ' + s.inputs);
                    if (s.outputs) console.log('    outputs: ' + s.outputs);
                    if (s.content_hash) console.log('    content_hash: ' + s.content_hash);
                }
            }
            return;
        }

        // ==================== Mnemex Cortex Commands ====================

        if (this.input.startsWith("/register_cortex")) {
            const args = this.parseArgs(input);
            const name = args.name;
            const description = args.description || args.desc;
            if (!name || !description) {
                console.log('Usage: /register_cortex --name "<name>" --description "<desc>"');
                return;
            }
            const command = this.safeJsonStringify({
                op: 'register_cortex',
                cortex_name: String(name),
                description: String(description)
            });
            console.log('Submitting register_cortex TX...');
            console.log('Run: /tx --command \'' + command + '\'');
            return;
        }

        if (this.input.startsWith("/list_cortex")) {
            const results = [];
            try {
                const stream = this.peer.base.view.createReadStream({ gte: 'cortex/', lt: 'cortex0' });
                for await (const entry of stream) {
                    const key = typeof entry.key === 'string' ? entry.key : b4a.toString(entry.key, 'utf8');
                    results.push({ key, value: entry.value });
                }
            } catch (_e) {
                console.log('Could not read cortex records (view not ready).');
                return;
            }
            if (results.length === 0) {
                console.log('No cortex channels registered.');
            } else {
                console.log('Cortex channels (' + results.length + '):');
                for (const r of results) {
                    const c = r.value;
                    console.log(' ', r.key, '—', c.description, '(status:', c.status + ', created_by:', c.created_by + ')');
                }
            }
            return;
        }

        // ==================== System Commands (from Intercom) ====================

        if (this.input.startsWith("/get")) {
            const m = input.match(/(?:^|\s)--key(?:=|\s+)(\"[^\"]+\"|'[^']+'|\S+)/);
            const raw = m ? m[1].trim() : null;
            if (!raw) {
                console.log('Usage: /get --key "<hyperbee-key>" [--confirmed true|false] [--unconfirmed 1]');
                return;
            }
            const key = raw.replace(/^\"(.*)\"$/, "$1").replace(/^'(.*)'$/, "$1");
            const confirmedMatch = input.match(/(?:^|\s)--confirmed(?:=|\s+)(\S+)/);
            const unconfirmedMatch = input.match(/(?:^|\s)--unconfirmed(?:=|\s+)?(\S+)?/);
            const confirmed = unconfirmedMatch ? false : confirmedMatch ? confirmedMatch[1] === "true" || confirmedMatch[1] === "1" : true;
            const v = confirmed ? await this.getSigned(key) : await this.get(key);
            console.log(v);
            return;
        }
        if (this.input.startsWith("/msb_transfer")) {
            const args = this.parseArgs(input);
            const to = args.to || args.address;
            const amount = args.amount;
            if (!to || !amount) {
                console.log('Usage: /msb_transfer --to "<trac1...>" --amount "<TNK amount>"');
                return;
            }
            const rawMsb = this.peer._msb;
            if (!rawMsb) {
                console.log('Error: MSB instance not available.');
                return;
            }
            try {
                const amountBigint = String(decimalStringToBigInt(amount));
                console.log('Sending', amount, 'TNK to', to, '...');
                const result = await sendTNK(rawMsb, to, amountBigint, this.peer.wallet);
                if (result.success) {
                    console.log('Transfer sent. TxHash:', result.txHash);
                } else {
                    console.log('Transfer failed:', result.error);
                }
            } catch (err) {
                console.log('Transfer error:', err?.message ?? String(err));
            }
            return;
        }
        if (this.input.startsWith("/msb")) {
            const txv = await this.peer.msbClient.getTxvHex();
            const peerMsbAddress = this.peer.msbClient.pubKeyHexToAddress(this.peer.wallet.publicKey);
            const entry = await this.peer.msbClient.getNodeEntryUnsigned(peerMsbAddress);
            const balance = entry?.balance ? bigIntToDecimalString(bufferToBigInt(entry.balance)) : 0;
            const feeBuf = this.peer.msbClient.getFee();
            const fee = feeBuf ? bigIntToDecimalString(bufferToBigInt(feeBuf)) : 0;
            const validators = this.peer.msbClient.getConnectedValidatorsCount();
            console.log({
                networkId: this.peer.msbClient.networkId,
                msbBootstrap: this.peer.msbClient.bootstrapHex,
                txv,
                msbSignedLength: this.peer.msbClient.getSignedLength(),
                msbUnsignedLength: this.peer.msbClient.getUnsignedLength(),
                connectedValidators: validators,
                peerMsbAddress,
                peerMsbBalance: balance,
                msbFee: fee,
            });
            return;
        }
        if (this.input.startsWith("/sc_join")) {
            const args = this.parseArgs(input);
            const name = args.channel || args.ch || args.name;
            const inviteArg = args.invite || args.invite_b64 || args.invitebase64;
            const welcomeArg = args.welcome || args.welcome_b64 || args.welcomebase64;
            if (!name) {
                console.log('Usage: /sc_join --channel "<name>" [--invite <json|b64|@file>] [--welcome <json|b64|@file>]');
                return;
            }
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            let invite = null;
            if (inviteArg) {
                invite = parseInviteArg(inviteArg);
                if (!invite) {
                    console.log('Invalid invite. Pass JSON, base64, or @file.');
                    return;
                }
            }
            let welcome = null;
            if (welcomeArg) {
                welcome = parseWelcomeArg(welcomeArg);
                if (!welcome) {
                    console.log('Invalid welcome. Pass JSON, base64, or @file.');
                    return;
                }
            }
            if (invite || welcome) {
                this.peer.sidechannel.acceptInvite(String(name), invite, welcome);
            }
            const ok = await this.peer.sidechannel.addChannel(String(name));
            if (!ok) {
                console.log('Join denied (invite required or invalid).');
                return;
            }
            console.log('Joined sidechannel:', name);
            return;
        }
        if (this.input.startsWith("/sc_send")) {
            const args = this.parseArgs(input);
            const name = args.channel || args.ch || args.name;
            const message = args.message || args.msg;
            const inviteArg = args.invite || args.invite_b64 || args.invitebase64;
            const welcomeArg = args.welcome || args.welcome_b64 || args.welcomebase64;
            if (!name || message === undefined) {
                console.log('Usage: /sc_send --channel "<name>" --message "<text>" [--invite <json|b64|@file>] [--welcome <json|b64|@file>]');
                return;
            }
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            let invite = null;
            if (inviteArg) {
                invite = parseInviteArg(inviteArg);
                if (!invite) {
                    console.log('Invalid invite. Pass JSON, base64, or @file.');
                    return;
                }
            }
            let welcome = null;
            if (welcomeArg) {
                welcome = parseWelcomeArg(welcomeArg);
                if (!welcome) {
                    console.log('Invalid welcome. Pass JSON, base64, or @file.');
                    return;
                }
            }
            if (invite || welcome) {
                this.peer.sidechannel.acceptInvite(String(name), invite, welcome);
            }
            const ok = await this.peer.sidechannel.addChannel(String(name));
            if (!ok) {
                console.log('Send denied (invite required or invalid).');
                return;
            }
            const sent = this.peer.sidechannel.broadcast(String(name), message, invite ? { invite } : undefined);
            if (!sent) {
                console.log('Send denied (owner-only or invite required).');
            }
            return;
        }
        if (this.input.startsWith("/sc_open")) {
            const args = this.parseArgs(input);
            const name = args.channel || args.ch || args.name;
            const via = args.via || args.channel_via;
            const inviteArg = args.invite || args.invite_b64 || args.invitebase64;
            const welcomeArg = args.welcome || args.welcome_b64 || args.welcomebase64;
            if (!name) {
                console.log('Usage: /sc_open --channel "<name>" [--via "<channel>"] [--invite <json|b64|@file>] [--welcome <json|b64|@file>]');
                return;
            }
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            let invite = null;
            if (inviteArg) {
                invite = parseInviteArg(inviteArg);
                if (!invite) {
                    console.log('Invalid invite. Pass JSON, base64, or @file.');
                    return;
                }
            }
            let welcome = null;
            if (welcomeArg) {
                welcome = parseWelcomeArg(welcomeArg);
                if (!welcome) {
                    console.log('Invalid welcome. Pass JSON, base64, or @file.');
                    return;
                }
            } else if (typeof this.peer.sidechannel.getWelcome === 'function') {
                welcome = this.peer.sidechannel.getWelcome(String(name));
            }
            const viaChannel = via || this.peer.sidechannel.entryChannel || null;
            if (!viaChannel) {
                console.log('No entry channel configured. Pass --via "<channel>".');
                return;
            }
            this.peer.sidechannel.requestOpen(String(name), String(viaChannel), invite, welcome);
            console.log('Requested channel:', name);
            return;
        }
        if (this.input.startsWith("/sc_invite")) {
            const args = this.parseArgs(input);
            const channel = args.channel || args.ch || args.name;
            const invitee = args.pubkey || args.invitee || args.peer || args.key;
            const ttlRaw = args.ttl || args.ttl_sec || args.ttl_s;
            const welcomeArg = args.welcome || args.welcome_b64 || args.welcomebase64;
            if (!channel || !invitee) {
                console.log('Usage: /sc_invite --channel "<name>" --pubkey "<peer-pubkey-hex>" [--ttl <sec>] [--welcome <json|b64|@file>]');
                return;
            }
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            if (this.peer?.wallet?.ready) {
                try {
                    await this.peer.wallet.ready;
                } catch (_e) {}
            }
            const walletPub = this.peer?.wallet?.publicKey;
            const inviterPubKey = walletPub
                ? typeof walletPub === 'string'
                    ? walletPub.trim().toLowerCase()
                    : b4a.toString(walletPub, 'hex')
                : null;
            if (!inviterPubKey) {
                console.log('Wallet not ready; cannot sign invite.');
                return;
            }
            let inviterAddress = null;
            try {
                if (this.peer?.msbClient) {
                    inviterAddress = this.peer.msbClient.pubKeyHexToAddress(inviterPubKey);
                }
            } catch (_e) {}
            const issuedAt = Date.now();
            let ttlMs = null;
            if (ttlRaw !== undefined) {
                const ttlSec = Number.parseInt(String(ttlRaw), 10);
                ttlMs = Number.isFinite(ttlSec) ? Math.max(ttlSec, 0) * 1000 : null;
            } else if (Number.isFinite(this.peer.sidechannel.inviteTtlMs) && this.peer.sidechannel.inviteTtlMs > 0) {
                ttlMs = this.peer.sidechannel.inviteTtlMs;
            } else {
                ttlMs = 0;
            }
            if (!ttlMs || ttlMs <= 0) {
                console.log('Invite TTL is required. Pass --ttl <sec> or set --sidechannel-invite-ttl.');
                return;
            }
            const expiresAt = issuedAt + ttlMs;
            const payload = normalizeInvitePayload({
                channel: String(channel),
                inviteePubKey: String(invitee).trim().toLowerCase(),
                inviterPubKey,
                inviterAddress,
                issuedAt,
                expiresAt,
                nonce: Math.random().toString(36).slice(2, 10),
                version: 1,
            });
            const message = stableStringify(payload);
            const msgBuf = b4a.from(message);
            let sig = this.peer.wallet.sign(msgBuf);
            let sigHex = '';
            if (typeof sig === 'string') {
                sigHex = sig;
            } else if (sig && sig.length > 0) {
                sigHex = b4a.toString(sig, 'hex');
            }
            if (!sigHex) {
                const walletSecret = this.peer?.wallet?.secretKey;
                const secretBuf = walletSecret
                    ? b4a.isBuffer(walletSecret)
                        ? walletSecret
                        : typeof walletSecret === 'string'
                            ? b4a.from(walletSecret, 'hex')
                            : b4a.from(walletSecret)
                    : null;
                if (secretBuf) {
                    const sigBuf = PeerWallet.sign(msgBuf, secretBuf);
                    if (sigBuf && sigBuf.length > 0) {
                        sigHex = b4a.toString(sigBuf, 'hex');
                    }
                }
            }
            let welcome = null;
            if (welcomeArg) {
                welcome = parseWelcomeArg(welcomeArg);
                if (!welcome) {
                    console.log('Invalid welcome. Pass JSON, base64, or @file.');
                    return;
                }
            } else if (typeof this.peer.sidechannel.getWelcome === 'function') {
                welcome = this.peer.sidechannel.getWelcome(String(channel));
            }
            const inviteObj = { payload, sig: sigHex, welcome: welcome || undefined };
            const inviteJson = JSON.stringify(inviteObj);
            const inviteB64 = b4a.toString(b4a.from(inviteJson), 'base64');
            if (!sigHex) {
                console.log('Failed to sign invite; wallet secret key unavailable.');
                return;
            }
            console.log(inviteJson);
            console.log('invite_b64:', inviteB64);
            return;
        }
        if (this.input.startsWith("/sc_welcome")) {
            const args = this.parseArgs(input);
            const channel = args.channel || args.ch || args.name;
            const text = args.text || args.message || args.msg;
            if (!channel || text === undefined) {
                console.log('Usage: /sc_welcome --channel "<name>" --text "<message>"');
                return;
            }
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            if (this.peer?.wallet?.ready) {
                try {
                    await this.peer.wallet.ready;
                } catch (_e) {}
            }
            const walletPub = this.peer?.wallet?.publicKey;
            const ownerPubKey = walletPub
                ? typeof walletPub === 'string'
                    ? walletPub.trim().toLowerCase()
                    : b4a.toString(walletPub, 'hex')
                : null;
            if (!ownerPubKey) {
                console.log('Wallet not ready; cannot sign welcome.');
                return;
            }
            const payload = normalizeWelcomePayload({
                channel: String(channel),
                ownerPubKey,
                text: String(text),
                issuedAt: Date.now(),
                version: 1,
            });
            const message = stableStringify(payload);
            const msgBuf = b4a.from(message);
            let sig = this.peer.wallet.sign(msgBuf);
            let sigHex = '';
            if (typeof sig === 'string') {
                sigHex = sig;
            } else if (sig && sig.length > 0) {
                sigHex = b4a.toString(sig, 'hex');
            }
            if (!sigHex) {
                const walletSecret = this.peer?.wallet?.secretKey;
                const secretBuf = walletSecret
                    ? b4a.isBuffer(walletSecret)
                        ? walletSecret
                        : typeof walletSecret === 'string'
                            ? b4a.from(walletSecret, 'hex')
                            : b4a.from(walletSecret)
                    : null;
                if (secretBuf) {
                    const sigBuf = PeerWallet.sign(msgBuf, secretBuf);
                    if (sigBuf && sigBuf.length > 0) {
                        sigHex = b4a.toString(sigBuf, 'hex');
                    }
                }
            }
            if (!sigHex) {
                console.log('Failed to sign welcome; wallet secret key unavailable.');
                return;
            }
            const welcome = { payload, sig: sigHex };
            try {
                this.peer.sidechannel.acceptInvite(String(channel), null, welcome);
            } catch (_e) {}
            const welcomeJson = JSON.stringify(welcome);
            const welcomeB64 = b4a.toString(b4a.from(welcomeJson), 'base64');
            console.log(welcomeJson);
            console.log('welcome_b64:', welcomeB64);
            return;
        }
        if (this.input.startsWith("/sc_stats")) {
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            const channels = Array.from(this.peer.sidechannel.channels.keys());
            const connectionCount = this.peer.sidechannel.connections.size;
            console.log({ channels, connectionCount });
            return;
        }
        if (this.input.startsWith("/print")) {
            const splitted = this.parseArgs(input);
            console.log(splitted.text);
        }
    }
}

export default MnemexProtocol;
