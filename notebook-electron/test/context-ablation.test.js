const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseArgs, buildPlan, assertUnchangedProductionCode } = require('../eval/context-ablation');

function fixture() {
  const suite = { sha256: 'fixed', data: { id: 'dense-near-v1',
    documents: [
      { id: 'known', title: '松蓝西站预算', text: '实际单价15.8万元' },
      { id: 'hidden', title: '松岚东站预算', text: '实际单价无法确认' },
      { id: 'other', title: '松岚西站合同', text: '保修18个月' }
    ], questions: [{ id: 'dense-two-song-prices', query: '两站单价是多少', evidenceTargets: [
      { id: 'known-price', documentId: 'known', contains: '15.8万元' },
      { id: 'hidden-price', documentId: 'hidden', contains: '无法确认' }
    ] }] } };
  const candidate = (chunkId, documentId, text, decision) => ({ chunkId, documentId, text,
    decision, vector: 0.6, bm25: 2, rrf: 0.03 });
  const known = candidate('known-chunk', 1, '实际单价15.8万元', 'selected');
  const hidden = candidate('hidden-chunk', 2, '实际单价无法确认', 'below_threshold');
  const other = candidate('other-chunk', 3, '保修18个月', 'selected');
  const report = { suite: 'dense-near-v1', suiteSha256: 'fixed',
    indexedDocuments: [{ fixtureId: 'known', documentId: 1 },
      { fixtureId: 'hidden', documentId: 2 }, { fixtureId: 'other', documentId: 3 }],
    cases: [{ id: 'dense-two-song-prices', sources: [
      { chunkId: 'known-chunk' }, { chunkId: 'other-chunk' }
    ], direct: { diagnostics: { candidates: [known, hidden, other] } },
    diagnostics: { rounds: [{ candidates: [known, hidden, other] },
      { candidates: [other, known, hidden] }] } }] };
  return { suite, report };
}

test('默认离线，在线和重复次数需要受限参数', () => {
  assert.equal(parseArgs([]).online, false);
  assert.equal(parseArgs(['--online', '--label', 'fixed-v1', '--repeat', '2']).repeat, 2);
  assert.equal(parseArgs(['--case-id', 'dense-maplelan-east-status']).caseId, 'dense-maplelan-east-status');
  assert.throws(() => parseArgs(['--online']), /--label/);
  assert.throws(() => parseArgs(['--online', '--label', '../bad']), /--label/);
  assert.throws(() => parseArgs(['--repeat', '4']), /--repeat/);
  assert.throws(() => parseArgs(['--case-id', '../escape']), /--case-id/);
});

test('单证据状态问题可对照原全部来源、前五块和唯一原文', () => {
  const { suite, report } = fixture();
  suite.data.questions.push({ id: 'status', query: '换新是否完成', evidenceTargets: [
    { id: 'pending', documentId: 'known', contains: '15.8万元' }
  ] });
  report.cases.push({ ...report.cases[0], id: 'status' });
  const plan = buildPlan(report, suite, 'status');
  assert.deepEqual(plan.armNames, ['saved-full', 'saved-top5', 'gold-one']);
  assert.equal(plan.arms['gold-one'].length, 2);
  assert.deepEqual(plan.arms['gold-one'][0].map(chunk => chunk.id), ['known-chunk']);
});

test('原轮次必须精确复现来源，金标准臂只取两处已在融合候选中的原文', () => {
  const { suite, report } = fixture();
  const plan = buildPlan(report, suite);
  assert.deepEqual(plan.arms['saved-full'].map(round => round.map(chunk => chunk.id)),
    [['known-chunk', 'other-chunk'], ['other-chunk', 'known-chunk']]);
  assert.deepEqual(plan.arms['gold-two'][0].map(chunk => chunk.id),
    ['known-chunk', 'hidden-chunk']);
  assert.equal(plan.arms['gold-two'][0][1].metadata.documentTitle, '松岚东站预算');
  report.cases[0].sources[0].chunkId = 'wrong';
  assert.throws(() => buildPlan(report, suite), /无法精确复现/);
  report.cases[0].sources[0].chunkId = 'known-chunk';
  suite.sha256 = 'changed';
  assert.throws(() => buildPlan(report, suite), /SHA-256 不一致/);
});

test('在线对照要求与原始报告使用同一份生产作答和检索代码', () => {
  const files = ['answer-policy.js', 'rag-service.js', 'retrieval-service.js'];
  const bytes = Buffer.concat(files.map(file => fs.readFileSync(path.join(__dirname, '..', file))));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(assertUnchangedProductionCode(hash), hash);
  assert.throws(() => assertUnchangedProductionCode('wrong'), /已不同于原始报告/);
});
