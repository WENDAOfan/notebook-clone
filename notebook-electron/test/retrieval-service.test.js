const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../database');
const vectorStore = require('../vector-store');
const retrievalService = require('../retrieval-service');
const goldenCases = require('./fixtures/rag-golden.json');

let tempDirectory;
let notebook;
const documents = new Map();

test.before(async () => {
  await db.init(':memory:');
  notebook = await db.createNotebook('公开测试知识库', '仅包含虚构资料');
  const fixtures = [
    ['极光X1产品手册', '极光X1整机保修期为两年，核心部件保修三年。', [1, 0, 0, 0]],
    ['电池安全指南', '磷酸铁锂电池只允许在0℃到45℃之间充电，低温时应停止充电。', [0, 1, 0, 0]],
    ['账户安全规范', '启用双重验证后，应将离线恢复码保存在安全位置。手机丢失时可用恢复码登录。', [0, 0, 1, 0]],
    ['星桥售后政策', '商品支持七天无理由退货，验收后退款将在三个工作日内原路返回。', [0, 0, 0, 1]]
  ];
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-rag-eval-'));
  vectorStore.init(path.join(tempDirectory, 'vectors.json'));
  for (const [title, content, embedding] of fixtures) {
    const document = await db.createDocument(notebook.id, title, content);
    documents.set(title, document);
    await vectorStore.add([{
      id: `doc:${document.id}:fixture:0`,
      text: content,
      metadata: {
        schemaVersion: 2,
        documentId: document.id,
        documentTitle: title,
        chunkIndex: 0
      },
      embedding
    }]);
  }
});

test.after(async () => {
  await db.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('16 条离线黄金用例达到 Recall@5 与 MRR 门槛', async () => {
  let relevantCount = 0;
  let recalledCount = 0;
  let reciprocalRankTotal = 0;
  let rankedCases = 0;

  for (const fixture of goldenCases) {
    const result = await retrievalService.retrieve({
      scopeType: 'notebook',
      scopeId: notebook.id,
      query: fixture.query,
      history: fixture.history || [],
      queryEmbedding: fixture.embedding,
      tokenBudget: 8000
    });
    const titles = result.sources.map(source => source.documentTitle);
    if (fixture.expectedTitles.length === 0) {
      assert.deepEqual(titles, [], `${fixture.id} 应拒绝无关资料`);
      continue;
    }
    rankedCases += 1;
    for (const expectedTitle of fixture.expectedTitles) {
      relevantCount += 1;
      const rank = titles.indexOf(expectedTitle);
      if (rank >= 0 && rank < 5) recalledCount += 1;
    }
    const firstRank = Math.min(
      ...fixture.expectedTitles.map(title => titles.indexOf(title)).filter(rank => rank >= 0)
    );
    reciprocalRankTotal += Number.isFinite(firstRank) ? 1 / (firstRank + 1) : 0;
  }

  const recallAtFive = recalledCount / relevantCount;
  const meanReciprocalRank = reciprocalRankTotal / rankedCases;
  assert.ok(recallAtFive >= 0.9, `Recall@5=${recallAtFive}`);
  assert.ok(meanReciprocalRank >= 0.8, `MRR=${meanReciprocalRank}`);
});

test('检索严格隔离其他笔记本', async () => {
  const isolated = await db.createNotebook('隔离笔记本', '');
  const result = await retrievalService.retrieve({
    scopeType: 'notebook',
    scopeId: isolated.id,
    query: '极光X1保修多久',
    queryEmbedding: [1, 0, 0, 0]
  });
  assert.deepEqual(result.sources, []);
});

test('结构化来源编号稳定并包含诊断信息', async () => {
  const result = await retrievalService.retrieve({
    scopeType: 'notebook',
    scopeId: notebook.id,
    query: '双重验证恢复码',
    queryEmbedding: [0, 0, 1, 0]
  });
  assert.equal(result.sources[0].citationId, 1);
  assert.equal(result.sources[0].documentTitle, '账户安全规范');
  assert.equal(result.diagnostics.selectedChunks, result.sources.length);
});
