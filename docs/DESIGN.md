# Design, responsible-AI decisions and evaluation

## 1. Requirements

| ID | Requirement | How it is met |
|---|---|---|
| R1 | Answers come only from the booklet | Prompt rule 1 + only retrieved sections are sent + citation validation |
| R2 | Every answer is traceable | Citations shown with source text; decision log entry per question |
| R3 | No guessing | Grounding gate before the model; `answerable: false` path; safe fallback after failed validation |
| R4 | Works without an API key | Offline extractive answerer with the same output schema |
| R5 | Keys are never exposed in production | Express server holds keys; the browser key option is for demos and kept in memory only |
| R6 | Quality is measured on every change | `npm run eval` in CI with thresholds; held-out set reported |
| R7 | Cost is visible | Token estimate and price per model in each log entry |

## 2. Decision log (AI decisions made while building)

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| D1 | BM25 keyword retrieval, implemented from scratch | Embeddings + vector database | No external service needed, explainable scores, runs in the browser; embeddings listed as the next step |
| D2 | One chunk per booklet section | Fixed-size chunks with overlap | Sections are short and self-contained, and section ids make clear citations |
| D3 | Grounding gate (score ≥ 2.0 **and** coverage ≥ 50%) | Let the model decide | First evaluation showed off-topic questions matching generic words; the gate fixed all refusals and avoids paying for a model call |
| D4 | JSON output + validation + one retry | Free-text answers | Structured output can be checked automatically; invented citations are caught |
| D5 | Temperature 0 | Default temperature | Repeatable answers make evaluation meaningful |
| D6 | Separate held-out set, never used for tuning | Report development-set score only | The development set was used to tune rules, so its 100% overstates quality |

## 3. Prompt

The system prompt (see `buildMessages` in `src/core/answer.js`) has four rules: answer only from the provided sections, quote exact numbers, cite section ids, and reply with a single JSON object matching the schema. The user message lists each section as `[id] Title` followed by its text, then the question.

## 4. Decision log entry (example)

```json
{
  "id": 1,
  "time": "2026-11-21T12:00:00.000Z",
  "question": "How fast are online claims paid?",
  "retrieved": [{ "id": "submitting-a-claim", "score": 7.1, "coverage": 1 }],
  "provider": "offline",
  "model": "extractive-v1",
  "attempts": 1,
  "notes": [],
  "answer": { "answer": "Most online claims are paid by direct deposit within 5 business days. …", "citations": ["submitting-a-claim"], "confidence": "high", "answerable": true },
  "latencyMs": 1
}
```

## 5. Evaluation method

Each question in `eval/questions.json` has the section that should answer it and the facts a correct answer must contain. Unanswerable questions are marked `"answerable": false`.

| Metric | Definition |
|---|---|
| Retrieval hit@3 | The correct section is in the top 3 retrieved |
| Citation accuracy | The answer cites the correct section |
| Fact coverage | The answer contains every required fact (e.g. "$250") |
| Correct refusals | Unanswerable questions get `answerable: false` and no citations |
| Pass rate | All of the above for each question |

**CI thresholds (development set):** hit@3 ≥ 95%, citations ≥ 90%, facts ≥ 85%, refusals = 100%.

### History

| Run | Change | Dev pass rate | Held-out pass rate |
|---|---|---|---|
| 1 | Baseline BM25, score threshold only | 61.9% | — |
| 2 | Query expansion, coverage gate, better stemmer | 95.2% | — |
| 3 | "How long" → deadline phrase | 100% | 77.8% (first run, untuned) |

**Held-out failures (kept as-is):** "psychologist" doesn't match "psychology", so the right section isn't retrieved; and the beneficiary question returns the life-insurance amount sentence instead of the "change beneficiary" sentence. Both are vocabulary or ranking limits of keyword matching.

## 6. Testing

| Suite | Count | What |
|---|---|---|
| `tests/core.test.js` | 13 | Chunking, stemmer, BM25, grounding gate, schema validation, JSON extraction, prompt content, offline answer, refusal without model call, retry and fallback, decision log, input limits, provider requests (mocked fetch) |
| `tests/api.test.js` | 4 | Health, ask, error codes (400/422/404), log ordering (runs when Express is installed) |
| Browser checks | 7 | Example question, refusal, typed question, log, in-browser evaluation, key prompt, no console errors |
