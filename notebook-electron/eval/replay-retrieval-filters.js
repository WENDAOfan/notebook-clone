// Offline counterfactual over a saved production retrieval trace.
// Replays the recorded candidates; it does not re-embed, call models, or claim an end-to-end result.
const fs = require('node:fs');
const path = require('node:path');
const { loadSuite, rankEvidence } = require('./production-cases');
const { preferIdentifiers, selectWithinBudget } = require('../retrieval-service');

function parseArgs(argv) {
  const options = { suite: null, report: null, label: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--suite' && argv[i + 1]) { options.suite = argv[++i]; continue; }
    if (argv[i] === '--report' && argv[i + 1]) { options.report = path.resolve(argv[++i]); continue; }
    if (argv[i] === '--label' && argv[i + 1]) { options.label = argv[++i]; continue; }
    throw new Error(`未知或不完整参数：${argv[i]}`);
  }
  if (!options.suite || !options.report || !/^[a-z0-9-]{1,32}$/.test(options.label || '')) {
    throw new Error('用法：node eval/replay-retrieval-filters.js --suite <name> --report <原始报告> --label <标签>');
  }
  return options;
}

function summarize(cases, field) {
  const ranks = cases.flatMap(item => Object.values(item[field]));
  if (!ranks.length) return { targets: 0, recallAt1: 0, recallAt5: 0, missing: 0, mrr: null };
  return { targets: ranks.length,
    recallAt1: ranks.filter(rank => rank === 1).length,
    recallAt5: ranks.filter(rank => rank !== null && rank <= 5).length,
    missing: ranks.filter(rank => rank === null).length,
    mrr: ranks.reduce((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / ranks.length };
}

// Diagnostic upper bound for this fictional station corpus: only use full site
// names written in the query and at the start of a document title. This is not
// a general entity linker and must not be treated as a production policy.
function explicitSiteNames(query, documents) {
  const names = [...new Set(documents.map(document =>
    String(document.title || '').match(/^([\u4e00-\u9fff]{2,6}站)/)?.[1]).filter(Boolean))];
  return names.filter(name => String(query || '').includes(name));
}

function replay(report, suite) {
  if (report.suite !== suite.data.id || report.suiteSha256 !== suite.sha256) {
    throw new Error('报告和题集的 ID 或 SHA-256 不一致，拒绝重放');
  }
  const byQuestion = new Map(suite.data.questions.map(question => [question.id, question]));
  const documentIds = new Map(report.indexedDocuments.map(item => [item.fixtureId, item.documentId]));
  const byDocumentId = new Map(report.indexedDocuments.map(item => [Number(item.documentId),
    suite.data.documents.find(document => document.id === item.fixtureId)]));
  const cases = [];
  for (const original of report.cases) {
    const question = byQuestion.get(original.id);
    const diagnostics = original.direct?.diagnostics;
    if (!question || !diagnostics?.candidates || !diagnostics?.policy?.exactIdentifiers) {
      throw new Error(`题目 ${original.id} 缺少可重放的原问题检索诊断`);
    }
    const candidates = diagnostics.candidates.map(candidate => {
      const document = byDocumentId.get(Number(candidate.documentId));
      if (!document) throw new Error(`候选文档 ${candidate.documentId} 不属于固定题集`);
      return { id: candidate.chunkId, text: candidate.text, documentId: Number(candidate.documentId),
        vectorScore: candidate.vector, keywordScore: candidate.bm25,
        keywordMatches: candidate.keywordMatches, rrfScore: candidate.rrf,
        metadata: { documentId: Number(candidate.documentId), documentTitle: document.title } };
    });
    const policy = diagnostics.policy;
    const relevant = candidates.filter(candidate =>
      candidate.vectorScore >= policy.similarityThreshold
      || candidate.keywordScore >= policy.keywordThreshold
      || (candidate.keywordScore > 0 && candidate.keywordMatches >= policy.minimumKeywordMatches));
    const preferred = preferIdentifiers(relevant, diagnostics.retrievalQuery);
    const selectedCurrent = selectWithinBudget(preferred, {
      tokenBudget: diagnostics.tokenBudget, maxPerDocument: 3
    });
    const actualChunkIds = original.direct.sources.map(source => source.chunkId);
    if (JSON.stringify(selectedCurrent.map(chunk => chunk.id)) !== JSON.stringify(actualChunkIds)) {
      throw new Error(`题目 ${original.id} 的当前策略无法精确重放原始来源，拒绝外推`);
    }
    const selectedNoHardFilter = selectWithinBudget(relevant, {
      tokenBudget: diagnostics.tokenBudget, maxPerDocument: 3
    });
    // Exploratory only: preserve the first two threshold-passing RRF results before
    // applying the existing exact-identifier preference to the remaining candidates.
    // Two was selected after seeing near-entity-v1; dense-near-v1 is a new holdout.
    const topTwo = new Set(relevant.slice(0, 2));
    const preferredSet = new Set(preferred);
    const selectedRetainTopTwo = selectWithinBudget(
      relevant.filter(candidate => topTwo.has(candidate) || preferredSet.has(candidate)),
      { tokenBudget: diagnostics.tokenBudget, maxPerDocument: 3 }
    );
    const requestedSites = explicitSiteNames(diagnostics.retrievalQuery, suite.data.documents);
    const inNamedSites = requestedSites.length
      ? relevant.filter(candidate => requestedSites.some(name =>
        candidate.metadata.documentTitle.startsWith(name))) : null;
    const selectedNameAndIdentifier = inNamedSites && selectWithinBudget(
      preferred.filter(candidate => requestedSites.some(name =>
        candidate.metadata.documentTitle.startsWith(name))),
      { tokenBudget: diagnostics.tokenBudget, maxPerDocument: 3 }
    );
    const selectedNameNoIdentifier = inNamedSites && selectWithinBudget(inNamedSites,
      { tokenBudget: diagnostics.tokenBudget, maxPerDocument: 3 }
    );
    const targets = question.evidenceTargets || [];
    const currentRanks = rankEvidence(selectedCurrent, targets, documentIds);
    const noHardFilterRanks = rankEvidence(selectedNoHardFilter, targets, documentIds);
    const retainTopTwoRanks = rankEvidence(selectedRetainTopTwo, targets, documentIds);
    const nameAndIdentifierRanks = selectedNameAndIdentifier
      ? rankEvidence(selectedNameAndIdentifier, targets, documentIds) : null;
    const nameNoIdentifierRanks = selectedNameNoIdentifier
      ? rankEvidence(selectedNameNoIdentifier, targets, documentIds) : null;
    cases.push({ id: original.id, kind: question.kind || 'unspecified', currentRanks, noHardFilterRanks,
      retainTopTwoRanks, selectedCurrent: selectedCurrent.length,
      selectedNoHardFilter: selectedNoHardFilter.length,
      selectedRetainTopTwo: selectedRetainTopTwo.length,
      requestedSites, nameAndIdentifierRanks, nameNoIdentifierRanks,
      selectedNameAndIdentifier: selectedNameAndIdentifier?.length ?? null,
      selectedNameNoIdentifier: selectedNameNoIdentifier?.length ?? null,
      newlyIncluded: selectedNoHardFilter.filter(chunk => !selectedCurrent.some(old => old.id === chunk.id))
        .map(chunk => ({ chunkId: chunk.id, documentId: chunk.documentId,
          fixtureId: report.indexedDocuments.find(item => item.documentId === chunk.documentId)?.fixtureId })),
      newlyIncludedTopTwo: selectedRetainTopTwo.filter(chunk => !selectedCurrent.some(old => old.id === chunk.id))
        .map(chunk => ({ chunkId: chunk.id, documentId: chunk.documentId,
          fixtureId: report.indexedDocuments.find(item => item.documentId === chunk.documentId)?.fixtureId })) });
  }
  return { status: 'OFFLINE_COUNTERFACTUAL', sourceSuite: report.suite,
    sourceSuiteSha256: report.suiteSha256, sourceLabel: report.label,
    warning: '只重放已保存的候选和当前选择函数；没有重新查询、索引或调用模型，不是线上效果分数。',
    current: summarize(cases, 'currentRanks'),
    currentAnswerable: summarize(cases.filter(item => item.kind === 'answerable'), 'currentRanks'),
    currentNoAnswer: summarize(cases.filter(item => item.kind === 'no_answer'), 'currentRanks'),
    withoutHardIdentifierFilter: summarize(cases, 'noHardFilterRanks'),
    withoutHardFilterAnswerable: summarize(cases.filter(item => item.kind === 'answerable'), 'noHardFilterRanks'),
    withoutHardFilterNoAnswer: summarize(cases.filter(item => item.kind === 'no_answer'), 'noHardFilterRanks'),
    retainTopTwo: summarize(cases, 'retainTopTwoRanks'),
    retainTopTwoAnswerable: summarize(cases.filter(item => item.kind === 'answerable'), 'retainTopTwoRanks'),
    retainTopTwoNoAnswer: summarize(cases.filter(item => item.kind === 'no_answer'), 'retainTopTwoRanks'),
    explicitNameApplicableCases: cases.filter(item => item.nameNoIdentifierRanks).length,
    explicitNameAndIdentifier: summarize(cases.filter(item => item.nameAndIdentifierRanks), 'nameAndIdentifierRanks'),
    explicitNameNoIdentifier: summarize(cases.filter(item => item.nameNoIdentifierRanks), 'nameNoIdentifierRanks'),
    cases };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const outputPath = path.join(__dirname, `filter-replay-${options.label}-report.json`);
  if (fs.existsSync(outputPath)) throw new Error(`报告已存在，拒绝覆盖：${outputPath}`);
  const report = JSON.parse(fs.readFileSync(options.report, 'utf8'));
  const result = replay(report, loadSuite(options.suite));
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ outputPath, status: result.status, current: result.current,
    currentAnswerable: result.currentAnswerable, currentNoAnswer: result.currentNoAnswer,
    withoutHardIdentifierFilter: result.withoutHardIdentifierFilter,
    withoutHardFilterAnswerable: result.withoutHardFilterAnswerable,
    withoutHardFilterNoAnswer: result.withoutHardFilterNoAnswer,
    retainTopTwo: result.retainTopTwo,
    retainTopTwoAnswerable: result.retainTopTwoAnswerable,
    retainTopTwoNoAnswer: result.retainTopTwoNoAnswer,
    explicitNameApplicableCases: result.explicitNameApplicableCases,
    explicitNameAndIdentifier: result.explicitNameAndIdentifier,
    explicitNameNoIdentifier: result.explicitNameNoIdentifier,
    changedCases: result.cases.filter(item =>
      JSON.stringify(item.currentRanks) !== JSON.stringify(item.noHardFilterRanks)
      || JSON.stringify(item.currentRanks) !== JSON.stringify(item.retainTopTwoRanks))
      .map(item => ({ id: item.id, currentRanks: item.currentRanks,
        noHardFilterRanks: item.noHardFilterRanks,
        retainTopTwoRanks: item.retainTopTwoRanks,
        newlyIncluded: item.newlyIncluded,
        newlyIncludedTopTwo: item.newlyIncludedTopTwo })) }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { parseArgs, replay, explicitSiteNames };
