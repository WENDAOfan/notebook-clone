const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const graphService = require('../graph-service');

let notebook;
let source;

function senderFor(events) {
  return {
    isDestroyed: () => false,
    send: (_channel, event) => events.push(event)
  };
}

async function waitForRun(requestId, timeoutMs = 2_000) {
  const started = Date.now();
  while (graphService.pendingRuns.has(requestId)) {
    if (Date.now() - started > timeoutMs) throw new Error(`等待图谱任务超时：${requestId}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function validModel() {
  return async ({ batch }) => {
    const chunk = batch[0];
    return {
      choices: [{ message: { content: JSON.stringify({
        entities: [
          {
            name: 'Alpha',
            type: 'concept',
            confidence: 0.95,
            aliases: ['A'],
            description: '测试概念',
            evidence: [{ documentId: chunk.documentId, chunkIndex: chunk.chunkIndex, quote: 'Alpha' }]
          },
          {
            name: 'Beta',
            type: 'technology',
            confidence: 0.95,
            aliases: [],
            description: '测试技术',
            evidence: [{ documentId: chunk.documentId, chunkIndex: chunk.chunkIndex, quote: 'Beta' }]
          }
        ],
        relations: [{
          source: 'Alpha',
          sourceType: 'concept',
          target: 'Beta',
          targetType: 'technology',
          type: 'uses',
          confidence: 0.9,
          evidence: [{ documentId: chunk.documentId, chunkIndex: chunk.chunkIndex, quote: 'Alpha uses Beta' }]
        }]
      }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    };
  };
}

test.before(async () => {
  await db.init(':memory:');
  notebook = await db.createNotebook('Graph 测试笔记本', '');
  source = await db.createDocument(notebook.id, '测试资料', 'Alpha uses Beta. 这是用于概念图测试的原文。');
});

test.after(async () => {
  graphService.configure({ modelClient: null, splitter: null });
  await db.close();
});

test('Graph Lite 估算复用 RAG 分块并返回处理上限', async () => {
  const estimate = await graphService.estimate(notebook.id);
  assert.equal(estimate.documentCount, 1);
  assert.ok(estimate.chunkCount >= 1);
  assert.equal(estimate.estimatedBatches, 1);
  assert.equal(estimate.withinLimits, true);
  assert.equal(estimate.limits.maxDocuments, 100);
});

test('抽取批次不会跨越文档边界', () => {
  const batches = graphService.makeBatches([
    { documentId: 1, chunkIndex: 0, tokenCount: 10 },
    { documentId: 2, chunkIndex: 0, tokenCount: 10 }
  ]);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.map(batch => batch[0].documentId), [1, 2]);
});

test('特殊空行及 Unicode 原文分块可完整回映，不静默漏掉正文', () => {
  const content = ('第一段 Alpha。\n\n\n\n第二段 Beta 🌍。\n\n').repeat(150);
  const chunks = graphService.chunkDocuments([{ id: 991, title: '空行测试', content }]);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => content.slice(chunk.startChar, chunk.endChar) === chunk.text));
  assert.ok(chunks.every(chunk => chunk.tokenCount <= 512));
  assert.equal(chunks[0].startChar, 0);
  assert.equal(chunks.at(-1).endChar, content.length);
  assert.equal(chunks.map(chunk => chunk.text).join(''), content);
});

test('伪模型成功构建实体、关系和可跳转证据', async () => {
  graphService.configure({ modelClient: validModel() });
  const events = [];
  const result = await graphService.build(senderFor(events), {
    requestId: 'graph-success',
    notebookId: notebook.id
  });
  await waitForRun(result.requestId);

  const graph = await graphService.getGraph(notebook.id);
  assert.equal(graph.build.status, 'ready');
  assert.equal(graph.entities.length, 2);
  assert.equal(graph.relations.length, 1);
  assert.equal(graph.evidence.length, 3);
  assert.ok(graph.evidence.every(item => item.document_id === source.id));
  assert.ok(graph.evidence.every(item => item.end_char > item.start_char));
  assert.ok(events.some(event => event.type === 'progress'));
  assert.ok(events.some(event => event.type === 'completed'));
  assert.ok(events.every(event => event.requestId === 'graph-success'));
  assert.deepEqual(events.at(-1).type, 'completed');
});

test('无效 JSON 只纠正一次，第二次仍无效则失败且不破坏旧图谱', async () => {
  let calls = 0;
  graphService.configure({ modelClient: async () => {
    calls += 1;
    return calls === 1 ? { content: '{invalid' } : validModel()({ batch: [{ documentId: source.id, chunkIndex: 0 }] });
  } });
  const first = await graphService.build(senderFor([]), { requestId: 'graph-correction', notebookId: notebook.id });
  await waitForRun(first.requestId);
  assert.equal(calls, 2);
  assert.equal((await graphService.getGraph(notebook.id)).build.status, 'ready');

  graphService.configure({ modelClient: async () => ({ content: 'not-json' }) });
  const failed = await graphService.build(senderFor([]), { requestId: 'graph-failed', notebookId: notebook.id });
  await waitForRun(failed.requestId);
  const graph = await graphService.getGraph(notebook.id);
  assert.equal(graph.build.status, 'failed');
  assert.equal(graph.dataBuild.status, 'ready');
  assert.equal(graph.entities.length, 2);
  assert.match(graph.build.error, /结构化抽取结果无效/);
});

test('非法类型、无证据和低置信度关系会被丢弃', async () => {
  graphService.configure({ modelClient: async ({ batch }) => ({ content: JSON.stringify({
    entities: [
      { name: '保留概念', type: 'concept', confidence: 0.9, evidence: [{ documentId: batch[0].documentId, chunkIndex: batch[0].chunkIndex, quote: 'Alpha' }] },
      { name: '低置信度实体', type: 'concept', confidence: 0.4, evidence: [{ documentId: batch[0].documentId, chunkIndex: batch[0].chunkIndex, quote: 'Beta' }] },
      { name: '非法类型', type: 'made_up', confidence: 0.9, evidence: [{ documentId: batch[0].documentId, chunkIndex: batch[0].chunkIndex, quote: 'Alpha' }] },
      { name: '无证据', type: 'concept', confidence: 0.9, evidence: [{ documentId: batch[0].documentId, chunkIndex: batch[0].chunkIndex, quote: '不存在' }] }
    ],
    relations: [
      { source: '保留概念', sourceType: 'concept', target: '保留概念', targetType: 'concept', type: 'uses', confidence: 0.99, evidence: [{ documentId: batch[0].documentId, chunkIndex: batch[0].chunkIndex, quote: 'Alpha' }] },
      { source: '保留概念', sourceType: 'concept', target: '保留概念', targetType: 'concept', type: 'uses', confidence: 0.4, evidence: [{ documentId: batch[0].documentId, chunkIndex: batch[0].chunkIndex, quote: 'Alpha' }] }
    ]
  }) }) });
  const result = await graphService.build(senderFor([]), { requestId: 'graph-filter', notebookId: notebook.id });
  await waitForRun(result.requestId);
  const graph = await graphService.getGraph(notebook.id);
  assert.equal(graph.build.status, 'ready');
  assert.equal(graph.entities.length, 1);
  assert.equal(graph.relations.length, 0);
});

test('同名不同类型实体按关系端点类型精确连接', async () => {
  graphService.configure({ modelClient: async ({ batch }) => ({ content: JSON.stringify({
    entities: [
      { name: '星桥', type: 'organization', confidence: 0.9, evidence: [{ documentId: batch[0].documentId, chunkIndex: batch[0].chunkIndex, quote: 'Alpha' }] },
      { name: '星桥', type: 'product', confidence: 0.9, evidence: [{ documentId: batch[0].documentId, chunkIndex: batch[0].chunkIndex, quote: 'Beta' }] },
      { name: 'Beta', type: 'technology', confidence: 0.9, evidence: [{ documentId: batch[0].documentId, chunkIndex: batch[0].chunkIndex, quote: 'Beta' }] }
    ],
    relations: [{
      source: '星桥', sourceType: 'product', target: 'Beta', targetType: 'technology',
      type: 'uses', confidence: 0.9,
      evidence: [{ documentId: batch[0].documentId, chunkIndex: batch[0].chunkIndex, quote: 'Alpha uses Beta' }]
    }]
  }) }) });
  const result = await graphService.build(senderFor([]), { requestId: 'graph-typed-endpoints', notebookId: notebook.id });
  await waitForRun(result.requestId);
  const graph = await graphService.getGraph(notebook.id);
  const product = graph.entities.find(item => item.canonical_name === '星桥' && item.entity_type === 'product');
  const organization = graph.entities.find(item => item.canonical_name === '星桥' && item.entity_type === 'organization');
  assert.ok(product);
  assert.ok(organization);
  assert.equal(graph.relations[0].source_entity_id, product.id);
  assert.notEqual(graph.relations[0].source_entity_id, organization.id);
});

test('数据库拒绝把其他笔记本的文档写成图谱证据', async () => {
  const otherNotebook = await db.createNotebook('隔离图谱', '');
  const foreignDocument = await db.createDocument(otherNotebook.id, '外部资料', 'foreign evidence');
  const build = await db.createGraphBuild({ notebookId: notebook.id, status: 'building' });
  await assert.rejects(() => db.replaceGraph({
    notebookId: notebook.id,
    buildId: build.id,
    entities: [{ key: 'concept:test', canonicalName: 'Test', entityType: 'concept', aliases: [], mentionCount: 1 }],
    relations: [],
    evidence: [{
      entityKey: 'concept:test', relationKey: null, documentId: foreignDocument.id,
      chunkIndex: 0, startChar: 0, endChar: 7, evidenceText: 'foreign'
    }]
  }), /不属于当前笔记本/);
});

test('中止构建后状态为 interrupted，并保留之前的图谱数据', async () => {
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  graphService.configure({ modelClient: async ({ signal }) => {
    startedResolve();
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  } });
  const events = [];
  const result = await graphService.build(senderFor(events), { requestId: 'graph-abort', notebookId: notebook.id });
  await started;
  assert.equal(graphService.abort(result.requestId), true);
  await waitForRun(result.requestId);
  const graph = await graphService.getGraph(notebook.id);
  assert.equal(graph.build.status, 'interrupted');
  assert.ok(events.some(event => event.type === 'aborted'));
  assert.ok(graph.dataBuild === null || graph.dataBuild.status === 'ready' || graph.dataBuild.status === 'stale');
});

test('同一笔记本不允许并发构建，其他笔记本仍可隔离构建', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  graphService.configure({ modelClient: async ({ signal, batch }) => {
    await Promise.race([gate, new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })), { once: true }))]);
    return validModel()({ batch });
  } });
  const first = await graphService.build(senderFor([]), { requestId: 'graph-concurrent-1', notebookId: notebook.id });
  await assert.rejects(() => graphService.build(senderFor([]), { requestId: 'graph-concurrent-2', notebookId: notebook.id }), /已有图谱任务/);
  const other = await db.createNotebook('另一个并发笔记本', '');
  await db.createDocument(other.id, '并发来源', 'Alpha uses Beta');
  const otherEvents = [];
  const second = await graphService.build(senderFor(otherEvents), { requestId: 'graph-other-notebook', notebookId: other.id });
  release();
  await waitForRun(first.requestId);
  await waitForRun(second.requestId);
  assert.equal((await graphService.getGraph(notebook.id)).build.status, 'ready');
  assert.equal((await graphService.getGraph(other.id)).build.status, 'ready');
  assert.ok(otherEvents.every(event => event.requestId === second.requestId));
});

test('显式别名合并保留新名称，关系可以通过新名称定位实体', async () => {
  const aliasBook = await db.createNotebook('别名测试', '');
  await db.createDocument(aliasBook.id, '别名来源', 'Alpha A Beta');
  graphService.configure({ modelClient: async ({ batch }) => {
    const evidence = [{ documentId: batch[0].documentId, chunkIndex: 0, quote: 'Alpha A Beta' }];
    return { content: JSON.stringify({
      entities: [
        { name: 'Alpha', type: 'concept', confidence: 0.9, evidence },
        { name: 'Ａ', aliases: ['Alpha'], type: 'concept', confidence: 0.9, evidence },
        { name: 'Beta', type: 'technology', confidence: 0.9, evidence }
      ],
      relations: [{ source: 'a', sourceType: 'concept', target: 'Beta', targetType: 'technology',
        type: 'uses', confidence: 0.9, evidence }]
    }) };
  } });
  const result = await graphService.build(senderFor([]), { requestId: 'graph-alias', notebookId: aliasBook.id });
  await waitForRun(result.requestId);
  const graph = await graphService.getGraph(aliasBook.id);
  assert.equal(graph.entities.length, 2);
  assert.equal(graph.relations.length, 1);
  assert.ok(graph.entities.find(entity => entity.canonical_name === 'Alpha').aliases.includes('A'));
});
