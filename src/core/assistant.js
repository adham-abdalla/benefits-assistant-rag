// The assistant pipeline: retrieve -> generate (LLM or offline) -> validate -> log.
// Every answer produces a decision-log entry so automated outputs can be traced and reviewed.
import { chunkMarkdown, buildIndex } from './retrieval.js';
import { buildMessages, parseJson, validateAnswer, extractiveAnswer, NOT_FOUND, MIN_SCORE, MIN_COVERAGE, isGrounded } from './answer.js';

// Approximate price per million tokens (USD), for cost tracking in the decision log.
const PRICES = { 'claude-haiku-4-5': [1, 5], 'gpt-4o-mini': [0.15, 0.6] };
const estimateTokens = text => Math.ceil(String(text).length / 4);

export function offlineProvider() {
  return { name: 'offline', model: 'extractive-v1', async generate(_msgs, question, sources) { return JSON.stringify(extractiveAnswer(question, sources)); } };
}

export function anthropicProvider({ apiKey, model = 'claude-haiku-4-5', fetchImpl = fetch, browser = false }) {
  return {
    name: 'anthropic', model,
    async generate({ system, user }) {
      const headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
      if (browser) headers['anthropic-dangerous-direct-browser-access'] = 'true';
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers,
        body: JSON.stringify({ model, max_tokens: 400, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
      });
      if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
      const data = await res.json();
      return data.content.map(c => c.text || '').join('');
    },
  };
}

export function openaiProvider({ apiKey, model = 'gpt-4o-mini', fetchImpl = fetch }) {
  return {
    name: 'openai', model,
    async generate({ system, user }) {
      const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (!res.ok) throw new Error(`OpenAI API error ${res.status}`);
      const data = await res.json();
      return data.choices[0].message.content;
    },
  };
}

export function createAssistant(bookletMarkdown, { provider = offlineProvider(), topK = 3, now = () => new Date() } = {}) {
  const chunks = chunkMarkdown(bookletMarkdown);
  const index = buildIndex(chunks);
  const log = [];

  async function ask(question) {
    const started = Date.now();
    const q = String(question || '').trim();
    if (!q) throw new Error('Question is empty.');
    if (q.length > 500) throw new Error('Question is too long (500 characters max).');

    const sources = index.search(q, topK);
    const entry = {
      id: log.length + 1, time: now().toISOString(), question: q,
      retrieved: sources.map(s => ({ id: s.id, score: s.score, coverage: s.coverage })),
      provider: provider.name, model: provider.model, attempts: 0, notes: [],
    };

    let result;
    if (!isGrounded(sources)) {
      result = { ...NOT_FOUND };
      entry.notes.push(`Grounding gate: best section below score ${MIN_SCORE} or coverage ${MIN_COVERAGE}. Answered "not found" without calling the model.`);
    } else {
      const msgs = buildMessages(q, sources);
      entry.inputTokens = estimateTokens(msgs.system + msgs.user);
      for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        entry.attempts = attempt;
        try {
          const text = await provider.generate(msgs, q, sources);
          entry.outputTokens = estimateTokens(text);
          const obj = parseJson(text);
          const errors = validateAnswer(obj, sources);
          if (errors.length) entry.notes.push(`Attempt ${attempt} failed validation: ${errors.join(' ')}`);
          else result = obj;
        } catch (err) {
          entry.notes.push(`Attempt ${attempt} error: ${err.message}`);
        }
      }
      if (!result) {
        result = { ...NOT_FOUND };
        entry.notes.push('Fell back to "not found" after 2 failed attempts.');
      }
      const price = PRICES[provider.model];
      if (price) entry.estCostUsd = Number((((entry.inputTokens || 0) * price[0] + (entry.outputTokens || 0) * price[1]) / 1e6).toFixed(6));
    }
    entry.answer = result;
    entry.latencyMs = Date.now() - started;
    log.push(entry);
    const cited = sources.filter(s => result.citations.includes(s.id)).map(({ id, title, text }) => ({ id, title, text }));
    return { ...result, sources: cited, logId: entry.id };
  }

  return { ask, log, chunks, search: (q, k) => index.search(q, k) };
}
