# Changelog

## 2026-03-01 — First Mnemex Payment on Mainnet

**Milestone:** First end-to-end paid memory read on the Mnemex network.

### Flow validated
1. Agent 2 sends `memory_read` for gated memory `analysis-precious-metals-2026-02`
2. Agent 1 responds with `payment_required` (0.03 TNK split: 70% creator, 30% node)
3. Agent 2 sends 2 TNK transfers via `msb_transfer`:
   - 0.021 TNK → creator (`trac1jad8mn8...`)
   - 0.009 TNK → node (`trac1jad8mn8...`)
4. Agent 2 retries `memory_read` with both `payment_txid_creator` + `payment_txid_node`
5. Agent 1 verifies txids on MSB, serves data, records fee in contract

### Cost breakdown
- Mnemex fee: 0.03 TNK (split 70/30 creator/node for gated memory)
- Trac network fees: 0.06 TNK (2 transfers x 0.03 TNK each)
- Total cost to reader: 0.09 TNK

### Transaction IDs
- Creator payment: `8c4fe37f5dbd286ecb2b6f6ca401632b3466d69701d3b6cceb970f72b49f1d8e`
- Node payment: `5e6ea103e1ebda749e84d80efc3d48a0021550a77a2aca0c95723c3f4806c366`

### Commits in this release
- `04bc91c` feat: P2P relay for memory_read — peers can fetch memories from the network
- `f193b66` fix: SC-Bridge routes memory_read/search/list directly to local MemoryIndexer
- `e9b264d` feat: msb_transfer command for TNK transfers via protocol and SC-Bridge

### Known issues
- Hyperswarm P2P discovery between 2 localhost nodes: sidechannel broadcasts work unidirectionally (Agent 2 → Agent 1 confirmed, Agent 1 → Agent 2 not reliably received)
- P2P relay is implemented and tested (103 unit tests pass) but not validated E2E in real conditions due to the discovery issue
- Workaround: Agent 2 connects directly to Agent 1's SC-Bridge for reliable request/response
