// Explicit online-only acceptance runner. Uses the production parser, indexer and IPC handler.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const config = require('../config-service');
const db = require('../database');
const vectors = require('../vector-store');
const rag = require('../rag-service');
const extractor = require('../extractor');
const root = __dirname;
const phase = process.argv.includes('--acceptance') ? 'acceptance' : process.argv.includes('--calibration') ? 'calibration' : 'all';
const reportPath = path.join(root, process.argv.includes('--embedding-fixed') ? 'embedding-fixed-acceptance.json' : phase === 'all' ? 'report.json' : `${phase}-report.json`);
const report = { status: 'NOT_RUN', startedAt: new Date().toISOString(), documents: [], cases: [], manualReview: 'NOT_RUN' };
function save() { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
async function main() {
  if (!process.argv.includes('--online')) throw new Error('真实评测必须显式传入 --online');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-rag-acceptance-'));
  try {
    const status = config.init({ userDataPath: temporary });
    if (!status.deepseekReady || !status.zhipuReady) {
      report.status = 'BLOCKED'; report.reason = '缺少真实模型配置'; save(); return;
    }
    report.models = { chat: config.getConfig().deepseek.model || 'deepseek-chat', embedding: config.getConfig().zhipu.model || 'embedding-3' };
    report.codeHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, '../rag-service.js'))).update(fs.readFileSync(path.join(root, '../retrieval-service.js'))).update(fs.readFileSync(path.join(root, '../embedding-client.js'))).update(fs.readFileSync(path.join(root, '../answer-policy.js'))).digest('hex');
    await db.init(':memory:'); vectors.init(path.join(temporary, 'vectors.json'));
    const notebook = await db.createNotebook('真实验收虚构资料', '不使用个人数据');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
    const cases = JSON.parse(fs.readFileSync(path.join(root, 'cases.json')));
    report.datasetHash = crypto.createHash('sha256').update(JSON.stringify({ manifest, cases })).digest('hex');
    for (const item of manifest) {
      const start = Date.now();
      const text = await extractor.extractText(path.join(root, 'fixtures', item.file));
      const doc = await db.createDocument(notebook.id, item.title, text, '评测固定摘要：虚构资料');
      await rag.indexDocumentAsync(doc.id);
      const indexed = await db.getDocumentById(doc.id);
      report.documents.push({ file: item.file, documentId: doc.id, status: indexed.index_status, chunks: indexed.chunk_count, elapsedMs: Date.now() - start });
      save();
      if (indexed.index_status !== 'ready') throw new Error(`索引失败：${item.file}`);
    }
    report.chunkCount = vectors.store.length;
    if (report.chunkCount < 50) throw new Error('语料不足 50 个分块');
    for (const item of cases.filter(item => phase === 'all' || item.split === phase)) {
      // Unique notebook sessions avoid answer leakage between fixtures; document scope stays constant.
      await db.clearChatHistory(`notebook:${notebook.id}`);
      for (const history of item.history) await db.saveChatMessage(`notebook:${notebook.id}`, history.role, history.content, null, notebook.id);
      const start = Date.now();
      const result = { ...item, answer: '', sources: [], diagnostics: null, firstTokenMs: null, error: null, manualCorrect: null, manualEvidenceSupported: null };
      await rag.handleAskStream({ sender: { isDestroyed: () => false, send: (channel, data) => {
        if (channel === 'chat:chunk') { result.firstTokenMs ??= Date.now() - start; result.answer += data.text; }
        if (channel === 'chat:sources') { result.sources = structuredClone(data.sources); result.diagnostics = structuredClone(data.diagnostics); }
        if (channel === 'chat:error') result.error = data.message;
        if (channel === 'chat:token-usage') result.usage = data.usage;
      } } }, { id: notebook.id, type: 'notebook', question: item.query, useDocContext: true });
      result.elapsedMs = Date.now() - start;
      const ranked = result.diagnostics?.rounds?.flatMap(round => round.candidates.filter(candidate => candidate.decision === 'selected')) || [];
      const unique = [...new Map(ranked.map(chunk => [chunk.chunkId, chunk])).values()];
      result.evidenceRanks = item.expectedEvidence.map(evidence => unique.findIndex(chunk => chunk.text.replace(/\s/g, '').includes(evidence.replace(/\s/g, ''))) + 1);
      result.crossScope = result.sources.some(source => !report.documents.some(doc => doc.documentId === source.documentId));
      report.cases.push(result); save(); console.log(`Completed ${item.id} (${result.elapsedMs}ms)`);
    }
    report.status = 'AWAITING_MANUAL_REVIEW';
    const acceptance = report.cases.filter(item => item.split === (phase === 'calibration' ? 'calibration' : 'acceptance'));
    const ranks = acceptance.flatMap(item => item.evidenceRanks);
    report.metrics = {
      evidenceRecallAt5: ranks.filter(rank => rank > 0 && rank <= 5).length / ranks.length,
      evidenceMRR: ranks.reduce((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / ranks.length,
      p95Ms: acceptance.map(item => item.elapsedMs).sort((a,b) => a-b)[Math.ceil(acceptance.length * .95)-1],
      errors: acceptance.filter(item => item.error).length,
      crossScope: acceptance.filter(item => item.crossScope).length
    };
    save();
  } catch (error) {
    report.status = 'BLOCKED'; report.reason = error.message; save(); process.exitCode = 1;
    console.error('Evaluation blocked:', error.message);
  } finally {
    await db.close().catch(() => {});
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main();
