// Prompting, structured output validation and the offline (no-LLM) answerer.
import { expandQuery } from './retrieval.js';

// Grounding gate: the best section must score at least MIN_SCORE and contain at least
// MIN_COVERAGE of the question's terms. Otherwise the assistant says "not found" instead of guessing.
export const MIN_SCORE = 2.0;
export const MIN_COVERAGE = 0.5;
export const isGrounded = sources => sources.length > 0 && sources[0].score >= MIN_SCORE && sources[0].coverage >= MIN_COVERAGE;

export const ANSWER_SCHEMA = {
  answer: 'string: plain-language answer, at most 3 sentences',
  citations: 'array of section ids used, e.g. ["dental-care"]',
  confidence: '"high" | "medium" | "low"',
  answerable: 'boolean: false if the booklet does not contain the answer',
};

export function buildMessages(question, sources) {
  const context = sources.map(s => `[${s.id}] ${s.title}\n${s.text}`).join('\n\n');
  const system = [
    'You answer employee questions about their group benefits using ONLY the booklet sections provided.',
    'Rules:',
    '1. If the sections do not contain the answer, set answerable to false and say you could not find it. Never guess amounts.',
    '2. Quote exact numbers (percentages, dollar maximums, time limits) from the sections.',
    '3. Cite every section you used by its id in "citations".',
    '4. Reply with a single JSON object and nothing else, matching this schema:',
    JSON.stringify(ANSWER_SCHEMA, null, 2),
  ].join('\n');
  return { system, user: `Booklet sections:\n\n${context}\n\nQuestion: ${question}` };
}

// Extracts the first JSON object from model text (models sometimes wrap it in ```json fences).
export function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model output.');
  return JSON.parse(text.slice(start, end + 1));
}

// Checks the structured output and that every citation refers to a retrieved section.
export function validateAnswer(obj, sources) {
  const errors = [];
  if (typeof obj !== 'object' || obj === null) return ['Output is not an object.'];
  if (typeof obj.answer !== 'string' || !obj.answer.trim()) errors.push('"answer" must be a non-empty string.');
  if (!Array.isArray(obj.citations)) errors.push('"citations" must be an array.');
  if (!['high', 'medium', 'low'].includes(obj.confidence)) errors.push('"confidence" must be high, medium or low.');
  if (typeof obj.answerable !== 'boolean') errors.push('"answerable" must be true or false.');
  const ids = new Set(sources.map(s => s.id));
  for (const c of obj.citations || []) if (!ids.has(c)) errors.push(`Citation "${c}" is not one of the retrieved sections.`);
  if (obj.answerable === true && Array.isArray(obj.citations) && obj.citations.length === 0) errors.push('An answerable reply must cite at least one section.');
  return errors;
}

export const NOT_FOUND = {
  answer: "I couldn't find this in the benefits booklet. Please contact HR or the insurer to confirm.",
  citations: [],
  confidence: 'low',
  answerable: false,
};

// Offline answerer: picks the sentences from the top sections that best match the question.
// Deterministic and free, used for the demo, the tests and when no API key is set.
export function extractiveAnswer(question, sources) {
  if (!isGrounded(sources)) return { ...NOT_FOUND };
  const groups = expandQuery(question);
  const candidates = [];
  sources.slice(0, 2).forEach((s, rank) => {
    s.text.split(/(?<=\.)\s+/).forEach((sentence, i) => {
      const words = new Set(expandQuery(sentence).map(g => g[0]));
      const overlap = groups.filter(g => g.some(t => words.has(t))).length;
      const hasNumber = /\d/.test(sentence) ? 0.5 : 0;
      if (overlap) candidates.push({ sentence, id: s.id, score: overlap + hasNumber - rank * 0.75 - i * 0.05 });
    });
  });
  if (!candidates.length) return { ...NOT_FOUND };
  candidates.sort((a, b) => b.score - a.score);
  const picked = candidates.slice(0, 2);
  const citations = [...new Set(picked.map(p => p.id))];
  const top = sources[0].score;
  return {
    answer: picked.map(p => p.sentence).join(' '),
    citations,
    confidence: top >= 6 ? 'high' : top >= 3.5 ? 'medium' : 'low',
    answerable: true,
  };
}
