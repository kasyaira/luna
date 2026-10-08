---
name: self-improvement
version: 1.0.0
description: Procedure for Luna to safely modify, extend, and evolve her own source code
triggers: [improve, self, evolve, upgrade, modify, patch, refactor, yourself, upgrade yourself, modify yourself]
author: luna
---

# Self-Improvement Procedure

Use when the user asks you to change your own behavior, add a capability, or fix something in your code.

## Rules of safety
1. **Snapshot first**: always call `self.snapshot` with a label describing the change before patching anything.
2. **Small diffs**: prefer `fs.edit` (surgical) over `self.patch` (whole-file rewrite) when possible.
3. **Validate**: `self.patch` syntax-checks automatically; after any change run `self.check`.
4. **Recover**: if anything breaks, `self.rollback` restores the latest snapshot. A broken boot auto-restores too.
5. **Learn**: save what you changed and why to `procedural` memory, tagged `self-modification`.

## Workflow
1. `think`: state the goal, list files to touch, predict risks.
2. `self.snapshot <label>`.
3. `self.read` the target file(s). Understand existing code before touching it.
4. Apply the change (`fs.edit` for small fixes, `self.patch` for new files).
5. `self.check` — everything must pass.
6. If new behavior is procedural/reusable: `skills.create` with clean instructions.
7. Tell the user to restart (`luna`) for a clean boot, or use `self.reload` for a hot reload.
8. `memory.save` (procedural): what/why/how — future-you will thank present-you.

## Ideas ranked by safety
- Safest: add a new skill (`.md`) — zero code risk.
- Safe: add a new tool module + register it in `src/tools/index.js`.
- Medium: edit prompt text in `src/agent/context.js`.
- Risky: touch the loop (`src/agent/loop.js`) or provider adapter — always snapshot + check.
