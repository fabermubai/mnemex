# Mnemex — Backlog (idées futures)

## Infrastructure
- [ ] Exposer le SC-Bridge sur internet (domaine, TLS, rate limiting) pour permettre aux clients légers de se connecter sans installer Mnemex
- [ ] Publier un package npm `mnemex-client` (SDK) pour que les devs puissent intégrer Mnemex sans cloner le repo — avec callback onConfirmTransaction pour validation des dépenses TNK
- [ ] Clients légers : un utilisateur avec juste un wallet Trac + connexion WebSocket peut utiliser Mnemex sans peer

## Intégrations
- [ ] Bot Telegram/Discord connecté à Mnemex via SC-Bridge — agent permanent qui notifie l'humain en temps réel (nouvelles memories, gated, skills, earnings, chat)
- [ ] Exemple d'agent autonome (Claude/GPT) connecté via WebSocket

## Protocole
- [x] ~~Fix MSB verification trust fallback~~ — DONE: trust fallback retiré, faux txids rejetés
- [ ] Vérifier montant + destinataire des paiements — actuellement on vérifie seulement que le txid existe sur le MSB, pas que le paiement est au bon montant/adresse. Nécessite une API MSB pour lire les détails de transaction (pas disponible upstream pour l'instant). Risque: réutilisation de txids d'autres transactions.
- [ ] Échange de fichiers (PDF, images) via Hyperblobs + hash on-chain
- [ ] Réplication gated (CDN payant) — un Memory Node paie une fois et revend
- [ ] Investiguer auto-add writer / auto-promote indexer (handshake Autobase ne fonctionne pas toujours)

## Contract
- [ ] Memory update — permettre l'écrasement on-chain si `existing.author === new.author` (actuellement first-write-wins, le data local est écrasé mais le metadata on-chain reste bloqué sur le premier write)

## Économie
- [ ] Étudier l'ajout d'un "protocol fee" (petit % sur chaque transaction Mnemex qui va au déployeur/admin)
- [ ] Documenter les 25% deployer fees du MSB déjà en place

## Documentation
- [ ] Créer un tutoriel vidéo ou guide pas-à-pas pour nouveaux utilisateurs
