import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chunkMarkdown, buildIndex, stem, expandQuery } from '../src/core/retrieval.js';
import { validateAnswer, parseJson, extractiveAnswer, buildMessages, isGrounded } from '../src/core/answer.js';
import { createAssistant } from '../src/core/assistant.js';

const booklet = readFileSync(new URL('../data/benefits-booklet.md', import.meta.url), 'utf8');
const chunks = chunkMarkdown(booklet);

test('TC-01 booklet is split into one chunk per section with stable ids', () => {
  assert.equal(chunks.length, 15);
  assert.equal(chunks[0].id, 'eligibility');
  assert.ok(chunks.some(c => c.id === 'employee-and-family-assistance-program'));
  assert.ok(chunks.every(c => c.text.length > 50));
});

test('TC-02 stemmer and query expansion', () => {
  assert.equal(stem('cleanings'), 'clean');
  assert.equal(stem('claims'), stem('claim'));
  assert.deepEqual(expandQuery('new glasses').find(g => g[0] === stem('glasses')), [stem('glasses'), stem('eyeglass'), stem('vision')]);
  assert.ok(expandQuery('does it roll over').some(g => g[0] === stem('carry')));
});

test('TC-03 BM25 ranks the right section first and reports coverage', () => {
  const idx = buildIndex(chunks);
  const top = idx.search('dental cleaning reimbursement', 3);
  assert.equal(top[0].id, 'dental-care');
  assert.ok(top[0].coverage >= 0.5);
  assert.ok(top[0].score >= top[1].score);
});

test('TC-04 grounding gate rejects weak or off-topic retrieval', () => {
  assert.equal(isGrounded([]), false);
  assert.equal(isGrounded([{ score: 5, coverage: 0.2 }]), false);
  assert.equal(isGrounded([{ score: 1, coverage: 1 }]), false);
  assert.equal(isGrounded([{ score: 5, coverage: 0.6 }]), true);
});

test('TC-05 structured output validation catches bad fields and invented citations', () => {
  const sources = [{ id: 'dental-care' }];
  assert.deepEqual(validateAnswer({ answer: 'x', citations: ['dental-care'], confidence: 'high', answerable: true }, sources), []);
  const errors = validateAnswer({ answer: '', citations: ['made-up'], confidence: 'sure', answerable: 'yes' }, sources);
  assert.equal(errors.length, 4);
  assert.match(validateAnswer({ answer: 'x', citations: [], confidence: 'low', answerable: true }, sources).join(), /must cite/);
});

test('TC-06 JSON is extracted even when the model wraps it in a code fence', () => {
  assert.deepEqual(parseJson('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJson('no json here'), /No JSON/);
});

test('TC-07 prompt contains the rules, the schema, every source id and the question', () => {
  const { system, user } = buildMessages('Is orthodontics covered?', [chunks[2]]);
  assert.match(system, /ONLY the booklet sections/);
  assert.match(system, /"answerable"/);
  assert.match(user, /\[dental-care\]/);
  assert.match(user, /Is orthodontics covered\?$/);
});

test('TC-08 offline answer quotes the booklet and cites it', () => {
  const idx = buildIndex(chunks);
  const res = extractiveAnswer('How much is the dental maximum?', idx.search('How much is the dental maximum?'));
  assert.equal(res.answerable, true);
  assert.equal(res.citations[0], 'dental-care'); // most relevant section cited first
  assert.match(res.answer, /\$1,500/);
});

test('TC-09 assistant declines off-topic questions without calling the model', async () => {
  let calls = 0;
  const spy = { name: 'spy', model: 'spy', async generate() { calls++; return '{}'; } };
  const a = createAssistant(booklet, { provider: spy });
  const res = await a.ask('Does the plan cover my dog?');
  assert.equal(res.answerable, false);
  assert.equal(calls, 0);
  assert.match(a.log[0].notes[0], /Grounding gate/);
});

test('TC-10 invalid model output is retried once, then falls back safely', async () => {
  const replies = ['not json at all', '{"answer":"Crowns are 50%.","citations":["dental-care"],"confidence":"high","answerable":true}'];
  const flaky = { name: 'flaky', model: 'claude-haiku-4-5', async generate() { return replies.shift(); } };
  const a = createAssistant(booklet, { provider: flaky });
  const res = await a.ask('What percentage are dental crowns?');
  assert.equal(res.answer, 'Crowns are 50%.');
  assert.equal(a.log[0].attempts, 2);
  assert.ok(a.log[0].estCostUsd > 0);

  const broken = { name: 'broken', model: 'x', async generate() { return '{"answer":"made up","citations":["nope"],"confidence":"high","answerable":true}'; } };
  const b = createAssistant(booklet, { provider: broken });
  const res2 = await b.ask('What percentage are dental crowns?');
  assert.equal(res2.answerable, false);
  assert.match(b.log[0].notes.join(' '), /not one of the retrieved sections/);
});

test('TC-11 decision log records question, retrieval, provider, answer and timing', async () => {
  const a = createAssistant(booklet, { now: () => new Date('2026-11-21T12:00:00Z') });
  const res = await a.ask('How fast are online claims paid?');
  const entry = a.log[0];
  assert.equal(res.logId, 1);
  assert.equal(entry.time, '2026-11-21T12:00:00.000Z');
  assert.equal(entry.provider, 'offline');
  assert.equal(entry.retrieved[0].id, 'submitting-a-claim');
  assert.deepEqual(entry.answer.citations, ['submitting-a-claim']);
  assert.ok(entry.latencyMs >= 0);
});

test('TC-12 input checks: empty and too-long questions are rejected', async () => {
  const a = createAssistant(booklet);
  await assert.rejects(a.ask('   '), /empty/);
  await assert.rejects(a.ask('x'.repeat(501)), /too long/);
});

test('TC-13 provider adapters send the right request (mocked fetch)', async () => {
  const { anthropicProvider, openaiProvider } = await import('../src/core/assistant.js');
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ content: [{ text: '{"ok":1}' }], choices: [{ message: { content: '{"ok":2}' } }] }) }; };
  const out = await anthropicProvider({ apiKey: 'k', fetchImpl }).generate({ system: 's', user: 'u' });
  assert.equal(out, '{"ok":1}');
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(JSON.parse(seen.opts.body).temperature, 0);
  assert.equal(seen.opts.headers['x-api-key'], 'k');
  assert.equal(await openaiProvider({ apiKey: 'k', fetchImpl }).generate({ system: 's', user: 'u' }), '{"ok":2}');
  assert.equal(JSON.parse(seen.opts.body).response_format.type, 'json_object');
});
