const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const rag = require('../rag-service');
const retrieval = require('../retrieval-service');
let notebook;
test.before(async () => { await db.init(':memory:'); notebook = await db.createNotebook('测试', ''); });
test.after(async () => { rag.configureAskClient(null); await db.close(); });

async function run(responses, type = 'notebook', id = notebook.id) {
  const events = [];
  const requests = [];
  rag.configureAskClient(() => ({ provider: { model: 'fake' }, client: { chat: { completions: {
    create: async options => {
      requests.push(structuredClone(options));
      const delta = responses[requests.length - 1] || {};
      return (async function* () { yield { choices: [{ delta }] }; })();
    }
  } } } }));
  await rag.handleAskStream({ sender: { isDestroyed: () => false, send: (channel, data) => events.push({ channel, ...data }) } },
    { id, type, question: '测试问题', useDocContext: true });
  return { events, requests };
}
const call = (name = 'search_knowledge_base', args = '{"query":"测试"}') => ({ tool_calls: [{ index: 0, id: 'call', function: { name, arguments: args } }] });

test('第三次检索后有禁用工具的最终回答，未就绪资料不回退正文', async () => {
  const doc = await db.createDocument(notebook.id, '未索引', '绝不能回退到这个秘密正文');
  retrieval.configure({ getEmbedding: null, getEmbeddingModel: () => 'embedding-3' });
  const { requests, events } = await run([call(), call(), call(), { content: '根据文档内容，无法找到相关答案。' }], 'doc', doc.id);
  assert.equal(requests.length, 4);
  assert.equal(requests[3].tools, undefined);
  assert.ok(!JSON.stringify(requests).includes('秘密正文'));
  assert.equal(events.filter(e => e.channel === 'chat:end').length, 1);
  assert.equal(events.filter(e => e.channel === 'chat:error').length, 0);
});
test('无效工具名称和参数都有配对结果', async () => {
  for (const invocation of [call('invalid'), call('search_knowledge_base', '{}')]) {
    const { requests } = await run([invocation, { content: '无法回答' }]);
    assert.equal(requests[1].messages.at(-1).role, 'tool');
    assert.match(requests[1].messages.at(-1).content, /参数无效/);
  }
});
test('空回答报错且不以成功结束', async () => {
  const { events } = await run([{}]);
  assert.equal(events.filter(e => e.channel === 'chat:error').length, 1);
  assert.equal(events.filter(e => e.channel === 'chat:end').length, 0);
});
test('未知引用记录诊断，不生成来源', async () => {
  const { events } = await run([{ content: '结论[99]' }]);
  const source = events.find(e => e.channel === 'chat:sources');
  assert.deepEqual(source.sources, []);
  assert.match(source.diagnostics.warnings.join(''), /引用校验未通过/);
});
test('首块也必须遵守包装后的 token 预算', () => {
  assert.deepEqual(retrieval.selectWithinBudget([{ text: '很长的文本'.repeat(100), metadata: { documentId: 1 } }], { tokenBudget: 10, maxPerDocument: 3 }), []);
});
test('取消等待中的模型请求只发送一次结束', async () => {
  const events = [];
  const requestId = 'abort-test';
  rag.configureAskClient(() => ({ provider: {}, client: { chat: { completions: {
    create: async () => { setImmediate(() => rag.abortActiveAsk(requestId)); return new Promise(() => {}); }
  } } } }));
  await rag.handleAskStream({ sender: { isDestroyed: () => false, send: channel => events.push(channel) } },
    { requestId, id: notebook.id, type: 'notebook', question: '你好', useDocContext: false });
  assert.equal(events.filter(channel => channel === 'chat:end').length, 1);
  assert.ok(!events.includes('chat:error'));
});
test('六次检索预算且重复片段只加入一次', async () => {
  const original = retrieval.retrieve;
  let calls = 0;
  retrieval.retrieve = async () => { calls++; return { chunks: [{ id: 'one', text: '证据', metadata: { documentId: 1, documentTitle: '测试' } }], diagnostics: { warnings: [] } }; };
  try {
    const multi = { tool_calls: Array.from({ length: 3 }, (_, index) => ({ ...call().tool_calls[0], index, id: `call-${index}` })) };
    const { events } = await run([multi, multi, multi, { content: '结果[1]' }]);
    assert.equal(calls, 6);
    const sources = events.filter(e => e.channel === 'chat:sources').at(-1);
    assert.equal(sources.sources.length, 1);
    assert.ok(sources.diagnostics.evidenceTokens < 8000);
  } finally { retrieval.retrieve = original; }
});
test('180秒超时明确报错且不会保存成功', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  rag.configureAskClient(() => ({ provider: {}, client: { chat: { completions: {
    create: async () => { t.mock.timers.tick(180000); return new Promise(() => {}); }
  } } } }));
  await rag.handleAskStream({ sender: { isDestroyed: () => false, send: (channel, data) => events.push({ channel, ...data }) } },
    { id: notebook.id, type: 'notebook', question: '你好', useDocContext: false });
  assert.equal(events.filter(e => e.channel === 'chat:error').length, 1);
  assert.match(events[0].message, /180/);
  t.mock.timers.reset();
});
