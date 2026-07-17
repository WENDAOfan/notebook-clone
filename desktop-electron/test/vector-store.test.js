const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SimpleVectorStore, cosineSimilarity } = require('../vector-store');

function createTempStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-vector-test-'));
  const filePath = path.join(directory, 'vectors.json');
  const store = new SimpleVectorStore();
  store.init(filePath);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { store, filePath };
}

test('向量新增、同 ID 更新并持久化到 JSON', async t => {
  const { store, filePath } = createTempStore(t);

  await store.add([{ id: 'doc:1:chunk:0', text: '旧内容', metadata: { documentId: 1 }, embedding: [1, 0] }]);
  await store.add([{ id: 'doc:1:chunk:0', text: '新内容', metadata: { documentId: 1 }, embedding: [0, 1] }]);

  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].text, '新内容');
  assert.deepEqual(saved[0].embedding, [0, 1]);
});

test('相似度检索按分数排序，并支持按 metadata 隔离文档', async t => {
  const { store } = createTempStore(t);
  await store.add([
    { id: 'a', text: 'A', metadata: { documentId: 1 }, embedding: [1, 0] },
    { id: 'b', text: 'B', metadata: { documentId: 2 }, embedding: [0.8, 0.2] },
    { id: 'c', text: 'C', metadata: { documentId: 1 }, embedding: [0, 1] }
  ]);

  assert.deepEqual(store.similaritySearch([1, 0], 3).map(item => item.id), ['a', 'b', 'c']);
  assert.deepEqual(
    store.similaritySearch([1, 0], 3, metadata => metadata.documentId === 1).map(item => item.id),
    ['a', 'c']
  );
});

test('关键词检索统计中英文命中，并排除其他文档', async t => {
  const { store } = createTempStore(t);
  await store.add([
    { id: 'a', text: 'Spring 自动化测试 Spring', metadata: { documentId: 1 }, embedding: [1] },
    { id: 'b', text: 'Electron testing guide', metadata: { documentId: 2 }, embedding: [1] }
  ]);

  assert.deepEqual(store.keywordSearch(['spring'], 5).map(item => item.id), ['a']);
  assert.deepEqual(
    store.keywordSearch(['testing'], 5, metadata => metadata.documentId === 1),
    []
  );
});

test('按块 ID 和文档 ID 删除后，重新载入仍保持删除结果', async t => {
  const { store, filePath } = createTempStore(t);
  await store.add([
    { id: 'doc:1:chunk:0', text: 'A', metadata: { documentId: 1 }, embedding: [1] },
    { id: 'doc:1:chunk:1', text: 'B', metadata: { documentId: 1 }, embedding: [1] },
    { id: 'doc:2:chunk:0', text: 'C', metadata: { documentId: 2 }, embedding: [1] }
  ]);

  await store.delete(['doc:1:chunk:0']);
  await store.deleteByDocumentId(2);

  const reloaded = new SimpleVectorStore();
  reloaded.init(filePath);
  assert.deepEqual(reloaded.store.map(item => item.id), ['doc:1:chunk:1']);
});

test('余弦相似度对正交、零向量和维度不匹配安全返回', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
  assert.equal(cosineSimilarity([1], [1, 0]), 0);
});

