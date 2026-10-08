---
name: code-review
version: 1.0.0
description: Systematic code review with severity-ranked findings and concrete fixes
triggers: [review, code review, audit, inspect code, review code, perbaiki kode, review kode]
author: luna
---

# Code Review Procedure

Use when asked to review, audit, or improve code.

## Workflow
1. Discover scope: `fs.list --recursive` (or git diff via `git.diff` if reviewing changes).
2. Read the entry points first, then follow the call graph: `fs.read` + `fs.search` for symbols.
3. For each file, check in order:
   - **Correctness**: logic errors, off-by-one, null/undefined paths, unawaited promises
   - **Security**: injection, path traversal, secret leakage, unsafe eval/exec, prototype pollution
   - **Error handling**: bare catches, swallowed errors, missing timeouts
   - **Resources**: leaks (streams, timers, listeners), unbounded memory
   - **Style/consistency**: naming, duplication, dead code
4. Reproduce suspicions: `shell.exec` tests/snippets when cheap.
5. Report findings ranked 🔴 critical / 🟠 major / 🟡 minor / 🔵 nit, each with file:line, why it matters, and the concrete fix (code snippet).
6. Offer to apply fixes: use `fs.edit` for surgical changes, then run tests (`shell.exec`).

## Output format
1. **Summary** (2-3 sentences: health of the code, biggest risk)
2. **Findings table** (severity | location | issue | fix)
3. **Praise** — genuinely good patterns worth keeping
4. **Next actions** (prioritized list)
