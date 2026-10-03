const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const dns = require('dns');
const { configureStoragePaths } = require('./storage-path');

// Must run before Electron's ready event so Chromium cache and app data share the selected path.
configureStoragePaths(app, {
  appDirectory: __dirname,
  executablePath: process.execPath,
  isPackaged: app.isPackaged,
  defaultUserData: app.getPath('userData')
});

// 强制 Node.js 优先解析 IPv4 地址，规避本地网络环境下 IPv6 不通造成的 fetch failed 问题
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

// 导入核心本地模块
const db = require('./database');
const vectorStore = require('./vector-store');
const ragService = require('./rag-service');
const { invalidateCorruptIndexes } = require('./embedding-client');
const extractor = require('./extractor');
const configService = require('./config-service');
const retrievalService = require('./retrieval-service');
const { applicationPolicy } = require('./retrieval-runtime-policy');
const agentService = require('./agent-service');
const researchService = require('./research-service');
const graphService = require('./graph-service');
const { validateExternalUrl } = require('./research-providers');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: "Notebook Clone Desktop",
  });

  // 加载前端页面
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 默认关闭开发者工具
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 应用程序启动入口：加载数据库和向量库
app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath('userData'), 'notebook.db');
  const vectorStorePath = path.join(app.getPath('userData'), 'vector-store.json');
  
  try {
    const aiStatus = configService.init({
      userDataPath: app.getPath('userData'),
      isPackaged: app.isPackaged
    });
    retrievalService.configure({ thresholds: applicationPolicy(configService.getConfig(), aiStatus) });
    await db.init(dbPath);
    vectorStore.init(vectorStorePath);
    const notebooks = await db.getAllNotebooks();
    const validDocumentIds = [];
    for (const notebook of notebooks) {
      const documents = await db.getDocumentsByNotebook(notebook.id);
      validDocumentIds.push(...documents.map(document => document.id));
    }
    await vectorStore.cleanupOrphans(validDocumentIds);
    // Keep old files, but never present corrupt embeddings as a ready index.
    await invalidateCorruptIndexes(vectorStore.store, id => db.markDocumentIndexStale(id));
  } catch (e) {
    console.error("初始化本地存储系统失败:", e);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  try {
    ragService.abortActiveAsk();
    for (const requestId of agentService.pendingRuns.keys()) {
      agentService.abort(requestId);
    }
    for (const requestId of researchService.pendingRuns.keys()) {
      researchService.abort(requestId, '应用已关闭');
    }
    for (const requestId of graphService.pendingRuns.keys()) {
      graphService.abort(requestId, '应用已关闭');
    }
    await db.close();
  } catch (e) {
    console.error("安全关闭数据库连接失败:", e);
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ==================== IPC 核心桥接监听 ====================

// 1. 笔记本 CRUD
ipcMain.handle('notebook:get-all', async () => {
  try {
    const list = await db.getAllNotebooks();
    return { code: 200, message: "success", data: list };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('notebook:create', async (event, data) => {
  try {
    const nb = await db.createNotebook(data.name, data.description);
    return { code: 200, message: "success", data: nb };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('notebook:update', async (event, id, data) => {
  try {
    const nb = await db.updateNotebook(id, data.name, data.description);
    return { code: 200, message: "success", data: nb };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('notebook:delete', async (event, id) => {
  try {
    const graphRequestId = graphService.activeNotebookRuns.get(Number(id));
    if (graphRequestId) graphService.abort(graphRequestId, '笔记本已删除');
    // 1. 查出所属文档
    const docs = await db.getDocumentsByNotebook(id);
    // 2. 清除相关文档的所有向量分块
    for (const doc of docs) {
      ragService.cancelIndexing(doc.id);
      await vectorStore.deleteByDocumentId(doc.id);
    }
    // 3. 级联删除笔记本数据及文档、聊天消息
    await db.deleteNotebook(id);
    return { code: 200, message: "success", data: null };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

// 2. 文档 CRUD 及处理
ipcMain.handle('document:get-by-notebook', async (event, notebookId) => {
  try {
    const list = await db.getDocumentsByNotebook(notebookId);
    return { code: 200, message: "success", data: list };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('document:get-by-id', async (event, id) => {
  try {
    const doc = await db.getDocumentById(id);
    return { code: 200, message: "success", data: doc };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('document:create-raw', async (event, data, notebookId) => {
  try {
    const { title, content } = data;
    const doc = await db.createDocument(notebookId, title, content, "摘要生成中...", 0);
    // 异步后台任务启动切片和摘要
    ragService.indexDocumentAsync(doc.id);
    return { code: 200, message: "success", data: doc };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('document:delete', async (event, id) => {
  try {
    ragService.cancelIndexing(id);
    // 清理向量分块
    await vectorStore.deleteByDocumentId(id);
    // 级联删除文档及历史
    await db.deleteDocument(id);
    return { code: 200, message: "success", data: null };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('document:regen-summary', async (event, id) => {
  try {
    const doc = await ragService.generateDocumentSummarySync(id);
    return { code: 200, message: "success", data: doc };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

// 本地物理文档解析上传
ipcMain.handle('document:upload-file', async (event, filePath, notebookId, additionalContent, requestedTitle) => {
  try {
    const title = requestedTitle?.trim() || path.basename(filePath);
    const extractedText = await extractor.extractText(filePath);
    
    let finalContent = extractedText;
    if (additionalContent && additionalContent.trim()) {
      finalContent = additionalContent.trim() + "\n\n---\n\n" + extractedText;
    }
    
    const doc = await db.createDocument(
      notebookId,
      title,
      finalContent,
      "摘要生成中...",
      0,
      { origin: 'upload', metadata: { originalFileName: path.basename(filePath) } }
    );
    // 后台异步进行切片与AI摘要
    ragService.indexDocumentAsync(doc.id);
    return { code: 200, message: "success", data: doc };
  } catch (e) {
    console.error("文档上传处理失败:", e);
    return { code: 500, message: e.message, data: null };
  }
});

// 3. 对话历史
ipcMain.handle('chat:get-history', async (event, sessionId) => {
  try {
    const list = await db.getChatHistory(sessionId);
    return { code: 200, message: "success", data: list };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('chat:clear-history', async (event, sessionId) => {
  try {
    await db.clearChatHistory(sessionId);
    return { code: 200, message: "success", data: null };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

// 调用本地物理选择文件弹窗
ipcMain.handle('document:select-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Documents', extensions: ['txt', 'md', 'docx', 'pdf'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('document:reindex-notebook', async (event, notebookId) => {
  try {
    const count = await ragService.reindexNotebook(Number(notebookId));
    return { code: 200, message: 'success', data: { count } };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('config:get-status', async () => ({
  code: 200,
  message: 'success',
  data: configService.getStatus()
}));

// 4. 流式问答触发
ipcMain.on('chat:ask-stream', async (event, payload) => {
  await ragService.handleAskStream(event, payload);
});

// 中止 AI 问答请求
ipcMain.on('chat:abort', (event, requestId) => {
  ragService.abortActiveAsk(requestId);
});

ipcMain.handle('agent:start', async (event, payload) => {
  try {
    return { code: 200, message: 'success', data: agentService.start(event.sender, payload) };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('agent:resolve-approval', async (event, payload) => {
  try {
    return { code: 200, message: 'success', data: agentService.resolveApproval(payload) };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.on('agent:abort', (event, requestId) => {
  agentService.abort(requestId);
});

ipcMain.handle('research:start', async (event, payload) => {
  try {
    return { code: 200, message: 'success', data: await researchService.start(event.sender, payload) };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('research:get', async (event, requestId) => {
  try {
    return { code: 200, message: 'success', data: await db.getResearchRun(requestId) };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('research:list', async (event, limit) => {
  try {
    return { code: 200, message: 'success', data: await db.listResearchRuns(limit) };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('research:retry', async (event, payload) => {
  try {
    return { code: 200, message: 'success', data: await researchService.retry(event.sender, payload) };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('research:create-notebook', async (event, payload) => {
  try {
    return {
      code: 200,
      message: 'success',
      data: await researchService.createNotebook(event.sender, payload)
    };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.on('research:abort', (event, requestId) => {
  researchService.abort(requestId);
});

// 6. Graph Lite 概念图
ipcMain.handle('graph:estimate', async (event, notebookId) => {
  try {
    return { code: 200, message: 'success', data: await graphService.estimate(Number(notebookId)) };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('graph:get', async (event, notebookId) => {
  try {
    return { code: 200, message: 'success', data: await graphService.getGraph(Number(notebookId)) };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.handle('graph:build', async (event, payload) => {
  try {
    return { code: 200, message: 'success', data: await graphService.build(event.sender, payload) };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});

ipcMain.on('graph:abort', (event, requestId) => {
  graphService.abort(requestId);
});

ipcMain.handle('research:open-external', async (event, rawUrl) => {
  try {
    const url = await validateExternalUrl(rawUrl);
    await shell.openExternal(url.toString());
    return { code: 200, message: 'success', data: null };
  } catch (e) {
    return { code: 500, message: e.message, data: null };
  }
});
