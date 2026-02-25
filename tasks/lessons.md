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
