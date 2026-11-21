// Retrieval for RAG: split the booklet into sections, then rank them with BM25.
// Pure JavaScript, no dependencies, so it runs in Node and in the browser.

const STOPWORDS = new Set(('a an and are as at be by can do does for from has have how i if in is it its ' +
  'my of on or our the their there this to was what when where which who will with you your me am ' +
  'get got much many any per after before than then also not no yes cover covered coverage plan ' +
  'benefit benefits company new long often').split(' '));

// Query expansion: everyday words people type -> the wording used in the booklet.
const PHRASES = [[/how long|how soon|time limit/g, 'within deadline'], [/roll(ed|s)?\s*over/g, 'carry forward'], [/top[\s-]*up/g, 'topup'], [/sign up|join/g, 'eligible']];
const SYNONYMS = {
  glass: ['eyeglass', 'vision'], contact: ['vision'], braces: ['orthodontic'], brace: ['orthodontic'],
  kid: ['child'], kids: ['child'], son: ['child'], daughter: ['child'], university: ['student'], college: ['student'],
  pay: ['reimburs'], paid: ['reimburs'], counsel: ['efap', 'counsell'], counselling: ['efap', 'counsell'], therapy: ['therap'],
  trip: ['travel'], vacation: ['travel'], abroad: ['travel'], pill: ['drug'], medication: ['drug', 'prescription'],
  dentist: ['dental'], teeth: ['dental'], eye: ['vision'], deadline: ['deadline', 'within'], refund: ['reimburs'],
};
// Keys are stemmed once so "braces" (stem "brac") still finds its synonyms.
const SYNONYMS_BY_STEM = Object.fromEntries(Object.entries(SYNONYMS).map(([k, v]) => [stem(k), v]));
export function expandQuery(text) {
  let t = String(text).toLowerCase();
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  const base = [...new Set(tokenize(t))];
  return base.map(term => [term, ...(SYNONYMS_BY_STEM[term] || []).map(stem)]);
}

// Small suffix-stripping stemmer: "cleanings" -> "clean", "glasses" -> "glass", "reimbursed" -> "reimburs".
export function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  return String(text).toLowerCase()
    .replace(/[^a-z0-9$%\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(t => t && !STOPWORDS.has(t))
    .map(stem);
}

// Each "## Heading" section becomes one chunk with a stable id (its slug).
export function chunkMarkdown(md) {
  const chunks = [];
  let current = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^##\s+(.+)/);
    if (h) {
      current = { id: h[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title: h[1].trim(), text: '' };
      chunks.push(current);
    } else if (current && line.trim()) {
      current.text += (current.text ? ' ' : '') + line.trim();
    }
  }
  return chunks;
}

// BM25 index (k1 = 1.5, b = 0.75). Titles are counted twice because headings are strong signals.
export function buildIndex(chunks, { k1 = 1.5, b = 0.75 } = {}) {
  const docs = chunks.map(c => {
    const tokens = [...tokenize(c.title), ...tokenize(c.title), ...tokenize(c.text)];
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    return { chunk: c, tf, len: tokens.length };
  });
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  const idf = t => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));

  return {
    size: N,
    // Returns the top k sections with a BM25 score and "coverage": the share of the
    // question's terms (or their synonyms) found in the section.
    search(query, k = 3) {
      const groups = expandQuery(query);
      return docs.map(d => {
        let score = 0, matched = 0;
        for (const group of groups) {
          let best = 0;
          for (const t of new Set(group)) {
            const f = d.tf.get(t);
            if (f) best = Math.max(best, idf(t) * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avgLen)));
          }
          if (best) { score += best; matched++; }
        }
        return { ...d.chunk, score: Math.round(score * 1000) / 1000, coverage: groups.length ? Math.round((matched / groups.length) * 100) / 100 : 0 };
      }).filter(r => r.score > 0).sort((a, b2) => b2.score - a.score).slice(0, k);
    },
  };
}
