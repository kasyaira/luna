// Luna — web tools: fetch pages (HTML→text) and search (DuckDuckGo lite, keyless).
import { DEFAULTS } from '../constants.js';
import { truncateMiddle } from '../util/json.js';
import { log } from '../util/log.js';

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function httpGet(url, { timeoutMs = 25_000, maxBytes = 512 * 1024, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) LunaAgent/1.0',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        ...headers,
      },
    });
    if (!res.ok) return { error: `HTTP ${res.status} ${res.statusText || ''}`.trim(), status: res.status };
    const type = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    const sliced = buf.subarray(0, maxBytes).toString('utf8');
    return { ok: true, type, text: sliced, url: res.url };
  } catch (err) {
    return { error: err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message };
  } finally { clearTimeout(timer); }
}

export const webTools = [
  {
    name: 'web.fetch',
    description: 'Fetch a URL and return readable text (HTML stripped) or raw JSON. Good for docs, APIs, raw.githubusercontent.com files.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        raw: { type: 'boolean', description: 'Return raw body without HTML stripping' },
        maxChars: { type: 'number' },
      },
      required: ['url'],
    },
    execute: async ({ url, raw, maxChars }) => {
      if (!/^https?:\/\//i.test(url || '')) return { error: 'url must start with http(s)://' };
      const res = await httpGet(url);
      if (res.error) return res;
      const isJson = /json/i.test(res.type);
      let text = raw || isJson ? res.text : htmlToText(res.text);
      const title = !raw && !isJson ? (res.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim() : undefined;
      return {
        url: res.url,
        title,
        type: res.type,
        content: truncateMiddle(text, maxChars || DEFAULTS.maxWebRead),
      };
    },
  },
  {
    name: 'web.search',
    description: 'Search the web (keyless DuckDuckGo backend). Returns top results: title, url, snippet.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        n: { type: 'number', description: 'Number of results (max 10)' },
      },
      required: ['query'],
    },
    execute: async ({ query, n = 6 }) => {
      const results = await ddgSearch(query, Math.min(10, Math.max(1, n)));
      if (!results.length) {
        return { query, results: [], note: 'search backend unreachable — try web.fetch on a specific URL instead' };
      }
      return { query, results };
    },
  },
];

async function ddgSearch(query, n) {
  // html.duckduckgo.com/html is the keyless form endpoint
  const res = await httpGet('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
    timeoutMs: 15_000,
    maxBytes: 400 * 1024,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (res.error) return [];
  const html = res.text;
  const out = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null && out.length < n) {
    let href = m[1];
    const uddg = href.match(/uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    const title = htmlToText(m[2]);
    if (!title || !/^https?:/.test(href)) continue;
    // snippet follows in result__snippet
    const tail = html.slice(m.index, m.index + 2500);
    const sn = tail.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = sn ? htmlToText(sn[1]).slice(0, 240) : '';
    out.push({ title: title.slice(0, 120), url: href, snippet });
  }
  log.info('web', `search "${query}" → ${out.length} results`);
  return out;
}
