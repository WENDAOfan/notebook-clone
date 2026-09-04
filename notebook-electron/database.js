const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

let db = null;
// sqlite3 本身会把单条语句排队，但不会把 BEGIN 和后续多条语句视为一个
// 原子操作。所有事务外操作都经过这一条应用层队列；事务上下文中的语句
// 则直接使用同一连接执行，以免在事务的 await 之间插入其他请求。
const transactionStorage = new AsyncLocalStorage();
let operationQueue = Promise.resolve();

function hashNotebookDocuments(documents) {
  const hash = crypto.createHash('sha256');
  for (const document of [...documents].sort((a, b) => Number(a.id) - Number(b.id))) {
    hash.update(`${document.id}\0${document.content || ''}\0${document.title || ''}\n`);
  }
  return hash.digest('hex');
}

/**
 * 封装 sqlite3 的基础异步操作
 */
function connect(dbPath) {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("数据库连接失败:", err);
        reject(err);
      } else {
        // 必须显式开启外键约束，保证 ON DELETE CASCADE 级联删除生效
        db.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
          if (pragmaErr) reject(pragmaErr);
          else resolve();
        });
      }
    });
  });
}

function runRaw(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getRaw(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allRaw(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * 将一个数据库操作追加到串行队列。AsyncLocalStorage 让事务中的嵌套
 * 操作绕过队列，否则事务的第二条语句会排到自己的 COMMIT 后面。
 */
function enqueueOperation(operation) {
  const transaction = transactionStorage.getStore();
  if (transaction && transaction.active) {
    return Promise.resolve().then(operation);
  }

  const task = operationQueue.then(operation);
  // 后续任务不能因为前一个任务失败而整体短路；真正的 task 仍然把
  // 原始错误返回给调用方。
  operationQueue = task.catch(() => {});
  return task;
}

function run(sql, params = []) {
  return enqueueOperation(() => runRaw(sql, params));
}

function get(sql, params = []) {
  return enqueueOperation(() => getRaw(sql, params));
}

function all(sql, params = []) {
  return enqueueOperation(() => allRaw(sql, params));
}

/**
 * 在共享 SQLite 连接上执行一个不可交错的事务。已处于本事务上下文
 * 时只执行 work，支持数据库函数之间的组合而不嵌套 BEGIN。
 */
function withTransaction(work, mode = 'IMMEDIATE') {
  if (typeof work !== 'function') throw new TypeError('事务 work 必须是函数');
  if (!['DEFERRED', 'IMMEDIATE', 'EXCLUSIVE'].includes(mode)) {
    throw new Error(`不支持的事务模式：${mode}`);
  }
  const transaction = transactionStorage.getStore();
  if (transaction && transaction.active) {
    return Promise.resolve().then(work);
  }

  return enqueueOperation(async () => {
    await runRaw(`BEGIN ${mode}`);
    const context = { active: true };
    try {
      const result = await transactionStorage.run(context, work);
      await runRaw('COMMIT');
      return result;
    } catch (error) {
      await runRaw('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

/**
 * 初始化数据库表结构
 */
async function init(dbPath) {
  const databaseExisted = dbPath !== ':memory:' && fs.existsSync(dbPath);
  if (databaseExisted) {
    const backupPath = `${dbPath}.bak-v3`;
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(dbPath, backupPath);
    }
  }

  await connect(dbPath);

  // v4 引入 Graph Lite 表。只有确实从旧版本迁移时才创建一次迁移前快照；
  // 已经是 v4 的数据库重复 init 不应再生成/覆盖 .bak-v4。
  const currentVersionRow = await getRaw('PRAGMA user_version');
  const currentUserVersion = Number(currentVersionRow?.user_version || 0);
  if (databaseExisted && currentUserVersion < 4) {
    const graphBackupPath = `${dbPath}.bak-v4`;
    if (!fs.existsSync(graphBackupPath)) {
      fs.copyFileSync(dbPath, graphBackupPath);
    }
  }

  // 1. 创建笔记本表
  await run(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      create_time TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'manual',
      metadata_json TEXT
    )
  `);

  // 2. 创建文档表（含关联笔记本外键与级联删除）
  await run(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notebook_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      summary TEXT,
      chunk_count INTEGER DEFAULT 0,
      create_time TEXT NOT NULL,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
    )
  `);

  // 3. 创建对话消息表（含关联文档和笔记本外键与级联删除）
  await run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      document_id INTEGER,
      notebook_id INTEGER,
      create_time TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
    )
  `);

  // 4. 创建索引
  await run(`CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(create_time)`);

  const notebookColumns = await all(`PRAGMA table_info(notebooks)`);
  const notebookColumnNames = new Set(notebookColumns.map(column => column.name));
  if (!notebookColumnNames.has('origin')) {
    await run(`ALTER TABLE notebooks ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'`);
  }
  if (!notebookColumnNames.has('metadata_json')) {
    await run(`ALTER TABLE notebooks ADD COLUMN metadata_json TEXT`);
  }

  const documentColumns = await all(`PRAGMA table_info(documents)`);
  const documentColumnNames = new Set(documentColumns.map(column => column.name));
  const documentMigrations = [
    ['index_status', `ALTER TABLE documents ADD COLUMN index_status TEXT NOT NULL DEFAULT 'pending'`],
    ['index_error', `ALTER TABLE documents ADD COLUMN index_error TEXT`],
    ['indexed_at', `ALTER TABLE documents ADD COLUMN indexed_at TEXT`],
    ['content_hash', `ALTER TABLE documents ADD COLUMN content_hash TEXT`],
    ['origin', `ALTER TABLE documents ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'`],
    ['metadata_json', `ALTER TABLE documents ADD COLUMN metadata_json TEXT`]
  ];
  let documentSchemaChanged = false;
  for (const [name, sql] of documentMigrations) {
    if (!documentColumnNames.has(name)) {
      await run(sql);
      documentSchemaChanged = true;
    }
  }

  const chatColumns = await all(`PRAGMA table_info(chat_messages)`);
  const chatColumnNames = new Set(chatColumns.map(column => column.name));
  if (!chatColumnNames.has('metadata_json')) {
    await run(`ALTER TABLE chat_messages ADD COLUMN metadata_json TEXT`);
  }

  if (documentSchemaChanged) {
    await run(`
      UPDATE documents
      SET index_status = CASE WHEN chunk_count > 0 THEN 'stale' ELSE 'pending' END
    `);
  }
  await run(`
    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      mode TEXT NOT NULL,
      filters_json TEXT,
      manual_urls_json TEXT,
      status TEXT NOT NULL,
      candidates_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_notebook_id INTEGER,
      FOREIGN KEY (created_notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_research_updated ON research_runs(updated_at DESC)`);
  await run(`
    UPDATE research_runs
    SET status = 'interrupted', updated_at = ?
    WHERE status IN ('searching', 'fetching', 'generating_guide', 'creating')
  `, [new Date().toISOString()]);

  // Graph Lite v4：图谱记录和证据均以 notebook_id 隔离，并通过外键级联删除。
  await run(`
    CREATE TABLE IF NOT EXISTS graph_builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notebook_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('empty', 'building', 'ready', 'stale', 'failed', 'interrupted')),
      source_fingerprint TEXT,
      model TEXT,
      prompt_version TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_graph_builds_notebook ON graph_builds(notebook_id, id DESC)`);
  await run(`
    CREATE TABLE IF NOT EXISTS graph_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notebook_id INTEGER NOT NULL,
      build_id INTEGER NOT NULL,
      canonical_name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      aliases_json TEXT,
      description TEXT,
      mention_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
      FOREIGN KEY (build_id) REFERENCES graph_builds(id) ON DELETE CASCADE,
      UNIQUE(build_id, canonical_name, entity_type)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_graph_entities_notebook ON graph_entities(notebook_id, build_id)`);
  await run(`
    CREATE TABLE IF NOT EXISTS graph_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notebook_id INTEGER NOT NULL,
      build_id INTEGER NOT NULL,
      source_entity_id INTEGER NOT NULL,
      target_entity_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
      FOREIGN KEY (build_id) REFERENCES graph_builds(id) ON DELETE CASCADE,
      FOREIGN KEY (source_entity_id) REFERENCES graph_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_entity_id) REFERENCES graph_entities(id) ON DELETE CASCADE,
      UNIQUE(build_id, source_entity_id, target_entity_id, relation_type)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_graph_relations_notebook ON graph_relations(notebook_id, build_id)`);
  await run(`
    CREATE TABLE IF NOT EXISTS graph_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notebook_id INTEGER NOT NULL,
      build_id INTEGER NOT NULL,
      entity_id INTEGER,
      relation_id INTEGER,
      document_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_char INTEGER NOT NULL,
      end_char INTEGER NOT NULL,
      evidence_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK(entity_id IS NOT NULL OR relation_id IS NOT NULL),
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
      FOREIGN KEY (build_id) REFERENCES graph_builds(id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES graph_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (relation_id) REFERENCES graph_relations(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_graph_evidence_entity ON graph_evidence(entity_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_graph_evidence_relation ON graph_evidence(relation_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_graph_evidence_document ON graph_evidence(document_id)`);

  // 应用异常退出时，不能把一次未完成构建误报为可用图谱。
  await run(`
    UPDATE graph_builds
    SET status = 'interrupted', error = COALESCE(error, '应用关闭时构建未完成'), updated_at = ?
    WHERE status = 'building'
  `, [new Date().toISOString()]);
  await run(`PRAGMA user_version = 4`);
  
  console.log("数据库初始化成功，连接至:", dbPath);
}

// ==================== 笔记本 CRUD ====================

async function getAllNotebooks() {
  const rows = await all("SELECT * FROM notebooks ORDER BY create_time DESC");
  return rows.map(parseNotebook);
}

async function getNotebookById(id) {
  return parseNotebook(await get("SELECT * FROM notebooks WHERE id = ?", [id]));
}

async function createNotebook(name, description, options = {}) {
  const now = new Date().toISOString();
  const origin = options.origin || 'manual';
  const metadataJson = options.metadata ? JSON.stringify(options.metadata) : null;
  const result = await run(
    `INSERT INTO notebooks (name, description, create_time, origin, metadata_json)
     VALUES (?, ?, ?, ?, ?)`,
    [name, description, now, origin, metadataJson]
  );
  return getNotebookById(result.lastID);
}

async function updateNotebook(id, name, description) {
  await run(
    "UPDATE notebooks SET name = ?, description = ? WHERE id = ?",
    [name, description, id]
  );
  return getNotebookById(id);
}

async function deleteNotebook(id) {
  // 由于开启了 ON DELETE CASCADE，删除笔记本将自动清空其关联的 documents 和 chat_messages
  const result = await run("DELETE FROM notebooks WHERE id = ?", [id]);
  return result.changes > 0;
}

// ==================== 文档 CRUD ====================

async function getDocumentsByNotebook(notebookId) {
  const rows = await all("SELECT * FROM documents WHERE notebook_id = ? ORDER BY create_time DESC", [notebookId]);
  return rows.map(parseDocument);
}

async function getDocumentById(id) {
  return parseDocument(await get("SELECT * FROM documents WHERE id = ?", [id]));
}

async function createDocument(notebookId, title, content, summary = "摘要生成中...", chunkCount = 0, options = {}) {
  const now = new Date().toISOString();
  const origin = options.origin || 'manual';
  const metadataJson = options.metadata ? JSON.stringify(options.metadata) : null;
  const result = await run(
    `INSERT INTO documents (
      notebook_id, title, content, summary, chunk_count, create_time,
      index_status, origin, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [notebookId, title, content, summary, chunkCount, now, origin, metadataJson]
  );
  await markGraphStale(notebookId);
  return getDocumentById(result.lastID);
}

async function updateDocumentSummary(id, summary) {
  await run("UPDATE documents SET summary = ? WHERE id = ?", [summary, id]);
  return getDocumentById(id);
}

async function updateDocumentChunkCount(id, chunkCount) {
  await run("UPDATE documents SET chunk_count = ? WHERE id = ?", [chunkCount, id]);
  return getDocumentById(id);
}

async function updateDocumentIndexStatus(id, status, options = {}) {
  const indexedAt = options.indexedAt === undefined ? null : options.indexedAt;
  const indexError = options.error === undefined ? null : options.error;
  const contentHash = options.contentHash === undefined ? null : options.contentHash;
  await run(
    `UPDATE documents
     SET index_status = ?, index_error = ?, indexed_at = ?, content_hash = ?
     WHERE id = ?`,
    [status, indexError, indexedAt, contentHash, id]
  );
  return getDocumentById(id);
}

async function markDocumentIndexStale(id) {
  await run(
    `UPDATE documents SET index_status = 'stale', index_error = NULL WHERE id = ?`,
    [id]
  );
  return getDocumentById(id);
}

async function deleteDocument(id) {
  const document = await getDocumentById(id);
  // 级联删除对应的 chat_messages 与 graph_evidence
  const result = await run("DELETE FROM documents WHERE id = ?", [id]);
  if (result.changes > 0 && document) {
    await cleanupGraphOrphans(document.notebook_id);
    await markGraphStale(document.notebook_id);
  }
  return result.changes > 0;
}

// ==================== Graph Lite 概念图 ====================

const GRAPH_STATUSES = new Set(['empty', 'building', 'ready', 'stale', 'failed', 'interrupted']);

async function createGraphBuild({ notebookId, status = 'building', sourceFingerprint = null, model = null, promptVersion = null } = {}) {
  const notebook = await getNotebookById(Number(notebookId));
  if (!notebook) throw new Error('笔记本不存在');
  if (!GRAPH_STATUSES.has(status)) throw new Error(`无效的图谱状态：${status}`);
  const now = new Date().toISOString();
  const result = await run(
    `INSERT INTO graph_builds (
      notebook_id, status, source_fingerprint, model, prompt_version, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    [Number(notebookId), status, sourceFingerprint, model, promptVersion, now, now]
  );
  return getGraphBuild(result.lastID);
}

async function getGraphBuild(id) {
  return parseGraphBuild(await get(`SELECT * FROM graph_builds WHERE id = ?`, [id]));
}

async function getLatestGraphBuild(notebookId) {
  return parseGraphBuild(await get(
    `SELECT * FROM graph_builds WHERE notebook_id = ? ORDER BY id DESC LIMIT 1`,
    [Number(notebookId)]
  ));
}

async function updateGraphBuild(id, patch = {}) {
  const allowed = {
    status: 'status',
    sourceFingerprint: 'source_fingerprint',
    model: 'model',
    promptVersion: 'prompt_version',
    error: 'error'
  };
  const assignments = [];
  const values = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (patch[key] === undefined) continue;
    if (key === 'status' && !GRAPH_STATUSES.has(patch[key])) {
      throw new Error(`无效的图谱状态：${patch[key]}`);
    }
    assignments.push(`${column} = ?`);
    values.push(patch[key]);
  }
  if (!assignments.length) return getGraphBuild(id);
  assignments.push('updated_at = ?');
  values.push(new Date().toISOString(), id);
  await run(`UPDATE graph_builds SET ${assignments.join(', ')} WHERE id = ?`, values);
  return getGraphBuild(id);
}

async function markGraphStale(notebookId, reason = '文档内容已变化') {
  // 构建失败/中断或当前有新的 building 记录时，仍要让最后一份可用图谱变为 stale。
  const build = parseGraphBuild(await get(
    `SELECT * FROM graph_builds
     WHERE notebook_id = ? AND status IN ('ready', 'stale')
     ORDER BY id DESC LIMIT 1`,
    [Number(notebookId)]
  ));
  if (!build) return build;
  if (build.status === 'stale' && !reason) return build;
  return updateGraphBuild(build.id, {
    status: 'stale',
    error: reason || null
  });
}

async function cleanupGraphOrphans(notebookId) {
  const id = Number(notebookId);
  // 文档删除会级联删除 evidence；随后清掉没有任何证据的关系和实体。
  await run(
    `DELETE FROM graph_relations
     WHERE notebook_id = ?
       AND NOT EXISTS (SELECT 1 FROM graph_evidence e WHERE e.relation_id = graph_relations.id)`,
    [id]
  );
  await run(
    `DELETE FROM graph_entities
     WHERE notebook_id = ?
       AND NOT EXISTS (SELECT 1 FROM graph_evidence e WHERE e.entity_id = graph_entities.id)`,
    [id]
  );
}

async function getGraph(notebookId) {
  const build = await getLatestGraphBuild(notebookId);
  if (!build) return { build: null, dataBuild: null, entities: [], relations: [], evidence: [] };
  // 最新一次失败/中断/进行中的构建不能遮蔽上一份可用图谱，UI 仍应显示旧图并提示状态。
  const dataBuild = parseGraphBuild(await get(
    `SELECT * FROM graph_builds
     WHERE notebook_id = ? AND status IN ('ready', 'stale')
     ORDER BY id DESC LIMIT 1`,
    [Number(notebookId)]
  ));
  if (!dataBuild) return { build, dataBuild: null, entities: [], relations: [], evidence: [] };
  const entities = await all(
    `SELECT * FROM graph_entities WHERE notebook_id = ? AND build_id = ? ORDER BY mention_count DESC, id ASC`,
    [Number(notebookId), dataBuild.id]
  );
  const relations = await all(
    `SELECT * FROM graph_relations WHERE notebook_id = ? AND build_id = ? ORDER BY evidence_count DESC, confidence DESC, id ASC`,
    [Number(notebookId), dataBuild.id]
  );
  const evidence = await all(
    `SELECT * FROM graph_evidence WHERE notebook_id = ? AND build_id = ? ORDER BY id ASC`,
    [Number(notebookId), dataBuild.id]
  );
  return {
    build,
    dataBuild,
    entities: entities.map(parseGraphEntity),
    relations: relations.map(parseGraphRelation),
    evidence: evidence.map(parseGraphEvidence)
  };
}

/**
 * 在一次 SQLite 事务内替换笔记本图谱。传入的数据来自 graph-service 的内存结果，
 * 因而模型批次失败时不会破坏仍可用的旧图谱。
 */
async function replaceGraph({ notebookId, buildId, entities = [], relations = [], evidence = [] } = {}) {
  const graph = await withTransaction(async () => {
    const normalizedNotebookId = Number(notebookId);
    const notebook = await getRaw(
      'SELECT id FROM notebooks WHERE id = ?',
      [normalizedNotebookId]
    );
    if (!notebook) throw new Error('笔记本不存在');

    // 构建记录、笔记本和证据必须在同一个事务快照内校验，避免校验完成后
    // 另一请求删除/移动数据，随后把过期或跨笔记本证据写入新图谱。
    const build = parseGraphBuild(await getRaw(
      'SELECT * FROM graph_builds WHERE id = ?',
      [buildId]
    ));
    if (!build || Number(build.notebook_id) !== normalizedNotebookId) {
      throw new Error('图谱构建记录不存在或不属于当前笔记本');
    }
    if (build.status !== 'building') {
      throw new Error(`当前构建状态不可提交：${build.status}`);
    }
    if (build.source_fingerprint) {
      const currentDocuments = await allRaw(
        'SELECT id, title, content FROM documents WHERE notebook_id = ? ORDER BY id ASC',
        [normalizedNotebookId]
      );
      const currentFingerprint = hashNotebookDocuments(currentDocuments);
      if (currentFingerprint !== build.source_fingerprint) {
        throw new Error('图谱构建源文档已变化，请重新生成概念图');
      }
    }

    const entityKeys = new Set();
    for (const entity of entities) {
      if (!entity || entity.key === undefined || entity.key === null || String(entity.key) === '') {
        throw new Error('图谱实体缺少稳定 key');
      }
      const key = String(entity.key);
      if (entityKeys.has(key)) throw new Error(`图谱实体 key 重复：${key}`);
      entityKeys.add(key);
    }
    const relationKeys = new Set();
    for (const relation of relations) {
      if (!relation || relation.key === undefined || relation.key === null || String(relation.key) === '') {
        throw new Error('图谱关系缺少稳定 key');
      }
      const key = String(relation.key);
      if (relationKeys.has(key)) throw new Error(`图谱关系 key 重复：${key}`);
      relationKeys.add(key);
      if (!entityKeys.has(String(relation.sourceKey)) || !entityKeys.has(String(relation.targetKey))) {
        throw new Error(`图谱关系 ${key} 引用了不存在的实体`);
      }
    }

    // 对每一条证据都检查归属、字符边界和原文等值，而不是只检查文档 ID。
    // 这样 graph-service 之外的调用者也不能伪造不可跳转的证据位置。
    const documentCache = new Map();
    for (const item of evidence) {
      if (!item || (item.entityKey === undefined && item.relationKey === undefined)) {
        throw new Error('图谱证据必须关联实体或关系');
      }
      const hasEntity = item.entityKey !== undefined && item.entityKey !== null && item.entityKey !== '';
      const hasRelation = item.relationKey !== undefined && item.relationKey !== null && item.relationKey !== '';
      if (hasEntity === hasRelation) {
        throw new Error('图谱证据只能关联一个实体或关系');
      }
      if (hasEntity && !entityKeys.has(String(item.entityKey))) {
        throw new Error('图谱证据引用了不存在的实体');
      }
      if (hasRelation && !relationKeys.has(String(item.relationKey))) {
        throw new Error('图谱证据引用了不存在的关系');
      }

      const documentId = Number(item.documentId);
      const chunkIndex = Number(item.chunkIndex);
      const startChar = Number(item.startChar);
      const endChar = Number(item.endChar);
      if (!Number.isInteger(documentId) || !Number.isInteger(chunkIndex) || chunkIndex < 0
        || !Number.isInteger(startChar) || startChar < 0
        || !Number.isInteger(endChar) || endChar <= startChar
        || typeof item.evidenceText !== 'string' || !item.evidenceText.length) {
        throw new Error('图谱证据范围无效');
      }

      let document = documentCache.get(documentId);
      if (document === undefined) {
        document = await getRaw(
          'SELECT id, notebook_id, content FROM documents WHERE id = ?',
          [documentId]
        );
        documentCache.set(documentId, document || null);
      }
      if (!document || Number(document.notebook_id) !== normalizedNotebookId) {
        throw new Error('图谱证据文档不存在或不属于当前笔记本');
      }
      const content = String(document.content || '');
      if (endChar > content.length || content.slice(startChar, endChar) !== item.evidenceText) {
        throw new Error('图谱证据范围与原文不一致');
      }
    }

    const now = new Date().toISOString();
    // 先删除证据，再删除关系和实体，避免外键约束阻止替换。
    await runRaw('DELETE FROM graph_evidence WHERE notebook_id = ?', [normalizedNotebookId]);
    await runRaw('DELETE FROM graph_relations WHERE notebook_id = ?', [normalizedNotebookId]);
    await runRaw('DELETE FROM graph_entities WHERE notebook_id = ?', [normalizedNotebookId]);

    const entityIds = new Map();
    for (const entity of entities) {
      const result = await runRaw(
        `INSERT INTO graph_entities (
          notebook_id, build_id, canonical_name, entity_type, aliases_json,
          description, mention_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalizedNotebookId, buildId, entity.canonicalName, entity.entityType,
          JSON.stringify(entity.aliases || []), entity.description || '',
          Number(entity.mentionCount || 0), now
        ]
      );
      entityIds.set(String(entity.key), result.lastID);
    }

    const relationIds = new Map();
    for (const relation of relations) {
      const sourceEntityId = entityIds.get(String(relation.sourceKey));
      const targetEntityId = entityIds.get(String(relation.targetKey));
      const result = await runRaw(
        `INSERT INTO graph_relations (
          notebook_id, build_id, source_entity_id, target_entity_id,
          relation_type, confidence, evidence_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalizedNotebookId, buildId, sourceEntityId, targetEntityId,
          relation.relationType, Number(relation.confidence),
          Number(relation.evidenceCount || 0), now
        ]
      );
      relationIds.set(String(relation.key), result.lastID);
    }

    for (const item of evidence) {
      const entityId = item.entityKey ? entityIds.get(String(item.entityKey)) : null;
      const relationId = item.relationKey ? relationIds.get(String(item.relationKey)) : null;
      await runRaw(
        `INSERT INTO graph_evidence (
          notebook_id, build_id, entity_id, relation_id, document_id,
          chunk_index, start_char, end_char, evidence_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalizedNotebookId, buildId, entityId, relationId,
          Number(item.documentId), Number(item.chunkIndex),
          Number(item.startChar), Number(item.endChar), String(item.evidenceText), now
        ]
      );
    }

    await runRaw(
      `UPDATE graph_builds SET status = 'stale', updated_at = ?
       WHERE notebook_id = ? AND id <> ? AND status = 'ready'`,
      [now, normalizedNotebookId, buildId]
    );
    await runRaw(
      `UPDATE graph_builds SET status = 'ready', error = NULL, updated_at = ? WHERE id = ?`,
      [now, buildId]
    );
    return normalizedNotebookId;
  });
  return getGraph(graph);
}

// ==================== 联网研究任务 ====================

async function createResearchRun(data) {
  const now = new Date().toISOString();
  await run(
    `INSERT INTO research_runs (
      id, topic, mode, filters_json, manual_urls_json, status,
      candidates_json, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      data.id,
      data.topic,
      data.mode,
      JSON.stringify(data.filters || {}),
      JSON.stringify(data.manualUrls || []),
      data.status || 'searching',
      JSON.stringify(data.candidates || []),
      now,
      now
    ]
  );
  return getResearchRun(data.id);
}

async function getResearchRun(id) {
  return parseResearchRun(await get(`SELECT * FROM research_runs WHERE id = ?`, [id]));
}

async function listResearchRuns(limit = 20) {
  const rows = await all(
    `SELECT * FROM research_runs ORDER BY updated_at DESC LIMIT ?`,
    [Math.max(1, Math.min(Number(limit) || 20, 100))]
  );
  return rows.map(parseResearchRun);
}

async function updateResearchRun(id, patch = {}) {
  const allowed = {
    status: 'status',
    candidates: 'candidates_json',
    error: 'error',
    createdNotebookId: 'created_notebook_id'
  };
  const assignments = [];
  const values = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (patch[key] === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(key === 'candidates' ? JSON.stringify(patch[key]) : patch[key]);
  }
  assignments.push(`updated_at = ?`);
  values.push(new Date().toISOString(), id);
  await run(`UPDATE research_runs SET ${assignments.join(', ')} WHERE id = ?`, values);
  return getResearchRun(id);
}

async function createResearchNotebookBundle({ name, description, metadata, sources, guide }) {
  const now = new Date().toISOString();
  const bundle = await withTransaction(async () => {
    const notebookResult = await run(
      `INSERT INTO notebooks (name, description, create_time, origin, metadata_json)
       VALUES (?, ?, ?, 'research', ?)`,
      [name, description || '', now, JSON.stringify(metadata || {})]
    );
    const notebookId = notebookResult.lastID;
    const sourceDocumentIds = [];
    for (const source of sources) {
      const result = await run(
        `INSERT INTO documents (
          notebook_id, title, content, summary, chunk_count, create_time,
          index_status, origin, metadata_json
        ) VALUES (?, ?, ?, ?, 0, ?, 'pending', 'research-source', ?)`,
        [
          notebookId,
          source.title,
          source.content,
          source.summary || '',
          now,
          JSON.stringify(source.metadata || {})
        ]
      );
      sourceDocumentIds.push(result.lastID);
    }
    const guideMetadata = {
      ...(guide.metadata || {}),
      sourceDocumentIds
    };
    const guideResult = await run(
      `INSERT INTO documents (
        notebook_id, title, content, summary, chunk_count, create_time,
        index_status, origin, metadata_json
      ) VALUES (?, ?, ?, ?, 0, ?, 'pending', 'research-guide', ?)`,
      [
        notebookId,
        guide.title,
        guide.content,
        guide.summary || '联网研究导读',
        now,
        JSON.stringify(guideMetadata)
      ]
    );
    return {
      notebookId,
      sourceDocumentIds,
      guideDocumentId: guideResult.lastID
    };
  });
  return {
    notebook: await getNotebookById(bundle.notebookId),
    sourceDocumentIds: bundle.sourceDocumentIds,
    guideDocumentId: bundle.guideDocumentId
  };
}

// ==================== 对话历史 CRUD ====================

async function getChatHistory(sessionId) {
  const rows = await all(
    "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY create_time ASC, id ASC",
    [sessionId]
  );
  return rows.map(parseChatMessage);
}

async function saveChatMessage(sessionId, role, content, documentId = null, notebookId = null, metadata = null) {
  const now = new Date().toISOString();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  const result = await run(
    `INSERT INTO chat_messages (
      session_id, role, content, document_id, notebook_id, create_time, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, role, content, documentId, notebookId, now, metadataJson]
  );
  return {
    id: result.lastID,
    session_id: sessionId,
    role,
    content,
    document_id: documentId,
    notebook_id: notebookId,
    create_time: now,
    metadata
  };
}

async function clearChatHistory(sessionId) {
  const result = await run("DELETE FROM chat_messages WHERE session_id = ?", [sessionId]);
  return result.changes > 0;
}

async function clearDocHistory(documentId) {
  const result = await run("DELETE FROM chat_messages WHERE document_id = ?", [documentId]);
  return result.changes > 0;
}

async function clearNotebookHistory(notebookId) {
  const result = await run("DELETE FROM chat_messages WHERE notebook_id = ?", [notebookId]);
  return result.changes > 0;
}

/**
 * 历史轮数截断函数，一问一答为1轮（2条消息）
 */
async function truncateHistory(sessionId, maxRounds) {
  const maxMessages = maxRounds * 2;
  const messages = await getChatHistory(sessionId);
  if (messages.length > maxMessages) {
    const overflowCount = messages.length - maxMessages;
    // 获取需要删除的消息的最高 ID 阈值
    const boundaryMsg = messages[overflowCount - 1];
    await run(
      "DELETE FROM chat_messages WHERE session_id = ? AND id <= ?",
      [sessionId, boundaryMsg.id]
    );
    console.log(`[对话历史] 截断会话 ${sessionId}，删除了前面的 ${overflowCount} 条消息`);
  }
}

async function close() {
  // 等待已经排队的读写/事务完成，避免关闭连接后队列中的回调访问 null
  // 或在 SQLite 中留下未提交的 BEGIN。
  await operationQueue.catch(() => {});
  if (!db) return;
  await new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        console.error("数据库关闭失败:", err);
        reject(err);
      } else {
        db = null;
        resolve();
      }
    });
  });
  operationQueue = Promise.resolve();
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseDocument(row) {
  if (!row) return row;
  return { ...row, metadata: parseJson(row.metadata_json) };
}

function parseNotebook(row) {
  if (!row) return row;
  return { ...row, metadata: parseJson(row.metadata_json) };
}

function parseChatMessage(row) {
  if (!row) return row;
  return { ...row, metadata: parseJson(row.metadata_json) };
}

function parseResearchRun(row) {
  if (!row) return row;
  return {
    ...row,
    filters: parseJson(row.filters_json) || {},
    manualUrls: parseJson(row.manual_urls_json) || [],
    candidates: parseJson(row.candidates_json) || []
  };
}

function parseGraphBuild(row) {
  if (!row) return row;
  return { ...row };
}

function parseGraphEntity(row) {
  if (!row) return row;
  return {
    ...row,
    aliases: parseJson(row.aliases_json) || []
  };
}

function parseGraphRelation(row) {
  if (!row) return row;
  return { ...row };
}

function parseGraphEvidence(row) {
  if (!row) return row;
  return { ...row };
}

module.exports = {
  init,
  close,
  withTransaction,
  getAllNotebooks,
  getNotebookById,
  createNotebook,
  updateNotebook,
  deleteNotebook,
  getDocumentsByNotebook,
  getDocumentById,
  createDocument,
  updateDocumentSummary,
  updateDocumentChunkCount,
  updateDocumentIndexStatus,
  markDocumentIndexStale,
  deleteDocument,
  createResearchRun,
  getResearchRun,
  listResearchRuns,
  updateResearchRun,
  createResearchNotebookBundle,
  createGraphBuild,
  getGraphBuild,
  getLatestGraphBuild,
  updateGraphBuild,
  markGraphStale,
  cleanupGraphOrphans,
  getGraph,
  replaceGraph,
  getChatHistory,
  saveChatMessage,
  clearChatHistory,
  clearDocHistory,
  clearNotebookHistory,
  truncateHistory
};
