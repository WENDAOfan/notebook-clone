// RGB-derived Chinese mini-evaluation. --prepare is offline; --online calls the configured models.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATASET_SHA256, sha256, parseJsonl, selectSamples, makeVariants, assess } = require('./rgb-mini-lib');

const UPSTREAM_COMMIT = '65ec39e40e7dc9abb50e9bf1b4f32be3f6f16615';

function parseArgs(argv) {
  const options = { online: false, rgbRoot: null, configPath: null, sampleSet: 'mini3', startOriginal: 0, countOriginal: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--prepare') continue;
    if (argv[i] === '--online') { options.online = true; continue; }
    if (argv[i] === '--rgb-root' && argv[i + 1]) { options.rgbRoot = path.resolve(argv[++i]); continue; }
    if (argv[i] === '--config' && argv[i + 1]) { options.configPath = path.resolve(argv[++i]); continue; }
    if (argv[i] === '--sample-set' && argv[i + 1]) { options.sampleSet = argv[++i]; continue; }
    if (argv[i] === '--start-original' && argv[i + 1]) { options.startOriginal = Number(argv[++i]); continue; }
    if (argv[i] === '--count-original' && argv[i + 1]) { options.countOriginal = Number(argv[++i]); continue; }
    throw new Error(`未知或不完整参数：${argv[i]}`);
  }
  if (!options.rgbRoot) throw new Error('请传入 --rgb-root <RGB 官方仓库目录>');
  if (!['mini3', 'reviewed20'].includes(options.sampleSet)) throw new Error(`未知样本集：${options.sampleSet}`);
  if (!Number.isInteger(options.startOriginal) || options.startOriginal < 0
      || (options.countOriginal !== null && (!Number.isInteger(options.countOriginal) || options.countOriginal < 1))) {
    throw new Error('样本起点必须为非负整数，题数必须为正整数');
  }
  return options;
}

function loadCases(options) {
  const file = path.join(options.rgbRoot, 'data', 'zh_refine.json');
  const bytes = fs.readFileSync(file);
  const hash = sha256(bytes);
  if (hash !== DATASET_SHA256) throw new Error(`RGB 文件版本不匹配：zh_refine.json SHA-256=${hash}`);
  const rows = parseJsonl(bytes.toString('utf8'));
  if (rows.length !== 300) throw new Error(`RGB 中文修订集应有 300 条，实际 ${rows.length} 条`);
  const selected = selectSamples(rows, options.sampleSet);
  const end = options.countOriginal === null ? selected.length : options.startOriginal + options.countOriginal;
  if (options.startOriginal >= selected.length || end > selected.length) {
    throw new Error(`样本范围超出 ${options.sampleSet} 的 ${selected.length} 条原题`);
  }
  const samples = selected.slice(options.startOriginal, end);
  return samples.flatMap(makeVariants);
}

function reportPath(options, cases) {
  if (options.sampleSet === 'mini3' && options.startOriginal === 0 && options.countOriginal === null) {
    return path.join(__dirname, 'rgb-mini-report.json');
  }
  if (options.sampleSet === 'reviewed20' && options.startOriginal === 0 && options.countOriginal === null) {
    return path.join(__dirname, 'rgb-20-report.json');
  }
  const last = options.startOriginal + cases.length / 2;
  return path.join(__dirname, `rgb-${options.sampleSet}-${options.startOriginal + 1}-${last}-report.json`);
}

function findConfigPath(explicit) {
  const candidates = explicit ? [explicit] : [
    path.join(__dirname, '..', '..', '.local-data', 'notebook-electron', 'config.json'),
    path.join(__dirname, '..', 'config.json'),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'notebook-electron', 'config.json')] : []),
    path.join(os.homedir(), '.config', 'notebook-electron', 'config.json')
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function safeRemoveTemporary(dir) {
  if (!dir) return;
  const relative = path.relative(os.tmpdir(), dir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
      || !path.basename(dir).startsWith('rgb-mini-')) {
    throw new Error(`拒绝清理非评测临时目录：${dir}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

async function runOnline(cases, options) {
  const config = require('../config-service');
  const db = require('../database');
  const vectors = require('../vector-store');
  const rag = require('../rag-service');
  const REPORT_PATH = reportPath(options, cases);
  const sampleIds = [...new Set(cases.map(item => item.datasetId))];
  const report = {
    status: 'RUNNING', startedAt: new Date().toISOString(),
    dataset: { repository: 'chen700564/RGB', commit: UPSTREAM_COMMIT, file: 'data/zh_refine.json', sha256: DATASET_SHA256,
      sampleSet: options.sampleSet, startOriginal: options.startOriginal, sampleIds },
    protocol: 'RGB-derived Electron end-to-end sample test; not an official RGB score',
    codeHash: crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(__dirname, '../rag-service.js')))
      .update(fs.readFileSync(path.join(__dirname, '../retrieval-service.js')))
      .update(fs.readFileSync(path.join(__dirname, '../embedding-client.js'))).digest('hex'),
    adapterHash: sha256(fs.readFileSync(path.join(__dirname, 'rgb-mini-lib.js'))),
    cases: [], manualReview: 'NOT_DONE'
  };
  const save = () => fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  let temporary = null;
  let databaseOpen = false;
  try {
    const configPath = findConfigPath(options.configPath);
    if (!configPath) throw new Error('未找到桌面版模型配置文件；可传入 --config <config.json 路径>');
    const status = config.init({ userDataPath: path.dirname(configPath), isPackaged: true });
    if (!status.deepseekReady || !status.zhipuReady) {
      throw new Error('DeepSeek 或智谱 Embedding 未就绪；请确认桌面版实际使用的配置路径');
    }
    report.models = {
      chat: config.getConfig().deepseek.model || 'deepseek-chat',
      embedding: config.getConfig().zhipu.model || 'embedding-3'
    };
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rgb-mini-'));
    await db.init(':memory:');
    databaseOpen = true;
    vectors.init(path.join(temporary, 'vectors.json'));

    for (const item of cases) {
      const notebook = await db.createNotebook(`RGB ${item.datasetId} ${item.type}`, '隔离的公开基准资料');
      let positiveDocumentId = null;
      const indexedDocuments = [];
      for (const document of item.documents) {
        const record = await db.createDocument(notebook.id, document.title, document.text, 'RGB 公开测试资料');
        await rag.indexDocumentAsync(record.id);
        const indexed = await db.getDocumentById(record.id);
        indexedDocuments.push({ documentId: record.id, title: document.title, status: indexed?.index_status, chunks: indexed?.chunk_count });
        if (indexed?.index_status !== 'ready') throw new Error(`${item.id} 的文档 ${document.title} 索引失败`);
        if (document.role === 'positive') positiveDocumentId = record.id;
      }

      const result = {
        id: item.id, datasetId: item.datasetId, type: item.type, query: item.query,
        expectedAnswers: item.expectedAnswers, indexedDocuments,
        answer: '', sources: [], diagnostics: null, firstTokenMs: null,
        usage: null, error: null, ended: false,
        manualCorrect: null, manualEvidenceSupported: null
      };
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
      result.auto = assess(item, result, positiveDocumentId);
      report.cases.push(result);
      save();
      console.log(`${item.id}: ${result.error ? 'ERROR' : 'completed'} (${result.elapsedMs}ms)`);
    }

    const answerable = report.cases.filter(item => item.type === 'answerable');
    const noAnswer = report.cases.filter(item => item.type === 'no_answer');
    report.summary = {
      answerable: answerable.length,
      labeledPositivePassageInTop5: answerable.filter(item => item.auto.labeledPositivePassageInTop5).length,
      expectedStringPresent: answerable.filter(item => item.auto.expectedStringPresent).length,
      noAnswer: noAnswer.length,
      refusalHeuristic: noAnswer.filter(item => item.auto.refusalHeuristic).length,
      invalidCitations: report.cases.filter(item => !item.auto.citationIdsValid).length,
      errors: report.cases.filter(item => item.error).length
    };
    report.status = report.summary.errors ? 'COMPLETED_WITH_ERRORS' : 'AWAITING_MANUAL_REVIEW';
    if (report.summary.errors) process.exitCode = 1;
  } catch (error) {
    report.status = 'BLOCKED';
    report.reason = error.message;
    process.exitCode = 1;
    console.error(`RGB 评测未完成：${error.message}`);
  } finally {
    report.finishedAt = new Date().toISOString();
    save();
    if (databaseOpen) await db.close().catch(() => {});
    safeRemoveTemporary(temporary);
  }
  console.log(`报告：${REPORT_PATH}（${report.status}）`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cases = loadCases(options);
  if (!options.online) {
    console.log(JSON.stringify({ status: 'PREPARED_ONLY', datasetSha256: DATASET_SHA256,
      sampleIds: [...new Set(cases.map(item => item.datasetId))],
      cases: cases.map(item => ({ id: item.id, documentCount: item.documents.length })) }, null, 2));
    return;
  }
  await runOnline(cases, options);
}

main().catch(error => { console.error(`RGB 评测准备失败：${error.message}`); process.exitCode = 1; });
