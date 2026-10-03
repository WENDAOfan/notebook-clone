const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadSuite, parseArgs, selectedQuestions, rankSources, rankEvidence } = require('../eval/production-cases');
const { splitTextIntoChunks } = require('../rag-service');

test('时态评测先冻结校准与留出题，所有证据文档在同一资料库', () => {
  const { data, sha256 } = loadSuite('temporal');
  assert.equal(data.id, 'temporal-v1');
  assert.equal(sha256.length, 64);
  assert.equal(data.documents.length, 12);
  assert.equal(data.questions.filter(item => item.split === 'calibration').length, 4);
  assert.equal(data.questions.filter(item => item.split === 'holdout').length, 4);
  assert.equal(new Set(data.documents.map(item => item.id)).size, 12);
  assert.equal(new Set(data.questions.map(item => item.id)).size, 8);
});

test('生产评测默认离线，在线要求显式标签', () => {
  assert.deepEqual(parseArgs(['--suite', 'temporal']), {
    online: false, rerank: false, suite: 'temporal', split: 'all', label: null, configPath: null,
    rgbBackgroundRoot: null, caseId: null, retrievalPolicy: null
  });
  assert.throws(() => parseArgs(['--suite', 'temporal', '--online']), /--label/);
  assert.throws(() => parseArgs(['--suite', 'long', '--retrieval-policy', 'invalid']), /--retrieval-policy/);
  assert.throws(() => parseArgs(['--suite', 'long', '--rerank']), /显式在线/);
  assert.throws(() => parseArgs(['--suite', 'long', '--online', '--label', 'trial', '--retrieval-policy', 'legacy', '--rerank']), /lexical/);
  assert.equal(parseArgs(['--suite', 'long', '--online', '--label', 'trial', '--rerank']).rerank, true);
  assert.throws(() => parseArgs(['--suite', 'temporal', '--online', '--label', '../escape']), /--label/);
  assert.equal(parseArgs(['--suite', 'temporal', '--split', 'holdout', '--online', '--label', 'post']).split, 'holdout');
  assert.throws(() => parseArgs(['--suite', 'long', '--rgb-background', 'rgb']), /仅用于 narrative/);
  assert.equal(parseArgs(['--suite', 'dense-near', '--case-id', 'dense-maplelan-east-status']).caseId,
    'dense-maplelan-east-status');
  assert.throws(() => parseArgs(['--suite', 'dense-near', '--case-id', '../escape']), /--case-id/);
  assert.equal(selectedQuestions(loadSuite('dense-near'), { suite: 'dense-near', split: 'all',
    caseId: 'dense-maplelan-east-status' }).length, 1);
  assert.throws(() => selectedQuestions(loadSuite('dense-near'), { suite: 'dense-near',
    split: 'holdout', caseId: 'dense-maplelan-east-status' }), /没有匹配/);
});

test('第二组留出题在规则调整前已固定，涵盖缺记录与明确取消两种边界', () => {
  const { data, sha256 } = loadSuite('temporal-v2');
  assert.equal(data.id, 'temporal-v2');
  assert.equal(data.questions.length, 4);
  assert.ok(data.questions.every(item => item.split === 'holdout'));
  assert.equal(sha256.length, 64);
});

test('第三组留出题同时覆盖附属活动计划与明确已举办的对照', () => {
  const { data, sha256 } = loadSuite('temporal-v3');
  assert.equal(data.id, 'temporal-v3');
  assert.equal(data.questions.length, 5);
  assert.ok(data.questions.every(item => item.split === 'holdout'));
  assert.equal(sha256.length, 64);
});

test('多证据题按每份文档分别记录缺失和名次', () => {
  assert.deepEqual(rankSources([{ documentId: 20 }, { documentId: 10 }], [['old', 10], ['new', 20], ['missing', 30]]),
    { old: 2, new: 1, missing: null });
});

test('长文按实际证据片段而非同文档中的无关片段计名次', () => {
  const ids = new Map([['a', 10]]);
  const sources = [{ documentId: 10, snippet: '无关巡检记录' },
    { documentId: 10, snippet: '验收单号XH-BAT-0420' }];
  assert.deepEqual(rankEvidence(sources,
    [{ id: 'acceptance', documentId: 'a', contains: 'XH-BAT-0420' }], ids),
  { acceptance: 2 });
});

test('PDF 题集哈希测试只读取临时字节样本，不依赖本地生成 PDF', t => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-fixture-hash-'));
  t.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));
  const definition = require('../eval/pdf-local-cases');
  // This tests byte hashing, not PDF parsing or OCR. Real PDFs belong to the
  // explicitly run parser evaluation and must not be required by offline CI.
  const expectedHashes = definition.documents.map(document => {
    const bytes = Buffer.from(`synthetic hash-only fixture: ${document.fixtureFile}\n`);
    fs.writeFileSync(path.join(fixtureDirectory, document.fixtureFile), bytes);
    return { file: document.fixtureFile, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
  const { data, fixtureHashes, sha256 } = loadSuite('pdf-local', { fixtureDirectory });
  assert.equal(data.id, 'pdf-local-v1');
  assert.equal(data.documents.length, 3);
  assert.equal(data.questions.length, 6);
  assert.equal(fixtureHashes.length, 3);
  assert.deepEqual(fixtureHashes, expectedHashes);
  assert.equal(sha256, crypto.createHash('sha256').update(JSON.stringify({ data, fixtureHashes })).digest('hex'));
  assert.equal(loadSuite('pdf-local', { fixtureDirectory }).sha256, sha256);
  fs.appendFileSync(path.join(fixtureDirectory, definition.documents[0].fixtureFile), 'changed');
  assert.notEqual(loadSuite('pdf-local', { fixtureDirectory }).sha256, sha256);
});

test('PDF 真实评测所需样本缺失时仍明确失败，不静默绕过', t => {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-fixture-missing-'));
  t.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));
  assert.throws(() => loadSuite('pdf-local', { fixtureDirectory }), /缺少 PDF 评测样本：mixed-text-scan\.pdf/);
});

test('PDF 证据比对按标注区分 OCR 字间空格', () => {
  const ids = new Map([['scan-zh', 9]]);
  assert.deepEqual(rankEvidence([{ documentId: 9, snippet: '星 桥 X9 整 机 保修期 为 15 个 月 。' }],
    [{ id: 'x9', documentId: 'scan-zh', contains: '星桥X9整机保修期为15个月。', normalizeWhitespace: true }], ids),
  { x9: 1 });
});

test('已有非 PDF 题集哈希保持旧口径，历史在线报告可复核', () => {
  const { data, fixtureHashes, sha256: actual } = loadSuite('dense-near');
  const expected = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  assert.deepEqual(fixtureHashes, []);
  assert.equal(actual, expected);
});

test('新状态对照题在修改规则前固定校准和留出组', () => {
  const { data, sha256 } = loadSuite('status-v4');
  assert.equal(data.documents.length, 6);
  assert.equal(data.questions.length, 6);
  assert.equal(data.questions.filter(item => item.split === 'calibration').length, 3);
  assert.equal(data.questions.filter(item => item.split === 'holdout').length, 3);
  assert.deepEqual(data.questions.filter(item => item.kind === 'no_answer').map(item => item.split),
    ['calibration', 'holdout']);
  assert.equal(sha256.length, 64);
});

test('长文集使用生产切块规则至少形成 50 块，所有标注证据落在实际分块中', () => {
  const { data, sha256 } = loadSuite('long');
  const chunks = new Map(data.documents.map(document =>
    [document.id, splitTextIntoChunks(document.text, 512, 50)]));
  assert.equal(data.documents.length, 8);
  assert.equal(data.questions.length, 10);
  assert.equal(sha256.length, 64);
  assert.ok([...chunks.values()].reduce((count, values) => count + values.length, 0) >= 50);
  for (const question of data.questions) {
    for (const target of question.evidenceTargets) {
      assert.ok(chunks.get(target.documentId).some(chunk => chunk.includes(target.contains)),
        `${question.id}: ${target.id}`);
    }
  }
});

test('自然叙述集固定校准/留出题，标注证据可在实际分块中找到', () => {
  const { data, sha256 } = loadSuite('narrative');
  const chunks = new Map(data.documents.map(document =>
    [document.id, splitTextIntoChunks(document.text, 512, 50)]));
  assert.equal(data.documents.length, 10);
  assert.equal(data.questions.length, 10);
  assert.equal(data.questions.filter(item => item.split === 'calibration').length, 5);
  assert.equal(data.questions.filter(item => item.split === 'holdout').length, 5);
  assert.equal(sha256.length, 64);
  assert.ok([...chunks.values()].reduce((count, values) => count + values.length, 0) >= 12);
  for (const question of data.questions) {
    for (const target of question.evidenceTargets) {
      assert.ok(chunks.get(target.documentId).some(chunk => chunk.includes(target.contains)),
        `${question.id}: ${target.id}`);
    }
  }
});

test('近名站点集固定四站二十份资料与十二题，证据标注可按实际分块复核', () => {
  const { data, sha256 } = loadSuite('near');
  assert.equal(data.documents.length, 20);
  assert.equal(data.questions.length, 12);
  assert.equal(data.questions.filter(item => item.split === 'calibration').length, 6);
  assert.equal(data.questions.filter(item => item.split === 'holdout').length, 6);
  assert.equal(sha256.length, 64);
  const chunks = new Map(data.documents.map(document =>
    [document.id, splitTextIntoChunks(document.text, 512, 50)]));
  for (const question of data.questions) {
    for (const target of question.evidenceTargets) {
      assert.ok(chunks.get(target.documentId).some(chunk => chunk.includes(target.contains)),
        `${question.id}: ${target.id}`);
    }
  }
});

test('新密集近名集在八十份共享资料中冻结题目和片段级证据', () => {
  const { data, sha256 } = loadSuite('dense-near');
  assert.equal(data.documents.length, 80);
  assert.equal(data.questions.length, 16);
  assert.equal(data.questions.filter(item => item.split === 'calibration').length, 8);
  assert.equal(data.questions.filter(item => item.split === 'holdout').length, 8);
  assert.equal(data.questions.filter(item => item.kind === 'no_answer').length, 4);
  assert.equal(new Set(data.documents.map(item => item.id)).size, 80);
  assert.equal(sha256.length, 64);
  const chunks = new Map(data.documents.map(document =>
    [document.id, splitTextIntoChunks(document.text, 512, 50)]));
  assert.equal([...chunks.values()].reduce((sum, values) => sum + values.length, 0), 80);
  for (const question of data.questions) {
    for (const target of question.evidenceTargets) {
      assert.ok(chunks.get(target.documentId).some(chunk => chunk.includes(target.contains)),
        `${question.id}: ${target.id}`);
    }
  }
  for (const siteId of ['s00', 's05', 's10', 's15']) {
    const siteDocuments = data.documents.filter(document => document.id.startsWith(`${siteId}-`));
    assert.equal(siteDocuments.length, 5);
    const budget = siteDocuments.find(document => document.id === `${siteId}-budget`);
    assert.ok(budget.text.includes('现有材料无法确认实际采购单价'));
    assert.ok(!budget.text.includes('MP-42'));
    assert.ok(siteDocuments.every(document => !/MP-42主泵实际采购单价\d/.test(document.text)));
  }
  for (const siteId of ['s09', 's15']) {
    const siteDocuments = data.documents.filter(document => document.id.startsWith(`${siteId}-`));
    const drill = siteDocuments.find(document => document.id === `${siteId}-drill`);
    assert.ok(drill.text.includes('复盘没有记录是否举行'));
    assert.ok(siteDocuments.every(document => !document.text.includes('启动仪式在切换演练前实际举行')));
    assert.ok(siteDocuments.every(document => !document.text.includes('启动仪式因天气取消')));
  }
});
