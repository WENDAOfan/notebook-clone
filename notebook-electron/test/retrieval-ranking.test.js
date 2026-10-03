const test = require('node:test');
const assert = require('node:assert/strict');
const { rankCandidates, queryPhrases, boundaryOverlap } = require('../retrieval-ranking');
const { selectWithinBudget } = require('../retrieval-service');
const { metrics, replay } = require('../eval/retrieval-compare');
const { loadSuite } = require('../eval/production-cases');
const c = (id, title, text, rrfScore = 0.03) => ({ id, text, rrfScore,
  metadata: { documentId: id, documentTitle: title } });

test('均衡明确标题主体，但不把其他对象的泛指预算提升到同一级', () => {
  const docs = [{ title: '墨泉厂合同' }, { title: '墨泉厂记录' }, { title: '墨全厂记录' },
    { title: '别厂预算' }];
  const result = rankCandidates([c(1, docs[0].title, '记录'), c(2, docs[2].title, '记录'),
    c(3, docs[3].title, '预算')], '墨泉厂与墨全厂预算分别是多少', docs, { balancedPhrases: true });
  assert.equal(result.ranked.find(x => x.id === 1).phraseScore, 1);
  assert.equal(result.ranked.find(x => x.id === 2).phraseScore, 1);
  assert.equal(result.ranked.find(x => x.id === 3).phraseScore, 0);
});

test('重叠片段软降序，不惩罚同文档另一处独立证据、不删除任何片段', () => {
  const shared = '明确的维修规定需要同时核对设备型号以及签收日期并且保留所有现场检查人员的签字记录。';
  const a = c(1, '规则', '新版内容' + shared, .032);
  const b = { ...c(2, '规则', shared + '其他例行登记', .0319), metadata: a.metadata };
  const old = { ...c(3, '规则', '旧版只需要一人审批，无相同边界文本', .0318), metadata: a.metadata };
  const before = structuredClone([a, b, old]);
  const result = rankCandidates([a, b, old], '规则', [], { overlapPenalty: .1 });
  assert.deepEqual(result.ranked.map(x => x.id), [1, 3, 2]);
  assert.equal(result.ranked[2].overlapDemotion, true);
  assert.equal(result.ranked[1].overlapDemotion, false);
  assert.deepEqual([a, b, old], before);
  assert.equal(boundaryOverlap(a, { ...b, metadata: { documentId: 99 } }), false);
  assert.equal(boundaryOverlap(a, old), false);
  assert.equal(boundaryOverlap(a, b), false);
  assert.equal(boundaryOverlap(b, a), true);
  const reversed = rankCandidates([{ ...b, rrfScore: .033 }, a, old], '规则', [], { overlapPenalty: .1 });
  assert.equal(reversed.ranked.find(x => x.id === a.id).overlapDemotion, false);
});

test('完整名称在非前缀标题中加分，省略型号的正文仍然保留', () => {
  const candidates = [c(1, '其他厂采购', 'QP-6主机采购价30万'),
    c(2, '财务：墨泉厂', '单台设备采购价未披露', 0.027)];
  const { ranked } = rankCandidates(candidates, '墨泉厂QP-6采购价', candidates.map(x => ({ title: x.metadata.documentTitle })));
  assert.equal(ranked[0].id, 2);
  assert.equal(ranked.length, 2);
  assert.deepEqual(ranked[0].identifierMatches, []);
});
test('重复主体短语优先于单份标题的长延伸，不把同主体工单压下去', () => {
  const documents = [{ title: '墨泉厂主机保修' }, { title: '墨泉厂维修工单' }, { title: '墨全厂维修工单' }];
  assert.deepEqual(queryPhrases('墨泉厂主机的维修结果', documents).map(item => item.text), ['墨泉厂']);
  const { ranked } = rankCandidates([c(1, documents[0].title, '保修20个月', 0.026),
    c(2, documents[1].title, '修好了', 0.032)], '墨泉厂主机的维修结果', documents);
  assert.equal(ranked[0].id, 2);
});
test('无字面短语的语义查询保持 RRF 顺序；不修改原候选', () => {
  const candidates = [c(1, '手册', '凭恢复码登录', 0.032), c(2, '通知', '联系电话', 0.02)];
  const before = structuredClone(candidates);
  const result = rankCandidates(candidates, '手机遗失怎么办', [{ title: '手册' }, { title: '通知' }]);
  assert.deepEqual(result.ranked.map(x => x.id), [1, 2]);
  assert.deepEqual(candidates, before);
});
test('比较问题同时保留资料多和资料少的名字，不以文档数量忽略后一方', () => {
  const phrases = queryPhrases('墨泉厂和墨全厂分别哪天验收',
    [{ title: '墨泉厂合同' }, { title: '墨泉厂验收' }, { title: '墨全厂验收' }]);
  assert.ok(phrases.some(item => item.text === '墨泉厂'));
  assert.ok(phrases.some(item => item.text === '墨全厂'));
});

test('共享名称后缀不能吞掉只出现一次的完整比较对象', () => {
  const docs = [{ title: '墨泉中心合同' }, { title: '墨泉中心记录' }, { title: '漠泉中心记录' }];
  const phrases = queryPhrases('墨泉中心和漠泉中心分别哪天验收', docs).map(p => p.text);
  assert.ok(phrases.includes('墨泉中心'));
  assert.ok(phrases.includes('漠泉中心'));
  assert.ok(!phrases.includes('泉中心'));
});
test('型号完整匹配，不把 X10 当作 X1，也不硬删未知型号证据', () => {
  const result = rankCandidates([c(1, '记录', 'X10保修'), c(2, '记录', 'X1保修'),
    c(3, '补充协议', '设备免费换新')], 'X1保修', []);
  assert.equal(result.ranked[0].id, 2);
  assert.equal(result.ranked.length, 3);
  assert.equal(result.ranked.find(x => x.id === 1).identifierScore, 0);
});
test('无关键词重合的最强语义证据不会因只有一路 RRF 投票而输给词法干扰', () => {
  const candidates = [{ ...c(1, '记录', '普通票售价', 0.032), vectorScore: 0.42, keywordScore: 4 },
    { ...c(2, '指南', '凭订单二维码入场', 0.016), vectorScore: 0.64, keywordScore: 0 }];
  const ranked = rankCandidates(candidates, '票丢了怎样进门', []).ranked;
  assert.equal(ranked[0].id, 2);
  assert.equal(ranked[0].semanticPromotion, true);
  candidates[1].vectorScore = 0.4;
  assert.equal(rankCandidates(candidates, '票丢了怎样进门', []).ranked[0].id, 1);
});
test('结果数、单文档上限与 token 预算共同生效', () => {
  const candidates = Array.from({ length: 12 }, (_, i) => c(i + 1, '资料', '测试正文'));
  assert.equal(selectWithinBudget(candidates, { tokenBudget: 8000, maxPerDocument: 3, maxChunks: 8 }).length, 8);
  assert.deepEqual(selectWithinBudget(candidates, { tokenBudget: 1, maxPerDocument: 3, maxChunks: 8 }), []);
});
test('评测分开统计逐证据 MRR、按题 MRR、无答案支持证据', () => {
  const rows = [{ kind: 'answerable', candidate: { evidenceRanks: { a: 1, b: null }, sources: [{}, {}] } },
    { kind: 'no_answer', candidate: { evidenceRanks: { a: 1 }, sources: [{}] } }];
  const value = metrics(rows, 'candidate');
  assert.equal(value.evidenceMRR, 0.5);
  assert.equal(value.queryMRR, 1);
  assert.equal(value.recallAt5, 0.5);
  assert.equal(metrics(rows, 'candidate', 'no_answer').evidenceMRR, 1);
});
test('新留出集在排序调优前固定，涵盖正文实体与无字面重合问题', () => {
  const { data, sha256 } = loadSuite('retrieval-holdout');
  assert.equal(sha256, 'cee4bb0e064a4ec3299afbf097cadc26261f2ae30f907098f951b68b64c3df4b');
  assert.equal(data.documents.length, 83);
  assert.equal(data.questions.length, 12);
  assert.ok(data.questions.every(q => q.split === 'holdout'));
  assert.equal(data.questions.filter(q => q.kind === 'no_answer').length, 3);
});

test('新长文题集首次评测后冻结，不通过修改原文或黄金证据抬分', () => {
  const suite = loadSuite('long-ranking');
  assert.equal(suite.sha256, '486a1f4a1553b1ac0b6fbb20a40f4e85e9f88c3c6f58b97d1c6e81503c0116ed');
  assert.equal(suite.data.documents.length, 6);
  assert.equal(suite.data.questions.length, 12);
});

test('配对报告可离线重放；来源顺序不能精确复现时拒绝计算分数', () => {
  const suite = { sha256: 'fixed', data: { documents: [{ id: 'doc-a', title: '说明' }] } };
  const question = { id: 'q', query: '说明', evidenceTargets: [{ id: 'fact', documentId: 'doc-a', contains: '事实' }] };
  const original = { suiteSha256: 'fixed', indexedDocuments: [{ fixtureId: 'doc-a', documentId: 1 }],
    cases: [{ id: 'q', baseline: { sources: [{ chunkId: 'chunk-a' }], diagnostics: {
      retrievalQuery: '说明', tokenBudget: 8000,
      policy: { similarityThreshold: .35, keywordThreshold: 1, minimumKeywordMatches: 2 },
      candidates: [{ chunkId: 'chunk-a', documentId: 1, text: '事实', vector: .8, bm25: 1, rrf: .03 }]
    } } }] };
  assert.deepEqual(replay(original, suite, [question], { maxChunks: 8 })[0].candidate.evidenceRanks, { fact: 1 });
  original.cases[0].baseline.sources[0].chunkId = 'different';
  assert.throws(() => replay(original, suite, [question], { maxChunks: 8 }), /不能精确重放/);
});
