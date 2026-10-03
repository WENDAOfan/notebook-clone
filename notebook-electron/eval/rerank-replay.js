// Online ordering experiment over saved production candidates; no reindexing.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadSuite, rankEvidence } = require('./production-cases');
const retrieval = require('../retrieval-service');
const { rankCandidates } = require('../retrieval-ranking');
const reranker = require('../retrieval-reranker');
const { metrics } = require('./retrieval-compare');
async function main(argv = process.argv.slice(2)) {
  const args = { suite: 'long', split: 'calibration', report: null, label: null, online: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--online') { args.online = true; continue; }
    const key = { '--suite': 'suite', '--split': 'split', '--report': 'report', '--label': 'label' }[argv[i]];
    if (!key || !argv[i + 1]) throw new Error('非法参数');
    args[key] = argv[++i];
  }
  if (!['all', 'calibration', 'holdout'].includes(args.split) || !/^[a-z0-9-]{1,40}$/.test(args.label || '') || !args.report) throw new Error('需 --report、--label 和有效 split');
  const suite = loadSuite(args.suite);
  const raw = fs.readFileSync(args.report);
  const original = JSON.parse(raw);
  if (original.suiteSha256 !== suite.sha256 || original.status !== 'COMPLETED') throw new Error('来源报告不完整或题集不符');
  const output = path.join(__dirname, `rerank-${args.suite}-${args.split}-${args.label}-report.json`);
  if (fs.existsSync(output)) throw new Error('报告已存在');
  const ids = new Map(original.indexedDocuments.map(doc => [doc.fixtureId, doc.documentId]));
  const byId = new Map(suite.data.documents.map(doc => [ids.get(doc.id), doc]));
  const report = { status: 'PREPARED_ONLY', scope: 'Saved candidate reranking only; not end-to-end Q&A',
    suiteSha256: suite.sha256, sourceHash: crypto.createHash('sha256').update(raw).digest('hex'),
    rerankerHash: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../retrieval-reranker.js'))).digest('hex'), cases: [] };
  if (args.online) {
    require('../config-service').init({ userDataPath: path.resolve(__dirname, '../../.local-data/notebook-electron'), isPackaged: true });
    for (const question of suite.data.questions.filter(q => args.split === 'all' || q.split === args.split)) {
      const old = original.cases.find(c => c.id === question.id).candidate;
      const d = old.diagnostics;
      const candidates = d.candidates.filter(c => c.vector >= d.policy.similarityThreshold || c.bm25 >= d.policy.keywordThreshold
        || (c.bm25 > 0 && c.keywordMatches >= d.policy.minimumKeywordMatches)).map(c => ({
        id: c.chunkId, text: c.text, metadata: { documentId: c.documentId, documentTitle: byId.get(c.documentId).title },
        vectorScore: c.vector, keywordScore: c.bm25, rrfScore: c.rrf }));
      const { ranked } = rankCandidates(candidates, d.retrievalQuery, suite.data.documents, d.policy);
      const select = values => retrieval.selectWithinBudget(values, { tokenBudget: d.tokenBudget, maxPerDocument: 3, maxChunks: d.policy.maxChunks });
      if (JSON.stringify(select(ranked).map(c => c.id)) !== JSON.stringify(old.sources.map(s => s.chunkId))) throw new Error(`不能重放 ${question.id}`);
      const result = await reranker.rerank(ranked, question.query, {});
      const sources = select(result.ranked).map(c => ({ ...c, documentId: c.metadata.documentId }));
      report.cases.push({ id: question.id, kind: question.kind, baseline: old,
        candidate: { sources, evidenceRanks: rankEvidence(sources, question.evidenceTargets, ids), diagnostics: result.diagnostics } });
      fs.writeFileSync(output, JSON.stringify(report, null, 2));
      console.log(question.id, JSON.stringify(old.evidenceRanks), '->', JSON.stringify(report.cases.at(-1).candidate.evidenceRanks), result.diagnostics.status);
    }
    report.status = 'REPLAY_COMPLETED';
  }
  report.summary = { baseline: metrics(report.cases, 'baseline'), candidate: metrics(report.cases, 'candidate') };
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, summary: report.summary }, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
