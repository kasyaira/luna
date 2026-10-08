// Luna — approximate token accounting (chars/4 heuristic, no tokenizer dep)
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const m of messages) {
    total += 8; // role overhead
    if (typeof m.content === 'string') total += estimateTokens(m.content);
    else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        total += estimateTokens(part?.text || part?.content || '');
      }
    }
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        total += estimateTokens(tc.function?.name || '') + estimateTokens(tc.function?.arguments || '');
      }
    }
    if (m.tool_call_id) total += 6;
  }
  return total;
}

/** Trim oldest messages (keep system + first user) to fit a token budget. */
export function fitHistory(messages, budgetTokens) {
  let total = estimateMessagesTokens(messages);
  if (total <= budgetTokens) return { messages, dropped: 0 };
  const sys = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  let dropped = 0;
  while (rest.length > 2 && total > budgetTokens) {
    const m = rest.shift();
    total -= estimateMessagesTokens([m]);
    dropped++;
  }
  return { messages: [...sys, ...rest], dropped };
}
