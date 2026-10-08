---
name: skill-forge
version: 1.0.0
description: Create new skills for yourself and others — the meta-capability
triggers: [create skill, new skill, make a skill, build a skill, buat skill, teach yourself]
author: luna
---

# Skill Forge Procedure

Use when the user asks you to learn a reusable procedure, or when you notice yourself repeating a workflow that is worth packaging.

## What makes a good skill
- **Trigger words**: the words a future user (or you) will actually say. Include both English and the user's language.
- **Self-contained**: future-Luna reads ONLY the skill body — no session context. Spell out every step.
- **Bounded**: one procedure per skill. If it branches heavily, split it.
- **Tool-aware**: name the exact tools (`fs.search`, `shell.exec`…) and when to use each.
- **Failure paths**: what to do when a step fails.

## Workflow
1. `think`: is this really reusable (≥3 future uses)? What are the triggers?
2. Draft the skill body:
   - Title + one-line purpose
   - When to use / when NOT to use
   - Numbered steps (imperative, precise)
   - Example invocation + expected output
   - Pitfalls
3. `skills.create` with name (kebab-case), description (≤200 chars), triggers (5–10 words), instructions.
4. Verify: `skills.show <name>` — read it as a stranger; fix anything unclear.
5. Optionally test: `skills.run <name>` in a follow-up task.
6. `memory.save` (reflection): "forged skill <name> for <purpose>".

## Tool-packs (advanced)
If the skill needs a new tool (not covered by built-ins), also write
`~/.luna/skills/<name>.tools.js` exporting an array:
```js
export const tools = [{
  name: 'my_tool',
  description: '…',
  parameters: { type: 'object', properties: { /* … */ }, required: [] },
  async execute(args) { return { ok: true }; },
}];
```
`skills.run` loads it automatically. Keep tool-packs small and syntax-clean.
