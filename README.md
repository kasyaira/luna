<div align="center">

# 🌙 Luna

**Self-evolving, embodied AI terminal agent**

`sees (webcam + screen) · acts (mouse + keyboard) · parallel memory · self-modification · skills · self-healing · self-upgrade`

[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-green)](https://nodejs.org)
[![deps](https://img.shields.io/badge/dependencies-0-blue)]()
[![license](https://img.shields.io/badge/license-MIT-purple)](LICENSE)

</div>

Luna is an AI agent that lives in your Ubuntu terminal. She has **real tools** — she reads and writes files, runs shell commands, searches the web, remembers you across sessions, builds her own skills, edits her own source code, and repairs herself when something breaks.

Since **v1.1.0** she is **embodied**: she *sees* through your webcam and screen (keyless vision, no API key needed) and *acts* with the real mouse and keyboard. Ask her to look at your screen, click a button, fill a form, or watch the room through the camera.

She works **out of the box with zero configuration** (keyless AI endpoints), then upgrades herself automatically to better providers the moment you give her any free API key. She never asks for anything before she starts working.

---

## ✨ What makes Luna different

| Capability | What it means |
|---|---|
| 👀 **Eyes (v1.1.0)** | She *sees*: `vision.look` (webcam, warm-up aware), `screen.look` (screenshot + vision with pixel coordinates), `vision.analyze` (any image file). Keyless vision endpoint built in — works with zero config. |
| 🖐 **Hands (v1.1.0)** | She *acts*: `input.mouse` (move/click/drag/scroll), `input.type`, `input.key` (combos), `input.windows`. Closed-loop rule baked into her behavior: look → act → verify. |
| 🧠 **Parallel memory** | 5 independent memory banks (working, episodic, semantic, procedural, reflection) queried *in parallel* with TF-IDF + recency + importance ranking. She remembers you between sessions. |
| 🔧 **Real tools** | 59 built-in tools: filesystem, shell, git, web, memory, skills, eyes, hands, self-modification, self-upgrade, diagnostics. |
| 🧬 **Self-modification** | She reads and patches her own source code (`self.patch`) — with automatic syntax validation, backups, snapshots, and one-command rollback. |
| ⬆️ **Self-upgrade (v1.1.0)** | `self.upgrade` / `luna self upgrade`: pulls the newest code from GitHub (git or zip), snapshot + integrity check + auto-rollback + relaunch. This is how she gains new abilities on her own. |
| 🩹 **Self-healing** | Broken her own code? Boot-time integrity guard + last-resort repair restore files from snapshots automatically. Errors become procedural memories (error→fix learning). Providers fail-over with circuit breakers. |
| 📚 **Self-made skills** | She distills reusable know-how into skills (`skills.create`), installs skills from any URL (`skills.install`), and skill *tool-packs* literally give her new tools. |
| 🌐 **Zero-config AI** | Keyless endpoints first (works instantly), 12+ optional keyed providers, auto failover chain, local Ollama/LM Studio auto-detection. |
| 🛡️ **Dual tool protocol** | Native OpenAI tool-calling where supported; automatic JSON-protocol fallback for endpoints without it — *any* OpenAI-compatible endpoint works. |
| 📦 **Zero dependencies** | Pure Node.js (≥18). No npm packages, no supply chain, `npm i -g .` just works offline. |

## 🚀 Install (Ubuntu)

```bash
# requirements: node >= 18
node --version

git clone https://github.com/kasyaira/luna.git
cd luna
npm install -g .    # registers the `luna` command (no network needed)
luna                # 🌙 that's it — no key, no config
```

Prefer npx-style? `node bin/luna.js` works from the repo directly.

## 💬 Quick start

```bash
luna                              # interactive chat (streaming, slash commands)
luna "what can you do?"           # one-shot question
luna "look at my screen and tell me which windows are open"
luna "open Firefox, search for interlacing video, tell me the top result"
luna "lihat kamera sebentar, ada orang di ruangan?"   # she speaks your language
luna sensors                      # body report: webcam, display, mouse/keyboard, vision
luna run "clean up ~/Downloads:   # autonomous mode — full tool budget
  move all .pdf files into a pdf/ folder and list what you moved"
luna ask "2+2?"                   # quick answer, no tools
luna doctor                       # full self-diagnostic (integrity + providers + body)
```

Inside the REPL:

```
/help            all commands
/memory          memory bank stats      /recall <query>   search memories
/skills          list skills            /skills run <name>
/self check      verify own source      /self snapshot
/providers       all AI endpoints       /provider groq    switch
/health          probe endpoints        /doctor           diagnose everything
/exit            leave (memories persist)
```

## 👀🖐 Eyes & hands (what v1.1.0 adds)

Luna is no longer just a terminal mind — she has a **body**:

**Eyes — she sees:**
- `vision.look` — captures a webcam photo (skips the first dark frames) and *understands* it with a vision model. Ask: *"look at the camera, is my package on the desk?"*
- `screen.look` — screenshots the display and *reads* it: which windows are open, where the buttons are (approximate pixel coordinates).
- `vision.analyze` — understands any image file on disk (photo, screenshot, download).
- Eyes work **keyless out of the box** (anonymous vision endpoint, verified live). Private/offline alternative: Ollama with a vision model (e.g. `moondream`) is auto-detected and preferred.

**Hands — she acts:**
- `input.mouse` — `move`, `click`, `doubleclick`, `drag`, `scroll` (left/right/middle button).
- `input.type` — types text into whatever field has focus (UTF-8, adjustable speed).
- `input.key` — key combos (`ctrl+shift+t`, `alt+F4`, `super`), whitelisted against injection.
- `input.windows` — list / activate / close / minimize windows (X11).

Her behavior follows a **closed loop**: *look → act → look again to verify → adjust*. The system prompt enforces it — she doesn't blind-click, she checks her own work like a human would.

**One-time setup on Ubuntu** (she tells you the exact same fix if something is missing — `luna sensors`):

```bash
sudo apt install -y xdotool ffmpeg scrot wmctrl   # X11 sessions (default on Ubuntu with Xorg)
# Wayland sessions instead: sudo apt install -y ydotool wtype grim
# (ydotool needs: sudo systemctl enable --now ydotoold && sudo usermod -aG input $USER, then re-login)
```

**Notes & limits:**
- X11 gives full hands; Wayland restricts mouse/window control by design (typing via `wtype`, mouse via `ydotool`).
- Webcam frames and screenshots are sent to the vision model over the network (that's how keyless vision works). For privacy, run Ollama + a local vision model — Luna prefers it automatically when available.
- She asks before taking webcam photos of you, and screenshots go no further than her vision call.

## 🌐 AI endpoints (the provider chain)

Luna ships with a **researched, verified registry of 16 endpoints** — see [docs/ENDPOINTS.md](docs/ENDPOINTS.md) for the full live-verified list with signup links.

**Works instantly, no key:**
- `pollinations` — anonymous tier, gpt-oss-20b with native tool calls & streaming
- `kilo` — anonymous gateway, **vision-capable** (this is what gives Luna keyless eyes)

**Free-tier keys (recommended upgrade — any one of them):**

| Provider | Env var | Get key |
|---|---|---|
| Groq (LPU fast) | `LUNA_GROQ_KEY` | console.groq.com/keys |
| Google Gemini | `LUNA_GEMINI_KEY` | aistudio.google.com/apikey |
| OpenRouter (`:free` models) | `LUNA_OPENROUTER_KEY` | openrouter.ai/keys |
| Mistral | `LUNA_MISTRAL_KEY` | console.mistral.ai |
| Cerebras / SambaNova / Together / HF / DeepSeek / Cohere / … | see `luna providers` | |

**Local & private (auto-detected):** `ollama serve` (127.0.0.1:11434) or LM Studio (1234).

**Any other OpenAI-compatible server:**
```bash
export LUNA_PROVIDER=custom
export LUNA_BASE_URL=http://your-server/v1
export LUNA_API_KEY=...        # optional
export LUNA_MODEL=your-model
```

Failover is automatic: keyed providers (best) → keyless → local. Circuit breakers trip after repeated failures; 429s back off; 402 (budget) triggers **compact JSON mode** which slims context to keep working.

```bash
luna providers     # see everything
luna health        # probe all in parallel
luna config set provider groq
```

## 🧠 Memory

Luna's brain lives in `~/.luna/` — private to your machine, persists forever, git-ignored.

- **working** — session scratchpad (fast decay)
- **episodic** — what happened, auto-logged every turn
- **semantic** — distilled facts about you & your projects (no decay)
- **procedural** — how-to knowledge and **error→fix pairs** (this is how she gets better at debugging *your* machine)
- **reflection** — her own notes-to-self

```
you:  remember that my prod server is srv-alfa and I deploy on fridays
luna: (memory.save semantic, importance 0.8 …)
…next week, different process…
you:  what's my prod server?
luna: srv-alfa — and you deploy on Fridays. (recalled from semantic memory)
```

Consolidation runs automatically: episodic noise is distilled into semantic facts. Manual gardening: `/memory`, `/save`, `/recall`, `/forget`, `luna memory consolidate`, and the bundled **memory-gardening** skill.

## 🧬 Self-modification (safely)

```
you:  add a `wordcount` tool to your toolbelt
luna: (self.snapshot) → (self.patch src/tools/…) → (self.check) → done
      restart me or run self.reload to hot-reload
```

Guard rails:
1. `self.patch` writes to a temp file first, **syntax-checks it with `node --check`**, and only then atomically swaps it in. Broken code never lands.
2. Every patch auto-backs-up; `self.snapshot` captures the whole source tree.
3. If anything still breaks: boot-time integrity guard detects it and **restores from snapshots automatically** (`[luna] self-recovered 1 file(s): src/…`).
4. `luna self rollback` — one command, back in time.

## 📚 Skills

Skills are markdown procedure files (with frontmatter triggers) in `~/.luna/skills/`. Bundled: `self-improvement`, `deep-research`, `code-review`, `debug-fix`, `memory-gardening`, `skill-forge`.

```bash
luna skill list
luna "review my code in src/ for bugs"       # code-review skill auto-activates
luna "create a skill for deploying my blog"  # she writes it herself
luna skill install https://raw.githubusercontent.com/.../skill.md
```

A skill can also ship a `<name>.tools.js` tool-pack — activating the skill gives Luna brand-new tools at runtime.

## 🩹 Self-healing

- **Boot guard** — every module import is wrapped; failures trigger the zero-dependency last-resort repair (syntax scan of `bin/` + `src/`, restore from `~/.luna/backups`)
- **Supervisor** — uncaught exceptions are logged, learned (`procedural` memory), and auto-repaired when they point at her own files
- **Provider failover** — retry with backoff, circuit breakers, health probes
- **Compact JSON mode** — tight budgets degrade gracefully instead of failing
- **`luna doctor`** — one command full diagnostic (integrity + providers + memory + router)

## 🖥️ CLI reference

```
luna                    interactive REPL
luna "<msg>"            one-shot
luna run "<task>"       autonomous agent mode
luna ask "<q>"          quick answer (no tools)
luna sensors            body report: webcam, display, input backends, vision
luna doctor | health | providers | ping
luna skill list|show|run|remove|install …
luna memory stats|search|forget|consolidate
luna self info|check|snapshot|rollback|backups|upgrade [auto|git|github|<zip>]
luna config get|set|list
luna version | help

flags: --provider <id> --model <id> --max-iters <n> --json --no-color
```

## ⚙️ Configuration

Precedence: **CLI flags > env vars > `~/.luna/config.json` > defaults**.

```bash
luna config list
luna config set provider groq
luna config set maxIterations 40
luna config set persona "You are Luna, my deployment co-pilot"
```

Everything lives in `~/.luna/` — `memory/`, `skills/`, `backups/`, `logs/`, `sessions/`, `history`, `config.json`. Wipe it for a factory reset.

## 🏗️ Architecture

```
bin/luna.js              CLI entry + resilient import wrapper (self-healing boot)
src/
├── boot.js              boot sequence with integrity guard
├── constants.js config.js
├── agent/               context builder · tool-execution loop · LunaAgent
├── providers/           16-endpoint registry · router (failover/circuit breaker)
│                        · OpenAI-compatible adapter (SSE, tool calls, reasoning)
├── memory/              5 parallel banks · JSONL stores · TF-IDF retrieval · consolidation
├── tools/               28 tools incl. self-modification & healing
├── skills/              loader · frontmatter parser · tool-pack loader · matcher
├── healing/             supervisor · syntax validator · backup/rollback · last-resort
└── ui/                  banner · REPL · spinner (zero-dep ANSI)
skills/                  bundled skills
docs/ENDPOINTS.md        the endpoint research
```

```bash
npm test          # 19 offline smoke tests
npm test -- --net # + live endpoint tests
```

## 🧭 Troubleshooting

| Symptom | Fix |
|---|---|
| `keyless budget exhausted` | The anonymous tier for your IP is cooling down — retry in a few minutes, or add any free key (`luna providers`), or `ollama serve` |
| provider 401/403 | key rejected — `luna config set provider auto` |
| answers in wrong language | just tell her — she mirrors you |
| eyes/hands tools fail | `luna sensors` prints the exact missing piece + one-line fix (e.g. `sudo apt install -y xdotool`) |
| mouse/keyboard do nothing on Wayland | Wayland restricts input control — install `ydotool wtype`, enable `ydotoold`, add yourself to the `input` group, re-login; or use an X11 session |
| webcam capture fails | check privacy shutter/USB; `vision.devices` to list cameras; `sudo apt install -y ffmpeg`; other apps may hold the device (close Zoom/browser tabs) |
| vision says "no vision model available" | offline? keyless endpoint unreachable — check internet, or run Ollama with a vision model (`ollama pull moondream`) |
| something feels broken | `luna doctor`, then `luna self rollback` if needed |
| total mess | `rm -rf ~/.luna` (factory reset; repo reinstall for code) |

## 📄 License

MIT — see [LICENSE](LICENSE).

Luna is the moon. 🌙
