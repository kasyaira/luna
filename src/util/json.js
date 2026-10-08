// Luna — JSON helpers: safe parse, fenced-block extraction, balanced object scanning
export function safeParse(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Extract JSON objects from assistant text.
 * Recognizes fenced blocks (```json …```, ```tool …```, ``` …```) and
 * falls back to balanced-brace scanning of the whole string.
 */
export function extractJsonBlocks(text) {
  const blocks = [];
  const fenced = /```(?:json|tool|action)?\s*\n([\s\S]*?)```/gi;
  let m;
  while ((m = fenced.exec(text)) !== null) {
    const parsed = tryParseObject(m[1].trim());
    if (parsed) blocks.push(parsed);
  }
  if (blocks.length) return blocks;

  // balanced scan for {"tool": ...} style objects
  const obj = tryParseObject(text);
  if (obj) return [obj];
  return [];
}

function tryParseObject(s) {
  if (!s || !s.includes('{')) return null;
  const start = s.indexOf('{');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1);
        const parsed = safeParse(candidate);
        if (parsed.ok && typeof parsed.value === 'object' && parsed.value !== null) {
          return parsed.value;
        }
        return null;
      }
    }
  }
  return null;
}

export function truncateMiddle(text, max) {
  const s = String(text);
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.55);
  const tail = Math.floor(max * 0.35);
  return s.slice(0, head) + `\n…[truncated ${s.length - head - tail} chars]…\n` + s.slice(-tail);
}
