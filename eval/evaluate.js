// Scoring logic shared by the command-line runner (eval/run.js) and the browser demo.
import { createAssistant } from '../src/core/assistant.js';

export async function evaluate(provider, { booklet, questions }) {
  const assistant = createAssistant(booklet, { provider });
  const rows = [];
  for (const item of questions) {
    const res = await assistant.ask(item.q);
    const hits = assistant.search(item.q, 3).map(s => s.id);
    const expectAnswer = item.answerable !== false;
    const row = { q: item.q, expectAnswer, answerable: res.answerable, citations: res.citations };
    if (expectAnswer) {
      row.retrievalHit = hits.includes(item.section);
      row.citationCorrect = res.citations.includes(item.section);
      row.factsPresent = item.mustInclude.every(f => res.answer.toLowerCase().includes(f.toLowerCase()));
      row.pass = row.retrievalHit && row.citationCorrect && row.factsPresent && res.answerable;
    } else {
      row.pass = res.answerable === false && res.citations.length === 0;
    }
    rows.push(row);
  }
  const answerable = rows.filter(r => r.expectAnswer);
  const pct = (n, d) => Math.round((n / Math.max(1, d)) * 1000) / 10;
  const metrics = {
    questions: rows.length,
    retrievalHitAt3: pct(answerable.filter(r => r.retrievalHit).length, answerable.length),
    citationAccuracy: pct(answerable.filter(r => r.citationCorrect).length, answerable.length),
    factCoverage: pct(answerable.filter(r => r.factsPresent).length, answerable.length),
    correctRefusals: pct(rows.filter(r => !r.expectAnswer && r.pass).length, rows.filter(r => !r.expectAnswer).length),
    passRate: pct(rows.filter(r => r.pass).length, rows.length),
  };
  return { metrics, rows, log: assistant.log };
}
