// Run fixed, synthetic evaluation suites through the desktop production index,
// retrieval and streaming Q&A entrypoints. Online calls require --online.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SUITES = { temporal: 'temporal-cases.json', 'temporal-v2': 'temporal-v2-cases.json',
  'temporal-v3': 'temporal-v3-cases.json', long: 'long-cases.js',
  narrative: 'narrative-cases.js', near: 'near-entity-cases.js',
  'dense-near': 'dense-near-cases.js', 'pdf-local': 'pdf-local-cases.js',
  'status-v4': 'status-v4-cases.js', 'retrieval-holdout': 'retrieval-holdout-cases.js',
  'retrieval-confirm': 'retrieval-confirm-cases.js', 'long-ranking': 'long-ranking-holdout.js',
  'boundary-holdout': 'boundary-holdout-cases.js', 'semantic-confirm': 'semantic-confirm-cases.js',
  'paragraph-confirm': 'paragraph-confirm-cases.js' };
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const normalized = value => value.replace(/\s/g, '');

function loadSuite(name) {
  const file = SUITES[name];
  if (!file) throw new Error(`未知评测集：${name}`);
  const fullPath = path.join(__dirname, file);
  const bytes = fs.readFileSync(fullPath);
  const data = file.endsWith('.js') ? require(fullPath) : JSON.parse(bytes.toString('utf8'));
  const documents = data.documents || [];
  const questions = data.questions || [];
  const ids = new Set(documents.map(document => document.id));
  const byId = new Map(documents.map(document => [document.id, document]));
  const fixtureHashes = [];
  for (const document of documents) {
    if (!document.fixtureFile) continue;
    if (data.parserMode !== 'local-pdf' || !/^[a-z0-9-]+\.pdf$/.test(document.fixtureFile)) {
      throw new Error(`评测集 ${name} 的 PDF 路径无效`);
    }
    const fixturePath = path.join(__dirname, 'fixtures', document.fixtureFile);
    if (!fs.existsSync(fixturePath)) throw new Error(`缺少 PDF 评测样本：${document.fixtureFile}`);
    fixtureHashes.push({ file: document.fixtureFile, sha256: sha256(fs.readFileSync(fixturePath)) });
  }
  if (!data.id || !documents.length || !questions.length || ids.size !== documents.length
      || documents.some(document => !document.id || !document.title || !document.text?.trim())
      || documents.some(document => document.fixtureFile
        && (!document.expectedFacts?.length || document.expectedFacts.some(fact => !fact.trim()
          || !(document.normalizeWhitespace ? normalized(document.text).includes(normalized(fact))
            : document.text.includes(fact)))))
      || questions.some(question => !question.id || !question.query?.trim()
        || !question.expected?.trim() || !['calibration', 'holdout'].includes(question.split)
        || !question.evidenceDocumentIds?.length
        || question.evidenceDocumentIds.some(id => !ids.has(id))
        || (question.evidenceTargets && (!Array.isArray(question.evidenceTargets)
          || question.evidenceTargets.some(target => !target.id || !target.documentId
          || !target.contains?.trim() || !(target.normalizeWhitespace
            ? normalized(byId.get(target.documentId)?.text || '').includes(normalized(target.contains))
            : byId.get(target.documentId)?.text.includes(target.contains))))))
      || new Set(questions.map(question => question.id)).size !== questions.length) {
    throw new Error(`评测集 ${name} 结构无效`);
  }
  return { data, fixtureHashes,
    sha256: sha256(file.endsWith('.js')
      ? (fixtureHashes.length ? JSON.stringify({ data, fixtureHashes }) : JSON.stringify(data))
      : bytes) };
}

function parseArgs(argv) {
  const options = { online: false, rerank: false, suite: null, split: 'all', label: null, configPath: null,
    rgbBackgroundRoot: null, caseId: null, retrievalPolicy: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--prepare') continue;
    if (argv[i] === '--online') { options.online = true; continue; }
    if (argv[i] === '--rerank') { options.rerank = true; continue; }
    if (argv[i] === '--suite' && argv[i + 1]) { options.suite = argv[++i]; continue; }
    if (argv[i] === '--split' && argv[i + 1]) { options.split = argv[++i]; continue; }
    if (argv[i] === '--label' && argv[i + 1]) { options.label = argv[++i]; continue; }
    if (argv[i] === '--config' && argv[i + 1]) { options.configPath = path.resolve(argv[++i]); continue; }
    if (argv[i] === '--case-id' && argv[i + 1]) { options.caseId = argv[++i]; continue; }
    if (argv[i] === '--retrieval-policy' && argv[i + 1]) { options.retrievalPolicy = argv[++i]; continue; }
    if (argv[i] === '--rgb-background' && argv[i + 1]) {
      options.rgbBackgroundRoot = path.resolve(argv[++i]); continue;
    }
    throw new Error(`未知或不完整参数：${argv[i]}`);
  }
  if (!options.suite || !['all', 'calibration', 'holdout'].includes(options.split)) {
    throw new Error('需传入 --suite <name> 和有效 --split');
  }
  if (options.retrievalPolicy && !['legacy', 'lexical'].includes(options.retrievalPolicy)) {
    throw new Error('--retrieval-policy 必须为 legacy 或 lexical');
  }
  if (options.rerank && (!options.online || options.retrievalPolicy === 'legacy')) {
    throw new Error('--rerank 仅用于显式在线 lexical 实验');
  }
  if (options.online && (!options.label || !/^[a-z0-9-]{1,32}$/.test(options.label))) {
    throw new Error('在线评测需传入由小写字母、数字或连字符构成的 --label');
  }
  if (options.caseId && !/^[a-z0-9-]{1,80}$/.test(options.caseId)) {
    throw new Error('--case-id 必须是固定题目 ID');
  }
  if (options.rgbBackgroundRoot && options.suite !== 'narrative') {
    throw new Error('--rgb-background 仅用于 narrative 固定题集');
  }
  return options;
}

function selectedQuestions(suite, options) {
  const selected = suite.data.questions.filter(question =>
    (options.split === 'all' || question.split === options.split)
      && (!options.caseId || question.id === options.caseId));
  if (!selected.length) throw new Error(`评测集 ${options.suite} 没有匹配的 ${options.split} 题目`);
  return selected;
}

function removeTemporaryDirectory(dir, parent) {
  if (!dir) return;
  if (path.dirname(path.resolve(dir)) !== path.resolve(parent)
      || !path.basename(dir).startsWith('production-eval-')) {
    throw new Error(`拒绝清理非本次评测目录：${dir}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function rankSources(sources, ids) {
  return Object.fromEntries(ids.map(([label, documentId]) => {
    const index = sources.findIndex(source => Number(source.documentId) === documentId);
    return [label, index < 0 ? null : index + 1];
  }));
}

function rankEvidence(sources, targets, documentIds) {
  return Object.fromEntries(targets.map(target => {
    const documentId = documentIds.get(target.documentId);
    const index = sources.findIndex(source => Number(source.documentId) === documentId
      && (target.normalizeWhitespace
        ? normalized(source.snippet || source.text || '').includes(normalized(target.contains))
        : (source.snippet || source.text || '').includes(target.contains)));
    return [target.id, index < 0 ? null : index + 1];
  }));
}

async function runOnline(suite, options, background) {
  const reportPath = path.join(__dirname, `${options.suite}-${options.split}-${options.label}-report.json`);
  if (fs.existsSync(reportPath)) throw new Error(`报告已存在，拒绝覆盖：${reportPath}`);
  const configPath = options.configPath || path.join(__dirname, '..', '..', '.local-data', 'notebook-electron', 'config.json');
  if (!fs.existsSync(configPath)) throw new Error('未找到桌面版 D 盘配置文件；可传入 --config <路径>');
  const temporaryParent = path.dirname(configPath);
  const selected = selectedQuestions(suite, options);

  const config = require('../config-service');
  const db = require('../database');
  const vectors = require('../vector-store');
  const rag = require('../rag-service');
  const retrieval = require('../retrieval-service');
  if (options.retrievalPolicy) retrieval.configure({ thresholds: { ranking: options.retrievalPolicy } });
  retrieval.configure({ thresholds: { rerank: options.rerank } });
  const report = {
    status: 'RUNNING', startedAt: new Date().toISOString(),
    suite: suite.data.id, suiteSha256: suite.sha256, split: options.split, label: options.label,
    retrievalPolicy: options.retrievalPolicy || retrieval.DEFAULT_POLICY.ranking,
    rerank: options.rerank,
    caseId: options.caseId, scope: options.caseId ? 'single-case-regression' : 'full-split',
    fixtureHashes: suite.fixtureHashes,
    codeHash: sha256(Buffer.concat([
      fs.readFileSync(path.join(__dirname, '../answer-policy.js')),
      fs.readFileSync(path.join(__dirname, '../rag-service.js')),
      fs.readFileSync(path.join(__dirname, '../retrieval-service.js')),
      fs.readFileSync(path.join(__dirname, '../retrieval-ranking.js')),
      fs.readFileSync(path.join(__dirname, '../retrieval-context.js')),
      fs.readFileSync(path.join(__dirname, '../retrieval-reranker.js')),
      fs.readFileSync(path.join(__dirname, '../vector-store.js'))
    ])),
    indexedDocuments: [], cases: [], manualReview: 'NOT_DONE',
    background: background ? { datasetSha256: background.datasetSha256,
      corpusHash: background.corpusHash, documentCount: background.documents.length,
      indexedCount: 0 } : null
  };
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  let temporary = null;
  let databaseOpen = false;
  try {
    const readiness = config.init({ userDataPath: temporaryParent, isPackaged: true });
    if (!readiness.deepseekReady || !readiness.zhipuReady) throw new Error('DeepSeek 或智谱 Embedding 未就绪');
    report.models = { chat: config.getConfig().deepseek.model || 'deepseek-chat',
      embedding: config.getConfig().zhipu.model || 'embedding-3' };
    if (suite.data.parserMode === 'local-pdf') {
      // A dedicated check of the app's local fallback; never upload PDFs to LlamaParse.
      config.getConfig().llamaParse = null;
      report.parserMode = 'production-local-fallback';
      report.parserCodeHash = sha256(Buffer.concat([
        fs.readFileSync(path.join(__dirname, '../extractor.js')),
        fs.readFileSync(path.join(__dirname, '../pdf-local-parser.js'))
      ]));
    }
    temporary = fs.mkdtempSync(path.join(temporaryParent, 'production-eval-'));
    await db.init(':memory:');
    databaseOpen = true;
    vectors.init(path.join(temporary, 'vectors.json'));
    const notebook = await db.createNotebook(`评测 ${suite.data.id}`, '仅限虚构测试资料');
    if (background) {
      for (const document of background.documents) {
        const record = await db.createDocument(notebook.id, document.title, document.text, 'RGB 公开干扰资料');
        await rag.indexDocumentAsync(record.id);
        const indexed = await db.getDocumentById(record.id);
        if (indexed?.index_status !== 'ready' || indexed.chunk_count < 1) {
          throw new Error(`RGB 干扰资料索引失败：${document.datasetId}`);
        }
        report.background.indexedCount += 1;
        if (report.background.indexedCount % 10 === 0) {
          save();
          console.log(`干扰资料索引：${report.background.indexedCount}/${background.documents.length}`);
        }
      }
    }
    const documentIds = new Map();
    for (const document of suite.data.documents) {
      const text = document.fixtureFile
        ? await require('../extractor').extractText(path.join(__dirname, 'fixtures', document.fixtureFile))
        : document.text;
      if (document.fixtureFile && document.expectedFacts.some(fact => !(document.normalizeWhitespace
        ? normalized(text).includes(normalized(fact)) : text.includes(fact)))) {
        throw new Error(`PDF ${document.fixtureFile} 解析后缺少固定证据`);
      }
      const record = await db.createDocument(notebook.id, document.title, text, '虚构评测资料');
      await rag.indexDocumentAsync(record.id);
      const indexed = await db.getDocumentById(record.id);
      report.indexedDocuments.push({ fixtureId: document.id, documentId: record.id,
        status: indexed?.index_status, chunks: indexed?.chunk_count,
        ...(document.fixtureFile ? { fixtureFile: document.fixtureFile,
          parsedChars: text.length, parsedSha256: sha256(text) } : {}) });
      if (indexed?.index_status !== 'ready' || indexed.chunk_count < 1) {
        throw new Error(`文档 ${document.id} 索引失败`);
      }
      documentIds.set(document.id, record.id);
    }
    save();

    for (const question of selected) {
      const sessionId = `notebook:${notebook.id}`;
      await db.clearChatHistory(sessionId);
      const historyBefore = (await db.getChatHistory(sessionId)).length;
      if (historyBefore) throw new Error(`题目 ${question.id} 的会话未清空`);
      const expectedIds = question.evidenceDocumentIds.map(id => [id, documentIds.get(id)]);
      const direct = await retrieval.retrieve({ scopeType: 'notebook', scopeId: notebook.id,
        query: question.query, history: [], tokenBudget: 8000 });
      const result = { id: question.id, query: question.query, expected: question.expected,
        expectedDocumentIds: question.evidenceDocumentIds, historyBefore,
        direct: { ranks: rankSources(direct.sources, expectedIds), sources: direct.sources,
          evidenceRanks: rankEvidence(direct.sources, question.evidenceTargets || [], documentIds),
          diagnostics: direct.diagnostics }, answer: '', sources: [], diagnostics: null,
        usage: null, firstTokenMs: null, elapsedMs: null, ended: false, error: null };
      const started = Date.now();
      await rag.handleAskStream({ sender: { isDestroyed: () => false, send(channel, data) {
        if (channel === 'chat:chunk') { result.firstTokenMs ??= Date.now() - started; result.answer += data.text; }
        if (channel === 'chat:sources') { result.sources = structuredClone(data.sources); result.diagnostics = structuredClone(data.diagnostics); }
        if (channel === 'chat:token-usage') result.usage = data.usage;
        if (channel === 'chat:error') result.error = data.message;
        if (channel === 'chat:end') result.ended = true;
      } } }, { id: notebook.id, type: 'notebook', question: question.query, useDocContext: true });
      result.elapsedMs = Date.now() - started;
      result.agentRanks = rankSources(result.sources, expectedIds);
      result.agentEvidenceRanks = rankEvidence(result.sources, question.evidenceTargets || [], documentIds);
      if ((!result.answer.trim() || !result.ended) && !result.error) result.error = '空回答或缺少结束事件';
      report.cases.push(result);
      save();
      console.log(`${question.id}: ${result.error || 'completed'}`);
      if (result.error) throw new Error(`${question.id}: ${result.error}`);
    }
    report.status = 'AWAITING_MANUAL_REVIEW';
  } catch (error) {
    report.status = 'BLOCKED';
    report.reason = error.message;
    process.exitCode = 1;
    console.error(`评测失败：${error.message}`);
  } finally {
    report.finishedAt = new Date().toISOString();
    save();
    if (databaseOpen) await db.close().catch(() => {});
    removeTemporaryDirectory(temporary, temporaryParent);
  }
  console.log(`报告：${reportPath}（${report.status}）`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const suite = loadSuite(options.suite);
  const background = options.rgbBackgroundRoot
    ? require('./rgb-shared').loadCorpus(options.rgbBackgroundRoot) : null;
  if (background && background.documents.some(document =>
    /青岚北站|青蓝北站|QH-27/.test(document.text))) {
    throw new Error('RGB 干扰资料包含自然叙述集实体，拒绝运行');
  }
  const selected = selectedQuestions(suite, options);
  if (!options.online) {
    console.log(JSON.stringify({ status: 'PREPARED_ONLY', suite: suite.data.id, sha256: suite.sha256,
      documentCount: suite.data.documents.length, background: background
        ? { datasetSha256: background.datasetSha256, corpusHash: background.corpusHash,
          documentCount: background.documents.length } : null,
      fixtureHashes: suite.fixtureHashes, questionIds: selected.map(question => question.id) }, null, 2));
    return;
  }
  await runOnline(suite, options, background);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { loadSuite, parseArgs, selectedQuestions, rankSources, rankEvidence };
