// Luna — think tool: a scratchpad that nudges the model into explicit
// step-by-step reasoning before acting (classic agent technique).
export const thinkTools = [
  {
    name: 'think',
    description: 'Use this to think: plan multi-step work, weigh options, reflect before/after tool calls. Writing a plan here improves your accuracy. Free — no side effects.',
    parameters: {
      type: 'object',
      properties: {
        thought: { type: 'string', description: 'Your reasoning: goals, hypotheses, plan, next step' },
      },
      required: ['thought'],
    },
    async execute({ thought }) {
      return { ok: true, note: 'thought recorded', length: String(thought || '').length };
    },
  },
];
