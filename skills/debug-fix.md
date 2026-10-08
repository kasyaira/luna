---
name: debug-fix
version: 1.0.0
description: Root-cause debugging loop — reproduce, isolate, hypothesize, fix, verify
triggers: [debug, error, bug, broken, crash, not working, fails, exception, fix it, perbaiki]
author: luna
---

# Debug & Fix Procedure

Use when something errors, crashes, or misbehaves.

## Loop (repeat until fixed)
1. **Reproduce**: run the failing thing (`shell.exec`). No repro → no fix. Capture the exact error.
2. **Read the error**: file, line, message. `fs.read` around that line (±30 lines).
3. **Hypothesize**: `think` — 2-3 candidate causes, cheapest-to-check first.
4. **Isolate**: `fs.search` for related symbols; add tiny probes (log lines or `shell.exec` one-liners) if needed.
5. **Fix**: smallest change that addresses the root cause (not the symptom). `fs.edit`.
6. **Verify**: re-run the repro. Then run adjacent tests to catch regressions.
7. **Record**: `memory.save` (procedural) — ERROR → ROOT CAUSE → FIX, tags `[error, fix]`. This is how you get smarter at debugging *this* machine.

## Rules
- Change ONE thing per iteration. Random multi-edits destroy the signal.
- If 3 loop iterations fail: step back, re-read assumptions, consider a different layer (env, versions, permissions — check `shell.exec` with `env | sort`, `node -v`, `which`).
- Ask the user only when the fix requires a decision (delete data? change API? spend money?).
