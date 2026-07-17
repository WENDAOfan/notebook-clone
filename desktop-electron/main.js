const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dns = require('dns');

// 强制 Node.js 优先解析 IPv4 地址，规避本地网络环境下 IPv6 不通造成的 fetch failed 问题
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

// 导入核心本地模块
const db = require('./database');
const vectorStore = require('./vector-store');
const ragService = require('./rag-service');
const extractor = require('./extractor');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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
    await db.init(dbPath);
    vectorStore.init(vectorStorePath);
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
    // 1. 查出所属文档
    const docs = await db.getDocumentsByNotebook(id);
    // 2. 清除相关文档的所有向量分块
    for (const doc of docs) {
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
ipcMain.handle('document:upload-file', async (event, filePath, notebookId, additionalContent) => {
  try {
    const title = path.basename(filePath);
    const extractedText = await extractor.extractText(filePath);
    
    let finalContent = extractedText;
    if (additionalContent && additionalContent.trim()) {
      finalContent = additionalContent.trim() + "\n\n---\n\n" + extractedText;
    }
    
    const doc = await db.createDocument(notebookId, title, finalContent, "摘要生成中...", 0);
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

// 4. 流式问答触发
ipcMain.on('chat:ask-stream', async (event, payload) => {
  await ragService.handleAskStream(event, payload);
});

// 中止 AI 问答请求
ipcMain.on('chat:abort', () => {
  ragService.abortActiveAsk();
});
