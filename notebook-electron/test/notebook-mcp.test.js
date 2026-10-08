const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { startNotebookMcp } = require('../notebook-mcp');

async function fixture(t, options = {}) {
  const docs = [{ id: 10, content: 'fixture', title: 'Fixture', index_status: 'ready', content_hash: 'hash' }];
  const calls = [];
  const db = { getAllNotebooks: async () => [{ id: 1, name: 'Public' }, { id: 2, name: 'Other' }],
    getDocumentsByNotebook: async () => docs };
  const vectorStore = { store: [{ id: 'chunk-10', metadata: { documentId: 10 } }] };
  const retrievalService = { retrieve: async args => {
    calls.push(args);
    if (options.changeIndex) docs[0].content = 'new content';
    return { sources: options.empty ? [] : [{ citationId: 1, documentId: options.wrongScope ? 99 : 10,
      documentTitle: 'Fixture', chunkId: 'chunk-10', snippet: 'source text', scores: { rrf: 0.1 } }],
      diagnostics: { warnings: ['test warning'], selectedChunks: options.empty ? 0 : 1 } };
  } };
  const service = await startNotebookMcp({ db, vectorStore, retrievalService,
    env: { NOTEBOOK_MCP_ENABLED: '1', NOTEBOOK_MCP_NOTEBOOK_IDS: '1' } });
  t.after(() => service.close());
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(service.endpoint), {
    requestInit: { headers: { Authorization: 'Bearer ' + service.token } }
  }));
  t.after(() => client.close());
  return { service, client, calls };
}

test('MCP 默认关闭；无配置不会开放端口', async () => {
  assert.equal(await startNotebookMcp({ env: {} }), null);
});

test('真实 MCP 列出只读工具、限定笔记本并保留检索来源', async t => {
  const { client, calls } = await fixture(t);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['notebook_list', 'notebook_retrieve', 'notebook_stats']);
  assert.ok(tools.tools.every(tool => tool.annotations.readOnlyHint));
  const books = await client.callTool({ name: 'notebook_list', arguments: {} });
  assert.deepEqual(books.structuredContent.notebooks, [{ id: 1, name: 'Public' }]);
  const result = await client.callTool({ name: 'notebook_retrieve', arguments: { notebook_id: 1, query: 'question' } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.results[0].chunk_id, 'chunk-10');
  assert.deepEqual(result.structuredContent.diagnostics.warnings, ['test warning']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scopeId, 1);
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test('越界笔记本和非法参数不执行检索', async t => {
  const { client, calls } = await fixture(t);
  for (const args of [{ notebook_id: 2, query: 'question' }, { notebook_id: 1, query: '' },
    { notebook_id: 1, query: 'question', top_k: 100 }]) {
    const result = await client.callTool({ name: 'notebook_retrieve', arguments: args });
    assert.equal(result.isError, true);
  }
  assert.equal(calls.length, 0);
});

test('空检索是正常无命中，不伪造降级资料', async t => {
  const { client } = await fixture(t, { empty: true });
  const result = await client.callTool({ name: 'notebook_retrieve', arguments: { notebook_id: 1, query: 'none' } });
  assert.deepEqual(result.structuredContent.results, []);
  assert.equal(result.isError, undefined);
});

for (const option of ['changeIndex', 'wrongScope']) {
  test(`检索期间索引变化或越界来源拒绝返回: ${option}`, async t => {
    const { client } = await fixture(t, { [option]: true });
    const result = await client.callTool({ name: 'notebook_retrieve', arguments: { notebook_id: 1, query: 'question' } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
  });
}

test('HTTP 拒绝无凭据和浏览器 Origin', async t => {
  const { service } = await fixture(t);
  assert.equal((await fetch(service.endpoint, { method: 'POST' })).status, 401);
  assert.equal((await fetch(service.endpoint, { method: 'POST', headers: {
    Authorization: 'Bearer ' + service.token, Origin: 'https://example.test'
  } })).status, 403);
});
