// Luna — memory tools: the agent's hands for her own brain.
import { memoryBanks } from '../memory/index.js';
import { formatRecalls } from '../memory/retrieve.js';

export function makeMemoryTools(memory) {
  return [
    {
      name: 'memory.save',
      description: `Save a memory to one of Luna's parallel banks. Banks: working (session scratch), episodic (events/dialogs), semantic (durable facts & user profile), procedural (how-to & error→fix), reflection (notes to self).`,
      parameters: {
        type: 'object',
        properties: {
          bank: { type: 'string', enum: memoryBanks() },
          content: { type: 'string', description: 'The memory to store (self-contained, future-you must understand it without context)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags for later recall' },
          importance: { type: 'number', description: '0..1 — higher is recalled more eagerly' },
        },
        required: ['bank', 'content'],
      },
      execute: async ({ bank, content, tags = [], importance }) =>
        memory.save(bank, content, { tags, importance }),
    },
    {
      name: 'memory.recall',
      description: 'Search Luna memory banks (TF-IDF + recency + importance ranking). Use before answering questions about the past, the user, or previous fixes.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          banks: { type: 'array', items: { type: 'string' }, description: 'Limit to these banks (default: all, in parallel)' },
          k: { type: 'number', description: 'Top-K results (default 6)' },
        },
        required: ['query'],
      },
      execute: async ({ query, banks, k }) => {
        const hits = await memory.recall(query, { banks, k });
        return { text: formatRecalls(hits), count: hits.length };
      },
    },
    {
      name: 'memory.forget',
      description: 'Delete memories by ID or by content query.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, query: { type: 'string' } },
        required: [],
      },
      execute: async ({ id, query }) => memory.forget(id || query),
    },
    {
      name: 'memory.stats',
      description: 'Memory bank statistics (record counts per bank).',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => memory.stats(),
    },
    {
      name: 'memory.consolidate',
      description: 'Distill episodic memories into durable semantic facts now (smart memory compaction).',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const r = await memory.consolidate({ force: true });
        return r ?? { distilled: 0, facts: [] };
      },
    },
  ];
}
