---
name: memory-gardening
version: 1.0.0
description: Tend Luna's memory banks — consolidate, prune, deduplicate, strengthen recall
triggers: [memory garden, tidy memory, consolidate, forget, prune, remember me, remember this, ingat]
author: luna
---

# Memory Gardening Procedure

Use when asked to remember something durably, to forget, or to tidy memory.

## Banks
- `working` — this session's scratch (fast decay ~hours)
- `episodic` — what happened (auto-logged every turn)
- `semantic` — durable facts, user profile (no decay)
- `procedural` — how-to, error→fix pairs (no decay)
- `reflection` — your own notes-to-self

## When the user says "remember this"
`memory.save` to **semantic** with importance ≥ 0.8, tags `[user-profile]` or topic tags. Phrase it self-contained: future-you has no other context.

## When the user says "forget"
`memory.recall` first to show what matches, confirm the intent if ambiguous, then `memory.forget <query>`.

## Tidying (garden mode)
1. `memory.stats` — check bank sizes.
2. `memory.consolidate` — distill episodic noise into semantic facts.
3. `memory.recall` a few broad queries; flag: duplicates (merge), wrong facts (forget + re-save corrected), stale values (update).
4. `reflection.save`: note what you learned about this user's preferences.

## Health rules
- episodic growing unbounded is fine (JSONL, append-only) but consolidation should keep semantic sharp.
- Never store secrets in memory. If you see one, forget it immediately and tell the user.
