// Evaluation harness: measures retrieval and answer quality on a fixed question set.
// Run: npm run eval   (uses the offline answerer unless ANTHROPIC_API_KEY or OPENAI_API_KEY is set)
import { readFileSync, writeFileSync } from 'node:fs';
import { offlineProvider, anthropicProvider, openaiProvider } from '../src/core/assistant.js';
import { evaluate } from './evaluate.js';

const THRESHOLDS = { retrievalHitAt3: 95, citationAccuracy: 90, factCoverage: 85, correctRefusals: 100 };

if (import.meta.url === `file://${process.argv[1]}`) {
  const booklet = readFileSync(new URL('../data/benefits-booklet.md', import.meta.url), 'utf8');
  const load = f => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
  const provider = process.env.ANTHROPIC_API_KEY ? anthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
    : process.env.OPENAI_API_KEY ? openaiProvider({ apiKey: process.env.OPENAI_API_KEY }) : offlineProvider();
  console.log(`Provider: ${provider.name} (${provider.model})`);
  const dev = await evaluate(provider, { booklet, questions: load('./questions.json') });
  console.table(dev.rows.map(r => ({ question: r.q.slice(0, 55), pass: r.pass ? 'PASS' : 'FAIL', cited: r.citations.join(',') })));
  console.log('Development set:', dev.metrics);
  // The held-out set was written after tuning and is never used to tune rules. It is reported, not gated.
  const heldout = await evaluate(provider, { booklet, questions: load('./heldout.json') });
  console.log('Held-out set:', heldout.metrics);
  writeFileSync(new URL('./results.json', import.meta.url),
    JSON.stringify({ provider: provider.name, model: provider.model, development: dev.metrics, heldout: heldout.metrics }, null, 2) + '\n');
  const failed = Object.entries(THRESHOLDS).filter(([k, min]) => dev.metrics[k] < min);
  if (failed.length) { console.error('Below threshold:', failed); process.exit(1); }
  console.log('All quality thresholds met on the development set.');
}
