const sqlite3 = require('sqlite3').verbose();
const path = require('path');

let db = null;

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

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * 初始化数据库表结构
 */
async function init(dbPath) {
  await connect(dbPath);

  // 1. 创建笔记本表
  await run(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      create_time TEXT NOT NULL
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
  
  console.log("数据库初始化成功，连接至:", dbPath);
}

// ==================== 笔记本 CRUD ====================

async function getAllNotebooks() {
  return all("SELECT * FROM notebooks ORDER BY create_time DESC");
}

async function getNotebookById(id) {
  return get("SELECT * FROM notebooks WHERE id = ?", [id]);
}

async function createNotebook(name, description) {
  const now = new Date().toISOString();
  const result = await run(
    "INSERT INTO notebooks (name, description, create_time) VALUES (?, ?, ?)",
    [name, description, now]
  );
  return { id: result.lastID, name, description, create_time: now };
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
  return all("SELECT * FROM documents WHERE notebook_id = ? ORDER BY create_time DESC", [notebookId]);
}

async function getDocumentById(id) {
  return get("SELECT * FROM documents WHERE id = ?", [id]);
}

async function createDocument(notebookId, title, content, summary = "摘要生成中...", chunkCount = 0) {
  const now = new Date().toISOString();
  const result = await run(
    "INSERT INTO documents (notebook_id, title, content, summary, chunk_count, create_time) VALUES (?, ?, ?, ?, ?, ?)",
    [notebookId, title, content, summary, chunkCount, now]
  );
  return { id: result.lastID, notebook_id: notebookId, title, content, summary, chunk_count: chunkCount, create_time: now };
}

async function updateDocumentSummary(id, summary) {
  await run("UPDATE documents SET summary = ? WHERE id = ?", [summary, id]);
  return getDocumentById(id);
}

async function updateDocumentChunkCount(id, chunkCount) {
  await run("UPDATE documents SET chunk_count = ? WHERE id = ?", [chunkCount, id]);
  return getDocumentById(id);
}

async function deleteDocument(id) {
  // 级联删除对应的 chat_messages
  const result = await run("DELETE FROM documents WHERE id = ?", [id]);
  return result.changes > 0;
}

// ==================== 对话历史 CRUD ====================

async function getChatHistory(sessionId) {
  return all("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY create_time ASC", [sessionId]);
}

async function saveChatMessage(sessionId, role, content, documentId = null, notebookId = null) {
  const now = new Date().toISOString();
  const result = await run(
    "INSERT INTO chat_messages (session_id, role, content, document_id, notebook_id, create_time) VALUES (?, ?, ?, ?, ?, ?)",
    [sessionId, role, content, documentId, notebookId, now]
  );
  return { id: result.lastID, session_id: sessionId, role, content, document_id: documentId, notebook_id: notebookId, create_time: now };
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

function close() {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) {
          console.error("数据库关闭失败:", err);
          reject(err);
        } else {
          db = null;
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  init,
  close,
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
  deleteDocument,
  getChatHistory,
  saveChatMessage,
  clearChatHistory,
  clearDocHistory,
  clearNotebookHistory,
  truncateHistory
};

