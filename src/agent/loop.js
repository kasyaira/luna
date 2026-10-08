// Luna — agent loop: send → parse tool calls (native OR JSON protocol)
// → execute (parallel) → feed results → repeat until final answer.
// Resilient: budget-limited keyless tiers trigger compact JSON mode; tool-less
// endpoints fall back to the JSON tool protocol automatically.
import { chat, forceJsonFor, isBudgetError } from '../providers/router.js';
import { extractJsonBlocks } from '../util/json.js';
import { log } from '../util/log.js';
import { errMessage } from '../util/async.js';

export class AgentLoop {
  constructor({ cfg, toolRegistry, ui }) {
    this.cfg = cfg;
    this.registry = toolRegistry;
    this.ui = ui; // optional: {onReasoning, onContent, onToolStart, onToolEnd, onNotice}
  }

  /**
   * Run one full turn. history is mutated ONLY by the caller (agent),
   * we return the final answer + telemetry.
   */
  async run({ messages, maxIterations, jsonProtocol, compactSystem }) {
    const limit = maxIterations || this.cfg.maxIterations || 24;
    let iter = 0;
    let compact = false;
    let nudged = 0;
    const toolsUsed = [];
    const transcript = [];

    while (iter < limit) {
      iter++;
      let completion;
      try {
        completion = await chat(this.cfg, {
          messages,
          tools: jsonProtocol ? undefined : this.registry.openAiSchemas(),
          stream: !!this.ui?.stream,
          onDelta: (d) => {
            if (d.reasoning) this.ui?.onReasoning?.(d.reasoning);
            if (d.content) this.ui?.onContent?.(d.content);
          },
        });
      } catch (err) {
        const msg = errMessage(err);
        // 1. keyless/anonymous budget too tight → compact JSON mode, same turn
        if (!compact && compactSystem && isBudgetError(err)) {
          compact = true;
          jsonProtocol = true;
          this.ui?.onNotice?.('upstream budget tight → compact JSON mode (slim context, no tool schemas)');
          messages[0] = { role: 'system', content: compactSystem };
          // keep only recent exchanges to fit tiny budgets
          while (messages.length > 8) messages.splice(1, 1);
          // convert native tool-call messages into JSON-protocol-friendly text
          for (let i = 1; i < messages.length; i++) {
            const m = messages[i];
            if (m.role === 'tool') {
              messages[i] = {
                role: 'user',
                content: `TOOL_RESULT for the previous call:\n${String(m.content).slice(0, 800)}\nContinue: next tool call as fenced json, or final answer in plain prose.`,
              };
            } else if (m.role === 'assistant' && m.tool_calls) {
              const names = m.tool_calls.map((tc) => tc.function?.name).join(', ');
              messages[i] = { role: 'assistant', content: `(called tools: ${names})` };
            }
          }
          iter--; // this turn is a retry, not a consumed iteration
          continue;
        }
        // 2. tool-unsupported upstream → JSON protocol
        if (!jsonProtocol && /tool|function/i.test(msg)) {
          if (completion?.providerId) forceJsonFor(completion.providerId);
          this.ui?.onNotice?.(`tool-calling unsupported upstream → switching to JSON protocol`);
          return this.run({ messages, maxIterations: limit, jsonProtocol: true, compactSystem });
        }
        // 3. context too long for ANY provider → hard trim once, then give up
        if (!compact && /context|too long|maximum.*tokens|payload/i.test(msg)) {
          while (messages.length > 6) messages.splice(1, 2);
          iter--;
          continue;
        }
        throw err;
      }

      // ---- parse tool calls
      let calls = [];
      if (completion.toolCalls?.length && !jsonProtocol) {
        calls = completion.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));
        messages.push({
          role: 'assistant',
          content: completion.content || null,
          reasoning: undefined,
          tool_calls: completion.toolCalls,
        });
      } else if (jsonProtocol) {
        const blocks = extractJsonBlocks(completion.content || '');
        const toolBlocks = blocks.filter((b) => typeof b.tool === 'string');
        if (toolBlocks.length) {
          const b = toolBlocks[toolBlocks.length - 1];
          calls = [{ id: 'json_0', name: b.tool, arguments: b.args ? JSON.stringify(b.args) : (b.arguments ? JSON.stringify(b.arguments) : '{}') }];
          messages.push({ role: 'assistant', content: completion.content });
        }
      }

      // ---- no calls → final answer
      if (!calls.length) {
        const text = (completion.content || '').trim();
        if (!text) {
          // reasoning-only / empty response → nudge once for a real answer,
          // then fall back to exposing the reasoning tail
          if (nudged < 2) {
            nudged++;
            messages.push({ role: 'assistant', content: '(…)' });
            messages.push({ role: 'user', content: 'Continue: give your final answer now in plain prose (no tool call).' });
            iter--;
            continue;
          }
          return {
            answer: completion.reasoning?.trim().slice(-900) || '(empty response)',
            reasoning: completion.reasoning,
            toolsUsed, iterations: iter, provider: completion.provider,
            model: completion.model, usage: completion.usage, empty: true,
          };
        }
        if (!jsonProtocol) {
          messages.push({ role: 'assistant', content: completion.content });
        }
        return {
          answer: completion.content,
          reasoning: completion.reasoning,
          toolsUsed,
          iterations: iter,
          provider: completion.provider,
          model: completion.model,
          usage: completion.usage,
        };
      }

      // ---- execute calls (parallel when multiple)
      this.ui?.onNotice?.(callLabel(calls));
      const results = await Promise.all(calls.map((c) => this.registry.execute(c)));
      toolsUsed.push(...calls.map((c) => c.name));

      for (let i = 0; i < calls.length; i++) {
        const c = calls[i];
        const r = results[i];
        this.ui?.onToolEnd?.(c.name, r);
        log.debug('loop', `tool ${c.name} → ${JSON.stringify(r).slice(0, 120)}`);
        const resultLimit = compact ? 900 : 12_000;
        if (jsonProtocol) {
          transcript.push({
            role: 'user',
            content: `TOOL_RESULT for ${c.name}:\n${JSON.stringify(r).slice(0, resultLimit)}\nContinue. Call the next tool with a fenced json block, or give the final answer in plain prose.`,
          });
        } else {
          transcript.push({
            role: 'tool',
            tool_call_id: c.id,
            content: JSON.stringify(r).slice(0, resultLimit),
          });
        }
      }

      messages.push(...transcript.splice(0));

      // spinner notice
      this.ui?.onTurnEnd?.(iter);
    }

    return {
      answer: `Reached the tool-iteration limit (${limit}) — stopping for safety. Partial work is preserved; ask me to continue.`,
      toolsUsed,
      iterations: iter,
      truncated: true,
    };
  }
}

function callLabel(calls) {
  if (calls.length === 1) return calls[0].name;
  return `${calls.length} parallel: ${calls.map((c) => c.name).join(' + ')}`;
}
