# Whitepaper v0.3 → v0.4 — Changes

All modifications to apply to `mnemex-whitepaper-v0.3-en.docx`.

---

## 1. Section 3.2 — Open Memory and Gated Memory (line ~102)

**OLD:**
> Open Memory is replicated across all memory nodes and accessible to all agents for a standard micro-fee. Gated Memory stays on its owner's node and is only accessible to authorized agents, for a premium fee.

**NEW:**
> Open Memory is replicated across all memory nodes and **freely accessible to any agent** — no fee, no payment. This maximizes network effects: the more knowledge is freely available, the more agents join the network, and the more Neurominers have an audience for their premium Gated content. Gated Memory stays on its **creator's node** and is only accessible to agents who pay the creator's price. The creator serves the data directly — no intermediary, no third-party hosting.

---

## 2. Section 5.1 — Neuromining (line ~126)

**OLD:**
> - **Consume.** An agent queries the memory and pays a micro-fee to access data.

**NEW:**
> - **Consume.** An agent queries Open Memory for free, or pays the creator's price to access premium Gated Memory or download a Skill.

---

## 3. Section 5.2 — Fee Distribution (line ~134)

**OLD:**
> Every micro-payment is distributed between the creator Neurominer and the Memory Nodes hosting the data.

**NEW:**
> Payments only occur for Gated Memory reads and Skill downloads. Open Memory is free — it's the public commons of the network. When a payment occurs, it goes directly to the creator Neurominer who serves the data. The complete model is detailed in Section 9 (Neuronomics).

---

## 4. Section 6.2 — Staking (REMOVE ENTIRELY)

**OLD:**
> An agent that publishes information must put up a TNK amount. If the information is confirmed, it recovers its stake plus the reward. If it's proven false, it loses its stake. This mechanism makes spam and manipulation expensive. It's the same principle as Trac validators: skin in the game guarantees honesty.

**NEW:**
> *(Remove this section entirely. Staking is removed from the protocol. Spam prevention relies on reputation scores and rate limiting instead.)*

---

## 5. Section 8.3 — Anatomy of a Skill (line ~216)

**ADD after existing content:**
> A Skill's package can take multiple forms. The simplest and most powerful is a **markdown prompt template** — a structured document that gives an agent a complete analysis framework. For example, a "DeFi Token Analyzer" Skill might contain a step-by-step methodology covering tokenomics, smart contract risk, liquidity analysis, team assessment, and market positioning. The agent downloads this template, applies it to any token, and produces a structured output.
>
> Once downloaded, a Skill is stored locally by the agent. The agent pays once and can reuse the Skill indefinitely — like buying a book rather than renting it.

---

## 6. Section 8.5 — Open Skills (line ~238)

**OLD:**
> Second, staking: the creator who stakes tokens signals confidence in quality.

**NEW:**
> Second, reputation: the creator's track record and download count signal quality.

*(Remove all other staking references in this section)*

---

## 7. Section 9.2 — The Three Operations (line ~266-268)

**OLD:**
> - **Memory Write.** A Neurominer publishes data to the network. It pays a publication fee (Trac network fees + Mnemex micro-fee for storage) and must stake an amount in TNK during the verification period. If the data is validated by consensus, it recovers its stake and begins receiving royalties on every consultation. If the data is rejected as fraudulent or low quality, it loses part of its stake.

**NEW:**
> - **Memory Write.** A Neurominer publishes data to the network. Publication is **free** — no Mnemex fee. The only cost is the Trac network fee (0.03 $TNK) for the on-chain registration transaction.

**OLD:**
> - **Memory Read.** An agent queries data stored on Mnemex. For Open Memory, the fee is minimal and set by the protocol. For Gated Memory, the fee is set by the Neurominer who published the data — the market decides the value. Distribution is shared between the creator Neurominer and the Memory Nodes hosting the data.

**NEW:**
> - **Memory Read.** An agent queries data stored on Mnemex. **Open Memory is free** — no fee, no payment, instant access. For Gated Memory, the fee is set by the Neurominer who published the data — the market decides the value. The payment is split between the creator (70%) and the Memory Node relaying the request (30%), plus two MSB network fees (0.06 $TNK total).

---

## 8. Section 9.3 — Revenue Distribution (line ~274-276)

**OLD:**
> - **Memory Read (Open Memory).** 60% to the creator Neurominer, 40% to Memory Nodes.
> - **Memory Read (Gated Memory).** 70% to the creator Neurominer, 30% to Memory Nodes.
> - **Skill Download.** 80% to the creator Neurominer, 20% to Memory Nodes.

**NEW:**
> - **Memory Read (Open Memory).** **Free.** No fee, no split. Open Memory is the public commons — free access maximizes adoption. Neurominers build reputation through Open contributions, then monetize via Gated Memory and Skills.
> - **Memory Read (Gated Memory).** 70% to the creator Neurominer, 30% to the Memory Node that relays the request. The creator sets the price freely. The agent pays two MSB transfers: one to the creator (70%), one to the relay node (30%).
> - **Skill Download.** 80% to the creator Neurominer, 20% to the Memory Node that relays the request. The creator sets the price freely.

---

## 9. Section 9.4 — Open Memory Query Pricing (REPLACE ENTIRELY)

**OLD:**
> The Mnemex fee for an Open Memory query is indexed to the Trac Network transaction fee. Specifically, the Mnemex fee equals 100% of the network fee — currently 0.03 $TNK. The total cost of an Open Memory query is therefore 0.09 $TNK...

**NEW:**
> ### 9.4 Open Memory: The Free Commons
>
> Open Memory queries are entirely free. No Mnemex fee, no MSB transfers, no cost to the requesting agent. This is a deliberate design choice:
>
> 1. **Maximize adoption.** A free knowledge base attracts agents. The more agents use Mnemex, the larger the audience for premium Gated content and Skills.
> 2. **Build reputation.** Neurominers publish Open Memory to build their reputation score, then monetize via premium Gated content and Skills.
> 3. **No friction.** Micro-payments on free data would slow adoption. Free access creates a virtuous cycle: agents discover Mnemex through free data, then upgrade to paid content.
>
> Revenue is generated exclusively through Gated Memory reads and Skill downloads.

---

## 10. Section 9.5 — Verification Staking (REMOVE ENTIRELY)

**OLD:**
> Every Memory Write requires a temporary TNK stake...

**NEW:**
> *(Remove this entire section. Staking is removed from the protocol.)*

---

## 11. Section 9.7 — The Virtuous Circle (ADD)

**ADD:**
> Free Open Memory is the entry point of this flywheel. An agent discovers Mnemex through free data, builds trust in the network, then naturally upgrades to paid Gated Memory and Skills when the value justifies the cost.

---

## 12. Updated Fee Table

| Operation | Mnemex Fee | Creator | Relay Node | Network Fees | Total Agent Cost |
|---|---|---|---|---|---|
| Open Memory Read | **Free** | — | — | — | **0** |
| Open Memory Write | **Free** | — | — | 0.03 $TNK (1 TX) | **0.03 $TNK** |
| Gated Memory Read | Creator sets price | 70% | 30% | 0.06 $TNK (2 TX) | price + 0.06 $TNK |
| Skill Download | Creator sets price | 80% | 20% | 0.06 $TNK (2 TX) | price + 0.06 $TNK |

*The relay node is the Memory Node that routes the request from the agent to the creator. The 0.06 $TNK network fees (two MSB transfers) go to Trac Network validators.*

---

## 13. Remove all staking references throughout the document

Search and remove mentions of:
- "stake" / "staking" (except in section 6.5 Trust Levels if it refers to external staking)
- "skin in the game" related to staking
- "stake amount" / "stake is locked"
- Section 8.5: replace "staking" protection mechanism with "reputation"

---

## Summary of Changes

1. **Open Memory = free** (was 0.03 TNK)
2. **Memory Write = free** (was fee + mandatory staking)
3. **Staking = removed entirely** (spam prevention via reputation + rate limiting)
4. **Gated Memory = creator serves via relay node** (70% creator, 30% relay node)
5. **Skills = can be markdown prompt templates** (not just structured descriptors)
6. **Fee table updated** (open = free, gated = 70/30 split, skills = 80/20 split)
