// Read-only MCP bridge. Shares the desktop's initialized database and vector store.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const packed = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });

async function startNotebookMcp({ db, vectorStore, retrievalService, userDataPath,
  env = process.env, port = 0, token = crypto.randomBytes(32).toString('hex') }) {
  if (env.NOTEBOOK_MCP_ENABLED !== '1') return null;
  if (typeof token !== 'string' || token.length < 32) throw new Error('MCP token is too short');
  const allowed = env.NOTEBOOK_MCP_NOTEBOOK_IDS
    ? new Set(env.NOTEBOOK_MCP_NOTEBOOK_IDS.split(',').map(value => Number(value.trim()))) : null;
  if (allowed && [...allowed].some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('NOTEBOOK_MCP_NOTEBOOK_IDS must contain positive integer IDs');
  }
  async function notebooks() {
    return (await db.getAllNotebooks()).filter(item => !allowed || allowed.has(Number(item.id)));
  }
  async function scopedDocuments(id) {
    if (!(await notebooks()).some(item => Number(item.id) === id)) throw new Error('笔记本不存在或未授权');
    return db.getDocumentsByNotebook(id);
  }
  function revision(documents) {
    const ids = new Set(documents.map(doc => Number(doc.id)));
    return crypto.createHash('sha256').update(JSON.stringify({
      documents: documents.map(doc => [doc.id, doc.title, doc.content, doc.index_status, doc.content_hash]),
      chunks: vectorStore.store.filter(chunk => ids.has(Number(chunk.metadata?.documentId)))
        .map(chunk => [chunk.id, chunk.metadata?.contentHash, chunk.metadata?.embeddingModel])
    })).digest('hex');
  }
  function protocolServer() {
    const mcp = new McpServer({ name: 'notebook-electron-rag', version: '1.0.0' });
    mcp.registerTool('notebook_list', {
      description: '列出当前桌面允许检索的笔记本；不返回文档正文。', inputSchema: {}, annotations
    }, async () => {
      const items = await notebooks();
      return packed({ notebooks: items.map(item => ({ id: Number(item.id), name: item.name })) });
    });
    mcp.registerTool('notebook_stats', {
      description: '读取所选笔记本的文档和索引统计。',
      inputSchema: { notebook_id: z.number().int().positive() }, annotations
    }, async ({ notebook_id }) => {
      const docs = await scopedDocuments(notebook_id);
      const ids = new Set(docs.map(doc => Number(doc.id)));
      return packed({ notebook_id, total_documents: docs.length,
        total_chunks: vectorStore.store.filter(chunk => ids.has(Number(chunk.metadata?.documentId))).length,
        ready_documents: docs.filter(doc => doc.index_status === 'ready').length,
        index_revision: revision(docs) });
    });
    mcp.registerTool('notebook_retrieve', {
      description: '在一个笔记本内检索原文片段和来源；不生成答案、不写入数据。',
      inputSchema: { query: z.string().trim().min(1).max(8000), notebook_id: z.number().int().positive(),
        top_k: z.number().int().min(1).max(20).default(5),
        token_budget: z.number().int().min(256).max(8000).default(6000) }, annotations
    }, async ({ query, notebook_id, top_k, token_budget }, extra) => {
      const docs = await scopedDocuments(notebook_id);
      const before = revision(docs);
      const found = await retrievalService.retrieve({ scopeType: 'notebook', scopeId: notebook_id,
        query, tokenBudget: token_budget, signal: extra.signal });
      if (revision(await scopedDocuments(notebook_id)) !== before) throw new Error('索引在检索期间发生变化，请重试');
      const sources = found.sources.slice(0, top_k);
      const ids = new Set(docs.map(doc => Number(doc.id)));
      if (sources.some(source => !ids.has(Number(source.documentId)))) throw new Error('检索结果范围校验失败');
      const results = sources.map(source => ({ id: source.chunkId, title: source.documentTitle,
        content: source.snippet, score: source.scores?.ranking ?? source.scores?.rrf ?? 0,
        citation_id: source.citationId, document_id: source.documentId, chunk_id: source.chunkId,
        scores: source.scores, notebook_id, index_revision: before }));
      return packed({ results, sources, diagnostics: { ...found.diagnostics, selectedChunks: sources.length },
        notebook_id, index_revision: before, provider: 'notebook_mcp' });
    });
    return mcp;
  }

  const active = new Set();
  const server = http.createServer(async (req, res) => {
    const address = server.address();
    if (!['127.0.0.1:' + address.port, 'localhost:' + address.port].includes(req.headers.host)
        || req.headers.origin) { res.writeHead(403).end(); return; }
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from('Bearer ' + token);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      res.writeHead(401).end(); return;
    }
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
    let mcp;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { res.writeHead(400).end(); return; }
      mcp = protocolServer();
      active.add(mcp);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.once('close', () => { active.delete(mcp); void mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(500).end();
      if (mcp) { active.delete(mcp); await mcp.close(); }
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const descriptorPath = userDataPath ? path.join(userDataPath, 'notebook-mcp.json') : null;
  try {
    if (descriptorPath) await fs.writeFile(descriptorPath, JSON.stringify({ endpoint, token }), { mode: 0o600 });
  } catch (error) { server.closeAllConnections(); server.close(); throw error; }
  return { endpoint, token, descriptorPath, async close() {
    try {
      if (descriptorPath) {
        const saved = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
        if (saved.token === token) await fs.unlink(descriptorPath);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    } finally {
      await Promise.allSettled([...active].map(mcp => mcp.close()));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  } };
}

module.exports = { startNotebookMcp };
