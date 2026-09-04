const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const configService = require('../config-service');
const db = require('../database');
const graphService = require('../graph-service');

test('真实 DeepSeek 可生成带原文证据的概念图', {
  skip: process.env.RUN_ONLINE_GRAPH_TESTS !== '1',
  timeout: 180_000
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-graph-online-'));
  const requestId = `graph-online-${Date.now()}`;
  t.after(async () => {
    graphService.abort(requestId);
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const status = configService.init({ userDataPath: directory, isPackaged: false });
  assert.equal(status.deepseekReady, true, `请在 ${status.configPath} 配置 DeepSeek`);
  await db.init(':memory:');
  const notebook = await db.createNotebook('在线图谱验收', '');
  const documents = await Promise.all([
    db.createDocument(notebook.id, '公司与产品', '星桥公司创建了极光终端。'),
    db.createDocument(notebook.id, '产品与技术', '极光终端使用磷酸铁锂电池技术。'),
    db.createDocument(notebook.id, '分析方法', '星桥公司使用 Graph Lite 方法分析极光终端。')
  ]);
  let resolveRun;
  let rejectRun;
  const finished = new Promise((resolve, reject) => { resolveRun = resolve; rejectRun = reject; });
  const sender = {
    isDestroyed: () => false,
    send: (_channel, event) => {
      if (event.requestId !== requestId) return;
      if (event.type === 'completed') resolveRun();
      if (event.type === 'error' || event.type === 'aborted') rejectRun(new Error(event.data.message));
    }
  };
  await graphService.build(sender, { requestId, notebookId: notebook.id });
  await finished;
  const graph = await db.getGraph(notebook.id);
  assert.ok(graph.entities.length >= 2);
  assert.ok(graph.relations.length >= 1);
  assert.ok(graph.evidence.every(item => item.evidence_text.length > 0));
  assert.ok(graph.evidence.every(item => {
    const document = documents.find(candidate => candidate.id === item.document_id);
    return document && document.content.slice(item.start_char, item.end_char) === item.evidence_text;
  }));
  assert.deepEqual(
    [...new Set(graph.evidence.map(item => item.document_id))].sort((a, b) => a - b),
    documents.map(document => document.id).sort((a, b) => a - b)
  );
});
