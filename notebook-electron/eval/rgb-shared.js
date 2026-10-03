// Fixed RGB-derived shared-corpus evaluation. --prepare is offline; --online uses configured models.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATASET_SHA256, sha256, parseJsonl, assess } = require('./rgb-mini-lib');
const { buildSharedCorpus, rankOfDocument, summarizeRetrieval } = require('./rgb-shared-lib');

const UPSTREAM_COMMIT = '65ec39e40e7dc9abb50e9bf1b4f32be3f6f16615';
const REPORT_PATH = path.join(__dirname, 'rgb-shared-report.json');
const RESCORED_REPORT_PATH = path.join(__dirname, 'rgb-shared-rescored-report.json');

function parseArgs(argv) {
  const options = { online: false, rescore: false, rgbRoot: null, configPath: null,
    label: null, caseId: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--prepare') continue;
    if (argv[i] === '--online') { options.online = true; continue; }
    if (argv[i] === '--rescore') { options.rescore = true; continue; }
    if (argv[i] === '--rgb-root' && argv[i + 1]) { options.rgbRoot = path.resolve(argv[++i]); continue; }
    if (argv[i] === '--config' && argv[i + 1]) { options.configPath = path.resolve(argv[++i]); continue; }
    if (argv[i] === '--label' && argv[i + 1]) { options.label = argv[++i]; continue; }
    if (argv[i] === '--case-id' && argv[i + 1]) { options.caseId = Number(argv[++i]); continue; }
    throw new Error(`未知或不完整参数：${argv[i]}`);
  }
  if (!options.rgbRoot) throw new Error('请传入 --rgb-root <RGB 官方仓库目录>');
  if (options.online && options.rescore) throw new Error('--online 与 --rescore 不能同时使用');
  if (options.label && (!options.online || !/^[a-z0-9-]{1,32}$/.test(options.label))) {
    throw new Error('--label 仅支持在线评测且只能包含小写字母、数字和连字符');
  }
  if (options.caseId !== null && (!options.online || !Number.isSafeInteger(options.caseId) || options.caseId < 1)) {
    throw new Error('--case-id 仅支持在线评测且需为正整数');
  }
  return options;
}

function loadCorpus(rgbRoot) {
  const bytes = fs.readFileSync(path.join(rgbRoot, 'data', 'zh_refine.json'));
  const hash = sha256(bytes);
  if (hash !== DATASET_SHA256) throw new Error(`RGB 中文文件哈希不符：${hash}`);
  const rows = parseJsonl(bytes.toString('utf8'));
  if (rows.length !== 300) throw new Error(`RGB 中文修订集应有 300 条，实际 ${rows.length} 条`);
  return buildSharedCorpus(rows);
}

function findConfigPath(explicit) {
  const candidates = explicit ? [explicit] : [
    path.join(__dirname, '..', '..', '.local-data', 'notebook-electron', 'config.json'),
    path.join(__dirname, '..', 'config.json'),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'notebook-electron', 'config.json')] : [])
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function removeTestDirectory(dir, parent) {
  if (!dir) return;
  if (path.dirname(path.resolve(dir)) !== path.resolve(parent)
      || !path.basename(dir).startsWith('rgb-shared-')) {
    throw new Error(`拒绝清理非共享评测目录：${dir}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

async function runOnline(corpus, options) {
  const reportPath = options.label
    ? path.join(__dirname, `rgb-shared-${options.label}-report.json`) : REPORT_PATH;
  if (fs.existsSync(reportPath)) throw new Error(`报告已存在，拒绝覆盖：${reportPath}`);
  const selectedQueries = options.caseId === null ? corpus.queries
    : corpus.queries.filter(item => item.datasetId === options.caseId);
  if (!selectedQueries.length) throw new Error(`共享测试集不包含题目 ${options.caseId}`);
  const config = require('../config-service');
  const db = require('../database');
  const vectors = require('../vector-store');
  const rag = require('../rag-service');
  const retrieval = require('../retrieval-service');
  const report = {
    status: 'RUNNING', startedAt: new Date().toISOString(),
    dataset: { repository: 'chen700564/RGB', commit: UPSTREAM_COMMIT, file: 'data/zh_refine.json',
      sha256: DATASET_SHA256, answerableIds: corpus.answerableIds, noAnswerIds: corpus.noAnswerIds },
    protocol: 'RGB-derived Electron shared-notebook retrieval and QA; not an official RGB score',
    corpus: { hash: corpus.corpusHash, documents: corpus.documents.map(({ datasetId, role, textHash, title }) =>
      ({ datasetId, role, textHash, title })) },
    codeHash: crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(__dirname, '../rag-service.js')))
      .update(fs.readFileSync(path.join(__dirname, '../retrieval-service.js')))
      .update(fs.readFileSync(path.join(__dirname, '../embedding-client.js')))
      .update(fs.readFileSync(path.join(__dirname, '../answer-policy.js'))).digest('hex'),
    adapterHash: sha256(Buffer.concat([
      fs.readFileSync(path.join(__dirname, 'rgb-shared-lib.js')),
      fs.readFileSync(path.join(__dirname, 'rgb-mini-lib.js')),
      fs.readFileSync(__filename)
    ])),
    selection: options.caseId === null ? 'all' : `case-id:${options.caseId}`,
    indexedDocuments: [], cases: [], manualReview: 'NOT_DONE'
  };
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  let temporary = null;
  let temporaryParent = null;
  let databaseOpen = false;
  try {
    const configPath = findConfigPath(options.configPath);
    if (!configPath) throw new Error('未找到桌面版配置文件；可传入 --config <config.json 路径>');
    const readiness = config.init({ userDataPath: path.dirname(configPath), isPackaged: true });
    if (!readiness.deepseekReady || !readiness.zhipuReady) throw new Error('DeepSeek 或智谱 Embedding 未就绪');
    report.models = { chat: config.getConfig().deepseek.model || 'deepseek-chat',
      embedding: config.getConfig().zhipu.model || 'embedding-3' };

    temporaryParent = path.dirname(configPath);
    temporary = fs.mkdtempSync(path.join(temporaryParent, 'rgb-shared-'));
    await db.init(':memory:');
    databaseOpen = true;
    vectors.init(path.join(temporary, 'vectors.json'));
    const notebook = await db.createNotebook('RGB 共享资料库', '隔离的公开基准资料');
    const documentIdsByHash = new Map();
    for (const [index, document] of corpus.documents.entries()) {
      const record = await db.createDocument(notebook.id, document.title, document.text, 'RGB 公开测试资料');
      await rag.indexDocumentAsync(record.id);
      const indexed = await db.getDocumentById(record.id);
      const result = { documentId: record.id, datasetId: document.datasetId, role: document.role,
        title: document.title, textHash: document.textHash,
        status: indexed?.index_status, chunks: indexed?.chunk_count,
        summaryFailed: indexed?.summary === '摘要生成失败，请点击重新生成' };
      report.indexedDocuments.push(result);
      if (result.status !== 'ready' || result.chunks < 1) throw new Error(`资料 ${index + 1} 索引失败`);
      documentIdsByHash.set(document.textHash, record.id);
      if ((index + 1) % 10 === 0) { save(); console.log(`共享资料索引：${index + 1}/${corpus.documents.length}`); }
    }

    for (const [index, item] of selectedQueries.entries()) {
      const sessionId = `notebook:${notebook.id}`;
      await db.clearChatHistory(sessionId);
      const historyBefore = await db.getChatHistory(sessionId);
      if (historyBefore.length) throw new Error(`问题 ${item.datasetId} 的测试会话未清空`);
      const positiveDocumentId = item.positiveTextHash ? documentIdsByHash.get(item.positiveTextHash) : null;

      const direct = await retrieval.retrieve({ scopeType: 'notebook', scopeId: notebook.id,
        query: item.query, history: [], tokenBudget: 8000 });
      const result = { id: `${item.datasetId}-${item.type}`, datasetId: item.datasetId,
        type: item.type, query: item.query, expectedAnswers: item.expectedAnswers,
        positiveDocumentId, historyBefore: historyBefore.length,
        direct: { positiveRank: positiveDocumentId ? rankOfDocument(direct.sources, positiveDocumentId) : null,
          sources: direct.sources.slice(0, 10), diagnostics: direct.diagnostics },
        answer: '', sources: [], diagnostics: null, firstTokenMs: null, usage: null,
        error: null, ended: false, manualCorrect: null, manualEvidenceSupported: null };
      const started = Date.now();
      await rag.handleAskStream({ sender: { isDestroyed: () => false, send(channel, data) {
        if (channel === 'chat:chunk') { result.firstTokenMs ??= Date.now() - started; result.answer += data.text; }
        if (channel === 'chat:sources') { result.sources = structuredClone(data.sources); result.diagnostics = structuredClone(data.diagnostics); }
        if (channel === 'chat:token-usage') result.usage = data.usage;
        if (channel === 'chat:error') result.error = data.message;
        if (channel === 'chat:end') result.ended = true;
      } } }, { id: notebook.id, type: 'notebook', question: item.query, useDocContext: true });
      result.elapsedMs = Date.now() - started;
      if (!result.ended && !result.error) result.error = '问答未发送结束事件';
      result.agentPositiveRank = positiveDocumentId ? rankOfDocument(result.sources, positiveDocumentId) : null;
      result.auto = assess(item, result, positiveDocumentId);
      report.cases.push(result);
      save();
      console.log(`共享问答：${index + 1}/${selectedQueries.length} ${result.id} ${result.error ? 'ERROR' : 'completed'}`);
      if (result.error) throw new Error(`问答 ${result.id} 失败：${result.error}`);
    }

    report.summary = {
      ...summarizeRetrieval(report.cases),
      noAnswer: report.cases.filter(item => item.type === 'no_answer').length,
      answerStringPresent: report.cases.filter(item => item.type === 'answerable' && item.auto.expectedStringPresent).length,
      refusalHeuristic: report.cases.filter(item => item.type === 'no_answer' && item.auto.refusalHeuristic).length,
      invalidCitations: report.cases.filter(item => !item.auto.citationIdsValid).length,
      errors: report.cases.filter(item => item.error).length
    };
    report.status = 'AWAITING_MANUAL_REVIEW';
  } catch (error) {
    report.status = 'BLOCKED';
    report.reason = error.message;
    process.exitCode = 1;
    console.error(`RGB 共享资料评测未完成：${error.message}`);
  } finally {
    report.finishedAt = new Date().toISOString();
    save();
    if (databaseOpen) await db.close().catch(() => {});
    removeTestDirectory(temporary, temporaryParent);
  }
  console.log(`报告：${reportPath}（${report.status}）`);
}

function rescoreExisting(corpus) {
  const originalBytes = fs.readFileSync(REPORT_PATH);
  const report = JSON.parse(originalBytes.toString('utf8'));
  if (report.dataset?.sha256 !== DATASET_SHA256 || report.corpus?.hash !== corpus.corpusHash
      || report.cases?.length !== corpus.queries.length) {
    throw new Error('原始报告与当前固定语料不匹配，拒绝重新计分');
  }
  const byId = new Map(corpus.queries.map(item => [`${item.datasetId}-${item.type}`, item]));
  for (const result of report.cases) {
    const item = byId.get(result.id);
    if (!item) throw new Error(`原始报告包含未知题目：${result.id}`);
    result.auto = assess(item, result, result.positiveDocumentId);
  }
  report.summary = {
    ...summarizeRetrieval(report.cases),
    noAnswer: report.cases.filter(item => item.type === 'no_answer').length,
    answerStringPresent: report.cases.filter(item => item.type === 'answerable' && item.auto.expectedStringPresent).length,
    refusalHeuristic: report.cases.filter(item => item.type === 'no_answer' && item.auto.refusalHeuristic).length,
    invalidCitations: report.cases.filter(item => !item.auto.citationIdsValid).length,
    errors: report.cases.filter(item => item.error).length
  };
  report.rescore = { rawReportSha256: sha256(originalBytes),
    scorerSha256: sha256(fs.readFileSync(path.join(__dirname, 'rgb-mini-lib.js'))),
    rescoredAt: new Date().toISOString(),
    reason: '拒答启发式补充“未给出/未载明/无法据此确认”；未重跑模型' };
  fs.writeFileSync(RESCORED_REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`离线重评分报告：${RESCORED_REPORT_PATH}（拒答 ${report.summary.refusalHeuristic}/${report.summary.noAnswer}）`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const corpus = loadCorpus(options.rgbRoot);
  if (options.rescore) { rescoreExisting(corpus); return; }
  if (!options.online) {
    console.log(JSON.stringify({ status: 'PREPARED_ONLY', datasetSha256: DATASET_SHA256,
      corpusHash: corpus.corpusHash, documentCount: corpus.documents.length,
      answerableIds: corpus.answerableIds, noAnswerIds: corpus.noAnswerIds }, null, 2));
    return;
  }
  await runOnline(corpus, options);
}

if (require.main === module) main().catch(error => {
  console.error(`RGB 共享资料准备失败：${error.message}`);
  process.exitCode = 1;
});
module.exports = { parseArgs, loadCorpus };
