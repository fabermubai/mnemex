# Mnemex — Lessons Learned

<!-- Erreurs corrigées et patterns à retenir -->

## Bugs connus résolus
- **parseBool temporal dead zone**: `const parseBool` was used on lines 70/76 of `index.js` before its declaration on line 78. Fix: moved the function definition above its first usage (line 66). Lesson: always define utility functions before any code that references them.
- **dhtBootstrap undefined override**: Passing `dhtBootstrap: undefined` explicitly to trac-peer's Config caused `#isOverriden` to return true (because `hasOwnProperty` returns true for explicitly set keys), overriding MAINNET defaults. Fix: only include the key in the config object when a value actually exists (`if (value) config.key = value`). Lesson: never pass `undefined` explicitly as a config value — omit the key entirely.

## Premier lancement de peer
- **Erreur**: Claude Code a lancé le peer automatiquement via `pear run`, bypassant le menu interactif. La seed phrase a été générée mais jamais affichée.
- **Règle**: Toujours lancer le PREMIER setup d'un nouveau peer MANUELLEMENT dans le terminal pour récupérer la seed phrase. Claude Code ne prend le relais qu'après.
- **Récupération**: La seed phrase est chiffrée dans stores/*/db/keypair.json, déchiffrable avec `wallet.importFromFile(path, b4a.alloc(0))`.

## Wallet setup interactif
- **Erreur**: index.js bypassait le menu interactif de trac-wallet et générait le keypair silencieusement
- **Fix**: remplacé par wallet.initKeyPair(keyPairPath) qui affiche le menu natif au premier lancement (generate, restore from mnemonic, import from file)
- **Règle**: ne jamais bypasser le flow interactif de wallet pour les opérations sensibles (création de clés, seed phrase)

## Subnet bootstrap Autobase
- **Erreur**: chaque nouveau peer créait son propre Autobase au lieu de rejoindre celui de l'admin, car le subnet-bootstrap n'était pas hardcodé dans index.js
- **Symptôme**: query_memory retourne null sur le nouveau peer malgré les connexions sidechannel et MSB OK
- **Fix**: hardcoder MNEMEX_SUBNET_BOOTSTRAP dans index.js avec la clé de l'admin
- **Règle**: tout subnet Intercom doit avoir son bootstrap key hardcodé pour que les nouveaux peers rejoignent le bon Autobase automatiquement

## Autobase writer permissions
- **Symptôme**: un nouveau peer peut LIRE les memories (réplication OK) mais pas ÉCRIRE — `Feature.append()` échoue silencieusement ("Peer running features not writable"), `/tx` throw "Peer is not writable"
- **Cause**: l'Autobase requiert une autorisation explicite de l'admin pour chaque writer. Un nouveau peer rejoint en lecture seule par défaut
- **Fix**: sur le terminal admin, exécuter `/add_writer --key "<writer-key-hex>"` (commande intégrée à trac-peer, pas de code Mnemex nécessaire)
- **Attention**: la clé à utiliser est le **writer key** (`peer.base.local.key`, affiché au démarrage comme "Peer writer key"), PAS la wallet pubkey ni l'adresse trac
- **Dev**: `/set_auto_add_writers --enabled 1` sur admin active l'auto-ajout pour tous les peers qui se connectent — pratique en dev, à désactiver en production
- **Pas de redémarrage nécessaire** : le changement se propage via réplication Autobase
- **Faux positif "boucle infinie"** : quand `/tx` échoue sur un non-writer, le terminal trac-peer (REPL) catch l'erreur, l'affiche, et ré-affiche le prompt. Ce n'est pas une boucle — c'est le comportement normal du REPL après une erreur

## Sidechannel envelope wrapping
- **Symptôme**: `memory_write` envoyé via `/sc_send` sur `cortex-crypto` n'est jamais traité par le MemoryIndexer — `/get --key "mem/<id>"` retourne null
- **Cause**: le sidechannel wrappe chaque message dans une enveloppe `{ type: "sidechannel", id, channel, from, origin, message: <contenu>, ts, ttl }`. Le MemoryIndexer recevait cet objet enveloppe et faisait `String(payload)` → `"[object Object]"` → `JSON.parse` échouait silencieusement
- **Fix**: dans `features/memory-indexer/index.js`, extraire `payload.message` de l'enveloppe avant le parsing JSON. Voir handleMessage() lignes 85-95
- **Deuxième point**: `broadcast()` envoie aux peers DISTANTS uniquement — `onMessage` ne fire jamais pour les messages broadcast par le peer local. Le test correct requiert 2 peers : un qui envoie (Neurominer) et un qui reçoit + indexe (Memory Node)
- **Tests**: 40/40 tests unitaires passent après le fix (memory-flow: 10, fees: 15, skills: 15)

## Sidechannel welcomeRequired bloque les cortex channels
- **Symptôme**: agent2 broadcast un message sur cortex-crypto, l'admin ne le reçoit jamais (ni le MemoryIndexer, ni le SC-Bridge). Aucune erreur côté envoyeur.
- **Cause**: `sidechannelWelcomeRequired` est `true` par défaut (hérité d'Intercom). Tous les canaux non-entry (cortex-crypto, mnemex-skills...) exigent un welcome handshake. Sans welcome, les messages entrants sont silencieusement droppés (`drop (awaiting welcome)` en mode debug).
- **Fix**: dans `index.js` ligne 270, changer le défaut de `parseBool(..., true)` à `parseBool(..., false)`. Les cortex channels Mnemex doivent être ouverts.
- **Règle**: pour tout nouveau canal Mnemex, vérifier qu'il ne nécessite pas de welcome/invite (sauf si c'est voulu pour un canal privé/gated)
