const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');

test.before(async () => {
  // SQLite 的 :memory: 数据库只存在于当前测试进程，不会生成或修改真实 notebook.db。
  await db.init(':memory:');
});

test.after(async () => {
  await db.close();
});

test('笔记本和文档可以创建、查询、修改', async () => {
  const notebook = await db.createNotebook('测试笔记本', '测试描述');
  const document = await db.createDocument(notebook.id, '资料.txt', '正文');

  assert.equal((await db.getAllNotebooks()).some(item => item.id === notebook.id), true);
  assert.equal((await db.getDocumentsByNotebook(notebook.id))[0].id, document.id);

  const renamed = await db.updateNotebook(notebook.id, '新名称', '新描述');
  const summarized = await db.updateDocumentSummary(document.id, '自动摘要');
  const indexed = await db.updateDocumentChunkCount(document.id, 3);

  assert.equal(renamed.name, '新名称');
  assert.equal(summarized.summary, '自动摘要');
  assert.equal(indexed.chunk_count, 3);
});

test('删除文档会级联删除该文档的聊天记录', async () => {
  const notebook = await db.createNotebook('文档级联测试', '');
  const document = await db.createDocument(notebook.id, '待删除.txt', '正文');
  const sessionId = `doc:${document.id}`;
  await db.saveChatMessage(sessionId, 'user', '问题', document.id, null);
  await db.saveChatMessage(sessionId, 'assistant', '回答', document.id, null);

  assert.equal((await db.getChatHistory(sessionId)).length, 2);
  assert.equal(await db.deleteDocument(document.id), true);
  assert.equal((await db.getChatHistory(sessionId)).length, 0);
});

test('删除笔记本会级联删除所属文档和笔记本聊天记录', async () => {
  const notebook = await db.createNotebook('笔记本级联测试', '');
  const document = await db.createDocument(notebook.id, '资料.txt', '正文');
  const sessionId = `notebook:${notebook.id}`;
  await db.saveChatMessage(sessionId, 'user', '问题', null, notebook.id);

  assert.equal(await db.deleteNotebook(notebook.id), true);
  assert.equal(await db.getDocumentById(document.id), undefined);
  assert.equal((await db.getChatHistory(sessionId)).length, 0);
});

test('聊天历史按时间顺序返回，并且不同会话互相隔离', async () => {
  const sessionA = `session-a-${Date.now()}`;
  const sessionB = `session-b-${Date.now()}`;
  await db.saveChatMessage(sessionA, 'user', '第一条');
  await db.saveChatMessage(sessionA, 'assistant', '第二条');
  await db.saveChatMessage(sessionB, 'user', '另一个会话');

  assert.deepEqual((await db.getChatHistory(sessionA)).map(item => item.content), ['第一条', '第二条']);
  assert.deepEqual((await db.getChatHistory(sessionB)).map(item => item.content), ['另一个会话']);
});

test('对话历史超过最大轮数时只删除最早消息', async () => {
  const sessionId = `truncate-${Date.now()}`;
  for (let i = 1; i <= 6; i += 1) {
    await db.saveChatMessage(sessionId, i % 2 ? 'user' : 'assistant', `消息${i}`);
  }

  await db.truncateHistory(sessionId, 2);

  assert.deepEqual((await db.getChatHistory(sessionId)).map(item => item.content), [
    '消息3', '消息4', '消息5', '消息6'
  ]);
});

