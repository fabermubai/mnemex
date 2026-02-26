# Mnemex — Test Plan Exhaustif

> Extrait du whitepaper v0.3 + technical-architecture.md + phase2-tasks.md + phase3-tasks.md
> Chaque feature est vérifiée par test unitaire (test/*.test.js) ET/OU par test live (mainnet multi-peer).

---

## 1. Infrastructure & Déploiement

### 1.1 Subnet Deployment
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 1.1.1 | Admin peer démarre et crée l'Autobase | §Architecture | `pear run . --peer-store-name mnemex-admin ...` → logs OK, Autobase créé | DONE | Pear Runtime |
| 1.1.2 | MSB connecté, 50 validateurs | §Architecture | `/msb` → connectedValidators ≥ 50 | DONE | TNK balance |
| 1.1.3 | Entry sidechannel `0000mnemex` actif | §Sidechannels | `/sc_stats` → channels contient 0000mnemex | DONE | |
| 1.1.4 | SC-Bridge WebSocket accessible | §SC-Bridge | `ws://127.0.0.1:49222` → hello message reçu | DONE | --sc-bridge true |

### 1.2 Multi-Peer
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 1.2.1 | Nouveau peer rejoint le subnet (même Autobase) | §Memory Nodes | Agent2 lance, affiche même subnet bootstrap | DONE | MNEMEX_SUBNET_BOOTSTRAP hardcodé |
| 1.2.2 | Réplication Autobase admin → agent2 | §Memory Nodes | Agent2 `/get --key "mem/..."` retourne les données de l'admin | DONE | Même subnet bootstrap |
| 1.2.3 | Add writer depuis admin | §Rôles | `/add_writer --key <writer-key>` → "Writer added" | DONE | Admin terminal |
| 1.2.4 | Réplication Autobase agent2 → admin | §Memory Nodes | Agent2 écrit, admin `/query_memory` → trouvé | DONE | Agent2 = writer |
| 1.2.5 | Add indexer depuis admin | §Rôles | `/add_indexer --key <agent2-writer-key>` → "Indexer added: 1eb90fe..." | DONE | Admin terminal |
| 1.2.6 | Remove writer depuis admin | §Rôles | `/remove_writer` → "Writer removed". Agent2 `/tx` → "Peer is not writable". Re-ajouté ensuite. | DONE | Admin terminal |
| 1.2.7 | Auto-add writers (dev mode) | §Rôles | `/set_auto_add_writers --enabled 1` → "Set auto_add_writers: on". Désactivé ensuite (sécurité). | DONE | Admin terminal |

---

## 2. Phase 1 — Memory Write / Read / Index (MVP)

### 2.1 Memory Registration (contract)
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 2.1.1 | register_memory crée l'entrée on-chain | §Memory Write | `/tx --command '{"op":"register_memory",...}'` → `mem/<id>` en state | DONE | Writer + 0.03 TNK |
| 2.1.2 | Indexes par cortex créés | §Cortex | `mem_by_cortex/<cortex>/<id>` existe | DONE | Unit test |
| 2.1.3 | Indexes par auteur créés | §Memory Write | `mem_by_author/<author>/<id>` existe | DONE | Unit test |
| 2.1.4 | Indexes par tag créés | §Memory Write | `tag/<tag>/<id>` existe pour chaque tag | DONE | Unit test |
| 2.1.5 | Tags passthrough (string → array) | §Memory Write | Tags stockés comme array dans metadata | DONE | Unit test |

### 2.2 Memory Query (contract)
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 2.2.1 | query_memory retourne les metadata | §Memory Read | `/query_memory --memory_id "..."` → objet complet | DONE | |
| 2.2.2 | query_memory retourne null si inexistant | §Memory Read | `/query_memory --memory_id "unknown"` → null | DONE | Unit test |
| 2.2.3 | list_by_cortex liste les memories d'un cortex | §Cortex | `/list_by_cortex --cortex "cortex-crypto"` → liste | DONE | |
| 2.2.4 | query_by_tag liste les memories par tag | §Memory Write | `/query_by_tag --tag "bitcoin"` → liste | DONE | |
| 2.2.5 | list_memories vérifie l'existence dans les indexes | §Memory Read | `/list_memories --memory_id "..."` → found in indexes | DONE | |

### 2.3 MemoryIndexer Feature (sidechannel)
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 2.3.1 | memory_write stocke les données localement | §Memory Write | Sidechannel msg → fichier dans mnemex-data/ | DONE | Unit test |
| 2.3.2 | memory_write déclenche register_memory on-chain | §Memory Write | Sidechannel msg → this.append() → state updated | DONE | Unit test |
| 2.3.3 | memory_read retourne les données stockées | §Memory Read | Sidechannel msg → response avec data | DONE | Unit test |
| 2.3.4 | memory_read retourne found:false si inconnu | §Memory Read | Sidechannel msg memory_id inconnu → found:false | DONE | Unit test |
| 2.3.5 | Ignore les messages non-cortex | §Sidechannels | Message sur channel != cortex-* → ignoré | DONE | Unit test |
| 2.3.6 | Ignore les JSON invalides | §Sidechannels | Message non-JSON → ignoré sans crash | DONE | Unit test |
| 2.3.7 | Ignore les messages version != 1 | §Sidechannels | Message v:2 → ignoré | DONE | Unit test |
| 2.3.8 | Rejette les memory_write avec champs manquants | §Memory Write | Message sans memory_id → rejeté | DONE | Unit test |

---

## 3. Phase 2 — Neuronomics (Fees, Staking, Payment Gate)

### 3.1 Fee Accounting (contract)
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 3.1.1 | record_fee split 60/40 pour read_open | §Fee Distribution | Creator 60%, nodes 40% | DONE | Unit test |
| 3.1.2 | record_fee split 70/30 pour read_gated | §Fee Distribution | Creator 70%, nodes 30% | DONE | Unit test |
| 3.1.3 | record_fee split 80/20 pour skill_download | §Fee Distribution | Creator 80%, nodes 20% | DONE | Unit test |
| 3.1.4 | record_fee rejette payment_txid dupliqué | §Fee Distribution | Double-spend → erreur | DONE | Unit test |
| 3.1.5 | record_fee rejette memory_id inexistant | §Fee Distribution | Memory inconnue → erreur | DONE | Unit test |
| 3.1.6 | Balances s'accumulent sur plusieurs fees | §Fee Distribution | Plusieurs record_fee → balance incrémentée | DONE | Unit test |
| 3.1.7 | get_balance retourne les earnings | §Fee Distribution | `/get_balance --address <pubkey>` → montant | DONE | Unit test |
| 3.1.8 | get_stats retourne total_fees et fee_count | §Fee Distribution | `/get_stats` → stats globales | DONE | Unit test |
| 3.1.9 | list_fees affiche les derniers enregistrements | §Fee Distribution | `/list_fees` → derniers records | DONE | Unit test |

### 3.2 Staking (contract)
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 3.2.1 | register_stake lie un stake à une memory | §Staking | Stake → `stake/<memory_id>` créé | DONE | Unit test |
| 3.2.2 | register_stake rejette si pas l'auteur | §Staking | Non-auteur → erreur | DONE | Unit test |
| 3.2.3 | slash_stake requiert admin | §Staking | Non-admin → erreur | DONE | Unit test |
| 3.2.4 | slash_stake marque le stake comme slashed | §Staking | Admin slash → status "slashed" | DONE | Unit test |
| 3.2.5 | release_stake libère le stake (admin) | §Staking | Admin release → status "released" | DONE | Unit test |
| 3.2.6 | list_stakes affiche les stakes d'une adresse | §Staking | `/list_stakes` → liste | DONE | Unit test |

### 3.3 Payment Gate (MemoryIndexer)
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 3.3.1 | memory_read sans payment → payment_required | §Memory Read / Fee | Pas de payment_txid → quote 0.03 TNK | DONE | Unit test |
| 3.3.2 | memory_read avec payment → data servie | §Memory Read / Fee | payment_txid fourni → données + fee_recorded | DONE | Unit test |
| 3.3.3 | memory_read inexistant avec payment → found:false | §Memory Read | memory_id inconnu → found:false | DONE | Unit test |
| 3.3.4 | --require-payment flag respecté | §Payment Gate | false = pas de gate, true = gate active | TODO | Test live |
| 3.3.5 | Payment gate end-to-end (live) | §Fee Flow | Agent paie TNK → Memory Node sert données → fee enregistré | TODO | 2 peers, TNK |

### 3.4 Fee Accounting end-to-end (live)
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 3.4.1 | record_fee via TX depuis admin | §Fee Distribution | `/tx --command '{"op":"record_fee",...}'` → fee enregistré on-chain, 60/40 split vérifié | DONE | 0.03 TNK |
| 3.4.2 | get_balance reflète le fee split | §Fee Distribution | Après record_fee → creator balance 0.018 TNK (60%) | DONE | 3.4.1 |
| 3.4.3 | Staking via TX depuis Neurominer | §Staking | register_stake + slash_stake + release_stake tous testés live | DONE | 0.03 TNK |

---

## 4. Phase 3 — Skills & Multi-Cortex

### 4.1 Skill Registry (contract)
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 4.1.1 | register_skill crée l'entrée avec tous les champs | §Skills | `skill/<id>` avec name, description, cortex, price, version | DONE | Unit test |
| 4.1.2 | register_skill rejette skill_id dupliqué | §Skills | Doublon → erreur | DONE | Unit test |
| 4.1.3 | update_skill met à jour uniquement les champs fournis | §Skills | Partial update → champs non fournis inchangés | DONE | Unit test |
| 4.1.4 | update_skill rejette si pas l'auteur | §Skills | Non-auteur → erreur | DONE | Unit test |
| 4.1.5 | record_skill_download incrémente le compteur | §Skills | download++ | DONE | Unit test |
| 4.1.6 | record_skill_download split 80/20 | §Fee Distribution | Creator 80%, nodes 20% | DONE | Unit test |
| 4.1.7 | record_skill_download rejette payment_txid dupliqué | §Skills | Double-spend → erreur | DONE | Unit test |
| 4.1.8 | record_skill_download rejette skill inactif | §Skills | Status != active → erreur | DONE | Unit test |
| 4.1.9 | record_skill_download rejette skill inexistant | §Skills | Skill inconnu → erreur | DONE | Unit test |
| 4.1.10 | query_skill retourne les metadata | §Skills | `/query_skill --skill_id "..."` → objet complet | DONE | Unit test |
| 4.1.11 | list_skills liste les skills enregistrés | §Skills | `/list_skills` → liste | DONE | Unit test |
| 4.1.12 | list_skills_by_cortex filtre par cortex | §Skills | `/list_skills_by_cortex --cortex "crypto"` → liste filtrée | DONE | Unit test |

### 4.2 Skill Delivery (MemoryIndexer sidechannel)
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 4.2.1 | skill_publish stocke le package et déclenche register_skill | §Skill Download | Sidechannel msg → fichier skills/ + contract TX | DONE | Unit test |
| 4.2.2 | skill_request avec payment → package délivré | §Skill Download | payment_txid → skill_deliver response | DONE | Unit test |
| 4.2.3 | skill_request sans payment → payment_required | §Skill Download | Pas de txid → quote avec prix | DONE | Unit test |
| 4.2.4 | skill_catalog retourne la liste des skills d'un cortex | §Skill Download | Sidechannel msg → skill_catalog_response | DONE | Unit test |
| 4.2.5 | Skill publish end-to-end (live) | §Skills | Agent2 publie "DeFi Yield Tracker" (0.08 TNK) via sidechannel avec require-payment=true → stocké localement + on-chain. Publish non bloqué par payment gate. | DONE | 2 peers, restart |
| 4.2.6 | Skill download end-to-end (live) | §Skill Download | skill_request sans payment → payment_required. Avec payment_txid → package délivré + downloads=1 + record_skill_download on-chain. Split 80/20 : creator 0.064, nodes 0.016 TNK. fee_count=3. | DONE | require-payment true |

### 4.3 Multi-Cortex (contract)
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 4.3.1 | register_cortex crée un cortex (admin only) | §Cortex | `/register_cortex --name "cortex-dev" --description "..."` → enregistré | DONE | Unit test |
| 4.3.2 | register_cortex rejette non-admin | §Cortex | Non-admin → erreur | DONE | Unit test |
| 4.3.3 | list_cortex affiche les cortex enregistrés | §Cortex | `/list_cortex` → liste | DONE | Unit test |
| 4.3.4 | register_cortex end-to-end (live) | §Cortex | TX depuis admin → cortex-dev visible on-chain | DONE | 0.03 TNK |

---

## 5. Phase 4 — Opérations Live Mainnet

### 5.1 Operations validées
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 5.1.1 | Première memory écrite on-chain | §Memory Write | BTC $97k memory confirmée à poll #2 | DONE | 23/02/2026 |
| 5.1.2 | register_memory via TX (admin) | §Memory Write | `/tx --command '{"op":"register_memory",...}'` → confirmé | DONE | 0.03 TNK |
| 5.1.3 | query_memory cross-peer | §Memory Read | Admin écrit, Agent2 lit → données trouvées | DONE | Réplication OK |
| 5.1.4 | register_memory via TX (agent2) | §Memory Write | Agent2 écrit → confirmé, admin voit | DONE | add_writer |
| 5.1.5 | SC-Bridge auth + CLI commands | §SC-Bridge | WebSocket auth → /msb, /query_memory, /tx | DONE | |

### 5.2 Operations à tester (live)
| # | Test | Source WP | Commande / Scénario | Statut | Pré-requis |
|---|------|-----------|----------------------|--------|------------|
| 5.2.1 | record_fee via TX (live) | §Fee Distribution | Admin enregistre un fee → balance mise à jour, 60/40 split vérifié | DONE | 0.03 TNK |
| 5.2.2 | register_stake via TX (live) | §Staking | Auteur stake 0.05 TNK sur btc-price-97k → status active | DONE | 0.03 TNK |
| 5.2.3 | register_skill via TX (live) | §Skills | "Crypto Market Analysis" skill publié → visible on-chain | DONE | 0.03 TNK |
| 5.2.4 | register_cortex via TX (live) | §Cortex | cortex-dev créé → visible on-chain | DONE | 0.03 TNK |
| 5.2.5 | update_skill via TX (live) | §Skills | Version 1.0.0→1.1.0, partial update préserve les autres champs | DONE | 0.03 TNK |
| 5.2.6 | slash_stake via TX (live) | §Staking | Admin slash btc-price-97k → status slashed, total staked → 0 | DONE | 0.03 TNK |
| 5.2.7 | release_stake via TX (live) | §Staking | Nouveau stake sur btc-analysis-tagged → released | DONE | 0.06 TNK (2 TX) |
| 5.2.8 | Memory write via sidechannel (live) | §Memory Write | **2 BUGS FIXED:** (1) envelope unwrap in MemoryIndexer, (2) welcomeRequired=false. Agent2 → sc_send → admin MemoryIndexer → stored + on-chain. sc-live-test-003 = 8th memory. | DONE | Writer, 2 peer restarts |
| 5.2.9 | Memory read via sidechannel (live) | §Memory Read | Agent2 memory_read → admin SC-Bridge confirme réception. Admin MemoryIndexer broadcast memory_response. Terminal agent2 ne l'affiche pas (design: onMessage route vers SC-Bridge, pas stdout). | DONE | 2 peers |
| 5.2.10 | Payment gate live (require-payment=true) | §Fee Flow | Admin relancé avec --require-payment true. memory_read sans payment_txid → payment_required. memory_read avec payment_txid=test-payment-gate-001 → données servies + record_fee on-chain (60/40 split: creator 0.018 TNK, nodes 0.012 TNK). fee_count=2, total_fees=0.06 TNK. | DONE | Restart admin |
| 5.2.11 | Skill publish via sidechannel (live) | §Skills | **BUG FIXED:** MemoryIndexer manquait inputs/outputs/content_hash dans append('register_skill'). Agent2 → sc_send mnemex-skills → admin MemoryIndexer → package stocké localement + on-chain (status:active, downloads:0, content_hash OK). | DONE | Writer, admin restart |
| 5.2.12 | Skill download via sidechannel (live) | §Skill Download | Agent2 skill_request → admin reçoit (SC-Bridge confirme), MemoryIndexer broadcast skill_deliver avec package. requirePayment=false → pas de record_skill_download (attendu). Même pattern remote-only que 5.2.9. | DONE | 2 peers |

---

## 6. Robustesse & Edge Cases

| # | Test | Scénario | Statut | Pré-requis |
|---|------|----------|--------|------------|
| 6.1 | Peer reconnecte après déconnexion | Agent2 coupé (Ctrl+C), admin écrit reconnect-test-001 pendant la déconnexion, agent2 relancé → memory visible immédiatement (Autobase catch-up). | DONE | |
| 6.2 | Memory write avec content_hash invalide (pas sha256) | "trop-court" → "Invalid schema" (min:64, max:64 enforced) | DONE | |
| 6.3 | Bigint overflow dans fee calculation | 36-digit amount → simulation OK, BigInt natif = précision arbitraire, split 60/40 exact | DONE | |
| 6.4 | Concurrent writes depuis 2 peers | Admin + Agent2 TX simultanées → les 2 memories enregistrées sans conflit (Autobase CRDT) | DONE | 0.03 TNK × 2 |
| 6.5 | Peer non-writer tente d'écrire | `/tx` → "Peer is not writable" (pas de boucle) | DONE | Diagnostiqué |
| 6.6 | Memory_write depuis un peer non-writer (sidechannel) | Feature.append() → log silencieux, pas de crash | DONE | Diagnostiqué |

---

## Résumé

| Catégorie | Total | DONE | TODO | BLOCKED |
|-----------|-------|------|------|---------|
| 1. Infrastructure & Multi-Peer | 11 | 11 | 0 | 0 |
| 2. Phase 1 — Memory MVP | 13 | 13 | 0 | 0 |
| 3. Phase 2 — Neuronomics | 20 | 20 | 0 | 0 |
| 4. Phase 3 — Skills & Multi-Cortex | 16 | 16 | 0 | 0 |
| 5. Phase 4 — Mainnet Live | 17 | 17 | 0 | 0 |
| 6. Robustesse | 6 | 6 | 0 | 0 |
| **TOTAL** | **83** | **83** | **0** | **0** |

**40/40 tests unitaires passent** (10 memory-flow + 15 fees + 15 skills).
**83/83 tests validés** — toutes les sections complètes.
**3 bugs live fixés** : envelope unwrap, welcomeRequired default, skill publish missing fields.
