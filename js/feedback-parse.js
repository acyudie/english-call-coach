// Shape and sanity-check the coach feedback returned by the text model.

const SCORE_KEYS = ['fluency', 'clarity', 'listening', 'task'];

export const FEEDBACK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    scores: {
      type: 'OBJECT',
      properties: {
        fluency: { type: 'INTEGER', description: '0-10, speaking without long stops' },
        clarity: { type: 'INTEGER', description: '0-10, meaning gets across' },
        listening: { type: 'INTEGER', description: '0-10, understood and answered the other person' },
        task: { type: 'INTEGER', description: "0-10, achieved today's goal" },
      },
      required: SCORE_KEYS,
    },
    summary_ko: { type: 'STRING' },
    corrections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          you_said: { type: 'STRING' },
          better: { type: 'STRING' },
          why_ko: { type: 'STRING' },
        },
        required: ['you_said', 'better', 'why_ko'],
      },
    },
    phrases: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { en: { type: 'STRING' }, ko: { type: 'STRING' } },
        required: ['en', 'ko'],
      },
    },
    next_focus_ko: { type: 'STRING' },
  },
  required: ['scores', 'summary_ko', 'corrections', 'phrases', 'next_focus_ko'],
};

const str = v => (typeof v === 'string' ? v.trim() : '');
const clamp = v => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(10, Math.max(0, n));
};

export function normalizeFeedback(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const sc = o.scores && typeof o.scores === 'object' ? o.scores : {};
  const scores = {};
  for (const k of SCORE_KEYS) scores[k] = clamp(sc[k]);
  const avg = SCORE_KEYS.reduce((a, k) => a + scores[k], 0) / SCORE_KEYS.length;
  const corrections = Array.isArray(o.corrections)
    ? o.corrections
        .filter(c => c && typeof c === 'object')
        .map(c => ({ you_said: str(c.you_said), better: str(c.better), why_ko: str(c.why_ko) }))
        .filter(c => c.better)
        .slice(0, 3)
    : [];
  const phrases = Array.isArray(o.phrases)
    ? o.phrases
        .filter(p => p && typeof p === 'object' && str(p.en))
        .map(p => ({ en: str(p.en), ko: str(p.ko) }))
        .slice(0, 5)
    : [];
  return {
    scores,
    average: Math.round(avg * 10) / 10,
    summary_ko: str(o.summary_ko),
    corrections,
    phrases,
    next_focus_ko: str(o.next_focus_ko),
  };
}
