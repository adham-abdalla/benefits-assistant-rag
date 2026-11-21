// REST API tests. They need Express (installed by `npm install`); skipped if it is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let createApp = null;
try { ({ createApp } = await import('../server/app.js')); } catch { /* express not installed */ }
const opts = { skip: createApp ? false : 'express is not installed (run npm install)' };

async function withServer(fn) {
  const server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

test('API-01 GET /api/health reports provider and sections', opts, () => withServer(async base => {
  const body = await (await fetch(`${base}/api/health`)).json();
  assert.deepEqual(body, { status: 'ok', provider: 'offline', model: 'extractive-v1', sections: 15 });
}));

test('API-02 POST /api/ask returns a cited structured answer', opts, () => withServer(async base => {
  const res = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Is orthodontics covered?' }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.citations, ['dental-care']);
  assert.equal(body.sources[0].id, 'dental-care');
}));

test('API-03 bad requests get 400 / 422 / 404', opts, () => withServer(async base => {
  const post = body => fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ question: 'x'.repeat(600) })).status, 422);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
}));

test('API-04 GET /api/log returns newest entries first', opts, () => withServer(async base => {
  for (const q of ['Is counselling free?', 'How much life insurance do I get?']) {
    await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q }) });
  }
  const log = await (await fetch(`${base}/api/log?limit=1`)).json();
  assert.equal(log.length, 1);
  assert.equal(log[0].question, 'How much life insurance do I get?');
}));
