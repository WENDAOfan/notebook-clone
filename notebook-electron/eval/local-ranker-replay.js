// No model calls. Reuses frozen production candidates; never substitutes new embeddings.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadSuite, rankEvidence } = require('./production-cases');
const { DEFAULT_POLICY, selectWithinBudget } = require('../retrieval-service');
const { rankCandidates } = require('../retrieval-ranking');
const { restoreSentenceContext } = require('../retrieval-context');
const { rankLocalEvidence } = require('./local-ranker');
const { metrics } = require('./retrieval-compare');

const sources = [
  ['dense-near', 'retrieval-dense-near-all-semantic-regression-v1'],
  ['retrieval-holdout', 'retrieval-retrieval-holdout-holdout-semantic-regression-v1'],
  ['retrieval-confirm', 'retrieval-retrieval-confirm-holdout-semantic-regression-v1'],
  ['long', 'retrieval-long-all-semantic-regression-v1'],
  ['long-ranking', 'retrieval-long-ranking-holdout-semantic-final-v1'],
  ['boundary-holdout', 'retrieval-boundary-holdout-holdout-semantic-trial-v1'],
  ['semantic-confirm', 'retrieval-semantic-confirm-holdout-semantic-frozen-v1']
];
function replaySuite(name, original) {
  const suite = loadSuite(name);
  if (suite.sha256 !== original.suiteSha256) throw new Error('Suite hash mismatch');
  const ids = new Map(original.indexedDocuments.map(d => [d.fixtureId, d.documentId]));
  const docs = suite.data.documents.map(doc => ({ ...doc, fixtureId: doc.id, id: ids.get(doc.id), content: doc.text }));
  const cases = original.cases.map(row => {
    const previous = row.control;
    if (!previous) throw new Error('This replay requires a saved unreranked control');
    const diag = previous.diagnostics;
    const fused = diag.candidates.map(c => ({ id: c.chunkId, text: c.text, vectorScore: c.vector,
      keywordScore: c.bm25, keywordMatches: c.keywordMatches, rrfScore: c.rrf,
      metadata: { documentId: c.documentId, documentTitle: docs.find(d => d.id === c.documentId).title } }));
    const eligible = fused.filter(c => c.vectorScore >= DEFAULT_POLICY.similarityThreshold
      || c.keywordScore >= DEFAULT_POLICY.keywordThreshold
      || c.keywordScore > 0 && c.keywordMatches >= DEFAULT_POLICY.minimumKeywordMatches);
    const { ranked } = rankCandidates(eligible, diag.retrievalQuery, docs, DEFAULT_POLICY);
    const contextual = ranked.map(c => restoreSentenceContext(c, docs.find(d => d.id === c.metadata.documentId)));
    const pick = list => selectWithinBudget(list, { tokenBudget: diag.tokenBudget, maxPerDocument: 3, maxChunks: 8 });
    const baseline = pick(contextual);
    if (JSON.stringify(baseline.map(c => c.id)) !== JSON.stringify(previous.sources.map(c => c.chunkId))) {
      throw new Error(`Control replay drift: ${name}/${row.id}`);
    }
    const candidates = rankLocalEvidence(contextual, diag.retrievalQuery);
    const selected = pick(candidates).map(c => ({ ...c, documentId: c.metadata.documentId }));
    const question = suite.data.questions.find(q => q.id === row.id);
    return { id: row.id, kind: row.kind, query: row.query, baseline: previous,
      candidate: { sources: selected, evidenceRanks: rankEvidence(selected, question.evidenceTargets, ids) },
      ranking: candidates.map(c => ({ id: c.id, score: c.localEvidenceScore, window: c.localEvidenceWindow })) };
  });
  return { name, suiteSha256: suite.sha256, cases,
    summary: { baseline: metrics(cases, 'baseline'), candidate: metrics(cases, 'candidate'),
      noAnswerBaseline: metrics(cases, 'baseline', 'no_answer'), noAnswerCandidate: metrics(cases, 'candidate', 'no_answer') } };
}
if (require.main === module) {
  const label = process.argv[2];
  if (!/^[a-z0-9-]{1,32}$/.test(label || '')) throw new Error('A fresh label is required');
  const output = path.join(__dirname, `local-ranker-${label}-report.json`);
  if (fs.existsSync(output)) throw new Error('Refusing to overwrite prior report');
  const suites = sources.map(([name, file]) => {
    const bytes = fs.readFileSync(path.join(__dirname, `${file}-report.json`));
    const result = replaySuite(name, JSON.parse(bytes));
    result.sourceSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    console.log(name, JSON.stringify(result.summary));
    return result;
  });
  fs.writeFileSync(output, JSON.stringify({ mode: 'OFFLINE_SAVED_CANDIDATES', suites }, null, 2));
}
module.exports = { replaySuite };
