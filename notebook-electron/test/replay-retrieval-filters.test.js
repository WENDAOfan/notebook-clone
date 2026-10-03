const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, replay, explicitSiteNames } = require('../eval/replay-retrieval-filters');

function fixture() {
  const suite = { sha256: 'fixed-hash', data: { id: 'fixed-suite',
    documents: [{ id: 'other', title: '其他设备', text: 'QH-27其他记录' },
      { id: 'budget', title: '本站预算', text: '本站预算单价未公开' }],
    questions: [{ id: 'price', kind: 'no_answer', evidenceTargets: [{ id: 'unknown-price', documentId: 'budget',
      contains: '单价未公开' }] }] } };
  const report = { suite: 'fixed-suite', suiteSha256: 'fixed-hash', label: 'baseline',
    indexedDocuments: [{ fixtureId: 'other', documentId: 1 },
      { fixtureId: 'budget', documentId: 2 }],
    cases: [{ id: 'price', direct: { sources: [{ chunkId: 'other-chunk' }],
      diagnostics: { retrievalQuery: 'QH-27 采购单价', tokenBudget: 8000,
        policy: { exactIdentifiers: true, similarityThreshold: 0.35,
          keywordThreshold: 1, minimumKeywordMatches: 2 },
        candidates: [
          { chunkId: 'budget-chunk', documentId: 2, text: '本站预算单价未公开',
            vector: 0.7, bm25: 10, keywordMatches: 3, rrf: 0.03 },
          { chunkId: 'other-chunk', documentId: 1, text: 'QH-27其他记录',
            vector: 0.6, bm25: 3, keywordMatches: 2, rrf: 0.02 }
        ] } } }] };
  return { suite, report };
}

test('离线重放只有完全复现已保存来源后才计算无硬过滤反事实', () => {
  const { suite, report } = fixture();
  const result = replay(report, suite);
  assert.equal(result.current.missing, 1);
  assert.equal(result.withoutHardIdentifierFilter.recallAt1, 1);
  assert.equal(result.retainTopTwo.recallAt1, 1);
  assert.equal(result.currentNoAnswer.targets, 1);
  assert.equal(result.currentAnswerable.targets, 0);
  assert.deepEqual(result.cases[0].noHardFilterRanks, { 'unknown-price': 1 });
  assert.deepEqual(result.cases[0].retainTopTwoRanks, { 'unknown-price': 1 });
  assert.equal(result.cases[0].selectedRetainTopTwo, 2);
  report.cases[0].direct.sources[0].chunkId = 'unmatched';
  assert.throws(() => replay(report, suite), /无法精确重放/);
});

test('重放拒绝题集哈希不符和非法标签', () => {
  const { suite, report } = fixture();
  suite.sha256 = 'changed';
  assert.throws(() => replay(report, suite), /SHA-256 不一致/);
  assert.throws(() => parseArgs(['--suite', 'near', '--report', 'x', '--label', '../x']), /用法/);
});

test('明示站名上界对照区分站点归属与型号硬过滤，不把它当生产检索', () => {
  const { suite, report } = fixture();
  suite.data.documents[0].title = '青蓝北站采购记录';
  suite.data.documents[1].title = '青岚北站预算摘录';
  report.cases[0].direct.diagnostics.retrievalQuery = '青岚北站QH-27主泵采购单价';
  assert.deepEqual(explicitSiteNames(report.cases[0].direct.diagnostics.retrievalQuery,
    suite.data.documents), ['青岚北站']);
  assert.deepEqual(explicitSiteNames('该站采购单价是多少', suite.data.documents), []);
  const result = replay(report, suite);
  assert.equal(result.explicitNameApplicableCases, 1);
  assert.equal(result.explicitNameAndIdentifier.missing, 1);
  assert.equal(result.explicitNameNoIdentifier.recallAt1, 1);
  assert.equal(result.cases[0].selectedNameNoIdentifier, 1);
});
