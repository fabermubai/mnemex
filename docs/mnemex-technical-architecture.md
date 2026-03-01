# Mnemex — Architecture Technique d'Implémentation

## 1. Ce qu'on apprend des repos

### Intercom (base)
- **Structure** : `index.js` → wire `trac-peer` + `trac-msb` + `contract/protocol` + features
- **Contract** : smart contract avec `this.put()` / `this.get()` pour l'état on-chain du subnet
- **Protocol** : commandes CLI + mapping TX + helpers (bigint, signing, invites)
- **Features** : modules injectables (timer, sidechannel, sc-bridge)
- **Sidechannels** : messaging P2P rapide via Hyperswarm, entry channel + extras
- **SC-Bridge** : WebSocket bridge pour connecter des clients externes aux sidechannels
- **Rôles** : admin, writers, indexers (Autobase pour linéarisation)

### Intercom-Swap (fork)
- **Contract intentionnellement VIDE** : `class IntercomSwapContract extends Contract { constructor() { super(); } }`
- **Toute la logique est off-contract** : RFQ, swap, settlement — tout dans les sidechannels + scripts externes
- **Ajouts** : `src/` avec modules (swap state machine, RFQ bots, Lightning, Solana, price oracle, prompt/AI)
- **Pattern** : fork, garder l'infra Intercom intacte, ajouter des couches par-dessus

### Conclusion clé
Intercom-swap n'utilise PAS le contrat. Mnemex a besoin des DEUX :
- **Contract** pour l'état persistant : réputation, stakes, Skill registry
- **Sidechannels** pour le flux temps réel : Memory Write/Read, requêtes, Cortex

---

## 2. Architecture Mnemex — Fork d'Intercom

```
intercom/                          → mnemex/
├── index.js                       → mnemex runner (wire tout)
├── contract/
│   ├── protocol.js                → MnemexProtocol (commandes mémoire)
│   └── contract.js                → MnemexContract (staking, réputation, registry)
├── features/
│   ├── sidechannel/               → copié tel quel (messaging P2P)
│   ├── sc-bridge/                 → copié tel quel (WebSocket bridge)
│   ├── timer/                     → copié (heartbeat, vérification timeout)
│   └── memory-indexer/            → NOUVEAU : indexation + stockage mémoire
├── src/
│   ├── memory/                    → NOUVEAU : memory store, query engine
│   ├── skills/                    → NOUVEAU : skill registry, packaging
│   ├── cortex/                    → NOUVEAU : routing par domaine
│   └── fees/                      → NOUVEAU : fee calculation, MSB integration
├── SKILL.md                       → guide opérationnel pour validateurs
└── package.json
```

---

## 3. Mapping Whitepaper → Implémentation

### 3.1 Memory Nodes (= validateurs Trac qui run un peer Mnemex)

Un Memory Node est un **peer Mnemex avec le rôle indexer** :
- Rejoint le subnet Mnemex
- Écoute les sidechannels (Cortex channels)
- Indexe les Memory Write dans une base locale (SQLite ou LevelDB)
- Répond aux Memory Read via sidechannel
- Synchronise son index avec les autres indexers via Autobase

```javascript
// Dans index.js, le Memory Node :
const peer = new Peer({
  config: peerConfig,
  msb,                              // pour les transactions TNK
  wallet: new Wallet(),
  protocol: MnemexProtocol,
  contract: MnemexContract,
});

// Feature custom : memory indexer
const memoryIndexer = new MemoryIndexer(peer, {
  storage_path: './mnemex-data/',
  cortex_channels: ['cortex-crypto', 'cortex-dev', 'cortex-health'],
});
await peer.protocol.instance.addFeature('memory_indexer', memoryIndexer);
```

### 3.2 Neurominers (= agents qui publient des données/Skills)

Un Neurominer est un **peer Mnemex classique (writer)** :
- Se connecte au subnet Mnemex
- Publie via sidechannel (Memory Write)
- Les données transitent par le contrat pour le staking

```
Neurominer                    Memory Node                    MSB
    |                              |                          |
    |-- sc_send: memory_write ---->|                          |
    |   {cortex, data, stake_tx}   |                          |
    |                              |-- verify stake via MSB -->|
    |                              |<-- stake confirmed -------|
    |                              |-- index locally           |
    |                              |-- replicate to peers      |
```

### 3.3 Les trois opérations du whitepaper

#### Memory Write (Neurominer publie)
1. Neurominer envoie un `memory_write` sur le sidechannel du Cortex approprié
2. Le message inclut : `{type: "memory_write", cortex, data, access: "open"|"gated", stake_txid}`
3. Le Memory Node vérifie que le stake TX existe sur MSB
4. Le contrat enregistre : `put('mem/' + hash, {author, cortex, access, stake_txid, ts})`
5. Les données elles-mêmes sont stockées dans l'index local (pas on-chain)

#### Memory Read (Agent consomme)
1. Agent envoie `memory_read` sur le sidechannel
2. Le Memory Node répond avec `payment_required` (montant, split, adresses)
3. L'agent fait 2 transferts MSB directs : `creator_share` au creator + `node_share` au node
4. L'agent renvoie `memory_read` avec les 2 txids
5. Le Memory Node vérifie les txids sur le MSB, sert les données
6. Le contrat enregistre le fee via `record_fee` (comptabilité)
7. Coût total : prix Mnemex + 0.06 $TNK frais réseau (2 transferts × 0.03)

#### Skill Download
1. Agent envoie `skill_request` sur le sidechannel
2. Le Memory Node répond avec `payment_required` (prix, split, adresses)
3. L'agent fait 2 transferts MSB directs : `creator_share` au creator + `node_share` au node
4. L'agent renvoie `skill_request` avec les 2 txids
5. Le Memory Node vérifie, livre le package
6. Distribution : 80% créateur, 20% Memory Nodes

### 3.4 Contract Mnemex

```javascript
class MnemexContract extends Contract {
  constructor(protocol, options = {}) {
    super(protocol, options);

    // === REPUTATION ===
    this.addSchema('update_reputation', {
      value: {
        $$strict: true,
        $$type: "object",
        op: { type: "string" },
        agent_key: { type: "string", min: 64, max: 64 },
        delta: { type: "number", min: -100, max: 100 },
        reason: { type: "string", max: 256 }
      }
    });

    // === STAKING ===
    this.addSchema('register_stake', {
      value: {
        $$strict: true,
        $$type: "object",
        op: { type: "string" },
        memory_hash: { type: "string", min: 64, max: 64 },
        stake_amount: { type: "string" },  // bigint string
        stake_txid: { type: "string" }
      }
    });

    // === SKILL REGISTRY ===
    this.addSchema('register_skill', {
      value: {
        $$strict: true,
        $$type: "object",
        op: { type: "string" },
        skill_id: { type: "string" },
        name: { type: "string", max: 128 },
        description: { type: "string", max: 1024 },
        cortex: { type: "string", max: 64 },
        price: { type: "string" },  // bigint string TNK
        author_key: { type: "string", min: 64, max: 64 }
      }
    });

    // === FEE DISTRIBUTION ===
    this.addSchema('record_fee', {
      value: {
        $$strict: true,
        $$type: "object",
        op: { type: "string" },
        operation: { type: "enum", values: ["read_open", "read_gated", "skill_download"] },
        creator_key: { type: "string" },
        amount: { type: "string" },
        txid: { type: "string" }
      }
    });

    // === MEMORY INDEXER FEATURE ===
    this.addFeature('memory_indexer_feature', async function() {
      // Reçoit les données indexées par le MemoryIndexer feature
      // et met à jour l'état du contrat
    });
  }

  // Implémentations des fonctions...
  async update_reputation() { /* ... */ }
  async register_stake() { /* ... */ }
  async register_skill() { /* ... */ }
  async record_fee() { /* ... */ }
}
```

### 3.5 Sidechannels Mnemex

```
Channels prédéfinis :
├── 0000mnemex              → entry channel (discovery, heartbeat)
├── cortex-crypto           → Cortex Crypto (données + queries)
├── cortex-dev              → Cortex Développement
├── cortex-health           → Cortex Santé
├── cortex-realestate       → Cortex Immobilier
├── mnemex-skills           → Skill registry announcements
└── mnemex-ops              → coordination inter-Memory Nodes
```

Format de message standardisé :
```json
{
  "v": 1,
  "type": "memory_write|memory_read|memory_response|skill_register|skill_request|skill_deliver",
  "cortex": "crypto",
  "id": "unique-message-id",
  "author": "pubkey-hex",
  "ts": 1708617600000,
  "payload": { },
  "sig": "signature-hex"
}
```

### 3.6 Fee Flow via MSB

Le MSB gère les transferts TNK. Chaque opération payante implique **2 transferts directs** (agent → creator + agent → node), chacun coûtant 0.03 $TNK de frais réseau MSB. Ce modèle est trustless et immédiat : le creator et le node reçoivent leur part sans intermédiaire.

```
Agent                     Memory Node                      MSB
  |                            |                            |
  |-- memory_read request ---->|                            |
  |                            |                            |
  |<-- payment_required -------|                            |
  |   (creator_share,          |                            |
  |    node_share,             |                            |
  |    pay_to_creator,         |                            |
  |    pay_to_node)            |                            |
  |                            |                            |
  |-- TNK transfer #1 (creator_share) -------> creator     |
  |   (frais réseau: 0.03 TNK)                              |
  |                            |                            |
  |-- TNK transfer #2 (node_share) ---------> node         |
  |   (frais réseau: 0.03 TNK)                              |
  |                            |                            |
  |-- memory_read + txids ---->|                            |
  |                            |-- verify txids on MSB ---->|
  |                            |<-- confirmed --------------|
  |<-- memory data ------------|                            |
```

#### Grille tarifaire

| Opération | Prix Mnemex | Creator (%) | Creator (montant) | Node (%) | Node (montant) | Frais réseau (2 TX) | Coût total agent |
|---|---|---|---|---|---|---|---|
| Open Memory Read | 0.03 $TNK | 60% | 0.018 $TNK | 40% | 0.012 $TNK | 0.06 $TNK | **0.09 $TNK** |
| Gated Memory Read | fixé par creator | 70% | 70% du prix | 30% | 30% du prix | 0.06 $TNK | prix + 0.06 $TNK |
| Skill Download | fixé par creator | 80% | 80% du prix | 20% | 20% du prix | 0.06 $TNK | prix + 0.06 $TNK |
| Memory Write | Gratuit | — | — | — | — | 0 | **0** |
| Skill Publish | Gratuit | — | — | — | — | 0 | **0** |

Tous les montants en bigint 18 décimales : 0.03 $TNK = `"30000000000000000"`.

Le contrat Mnemex enregistre chaque fee via `record_fee` pour le suivi comptable (balances, stats). Les paiements TNK eux-mêmes sont des transferts MSB directs — pas de batch, pas de claim.

---

## 4. Plan d'implémentation — MVP (Phase 1)

### Ce qu'on construit en premier :
1. **Fork Intercom** → repo `mnemex/`
2. **MnemexContract minimal** : juste `register_memory` + `query_memory`
3. **MemoryIndexer feature** : écoute un sidechannel, stocke en SQLite, répond aux queries
4. **Un seul Cortex** : `cortex-crypto` (premier use case)
5. **Un seul Memory Node** : toi (ton validateur)
6. **Un Neurominer de test** : agent qui publie des prix crypto
7. **Pas de staking ni fees** au MVP — juste le flux data

### Étapes concrètes :

```bash
# 1. Fork
git clone https://github.com/Trac-Systems/intercom.git mnemex
cd mnemex

# 2. Modifier contract/contract.js → MnemexContract
# 3. Modifier contract/protocol.js → MnemexProtocol
# 4. Créer features/memory-indexer/index.js
# 5. Modifier index.js pour wire le tout

# 6. Lancer le Memory Node (admin)
pear run . memory-node-1 --subnet-channel mnemex-v1

# 7. Lancer un agent test (writer)
pear run . agent-test --subnet-channel mnemex-v1 --subnet-bootstrap <HEX>
```

### Phase 2 : Ajouter le MSB
- Intégrer les paiements TNK pour les queries
- Staking pour les Memory Write
- Distribution de fees (batch)

### Phase 3 : Skills + Multi-cortex
- Skill packaging + registry dans le contrat
- Plusieurs Cortex channels
- Onboarding d'autres validateurs comme Memory Nodes

---

## 5. Doc Validateurs — Structure

Oui, une doc validateur est indispensable. Structure proposée :

```
mnemex-validator-guide.md
├── 1. Prérequis
│   ├── Être validateur Trac actif
│   ├── Node.js / Pear Runtime installé
│   └── Espace disque recommandé
├── 2. Installation
│   ├── Clone du repo
│   ├── npm install
│   └── Configuration (MSB bootstrap, subnet channel)
├── 3. Premier lancement
│   ├── Devenir Memory Node
│   ├── Rejoindre le subnet Mnemex
│   └── Vérification du statut
├── 4. Opérations
│   ├── Monitoring
│   ├── Backup de l'index
│   └── Mise à jour
├── 5. Revenus
│   ├── Comment les fees sont distribués
│   ├── Où voir ses gains
│   └── Retrait des TNK accumulés
└── 6. Troubleshooting
```

---

## 6. Questions ouvertes

1. **Paiement atomique** : ~~comment garantir que l'agent paie AVANT de recevoir les données ?~~
   → RÉSOLU : l'agent fait 2 transferts MSB directs (creator + node), envoie les txids, le Memory Node vérifie avant de servir.

2. **Batch fee distribution** : ~~le contrat accumule et distribue périodiquement ?~~
   → RÉSOLU : pas de batch. 2 paiements directs par opération (trustless, immédiat). Le contrat track les fees pour la comptabilité uniquement.

3. **Stockage mémoire** : SQLite suffisant pour le MVP ?
   → Oui, migration possible vers LevelDB/RocksDB si besoin de scale

4. **Gated Memory** : le Memory Node doit-il stocker les données chiffrées ?
   → Option : chiffrement E2E, le node stocke le blob chiffré, seul le payeur reçoit la clé

5. **Cross-subnet** : un agent sur Intercom natif peut-il query Mnemex ?
   → Pas nativement (subnets séparés). L'agent doit rejoindre le subnet Mnemex.
   → Mais un bridge via SC-Bridge est possible (WebSocket proxy)
