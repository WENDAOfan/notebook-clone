// Paired retrieval evaluation: same production index and query vectors, two policies.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadSuite, rankEvidence } = require('./production-cases');
const retrieval = require('../retrieval-service');
const { rankCandidates } = require('../retrieval-ranking');
const { restoreSentenceContext } = require('../retrieval-context');

function metrics(cases, field, kind = 'answerable') {
  const rows = cases.filter(item => (item.kind || 'answerable') === kind);
  const ranks = rows.flatMap(item => Object.values(item[field].evidenceRanks));
  const firstRanks = rows.map(item => Math.min(...Object.values(item[field].evidenceRanks).filter(Boolean)));
  const durations = rows.map(item => item[field].diagnostics?.elapsedMs).filter(Number.isFinite).sort((a, b) => a - b);
  const rerankDurations = rows.map(item => item[field].diagnostics?.reranker?.elapsedMs).filter(Number.isFinite).sort((a, b) => a - b);
  const p95 = values => values[Math.ceil(values.length * .95) - 1] ?? null;
  return { questions: rows.length, evidenceTargets: ranks.length,
    recalledAt5: ranks.filter(rank => rank && rank <= 5).length,
    recallAt5: ranks.length ? ranks.filter(rank => rank && rank <= 5).length / ranks.length : null,
    evidenceMRR: ranks.length ? ranks.reduce((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / ranks.length : null,
    queryMRR: firstRanks.length ? firstRanks.reduce((sum, rank) => sum + (Number.isFinite(rank) ? 1 / rank : 0), 0) / firstRanks.length : null,
    averageSources: rows.length ? rows.reduce((sum, item) => sum + item[field].sources.length, 0) / rows.length : null,
    retrievalP95Ms: p95(durations),
    localRetrievalP95Ms: rerankDurations.length ? null : p95(durations),
    rerankP95Ms: p95(rerankDurations) };
}

function summarize(report) {
  const fields = report.cases.some(item => item.control) ? ['baseline', 'control', 'candidate'] : ['baseline', 'candidate'];
  return Object.fromEntries(fields.map(field => [field, {
    answerable: metrics(report.cases, field), noAnswerSupport: metrics(report.cases, field, 'no_answer')
  }]));
}

function replay(original, suite, questions, policy) {
  if (original.suiteSha256 !== suite.sha256) throw new Error('题集哈希与原报告不一致');
  const documentIds = new Map(original.indexedDocuments.map(item => [item.fixtureId, item.documentId]));
  const byId = new Map(suite.data.documents.map(doc => [documentIds.get(doc.id), doc]));
  return questions.map(question => {
    const old = original.cases.find(item => item.id === question.id);
    if (!old) throw new Error(`原报告缺少 ${question.id}`);
    const direct = old.direct || old.baseline;
    if (!direct?.diagnostics) throw new Error(`原报告缺少可重放检索 ${question.id}`);
    const diagnostics = direct.diagnostics;
    const previous = diagnostics.policy;
    const fused = diagnostics.candidates.map(item => ({ id: item.chunkId, text: item.text,
      metadata: { documentId: item.documentId, documentTitle: byId.get(item.documentId).title },
      vectorScore: item.vector, keywordScore: item.bm25, keywordMatches: item.keywordMatches, rrfScore: item.rrf }));
    const relevant = fused.filter(item => item.vectorScore >= previous.similarityThreshold
      || item.keywordScore >= previous.keywordThreshold
      || (item.keywordScore > 0 && item.keywordMatches >= previous.minimumKeywordMatches));
    const baseline = retrieval.selectWithinBudget(previous.exactIdentifiers
      ? retrieval.preferIdentifiers(relevant, diagnostics.retrievalQuery) : relevant,
    { tokenBudget: diagnostics.tokenBudget, maxPerDocument: 3 });
    if (JSON.stringify(baseline.map(item => item.id)) !== JSON.stringify(direct.sources.map(item => item.chunkId))) {
      throw new Error(`原策略不能精确重放 ${question.id}`);
    }
    const { ranked, phrases } = rankCandidates(relevant, diagnostics.retrievalQuery, suite.data.documents, policy);
    const contextual = policy.sentenceContext ? ranked.map(chunk => restoreSentenceContext(chunk,
      { id: chunk.metadata.documentId, content: byId.get(chunk.metadata.documentId).text })) : ranked;
    const selected = retrieval.selectWithinBudget(contextual, { tokenBudget: diagnostics.tokenBudget,
      maxPerDocument: 3, maxChunks: policy.maxChunks });
    const sources = selected.map(item => ({ ...item, documentId: item.metadata.documentId }));
    const rawSources = sources.map(item => ({ ...item, text: fused.find(chunk => chunk.id === item.id).text }));
    return { id: question.id, kind: question.kind || 'answerable', query: question.query,
      baseline: direct, candidate: { sources, evidenceRanks: rankEvidence(sources, question.evidenceTargets, documentIds),
        rawChunkEvidenceRanks: rankEvidence(rawSources, question.evidenceTargets, documentIds), phrases } };
  });
}

async function run(argv = process.argv.slice(2)) {
  const args = { online: false, rerank: false, suite: null, split: 'calibration', label: null, replay: null,
    phraseWeight: retrieval.DEFAULT_POLICY.phraseWeight, identifierWeight: retrieval.DEFAULT_POLICY.identifierWeight };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--online') { args.online = true; continue; }
    if (argv[i] === '--rerank') { args.rerank = true; continue; }
    const key = { '--suite': 'suite', '--split': 'split', '--label': 'label', '--replay': 'replay',
      '--phrase-weight': 'phraseWeight', '--identifier-weight': 'identifierWeight' }[argv[i]];
    if (!key || !argv[i + 1]) throw new Error(`非法参数 ${argv[i]}`);
    args[key] = key.endsWith('Weight') ? Number(argv[++i]) : argv[++i];
  }
  if (!['all', 'calibration', 'holdout'].includes(args.split)
      || !/^[a-z0-9-]{1,40}$/.test(args.label || '') || (args.online && args.replay) || (args.rerank && !args.online)
      || ![args.phraseWeight, args.identifierWeight].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error('需合法 --suite、--split、--label；--online 与 --replay 互斥');
  }
  const suite = loadSuite(args.suite);
  const questions = suite.data.questions.filter(q => args.split === 'all' || q.split === args.split);
  if (!questions.length) throw new Error('没有匹配题目');
  const policy = { ...retrieval.DEFAULT_POLICY, ranking: 'lexical', phraseWeight: args.phraseWeight,
    identifierWeight: args.identifierWeight, rerank: args.rerank };
  const reportPath = path.join(__dirname, `retrieval-${args.suite}-${args.split}-${args.label}-report.json`);
  if (fs.existsSync(reportPath)) throw new Error('报告已存在，拒绝覆盖');
  const report = { status: 'PREPARED_ONLY', startedAt: new Date().toISOString(),
    mode: args.replay ? 'SAVED_CANDIDATES_ONLY' : args.online ? 'PRODUCTION_PAIRED_RETRIEVAL' : 'PREPARE',
    suite: suite.data.id, suiteSha256: suite.sha256, split: args.split, policy,
    codeHash: crypto.createHash('sha256').update(Buffer.concat(['retrieval-service.js', 'retrieval-ranking.js', 'retrieval-context.js', 'retrieval-reranker.js', 'vector-store.js']
      .map(file => fs.readFileSync(path.join(__dirname, '..', file))))).digest('hex'),
    indexedDocuments: [], cases: [], scope: 'Retrieval only; no answer quality or billing claim.' };
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (args.replay) {
    const source = fs.readFileSync(args.replay);
    report.sourceHash = crypto.createHash('sha256').update(source).digest('hex');
    report.cases = replay(JSON.parse(source), suite, questions, policy);
    report.status = 'REPLAYED';
  } else if (args.online) {
    const config = require('../config-service');
    const db = require('../database');
    const vectors = require('../vector-store');
    const rag = require('../rag-service');
    const parent = path.resolve(__dirname, '../../.local-data/notebook-electron');
    let temporary;
    let opened = false;
    try {
      const readiness = config.init({ userDataPath: parent, isPackaged: true });
      if (!readiness.deepseekReady || !readiness.zhipuReady) throw new Error('模型配置未就绪');
      report.models = { embedding: config.getConfig().zhipu.model || 'embedding-3', chat: config.getConfig().deepseek.model };
      temporary = fs.mkdtempSync(path.join(parent, 'retrieval-eval-'));
      await db.init(':memory:'); opened = true;
      vectors.init(path.join(temporary, 'vectors.json'));
      const notebook = await db.createNotebook(suite.data.id, '仅虚构评测材料');
      const ids = new Map();
      report.status = 'RUNNING'; save();
      for (const doc of suite.data.documents) {
        const row = await db.createDocument(notebook.id, doc.title, doc.text, '虚构评测资料');
        await rag.indexDocumentAsync(row.id);
        const indexed = await db.getDocumentById(row.id);
        if (indexed.index_status !== 'ready') throw new Error(`索引失败 ${doc.id}`);
        ids.set(doc.id, row.id);
        report.indexedDocuments.push({ fixtureId: doc.id, documentId: row.id, status: indexed.index_status, chunks: indexed.chunk_count });
        if (ids.size % 10 === 0) { save(); console.log(`indexed ${ids.size}/${suite.data.documents.length}`); }
      }
      for (const question of questions) {
        const started = Date.now();
        const queryEmbedding = await rag.getEmbedding(question.query);
        const embeddingMs = Date.now() - started;
        const item = { id: question.id, kind: question.kind || 'answerable', query: question.query, embeddingMs };
        for (const field of (args.rerank ? ['baseline', 'control', 'candidate'] : ['baseline', 'candidate'])) {
          retrieval.configure({ thresholds: { ...policy, ranking: field === 'baseline' ? 'legacy' : 'lexical',
            rerank: field === 'candidate' && args.rerank } });
          const result = await retrieval.retrieve({ scopeType: 'notebook', scopeId: notebook.id,
            query: question.query, queryEmbedding });
          item[field] = { sources: result.sources, diagnostics: result.diagnostics,
            evidenceRanks: rankEvidence(result.sources, question.evidenceTargets, ids),
            rawChunkEvidenceRanks: rankEvidence(result.sources.map(source => ({ ...source,
              snippet: result.diagnostics.candidates.find(chunk => chunk.chunkId === source.chunkId).text })), question.evidenceTargets, ids) };
        }
        report.cases.push(item); save();
        console.log(`${question.id}: ${JSON.stringify(item.baseline.evidenceRanks)} -> ${JSON.stringify(item.candidate.evidenceRanks)}`);
      }
      report.status = 'COMPLETED';
    } catch (error) {
      report.status = 'BLOCKED'; report.reason = error.message; process.exitCode = 1;
    } finally {
      retrieval.configure({ thresholds: retrieval.DEFAULT_POLICY });
      if (opened) await db.close();
      if (temporary) {
        if (path.dirname(path.resolve(temporary)) !== parent || !path.basename(temporary).startsWith('retrieval-eval-')) throw new Error('临时目录边界错误');
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
  report.finishedAt = new Date().toISOString();
  report.summary = summarize(report); save();
  console.log(JSON.stringify({ reportPath, status: report.status, reason: report.reason, summary: report.summary }, null, 2));
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { metrics, replay };
