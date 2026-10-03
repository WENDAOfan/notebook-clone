const test = require('node:test');
const assert = require('node:assert/strict');
const { rerank, applyScores, groupedScores, summarizeUsage, configureClient } = require('../retrieval-reranker');
const { DEFAULT_POLICY } = require('../retrieval-service');
const candidates = Array.from({ length: 18 }, (_, id) => ({ id: `chunk-${id}`, text: `原文${id}`,
  metadata: { documentId: 1, documentTitle: '虚构资料' } }));
const inject = create => configureClient(() => ({ provider: { model: 'offline-fake' },
  client: { chat: { completions: { create } } } }));
test.afterEach(() => configureClient(null));

test('重排默认关闭；离线注入验证16块上限、原文完整与尾部保留', async () => {
  assert.equal(DEFAULT_POLICY.rerank, false);
  let sent;
  inject(async (request, options) => {
    sent = JSON.parse(request.messages[1].content);
    assert.ok(options.signal);
    assert.equal(request.max_tokens, 256);
    return { choices: [{ message: { content: JSON.stringify({ '3': [4], '2': [], '1': [],
      '0': sent.candidates.filter(c => c.id !== 4).map(c => c.id) }) } }], usage: { total_tokens: 100 } };
  });
  const before = structuredClone(candidates);
  const result = await rerank(candidates, '问题');
  assert.equal(sent.candidates.length, 16);
  assert.equal(result.ranked.length, 18);
  assert.equal(result.ranked[0].id, 'chunk-4');
  assert.deepEqual(result.ranked.slice(16), candidates.slice(16));
  assert.deepEqual(candidates, before);
  assert.equal(result.diagnostics.usage.total_tokens, 100);
});

test('未知编号、重复编号、非整数分数和缺项都拒绝', () => {
  for (const scores of [[{ id: 0, score: 3 }], [{ id: 0, score: 3 }, { id: 0, score: 2 }],
    [{ id: 0, score: 3 }, { id: 99, score: 2 }], [{ id: 0, score: 3 }, { id: 1, score: .5 }]]) {
    assert.throws(() => applyScores(candidates.slice(0, 2), scores));
  }
});

test('紧凑分组保留分数和同分次序，缺组、额外组及跨组重复拒绝', () => {
  const groups = { '3': [2, 0], '2': [1], '1': [], '0': [] };
  assert.deepEqual(applyScores(candidates.slice(0, 3), groupedScores(groups)).map(c => c.id),
    ['chunk-2', 'chunk-0', 'chunk-1']);
  for (const bad of [null, [], { ...groups, '4': [] }, { '3': [0] }, { ...groups, '0': 'wrong' }]) {
    assert.throws(() => groupedScores(bad));
  }
  assert.throws(() => applyScores(candidates.slice(0, 3), groupedScores({ ...groups, '2': [0] })));
  assert.throws(() => applyScores(candidates.slice(0, 3), groupedScores({ ...groups, '2': [99] })));
});

test('模型失败或畸形JSON原序回退，不伪造用量', async () => {
  for (const create of [async () => { throw new Error('离线失败'); },
    async () => ({ choices: [{ message: { content: 'not-json' } }] })]) {
    inject(create);
    const result = await rerank(candidates, '问题');
    assert.equal(result.diagnostics.status, 'fallback');
    assert.equal(result.diagnostics.usage, null);
    assert.strictEqual(result.ranked, candidates);
  }
});

test('不响应的客户端超时回退，用户中止则向上抛出', async () => {
  inject(() => new Promise(() => {}));
  const result = await rerank(candidates, '问题', { timeoutMs: 10 });
  assert.equal(result.diagnostics.status, 'fallback');
  assert.equal(result.diagnostics.reason, '排序超时');
  const controller = new AbortController();
  const pending = rerank(candidates, '问题', { signal: controller.signal });
  controller.abort(new Error('用户停止'));
  await assert.rejects(pending, /用户停止/);
  await assert.rejects(rerank(candidates, '问题', { signal: controller.signal }), /用户停止/);
});

test('不足两块不调用模型', async () => {
  inject(() => { throw new Error('不应调用'); });
  assert.equal((await rerank(candidates.slice(0, 1), '问题')).diagnostics.status, 'skipped');
});

test('用量只汇总供应商确实返回的数据，失败未知不冒充免费', () => {
  assert.deepEqual(summarizeUsage([{ reranker: { status: 'applied', usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } } },
    { reranker: { status: 'fallback', usage: null } }, { reranker: { status: 'skipped' } }]),
  { calls: 2, knownCalls: 1, unknownCalls: 1, prompt: 50, completion: 10, total: 60 });
});
