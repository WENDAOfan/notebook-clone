const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const configService = require('../config-service');
const db = require('../database');
const agentService = require('../agent-service');

const onlineEnabled = process.env.RUN_ONLINE_AGENT_TESTS === '1';

test('真实 DeepSeek 可以完成只读 Agent 工具循环', {
  skip: !onlineEnabled,
  timeout: 210_000
}, async t => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-agent-online-'));
  t.after(async () => {
    for (const requestId of agentService.pendingRuns.keys()) {
      agentService.abort(requestId);
    }
    await db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  });

  const status = configService.init({ userDataPath, isPackaged: false });
  assert.equal(status.deepseekReady, true, `请先在 ${status.configPath} 配置 DeepSeek Key`);
  await db.init(':memory:');
  const notebook = await db.createNotebook('在线 Agent 测试', '');
  await db.createDocument(notebook.id, '测试资料', '这是一篇只用于在线 Agent 工具循环的测试文档。');

  const requestId = `online-agent-${Date.now()}`;
  const finished = new Promise((resolve, reject) => {
    const webContents = {
      isDestroyed: () => false,
      send: (_channel, event) => {
        if (event.requestId !== requestId) return;
        if (event.type === 'approval-required') {
          agentService.abort(requestId);
          reject(new Error('只读任务不应请求创建文档审批'));
        } else if (event.type === 'error') {
          reject(new Error(event.data.message));
        } else if (event.type === 'end') {
          resolve(event.data);
        }
      }
    };
    agentService.start(webContents, {
      requestId,
      notebookId: notebook.id,
      prompt: '请调用工具列出当前笔记本的文档，然后用一句话告诉我文档标题。不要创建整理稿。'
    });
  });

  const result = await finished;
  assert.equal(result.createdDocumentIds.length, 0);
  assert.match(result.finalText, /测试资料/);
});
