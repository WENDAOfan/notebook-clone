// Replays saved synthetic evidence through the production Agent loop while
// varying only the tool-visible context. It never queries the vector store.
// Online calls require an explicit --online flag; results are diagnostic, not
// a replacement for end-to-end production retrieval evaluation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadSuite } = require('./production-cases');

const QUESTION_ID = 'dense-two-song-prices';
const countName = count => ({ 1: 'one', 2: 'two', 3: 'three' })[count] || String(count);

function parseArgs(argv) {
  const options = { online: false, label: null, repeat: 2, reportPath: path.join(__dirname,
    'dense-near-all-baseline-v1-report.json'), caseId: QUESTION_ID };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--online') { options.online = true; continue; }
    if (argv[i] === '--label' && argv[i + 1]) { options.label = argv[++i]; continue; }
    if (argv[i] === '--repeat' && argv[i + 1]) { options.repeat = Number(argv[++i]); continue; }
    if (argv[i] === '--report' && argv[i + 1]) { options.reportPath = path.resolve(argv[++i]); continue; }
    if (argv[i] === '--case-id' && argv[i + 1]) { options.caseId = argv[++i]; continue; }
    throw new Error(`未知或不完整参数：${argv[i]}`);
  }
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 3
      || !/^[a-z0-9-]{1,80}$/.test(options.caseId)
      || (options.online && !/^[a-z0-9-]{1,32}$/.test(options.label || ''))) {
    throw new Error('在线运行需 --label <小写标签>；--repeat 必须为 1～3；--case-id 需为固定题目 ID');
  }
  return options;
}

function buildPlan(report, suite, questionId = QUESTION_ID) {
  if (report.suite !== suite.data.id || report.suiteSha256 !== suite.sha256) {
    throw new Error('原始报告与固定题集的 ID 或 SHA-256 不一致');
  }
  const question = suite.data.questions.find(item => item.id === questionId);
  const original = report.cases.find(item => item.id === questionId);
  if (!question || !original?.diagnostics?.rounds?.length || !original.direct?.diagnostics?.candidates) {
    throw new Error('缺少固定问题或完整生产检索诊断');
  }
  const indexedByFixture = new Map(report.indexedDocuments.map(item => [item.fixtureId, Number(item.documentId)]));
  const documentById = new Map(report.indexedDocuments.map(item => [Number(item.documentId),
    suite.data.documents.find(document => document.id === item.fixtureId)]));
  const chunk = candidate => {
    const documentId = Number(candidate.documentId);
    const document = documentById.get(documentId);
    if (!document || !candidate.chunkId || !candidate.text?.trim()) {
      throw new Error(`候选片段缺少可信的文档映射：${candidate.chunkId}`);
    }
    return { id: candidate.chunkId, text: candidate.text,
      vectorScore: candidate.vector, keywordScore: candidate.bm25, rrfScore: candidate.rrf,
      metadata: { documentId, documentTitle: document.title, chunkIndex: 0 } };
  };
  const savedRounds = original.diagnostics.rounds.map(round =>
    round.candidates.filter(candidate => candidate.decision === 'selected').map(chunk));
  const allIds = [...new Set(savedRounds.flatMap(round => round.map(item => item.id)))];
  if (JSON.stringify(allIds) !== JSON.stringify(original.sources.map(source => source.chunkId))) {
    throw new Error('保存的工具轮次无法精确复现原始来源顺序');
  }
  if (!savedRounds.length || savedRounds.length > 3
      || !question.evidenceTargets?.length || question.evidenceTargets.length > 3) {
    throw new Error('本诊断只适用一到三轮、至多三处已标注证据的问题');
  }
  const directCandidates = original.direct.diagnostics.candidates;
  const goldChunks = question.evidenceTargets.map(target => {
    const documentId = indexedByFixture.get(target.documentId);
    const match = directCandidates.find(candidate => Number(candidate.documentId) === documentId
      && candidate.text.includes(target.contains));
    if (!match) throw new Error(`固定证据未进入原始融合候选：${target.id}`);
    return chunk(match);
  });
  const goldArm = `gold-${countName(goldChunks.length)}`;
  return { question, original, sourceReportLabel: report.label || null,
    sourceCodeHash: report.codeHash || null, armNames: ['saved-full', 'saved-top5', goldArm], arms: {
    'saved-full': savedRounds,
    'saved-top5': savedRounds.map(round => round.slice(0, 5)),
    [goldArm]: savedRounds.map(() => goldChunks)
  } };
}

function assertUnchangedProductionCode(sourceCodeHash) {
  const files = ['answer-policy.js', 'rag-service.js', 'retrieval-service.js'];
  const bytes = Buffer.concat(files.map(file => fs.readFileSync(path.join(__dirname, '..', file))));
  const current = crypto.createHash('sha256').update(bytes).digest('hex');
  if (!sourceCodeHash || current !== sourceCodeHash) {
    throw new Error('生产作答或检索代码已不同于原始报告，拒绝称为同代码证据回放');
  }
  return current;
}

async function runOnline(options, plan, suite) {
  const outputPath = path.join(__dirname, `context-ablation-${options.label}-report.json`);
  if (fs.existsSync(outputPath)) throw new Error(`报告已存在，拒绝覆盖：${outputPath}`);
  const config = require('../config-service');
  const db = require('../database');
  const rag = require('../rag-service');
  const retrieval = require('../retrieval-service');
  const configRoot = path.join(__dirname, '..', '..', '.local-data', 'notebook-electron');
  const readiness = config.init({ userDataPath: configRoot, isPackaged: true });
  if (!readiness.deepseekReady) throw new Error('DeepSeek 对话模型未就绪');
  const report = { status: 'RUNNING', suite: suite.data.id, suiteSha256: suite.sha256,
    sourceReportLabel: plan.sourceReportLabel, sourceCodeHash: plan.sourceCodeHash,
    questionId: plan.question.id, question: plan.question.query,
    warning: '只重放保存的虚构证据，绕过生产检索与索引；不同轮次仍可能受模型随机性影响。',
    model: config.getConfig().deepseek.model || 'deepseek-chat', repeat: options.repeat,
    arms: plan.armNames, runs: [] };
  const save = () => fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  const originalRetrieve = retrieval.retrieve;
  let opened = false;
  try {
    await db.init(':memory:');
    opened = true;
    const notebook = await db.createNotebook('上下文消融诊断', '虚构资料证据回放');
    for (let repetition = 1; repetition <= options.repeat; repetition += 1) {
      for (const arm of plan.armNames) {
        const sessionId = `notebook:${notebook.id}`;
        await db.clearChatHistory(sessionId);
        if ((await db.getChatHistory(sessionId)).length) throw new Error('消融前未清空会话');
        let callIndex = 0;
        const queries = [];
        retrieval.retrieve = async ({ query, signal, tokenBudget }) => {
          signal?.throwIfAborted();
          const chunks = plan.arms[arm][callIndex] || [];
          callIndex += 1;
          queries.push(query);
          return { chunks, diagnostics: { retrievalQuery: query, selectedChunks: chunks.length,
            tokenBudget, elapsedMs: 0, replayRound: callIndex, warnings: [] } };
        };
        const run = { repetition, arm, answer: '', sources: [], diagnostics: null,
          error: null, ended: false, queries, firstTokenMs: null, elapsedMs: null, usage: null };
        const started = Date.now();
        await rag.handleAskStream({ sender: { isDestroyed: () => false, send(channel, data) {
          if (channel === 'chat:chunk') { run.firstTokenMs ??= Date.now() - started; run.answer += data.text; }
          if (channel === 'chat:sources') { run.sources = structuredClone(data.sources); run.diagnostics = structuredClone(data.diagnostics); }
          if (channel === 'chat:token-usage') run.usage = data.usage;
          if (channel === 'chat:error') run.error = data.message;
          if (channel === 'chat:end') run.ended = true;
        } } }, { id: notebook.id, type: 'notebook', question: plan.question.query,
          useDocContext: true, requestId: `ablation-${arm}-${repetition}` });
        run.elapsedMs = Date.now() - started;
        report.runs.push(run);
        save();
        console.log(`${arm} #${repetition}: ${run.error || 'completed'}`);
        if (run.error || !run.ended || !run.answer.trim()) throw new Error(`${arm} #${repetition} 未正常完成`);
      }
    }
    report.status = 'AWAITING_MANUAL_REVIEW';
  } catch (error) {
    report.status = 'BLOCKED';
    report.reason = error.message;
    process.exitCode = 1;
    console.error(`消融中断：${error.message}`);
  } finally {
    retrieval.retrieve = originalRetrieve;
    if (opened) await db.close().catch(() => {});
    save();
  }
  console.log(`报告：${outputPath}（${report.status}）`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const suite = loadSuite('dense-near');
  const report = JSON.parse(fs.readFileSync(options.reportPath, 'utf8'));
  const plan = buildPlan(report, suite, options.caseId);
  if (!options.online) {
    console.log(JSON.stringify({ status: 'PREPARED_ONLY', question: plan.question.id,
      suiteSha256: suite.sha256,
      arms: Object.fromEntries(plan.armNames.map(arm => [arm, plan.arms[arm].map(round => round.length)])),
      repeat: options.repeat }, null, 2));
    return;
  }
  assertUnchangedProductionCode(plan.sourceCodeHash);
  await runOnline(options, plan, suite);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseArgs, buildPlan, assertUnchangedProductionCode };
