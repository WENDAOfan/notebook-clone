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
  uploadDocumentFile: (filePath, notebookId, additionalContent) => 
    ipcRenderer.invoke('document:upload-file', filePath, notebookId, additionalContent),

  // 历史消息
  getChatHistory: (sessionId) => ipcRenderer.invoke('chat:get-history', sessionId),
  clearChatHistory: (sessionId) => ipcRenderer.invoke('chat:clear-history', sessionId),

  // RAG 问答流
  askStream: (payload) => ipcRenderer.send('chat:ask-stream', payload),
  abortAsk: () => ipcRenderer.send('chat:abort'),

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
    const listener = () => callback();
    ipcRenderer.on('chat:end', listener);
    return () => ipcRenderer.removeListener('chat:end', listener);
  },
  onChatError: (callback) => {
    const listener = (event, err) => callback(err);
    ipcRenderer.on('chat:error', listener);
    return () => ipcRenderer.removeListener('chat:error', listener);
  }
});
