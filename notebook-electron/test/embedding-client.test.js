const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenAI } = require('openai');
const { requestEmbeddings, validateEmbeddings, invalidateCorruptIndexes } = require('../embedding-client');
test('真实SDK默认误解码float响应，显式float保留原向量', async () => {
  const formats = [];
  const vector = Array(2048).fill(0.01);
  const client = new OpenAI({ apiKey: 'offline-test', baseURL: 'https://invalid.example/v1', fetch: async (_, options) => {
    formats.push(JSON.parse(options.body).encoding_format);
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: vector }] }), { headers: { 'content-type': 'application/json' } });
  } });
  const original = await client.embeddings.create({ model: 'embedding-3', input: 'test' });
  assert.equal(original.data[0].embedding.length, 512);
  assert.ok(original.data[0].embedding.every(x => x === 0));
  const fixed = await requestEmbeddings(client, {}, 'test');
  assert.deepEqual(fixed[0], vector);
  assert.deepEqual(formats, ['base64', 'float']);
});
test('批量请求同样显式float且按index排序', async () => {
  const client = { embeddings: { create: async body => {
    assert.equal(body.encoding_format, 'float');
    assert.deepEqual(body.input, ['a','b']);
    return { data: [{ index: 1, embedding: [0,1] }, { index: 0, embedding: [1,0] }] };
  } } };
  assert.deepEqual(await requestEmbeddings(client, {}, ['a','b']), [[1,0],[0,1]]);
});
test('拒绝全零、NaN、错误类型、数量、索引及混合维度', () => {
  for (const data of [[], [{index:0,embedding:[0,0]}], [{index:0,embedding:[NaN]}], [{index:0,embedding:'abc'}], [{index:1,embedding:[1]}]]) {
    assert.throws(() => validateEmbeddings({data}, 1));
  }
  assert.throws(() => validateEmbeddings({data:[{index:0,embedding:[1]},{index:1,embedding:[1,2]}]},2));
});

test('启动检查只标记损坏索引且按文档去重，不删除分块', async () => {
  const chunks = [
    { embedding: [0, 0], metadata: { documentId: 1 } },
    { embedding: [], metadata: { documentId: 1 } },
    { embedding: [1, 0], metadata: { documentId: 2 } },
    { embedding: [Infinity], metadata: { documentId: 3 } }
  ];
  const original = structuredClone(chunks);
  const stale = [];
  await invalidateCorruptIndexes(chunks, async id => stale.push(id));
  assert.deepEqual(stale, [1, 3]);
  assert.deepEqual(chunks, original);
});
