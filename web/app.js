// Browser demo: the same assistant core as the server, running fully client-side.
import { createAssistant, offlineProvider, anthropicProvider } from '../src/core/assistant.js';
import { evaluate } from '../eval/evaluate.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EXAMPLES = ['How much do I get for new glasses?', 'Are braces covered?', 'How long do I have to submit a claim?',
  'Is counselling free?', 'Does my health spending account roll over?', 'Does the plan cover my dog?'];

let booklet = '';
let provider = offlineProvider();
let assistant;
const fullLog = [];

async function init() {
  booklet = await (await fetch('data/benefits-booklet.md')).text();
  assistant = createAssistant(booklet, { provider });
  $('examples').innerHTML = EXAMPLES.map(q => `<button type="button">${esc(q)}</button>`).join('');
  $('provider-status').textContent = 'Current model: offline extractive answerer.';
}

async function ask(q) {
  $('answer').innerHTML = '<div class="card muted">Searching the booklet…</div>';
  try {
    const res = await assistant.ask(q);
    const entry = assistant.log[assistant.log.length - 1];
    fullLog.push(entry);
    const sources = res.sources.map(s => `<details><summary>Source: ${esc(s.title)} <code>[${esc(s.id)}]</code></summary><p>${esc(s.text)}</p></details>`).join('');
    $('answer').innerHTML = `<div class="card">
      <div><strong>Answer</strong><span class="badge ${res.confidence}">${res.answerable ? res.confidence + ' confidence' : 'not in booklet'}</span></div>
      <p>${esc(res.answer)}</p>${sources}
      <details><summary>Why this answer? (decision log #${entry.id})</summary><pre>${esc(JSON.stringify(entry, null, 2))}</pre></details></div>`;
    renderLog();
  } catch (err) {
    $('answer').innerHTML = `<div class="card fail">${esc(err.message)}</div>`;
  }
}

function renderLog() {
  $('log').innerHTML = fullLog.length ? [...fullLog].reverse().map(e => `<div class="card">
    <strong>#${e.id}</strong> ${esc(e.question)} <span class="badge">${esc(e.provider)}</span><span class="badge">${e.latencyMs} ms</span>
    <pre>${esc(JSON.stringify({ retrieved: e.retrieved, attempts: e.attempts, notes: e.notes, citations: e.answer.citations, estCostUsd: e.estCostUsd }, null, 2))}</pre></div>`).join('')
    : '<p class="muted">No questions asked yet.</p>';
}

async function runEval() {
  $('eval').innerHTML = '<p class="muted">Running…</p>';
  const load = async f => (await fetch(f)).json();
  const [dev, held] = await Promise.all([load('eval/questions.json'), load('eval/heldout.json')]);
  const sets = [['Development set', dev], ['Held-out set', held]];
  let html = '';
  for (const [name, questions] of sets) {
    const r = await evaluate(provider, { booklet, questions });
    const m = r.metrics;
    html += `<h3>${name} (${m.questions} questions)</h3><div class="metrics">
      ${[['Pass rate', m.passRate], ['Retrieval hit@3', m.retrievalHitAt3], ['Citation accuracy', m.citationAccuracy], ['Fact coverage', m.factCoverage], ['Correct refusals', m.correctRefusals]]
        .map(([k, v]) => `<div class="metric">${k}<b>${v}%</b></div>`).join('')}</div>
      <table><thead><tr><th>Question</th><th>Result</th><th>Cited</th></tr></thead><tbody>
      ${r.rows.map(x => `<tr><td>${esc(x.q)}</td><td class="${x.pass ? 'pass' : 'fail'}">${x.pass ? 'PASS' : 'FAIL'}</td><td>${esc(x.citations.join(', ') || '—')}</td></tr>`).join('')}</tbody></table>`;
  }
  $('eval').innerHTML = html;
}

document.querySelector('.tabs').addEventListener('click', e => {
  const tab = e.target.dataset.tab;
  if (!tab) return;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const id of ['ask', 'log', 'eval', 'settings']) $(`tab-${id}`).hidden = id !== tab;
});
$('ask-form').addEventListener('submit', e => { e.preventDefault(); const q = $('q').value.trim(); if (q) ask(q); });
$('examples').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') { $('q').value = e.target.textContent; ask(e.target.textContent); } });
$('run-eval').addEventListener('click', runEval);
$('use-key').addEventListener('click', () => {
  const key = $('key').value.trim();
  if (!key) { $('provider-status').textContent = 'Paste a key first.'; return; }
  provider = anthropicProvider({ apiKey: key, browser: true });
  assistant = createAssistant(booklet, { provider });
  $('provider-status').textContent = `Current model: Anthropic ${provider.model}. Answers are validated; invalid output falls back to "not found".`;
});
$('use-offline').addEventListener('click', () => {
  provider = offlineProvider(); $('key').value = '';
  assistant = createAssistant(booklet, { provider });
  $('provider-status').textContent = 'Current model: offline extractive answerer.';
});

init();
