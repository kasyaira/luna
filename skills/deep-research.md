---
name: deep-research
version: 1.0.0
description: Multi-source web research with synthesis — fetch, cross-check, cite
triggers: [research, investigate, find out, survey, compare, sumber, telusuri, riset, cari tahu]
author: luna
---

# Deep Research Procedure

Use when the user asks you to research a topic, compare options, or verify facts.

## Workflow
1. `think`: decompose the question into 3–6 concrete sub-questions.
2. `web.search` each sub-question (parallel tool calls are fine).
3. `web.fetch` the 2–4 most promising URLs for depth. Prefer official docs, primary sources, recent dates.
4. Cross-check: facts that appear in ≥2 independent sources are "verified"; single-source facts get marked as "claimed".
5. Synthesize: a structured answer with sections, a comparison table when options differ, and a source list (title + URL).
6. `memory.save` (semantic): distilled facts + tags, so next time you already know.

## Output format
- **Answer** (direct, up front)
- **Findings** (organized by sub-question)
- **Confidence** (verified vs claimed items)
- **Sources** (list)

## Notes
- If web.search is rate-limited or empty, fall back to `web.fetch` on known aggregators (wikipedia.org, docs sites) or say precisely what blocked you.
- Never invent URLs. If you didn't fetch it, don't cite it.
- For rapidly-changing topics (models, prices, APIs), state the retrieval date.
