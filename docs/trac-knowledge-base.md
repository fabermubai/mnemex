# 📖 Trac Knowledge Base — Documentation Technique Complète

> **Objectif** : Ce document sert de référence technique exhaustive pour tout projet de développement sur Trac Network. Il compile la documentation officielle, les ressources GitHub, et les informations clés de l'écosystème.
>
> **Dernière mise à jour** : Février 2026
>
> **Sources principales** :
> - Documentation officielle : https://docs.trac.network/
> - GitHub : https://github.com/Trac-Systems/trac-network
> - Site Trac Systems : https://tracsystems.io/trac-network/
> - Litepaper : https://medium.com/trac-systems/trac-network-litepaper-63da57484c27

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Architecture et fonctionnement](#2-architecture-et-fonctionnement)
3. [Concepts clés et terminologie](#3-concepts-clés-et-terminologie)
4. [Système de Validators](#4-système-de-validators)
5. [Développement — Smart Contracts](#5-développement--smart-contracts)
   - [5a. Développement R1 (Gasless Net)](#5a-développement-r1-gasless-net)
     - Contracts (Protocol + Contract), Features (Oracles), Messaging, Deployment, Custom Validators (MSB R1)
   - [5b. Développement Mainnet](#5b-développement-mainnet)
     - Wallet API
     - dApp Developer Guide (Introduction, Quickstart, MSB Local Setup, Bootstrap Checklist, Subnets & Roles, Running Peer, RPC API v1, Wallet & dApp, App Dev, References/Examples, Troubleshooting, Production Notes)
     - Main Settlement Bus (MSB RPC API v1)
6. [Messaging / Trac Chat (Intercom)](#6-messaging--trac-chat-intercom)
7. [Features (Oracles / Extensions)](#7-features-oracles--extensions)
8. [HyperTokens Protocol](#8-hypertokens-protocol)
9. [HyperMall — DEX de référence](#9-hypermall--dex-de-référence)
   - Security, How Transactions Work, Trading, Withdrawing Assets, Fee Structure, Token Pairs, Incentives, Running a Node
10. [HyperFun — Plateforme de lancement de tokens](#10-hyperfun--plateforme-de-lancement-de-tokens)
11. [Tokenomics — $trac, $TAP](#11-tokenomics--trac-tap)
12. [Infrastructure technique — Pear Runtime & Holepunch](#12-infrastructure-technique--pear-runtime--holepunch)
13. [Repos GitHub essentiels](#13-repos-github-essentiels)
14. [Gotchas & pièges connus](#14-gotchas--pièges-connus)
15. [Liens utiles](#15-liens-utiles)

---

## 1. Vue d'ensemble

**Trac Network** est un **Layer 1 "blockless"** (sans blocs) conçu autour de principes stricts de **peer-to-peer** et de **self-custody**. Ce n'est ni un L2, ni un bridge, ni un système d'actifs wrappés — c'est un réseau souverain où la propriété, le flux de transactions et la validation sont entièrement décentralisés.

### Caractéristiques principales

| Caractéristique | Détail |
|---|---|
| **Type** | Layer 1 sans blocs ("blockless") |
| **Finalité** | ~1 seconde |
| **Throughput max** | ~3M tx/s (exécution déterministe et parallèle) |
| **Frais de gas** | Fixes : **0.03 $trac / tx** (50% validators, 25% deployers, 25% réservé/burned) |
| **Déploiement de contrats** | **Gratuit** |
| **Langage de développement** | **JavaScript** (accessible aux ~20M de dev JS dans le monde) |
| **Runtime** | Pear Runtime (Holepunch) |
| **Architecture** | Apps locales ("App3") — contrats, wallet et nœud intégrés dans chaque app |

### Philosophie "App3"

Les apps Trac sont **entièrement chargées** : wallets, smart contracts et nœuds sont intégrés. Les apps tournent **localement sur l'appareil de l'utilisateur**, en full P2P. Les utilisateurs détiennent les clés de leurs actifs, mais aussi de leurs données et des apps elles-mêmes.

### Points différenciants vs blockchain classique

- **Pas de blocs** → pas de traitement séquentiel, pas de goulots d'étranglement
- **Pas de mempool** → empêche le frontrunning
- **Pas de dépendances externes** → tout tourne sur le réseau comme subnets
- **Interopérabilité universelle** → exécution bi-directionnelle cross-chain sans bridges
- **Contract Royalties** → les déployeurs gagnent 25% de chaque tx passant par leurs contrats (0.0075 $trac/tx)
- **App-Gas** → possibilité d'installer n'importe quel token de n'importe quelle chain comme gas
- **Gasless AI** → communication AI sans gas, contrats consommant du langage naturel

---

## 2. Architecture et fonctionnement

> **Source** : https://docs.trac.network/documentation/trac-network/how-does-it-work

### How Does It Work?

Trac Network — contrairement aux blockchains traditionnelles — **n'utilise pas de blocs** pour traiter les transactions. Il fonctionne avec un **flux constant de transactions** qui sont validées en peer-to-peer et réglées sur des **ledgers décentralisés**. La topologie de Trac Network permet un règlement quasi-instantané et une meilleure expérience utilisateur. Trac Network utilise des **DAGs** (Directed Acyclic Graphs) ainsi que des **horloges distribuées** (distributed clocks) pour maintenir un ordre linéarisé et causal des messages réseau.

### Décentralisation

> **Source** : https://docs.trac.network/documentation/trac-network/decentralization

Le règlement des transactions et l'exécution des smart contracts sont **séparés** :

- Les **transactions** sont effectuées par le **Main Settlement Bus (MSB)**
- Les **validators MSB** acceptent les requêtes de transaction et les signent
- Les **opérations smart contract** sont exécutées par les nœuds individuels du réseau (les apps)
- Le **consensus est séparé** entre le MSB et les apps
- Les apps représentent leur **propre réseau** et utilisent leur **propre consensus** pour régler les opérations smart contract

C'est un point d'architecture fondamental : le MSB et les apps ont chacun leurs propres mécanismes de consensus indépendants.

### Cryptographie

> **Source** : https://docs.trac.network/documentation/trac-network/cryptography

Toutes les transactions sont signées et vérifiées en utilisant l'algorithme **EdDSA-based ed25519**. Cela permet des transactions sécurisées et une vérification rapide à travers tout le réseau. Trac Network utilise les bibliothèques **libsodium natives** pour assurer les résultats les plus rapides possibles lors de l'exécution.

| Élément | Détail |
|---|---|
| Algorithme de signature | **EdDSA / ed25519** |
| Bibliothèque | **libsodium** (natif) |
| Package recommandé pour wallets | `micro-key-producer/slip10.js` (clés ed25519) |

### Flux de transaction (Transaction Flow)

> **Source** : https://docs.trac.network/documentation/trac-network/transaction-flow

Le flux de transaction suit ces étapes précises :

1. Les **apps** demandent à un **validator MSB** de faire valider une transaction pour une opération smart contract
2. Le validator MSB **vérifie la requête** — et si elle est valide — **signe et ajoute** la transaction sur le **ledger MSB décentralisé**
3. L'app **attend que la transaction soit finalisée** par le consensus MSB, puis **exécute l'opération smart contract**
4. Le **résultat de l'opération** est signé et ajouté sur le **ledger décentralisé de l'app** si le consensus approuve le résultat

> **Important** : Il y a donc **deux ledgers décentralisés** en jeu — celui du MSB (transactions) et celui de l'app (résultats des opérations smart contract).

### Consensus

> **Source** : https://docs.trac.network/documentation/trac-network/consensus

Le consensus est atteint sur la base d'une **majorité 51% à double preuve** (double-proof) pour les transactions ainsi que pour les opérations smart contract.

Les **nœuds de consensus** sont indépendants et appelés **indexers**. Le MSB et les apps utilisent chacun **leur propre ensemble d'indexers**. En plus du consensus, les indexers maintiennent un **index complet** et gèrent l'**ordre causal** des messages réseau.

Tout autre nœud est appelé **writer** ou **reader** et opère en mode **sparse** : seules les données d'intérêt sont partagées et utilisées à travers le réseau.

| Type de nœud | Rôle |
|---|---|
| **Indexer** | Nœud de consensus — maintient l'index complet et l'ordre causal |
| **Writer** | Nœud qui peut écrire des transactions (mode sparse) |
| **Reader** | Nœud qui consomme des données validées (mode sparse) |

### Main Settlement Bus (MSB)

Le MSB est la couche de validation centrale. Il ne fait **pas** les trades ou les calculs — il valide, signe et ordonne les transactions. Seules les transactions signées par le MSB sont acceptées par les smart contracts des nœuds.

### Résumé de l'architecture à deux couches

```
┌─────────────────────────────────────────────────┐
│                  COUCHE MSB                      │
│  (Transaction Settlement)                        │
│                                                   │
│  Validators → Vérifient & signent les tx          │
│  Indexers MSB → Consensus 51% double-proof        │
│  Ledger MSB → Stocke les tx validées              │
├─────────────────────────────────────────────────┤
│                  COUCHE APP                       │
│  (Smart Contract Execution)                       │
│                                                   │
│  Nodes/Apps → Exécutent les contrats localement   │
│  Indexers App → Consensus propre à l'app          │
│  Ledger App → Stocke les résultats des opérations │
│  Writers → Soumettent des transactions            │
│  Readers → Consomment les données validées        │
└─────────────────────────────────────────────────┘
```

---

## 3. Concepts clés et terminologie

> **Source** : https://docs.trac.network/documentation/trac-network/terminology

### Correspondance Trac Network ↔ Blockchains traditionnelles

| Trac Network | Équivalent Blockchain | Description |
|---|---|---|
| **Main Settlement Bus (MSB)** | Transaction ledger | Ledger de transactions |
| **Apps** | Smart Contract ledgers | Ledgers de smart contracts |
| **Indexers** | Archive nodes | Nœuds de consensus + index complet + ordre causal |
| **Writers** | Full nodes (validators) / Light nodes (apps) | Nœuds qui écrivent des transactions |
| **Readers** | Read-only nodes | Nœuds lecture seule (stats, apps tierces) |

> **Important** : Le MSB et les Apps peuvent chacun utiliser des Indexers, Writers et Readers.

### Termes spécifiques Trac

| Terme | Définition |
|---|---|
| **MSB** (Main Settlement Bus) | Bus de règlement principal — couche de validation qui ordonne et signe les transactions |
| **App3** | Application décentralisée nouvelle génération : contrat, wallet et nœud intégrés, tournant localement |
| **Bootstrap** | Le nœud initial qui initialise un réseau de contrat |
| **Feature** | Module/oracle pouvant étendre un smart contract sans redéploiement |
| **Store** | Base de données locale d'un nœud/validator (ex: `stores/store1`) |
| **Trac Key** | Clé maître d'un validator pour tous les futurs gains sur le réseau |
| **Trac ID** | Identifiant unique d'un utilisateur sur Trac Network (sans KYC) |
| **Contract Royalties** | Récompenses en $trac pour les déployeurs de contrats (25% des frais) |
| **App-Gas** | Possibilité d'utiliser n'importe quel token comme gas dans une app |
| **HyperTokens** | Standard de tokens natif de Trac Network |
| **Trac Chat / Intercom** | Protocole de messagerie P2P sans gas |
| **DAG** | Directed Acyclic Graph — structure de données utilisée au lieu de blocs |
| **Distributed Clocks** | Horloges distribuées pour l'ordre causal des messages |
| **Double-proof** | Mécanisme de consensus à double preuve (51% majorité) |
| **$trac** | Token natif/gas de Trac Network (issu de la migration BRC-20) |
| **$TAP** | Token du TAP Protocol (récompenses validators) |

### Transaction Performance

> **Source** : https://docs.trac.network/documentation/trac-network/transaction-performance

Les chiffres de performance ci-dessous sont déterminés avec un **setup réseau défensif** (conservateur). Trac Network augmentera progressivement les limites avec les optimisations et la demande.

| Métrique | Formule / Valeur |
|---|---|
| **TPS théorique** | `apps × validators × 1000` |
| **TPS** | `apps × 1000` |
| **TX Finality** | **100 tx/s** |
| **Bottleneck** | La finalité peut augmenter linéairement au-delà de 100 tx/s |

> **Philosophie** : Contrairement aux stats blockchain classiques, Trac considère la **TX Finality** comme la métrique la plus importante et la favorise par rapport au TPS brut.

### Reorgs

> **Source** : https://docs.trac.network/documentation/trac-network/reorgs

Les reorgs (réorganisations) sont une tâche typique pour atteindre le consensus sur des ledgers décentralisés. Trac Network n'y fait pas exception. Cependant, puisqu'il n'y a **pas de blocs**, seules des **transactions individuelles** peuvent être réorganisées. Une fois finalisées, elles sont **garanties de ne plus changer**. Dans le setup défensif actuel, 100 tx/s sont finalisées, offrant une expérience quasi-instantanée.

### Transaction Fees (Mainnet)

> **Source** : https://docs.trac.network/documentation/trac-network/transaction-fees

Pour le mainnet, les frais sont structurés comme suit :

**0.03 $trac / tx** (flat)

| Part | Allocation |
|---|---|
| **50%** | Récompenses validators |
| **25%** | Récompenses contract deployers |
| **25%** | Réservé pour future mise à jour (récompenses indexers). **Burned jusqu'à activation.** |

> ⚠️ **Note** : La doc technique officielle indique 0.03 $trac/tx. Le site marketing mentionne 0.01 $TNK/tx — la référence officielle est la doc.

### Inflation / Deflation Rate

> **Source** : https://docs.trac.network/documentation/trac-network/inflation-deflation-rate

Les validators sont récompensés avec des $trac qui sont **individuellement minés par validator** et par transaction traitée.

Combiné avec le mécanisme de **burning**, le taux d'inflation/déflation ciblé est de **max 2%/an**.

> Cette partie est encore en développement et sera mise à jour.

### Why Flat Fees?

> **Source** : https://docs.trac.network/documentation/trac-network/why-flat-fees

Puisque le MSB est **uniquement responsable du traitement et stockage des transactions** (pas de l'exécution des smart contracts), il n'y a **pas besoin d'augmenter les frais réseau**. Les contract deployers sont récompensés pour les transactions passant par leurs contrats vers le MSB, car ils **font partie de l'infrastructure**.

Le **burning de $trac** augmentera son prix contre d'autres actifs (comme les stables), utilisant ainsi les **règles classiques du marché (offre/demande)** comme moyen naturel de contrôler le taux de transactions.

### The Reward & Compete Principle

> **Source** : https://docs.trac.network/documentation/trac-network/the-reward-and-compete-principle

L'objectif de Trac Network étant de devenir le réseau crypto avec la **finalisation la plus rapide**, il est crucial que les validators et app deployers fournissent une performance suffisante :

- Leurs nœuds doivent avoir le **moins de downtime possible**
- Leur **connectivité réseau** doit être suffisante

Les récompenses sont généreuses mais ne sont accordées que sous les **règles de compétition** :

**Marché Validator → User (B2C) :**
- Les apps et users peuvent **choisir individuellement les validators** pour faire valider leurs transactions
- C'est similaire à broadcaster des transactions dans le mempool d'un pool de mining Bitcoin spécifique
- Les validators cherchent à atteindre la **meilleure performance** et se font concurrence sur la disponibilité et la qualité
- Les identités de licences individuelles peuvent être **groupées en pools**, ouvrant des opportunités de marché pour les validator pools

**Marché Validator → Deployer (B2B) :**
- Les validators peuvent décider d'aider à valider un réseau d'app et se faire concurrence sur les apps les plus performantes pour des récompenses additionnelles
- Les app deployers peuvent demander aux **meilleurs validators** d'aider à valider leurs apps en échange de récompenses supplémentaires

**Marché Consumer (B2C apps) :**
- Les users peuvent **choisir une app** en fonction de sa disponibilité et qualité globale, contribuant fortement au succès de l'app

---

## 4. Système de Validators

### Rôle

Les validators sont essentiels pour Trac Network — ils **valident et vérifient les transactions entrantes** des utilisateurs d'apps dans le Main Settlement Bus. Ces transactions signalent les smart contracts des apps pour traiter les opérations.

### Principes "Reward & Compete"

- **Pas de slashing** — pas de punition
- **Que des incitations** — gagner basé sur la performance
- **Compétition fair** — les validators rivalisent sur uptime et réactivité
- **Multi-subsidy** — chaque app peut offrir ses propres récompenses tokens aux validators

### Requirements

- **Licence** obligatoire (max 3000 licences distribuées en plusieurs rounds)
- Les licences sont achetées en $TRAC (BRC-20), les prix augmentent à chaque round
- Les licences sont transférables et revendables
- Les détenteurs gagnent **en perpétuité**

### Rounds de prix des licences

| Round | Prix |
|---|---|
| 1 | 300 $TRAC |
| 2 | 500 $TRAC |
| 3 | 700 $TRAC |
| 4 | 1,000 $TRAC |
| 5 | 1,500 $TRAC |
| 6 | 2,000 $TRAC |
| 7 | 3,500 $TRAC |
| 8 | 5,000 $TRAC |
| 9 | 7,500 $TRAC |
| 10 | 10,000 $TRAC |

### Hardware Specs

> **Source** : https://docs.trac.network/documentation/validators/hardware-specs

**OS supportés** : Linux, Windows, MacOS

**Minimum (max. 2 validators) :**

| Composant | Spec |
|---|---|
| CPU | 4-8 Cores |
| RAM | 8-16 GB |
| Stockage | 250-500 GB SSD (NVMe préféré) |
| Réseau | ISP maison P2P-friendly |

**Recommandé (max. 4 validators) :**

| Composant | Spec |
|---|---|
| CPU | 8+ Cores |
| RAM | 16 GB+ |
| Stockage | 500 GB NVMe |
| Réseau | Data Center / 1Gbit |
| Serveur | Metal recommandé, VMs OK si performance garantie |

### Installation du MSB (Validator)

#### Prérequis
- **Node.js v22+**
- **Pear Runtime** (recommandé)

#### Installation rapide (Linux/MacOS)

```bash
# Installer Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 22

# Installer Pear Runtime
npm i -g pear
pear -v

# Créer et entrer dans le répertoire
mkdir my-msb && cd my-msb

# Option 1 : Installation décentralisée
pear run pear://h17deo6fwaats9x5jupx8m337yypnbgssge46t8k1ysxz6fxqnuy store1

# Option 2 : Installation manuelle
npm install trac-msb@1.0.29
cp -fr node_modules/trac-msb/* .
npm install
pear run . store1
```

#### Installation (Windows)

```powershell
Set-ExecutionPolicy Unrestricted
winget install Schniz.fnm
fnm env --use-on-cd | Out-String | Invoke-Expression
fnm install 22

npm i -g pear
pear -v

# Créer un dossier "my-msb" dans l'explorateur
cd my-msb
```

#### Post-Installation

1. Au premier démarrage, taper `1` pour afficher la seed phrase → **la sauvegarder impérativement**
2. Le fichier `stores/store1/db/keypair.json` contient la seed phrase
3. Pour stopper : taper `/exit` (ne PAS utiliser Ctrl+C sauf en dernier recours)

#### Whitelisting

1. Garder son wallet Bitcoin à portée
2. Aller sur https://onboarding.tracvalidator.com/
3. Suivre les instructions pour swapper les licences Bitcoin vers les identités Trac Network
4. Attendre le traitement (jusqu'à 24h)
5. Redémarrer le MSB et taper `/add_writer`

#### Instances multiples

- Chaque licence = une identité = un store différent (`store1`, `store2`, etc.)
- **Ne jamais lancer le même store deux fois** → cause du "chatter" (connexions/déconnexions permanentes)

#### Lancement en background avec PM2

```bash
npm install -g pm2
pm2 start pear --name "My MSB #1" --no-autorestart -- run . store1
```

⚠️ **Toujours utiliser `--no-autorestart`** avec PM2.

#### Gains

- Les validators HyperMall gagnent **50% de tous les frais de trading** de l'app
- Sur le mainnet Trac : les validators gagnent **50% des 0.03 $trac/tx** (soit 0.015 $trac/tx) + $trac minés individuellement
- Les Trac Keys seront utilisables pour gagner des récompenses sur **toutes les apps du réseau**

### Installation MSB — Mainnet

> **Source** : https://docs.trac.network/documentation/validators/installation/mainnet

L'installation Mainnet est similaire à celle d'Hypermall, mais avec des différences clés.

> ⚠️ **IMPORTANT** : Ne PAS appliquer le setup mainnet dans les dossiers trac-msb d'Hypermall. Utiliser un dossier séparé (`my-validator` au lieu de `my-msb`) pour éviter les collisions.

#### Différences clés vs Hypermall

| Aspect | Hypermall | Mainnet |
|---|---|---|
| Dossier | `my-msb` | `my-validator` |
| Pear hash décentralisé | `pear://h17deo6f...` | `pear://6rpmo1bs...` |
| Version MSB | `trac-msb@1.0.29` | `trac-msb@2.0.5` |
| Commande de lancement | `pear run . store1` | `npm run prod --store=store1` |
| Format adresse | Raw public key | `trac1...` (adresse Trac Network) |
| PM2 flag | `--no-autorestart` | pas de `--no-autorestart` mentionné |

#### Installation rapide (Linux/MacOS)

```bash
# Créer et entrer dans le dossier (SÉPARÉ d'Hypermall!)
mkdir my-validator && cd my-validator

# Option 1 : Installation décentralisée
pear run pear://6rpmo1bsedagn4u56a85nkzkrxcibab53d7sgds7ukn6kfyzgiwy store1

# Option 2 : Installation manuelle
npm install trac-msb@2.0.5
cp -fr node_modules/trac-msb/* .
npm install
npm run prod --store=store1
```

#### Whitelisting Mainnet

- Si tu as déjà whitelist pour Hypermall, **il faut refaire le whitelist** pour l'adresse MSB mainnet (`trac1...`)
- Il faut un montant minimal de **$TNK** (< 1 $TNK) pour compléter le whitelist
- Si tu n'as pas de $TNK : demander à l'équipe sur le Discord Trac Network
- URL onboarding : https://onboarding.tracvalidator.com/

#### Wallet intégré

Le validator mainnet inclut des fonctions wallet intégrées :
- **`/get_balance <MSB Address>`** — vérifier les gains
- **`/transfer`** — transférer des fonds

> ⚠️ **Ne JAMAIS retirer tous les $TNK du wallet validator** — laisser au minimum **0.33 $TNK**. C'est une mesure de sécurité réseau.

#### PM2 pour le background (Mainnet)

```bash
pm2 start pear --name "My MSB #1" -- run . store1
```

---

## 5. Développement — Smart Contracts

### Architecture développeur — deux environnements

> **Source** : https://docs.trac.network/documentation/developers

Trac Network offre **deux environnements** de développement :

| | **Gasless Net (R1)** | **Mainnet** |
|---|---|---|
| **Gas** | Gratuit (gasless) | 0.03 $trac/tx |
| **Rewards validators** | Non (incentives via l'app) | Oui ($trac) |
| **Subnets** | Indépendants | Réseau principal |
| **Inter-contract comm.** | Non (pas encore) | À venir |
| **Token standards** | Non recommandé | À venir |
| **Statut** | Disponible maintenant | Disponible maintenant |
| **Post-mainnet** | Continue de fonctionner | — |

> **Concept clé** : Les subnets R1 sont **indépendants** du mainnet. Utiliser R1 si l'app n'a pas besoin de la puissance de validation complète du mainnet. Les apps R1 continuent de fonctionner après le lancement mainnet.

#### Cas d'usage R1 (non exhaustif)

- **Interoperability Layers** : cross-chain comm., marketplaces, staking, lending (DeFi), RWA, bridges, co-processing, L2-apps, oracles
- **L1s & L2s & Rollups** : créer des infras crypto entières sur un seul subnet
- **Chats / Social Networks** : étendre le chat intégré via smart contracts, agents AI, réseaux sociaux décentralisés
- **Content** : achat/vente de contenu, rendering (jeux, sites, livres), création décentralisée
- **Gaming** : multiplayer, metaverse, récompenses in-game & marketplaces

> ⚠️ **Ne PAS utiliser R1 pour créer des standards de tokens/collectibles** — pas d'inter-contract communication implémentée. Disponible dans les releases suivantes et mainnet.

---

### 5a. Développement R1 (Gasless Net)

> **Sources** :
> - https://docs.trac.network/documentation/developers/gasless-net-r1
> - https://docs.trac.network/documentation/developers/gasless-net-r1/contracts
> - https://docs.trac.network/documentation/developers/gasless-net-r1/features
> - https://docs.trac.network/documentation/developers/gasless-net-r1/messaging
> - https://docs.trac.network/documentation/developers/gasless-net-r1/deployment
> - https://docs.trac.network/documentation/developers/gasless-net-r1/custom-validators

#### Vue d'ensemble R1

R1 est prêt pour la production et partage la plupart des fonctionnalités du mainnet à venir. **Mainnet n'invalidera pas les apps R1** — ce release restera maintenu (HyperMall est construit dessus).

**Différences clés R1 vs Mainnet :**
- Gas : **gratuit** (pas de frais de transaction)
- Rewards validators : pas natifs (les projets incentivisent eux-mêmes, ex: HyperMall 50% trading fees)
- Pas d'inter-contract communication (pas de token standards encore)
- Subnets indépendants du mainnet

**Pourquoi Trac Network :**
- Fast transaction finality (consensus au niveau TX individuel, pas de blocs)
- App3 : apps natives (Desktop/Mobile) + Web3 compatible
- True P2P : self-custody intégré, chaque participant exécute les contrats
- Ledger distribué sparse (données demandées quand nécessaires)

**Le réseau :**
- Réseau P2P pur, pas de blockchain traditionnelle
- Flux de transactions (pas de blocs)
- Ledger partagé mais distribué sparse — indexers = archive nodes
- Subnets détachés encouragés (restent connectés aux validators)

**Processus de développement :**
- **Langage** : JavaScript
- **Packages** : Node.js compatible
- **Runtime** : [Pear](https://pears.com/) pour distribution décentralisée
- **Coût de déploiement** : Gratuit
- Validators "empruntables" au projet principal, ou réseau custom

---

#### Contracts (Protocol + Contract)

> **Source** : https://docs.trac.network/documentation/developers/gasless-net-r1/contracts

Les smart contracts consistent en **deux éléments** :
1. **Protocol** — dit au peer comment passer les données TX et comment se comporter
2. **Contract** — la logique du contrat, "écoute" les termes du protocol

**Structure d'un projet :**
```
trac-contract-example/
├── contract/
│   ├── protocol.js      # Framework du contrat (étend Protocol)
│   └── contract.js       # Le contrat lui-même (étend Contract)
├── features/
│   └── timer/
│       └── index.js      # Feature/oracle pour le contrat
├── src/                   # Code source additionnel
├── index.js               # Setup principal de l'app contract
├── index.html             # Interface desktop (App3)
├── desktop.js             # Logique desktop
└── package.json           # Config (type: terminal ou desktop)
```

##### Protocol (protocol.js)

Étend `Protocol` de `trac-peer`. Responsabilités :

**`constructor(peer, base, options)`** — accès à :
- `this.peer` : instance du Peer complet
- `this.base` : moteur DB — `await this.base.view.get('key')` pour données non-signées
- `this.options` : stack d'options du Peer

**`mapTxCommand(command)`** — mapping TX command → fonction contrat :
- Reçoit une string command
- Retourne `{ type: 'functionName', value: data }` ou `null` si pas de match
- Le `type` pointe sur la fonction du contrat à exécuter
- Le `value` peut être `null` (doit exister comme propriété)
- Sanitization basique possible ici, mais préférer les schemas dans le contrat

**Exécution TX en terminal :**
```
/tx --command 'something'
/tx --command 'something' --sim 1          # simulation
/tx --command '{ "op": "do_something", "some_key": "some_data" }'
```

**Exécution TX programmatique :**
- Activer `api_tx_exposed: true` dans les options Peer
- Utiliser `peer.protocol_instance.api.tx()`

**`extendApi()`** — étend l'API built-in :
```javascript
async extendApi(){
    this.api.getSampleData = function(){ return 'Some sample data'; }
}
```

**`printOptions()`** — affiche options custom dans le terminal

**`customCommand(input)`** — étend les commandes terminal système :
```javascript
async customCommand(input) {
    await super.tokenizeInput(input);
    if (this.input.startsWith("/print")) {
        const splitted = this.parseArgs(input);
        console.log(splitted.text);
    }
}
```

##### Contract (contract.js)

Étend `Contract` de `trac-peer`. Responsabilités :

**⚠️ RÈGLES STRICTES du contrat (déterminisme) :**
- Pas de `try-catch`
- Pas de `throw`
- Pas de valeurs aléatoires (`Math.random()`)
- Pas de HTTP / API calls
- Pas de calculs super complexes/coûteux
- Pas de stockage massif de données
- **JAMAIS** modifier `this.op` ou `this.value` — utiliser `safeClone` pour modifier
- Pas d'inter-contract communication (R1)

**`constructor(protocol, options)`** — accès à :
- `this.protocol` : instance du Protocol
- `this.options` : stack d'options

**Enregistrement de fonctions :**

```javascript
// Simple (sans validation de payload) :
this.addFunction('storeSomething');

// Avec schema de validation (recommandé pour données entrantes) :
this.addSchema('submitSomething', {
    value : {
        $$strict : true,
        $$type: "object",
        op : { type : "string", min : 1, max: 128 },
        some_key : { type : "string", min : 1, max: 128 }
    }
});
```
- Le validateur de schema est `fastest-validator` (npm)
- `$$strict: true` force la structure exacte

**Enregistrement de Features (oracles) :**
```javascript
this.addFeature('timer_feature', async function(){
    if(false === _this.validateSchema('feature_entry', _this.op)) return;
    if(_this.op.key === 'currentTime') {
        await _this.put(_this.op.key, _this.op.value);
    }
});
```
- Convention de nommage : `<feature-name>_feature`

**Message Handler (chat intégré) :**
```javascript
this.messageHandler(async function(){
    console.log('message triggered contract', _this.op);
});
```

**Fonctions contrat — API de stockage :**
- `await this.get('key')` — lecture (retourne `null` si absent)
- `await this.put('key', value)` — écriture (atomique — si interruption, pas exécuté)
- `this.address` — adresse de l'expéditeur de la TX
- `this.value` — payload de la TX (lecture seule !)
- `this.op` — opération courante (lecture seule !)

**Utilitaires safe :**
- `this.protocol.safeBigInt("1000000000000000000")` — BigInt safe (retourne `null` si échec)
- `this.protocol.fromBigIntString(bigint.toString(), 18)` — BigInt → décimal string
- `this.protocol.toBigIntString(decimal, 18)` — décimal → BigInt string
- `this.protocol.safeClone(this.value)` — clone safe (attention false-positives si `null` passé)
- `this.protocol.safeJsonStringify(obj)` — stringify safe (retourne `null` si échec)
- `this.protocol.safeJsonParse(str)` — parse safe (retourne `undefined` si échec, pas `null`)
- `this.assert(condition, error)` — assertion (toujours utiliser `this.assert`)

**Bonnes pratiques contrat :**
- Tous les `this.put()` à la **fin** de l'exécution (éviter problèmes de sécurité)
- Vérifier `null` avant `put` (éviter doublons)
- Utiliser `this.assert` pour valider les conditions
- Benchmarker les performances avant release

---

#### Features (Oracles)

> **Source** : https://docs.trac.network/documentation/developers/gasless-net-r1/features

Les Features sont des **oracles multiplex** pour les contrats. Elles injectent des données externes dans le contrat sans passer par les transactions.

**Classe Feature (étend `Feature` de `trac-peer`) :**

```javascript
import {Feature} from 'trac-peer';

export class Timer extends Feature {
    constructor(peer, options = {}) {
        super(peer, options);
        this.update_interval = options.update_interval || 60_000;
    }

    // start() déclenche l'exécution de la Feature
    async start(options = {}) {
        while(true){
            await this.append('currentTime', Date.now());
            await this.sleep(this.update_interval);
        }
    }

    // stop() pour shutdown propre
    async stop(options = {}) { }
}
```

**Points clés :**
- `this.append(key, value)` — injecte directement dans le contrat (PAS via transaction)
- Instances de Features passées au Peer lors du setup
- Exécutées par l'admin (habituellement le Bootstrap)
- On peut ajouter autant de Features qu'on veut
- Le contrat consomme les données via `this.addFeature()` (voir section Contract)

---

#### Messaging (Chat intégré)

> **Source** : https://docs.trac.network/documentation/developers/gasless-net-r1/messaging

Les Trac Peers ont leur propre infrastructure de chat/messaging intégrée. Les messages sont directement traités par le smart contract.

**Activation (admin seulement) :**
```
/set_chat_status --enabled 1
```

**Utilisation :**
```
/post --message "hi"
/set_nick --nick "Peter"
```

**Caractéristiques :**
- Les messages ne passent **pas** par les transactions — ils sont envoyés directement au contrat
- Le contrat intercepte via `this.messageHandler()` (voir section Contract)
- Fournit la base pour des applications sociales riches
- Peut être "contractualisé" (logique métier sur les messages)
- Combinable avec App3 et Web3

**Cas d'usage :** AI agents qui chattent au nom de leurs propriétaires pour trader sur une app.

---

#### Deployment (Déploiement R1)

> **Source** : https://docs.trac.network/documentation/developers/gasless-net-r1/deployment

Le déploiement est **gratuit** — aucun coût de gas. Il suffit d'une machine pour exécuter et distribuer.

**Configuration type (index.js) :**

```javascript
import {getStorePath} from './src/functions.js';
import {App} from './src/app.js';
export * from 'trac-peer/src/functions.js'
import {default as SampleProtocol} from "./contract/protocol";
import {default as SampleContract} from "./contract/contract";
import {Timer} from "./features/timer/index.js";

// MSB SETUP — testnet gasless fourni par Trac
const msb_opts = {};
msb_opts.bootstrap = 'cdcb126766cb2673bc14f3e91be61150504d0f97e5055bbc430193091fe96bba';
msb_opts.channel = '0000000000000000000000examplemsb';
msb_opts.store_name = getStorePath() + '/msb';

// CONTRACT SETUP
const peer_opts = {};
peer_opts.protocol = SampleProtocol;
peer_opts.contract = SampleContract;
peer_opts.bootstrap = '0000...0000';  // remplacer par la clé Peer Writer
peer_opts.channel = '0000000000000000000000000example';  // exactement 32 caractères
peer_opts.store_name = getStorePath() + '/example';
peer_opts.api_tx_exposed = true;
peer_opts.api_msg_exposed = true;

// FEATURES (oracles)
const timer_opts = {};
timer_opts.update_interval = 10_000;

export const app = new App(msb_opts, peer_opts, [
    { name: 'timer', class: Timer, opts: timer_opts }
]);
await app.start();
```

> **Note** : Pour l'exemple, pas besoin de MSB custom — le bootstrap MSB testnet gasless est fourni.

**Installation :**
```bash
git clone git@github.com:Trac-Systems/trac-contract-example.git
cd trac-contract-example
npm install -g pear
npm install
pear run . store1
```

**Déploiement Bootstrap (admin) :**
1. Démarrer → Choisir option `1)`
2. Copier et **sauvegarder** la seedphrase
3. Copier la clé "Peer Writer" (= adresse du contrat)
4. Ouvrir `index.js` → remplacer le bootstrap par la clé writer copiée
5. Choisir un channel name (**exactement 32 caractères**)
6. `/exit` puis relancer : `pear run . store1`
7. Taper `/add_admin --address VotrePeerWriterKey`
8. L'instance est maintenant le Bootstrap et admin du réseau

**Indexers (fortement recommandé) :**
- Installer sur des machines **différentes** du Bootstrap (idéalement différents datacenters)
- Au démarrage, copier la clé "Peer Writer"
- Dans le Bootstrap : `/add_indexer --key LaClefWriterDeLIndexer`
- **Recommandé : 2 à max 4 indexers** en plus du Bootstrap

**Permettre à d'autres de rejoindre :**
- Par défaut, auto-join désactivé
- Pour activer : `/set_auto_add_writers --enabled 1` dans le Bootstrap
- Les peers rejoignent avec le même setup dans `index.js`

### Mode App3 (Desktop)

Pour transformer en app desktop avec UI :
1. Dans `package.json` : `"main": "index.js"` → `"main": "index.html"`
2. Dans la section "pear" : `"type": "terminal"` → `"type": "desktop"`
3. Lancer : `pear run -d . store1` (`-d` = console dev)

### Mode Web3 (Serveur)

Pour un contrat qui tourne comme serveur (pas app installable) :
```javascript
peer_opts.api_tx_exposed = true;   // Exposer l'API transactions
peer_opts.api_msg_exposed = true;  // Exposer l'API messages
```
Les wallets web soumettent des transactions via le serveur.

---

#### Custom Validators (MSB R1)

> **Source** : https://docs.trac.network/documentation/developers/gasless-net-r1/custom-validators

Un MSB est nécessaire pour tout contrat qui exécute des transactions smart contract. Les MSBs doivent être peuplés (whitelistés) avec des validators. Chaque validator tourne une instance du MSB.

**Un projet R1 doit incentiviser ses validators** (ex: HyperMall → 50% trading fees). La communauté de validators sur [Discord](https://discord.com/invite/trac) peut être intéressée par de nouveaux projets.

**Installation MSB R1 :**
```bash
git clone -b msb-r1 --single-branch git@github.com:Trac-Systems/main_settlement_bus.git
cd main_settlement_bus
npm install -g pear
npm install
pear run . store1
```

> **Note** : la branche `msb-r1` est spécifique à R1. Le mainnet utilise la branche principale.

**Déploiement MSB Bootstrap (admin) :**
1. Choisir option `1)`
2. Copier et **sauvegarder** la seedphrase
3. Copier l'adresse "MSB Writer"
4. Ouvrir `msb.mjs` → remplacer le bootstrap par l'adresse writer copiée
5. Choisir un channel name (**exactement 32 caractères**)
6. Relancer : `pear run . store1`
7. Taper `/add_admin`
8. L'instance est le Bootstrap et admin MSB
9. **Fortement recommandé** : ajouter des nœuds writers

**Ajouter des Indexers MSB (admin) :**
- Installer sur des machines différentes du Bootstrap
- Suivre la procédure "Running as validator" + "Adding validators" ci-dessous
- Copier l'adresse MSB Writer de l'indexer
- Dans le Bootstrap : `/add_indexer <MSB Writer address>` (PAS l'adresse MSB !)
- Recommandé : 2 à 4 indexers

**Running as validator (première exécution) :**
1. Choisir option `1)`
2. Copier et sauvegarder la seedphrase
3. Copier l'**"MSB Address"** (pas le Writer !)
4. Envoyer cette "MSB Address" à l'admin MSB pour whitelisting
5. Attendre l'annonce de la whitelist
6. Taper `/add_writer`
7. Après quelques secondes → confirmation d'ajout comme writer

**Adding validators (admin) :**
1. Ouvrir `/Whitelist/pubkeys.csv` avec un éditeur
2. Ajouter les adresses Trac Network à whitelister
3. Dans le MSB : `/add_whitelist`
4. Attendre le traitement complet
5. Informer la communauté validator

---

### Bibliothèque de signatures recommandée

Pour créer des wallets d'identité côté web3 :
```
micro-key-producer/slip10.js (clés ed25519)
```
Package npm : https://www.npmjs.com/package/micro-key-producer

### API intégrée (R1)

Toutes les fonctions API built-in se trouvent dans : `trac-peer/src/api.js`
Les fonctions API custom par app sont dans `/contract/protocol.js`.

---

### 5b. Développement Mainnet

> **Source** : https://docs.trac.network/documentation/developers/mainnet

Le développement mainnet comprend 3 composants clés :
1. **Wallet API** — interface pour les dApps
2. **dApp Developer Guide** — guide complet de développement
3. **Main Settlement Bus** — documentation MSB pour développeurs

#### Wallet API

> **Source** : https://docs.trac.network/documentation/developers/mainnet/wallet-api

L'API Wallet est conçue pour que les dApps puissent :
- Connecter le wallet utilisateur
- Lire identité + balance
- Signer des messages
- Construire/signer/pousser des transferts TNK
- Signer des transactions de **contrats** (pour `trac-peer`)

**Conventions :**
- Toutes les méthodes sont async (retournent des Promises)
- Hex strings : lowercase/uppercase tolérés
- Adresses : bech32m avec préfixe `trac1...`
- Montants/balances : retournés comme strings (plus petite unité / integer strings)

**Namespace : `window.tracnetwork`**

| Méthode | Description | Retour |
|---|---|---|
| `requestAccount()` | Connecte le wallet, retourne l'adresse | `Promise<string>` |
| `getAddress()` | Adresse actuellement connectée | `Promise<string>` |
| `getBalance()` | Balance TNK du compte connecté | `Promise<string>` (ex: `"938000000000000000"`) |
| `getNetwork()` | Réseau actuel (`"livenet"` ou `"testnet"`) | `Promise<string>` |
| `switchNetwork(network)` | Change de réseau (`"livenet"`, `"mainnet"`, `"testnet"`) | `Promise<string>` |
| `getPublicKey()` | Clé publique hex (32 bytes / 64 hex chars) | `Promise<string>` |
| `signMessage(message)` | Signe un message arbitraire | `Promise<{ signature, publicKey, address }>` |
| `sendTNK(from, to, amount)` | Transfert TNK (helper haut niveau) | `Promise<{ txHash, success }>` |
| `buildTracTx({ from?, to, amount })` | Construit et signe un transfert TNK, retourne payload broadcastable | `Promise<string>` (base64) |
| `pushTracTx(txPayload)` | Pousse un payload signé sur le réseau | `Promise<{ txHash, success }>` |
| `signTracTx(contractTx)` | Signe une **transaction de contrat** (pour `trac-peer`) | `Promise<{ tx, signature }>` |

**Exemple — Transfert TNK complet :**

```javascript
// Connecter le wallet
const address = await window.tracnetwork.requestAccount();
// → "trac1wnky35sgxefesuja46yvyf3tmf7pneeqv3ns5pk5pjlzu082f23s4r7923"

// Vérifier la balance
const balance = await window.tracnetwork.getBalance();
// → "938000000000000000"

// Envoyer des TNK (méthode simple)
const res = await window.tracnetwork.sendTNK(fromAddress, toAddress, "1");
// → { txHash: "6f7d901d...", success: true }

// Ou en 2 étapes (build + push)
const txPayload = await window.tracnetwork.buildTracTx({ to: recipient, amount: "1" });
const result = await window.tracnetwork.pushTracTx(txPayload);
```

**Exemple — Signature de transaction contrat :**

```javascript
const signed = await window.tracnetwork.signTracTx({
  prepared_command: { type: "catch", value: {} },
  nonce: "<hex32>",
  context: {
    networkId: 918,
    txv: "<hex32>",
    iw: "<hex32>",
    bs: "<hex32 | optional>",
    mbs: "<hex32>"
  }
});
// → { tx: "<hex32>", signature: "<hex64>" }
```

> **Note** : L'API est basée sur l'implémentation de référence dans `tap-wallet-extension` (branche main). Le `networkId` mainnet est **918**.

---

#### dApp Developer Guide

> **Source** : https://docs.trac.network/documentation/developers/mainnet/dapp-developer-guide
> 12 sous-pages : Introduction, Quickstart, MSB Local Setup, Bootstrap Checklist, Subnets & Roles, Running Peer, RPC API v1, Wallet & dApp, App Dev, References/Examples, Troubleshooting, Production Notes

##### Concepts fondamentaux (Introduction)

**Qu'est-ce que `trac-peer` ?**
`trac-peer` fait tourner un **subnet** : un réseau P2P plus petit qui maintient un log ordonné et en dérive un état d'application déterministe (contrat/machine à états).

Pour la finalité économique et les règles anti-spam, les transactions sont **réglées sur le MSB** (Main Settlement Bus). Les nœuds du subnet n'exécutent les opérations du contrat localement qu'une fois qu'ils peuvent prouver que la transaction référencée existe dans l'état confirmé du MSB.

**Le modèle mental "doré" :**
Quand un utilisateur "appelle une fonction de contrat", il n'invoque PAS du code à distance. Au lieu de ça :
1. Un client prépare une commande typée `{ type, value }`
2. Le wallet signe le hash de transaction (opération MSB `type = 12`)
3. Le peer le broadcast au MSB (des frais s'appliquent)
4. Une fois que le MSB confirme, le subnet ajoute une op de référence
5. Chaque nœud du subnet exécute la même logique de contrat localement et dérive le même état

**Concepts clés :**

| Concept | Description |
|---|---|
| **MSB** | Couche de règlement. Les transactions deviennent "réelles" quand MSB les confirme |
| **Subnet** | Couche applicative P2P. A un `channel` de découverte + un `bootstrap` (hex 32 bytes) |
| **Protocol** | Définit comment les commandes user mappent en ops typées `{ type, value }` |
| **Contract** | Machine à états déterministe qui exécute ces ops et écrit l'état sous `app/...` |
| **Operator** | Utilise la CLI (admin/writer/indexer/chat/deploy) |
| **Client** | Utilise le RPC (schema/context/state/tx submit si activé) |

##### Quickstart — Du zéro au fonctionnel

**Prérequis :**
- Node.js + npm
- Paramètres réseau MSB : `MSB_BOOTSTRAP` (hex 32 bytes / 64 chars) + `MSB_CHANNEL` (string)
- Un nœud MSB "admin/funded" pour transférer des TNK aux nouvelles adresses

**Étapes rapides :**

```bash
# 1) Installer trac-peer
cd trac-peer && npm install

# 2) Démarrer le premier peer (crée un nouveau subnet)
npm run peer:run -- \
  --msb-bootstrap=<MSB_BOOTSTRAP_HEX32> \
  --msb-channel=<MSB_CHANNEL> \
  --msb-store-name=peer-msb-1 \
  --peer-store-name=peer1 \
  --subnet-channel=tuxedex-v1

# 3) Le peer génère un subnet bootstrap dans :
#    stores/peer1/subnet-bootstrap.hex
cat stores/peer1/subnet-bootstrap.hex

# 4) Funder le peer sur MSB (transférer des TNK à l'adresse affichée "Peer MSB address: trac1...")

# 5) Déployer le subnet (une seule fois par subnet)
/deploy_subnet

# 6) Exécuter une opération démo (Tuxemon)
/tx --command "catch"

# 7) Requêter l'état local du subnet
/get --key app/tuxedex/<your-pubkey-hex> --confirmed false

# 8) Démarrer un second peer (rejoint le subnet existant)
npm run peer:run -- \
  --msb-bootstrap=<MSB_BOOTSTRAP_HEX32> \
  --msb-channel=<MSB_CHANNEL> \
  --msb-store-name=peer-msb-2 \
  --peer-store-name=peer2 \
  --subnet-channel=tuxedex-v1 \
  --subnet-bootstrap=<SUBNET_BOOTSTRAP_HEX32>
```

> **Note :** `confirmed=false` lit la vue locale (non signée) du subnet. `confirmed=true` lit la vue signée du subnet. Ce sont des propriétés du subnet, PAS de la "finalité MSB".

##### MSB Local Setup (pour développeurs)

Pour tourner un MSB localement et tester :

```bash
# Installer le repo MSB
git clone -b main --single-branch git@github.com:Trac-Systems/main_settlement_bus.git
cd main_settlement_bus && npm install

# Lancer un nœud MSB interactif
MSB_STORE=node1 npm run env-prod

# Lancer un nœud MSB RPC (optionnel)
MSB_STORE=rpc-node-store MSB_HOST=127.0.0.1 MSB_PORT=5000 npm run env-prod-rpc

# Mode admin (pour whitelist/init)
MSB_STORE=admin npm run env-prod
```

**Commandes MSB les plus utiles :**

| Catégorie | Commandes |
|---|---|
| **Inspection réseau** | `/stats`, `/confirmed_length`, `/unconfirmed_length`, `/get_fee`, `/get_txv` |
| **Inspection compte** | `/get_balance <address> <confirmed>`, `/node_status <address>` |
| **Funding** | `/transfer <to_address> <amount>` |
| **Déploiement subnet** | `/deployment <subnet_bootstrap_hex32> <channel>`, `/get_deployment <bootstrap>` |
| **Debug TX** | `/get_tx_info <hash>`, `/get_tx_details <hash>`, `/get_extended_tx_details <hash> <confirmed>` |

> ⚠️ **Critique** : Il faut funder CHAQUE adresse MSB de peer ET chaque adresse MSB de wallet utilisateur. Sinon erreurs `Requester address not found in state` ou insufficient fee balance.

##### Bootstrap Checklist — A → Z canonique

**Valeurs à connaître :**

| Nom | Description | Où la trouver |
|---|---|---|
| `MSB_BOOTSTRAP` | 32-byte hex (64 chars) du réseau MSB | Logs MSB / `/stats` (`msb.writerKey`) |
| `MSB_CHANNEL` | String de découverte MSB | Logs/config MSB |
| `SUBNET_CHANNEL` | String de découverte du subnet | Tu choisis (ex: `my-app-v1`) |
| `SUBNET_BOOTSTRAP` | 32-byte hex join-code du subnet | Généré par peer1 → `stores/<peer-store>/subnet-bootstrap.hex` |

**Checklist complète :**
1. Installer trac-peer (`npm install`)
2. Confirmer les paramètres MSB
3. Démarrer peer1 (crée le subnet)
4. Funder peer1 sur MSB
5. Déployer le subnet (`/deploy_subnet`)
6. Devenir admin (`/add_admin --address <pubkey-hex>`)
7. Exécuter une TX démo
8. Démarrer peer2 (join le subnet avec `--subnet-bootstrap`)
9. Activer RPC si besoin (`--rpc --rpc-host 127.0.0.1 --rpc-port 5001`)

##### Subnets, Déploiement et Rôles

**Déploiement subnet (enregistrement MSB) :**
- `/deploy_subnet` → broadcast une opération MSB qui enregistre `bs` (bootstrap) + `ic` (channel)
- Les peers peuvent répliquer sans déployer, mais le MSB preflight attend que le subnet existe en état MSB

**Rôles Autobase :**

| Rôle | Description | Commande |
|---|---|---|
| **Admin** | Gouvernance du subnet, stocké dans `admin` | `/add_admin --address <pubkey-hex>` |
| **Writer** | Peut ajouter des opérations au subnet | `/add_writer --key <writerKeyHex>` |
| **Indexer** | Participe à la linéarisation/indexation | `/add_indexer --key <writerKeyHex>` |

**Commandes de gestion :**
- `/update_admin --address <pubkey-hex>` — transférer l'admin
- `/remove_writer --key <hex>` / `/remove_indexer --key <hex>` — retirer
- `/set_auto_add_writers --enabled 1` — auto-admission des writers
- `/enable_transactions` — activer le gate `txen` (transactions)
- `/set_chat_status --enabled 1` — activer le chat intégré
- `/post --message "hello"` — poster un message chat

> **Note** : `--address` = peer public key hex (PAS une adresse bech32 MSB)

##### Running trac-peer

**Deux couches tournent ensemble :**
`trac-peer` tourne par-dessus un nœud MSB client in-process (de `trac-msb`). Ce nœud MSB client est requis pour broadcaster les déploiements subnet + payloads de contrat TX au MSB, et observer l'état MSB "confirmé".

**Runners :**

```bash
# Node runner (recommandé)
npm run peer:run -- --msb-bootstrap=<hex32> --msb-channel=<string>

# Pear runner (pour parité Pear)
npm run peer:pear -- --msb-bootstrap=<hex32> --msb-channel=<string>
```

**Stores — nœuds multiples sur une machine :**
Chaque nœud a un **peer store** (état/logs subnet) + un **msb store** (état/logs MSB client).

```bash
npm run peer:run -- \
  --msb-bootstrap=<hex32> --msb-channel=<string> \
  --msb-store-name=peer-msb-1 --peer-store-name=peer1
```

Keypairs stockés dans : `stores/<store>/db/keypair.json`

**Env vars équivalents :** `MSB_BOOTSTRAP`, `MSB_CHANNEL`, `PEER_RPC=1`, `PEER_RPC_HOST`, `PEER_RPC_PORT`, `PEER_API_TX_EXPOSED=1`

**RPC mode :** Désactive la CLI interactive quand activé. `--api-tx-exposed` ignoré si `--rpc` pas présent (sécurité opérateur).

##### trac-peer RPC API v1

> **Base URL :** `http://127.0.0.1:5001/v1/`

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/health` | Liveness probe → `{ ok: true }` |
| `GET` | `/v1/status` | Status peer + MSB (pubkey, writerKey, msbAddress, subnet info, MSB view) |
| `GET` | `/v1/contract/schema` | Document de découverte ABI-like (txTypes, ops schemas, API methods) |
| `GET` | `/v1/contract/nonce` | Génère un nonce (hex 32 bytes) pour la signature de TX contrat |
| `GET` | `/v1/contract/tx/context` | Contexte MSB pour le signing (networkId, txv, iw, bs, mbs, operationType) |
| `POST` | `/v1/contract/tx` | Soumet une TX contrat signée par le wallet. Opt-in via `--api-tx-exposed` |
| `GET` | `/v1/state?key=<key>&confirmed=<bool>` | Lit une clé unique dans l'état du subnet |

**POST /v1/contract/tx — Body :**

```json
{
  "tx": "<hex32>",
  "prepared_command": { "type": "catch", "value": {} },
  "address": "<hex32 — pubkey du wallet>",
  "signature": "<hex64>",
  "nonce": "<hex32>",
  "sim": false
}
```

> **Best practice** : Toujours simuler d'abord (`sim: true`), puis broadcaster (`sim: false`) seulement si la simulation réussit.

##### Wallet + dApp Integration

**Ce que le wallet signe (contrat TX) :**
Une TX contrat `trac-peer` est une opération MSB de `type = 12`. Le wallet signe un hash 32 bytes (`tx`) calculé depuis :
- Contexte MSB TX (de `GET /v1/contract/tx/context`)
- La commande typée `{ type, value }` (hashée comme `ch`)
- Un nonce (`in`)

> **Important** : Ce n'est PAS un transfert TNK. Il n'y a pas de champ `to`/`amount` dans une TX contrat.

**Flux de signing :**
1. `ch = blake3(JSON.stringify(prepared_command))`
2. `tx = blake3(createMessage(networkId, txv, iw, ch, bs, mbs, nonce, operationType))`
3. Signer `tx` bytes avec la clé privée du compte actif

**Flux dApp recommandé :**
1. Fetch schema → `GET /v1/contract/schema`
2. Fetch nonce → `GET /v1/contract/nonce`
3. Fetch context → `GET /v1/contract/tx/context`
4. Wallet signe le payload
5. Soumettre avec `sim=true` (preflight)
6. Si OK → soumettre avec `sim=false` (broadcast)

**Sécurité :** Le peer valide les signatures et les contraintes MSB. Une dApp ne peut pas "swapper" le type/value de la commande après la signature du wallet (change `ch` et `tx`).

##### App Development (Protocol + Contract)

Dans Trac, une "app" est un subnet. Le contrat est exécuté localement sur chaque nœud depuis le log ordonné.

**1) Protocol — mapper les inputs utilisateur en `{ type, value }`**
Les Protocols étendent `src/artifacts/protocol.js` et implémentent `mapTxCommand(commandString)`. Les dApps envoient généralement un `prepared_command` structuré directement.

**2) Contract — machine à états déterministe**
Les Contracts étendent `src/artifacts/contract.js`. Règles :
- **Déterministe** : pas de network IO, pas de system time
- Tous les nœuds exécutent les mêmes ops ordonnées → même résultat
- L'état app doit vivre sous `app/<your-app>/...`

**3) Schema ABI-like**
Enregistrer les types de TX dans le contrat :
- `addFunction(type)` — déclare qu'un type de TX existe (inputs non typés)
- `addSchema(type, schema)` — déclare un type + schéma validateur (préféré)
→ Exposé via `GET /v1/contract/schema`

**4) Read APIs (Protocol API)**
`protocol.api` expose des méthodes de lecture/requête, reflétées dans le schema RPC.

**5) Wiring de votre app**
Le runner par défaut `scripts/run-peer.mjs` wire l'app démo (Tuxemon). Pour votre propre app :
1. Ajouter protocol/contract sous `dev/`
2. Créer un nouveau runner script qui les importe
3. Lancer avec les mêmes flags MSB/subnet

> **Exemple de référence** : `intercom` dans le workspace utilise `trac-peer` comme dépendance.

---

##### References & Exemples

> **Source** : https://docs.trac.network/documentation/developers/mainnet/dapp-developer-guide/references-examples

**Repos de référence :**

| Repo | Description |
|---|---|
| `intercom/` | App réelle construite sur `trac-peer` — protocol, contract, features, sidechannels |
| `trac-dapp-example/` | dApp Next.js minimale — wallet extension + peer RPC |
| `tap-wallet-extension/` | Extension wallet — injecte `window.tracnetwork`, implémente `tracSignTx` |

---

###### Intercom — App de référence complète

> **Source** : https://docs.trac.network/documentation/developers/mainnet/dapp-developer-guide/references-examples/intercom
> **Repo** : https://github.com/Trac-Systems/intercom

**Ce qu'Intercom démontre :**
- Comment shipper une app : un repo qui dépend de `trac-peer` et wire `Protocol + Contract + Features`
- Comment tourner des subnets multi-peer : bootstrap un "app network", puis joindre plus de peers
- Rôles : admin, writers, indexers
- **Sidechannels** : messaging P2P rapide et éphémère à côté de la machine à états du contrat

**Installation et lancement :**

```bash
git clone https://github.com/Trac-Systems/intercom
cd intercom
npm install

# Créer un nouveau subnet Intercom (bootstrap / admin peer)
pear run . admin --subnet-channel my-intercom-app

# Premier setup admin (requis sur nouveaux subnets)
/add_admin --address "<ADMIN_PEER_PUBLICKEY_HEX32>"

# Vérifier
/get --key admin --confirmed false

# Démarrer des joiners
pear run . alice --subnet-channel my-intercom-app --subnet-bootstrap <ADMIN_SUBNET_BOOTSTRAP_HEX32>
pear run . bob   --subnet-channel my-intercom-app --subnet-bootstrap <ADMIN_SUBNET_BOOTSTRAP_HEX32>
```

**Writers & Indexers — Recommandations :**
- **Apps non-financières** : 1 indexer peut suffire
- **Apps financières / "valeur"** : **3 indexers** minimum, opérés par des parties différentes, dans des locations différentes
- Le premier indexer est généralement le peer admin

**Sidechannels (messaging P2P rapide) :**
Intercom rejoint toujours le **entry channel** (`0000intercom`).

```bash
# Joindre un channel additionnel
/sc_join --channel "team-room"

# Envoyer un message
/sc_send --channel "team-room" --message "hello from alice"

# Inspecter
/sc_stats
```

**Flags sidechannel d'Intercom :**
- `--sidechannels "a,b,c"` — joindre des channels supplémentaires au startup
- `--sidechannel-debug 1` — logs verbeux
- `--sidechannel-max-bytes <n>` — garde de taille payload
- `--sidechannel-allow-remote-open 0|1` — accepter/rejeter les demandes d'ouverture remote (défaut: on)
- `--sidechannel-auto-join 0|1` — auto-join les channels demandés (défaut: off)

**Structure du code Intercom :**

| Fichier | Rôle |
|---|---|
| `intercom/index.js` | Runner principal |
| `intercom/contract/protocol.js` | Protocol de l'app |
| `intercom/contract/contract.js` | Smart contract |
| `intercom/features/sidechannel/index.js` | Feature sidechannels |
| `intercom/features/timer/index.js` | Feature timer (exemple) |
| `intercom/SKILL.md` | Guide opérationnel complet |

> **Note RPC** : Intercom est une app terminal-first. Le runner ne expose PAS le HTTP RPC par défaut. Pour connecter des wallets/dApps, suivre la doc RPC de `trac-peer`.

---

###### trac-dapp-example — dApp Next.js minimale

> **Source** : https://docs.trac.network/documentation/developers/mainnet/dapp-developer-guide/references-examples/trac-dapp-example
> **Repo** : https://github.com/Trac-Systems/trac-dapp-example

Démontre le flux client complet : dApp → peer RPC → wallet signing → tx submit → state read.

**1) Démarrer un peer RPC (backend) :**

```bash
cd trac-peer
npm run peer:run -- \
  --msb-bootstrap=<MSB_BOOTSTRAP_HEX32> \
  --msb-channel=<MSB_CHANNEL> \
  --peer-store-name=peer-rpc \
  --msb-store-name=peer-rpc-msb \
  --subnet-channel=tuxedex-v1 \
  --rpc --api-tx-exposed \
  --rpc-host 127.0.0.1 --rpc-port 5001

# Quick checks
curl -s http://127.0.0.1:5001/v1/health | jq
curl -s http://127.0.0.1:5001/v1/contract/schema | jq
```

**2) Installer et lancer la dApp :**

```bash
cd trac-pokemon-hack
npm install

UPSTREAM_PROTOCOL=http \
UPSTREAM_HOST=127.0.0.1 \
UPSTREAM_PORT=5001 \
UPSTREAM_PREFIX=/v1 \
npm run dev

# → http://127.0.0.1:3000
```

**3) Flux complet quand l'utilisateur clique "Catch" :**
1. `GET /v1/contract/schema` → vérifie que le contrat supporte `catch`
2. `GET /v1/contract/nonce` → génère un nonce
3. `GET /v1/contract/tx/context` → récupère le contexte MSB
4. Construit le payload wallet : `{ prepared_command, nonce, context }`
5. `window.tracnetwork.signTracTx(contractTx)` → `{ tx, signature }`
6. `POST /v1/contract/tx` avec `sim=true` (preflight)
7. `POST /v1/contract/tx` avec `sim=false` (broadcast)
8. Poll l'état sous `app/tuxedex/<pubKeyHex>` (vue non confirmée)

**Troubleshooting dApp :**
- "Wallet extension not detected" → installer/activer `tap-wallet-extension`, recharger
- "Requester address not found" → funder l'adresse MSB du **wallet user** (le requester)
- Schema ne contient pas `catch` → le peer tourne un contrat/app différent

---

##### Troubleshooting trac-peer

> **Source** : https://docs.trac.network/documentation/developers/mainnet/dapp-developer-guide/troubleshooting

| Erreur / Symptôme | Cause | Solution |
|---|---|---|
| "Missing MSB network params" | `--msb-bootstrap` ou `--msb-channel` manquant | Passer les deux flags. Avec npm : `npm run peer:run -- --msb-bootstrap=<hex32> --msb-channel=<string>` |
| `zsh: command not found: --msb-channel=...` | Flag sur nouvelle ligne sans `\` continuation | Ajouter `\` en fin de ligne avant le flag suivant |
| "Requester address not found in state" | L'adresse MSB du peer n'existe pas en état MSB / pas de fonds | Transférer des TNK à l'adresse `Peer MSB address: trac1...` affichée dans les logs |
| "Subnet deployment broadcast failed" | Peer pas fundé OU mauvais params MSB (bootstrap/channel mismatch) | Vérifier funding + paramètres réseau |
| `Subnet writable: false` (read-only) | Keypair ne correspond pas au bootstrap writer du subnet | Si nouveau subnet : supprimer `stores/<peer-store>/subnet-bootstrap.hex` et relancer. Si join : vérifier que `--subnet-bootstrap` correspond |
| Pear PATH warning | Pear demande de configurer le PATH | Exécuter la commande `export` indiquée une seule fois |
| "Contract does not support ..." | Type de TX non supporté par le contrat démo | Le contrat démo ne supporte que `catch`. Vérifier le schema via `/v1/contract/schema` |

---

##### Production Notes

> **Source** : https://docs.trac.network/documentation/developers/mainnet/dapp-developer-guide/production-notes

**1) Sécurité — Deux classes d'utilisateurs :**

| Classe | Interface | Actions |
|---|---|---|
| **Operator** (node owner) | CLI interactive | Admin subnet, writer/indexer management, chat moderation, deployment |
| **Client** (wallet/dApp) | HTTP RPC | Read schema/state, submit signed contract txs |

> ⚠️ **Règle de design** : Ne JAMAIS exposer les actions operator via HTTP. Seuls les endpoints wallet/dApp doivent être publics.

**2) RPC Exposure :**
- `--rpc` active le serveur HTTP
- `--api-tx-exposed` active la soumission de TX (opt-in)
- `--rpc-allow-origin` → défaut `*`, préférer une liste stricte en production
- `--rpc-max-body-bytes <n>` → défaut 1MB, garder borné (vecteur DoS)

**3) Topologie recommandée :**
- **1 RPC public par subnet/app** ("gateway peer") derrière TLS + rate limits
- **Peers internes multiples** pour redondance (pas forcément exposés publiquement)
- Pour plusieurs subnets/apps : besoin éventuel d'un registre/explorer qui mappe "app identity" → peer URLs

**4) Reverse proxy + TLS (recommandé) :**
Peer RPC sur localhost exposé via nginx / Caddy / Cloudflare / API gateway pour TLS termination, rate limiting, access logs, origin restrictions.

**5) Key management :**
- MSB client keypair : `stores/<msb-store>/db/keypair.json`
- Subnet peer keypair : `stores/<peer-store>/db/keypair.json`
- Traiter comme des clés privées, backuper les stores
- Rotation de clés = nouvelle identité (perte des privilèges admin/writer)

**6) Frais et limites des contrats :**
- Contract TX = MSB operation `type = 12`
- PEUT dépenser des frais MSB (le requester doit avoir un entry MSB + balance suffisante)
- NE PEUT PAS transférer des TNK à un destinataire arbitraire (pas de `to`/`amount` dans type-12)

**7) Observabilité — Que monitorer :**

| Outil | Commande/Endpoint | Métriques |
|---|---|---|
| CLI | `/stats` | Writer/indexer state, connectivité, DAG lengths |
| RPC | `GET /v1/status` | Peer + MSB view summary |
| Système | — | Uptime process, mémoire, CPU, swarm connections |
| Avancement | — | subnet signedLength qui progresse, MSB signedLength qui progresse |

**8) Confirmed vs Unconfirmed (rappel) :**
- `confirmed=false` → vue locale rapide (pour UI fast updates)
- `confirmed=true` → vue subnet signée (pour états "finaux")
- Ce n'est PAS la "finalité MSB" → c'est le signed length du subnet

**9) Rate limiting (si TX publiques) :**
- Rate limits par IP/origin
- Burst limits
- Taille requêtes bornée
- Wallet connect / origin allowlist recommandé
- Même avec validation de signature, le RPC peut être abusé pour simulations compute-heavy

**10) Upgrades — Vérifier la compatibilité :**
- Pinner les versions : `trac-peer`, `trac-msb`, `trac-wallet`
- Valider : tx signing preimage (`/v1/contract/tx/context`), endpoints RPC, contract schema (`/v1/contract/schema`)

---

#### Main Settlement Bus (MSB) — Documentation développeurs

> **Source** : https://docs.trac.network/documentation/developers/mainnet/main-settlement-bus

Pour tourner un RPC MSB mainnet self-hosted, suivre le [README du repo MSB](https://github.com/Trac-Systems/main_settlement_bus). PM2 recommandé pour le background.

##### MSB RPC API v1 — Référence publique

> **Source** : https://docs.trac.network/documentation/developers/mainnet/main-settlement-bus/rpc-api-v1
> **Base URL publique** : `https://tracapi.trac.network/v1/`

Ces endpoints permettent de lire l'état du ledger et soumettre des transactions sur le mainnet.

**Network State :**

| Méthode | Endpoint | Description | Exemple de réponse |
|---|---|---|---|
| `GET` | `/v1/txv` | Hash de validité de transaction courant | `{ "txv": "54f57c8d..." }` |
| `GET` | `/v1/fee` | Frais de transaction courant | `{ "fee": "30000000000000000" }` |
| `GET` | `/v1/confirmed-length` | Longueur du ledger confirmé | `{ "confirmed_length": 63 }` |
| `GET` | `/v1/unconfirmed-length` | Longueur du ledger non-confirmé | `{ "unconfirmed_length": 63 }` |

> **Note sur les frais** : Le fee retourné est `30000000000000000` — c'est **0.03 $trac** en plus petite unité (18 décimales), ce qui confirme les 0.03 $trac/tx de la doc "Transaction Fees".

**Wallet & Account :**

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/balance/{address}?confirmed=true\|false` | Balance d'une adresse. Défaut: confirmed. |
| `GET` | `/v1/account/{address}?confirmed=true\|false` | Détails compte : rôles, clés, balances, licence, staking |

**Exemple réponse `/v1/account` :**
```json
{
  "address": "trac1xljl28...",
  "writingKey": "0000...0000",
  "isWhitelisted": false,
  "isValidator": false,
  "isIndexer": false,
  "license": null,
  "balance": "49630000000000000000",
  "stakedBalance": "0"
}
```

**Transactions — Read :**

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/tx-hashes/{start}/{end}` | Hashes de TX par range de confirmed-length (max 1000) |
| `GET` | `/v1/tx/{transactionHash}` | Détails TX confirmée par hash |
| `GET` | `/v1/tx/details/{hash}?confirmed=true\|false` | Détails TX enrichis avec `confirmed_length` et `fee` |

**Structure d'une TX (champs `tro`) :**

| Champ | Description |
|---|---|
| `tx` | Hash de la transaction |
| `txv` | Hash de validité de la transaction |
| `to` | Adresse destinataire |
| `am` | Montant (plus petite unité, string) |
| `in` | Nonce du requester |
| `is` | Signature du requester |
| `va` | Adresse du validator |
| `vn` | Nonce du validator |
| `vs` | Signature du validator |

**Transactions — Write :**

| Méthode | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/tx-payloads-bulk` | Récupérer payloads TX en batch (max 1500 hashes, body max 1MB, response max 2MB) |
| `POST` | `/v1/broadcast-transaction` | Broadcaster une TX signée (payload Base64). Peut retourner `429` (rate limited) |

**Broadcast d'une TX :**
```bash
curl -X POST https://tracapi.trac.network/v1/broadcast-transaction \
  -H "Content-Type: application/json" \
  -d '{"payload": "BASE64_ENCODED_TRANSACTION"}'
```

**Réponse broadcast :**
```json
{
  "result": {
    "message": "Transaction broadcasted successfully.",
    "signedLength": 123,
    "unsignedLength": 122,
    "tx": "6641baab..."
  }
}
```

**Limites et erreurs :**
- `confirmed` query param : `true` = vue confirmée, `false` = vue non-confirmée, omis = confirmée
- `tx-hashes` range : max 1000 différence, les deux paramètres doivent être ≥ 0
- `tx-payloads-bulk` : max 1500 hashes, 1MB request body, 2MB response body
- `broadcast-transaction` : rate limited (`429`), retry avec backoff

---

## 6. Messaging / Trac Chat (Intercom)

### Vue d'ensemble

**Trac Chat** est le protocole de messagerie P2P natif de Trac Network.

| Caractéristique | Détail |
|---|---|
| **Coût** | Gratuit (sans gas) |
| **Type** | Peer-to-peer |
| **Utilisateurs** | Humains ET agents AI |
| **Intégration** | Dans toute app Trac |
| **Consommation** | Messages consommables par les smart contracts |
| **Langage naturel** | Le langage naturel peut déclencher des actions contract |

### Utilisation dans les contrats

Les messages sont activables via :
```javascript
peer_opts.api_msg_exposed = true;
```

C'est le système qui permet à des **agents AI** de communiquer entre eux et avec des contrats (comme dans le projet Mnemo/Intercom).

---

## 7. Features (Oracles / Extensions)

### Concept

Les **Features** permettent d'**étendre un smart contract avec des oracles, de l'indexation ou de l'AI** sans avoir à redéployer le contrat.

### Caractéristiques

- Modulaires et composables
- Peuvent être **payantes** (monétisation du code)
- Permettent l'ajout de : oracles, indexation, AI, timers, etc.
- Pattern "publish once, monetize forever"

### Exemple : Feature Timer

```
features/
└── timer/
    └── index.js    # Feature oracle qui fournit des timers au contrat
```

### Trac Features marketplace

Les développeurs peuvent publier des Features payantes — créant une **économie de code native** où les dev open-source gagnent des récompenses au niveau du protocole quand leur code est utilisé.

---

## 8. HyperTokens Protocol

Standard de tokens **natif** de Trac Network.

| Caractéristique | Détail |
|---|---|
| Architecture | Entièrement décentralisée |
| Intégration | Au niveau du protocole |
| Tokenomics | Support avancé |

---

## 9. HyperMall — DEX de référence

> **Sources** :
> - https://docs.trac.network/real-world-examples/hypermall
> - https://docs.trac.network/real-world-examples/hypermall/security-in-hypermall
> - https://docs.trac.network/real-world-examples/hypermall/how-transactions-work
> - https://docs.trac.network/real-world-examples/hypermall/trading-in-hypermall
> - https://docs.trac.network/real-world-examples/hypermall/withdrawing-assets-from-hypermall
> - https://docs.trac.network/real-world-examples/hypermall/fee-structure-in-hypermall
> - https://docs.trac.network/real-world-examples/hypermall/supported-token-pairs
> - https://docs.trac.network/real-world-examples/hypermall/further-incentives
> - https://docs.trac.network/real-world-examples/hypermall/running-a-node
> - https://docs.trac.network/real-world-examples/hypermall/conclusion

### Vue d'ensemble

HyperMall est la **première application** construite sur Trac Network. C'est un DEX décentralisé qui ne ressemble pas à un DEX — du point de vue utilisateur, il se comporte comme un CEX avec orderbooks : rapide, réactif, intuitif. Pas de wallet à connecter, pas de gas fees, juste du trading permissionless via une app desktop native.

| Caractéristique | Détail |
|---|---|
| **Type** | DEX P2P avec UX de CEX (orderbooks) |
| **Finalité** | ~1 seconde (flux continu, pas de blocs) |
| **Gas** | Gratuit (R1) |
| **Plateforme** | App desktop native (Windows, Linux, macOS) — PAS une webapp |
| **Wallet** | Intégré dans l'app (pas de wallet externe à connecter) |
| **Stablecoins** | USDT & NUSD supportés |
| **Tokens** | TAP Protocol & Runes supportés |
| **Download** | https://hypermall.io/ |
| **Réseau** | R1 (Gasless Net) — restera maintenu même après mainnet |

### Sécurité

La sécurité est intégrée dans chaque couche de HyperMall — pas un ajout après coup.

**App native vs web :**
- App desktop qui tourne localement → minimise les surfaces d'attaque
- Pas de risques d'extensions browser, pas d'injection tierce
- Environnement contrôlé pour la gestion des actifs
- Le signing se fait localement — les clés ne quittent jamais l'appareil

**Wallet intégré :**
- Pas besoin de connecter un wallet externe
- Pas de pop-ups, pas d'interactions web qui pourraient être spoofées/hijackées

**Backend (Trac Network) :**
- Système crypto headless (sans blockchain), basé sur les flux
- Pas de blocs à attendre, pas d'intermédiaires centralisés
- Transactions rapides, déterministes, moins vulnérables à la manipulation

**Futur : mode serveur** prévu — interface accessible via navigateur, mais toutes les opérations critiques de sécurité reposeront sur le même noyau vérifiable et durci. Choix entre contrôle local maximum et commodité browser.

### Comment les transactions fonctionnent (Deposit flow)

Avant toute opération sur HyperMall, il faut **déposer des actifs** provenant du **TAP Protocol** (construit sur Bitcoin).

**Flux de dépôt :**
1. L'utilisateur détient des tokens TAP Protocol dans son TAP Wallet (TAP, GIB, USDT, USDC, etc.)
2. L'utilisateur envoie les tokens à une **adresse de dépôt** fournie par l'app HyperMall
3. Cette adresse est liée à l'identité de l'utilisateur dans HyperMall
4. HyperMall reconnaît les tokens et les rend disponibles dans l'app

**HyperMall agit comme un L2 au niveau applicatif** — ce n'est pas une nouvelle chaîne ni un rollup. Il ne batch pas de preuves et ne soumet pas de checkpoints. Il bridge les actifs dans un environnement local conçu pour le trading.

### Trading — Moteur et architecture

Le moteur de trading est construit sur des smart contracts — mais pas au sens traditionnel. Les contrats ne tournent pas sur une VM blockchain, ils sont **exécutés localement par chaque nœud HyperMall**.

**Architecture clé :**
- Quand tu installes HyperMall, tu ne fais pas qu'accéder à l'exchange — tu **exécutes l'infrastructure**
- Chaque nœud inclut le même smart contract de trading (ordres, matching, settlement)
- Les contrats sont **déterministes** — tous les nœuds arrivent au même résultat
- Le consensus est atteint en traitant un **flux partagé de transactions validées**

**Rôle du MSB (Main Settlement Bus) :**
- Le MSB **ne fait PAS** les trades
- Il valide les transactions, vérifie leur structure et conformité au protocole, et les **signe**
- Seules les TX signées par le MSB sont acceptées par le smart contract des nœuds HyperMall
- La participation MSB est gouvernée par son propre smart contract (qui peut valider = licence)

**Validators et fees :**
- Seuls les validators MSB licenciés peuvent signer les transactions
- En retour → **50% de tous les frais de trading** d'HyperMall
- Les clients HyperMall **choisissent** à quel validator envoyer une TX
- Validators rivalisent sur **uptime et réactivité** — meilleure performance = plus de gains

**Trading flow complet :**
1. Utilisateur crée un ordre dans l'app HyperMall
2. L'ordre est envoyé à un validator MSB choisi par le client
3. Le validator vérifie la structure, la conformité au protocole, et signe la TX
4. La transaction signée est diffusée à **tous les nœuds**
5. Chaque nœud exécute le smart contract localement
6. Consensus par logique déterministe (pas de mining ni proof-of-stake)

### Retrait d'actifs (Withdrawal)

HyperMall donne le contrôle total aux utilisateurs — y compris pour la sortie du système. Le retrait ne dépend pas d'un settlement automatique vers Bitcoin.

**Flux de retrait :**
1. Après trading, les tokens TAP (GIB, USDT, TAP, etc.) sont dans l'app locale
2. L'utilisateur initie un retrait dans HyperMall
3. HyperMall prépare un **claim** prouvant le droit aux tokens sur Bitcoin
4. Ce claim est **signé cryptographiquement** et lié à l'identité + adresse wallet
5. L'utilisateur ouvre le **TAP Wallet** et utilise le claim pour **redemption**
6. Le wallet interagit avec le TAP Protocol sur Bitcoin et finalise le transfert
7. Les tokens sont de retour dans le Bitcoin wallet de l'utilisateur

**Important** : Le processus remet le contrôle à l'utilisateur via le TAP Wallet — HyperMall ne fait pas le settlement automatiquement.

### Fee Structure (Structure des frais)

> **Source** : https://docs.trac.network/real-world-examples/hypermall/fee-structure-in-hypermall

Modèle simple et efficace. Exemple pour la paire TAP/USDT :

| Rôle | Fee | Devise |
|---|---|---|
| **Maker** | 0.4% | USDT |
| **Taker** | 0.6% | TAP |

**Distribution des frais :**
- **50%** → validator qui a signé la TX via le MSB
- **50%** → protocole HyperMall (redistribuable via incentives écosystème)

Les validators sont sélectionnés par l'utilisateur ou aléatoirement par l'app. Cela crée une **économie de validators ouverte** où la performance influence directement les rewards. Évolution attendue : économie similaire au mining Bitcoin.

### Supported Token Pairs (Paires supportées)

> **Source** : https://docs.trac.network/real-world-examples/hypermall/supported-token-pairs

Les paires sont activées par **gouvernance**. Au lancement, seule paire : **GIB/TAP**.

**Paires futures prévues :**
- TAP/USDT, GIB/TAP, DMT-NAT/USDT
- WBTC/USDT, ADA/USDT, GIB/USDT
- WETH/USDT, TRON/USDT

HyperMall supporte aussi l'expansion du TAP Protocol, incluant **BRC-20 et Runes**, permettant le trading sécurisé d'une large variété d'actifs Bitcoin-natifs.

### Further Incentives (Incentives additionnels)

> **Source** : https://docs.trac.network/real-world-examples/hypermall/further-incentives

Plusieurs couches d'incentives :

1. **Validator Rewards** — 50% des frais de trading pour les TX signées
2. **Ecosystem Staking Rewards** — Les holders de TAP peuvent staker pour recevoir une part du pool de 50% du protocole. Rewards basés sur le montant et la durée du stake.
3. **GIB Collectibles** — Chaque staker reçoit au moins un collectible basé sur Digital Matter Theory (TAP Protocol). Collection introduite peu après le lancement d'HyperMall.
4. **Programmes futurs** — Incentives liquidité, rebates basés sur le volume, referrals, rewards basés sur la gouvernance.

### Running a Node (Exécuter un nœud)

> **Source** : https://docs.trac.network/real-world-examples/hypermall/running-a-node

**HyperMall Node (niveau utilisateur) :**
- Chaque installation de l'app = un full HyperMall node
- Juste installer et lancer — **pas de terminal requis**
- Recommandé : 100GB d'espace disque, internet basique, PC de bureau standard

**MSB Validator Node (niveau opérateur) :**
- Nécessite le logiciel validator en CLI
- Recommandé :
  - 500GB SSD
  - CPU 8-core avec haute performance single-thread
  - 16GB RAM
  - Internet haut débit (hébergement datacenter préféré)
- Les validators doivent détenir une **licence** pour opérer

### Conclusion

> **Source** : https://docs.trac.network/real-world-examples/hypermall/conclusion

HyperMall combine la vitesse et l'utilisabilité des CEX avec la transparence, le contrôle et la programmabilité des systèmes crypto-natifs. Construit sur Trac Network et propulsé par le TAP Protocol : exécution via smart contracts, settlement via validators, custody contrôlé par l'utilisateur. Pas d'extensions browser, pas de bridges, pas de friction.

---

## 10. HyperFun — Plateforme de lancement de tokens

| Caractéristique | Détail |
|---|---|
| **Type** | Plateforme de lancement de tokens "FUN" |
| **Powered by** | $TAP token |
| **ReFUNs** | Mints sans risque (remboursables) |
| **Floor Locks** | Liquidité de sortie garantie (GTD exit liquidity) |
| **TAP-Out** | Burn pour recevoir un % de $TAP |
| **Infrastructure** | Smart contract, wallet & nœud intégrés dans l'app |

---

## 11. Tokenomics — $trac, $TAP

### $trac (Token natif — anciennement $TRAC BRC-20)

- **Token natif / gas** de Trac Network
- Frais fixes : **0.03 $trac / tx**
- Distribution des frais : 50% validators, 25% deployers, 25% réservé (burned en attendant)
- Les validators sont récompensés avec des $trac **individuellement minés** par validator et par transaction
- **Inflation/Deflation ciblée** : max 2%/an grâce au mécanisme de burning
- Les contract deployers gagnent des $trac (Contract Royalties = 25% de chaque tx)
- Le staking $TRAC (BRC-20) est la seule voie d'accès au token $trac sur Trac Network
- Staking actif sur : https://staking.tracvalidator.com/
- Disponible sur MEXC et Gate

### $TAP

- Token du TAP Protocol
- Distribué aux validators comme récompense (~10-15% APY estimé)
- Lié au protocole TAP sur Bitcoin

> **Note sur $TNK vs $trac** : La doc mainnet validators mentionne **$TNK** comme token nécessaire pour le whitelist et les balances. Le site marketing parle aussi de $TNK. La doc "Transaction Fees" parle de **$trac**. Il est probable que $TNK soit le ticker/symbole de marché du $trac natif Trac Network, ou qu'une évolution de naming soit en cours. Dans le doute, les deux termes réfèrent au token gas natif de Trac Network.

### Modèle économique

- **Contract Royalties** : les deployers gagnent 25% de chaque tx (0.0075 $trac/tx)
- **Validator Rewards** : 50% de chaque tx (0.015 $trac/tx) + rewards apps spécifiques (ex: 50% trading fees HyperMall) + $TAP
- **Indexer Rewards** : 25% réservé (burned pour le moment, activé à une future update)
- **Burning** : les 25% réservés sont burned → mécanisme déflationniste naturel
- **Feature Monetization** : les devs peuvent publier des Features payantes

---

## 12. Infrastructure technique — Pear Runtime & Holepunch

### Pear Runtime

Trac Apps utilisent le **Pear Runtime** de Holepunch (https://pears.com/).

- Permet l'exécution P2P native
- Supporte les modes **terminal** et **desktop**
- Distribution décentralisée des apps

### Installation

```bash
npm i -g pear
pear -v
```

### Commandes clés

| Commande | Usage |
|---|---|
| `pear run . store1` | Lancer un nœud/app en mode terminal |
| `pear run -d . store1` | Lancer en mode desktop avec console dev |
| `pear run pear://[hash] store1` | Lancer depuis la distribution décentralisée |

### Identité et stockage

- Chaque instance crée sa propre **identité (wallet)** automatiquement au premier démarrage
- Les données sont stockées dans `stores/[storeName]/`
- La clé est dans `stores/[storeName]/db/keypair.json`
- **La seedphrase permet de restaurer l'identité** dans une nouvelle installation

---

## 13. Repos GitHub essentiels

| Repo | Description | URL |
|---|---|---|
| **trac-network** | Repo principal — liens vers tous les composants | https://github.com/Trac-Systems/trac-network |
| **trac-contract-example** | Exemple de contrat/app complet (R1) | https://github.com/Trac-Systems/trac-contract-example |
| **trac-peer** | Librairie Peer (nœud) — contient l'API built-in | https://github.com/Trac-Systems/trac-peer |
| **intercom** | App de référence construite sur trac-peer (sidechannels, contract) | https://github.com/Trac-Systems/intercom |
| **trac-dapp-example** | dApp Next.js minimale (wallet + peer RPC) | https://github.com/Trac-Systems/trac-dapp-example |
| **main_settlement_bus** | Code du MSB (validator) | https://github.com/Trac-Systems/main_settlement_bus |
| **hypermall-downloads** | Downloads de l'app HyperMall | https://github.com/Trac-Systems/hypermall-downloads |

---

## 14. Gotchas & pièges connus

### Validators

- ⚠️ **Ne jamais lancer le même store deux fois** → provoque du "chatter" (logins/logouts permanents)
- ⚠️ **Toujours utiliser `--no-autorestart` avec PM2** pour Hypermall → sinon risque de problèmes
- ⚠️ Si rien ne se passe au démarrage du MSB → tuer tous les processus `pear-runtime` puis relancer
- ⚠️ Si le MSB demande une nouvelle seedphrase au restart → mauvais nom de store utilisé
- ⚠️ Channel names doivent faire **exactement 32 caractères**
- ⚠️ **Ne PAS installer le mainnet dans le même dossier qu'Hypermall** → utiliser `my-validator` (mainnet) vs `my-msb` (Hypermall)
- ⚠️ Les adresses Hypermall R1 sont des raw public keys, les adresses mainnet commencent par `trac1...` → **refaire le whitelist** si migration
- ⚠️ **Ne jamais retirer tous les $TNK du wallet validator** → laisser minimum 0.33 $TNK

### Contrats (R1)

- La version R1 du contrat doit être utilisée avec les releases R1 de Trac Network
- Les fonctions API custom sont dans `/contract/protocol.js` (pas dans l'API built-in)
- Pour la production, **toujours ajouter des indexers** (2-4 recommandés sur des machines/DC différents)
- ⚠️ **Pas de `try-catch`** dans les fonctions contrat (cause inconsistances)
- ⚠️ **Pas de `throw`** dans les fonctions contrat
- ⚠️ **JAMAIS modifier `this.op` ou `this.value`** — utiliser `this.protocol.safeClone()` pour copier et modifier
- ⚠️ **`safeJsonParse` retourne `undefined`** si échec (pas `null` comme les autres safe functions)
- ⚠️ **`safeClone` : attention aux false-positives** si `null` est passé en argument
- ⚠️ **Tous les `this.put()` à la fin** de l'exécution de la fonction (éviter problèmes de sécurité atomicité)
- ⚠️ **MSB R1 : utiliser branche `msb-r1`** (`git clone -b msb-r1 --single-branch ...`), PAS la branche principale
- ⚠️ **MSB Admin : `/add_indexer` prend la MSB Writer address**, PAS l'adresse MSB du nœud
- ⚠️ **Validators R1 : envoyer l'adresse "MSB Address"** pour whitelisting (PAS la Writer address)
- ⚠️ **Features injectent directement** dans le contrat via `this.append()` — pas via transactions

### trac-peer / dApp Development

- ⚠️ **Funder CHAQUE adresse MSB** : peer MSB address ET wallet user MSB address. Sinon : `Requester address not found in state`
- ⚠️ **Déployer le subnet** (`/deploy_subnet`) AVANT de soumettre des TX contrat, sinon MSB preflight échoue
- ⚠️ **Contrats doivent être déterministes** : pas de network IO, pas de `Date.now()`, pas de `Math.random()`
- ⚠️ **État app sous `app/...`** : tout l'état de votre app doit vivre sous `app/<your-app>/...`
- ⚠️ **`--api-tx-exposed` ignoré sans `--rpc`** : sécurité opérateur, le flag n'a d'effet qu'en mode RPC
- ⚠️ **Simuler avant de broadcaster** : toujours `sim=true` d'abord, puis `sim=false` si OK
- ⚠️ **Format flags avec npm** : utiliser `npm run peer:run -- --flag=value` (double-dash avant les flags)
- ⚠️ **TX contrat ≠ transfert TNK** : pas de champ `to`/`amount` dans une TX contrat (c'est un MSB operation type 12)
- ⚠️ **Stores distincts par nœud** : `--peer-store-name` et `--msb-store-name` différents pour chaque peer sur la même machine

### Production

- ⚠️ **Ne JAMAIS exposer les actions operator via HTTP** — seuls les endpoints wallet/dApp doivent être publics
- ⚠️ **`--api-tx-exposed` est opt-in** — ne l'activer que sur les peers RPC qui doivent recevoir des TX
- ⚠️ **Reverse proxy + TLS obligatoire** en production (nginx/Caddy/Cloudflare)
- ⚠️ **Rate limiter les endpoints publics** — même les simulations `sim=true` consomment du compute
- ⚠️ **Rotation de clés = perte d'identité** — perte des privilèges admin/writer/indexer
- ⚠️ **Pinner les versions** (`trac-peer`, `trac-msb`, `trac-wallet`) et valider compatibilité avant upgrade

### Réseau

- Le mainnet Trac Network n'est pas encore complètement released — certaines features sont en cours
- Pas de web wallets natifs pour le moment (mais on peut créer des wallets d'identité avec `micro-key-producer`)
- Le déploiement mobile est en développement par l'équipe

### Migration $TRAC

- Le staking $TRAC actuel est la **seule voie** pour obtenir le futur token TRAC 2.0 (gas natif)
- La migration complète est planifiée

---

## 15. Liens utiles

### Documentation & Code

| Ressource | URL |
|---|---|
| Documentation officielle | https://docs.trac.network/ |
| GitHub Trac Systems | https://github.com/Trac-Systems |
| Exemple de contrat | https://github.com/Trac-Systems/trac-contract-example |
| Trac Peer (API) | https://github.com/Trac-Systems/trac-peer |
| Wallet API (doc) | https://docs.trac.network/documentation/developers/mainnet/wallet-api |
| dApp Developer Guide | https://docs.trac.network/documentation/developers/mainnet/dapp-developer-guide |
| RPC API v1 | https://docs.trac.network/documentation/developers/mainnet/dapp-developer-guide/trac-peer-rpc-api-v1 |
| MSB RPC API v1 | https://docs.trac.network/documentation/developers/mainnet/main-settlement-bus/rpc-api-v1 |
| MSB RPC publique | https://tracapi.trac.network/v1/ |
| R1 Gasless Net | https://docs.trac.network/documentation/developers/gasless-net-r1 |
| R1 Contracts | https://docs.trac.network/documentation/developers/gasless-net-r1/contracts |
| R1 Features | https://docs.trac.network/documentation/developers/gasless-net-r1/features |
| R1 Messaging | https://docs.trac.network/documentation/developers/gasless-net-r1/messaging |
| R1 Deployment | https://docs.trac.network/documentation/developers/gasless-net-r1/deployment |
| R1 Custom Validators | https://docs.trac.network/documentation/developers/gasless-net-r1/custom-validators |
| HyperMall Overview | https://docs.trac.network/real-world-examples/hypermall |
| HyperMall Security | https://docs.trac.network/real-world-examples/hypermall/security-in-hypermall |
| HyperMall Transactions | https://docs.trac.network/real-world-examples/hypermall/how-transactions-work |
| HyperMall Trading | https://docs.trac.network/real-world-examples/hypermall/trading-in-hypermall |
| HyperMall Withdrawals | https://docs.trac.network/real-world-examples/hypermall/withdrawing-assets-from-hypermall |
| HyperMall Fee Structure | https://docs.trac.network/real-world-examples/hypermall/fee-structure-in-hypermall |
| HyperMall Token Pairs | https://docs.trac.network/real-world-examples/hypermall/supported-token-pairs |
| HyperMall Incentives | https://docs.trac.network/real-world-examples/hypermall/further-incentives |
| HyperMall Running a Node | https://docs.trac.network/real-world-examples/hypermall/running-a-node |
| HyperMall Conclusion | https://docs.trac.network/real-world-examples/hypermall/conclusion |
| MSB (Validator) | https://github.com/Trac-Systems/main_settlement_bus |
| TAP Protocol Specs | https://github.com/BennyTheDev/tap-protocol-specs/ |

### Applications & Outils

| Ressource | URL |
|---|---|
| HyperMall (download) | https://hypermall.io/ |
| TAP Wallet | https://tracsystems.io/tap-wallet/ |
| Validator Staking | https://staking.tracvalidator.com/ |
| Validator Onboarding | https://onboarding.tracvalidator.com/ |

### Sites & Info

| Ressource | URL |
|---|---|
| Trac Systems (site principal) | https://tracsystems.io/ |
| Trac Network page | https://tracsystems.io/trac-network/ |
| TAP Protocol page | https://tracsystems.io/tap-protocol/ |
| TAP Protocol site | https://tap-protocol.com |

### Communauté

| Plateforme | URL |
|---|---|
| X (Twitter) | https://x.com/TracNetwork |
| Discord | https://discord.com/invite/trac |
| Telegram | https://t.me/tap_protocol |

### Articles de référence

| Article | URL |
|---|---|
| Litepaper Trac Network | https://medium.com/trac-systems/trac-network-litepaper-63da57484c27 |
| Trac Systems Products & Vision | https://medium.com/trac-systems/trac-systems-products-vision-df6098e0121e |
| Emergence of HyperMall | https://medium.com/trac-systems/the-emergence-of-the-trac-network-its-first-application-hypermall-6908ba2c3919 |
| $1 Trillion Value Migration | https://medium.com/@fitzyOG/trac-network-and-the-1-trillion-value-migration-rethinking-infra-from-the-ground-up-0c00b4fa08c4 |
| Trac Core for TAP Protocol | https://medium.com/trac-systems/trac-core-for-tap-protocol-cfe60e10ba1b |
| Validator Participation | https://medium.com/trac-systems/validator-participation-63135f7b110e |

---

> **Note** : Ce document sera à mettre à jour au fur et à mesure de l'évolution du réseau, notamment avec la release complète du mainnet, les web wallets natifs, et le déploiement mobile. Les pages détaillées de la documentation (Cryptography, Decentralization, Consensus, Transaction Performance, Reorgs, Transaction Fees, Inflation/Deflation Rate, etc.) sont disponibles sur https://docs.trac.network/ dans la section "Trac Network".
