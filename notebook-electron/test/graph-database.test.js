const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const db = require('../database');

function hashDocuments(documents) {
  const crypto = require('node:crypto');
  const hash = crypto.createHash('sha256');
  for (const document of [...documents].sort((a, b) => Number(a.id) - Number(b.id))) {
    hash.update(`${document.id}\0${document.content || ''}\0${document.title || ''}\n`);
  }
  return hash.digest('hex');
}

function seedUserVersion(filePath, version) {
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(filePath, error => {
      if (error) {
        reject(error);
        return;
      }
      connection.run(`PRAGMA user_version = ${Number(version)}`, runError => {
        if (runError) {
          connection.close(() => reject(runError));
          return;
        }
        connection.close(closeError => closeError ? reject(closeError) : resolve());
      });
    });
  });
}

async function createGraph(notebookId, documentId) {
  const build = await db.createGraphBuild({ notebookId, status: 'building' });
  await db.replaceGraph({
    notebookId, buildId: build.id,
    entities: [{ key: 'concept:alpha', canonicalName: 'Alpha', entityType: 'concept', aliases: [], mentionCount: 1 }],
    relations: [],
    evidence: [{ entityKey: 'concept:alpha', documentId, chunkIndex: 0, startChar: 0, endChar: 5, evidenceText: 'Alpha' }]
  });
  return build;
}

test('图谱随文档变化标记 stale，删除证据后清理孤立实体', async t => {
  await db.init(':memory:');
  t.after(() => db.close());
  const notebook = await db.createNotebook('图谱生命周期', '');
  const doc = await db.createDocument(notebook.id, '来源', 'Alpha');
  await createGraph(notebook.id, doc.id);
  await db.createDocument(notebook.id, '新来源', 'Beta');
  assert.equal((await db.getGraph(notebook.id)).dataBuild.status, 'stale');
  await db.deleteDocument(doc.id);
  const graph = await db.getGraph(notebook.id);
  assert.equal(graph.entities.length, 0);
  assert.equal(graph.evidence.length, 0);
});

test('图谱替换事务失败时旧实体和证据完整回滚', async t => {
  await db.init(':memory:');
  t.after(() => db.close());
  const notebook = await db.createNotebook('事务回滚', '');
  const doc = await db.createDocument(notebook.id, '来源', 'Alpha');
  const oldBuild = await createGraph(notebook.id, doc.id);
  const build = await db.createGraphBuild({ notebookId: notebook.id });
  const duplicate = { canonicalName: 'Duplicate', entityType: 'concept', aliases: [], mentionCount: 1 };
  await assert.rejects(() => db.replaceGraph({
    notebookId: notebook.id, buildId: build.id,
    entities: [{ ...duplicate, key: 'one' }, { ...duplicate, key: 'two' }],
    relations: [], evidence: []
  }), /UNIQUE/);
  const graph = await db.getGraph(notebook.id);
  assert.equal(graph.dataBuild.id, oldBuild.id);
  assert.equal(graph.entities[0].canonical_name, 'Alpha');
  assert.equal(graph.evidence[0].evidence_text, 'Alpha');
});

test('删除笔记本级联删除图谱，其他笔记本不受影响', async t => {
  await db.init(':memory:');
  t.after(() => db.close());
  const first = await db.createNotebook('删除目标', '');
  const second = await db.createNotebook('保留目标', '');
  const firstDoc = await db.createDocument(first.id, '来源一', 'Alpha');
  const secondDoc = await db.createDocument(second.id, '来源二', 'Alpha');
  await createGraph(first.id, firstDoc.id);
  await createGraph(second.id, secondDoc.id);
  await db.deleteNotebook(first.id);
  assert.equal((await db.getGraph(first.id)).build, null);
  assert.equal((await db.getGraph(second.id)).entities.length, 1);
});

test('重启把未完成构建标记 interrupted，并保留已有图谱', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-graph-restart-'));
  const filePath = path.join(directory, 'graph.db');
  t.after(async () => {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await db.init(filePath);
  const notebook = await db.createNotebook('重启测试', '');
  const doc = await db.createDocument(notebook.id, '来源', 'Alpha');
  await createGraph(notebook.id, doc.id);
  await db.createGraphBuild({ notebookId: notebook.id });
  await db.close();
  await db.init(filePath);
  const graph = await db.getGraph(notebook.id);
  assert.equal(graph.build.status, 'interrupted');
  assert.equal(graph.entities.length, 1);
  assert.equal(graph.dataBuild.status, 'ready');
});

test('事务队列阻止外部文档写入穿过图谱替换事务', async t => {
  await db.init(':memory:');
  t.after(() => db.close());
  const notebook = await db.createNotebook('事务隔离', '');
  const document = await db.createDocument(notebook.id, '来源', 'Alpha Beta');
  await createGraph(notebook.id, document.id);
  const build = await db.createGraphBuild({ notebookId: notebook.id });
  const sourceFingerprint = hashDocuments(await db.getDocumentsByNotebook(notebook.id));
  const replacement = {
    notebookId: notebook.id,
    buildId: build.id,
    entities: [{ key: 'concept:beta', canonicalName: 'Beta', entityType: 'concept', aliases: [], mentionCount: 1 }],
    relations: [],
    evidence: [{ entityKey: 'concept:beta', documentId: document.id, chunkIndex: 0, startChar: 6, endChar: 10, evidenceText: 'Beta' }]
  };
  await db.updateGraphBuild(build.id, { sourceFingerprint });

  let release;
  let readyResolve;
  const hold = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const graphTransaction = db.withTransaction(async () => {
    await db.replaceGraph(replacement);
    readyResolve();
    await hold;
  });
  await ready;

  let outsideFinished = false;
  const outsideWrite = db.createDocument(notebook.id, '并发来源', 'Gamma')
    .then(result => { outsideFinished = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(outsideFinished, false, '事务未提交时外部写入不应执行');

  release();
  await Promise.all([graphTransaction, outsideWrite]);
  const graph = await db.getGraph(notebook.id);
  assert.deepEqual(graph.entities.map(entity => entity.canonical_name), ['Beta']);
  assert.equal((await db.getDocumentsByNotebook(notebook.id)).length, 2);
});

test('图谱替换失败回滚后，排队写入和旧图谱都保持完整', async t => {
  await db.init(':memory:');
  t.after(() => db.close());
  const notebook = await db.createNotebook('回滚隔离', '');
  const document = await db.createDocument(notebook.id, '来源', 'Alpha');
  const oldBuild = await createGraph(notebook.id, document.id);
  const build = await db.createGraphBuild({ notebookId: notebook.id });

  let release;
  let readyResolve;
  const hold = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const barrier = db.withTransaction(async () => {
    readyResolve();
    await hold;
  });
  await ready;

  const failingReplacement = db.replaceGraph({
    notebookId: notebook.id,
    buildId: build.id,
    entities: [
      { key: 'one', canonicalName: 'Duplicate', entityType: 'concept', aliases: [], mentionCount: 1 },
      { key: 'two', canonicalName: 'Duplicate', entityType: 'concept', aliases: [], mentionCount: 1 }
    ],
    relations: [],
    evidence: []
  });
  const outsideWrite = db.createDocument(notebook.id, '应保留', 'Gamma');
  release();
  const results = await Promise.allSettled([barrier, failingReplacement, outsideWrite]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /UNIQUE/);
  assert.equal(results[2].status, 'fulfilled');

  const graph = await db.getGraph(notebook.id);
  assert.equal(graph.dataBuild.id, oldBuild.id);
  assert.equal(graph.entities[0].canonical_name, 'Alpha');
  assert.equal((await db.getDocumentsByNotebook(notebook.id)).length, 2);
});

test('研究笔记本 bundle 失败时事务回滚且不阻塞后续写入', async t => {
  await db.init(':memory:');
  t.after(() => db.close());

  let release;
  let readyResolve;
  const hold = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const barrier = db.withTransaction(async () => {
    readyResolve();
    await hold;
  });
  await ready;
  const failingResearch = db.createResearchNotebookBundle({
    name: '不应留下的研究笔记本',
    description: '',
    metadata: {},
    sources: [{ title: '来源', content: 'source', summary: '' }],
    guide: { content: 'guide', summary: 'guide' }
  });
  const outsideNotebook = db.createNotebook('后续写入', '');
  release();
  const results = await Promise.allSettled([barrier, failingResearch, outsideNotebook]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[2].status, 'fulfilled');
  const notebooks = await db.getAllNotebooks();
  assert.equal(notebooks.some(notebook => notebook.name === '不应留下的研究笔记本'), false);
  assert.equal(notebooks.some(notebook => notebook.name === '后续写入'), true);
});

test('仅旧版本数据库创建 bak-v4，已有 v4 重复初始化不创建', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-graph-backup-'));
  const legacyPath = path.join(directory, 'legacy.db');
  const freshPath = path.join(directory, 'fresh.db');
  t.after(async () => {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await seedUserVersion(legacyPath, 3);
  await db.init(legacyPath);
  assert.equal(fs.existsSync(`${legacyPath}.bak-v4`), true);
  await db.close();

  // 首次创建即为 v4 的数据库，重复 init 不能被误判为旧库而生成备份。
  await db.init(freshPath);
  await db.close();
  assert.equal(fs.existsSync(`${freshPath}.bak-v4`), false);
  await db.init(freshPath);
  await db.close();
  assert.equal(fs.existsSync(`${freshPath}.bak-v4`), false);
});

test('源文档指纹变化时 replaceGraph 拒绝提交过时图谱', async t => {
  await db.init(':memory:');
  t.after(() => db.close());
  const notebook = await db.createNotebook('指纹校验', '');
  const document = await db.createDocument(notebook.id, '来源', 'Alpha');
  const oldBuild = await createGraph(notebook.id, document.id);
  const build = await db.createGraphBuild({
    notebookId: notebook.id,
    sourceFingerprint: hashDocuments(await db.getDocumentsByNotebook(notebook.id))
  });
  await db.createDocument(notebook.id, '新增来源', 'Beta');
  await assert.rejects(() => db.replaceGraph({
    notebookId: notebook.id,
    buildId: build.id,
    entities: [{ key: 'concept:beta', canonicalName: 'Beta', entityType: 'concept', aliases: [], mentionCount: 1 }],
    relations: [],
    evidence: []
  }), /源文档已变化/);
  const graph = await db.getGraph(notebook.id);
  assert.equal(graph.dataBuild.id, oldBuild.id);
  assert.equal(graph.entities[0].canonical_name, 'Alpha');
});
