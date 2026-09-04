const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 笔记本
  getAllNotebooks: () => ipcRenderer.invoke('notebook:get-all'),
  createNotebook: (data) => ipcRenderer.invoke('notebook:create', data),
  updateNotebook: (id, data) => ipcRenderer.invoke('notebook:update', id, data),
  deleteNotebook: (id) => ipcRenderer.invoke('notebook:delete', id),

  // 文档
  getDocumentsByNotebook: (notebookId) => ipcRenderer.invoke('document:get-by-notebook', notebookId),
  getDocument: (id) => ipcRenderer.invoke('document:get-by-id', id),
  createDocument: (data, notebookId) => ipcRenderer.invoke('document:create-raw', data, notebookId),
  deleteDocument: (id) => ipcRenderer.invoke('document:delete', id),
  regenSummary: (id) => ipcRenderer.invoke('document:regen-summary', id),
  
  // 本地物理文件选择与解析上传
  selectLocalFile: () => ipcRenderer.invoke('document:select-file'),
  uploadDocumentFile: (filePath, notebookId, additionalContent, title) =>
    ipcRenderer.invoke('document:upload-file', filePath, notebookId, additionalContent, title),
  reindexNotebook: (notebookId) => ipcRenderer.invoke('document:reindex-notebook', notebookId),
  getConfigStatus: () => ipcRenderer.invoke('config:get-status'),

  // 历史消息
  getChatHistory: (sessionId) => ipcRenderer.invoke('chat:get-history', sessionId),
  clearChatHistory: (sessionId) => ipcRenderer.invoke('chat:clear-history', sessionId),

  // RAG 问答流
  askStream: (payload) => ipcRenderer.send('chat:ask-stream', payload),
  abortAsk: (requestId) => ipcRenderer.send('chat:abort', requestId),

  // 监听流式事件返回
  onChatChunk: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('chat:chunk', listener);
    return () => ipcRenderer.removeListener('chat:chunk', listener);
  },
  onChatTokenUsage: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('chat:token-usage', listener);
    return () => ipcRenderer.removeListener('chat:token-usage', listener);
  },
  onChatEnd: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('chat:end', listener);
    return () => ipcRenderer.removeListener('chat:end', listener);
  },
  onChatError: (callback) => {
    const listener = (event, err) => callback(err);
    ipcRenderer.on('chat:error', listener);
    return () => ipcRenderer.removeListener('chat:error', listener);
  },
  onChatSources: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('chat:sources', listener);
    return () => ipcRenderer.removeListener('chat:sources', listener);
  },

  // 笔记本整理 Agent
  startAgent: (payload) => ipcRenderer.invoke('agent:start', payload),
  resolveAgentApproval: (payload) => ipcRenderer.invoke('agent:resolve-approval', payload),
  abortAgent: (requestId) => ipcRenderer.send('agent:abort', requestId),
  onAgentEvent: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  },

  // 联网研究
  startResearch: (payload) => ipcRenderer.invoke('research:start', payload),
  getResearch: (requestId) => ipcRenderer.invoke('research:get', requestId),
  listResearch: (limit) => ipcRenderer.invoke('research:list', limit),
  retryResearch: (payload) => ipcRenderer.invoke('research:retry', payload),
  createResearchNotebook: (payload) => ipcRenderer.invoke('research:create-notebook', payload),
  abortResearch: (requestId) => ipcRenderer.send('research:abort', requestId),
  openResearchSource: (url) => ipcRenderer.invoke('research:open-external', url),
  onResearchEvent: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('research:event', listener);
    return () => ipcRenderer.removeListener('research:event', listener);
  },

  // Graph Lite 概念图
  estimateGraph: (notebookId) => ipcRenderer.invoke('graph:estimate', notebookId),
  getGraph: (notebookId) => ipcRenderer.invoke('graph:get', notebookId),
  buildGraph: (payload) => ipcRenderer.invoke('graph:build', payload),
  abortGraph: (requestId) => ipcRenderer.send('graph:abort', requestId),
  onGraphEvent: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('graph:event', listener);
    return () => ipcRenderer.removeListener('graph:event', listener);
  }
});
