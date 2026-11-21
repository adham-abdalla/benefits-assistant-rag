// REST API (Express). Keeps the assistant behind a server so API keys never reach the browser.
import express from 'express';
import { readFileSync } from 'node:fs';
import { createAssistant, offlineProvider, anthropicProvider, openaiProvider } from '../src/core/assistant.js';

export function pickProvider(env = process.env) {
  if (env.ANTHROPIC_API_KEY) return anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.MODEL || 'claude-haiku-4-5' });
  if (env.OPENAI_API_KEY) return openaiProvider({ apiKey: env.OPENAI_API_KEY, model: env.MODEL || 'gpt-4o-mini' });
  return offlineProvider();
}

export function createApp({ provider = pickProvider(), booklet } = {}) {
  const text = booklet ?? readFileSync(new URL('../data/benefits-booklet.md', import.meta.url), 'utf8');
  const assistant = createAssistant(text, { provider });
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', provider: provider.name, model: provider.model, sections: assistant.chunks.length }));

  // POST /api/ask  { "question": "..." }  ->  { answer, citations, confidence, answerable, sources, logId }
  app.post('/api/ask', async (req, res) => {
    const question = req.body?.question;
    if (typeof question !== 'string' || !question.trim()) return res.status(400).json({ error: 'Send JSON: { "question": "..." }' });
    try {
      res.json(await assistant.ask(question));
    } catch (err) {
      res.status(422).json({ error: err.message });
    }
  });

  // GET /api/log?limit=20 -> most recent decision-log entries, newest first
  app.get('/api/log', (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    res.json(assistant.log.slice(-limit).reverse());
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}
