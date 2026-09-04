const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const db = require('../database');

function createLegacyDatabase(filePath) {
  return new Promise((resolve, reject) => {
    const legacy = new sqlite3.Database(filePath);
    legacy.exec(`
      CREATE TABLE notebooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        create_time TEXT NOT NULL
      );
      CREATE TABLE documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notebook_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        summary TEXT,
        chunk_count INTEGER DEFAULT 0,
        create_time TEXT NOT NULL
      );
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        document_id INTEGER,
        notebook_id INTEGER,
        create_time TEXT NOT NULL
      );
      INSERT INTO notebooks (name, description, create_time)
      VALUES ('旧笔记本', '', '2026-01-01T00:00:00.000Z');
      INSERT INTO documents (
        notebook_id, title, content, summary, chunk_count, create_time
      ) VALUES (1, '已有索引', '正文', '摘要', 3, '2026-01-01T00:00:00.000Z');
    `, error => {
      legacy.close(closeError => {
        if (error || closeError) reject(error || closeError);
        else resolve();
      });
    });
  });
}

test('旧数据库迁移前创建备份，并把已有索引标记为 stale', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-db-migration-'));
  const filePath = path.join(directory, 'notebook.db');
  t.after(async () => {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await createLegacyDatabase(filePath);
  await db.init(filePath);

  const document = await db.getDocumentById(1);
  assert.equal(document.index_status, 'stale');
  assert.equal(document.origin, 'manual');
  assert.equal(document.metadata, null);
  assert.equal(fs.existsSync(`${filePath}.bak-v3`), true);
  assert.equal(fs.existsSync(`${filePath}.bak-v4`), true);

  await db.close();
  const migrated = new sqlite3.Database(filePath);
  const version = await new Promise((resolve, reject) => {
    migrated.get('PRAGMA user_version', (error, row) => {
      if (error) reject(error);
      else resolve(row.user_version);
    });
  });
  await new Promise((resolve, reject) => {
    migrated.close(error => error ? reject(error) : resolve());
  });
  assert.equal(version, 4);
});
