# Luna — AI Endpoint Research (verified 2026-10-08)

This is the provider research behind Luna's registry (`src/providers/registry.js`).
Every endpoint below speaks the **OpenAI chat-completions dialect**
(`POST {baseUrl}/chat/completions`) unless noted — so one adapter covers all.

Status legend: ✅ live-verified during research · 🆓 has free tier · 🔑 needs key · 🏠 local

## 1. Keyless — works with zero configuration

### Pollinations — `https://text.pollinations.ai` ✅🆓🔑—none
- **Endpoint**: `POST https://text.pollinations.ai/openai`
- **Verified models (anonymous tier)**: `openai-fast` (gpt-oss-20b, default), `openai`/`gpt-oss-20b`/`gpt-oss` (aliases), `mistral`, `llama`
- **Native tool calls**: ✅ verified (`finish_reason: "tool_calls"`, OpenAI-shaped `tool_calls`)
- **Streaming**: ✅ verified (SSE, `delta.content` + `delta.reasoning`)
- **Notes**:
  - `gpt-oss` models emit a `reasoning` field — Luna surfaces it as dim "thinking".
  - The anonymous tier has a **per-IP rolling budget**. When it runs out, the API
    returns **HTTP 402**; it replenishes on its own. Luna reacts automatically:
    compact JSON mode → failover → friendly hint.
  - `gen.pollinations.ai/v1` (new unified gateway) now requires a key (401 anonymous).
  - The legacy `GET /{prompt}` path returns a budget error — not used.
  - `GET /models` lists models (used by `luna health`).
- Docs: https://github.com/pollinations/pollinations

### Local runtimes (auto-detected, fully private) 🏠
- **Ollama** — `http://127.0.0.1:11434/v1` (OpenAI-compat) · detection probe: `GET /api/tags`
  - `ollama serve` + `ollama pull llama3.2` → then `luna` uses it automatically
- **LM Studio** — `http://127.0.0.1:1234/v1` · detection probe: `GET /v1/models`

## 2. Keyed providers with free tiers 🆓🔑

Ordered by Luna's default preference when keys are present:

| # | Provider | baseUrl | Default model | Env var | Signup |
|---|----------|---------|---------------|---------|--------|
| 1 | **Groq** | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | `LUNA_GROQ_KEY` | console.groq.com/keys |
| 2 | **Google Gemini** (OpenAI-compat) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` | `LUNA_GEMINI_KEY` | aistudio.google.com/apikey |
| 3 | **Cerebras** | `https://api.cerebras.ai/v1` | `llama-3.3-70b` | `LUNA_CEREBRAS_KEY` | cloud.cerebras.ai |
| 4 | **OpenRouter** | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct:free` (+ other `:free` models) | `LUNA_OPENROUTER_KEY` | openrouter.ai/keys |
| 5 | **SambaNova** | `https://api.sambanova.ai/v1` | `Meta-Llama-3.3-70B-Instruct` | `LUNA_SAMBANOVA_KEY` | cloud.sambanova.ai/apis |
| 6 | **Mistral** | `https://api.mistral.ai/v1` | `mistral-small-latest` | `LUNA_MISTRAL_KEY` | console.mistral.ai |
| 7 | **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` | `LUNA_DEEPSEEK_KEY` | platform.deepseek.com |
| 8 | **Together AI** | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo-Free` | `LUNA_TOGETHER_KEY` | api.together.ai |
| 9 | **HuggingFace Router** | `https://router.huggingface.co/v1` | `meta-llama/Llama-3.1-8B-Instruct` | `LUNA_HF_KEY` | huggingface.co/settings/tokens |
| 10 | **Cohere** (compatibility API) | `https://api.cohere.com/compatibility/v1` | `command-r-plus-08-2024` | `LUNA_COHERE_KEY` | dashboard.cohere.com/api-keys |
| 11 | **AIMLAPI** | `https://api.aimlapi.com/v1` | `gpt-4o-mini` | `LUNA_AIMLAPI_KEY` | aimlapi.com |
| 12 | **Baseten** | `https://model-api.baseten.co/v1` | `deepseek-ai/DeepSeek-V3-0324` | `LUNA_BASETEN_KEY` | baseten.co |

OpenRouter free-model picks (rotate as the catalog changes):
`deepseek/deepseek-chat-v3-0324:free`, `google/gemini-2.0-flash-exp:free`,
`qwen/qwen-2.5-72b-instruct:free`, `mistralai/mistral-small-3.1-24b-instruct:free`.

## 3. Custom endpoint — anything OpenAI-compatible

```bash
LUNA_PROVIDER=custom LUNA_BASE_URL=http://localhost:8000/v1 LUNA_MODEL=qwen2.5:14b
```
Works with vLLM, llama.cpp server, Jan, localai, LiteLLM proxies, OpenAI itself, etc.

## 4. Research notes & dead ends

- **GitHub Models** (`models.inference.ai.azure.com`) — **fully retired July 30, 2026**. Excluded.
- **ai.hackclub.com** — once a popular keyless endpoint; now returns an HTML app (deprecated). Excluded.
- **Gemini native REST** (`:generateContent`) — supported indirectly via the
  OpenAI-compatible route, which the research confirmed as the simplest path.
- **HF Inference free tier** — $0.10/month credit via the router; small but real.
- General 2026 landscape: nearly all providers converged on the OpenAI-compat
  API shape, which is why Luna's single adapter covers the whole registry.

## 5. How Luna uses this registry

- `provider: auto` (default) → chain = **keyed providers you configured** →
  **pollinations (keyless)** → **local runtimes if running** → pollinations again as safety net.
- Health probe (`luna health`) = parallel `GET {baseUrl}/models` across all *configured* providers.
- Circuit breaker: 3 consecutive failures → provider skipped for 90 s.
- 429 → back-off retry; 402 → compact JSON mode (no tool schemas, slim context);
  auth failure on an explicitly-chosen provider → hard stop with the exact fix.
- Endpoints without native tool-calls: Luna auto-falls-back to her **JSON tool
  protocol** (fenced ```json blocks) so *any* text endpoint can still drive the agent.
