// Calls a Gemini text model to turn the transcript into Korean coaching feedback.
// Free-tier models are sometimes overloaded (503) or slow, so we race a strong model
// against a light one and fall back through a list, each with a timeout.
import { FEEDBACK_SCHEMA, normalizeFeedback } from './feedback-parse.js?v=202611042324';
import { buildFeedbackPrompt } from './prompt.js?v=202611042324';

const PRIMARY = 'gemini-3.8-flash';
const QUICK = 'gemini-3.5-flash-lite';
const FALLBACKS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
const wait = ms => new Promise(r => setTimeout(r, ms));

async function callModel(apiKey, model, prompt, timeoutMs, outer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuter = () => ctrl.abort();
  outer?.addEventListener('abort', onOuter);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: FEEDBACK_SCHEMA, temperature: 0.4 },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${model}: ${j.error?.status || r.status}`);
    const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    const fb = normalizeFeedback(JSON.parse(text));
    if (!fb.summary_ko && !fb.corrections.length && !fb.phrases.length) throw new Error(`${model}: empty`);
    return { model, ...fb };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${model}: timeout`);
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

export async function makeFeedback(apiKey, scenario, transcript) {
  const prompt = buildFeedbackPrompt(scenario, transcript);
  const race = new AbortController();
  const errors = [];
  try {
    const result = await Promise.any([
      callModel(apiKey, PRIMARY, prompt, 15000, race.signal),
      wait(3500).then(() => (race.signal.aborted ? Promise.reject(new Error('skipped')) : callModel(apiKey, QUICK, prompt, 20000, race.signal))),
    ]);
    race.abort();
    return result;
  } catch (agg) {
    for (const e of agg.errors || [agg]) errors.push(e.message);
  }
  for (const model of FALLBACKS) {
    try {
      return await callModel(apiKey, model, prompt, 15000);
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error(`구글 서버가 붐벼요 (${errors.slice(-2).join(', ')})`);
}

export async function checkKey(apiKey) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`);
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  const names = (j.models || []).map(m => m.name.replace('models/', ''));
  return { ok: true, live: names.filter(n => /live/.test(n)) };
}
