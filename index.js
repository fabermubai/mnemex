/** @typedef {import('pear-interface')} */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import tty from 'tty';
import b4a from 'b4a';
import PeerWallet from 'trac-wallet';
import { Peer, Wallet, createConfig as createPeerConfig, ENV as PEER_ENV } from 'trac-peer';
import { MainSettlementBus } from 'trac-msb/src/index.js';
import { createConfig as createMsbConfig, ENV as MSB_ENV } from 'trac-msb/src/config/env.js';
import { ensureTextCodecs } from 'trac-peer/src/textCodec.js';
import { getPearRuntime, ensureTrailingSlash } from 'trac-peer/src/runnerArgs.js';
import { Terminal } from 'trac-peer/src/terminal/index.js';
import MnemexProtocol from './contract/protocol.js';
import MnemexContract from './contract/contract.js';
import { sendTNK } from './src/fees/tnk-transfer.js';
import { decimalStringToBigInt } from 'trac-msb/src/utils/amountSerialization.js';
import { Timer } from './features/timer/index.js';
import { MemoryIndexer } from './features/memory-indexer/index.js';
import Sidechannel from './features/sidechannel/index.js';
import ScBridge from './features/sc-bridge/index.js';
import { loadConfig, saveConfig } from './lib/config.js';

const { env, storeLabel, flags } = getPearRuntime();

const peerStoreNameRaw =
  (flags['peer-store-name'] && String(flags['peer-store-name'])) ||
  env.PEER_STORE_NAME ||
  storeLabel ||
  'peer';

const peerStoresDirectory = ensureTrailingSlash(
  (flags['peer-stores-directory'] && String(flags['peer-stores-directory'])) ||
    env.PEER_STORES_DIRECTORY ||
    'stores/'
);

const msbStoreName =
  (flags['msb-store-name'] && String(flags['msb-store-name'])) ||
  env.MSB_STORE_NAME ||
  `${peerStoreNameRaw}-msb`;

const msbStoresDirectory = ensureTrailingSlash(
  (flags['msb-stores-directory'] && String(flags['msb-stores-directory'])) ||
    env.MSB_STORES_DIRECTORY ||
    'stores/'
);

const subnetChannel =
  (flags['subnet-channel'] && String(flags['subnet-channel'])) ||
  env.SUBNET_CHANNEL ||
  'mnemex-v1';

const sidechannelsRaw =
  (flags['sidechannels'] && String(flags['sidechannels'])) ||
  (flags['sidechannel'] && String(flags['sidechannel'])) ||
  env.SIDECHANNELS ||
  '';

const cortexChannelsRaw =
  (flags['cortex-channels'] && String(flags['cortex-channels'])) ||
  env.CORTEX_CHANNELS ||
  '';
const cortexChannels = cortexChannelsRaw
  ? cortexChannelsRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : ['cortex-crypto'];

const parseBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const requirePaymentRaw =
  (flags['require-payment'] && String(flags['require-payment'])) ||
  env.REQUIRE_PAYMENT ||
  '';
const requirePayment = parseBool(requirePaymentRaw, false);

const enableSkillsRaw =
  (flags['enable-skills'] && String(flags['enable-skills'])) ||
  env.ENABLE_SKILLS ||
  '';
const enableSkills = parseBool(enableSkillsRaw, true);

const setupOnlyRaw =
  (flags['setup-only'] && String(flags['setup-only'])) ||
  '';
const setupOnly = parseBool(setupOnlyRaw, false);

const parseKeyValueList = (raw) => {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const idx = entry.indexOf(':');
      const alt = entry.indexOf('=');
      const splitAt = idx >= 0 ? idx : alt;
      if (splitAt <= 0) return null;
      const key = entry.slice(0, splitAt).trim();
      const value = entry.slice(splitAt + 1).trim();
      if (!key || !value) return null;
      return [key, value];
    })
    .filter(Boolean);
};

const parseCsvList = (raw) => {
  if (!raw) return null;
  return String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const parseWelcomeValue = (raw) => {
  if (!raw) return null;
  let text = String(raw || '').trim();
  if (!text) return null;
  if (text.startsWith('@')) {
    try {
      const filePath = path.resolve(text.slice(1));
      text = String(fs.readFileSync(filePath, 'utf8') || '').trim();
      if (!text) return null;
    } catch (_e) {
      return null;
    }
  }
  if (text.startsWith('b64:')) text = text.slice(4);
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch (_e) {
      return null;
    }
  }
  try {
    const decoded = b4a.toString(b4a.from(text, 'base64'));
    return JSON.parse(decoded);
  } catch (_e) {}
  return null;
};

const sidechannelDebugRaw =
  (flags['sidechannel-debug'] && String(flags['sidechannel-debug'])) ||
  env.SIDECHANNEL_DEBUG ||
  '';
const sidechannelDebug = parseBool(sidechannelDebugRaw, false);
const sidechannelQuietRaw =
  (flags['sidechannel-quiet'] && String(flags['sidechannel-quiet'])) ||
  env.SIDECHANNEL_QUIET ||
  '';
const sidechannelQuiet = parseBool(sidechannelQuietRaw, false);
const sidechannelMaxBytesRaw =
  (flags['sidechannel-max-bytes'] && String(flags['sidechannel-max-bytes'])) ||
  env.SIDECHANNEL_MAX_BYTES ||
  '';
const sidechannelMaxBytes = Number.parseInt(sidechannelMaxBytesRaw, 10);
const sidechannelAllowRemoteOpenRaw =
  (flags['sidechannel-allow-remote-open'] && String(flags['sidechannel-allow-remote-open'])) ||
  env.SIDECHANNEL_ALLOW_REMOTE_OPEN ||
  '';
const sidechannelAllowRemoteOpen = parseBool(sidechannelAllowRemoteOpenRaw, true);
const sidechannelAutoJoinRaw =
  (flags['sidechannel-auto-join'] && String(flags['sidechannel-auto-join'])) ||
  env.SIDECHANNEL_AUTO_JOIN ||
  '';
const sidechannelAutoJoin = parseBool(sidechannelAutoJoinRaw, false);
const sidechannelPowRaw =
  (flags['sidechannel-pow'] && String(flags['sidechannel-pow'])) ||
  env.SIDECHANNEL_POW ||
  '';
const sidechannelPowEnabled = parseBool(sidechannelPowRaw, true);
const sidechannelPowDifficultyRaw =
  (flags['sidechannel-pow-difficulty'] && String(flags['sidechannel-pow-difficulty'])) ||
  env.SIDECHANNEL_POW_DIFFICULTY ||
  '12';
const sidechannelPowDifficulty = Number.parseInt(sidechannelPowDifficultyRaw, 10);
const sidechannelPowEntryRaw =
  (flags['sidechannel-pow-entry'] && String(flags['sidechannel-pow-entry'])) ||
  env.SIDECHANNEL_POW_ENTRY ||
  '';
const sidechannelPowRequireEntry = parseBool(sidechannelPowEntryRaw, false);
const sidechannelPowChannelsRaw =
  (flags['sidechannel-pow-channels'] && String(flags['sidechannel-pow-channels'])) ||
  env.SIDECHANNEL_POW_CHANNELS ||
  '';
const sidechannelPowChannels = sidechannelPowChannelsRaw
  ? sidechannelPowChannelsRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : null;
const sidechannelInviteRequiredRaw =
  (flags['sidechannel-invite-required'] && String(flags['sidechannel-invite-required'])) ||
  env.SIDECHANNEL_INVITE_REQUIRED ||
  '';
const sidechannelInviteRequired = parseBool(sidechannelInviteRequiredRaw, false);
const sidechannelInviteChannelsRaw =
  (flags['sidechannel-invite-channels'] && String(flags['sidechannel-invite-channels'])) ||
  env.SIDECHANNEL_INVITE_CHANNELS ||
  '';
const sidechannelInviteChannels = sidechannelInviteChannelsRaw
  ? sidechannelInviteChannelsRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : null;
const sidechannelInvitePrefixesRaw =
  (flags['sidechannel-invite-prefixes'] && String(flags['sidechannel-invite-prefixes'])) ||
  env.SIDECHANNEL_INVITE_PREFIXES ||
  '';
const sidechannelInvitePrefixes = sidechannelInvitePrefixesRaw
  ? sidechannelInvitePrefixesRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : null;
const sidechannelInviterKeysRaw =
  (flags['sidechannel-inviter-keys'] && String(flags['sidechannel-inviter-keys'])) ||
  env.SIDECHANNEL_INVITER_KEYS ||
  '';
const sidechannelInviterKeys = sidechannelInviterKeysRaw
  ? sidechannelInviterKeysRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : [];
const sidechannelInviteTtlRaw =
  (flags['sidechannel-invite-ttl'] && String(flags['sidechannel-invite-ttl'])) ||
  env.SIDECHANNEL_INVITE_TTL ||
  '604800';
const sidechannelInviteTtlSec = Number.parseInt(sidechannelInviteTtlRaw, 10);
const sidechannelInviteTtlMs = Number.isFinite(sidechannelInviteTtlSec)
  ? Math.max(sidechannelInviteTtlSec, 0) * 1000
  : 0;
const sidechannelOwnerRaw =
  (flags['sidechannel-owner'] && String(flags['sidechannel-owner'])) ||
  env.SIDECHANNEL_OWNER ||
  '';
const sidechannelOwnerEntries = parseKeyValueList(sidechannelOwnerRaw);
const sidechannelOwnerMap = new Map();
for (const [channel, key] of sidechannelOwnerEntries) {
  const normalizedKey = key.trim().toLowerCase();
  if (channel && normalizedKey) sidechannelOwnerMap.set(channel.trim(), normalizedKey);
}
const sidechannelOwnerWriteOnlyRaw =
  (flags['sidechannel-owner-write-only'] && String(flags['sidechannel-owner-write-only'])) ||
  env.SIDECHANNEL_OWNER_WRITE_ONLY ||
  '';
const sidechannelOwnerWriteOnly = parseBool(sidechannelOwnerWriteOnlyRaw, false);
const sidechannelOwnerWriteChannelsRaw =
  (flags['sidechannel-owner-write-channels'] && String(flags['sidechannel-owner-write-channels'])) ||
  env.SIDECHANNEL_OWNER_WRITE_CHANNELS ||
  '';
const sidechannelOwnerWriteChannels = sidechannelOwnerWriteChannelsRaw
  ? sidechannelOwnerWriteChannelsRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : null;
const sidechannelWelcomeRaw =
  (flags['sidechannel-welcome'] && String(flags['sidechannel-welcome'])) ||
  env.SIDECHANNEL_WELCOME ||
  '';
const sidechannelWelcomeEntries = parseKeyValueList(sidechannelWelcomeRaw);
const sidechannelWelcomeMap = new Map();
for (const [channel, value] of sidechannelWelcomeEntries) {
  const welcome = parseWelcomeValue(value);
  if (channel && welcome) sidechannelWelcomeMap.set(channel.trim(), welcome);
}
const sidechannelWelcomeRequiredRaw =
  (flags['sidechannel-welcome-required'] && String(flags['sidechannel-welcome-required'])) ||
  env.SIDECHANNEL_WELCOME_REQUIRED ||
  '';
// Mnemex: cortex channels must be open for memory_write/read — default false
const sidechannelWelcomeRequired = parseBool(sidechannelWelcomeRequiredRaw, false);

const sidechannelEntry = '0000mnemex';
const sidechannelExtras = sidechannelsRaw
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0 && value !== sidechannelEntry);

if (sidechannelWelcomeRequired && !sidechannelOwnerMap.has(sidechannelEntry)) {
  console.warn(
    `[sidechannel] welcome required for non-entry channels; entry "${sidechannelEntry}" is open and does not require owner/welcome.`
  );
}

// Admin peer's Autobase key — all Mnemex peers must join this Autobase.
// Override with --subnet-bootstrap <hex> or SUBNET_BOOTSTRAP env var.
const MNEMEX_SUBNET_BOOTSTRAP =
  'f52062456f3826bad7846a0cf65f47a32e84d545d28eb907e90fa021bb50efb0';

const subnetBootstrapHex =
  (flags['subnet-bootstrap'] && String(flags['subnet-bootstrap'])) ||
  env.SUBNET_BOOTSTRAP ||
  MNEMEX_SUBNET_BOOTSTRAP;

const scBridgeEnabledRaw =
  (flags['sc-bridge'] && String(flags['sc-bridge'])) ||
  env.SC_BRIDGE ||
  '';
const scBridgeEnabled = parseBool(scBridgeEnabledRaw, false);
const scBridgeHost =
  (flags['sc-bridge-host'] && String(flags['sc-bridge-host'])) ||
  env.SC_BRIDGE_HOST ||
  '127.0.0.1';
const scBridgePortRaw =
  (flags['sc-bridge-port'] && String(flags['sc-bridge-port'])) ||
  env.SC_BRIDGE_PORT ||
  '';
const scBridgePort = Number.parseInt(scBridgePortRaw, 10);
const scBridgeFilter =
  (flags['sc-bridge-filter'] && String(flags['sc-bridge-filter'])) ||
  env.SC_BRIDGE_FILTER ||
  '';
const scBridgeFilterChannelRaw =
  (flags['sc-bridge-filter-channel'] && String(flags['sc-bridge-filter-channel'])) ||
  env.SC_BRIDGE_FILTER_CHANNEL ||
  '';
const scBridgeFilterChannels = scBridgeFilterChannelRaw
  ? scBridgeFilterChannelRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : null;
const scBridgeToken =
  (flags['sc-bridge-token'] && String(flags['sc-bridge-token'])) ||
  env.SC_BRIDGE_TOKEN ||
  '';
const scBridgeCliRaw =
  (flags['sc-bridge-cli'] && String(flags['sc-bridge-cli'])) ||
  env.SC_BRIDGE_CLI ||
  '';
const scBridgeCliEnabled = parseBool(scBridgeCliRaw, false);
const scBridgeDebugRaw =
  (flags['sc-bridge-debug'] && String(flags['sc-bridge-debug'])) ||
  env.SC_BRIDGE_DEBUG ||
  '';
const scBridgeDebug = parseBool(scBridgeDebugRaw, false);

// Optional: override DHT bootstrap nodes (host:port list) for faster local tests.
// Note: this affects all Hyperswarm joins (subnet replication + sidechannels).
const peerDhtBootstrapRaw =
  (flags['peer-dht-bootstrap'] && String(flags['peer-dht-bootstrap'])) ||
  (flags['dht-bootstrap'] && String(flags['dht-bootstrap'])) ||
  env.PEER_DHT_BOOTSTRAP ||
  env.DHT_BOOTSTRAP ||
  '';
const peerDhtBootstrap = parseCsvList(peerDhtBootstrapRaw);
const msbDhtBootstrapRaw =
  (flags['msb-dht-bootstrap'] && String(flags['msb-dht-bootstrap'])) ||
  env.MSB_DHT_BOOTSTRAP ||
  '';
const msbDhtBootstrap = parseCsvList(msbDhtBootstrapRaw);

if (scBridgeEnabled && !scBridgeToken) {
  throw new Error('SC-Bridge requires --sc-bridge-token (auth is mandatory).');
}

const readHexFile = (filePath, byteLength) => {
  try {
    if (fs.existsSync(filePath)) {
      const hex = fs.readFileSync(filePath, 'utf8').trim().toLowerCase();
      if (/^[0-9a-f]+$/.test(hex) && hex.length === byteLength * 2) return hex;
    }
  } catch (_e) {}
  return null;
};

const subnetBootstrapFile = path.join(
  peerStoresDirectory,
  peerStoreNameRaw,
  'subnet-bootstrap.hex'
);

let subnetBootstrap = subnetBootstrapHex ? subnetBootstrapHex.trim().toLowerCase() : null;
if (subnetBootstrap) {
  if (!/^[0-9a-f]{64}$/.test(subnetBootstrap)) {
    throw new Error('Invalid --subnet-bootstrap. Provide 32-byte hex (64 chars).');
  }
} else {
  subnetBootstrap = readHexFile(subnetBootstrapFile, 32);
}

const msbConfigOptions = {
  storeName: msbStoreName,
  storesDirectory: msbStoresDirectory,
  enableInteractiveMode: false,
};
if (msbDhtBootstrap) msbConfigOptions.dhtBootstrap = msbDhtBootstrap;
const msbConfig = createMsbConfig(MSB_ENV.MAINNET, msbConfigOptions);

const msbBootstrapHex = b4a.toString(msbConfig.bootstrap, 'hex');
if (subnetBootstrap && subnetBootstrap === msbBootstrapHex) {
  throw new Error('Subnet bootstrap cannot equal MSB bootstrap.');
}

const peerConfigOptions = {
  storesDirectory: peerStoresDirectory,
  storeName: peerStoreNameRaw,
  bootstrap: subnetBootstrap || null,
  channel: subnetChannel,
  enableInteractiveMode: true,
  enableBackgroundTasks: true,
  enableUpdater: true,
  replicate: true,
};
if (peerDhtBootstrap) peerConfigOptions.dhtBootstrap = peerDhtBootstrap;
const peerConfig = createPeerConfig(PEER_ENV.MAINNET, peerConfigOptions);

const ensureKeypairFile = async (keyPairPath, rlInstance) => {
  fs.mkdirSync(path.dirname(keyPairPath), { recursive: true });
  await ensureTextCodecs();
  const wallet = new PeerWallet();
  await wallet.ready;
  // initKeyPair handles both cases:
  // - file exists → imports silently
  // - file missing → interactive menu (generate new / restore from mnemonic / import file)
  await wallet.initKeyPair(keyPairPath, rlInstance);
};

const msbKeypairExists = fs.existsSync(msbConfig.keyPairPath);
const peerKeypairExists = fs.existsSync(peerConfig.keyPairPath);
const firstLaunch = !msbKeypairExists && !peerKeypairExists;
const needsInteractive = !msbKeypairExists || !peerKeypairExists;

let walletRl = null;
if (needsInteractive) {
  walletRl = readline.createInterface({
    input: new tty.ReadStream(0),
    output: new tty.WriteStream(1),
  });
}

if (firstLaunch) {
  // Single-seed onboarding: prompt once, reuse keypair for both stores
  console.log('First launch — one seed will be used for both MSB and Peer stores.');
  await ensureKeypairFile(msbConfig.keyPairPath, walletRl);
  fs.mkdirSync(path.dirname(peerConfig.keyPairPath), { recursive: true });
  fs.copyFileSync(msbConfig.keyPairPath, peerConfig.keyPairPath);
  console.log('Keypair replicated to peer store.');
} else {
  await ensureKeypairFile(msbConfig.keyPairPath, walletRl);
  await ensureKeypairFile(peerConfig.keyPairPath, walletRl);
}
// Nick prompt (before closing readline)
const peerStorePath = path.join(peerStoresDirectory, peerStoreNameRaw);
let mnemexConfig = loadConfig(peerStorePath);
// Always prompt for nick during --setup-only (even if config has one), otherwise only on first launch
const shouldPromptNick = setupOnly || (!mnemexConfig.nick && walletRl);
if (shouldPromptNick) {
  // Ensure readline is available for nick prompt
  if (!walletRl) {
    try {
      walletRl = readline.createInterface({
        input: new tty.ReadStream(0),
        output: new tty.WriteStream(1),
      });
    } catch (_) {
      // No TTY available (e.g. background mode, test runner) — skip nick prompt
    }
  }
  if (walletRl) {
    const currentNick = mnemexConfig.nick;
    const nickLabel = currentNick
      ? `Choose a nick for your Mnemex agent (current: ${currentNick}):`
      : 'Choose a nick for your Mnemex agent (e.g. FaberNode):';
    const nickPromise = new Promise((resolve) => {
      const onLine = (input) => {
        const nick = (input || '').trim();
        // Allow empty input to keep current nick (only if one exists)
        if (nick === '' && currentNick) {
          walletRl.off('line', onLine);
          resolve(currentNick);
        } else if (/^[a-zA-Z0-9_-]{3,20}$/.test(nick)) {
          walletRl.off('line', onLine);
          resolve(nick);
        } else {
          console.log('Invalid nick. Use 3-20 alphanumeric characters, dashes, or underscores.');
          console.log(nickLabel);
        }
      };
      console.log(nickLabel);
      walletRl.on('line', onLine);
    });
    const nick = await nickPromise;
    saveConfig(peerStorePath, { nick, created_at: mnemexConfig.created_at || Date.now() });
    mnemexConfig = loadConfig(peerStorePath);
    console.log('Nick saved:', nick);
  }
}
if (walletRl) walletRl.close();

// --setup-only: exit after keypair + nick setup, don't start the node
if (setupOnly) {
  // Load keypair to display address confirmation
  const wallet = new PeerWallet();
  await wallet.ready;
  try {
    wallet.importFromFile(peerConfig.keyPairPath);
    console.log('');
    console.log('Setup complete.');
    console.log('  Nick:    ', mnemexConfig.nick || '(none)');
    console.log('  Address: ', wallet.address || wallet.publicKey);
  } catch (_) {
    console.log('');
    console.log('Setup complete. Keypairs and nick configured.');
  }
  console.log('Run launch-node.bat to start Mnemex in background.');
  process.exit(0);
}

console.log('=============== STARTING MSB ===============');
const msb = new MainSettlementBus(msbConfig);
await msb.ready();

console.log('=============== STARTING PEER ===============');
const peer = new Peer({
  config: peerConfig,
  msb,
  wallet: new Wallet(),
  protocol: MnemexProtocol,
  contract: MnemexContract,
});
await peer.ready();

/* ── Auto-add writers (early) ────────────────────────────────────────────
 * Must run BEFORE any other setup so the flag is in Autobase state when
 * Hyperswarm starts accepting connections.  Otherwise new peers connect,
 * send their invitation, and Agent 1 silently ignores it because
 * auto_add_writers is still null — a race condition that leaves Agent 2
 * permanently non-writable.
 * ──────────────────────────────────────────────────────────────────────── */
// Only the bootstrap peer sets this flag. Non-bootstrap peers that are
// already writable would hang on append() because the indexer isn't
// connected yet at startup.
const isBootstrap = peer.writerLocalKey === peer.base?.key?.toString('hex');
if (isBootstrap) {
  try {
    const nonce = peer.protocol.instance.generateNonce();
    const msg = { type: 'setAutoAddWriters', key: 'on' };
    const hash = peer.wallet.sign(JSON.stringify(msg) + nonce);
    await peer.base.append({
      type: 'setAutoAddWriters',
      key: 'on',
      value: { msg },
      hash,
      nonce,
    });
    console.log('Auto-add writers: enabled (early)');
  } catch (err) {
    if (err?.message !== 'Peer is not writable.') {
      console.error('Auto-add writers failed:', err?.message ?? err);
    }
  }
}

peer._msb = msb;
peer._mnemexConfig = mnemexConfig;
peer._peerStorePath = peerStorePath;

const effectiveSubnetBootstrapHex = peer.base?.key
  ? peer.base.key.toString('hex')
  : b4a.isBuffer(peer.config.bootstrap)
      ? peer.config.bootstrap.toString('hex')
      : String(peer.config.bootstrap ?? '').toLowerCase();

if (!subnetBootstrap) {
  fs.mkdirSync(path.dirname(subnetBootstrapFile), { recursive: true });
  fs.writeFileSync(subnetBootstrapFile, `${effectiveSubnetBootstrapHex}\n`);
}

console.log('');
console.log('==================== MNEMEX ====================');
const msbChannel = b4a.toString(msbConfig.channel, 'utf8');
const msbStorePath = path.join(msbStoresDirectory, msbStoreName);
const peerWriterKey = peer.writerLocalKey ?? peer.base?.local?.key?.toString('hex') ?? null;
console.log('MSB network bootstrap:', msbBootstrapHex);
console.log('MSB channel:', msbChannel);
console.log('MSB store:', msbStorePath);
console.log('Peer store:', peerStorePath);
if (Array.isArray(msbConfig?.dhtBootstrap) && msbConfig.dhtBootstrap.length > 0) {
  console.log('MSB DHT bootstrap nodes:', msbConfig.dhtBootstrap.join(', '));
}
if (Array.isArray(peerConfig?.dhtBootstrap) && peerConfig.dhtBootstrap.length > 0) {
  console.log('Peer DHT bootstrap nodes:', peerConfig.dhtBootstrap.join(', '));
}
console.log('Peer subnet bootstrap:', effectiveSubnetBootstrapHex);
console.log('Peer subnet channel:', subnetChannel);
console.log('Peer pubkey (hex):', peer.wallet.publicKey);
console.log('Peer trac address (bech32m):', peer.wallet.address ?? null);
console.log('Peer writer key (hex):', peerWriterKey);
console.log('Sidechannel entry:', sidechannelEntry);
if (sidechannelExtras.length > 0) {
  console.log('Sidechannel extras:', sidechannelExtras.join(', '));
}
if (scBridgeEnabled) {
  const portDisplay = Number.isSafeInteger(scBridgePort) ? scBridgePort : 49222;
  console.log('SC-Bridge:', `ws://${scBridgeHost}:${portDisplay}`);
}
console.log('Cortex channels:', cortexChannels.join(', '));
console.log('Require payment:', requirePayment);
console.log('Skills enabled:', enableSkills);
console.log('================================================================');
console.log('');

const admin = await peer.base.view.get('admin');
if (admin && admin.value === peer.wallet.publicKey && peer.base.writable) {
  const timer = new Timer(peer, { update_interval: 60_000 });
  await peer.protocol.instance.addFeature('timer', timer);
  timer.start().catch((err) => console.error('Timer feature stopped:', err?.message ?? err));
}

// Load registered cortex channels from contract state (merge with --cortex-channels)
try {
  const stream = peer.base.view.createReadStream({ gte: 'cortex/', lt: 'cortex0' });
  for await (const entry of stream) {
    const key = typeof entry.key === 'string' ? entry.key : b4a.toString(entry.key, 'utf8');
    const cortexName = key.slice('cortex/'.length);
    if (entry.value && entry.value.status === 'active' && !cortexChannels.includes(cortexName)) {
      cortexChannels.push(cortexName);
    }
  }
} catch (_e) {
  // State may not be ready or no cortex channels registered yet
}

const memoryIndexer = new MemoryIndexer(peer, {
  dataDir: './mnemex-data',
  cortexChannels: cortexChannels,
  requirePayment: requirePayment,
  nodeAddress: peer.wallet.address || peer.wallet.publicKey,
  enableSkills: enableSkills,
  msb: msb,
});
await peer.protocol.instance.addFeature('memory_indexer', memoryIndexer);
peer._memoryIndexer = memoryIndexer;
memoryIndexer.start().catch((err) => console.error('MemoryIndexer feature stopped:', err?.message ?? err));

let scBridge = null;
if (scBridgeEnabled) {
  scBridge = new ScBridge(peer, {
    host: scBridgeHost,
    port: Number.isSafeInteger(scBridgePort) ? scBridgePort : 49222,
    filter: scBridgeFilter,
    filterChannels: scBridgeFilterChannels || undefined,
    token: scBridgeToken,
    debug: scBridgeDebug,
    cliEnabled: scBridgeCliEnabled,
    requireAuth: true,
    info: {
      msbBootstrap: msbBootstrapHex,
      msbChannel,
      msbStore: msbStorePath,
      msbDhtBootstrap: Array.isArray(msbConfig?.dhtBootstrap) ? msbConfig.dhtBootstrap.slice() : null,
      peerStore: peerStorePath,
      peerDhtBootstrap: Array.isArray(peerConfig?.dhtBootstrap) ? peerConfig.dhtBootstrap.slice() : null,
      subnetBootstrap: effectiveSubnetBootstrapHex,
      subnetChannel,
      peerPubkey: peer.wallet.publicKey,
      peerTracAddress: peer.wallet.address ?? null,
      peerWriterKey,
      sidechannelEntry,
      sidechannelExtras: sidechannelExtras.slice(),
    },
  });
}

const skillsChannels = enableSkills ? ['mnemex-skills'] : [];
const allChannels = [...new Set([sidechannelEntry, ...sidechannelExtras, ...cortexChannels, ...skillsChannels])];

const sidechannel = new Sidechannel(peer, {
  channels: allChannels,
  debug: sidechannelDebug,
  maxMessageBytes: Number.isSafeInteger(sidechannelMaxBytes) ? sidechannelMaxBytes : undefined,
  entryChannel: sidechannelEntry,
  allowRemoteOpen: sidechannelAllowRemoteOpen,
  autoJoinOnOpen: sidechannelAutoJoin,
  powEnabled: sidechannelPowEnabled,
  powDifficulty: Number.isInteger(sidechannelPowDifficulty) ? sidechannelPowDifficulty : undefined,
  powRequireEntry: sidechannelPowRequireEntry,
  powRequiredChannels: sidechannelPowChannels || undefined,
  inviteRequired: sidechannelInviteRequired,
  inviteRequiredChannels: sidechannelInviteChannels || undefined,
  inviteRequiredPrefixes: sidechannelInvitePrefixes || undefined,
  inviterKeys: sidechannelInviterKeys,
  inviteTtlMs: sidechannelInviteTtlMs,
  welcomeRequired: sidechannelWelcomeRequired,
  ownerWriteOnly: sidechannelOwnerWriteOnly,
  ownerWriteChannels: sidechannelOwnerWriteChannels || undefined,
  ownerKeys: sidechannelOwnerMap.size > 0 ? sidechannelOwnerMap : undefined,
  welcomeByChannel: sidechannelWelcomeMap.size > 0 ? sidechannelWelcomeMap : undefined,
  onMessage: (channel, payload, connection) => {
    memoryIndexer.handleMessage(channel, payload, connection);
    if (scBridgeEnabled && scBridge) {
      scBridge.handleSidechannelMessage(channel, payload, connection);
    }
  },
});
peer.sidechannel = sidechannel;

if (scBridge) {
  scBridge.attachSidechannel(sidechannel);

  /* ── Chat commands via SC-Bridge ──────────────────────────────────────
   * Wrap _handleClientMessage to intercept chat_send, chat_history, and
   * chat_reply before they fall into the upstream "Unknown type" default.
   * This avoids modifying features/sc-bridge/ (upstream Intercom).
   * ──────────────────────────────────────────────────────────────────── */
  const _origHandleClientMessage = scBridge._handleClientMessage.bind(scBridge);
  scBridge._handleClientMessage = function (client, message) {
    if (!message || typeof message !== 'object') {
      _origHandleClientMessage(client, message);
      return;
    }

    const reqId = Number.isInteger(message.id) ? message.id : null;
    const reply = (payload) => {
      const out = reqId !== null ? { id: reqId, ...payload } : payload;
      scBridge._broadcastToClient(client, out);
    };
    const sendError = (error) => reply({ type: 'error', error });

    switch (message.type) {
      /* ── chat_send ──────────────────────────────────────────────────── */
      case 'chat_send': {
        const text = typeof message.message === 'string' ? message.message.trim() : '';
        if (!text) { sendError('Missing message.'); return; }
        (async () => {
          try {
            const chatStatus = await peer.base.view.get('chat_status');
            if (!chatStatus || chatStatus.value !== 'on') { sendError('Chat is disabled.'); return; }
            const replyTo = Number.isInteger(message.reply_to) ? message.reply_to : null;
            const nonce = peer.protocol.instance.generateNonce();
            const signature = { dispatch: {
              type: 'msg',
              msg: text,
              address: peer.wallet.publicKey,
              attachments: [],
              deleted_by: null,
              reply_to: replyTo,
              pinned: false,
              pin_id: null,
            }};
            const hash = peer.wallet.sign(JSON.stringify(signature) + nonce);
            await peer.base.append({ type: 'msg', value: signature, hash, nonce });
            reply({ type: 'chat_sent', message: text, reply_to: replyTo });
          } catch (err) {
            sendError(err?.message ?? String(err));
          }
        })();
        return;
      }

      /* ── chat_history ───────────────────────────────────────────────── */
      case 'chat_history': {
        const limit = Number.isInteger(message.limit) && message.limit > 0
          ? Math.min(message.limit, 100)
          : 20;
        (async () => {
          try {
            const lenEntry = await peer.base.view.get('msgl');
            const total = lenEntry !== null ? lenEntry.value : 0;
            const start = Math.max(0, total - limit);
            const messages = [];
            for (let i = start; i < total; i++) {
              const entry = await peer.base.view.get('msg/' + i);
              if (entry && entry.value) {
                const nick = await peer.base.view.get('nick/' + entry.value.address);
                messages.push({
                  id: i + 1,
                  author: entry.value.address,
                  nick: nick?.value ?? null,
                  message: entry.value.msg,
                  reply_to: entry.value.reply_to ?? null,
                  pinned: entry.value.pinned ?? false,
                  deleted: entry.value.msg === null,
                });
              }
            }
            reply({ type: 'chat_history', total, messages });
          } catch (err) {
            sendError(err?.message ?? String(err));
          }
        })();
        return;
      }

      /* ── chat_reply (alias for chat_send with reply_to) ─────────────── */
      case 'chat_reply': {
        if (!Number.isInteger(message.reply_to)) { sendError('Missing reply_to (message ID).'); return; }
        message.type = 'chat_send';
        scBridge._handleClientMessage(client, message);
        return;
      }

      /* ── memory_search ───────────────────────────────────────────────── */
      case 'memory_search': {
        const cortex = message.cortex || null;
        const scChannel = cortex && memoryIndexer.cortexChannels.includes(cortex)
          ? cortex
          : memoryIndexer.cortexChannels[0] || 'cortex-crypto';
        const replySearch = (data) => reply(JSON.parse(data));
        memoryIndexer._handleMemorySearch(scChannel, {
          v: 1, type: 'memory_search',
          query: message.query || '',
          cortex: message.cortex || null,
          author: message.author || null,
          limit: message.limit
        }, replySearch).catch((err) => sendError(err?.message ?? String(err)));
        return;
      }

      /* ── memory_list ─────────────────────────────────────────────────── */
      case 'memory_list': {
        const replyList = (data) => reply(JSON.parse(data));
        memoryIndexer._handleMemoryList(memoryIndexer.cortexChannels[0] || 'cortex-crypto', {
          v: 1, type: 'memory_list',
          cortex: message.cortex || null,
          author: message.author || null,
          limit: message.limit
        }, replyList).catch((err) => sendError(err?.message ?? String(err)));
        return;
      }

      /* ── skill_search ────────────────────────────────────────────────── */
      case 'skill_search': {
        const replySkill = (data) => reply(JSON.parse(data));
        memoryIndexer._handleSkillSearch(memoryIndexer.skillsChannel, {
          v: 1, type: 'skill_search',
          query: message.query || '',
          cortex: message.cortex || null,
          limit: message.limit
        }, replySkill).catch((err) => sendError(err?.message ?? String(err)));
        return;
      }

      /* ── msb_transfer ─────────────────────────────────────────────────
       * Send a TNK transfer via the MSB.
       * ─────────────────────────────────────────────────────────────── */
      case 'msb_transfer': {
        const to = message.to;
        const amount = message.amount;
        if (!to || !amount) { sendError('Missing to or amount.'); return; }
        const rawMsb = peer._msb;
        if (!rawMsb) { sendError('MSB not available.'); return; }
        (async () => {
          try {
            const amountBigint = String(decimalStringToBigInt(amount));
            const result = await sendTNK(rawMsb, to, amountBigint, peer.wallet);
            if (result.success) {
              reply({ type: 'msb_transfer_ok', to, amount, txHash: result.txHash });
            } else {
              sendError(result.error || 'Transfer failed');
            }
          } catch (err) {
            sendError(err?.message ?? String(err));
          }
        })();
        return;
      }

      /* ── memory_write ─────────────────────────────────────────────────
       * Route to local MemoryIndexer AND broadcast to network.
       * ─────────────────────────────────────────────────────────────── */
      case 'memory_write': {
        const cortexW = message.cortex && memoryIndexer.cortexChannels.includes(message.cortex)
          ? message.cortex
          : memoryIndexer.cortexChannels[0] || 'cortex-crypto';
        const writeMsg = {
          v: 1,
          type: 'memory_write',
          memory_id: message.memory_id,
          cortex: message.cortex || cortexW,
          data: message.data,
          author: message.author || peer.wallet.publicKey,
          access: message.access || 'open',
          ts: message.ts || Date.now(),
          tags: message.tags || undefined,
          price: message.price || undefined,
          sig: message.sig || undefined,
        };
        const origScW = memoryIndexer.peer.sidechannel;
        memoryIndexer.peer.sidechannel = {
          broadcast: (_ch, data) => {
            // Also broadcast to network via real sidechannel
            origScW.broadcast(_ch, data);
          }
        };
        memoryIndexer._handleMemoryWrite(cortexW, writeMsg)
          .then(() => reply({ type: 'memory_write_ok', memory_id: writeMsg.memory_id }))
          .catch((err) => sendError(err?.message ?? String(err)))
          .finally(() => { memoryIndexer.peer.sidechannel = origScW; });
        return;
      }

      /* ── memory_read ──────────────────────────────────────────────────
       * Route to local MemoryIndexer, reply directly to requesting client.
       * ─────────────────────────────────────────────────────────────── */
      case 'memory_read': {
        const cortexR = memoryIndexer.cortexChannels[0] || 'cortex-crypto';
        const replyRead = (data) => reply(JSON.parse(data));
        memoryIndexer._handleMemoryRead(cortexR, {
          v: 1,
          type: 'memory_read',
          memory_id: message.memory_id,
          payment_txid_creator: message.payment_txid_creator || undefined,
          payment_txid_node: message.payment_txid_node || undefined,
          payer: message.payer || undefined,
        }, replyRead).catch((err) => sendError(err?.message ?? String(err)));
        return;
      }

      default:
        _origHandleClientMessage(client, message);
    }
  };

  try {
    scBridge.start();
  } catch (err) {
    console.error('SC-Bridge failed to start:', err?.message ?? err);
  }
  peer.scBridge = scBridge;

  /* ── Chat incoming broadcast ────────────────────────────────────────────
   * Poll the Autobase view for new chat messages every 2s and push them
   * to all connected SC-Bridge clients as { type: "chat_incoming", ... }.
   * This gives headless agents real-time chat without polling chat_history.
   * ──────────────────────────────────────────────────────────────────── */
  let _chatLastSeen = 0;
  const _chatPollInterval = setInterval(async () => {
    try {
      const lenEntry = await peer.base.view.get('msgl');
      const total = lenEntry !== null ? lenEntry.value : 0;
      if (_chatLastSeen === 0) { _chatLastSeen = total; return; }
      if (total <= _chatLastSeen) return;

      for (let i = _chatLastSeen; i < total; i++) {
        const entry = await peer.base.view.get('msg/' + i);
        if (!entry || !entry.value) continue;
        const nick = await peer.base.view.get('nick/' + entry.value.address);
        const payload = {
          type: 'chat_incoming',
          id: i + 1,
          author: entry.value.address,
          nick: nick?.value ?? null,
          message: entry.value.msg,
          reply_to: entry.value.reply_to ?? null,
          ts: Date.now(),
        };
        // Log incoming messages from other peers to stdout
        if (entry.value.address !== peer.wallet.publicKey) {
          const displayNick = nick?.value ?? entry.value.address.slice(0, 8) + '…';
          console.log(`\u{1F4E9} Chat from ${displayNick}: ${entry.value.msg}`);
        }
        for (const client of scBridge.clients) {
          if (!client.ready) continue;
          scBridge._broadcastToClient(client, payload);
        }
      }
      _chatLastSeen = total;
    } catch (_err) { /* ignore transient view errors */ }
  }, 2000);

  // Clean up on process exit (process may not exist under Pear Runtime)
  if (typeof process !== 'undefined') process.on('beforeExit', () => clearInterval(_chatPollInterval));
}

// ── Presence heartbeat ─────────────────────────────────────────────────
// Broadcast peer_announce on the entry sidechannel so other agents know
// we're online.  First announce after 3s (let sidechannel connect), then
// every 2 minutes.
const emitPeerAnnounce = () => {
  try {
    const announceMsg = JSON.stringify({
      v: 1,
      type: 'peer_announce',
      peer_key: peer.wallet.publicKey,
      address: peer.wallet.address || null,
      nick: peer._mnemexConfig.nick || null,
      capabilities: ['memory_node'],
      ts: Date.now(),
    });
    sidechannel.broadcast(sidechannelEntry, announceMsg);
  } catch (_e) { }
};

sidechannel
  .start()
  .then(() => {
    console.log('Sidechannel: ready');

    // Peer announce — guaranteed sidechannel is ready
    setTimeout(emitPeerAnnounce, 3_000);
    setInterval(emitPeerAnnounce, 2 * 60 * 1000);

    // Bulk sync — fetch missing open memories from peers (after peer announce)
    setTimeout(() => {
      try {
        const syncMsg = JSON.stringify({
          v: 1,
          type: 'memory_sync_request',
          peer_key: peer.wallet.publicKey,
          ts: Date.now(),
        });
        sidechannel.broadcast(sidechannelEntry, syncMsg);
        console.log('[sync] broadcast memory_sync_request');
      } catch (_e) { }
    }, 5_000);
  })
  .catch((err) => {
    console.error('Sidechannel failed to start:', err?.message ?? err);
  });

const terminal = new Terminal(peer);
peer._rl = await terminal.start();

/* Auto-add writers: moved to early init (right after peer.ready()) to fix
 * race condition where Agent 2 connects before the flag is set. */
