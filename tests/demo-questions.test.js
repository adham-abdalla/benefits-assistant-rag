// Every example button in the web demo must produce a grounded answer (except the
// deliberate out-of-scope one). Added after "Are braces covered?" was refused because
// the synonym table was keyed by the raw word ("braces") instead of its stem ("brac").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandQuery } from '../src/core/retrieval.js';
import { createAssistant } from '../src/core/assistant.js';

const booklet = readFileSync(new URL('../data/benefits-booklet.md', import.meta.url), 'utf8');
const examples = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
  .match(/const EXAMPLES = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));

test('TC-14 synonyms are found for plural and inflected words', () => {
  assert.ok(expandQuery('Are braces covered?').flat().includes('orthodontic'));
  assert.ok(expandQuery('my kids').flat().includes('child'));
});

test('TC-15 every demo example answers from the booklet, out-of-scope one is refused', async () => {
  assert.ok(examples.length >= 6);
  const assistant = createAssistant(booklet);
  for (const q of examples) {
    const r = await assistant.ask(q);
    if (/dog/i.test(q)) assert.equal(r.answerable, false, q);
    else assert.equal(r.answerable, true, q);
  }
});
