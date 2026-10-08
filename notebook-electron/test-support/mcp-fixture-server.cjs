// Explicitly launched cross-language fixture, outside Node's automatic test discovery.
// Real SQLite and retrieval, synthetic vectors, no provider calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../database');
const vectors = require('../vector-store');
const retrieval = require('../retrieval-service');
const { startNotebookMcp } = require('../notebook-mcp');

console.log = () => {};
(async () => {
  const directory = process.argv[2];
  fs.mkdirSync(directory, { recursive: true });
  await db.init(':memory:');
  vectors.init(path.join(directory, 'vectors.json'));
  retrieval.configure({ getEmbedding: async () => [1, 0], getEmbeddingModel: () => 'fixture',
    thresholds: { ...retrieval.DEFAULT_POLICY, rerank: false } });
  const book = await db.createNotebook('MCP fixture', 'synthetic');
  const other = await db.createNotebook('Other fixture', 'synthetic');
  for (const notebook of [book, other]) {
    const text = notebook.id === book.id ? 'Redis 缓存穿透可以使用布隆过滤器处理。' : '其他笔记本的隔离资料。';
    const doc = await db.createDocument(notebook.id, 'Test document', text);
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    await db.updateDocumentIndexStatus(doc.id, 'ready', { contentHash: hash });
    await vectors.add([{ id: `doc:${doc.id}:fixture:0`, text, embedding: [1, 0],
      metadata: { documentId: doc.id, documentTitle: doc.title, chunkIndex: 0,
        embeddingModel: 'fixture', contentHash: hash } }]);
  }
  const service = await startNotebookMcp({ db, vectorStore: vectors, retrievalService: retrieval,
    userDataPath: directory, env: { NOTEBOOK_MCP_ENABLED: '1', NOTEBOOK_MCP_NOTEBOOK_IDS: String(book.id) } });
  process.stdout.write(JSON.stringify({ ready: true, notebook_id: book.id, other_id: other.id }) + '\n');
  process.stdin.resume();
  process.stdin.once('data', async () => { await service.close(); await db.close(); process.exit(0); });
})().catch(error => { console.error(error); process.exit(1); });
