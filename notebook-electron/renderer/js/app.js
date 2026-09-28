// ==================== 全局状态 ====================
let notebooks = [];
let currentNotebookId = null;
let currentDocuments = [];
let currentUser = null;
let authToken = null;
let currentDocumentId = null;
let expandedNotebooks = new Set();
let notebookDocuments = {};
let selectedFile = null;
let currentNotebookQAMode = 'chat';
let activeChatRequestId = null;
let activeAgentRequestId = null;
let pendingAgentApproval = null;
let activeResearchRequestId = null;
let currentResearchRun = null;
let researchCandidates = [];
let researchDefaultSelectedIds = [];
let researchEventCleanup = null;
let currentGraph = null;
let activeGraphRequestId = null;
let graphEventCleanup = null;
let graphConfigReady = true;
let graphViewport = { scale: 1, x: 0, y: 0 };
let graphPositions = new Map();
let graphNodeDrag = null;
window.sessionTokenTotal = 0;

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    researchEventCleanup = window.electronAPI.onResearchEvent(handleResearchEvent);
    graphEventCleanup = window.electronAPI.onGraphEvent(handleGraphEvent);
    checkLoginStatus();
});

// ==================== 登录状态管理 ====================
function checkLoginStatus() {
    authToken = "desktop-local-admin-token";
    currentUser = {
        id: 1,
        username: "管理员"
    };
    showMainApp();
}

function showAuthPage() {
    document.getElementById('authPage').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
}

function showMainApp() {
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('mainApp').style.display = 'flex';
    document.getElementById('currentUsername').textContent = currentUser?.username || '用户';
    loadNotebooks().then(() => restoreFromHash());
    loadConfigStatus();
}

function showRegister() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('registerUsername').value = '';
    document.getElementById('registerPassword').value = '';
    document.getElementById('registerConfirmPassword').value = '';
}

function showLogin() {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
}

// ==================== API 封装 ====================
async function callBridge(promise) {
    try {
        const res = await promise;
        if (res.code !== 200) {
            throw new Error(res.message || '操作失败');
        }
        return res.data;
    } catch (error) {
        console.error('Bridge Error:', error);
        throw error;
    }
}

async function fetchAPI(url, options = {}) {
    try {
        let res;
        
        // 匹配获取单个文档: GET /api/documents/:id
        const docMatch = url.match(/^\/api\/documents\/(\d+)$/);
        if (docMatch && (!options.method || options.method === 'GET')) {
            res = await window.electronAPI.getDocument(Number(docMatch[1]));
            return res.data || res;
        }

        // 匹配对话历史 GET /api/documents/:id/chat/history
        const docHistoryMatch = url.match(/^\/api\/documents\/(\d+)\/chat\/history$/);
        if (docHistoryMatch) {
            if (options.method === 'DELETE') {
                res = await window.electronAPI.clearChatHistory("doc:" + docHistoryMatch[1]);
            } else {
                res = await window.electronAPI.getChatHistory("doc:" + docHistoryMatch[1]);
            }
            return res.data || res;
        }

        // 匹配对话历史 GET /api/notebooks/:id/chat/history
        const notebookHistoryMatch = url.match(/^\/api\/notebooks\/(\d+)\/chat\/history$/);
        if (notebookHistoryMatch) {
            if (options.method === 'DELETE') {
                res = await window.electronAPI.clearChatHistory("notebook:" + notebookHistoryMatch[1]);
            } else {
                res = await window.electronAPI.getChatHistory("notebook:" + notebookHistoryMatch[1]);
            }
            return res.data || res;
        }

        throw new Error(`未匹配的本地 IPC 通信路由: ${url}`);
    } catch (error) {
        console.error('fetchAPI Router Error:', error);
        throw error;
    }
}

// 占位认证相关接口以防前端其它代码报错
async function loginAPI(username, password) { return { token: "local-token" }; }
async function registerAPI(username, password) { return {}; }
async function login() {}
async function register() {}
function logout() {
    showToast('本地桌面端无法退出登录', 'info');
}

// ==================== 笔记本相关 API ====================
async function getAllNotebooks() {
    return callBridge(window.electronAPI.getAllNotebooks());
}

async function createNotebookAPI(data) {
    return callBridge(window.electronAPI.createNotebook(data));
}

async function updateNotebookAPI(id, data) {
    return callBridge(window.electronAPI.updateNotebook(id, data));
}

async function deleteNotebookAPI(id) {
    return callBridge(window.electronAPI.deleteNotebook(id));
}

// ==================== 文档相关 API ====================
async function generateSummaryAPI(id) {
    return callBridge(window.electronAPI.regenSummary(id));
}

async function getDocumentsByNotebook(notebookId) {
    return callBridge(window.electronAPI.getDocumentsByNotebook(notebookId));
}

async function createDocumentAPI(data, notebookId) {
    return callBridge(window.electronAPI.createDocument(data, notebookId));
}

async function deleteDocumentAPI(id) {
    return callBridge(window.electronAPI.deleteDocument(id));
}

// Electron 文件上传：通过本地文件路径传递给主进程解析
async function uploadDocumentFileAPI(filePath, notebookId, additionalContent, title) {
    return callBridge(window.electronAPI.uploadDocumentFile(filePath, notebookId, additionalContent, title));
}

async function askDocumentAPI(documentId, question, useDocumentContext) {
    return callBridge(window.electronAPI.askDocument(documentId, question, useDocumentContext));
}

async function askNotebookAPI(notebookId, question) {
    return fetchAPI(`/api/notebooks/${notebookId}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question }),
    });
}

// ==================== SSE 流式请求封装 (Electron IPC 桥接版本) ====================
let activeAskPromiseReject = null;

// 点击停止问答时的逻辑
function abortAsk() {
    if (activeChatRequestId) {
        window.electronAPI.abortAsk(activeChatRequestId);
    }
    if (activeAskPromiseReject) {
        activeAskPromiseReject(new Error("用户取消了生成"));
        activeAskPromiseReject = null;
    }
}

function createRequestId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function askDocumentStreamAPI(documentId, question, useDocumentContext, onChunk, onTokenUsage, onSources) {
    return new Promise((resolve, reject) => {
        const requestId = createRequestId('chat-doc');
        activeChatRequestId = requestId;
        activeAskPromiseReject = reject;

        const cleanChunk = window.electronAPI.onChatChunk((data) => {
            if (data.requestId === requestId) onChunk(data.text);
        });
        
        let finalUsage = null;
        const cleanUsage = window.electronAPI.onChatTokenUsage((data) => {
            if (data.requestId !== requestId) return;
            finalUsage = data.usage;
            if (onTokenUsage) onTokenUsage(data.usage);
        });
        const cleanSources = window.electronAPI.onChatSources((data) => {
            if (data.requestId === requestId && onSources) onSources(data.sources || [], data.diagnostics);
        });

        const cleanEnd = window.electronAPI.onChatEnd((data) => {
            if (data.requestId !== requestId) return;
            cleanAll();
            resolve(finalUsage);
        });

        const cleanError = window.electronAPI.onChatError((data) => {
            if (data.requestId !== requestId) return;
            cleanAll();
            reject(new Error(data.message));
        });

        function cleanAll() {
            cleanChunk();
            cleanUsage();
            cleanSources();
            cleanEnd();
            cleanError();
            activeAskPromiseReject = null;
            if (activeChatRequestId === requestId) activeChatRequestId = null;
        }

        window.electronAPI.askStream({
            requestId,
            id: Number(documentId),
            type: 'doc',
            question: question,
            useDocContext: useDocumentContext
        });
    });
}

function askNotebookStreamAPI(notebookId, question, onChunk, onTokenUsage, onSources) {
    return new Promise((resolve, reject) => {
        const requestId = createRequestId('chat-notebook');
        activeChatRequestId = requestId;
        activeAskPromiseReject = reject;

        const cleanChunk = window.electronAPI.onChatChunk((data) => {
            if (data.requestId === requestId) onChunk(data.text);
        });
        
        let finalUsage = null;
        const cleanUsage = window.electronAPI.onChatTokenUsage((data) => {
            if (data.requestId !== requestId) return;
            finalUsage = data.usage;
            if (onTokenUsage) onTokenUsage(data.usage);
        });
        const cleanSources = window.electronAPI.onChatSources((data) => {
            if (data.requestId === requestId && onSources) onSources(data.sources || [], data.diagnostics);
        });

        const cleanEnd = window.electronAPI.onChatEnd((data) => {
            if (data.requestId !== requestId) return;
            cleanAll();
            resolve(finalUsage);
        });

        const cleanError = window.electronAPI.onChatError((data) => {
            if (data.requestId !== requestId) return;
            cleanAll();
            reject(new Error(data.message));
        });

        function cleanAll() {
            cleanChunk();
            cleanUsage();
            cleanSources();
            cleanEnd();
            cleanError();
            activeAskPromiseReject = null;
            if (activeChatRequestId === requestId) activeChatRequestId = null;
        }

        window.electronAPI.askStream({
            requestId,
            id: Number(notebookId),
            type: 'notebook',
            question: question,
            useDocContext: true
        });
    });
}

// ==================== 视图切换 ====================
function showEmptyView() {
    document.getElementById('emptyView').style.display = 'flex';
    document.getElementById('notebookView').style.display = 'none';
    document.getElementById('documentView').style.display = 'none';
    updateHash();
}

function showNotebookView() {
    document.getElementById('emptyView').style.display = 'none';
    document.getElementById('notebookView').style.display = 'flex';
    document.getElementById('documentView').style.display = 'none';
    
    const notebook = notebooks.find(n => n.id === currentNotebookId);
    if (notebook) {
        document.getElementById('notebookViewTitle').textContent = escapeHtml(notebook.name);
    }
    
    const badge = document.getElementById('notebookDocCountBadge');
    if (badge) {
        badge.textContent = (currentDocuments?.length || 0) + ' 篇文档';
    }
    
    const panel = document.getElementById('notebookQAPanel');
    if (panel && currentNotebookId) {
        panel.style.display = 'block';
    }
    
    renderDocumentCards();
    renderNotebookTree();
}

function showDocumentView() {
    document.getElementById('emptyView').style.display = 'none';
    document.getElementById('notebookView').style.display = 'none';
    document.getElementById('documentView').style.display = 'flex';
    renderNotebookTree();
}

// ==================== Hash 路由（刷新保持视图）====================

/** 将当前视图位置写入 URL hash（用 replaceState 避免产生大量历史记录）*/
function updateHash() {
    if (currentDocumentId && currentNotebookId) {
        history.replaceState(null, '', `#notebook/${currentNotebookId}/document/${currentDocumentId}`);
    } else if (currentNotebookId) {
        history.replaceState(null, '', `#notebook/${currentNotebookId}`);
    } else {
        history.replaceState(null, '', '#');
    }
}

/** 页面加载后从 URL hash 恢复视图状态 */
async function restoreFromHash() {
    const hash = window.location.hash;
    if (!hash || hash === '#') return;

    // 解析 #notebook/3 或 #notebook/3/document/5
    const match = hash.match(/^#notebook\/(\d+)(?:\/document\/(\d+))?$/);
    if (!match) return;

    const notebookId = parseInt(match[1]);
    const documentId = match[2] ? parseInt(match[2]) : null;

    // 确认笔记本存在
    const notebook = notebooks.find(n => n.id === notebookId);
    if (!notebook) return;

    await selectNotebook(notebookId);

    if (documentId) {
        const doc = currentDocuments.find(d => d.id === documentId);
        if (doc) {
            await selectDocument(documentId);
        }
    }
}

// ==================== 树形侧栏渲染 ====================
function renderNotebookTree() {
    const container = document.getElementById('notebookTree');
    
    if (notebooks.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;">
                <div class="empty-state-icon">📭</div>
                <p>还没有笔记本</p>
                <p style="font-size: 12px; margin-top: 8px;">点击 + 按钮创建</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    for (const notebook of notebooks) {
        const isExpanded = expandedNotebooks.has(notebook.id);
        const isActive = notebook.id === currentNotebookId;
        const docs = notebookDocuments[notebook.id] || [];
        const notebookBadge = notebook.origin === 'research'
            ? '<span class="origin-research-badge">研究</span>'
            : '';
        
        html += `<div class="tree-notebook-item ${isActive ? 'active' : ''}" 
                       onclick="selectNotebook(${notebook.id})" 
                       title="${escapeHtml(notebook.description || '')}">
            <span class="tree-toggle" onclick="toggleNotebook(${notebook.id}, event)">${isExpanded ? '▼' : '▶'}</span>
            <span class="tree-notebook-icon">📁</span>
            <span class="tree-notebook-name">${escapeHtml(notebook.name)}</span>
            ${notebookBadge}
        </div>`;
        
        if (isExpanded && docs.length > 0) {
            html += '<div class="tree-documents">';
            for (const doc of docs) {
                const isDocActive = doc.id === currentDocumentId;
                html += `<div class="tree-document-item ${isDocActive ? 'active' : ''}" 
                               onclick="selectDocument(${doc.id}, event, ${notebook.id})" 
                               title="${escapeHtml(doc.title)}">
                    <span class="tree-doc-icon">📄</span>
                    <span class="tree-doc-name">${escapeHtml(doc.title)}</span>
                </div>`;
            }
            html += '</div>';
        }
    }
    
    container.innerHTML = html;
}

// ==================== 文档卡片渲染（笔记本视图） ====================
function renderDocumentCards() {
    const container = document.getElementById('documentCards');
    
    if (currentDocuments.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 60px 20px;">
                <div class="empty-state-icon">📝</div>
                <p>这个笔记本还没有文档</p>
                <p style="font-size: 12px; margin-top: 8px;">点击上方按钮创建或上传</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = currentDocuments.map(doc => {
        const isGenerating = doc.summary === '摘要生成中...';
        const hasSummary = doc.summary && doc.summary !== '内容过短，无需摘要' && !isGenerating;
        const isShort = doc.summary === '内容过短，无需摘要';
        const canGenerate = !hasSummary && !isShort && !isGenerating && doc.content && doc.content.length >= 50;
        const status = doc.index_status || 'pending';
        const statusLabels = {
            pending: '待索引',
            indexing: '索引中',
            ready: '索引完成',
            failed: '索引失败',
            stale: '索引待更新'
        };
        const originBadge = doc.origin === 'agent'
            ? '<span class="origin-agent-badge">Agent 整理稿</span>'
            : doc.origin === 'research-source'
                ? '<span class="origin-research-source-badge">联网来源</span>'
                : doc.origin === 'research-guide'
                    ? '<span class="origin-research-guide-badge">研究导读</span>'
                    : '';
        const indexBadge = `<span class="index-status-badge ${escapeHtml(status)}" title="${escapeHtml(doc.index_error || '')}">${escapeHtml(statusLabels[status] || status)}</span>`;
        const sourceAction = doc.origin === 'research-source' && doc.metadata?.url
            ? `<button class="btn btn-secondary btn-small" onclick="openStoredResearchSource(${doc.id}, event)">打开原始网页</button>`
            : '';

        let summaryHtml = '';
        if (isGenerating) {
            summaryHtml = '<div class="summary-row"><span class="summary-loading">🤖 AI 摘要正在生成中，请稍后刷新...</span></div>';
        } else if (hasSummary) {
            summaryHtml = `
                <div class="summary-row">
                    <div class="summary-preview collapsed" id="summary-preview-${doc.id}">
                        <span class="summary-label">🤖 AI摘要：</span>
                        <span class="summary-text">${escapeHtml(doc.summary)}</span>
                    </div>
                    <div class="summary-actions">
                        <button class="summary-toggle-btn" onclick="toggleSummaryPreview(${doc.id}, event)">展开</button>
                        <button class="summary-regen-btn" onclick="regenerateSummary(${doc.id}, event)">🔄 重新生成</button>
                    </div>
                </div>
            `;
        } else if (isShort) {
            summaryHtml = '<div class="summary-row"><span class="summary-hint">📝 内容过短，无需摘要</span></div>';
        } else if (canGenerate) {
            summaryHtml = `<div class="summary-row"><button class="summary-gen-btn" onclick="generateSummary(${doc.id}, event)">🤖 生成摘要</button></div>`;
        }
        
        return `
        <div class="document-card" onclick="selectDocument(${doc.id})">
            <span class="document-icon">📄</span>
            <div class="document-info">
                <div class="document-title">${escapeHtml(doc.title)}${originBadge}${indexBadge}</div>
                <div class="document-meta">
                    创建于 ${formatDate(doc.create_time)}
                    ${doc.content ? ` · ${formatFileSize(doc.content.length)}` : ''}
                </div>
                ${summaryHtml}
            </div>
            <div class="document-actions">
                ${sourceAction}
                <button class="btn btn-danger btn-small" onclick="deleteDocument(${doc.id}, event)">删除</button>
            </div>
        </div>
        `;
    }).join('');
}

// ==================== 事件处理 ====================
async function loadNotebooks() {
    try {
        notebooks = await getAllNotebooks();
        renderNotebookTree();
    } catch (error) {
        showToast('加载笔记本失败: ' + error.message, 'error');
    }
}

async function selectNotebook(id) {
    currentNotebookId = id;
    currentDocumentId = null;
    expandedNotebooks.add(id);
    
    try {
        currentDocuments = await getDocumentsByNotebook(id);
        notebookDocuments[id] = currentDocuments;
        
        showNotebookView();
        resetNotebookQA();
        
        document.getElementById('btnRename').disabled = false;
        document.getElementById('btnDeleteNotebook').disabled = false;
        
        updateHash();
    } catch (error) {
        showToast('加载文档失败: ' + error.message, 'error');
    }
}

function toggleNotebook(id, event) {
    event.stopPropagation();
    if (expandedNotebooks.has(id)) {
        expandedNotebooks.delete(id);
    } else {
        expandedNotebooks.add(id);
    }
    renderNotebookTree();
}

async function selectDocument(id, event, notebookId) {
    if (event) event.stopPropagation();
    
    // 跨笔记本点击：先切换到文档所属的笔记本，再选中该文档
    if (notebookId && notebookId !== currentNotebookId) {
        await selectNotebook(notebookId);
    }
    
    currentDocumentId = id;
    
    const doc = currentDocuments.find(d => d.id === id);
    if (!doc) return;
    
    document.getElementById('docViewTitle').textContent = doc.title;
    document.getElementById('docViewTitle').dataset.documentId = id;
    
    // 摘要区域
    const summaryBox = document.getElementById('docSummaryBox');
    const summaryText = document.getElementById('docSummaryText');
    const regenBtn = document.getElementById('docSummaryRegenBtn');
    
    if (doc.summary === '摘要生成中...') {
        summaryBox.style.display = 'block';
        summaryText.textContent = '🤖 AI 摘要正在生成中，请稍后刷新...';
        summaryText.classList.add('summary-hint');
        regenBtn.style.display = 'inline-flex';
        regenBtn.textContent = '🔄 手动生成';
        regenBtn.onclick = () => regenerateSummary(id);
    } else if (doc.summary && doc.summary.startsWith('摘要生成失败')) {
        summaryBox.style.display = 'block';
        summaryText.textContent = '⚠️ ' + doc.summary;
        summaryText.classList.add('summary-hint');
        regenBtn.style.display = 'inline-flex';
        regenBtn.textContent = '🔄 重新生成';
        regenBtn.onclick = () => regenerateSummary(id);
    } else if (doc.summary && doc.summary !== '内容过短，无需摘要') {
        summaryBox.style.display = 'block';
        summaryText.textContent = doc.summary;
        summaryText.classList.remove('summary-hint');
        regenBtn.style.display = 'inline-flex';
        regenBtn.textContent = '🔄 重新生成';
        regenBtn.onclick = () => regenerateSummary(id);
    } else if (doc.summary === '内容过短，无需摘要') {
        summaryBox.style.display = 'block';
        summaryText.textContent = '📝 内容过短，无需摘要';
        summaryText.classList.add('summary-hint');
        regenBtn.style.display = 'none';
    } else {
        summaryBox.style.display = 'block';
        summaryText.textContent = '暂无摘要，点击下方按钮生成';
        summaryText.classList.add('summary-hint');
        regenBtn.style.display = 'inline-flex';
        regenBtn.textContent = '🤖 生成摘要';
        regenBtn.onclick = () => generateSummary(id);
    }
    
    document.getElementById('docContent').textContent = doc.content || '（无内容）';
    
    // 默认折叠文档原文，显示预览提示
    document.getElementById('docContent').style.display = 'none';
    document.getElementById('docContentToggle').textContent = '▶';
    const hint = document.getElementById('docContentHint');
    if (doc.content && doc.content.length > 0) {
        const preview = doc.content.substring(0, 50).replace(/\n/g, ' ');
        hint.textContent = preview + (doc.content.length > 50 ? '...' : '') + ` (${formatFileSize(doc.content.length)})`;
    } else {
        hint.textContent = '（无内容）';
    }
    
    // 重置问答区域
    document.getElementById('qaContextSwitch').checked = true;
    document.getElementById('qaInput').value = '';
    
    showDocumentView();

    // Day 30：加载该文档的对话历史
    loadDocChatHistory(id);

    updateHash();
}

function backToNotebook() {
    currentDocumentId = null;
    showNotebookView();
    updateHash();
}

function toggleDocContent() {
    const content = document.getElementById('docContent');
    const toggle = document.getElementById('docContentToggle');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        toggle.textContent = '▼';
    } else {
        content.style.display = 'none';
        toggle.textContent = '▶';
    }
}

async function createNotebook() {
    const name = document.getElementById('notebookName').value.trim();
    const description = document.getElementById('notebookDescription').value.trim();
    
    if (!name) {
        showToast('请输入笔记本名称', 'error');
        return;
    }
    
    try {
        const newNotebook = await createNotebookAPI({ name, description });
        closeModal('createNotebookModal');
        document.getElementById('notebookName').value = '';
        document.getElementById('notebookDescription').value = '';
        showToast('笔记本创建成功', 'success');
        await loadNotebooks();
        // 自动选中新建的笔记本，让用户立即看到内容
        if (newNotebook && newNotebook.id) {
            await selectNotebook(newNotebook.id);
        }
    } catch (error) {
        showToast('创建失败: ' + error.message, 'error');
    }
}

async function renameNotebook() {
    if (!currentNotebookId) return;
    
    const name = document.getElementById('renameNotebookName').value.trim();
    const description = document.getElementById('renameNotebookDescription').value.trim();
    
    if (!name) {
        showToast('请输入笔记本名称', 'error');
        return;
    }
    
    try {
        await updateNotebookAPI(currentNotebookId, { name, description });
        closeModal('renameNotebookModal');
        showToast('笔记本修改成功', 'success');
        await loadNotebooks();
        if (currentNotebookId) {
            showNotebookView();
        }
    } catch (error) {
        showToast('修改失败: ' + error.message, 'error');
    }
}

async function deleteCurrentNotebook() {
    if (!currentNotebookId) return;
    
    const notebook = notebooks.find(n => n.id === currentNotebookId);
    if (!confirm(`确定要删除笔记本 "${notebook?.name}" 吗？\n注意：该笔记本下的所有文档也会被删除！`)) {
        return;
    }
    
    try {
        await deleteNotebookAPI(currentNotebookId);
        delete notebookDocuments[currentNotebookId];
        currentNotebookId = null;
        currentDocumentId = null;
        currentDocuments = [];
        showToast('笔记本删除成功', 'success');
        await loadNotebooks();
        showEmptyView();
        document.getElementById('btnRename').disabled = true;
        document.getElementById('btnDeleteNotebook').disabled = true;
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
}

async function createDocument() {
    if (!currentNotebookId) return;
    
    const title = document.getElementById('documentTitle').value.trim();
    const hasText = document.getElementById('checkText').checked;
    const fileChecked = document.getElementById('checkFile').checked;
    const hasFile = fileChecked && selectedFile;
    
    if (!title) {
        showToast('请输入文档标题', 'error');
        return;
    }
    
    if (fileChecked && !selectedFile) {
        showToast('请先选择一个文件', 'error');
        return;
    }
    
    if (!hasText && !hasFile) {
        showToast('请至少输入内容或上传文件', 'error');
        return;
    }
    
    try {
        if (hasFile) {
            // 有文件：走 upload 接口（可能同时有手动输入内容）
            const additionalContent = hasText ? document.getElementById('documentContent').value : null;
            showUploadOverlay();
            const uploadedDoc = await uploadDocumentFileAPI(
                selectedFile,
                currentNotebookId,
                additionalContent,
                title
            );
            hideUploadOverlay();
            showToast('文档创建成功，摘要生成中...', 'success');
            closeModal('createDocumentModal');
            resetDocCreateModal();
            currentDocuments.push(uploadedDoc);
            notebookDocuments[currentNotebookId] = currentDocuments;
            showNotebookView();
            pollSummaryReady(uploadedDoc.id, 1, 60);
        } else {
            // 纯文本：走 JSON 创建接口
            const content = document.getElementById('documentContent').value;
            const newDoc = await createDocumentAPI({ title, content }, currentNotebookId);
            closeModal('createDocumentModal');
            resetDocCreateModal();
            showToast('文档创建成功', 'success');
            currentDocuments = await getDocumentsByNotebook(currentNotebookId);
            notebookDocuments[currentNotebookId] = currentDocuments;
            
            if (newDoc && newDoc.id) {
                await selectDocument(newDoc.id);
            } else {
                showNotebookView();
            }
        }
    } catch (error) {
        hideUploadOverlay();
        showToast('创建失败: ' + error.message, 'error');
    }
}

async function deleteDocument(idOrEvent, event) {
    let id = idOrEvent;
    let evt = event;
    
    // 支持两种调用方式：deleteDocument() 和 deleteDocument(id, event)
    if (typeof idOrEvent === 'object') {
        id = currentDocumentId;
        evt = idOrEvent;
    }
    
    if (evt) evt.stopPropagation();
    if (!id) return;
    if (!confirm('确定要删除这个文档吗？')) return;
    
    try {
        await deleteDocumentAPI(id);
        showToast('文档删除成功', 'success');
        currentDocuments = await getDocumentsByNotebook(currentNotebookId);
        notebookDocuments[currentNotebookId] = currentDocuments;
        
        if (currentDocumentId === id) {
            currentDocumentId = null;
            showNotebookView();
        } else {
            showNotebookView();
        }
        
        updateHash();
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
}

// ==================== Day 30：对话历史相关 ====================

/** 追加用户气泡 */
function appendUserBubble(container, text) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble user';
    bubble.innerHTML = `
        <div class="chat-avatar">🧑</div>
        <div class="chat-body">
            <div class="chat-text">${escapeHtml(text)}</div>
        </div>
    `;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
}

/** 追加 AI 气泡，返回可操作的元素引用 */
function appendAiBubble(container) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant';

    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = '🤖';

    const body = document.createElement('div');
    body.className = 'chat-body';

    const textEl = document.createElement('div');
    textEl.className = 'chat-text';

    const citationEl = document.createElement('div');
    citationEl.className = 'citations-container';
    citationEl.style.display = 'none';

    const tokenEl = document.createElement('div');
    tokenEl.className = 'token-usage-container';
    tokenEl.style.display = 'none';

    body.appendChild(textEl);
    body.appendChild(citationEl);
    body.appendChild(tokenEl);
    bubble.appendChild(avatar);
    bubble.appendChild(body);
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;

    return { bubble, textEl, citationEl, tokenEl, rawText: '' };
}

/** 渲染历史消息列表 */
function renderChatHistory(history, container, defaultTitle) {
    container.innerHTML = '';
    for (const msg of history) {
        if (msg.role === 'user') {
            appendUserBubble(container, msg.content);
        } else {
            const ai = appendAiBubble(container);
            const legacy = parseCitations(msg.content, defaultTitle);
            const answer = legacy.answer;
            const citations = Array.isArray(msg.metadata?.sources)
                ? structuredSourcesToCitations(msg.metadata.sources, answer)
                : legacy.citations;
            ai.textEl.innerHTML = DOMPurify.sanitize(marked.parse(answer));
            if (citations.length > 0) {
                renderCitationCards(citations, ai.citationEl);
            }
            renderRetrievalDiagnostics(msg.metadata?.retrieval, ai.citationEl);
        }
    }
    container.scrollTop = container.scrollHeight;
}

function structuredSourcesToCitations(sources, answer = '') {
    const referenced = new Set(
        [...String(answer).matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]))
    );
    const normalized = (sources || []).map(source => ({
        id: String(source.citationId),
        title: source.documentTitle || '参考来源',
        snippet: source.snippet || ''
    }));
    if (referenced.size === 0) return normalized;
    return normalized.filter(source => referenced.has(Number(source.id)));
}

function renderRetrievalDiagnostics(diagnostics, container) {
    if (!diagnostics) return;
    container.style.display = 'block';
    if (diagnostics.warnings?.length) {
        const notice = document.createElement('p');
        notice.textContent = diagnostics.warnings.join('\n');
        container.appendChild(notice);
    }
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '检索诊断';
    const body = document.createElement('pre');
    body.style.whiteSpace = 'pre-wrap';
    body.textContent = JSON.stringify(diagnostics, null, 2);
    details.append(summary, body);
    container.appendChild(details);
}

/** 加载文档对话历史 */
async function loadDocChatHistory(docId) {
    const container = document.getElementById('docChatHistory');
    const clearBtn = document.getElementById('docClearChatBtn');
    if (container) container.innerHTML = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (!docId) return;
    try {
        const history = await fetchAPI(`/api/documents/${docId}/chat/history`);
        if (history && history.length > 0 && container) {
            const docTitle = document.getElementById('docViewTitle').textContent;
            renderChatHistory(history, container, docTitle);
            if (clearBtn) clearBtn.style.display = 'inline-flex';
        }
    } catch (e) {
        console.warn('加载文档对话历史失败:', e);
    }
}

/** 加载笔记本对话历史 */
async function loadNotebookChatHistory(notebookId) {
    const container = document.getElementById('notebookChatHistory');
    const clearBtn = document.getElementById('notebookClearChatBtn');
    if (container) container.innerHTML = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (!notebookId) return;
    try {
        const history = await fetchAPI(`/api/notebooks/${notebookId}/chat/history`);
        if (history && history.length > 0 && container) {
            const notebook = notebooks.find(n => n.id === notebookId);
            renderChatHistory(history, container, notebook ? notebook.name : '笔记本问答');
            if (clearBtn) clearBtn.style.display = 'inline-flex';
        }
    } catch (e) {
        console.warn('加载笔记本对话历史失败:', e);
    }
}

/** 清空文档对话历史 */
async function clearDocChat() {
    const currentDocId = document.getElementById('docViewTitle').dataset.documentId;
    if (!currentDocId) return;
    if (!confirm('确定要清空当前文档的对话历史吗？')) return;
    try {
        await fetchAPI(`/api/documents/${currentDocId}/chat/history`, { method: 'DELETE' });
        const container = document.getElementById('docChatHistory');
        if (container) container.innerHTML = '';
        document.getElementById('docClearChatBtn').style.display = 'none';
        showToast('对话已清空', 'success');
    } catch (e) {
        showToast('清空失败: ' + e.message, 'error');
    }
}

/** 清空笔记本对话历史 */
async function clearNotebookChat() {
    if (!currentNotebookId) return;
    if (!confirm('确定要清空当前笔记本的对话历史吗？')) return;
    try {
        if (currentNotebookQAMode === 'agent') {
            await callBridge(window.electronAPI.clearChatHistory(`agent:notebook:${currentNotebookId}`));
        } else {
            await fetchAPI(`/api/notebooks/${currentNotebookId}/chat/history`, { method: 'DELETE' });
        }
        const container = document.getElementById('notebookChatHistory');
        if (container) container.innerHTML = '';
        document.getElementById('notebookClearChatBtn').style.display = 'none';
        showToast('对话已清空', 'success');
    } catch (e) {
        showToast('清空失败: ' + e.message, 'error');
    }
}

/** Token 用量 HTML（用于插入 AI 气泡内部） */
function renderTokenUsageHtml(usage) {
    if (!usage) return '';
    const cost = (usage.total * 0.0015 / 1000).toFixed(4);
    return `
        <div class="token-usage-card">
            <span class="token-usage-icon">📊</span>
            <span class="token-usage-text">Token | 输入：${usage.prompt} | 输出：${usage.completion} | 总计：${usage.total}</span>
            <span class="token-usage-cost">💰 约 ¥${cost}</span>
        </div>
    `;
}

// ==================== 文档问答 ====================
async function askDocument() {
    const input = document.getElementById('qaInput');
    const question = input.value.trim();
    const currentDocId = document.getElementById('docViewTitle').dataset.documentId;
    const useDocumentContext = document.getElementById('qaContextSwitch').checked;

    if (!question) {
        showToast('请输入问题', 'warning');
        return;
    }

    const chatHistory = document.getElementById('docChatHistory');

    // 1. 追加用户气泡
    appendUserBubble(chatHistory, question);
    input.value = '';

    // 2. 创建 AI 气泡（流式输出）
    const ai = appendAiBubble(chatHistory);
    ai.textEl.classList.add('streaming');
    showToast('AI 正在思考...', 'info');

    let currentUsage = null;
    let currentSources = [];
    let currentDiagnostics = null;

    try {
        await askDocumentStreamAPI(
            currentDocId,
            question,
            useDocumentContext,
            (chunk) => {
                ai.rawText += chunk;
                const currentDocTitle = document.getElementById('docViewTitle').textContent;
                const { answer } = parseCitations(ai.rawText, currentDocTitle);
                ai.textEl.innerHTML = DOMPurify.sanitize(marked.parse(answer));
                chatHistory.scrollTop = chatHistory.scrollHeight;
            },
            (usage) => {
                currentUsage = usage;
            },
            (sources, diagnostics) => {
                currentSources = sources;
                currentDiagnostics = diagnostics;
            }
        );

        showToast('回答完成', 'success');
    } catch (error) {
        showToast('回答失败：' + error.message, 'error');
        ai.rawText = '获取回答失败，请稍后重试。';
        ai.textEl.textContent = ai.rawText;
    } finally {
        ai.textEl.classList.remove('streaming');

        // 解析引用并替换文本
        const currentDocTitle = document.getElementById('docViewTitle').textContent;
        const legacy = parseCitations(ai.rawText, currentDocTitle);
        const answer = legacy.answer;
        const citations = structuredSourcesToCitations(currentSources, answer);
        ai.textEl.innerHTML = DOMPurify.sanitize(marked.parse(answer));

        if (citations.length > 0) {
            renderCitationCards(citations, ai.citationEl);
        }
        renderRetrievalDiagnostics(currentDiagnostics, ai.citationEl);

        if (currentUsage) {
            ai.tokenEl.innerHTML = renderTokenUsageHtml(currentUsage);
            ai.tokenEl.style.display = 'block';
            accumulateSessionTokens(currentUsage.total);
        }

        // 有对话后显示清空按钮
        document.getElementById('docClearChatBtn').style.display = 'inline-flex';
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }
}

// ==================== 笔记本问答 ====================
function toggleNotebookQA() {
    const content = document.getElementById('notebookQAContent');
    const chevron = document.getElementById('notebookQAChevron');
    if (!content) return;
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        if (chevron) chevron.textContent = '▲';
    } else {
        content.style.display = 'none';
        if (chevron) chevron.textContent = '▼';
    }
}

function resetNotebookQA() {
    const input = document.getElementById('notebookQAInput');
    if (input) input.value = '';
    const agentInput = document.getElementById('notebookAgentInput');
    if (agentInput) agentInput.value = '';
    if (currentNotebookQAMode === 'agent') {
        loadNotebookAgentHistory(currentNotebookId);
    } else {
        loadNotebookChatHistory(currentNotebookId);
    }
}

async function askNotebook() {
    const input = document.getElementById('notebookQAInput');
    const question = input.value.trim();

    if (!question) {
        showToast('请输入问题', 'warning');
        return;
    }

    const chatHistory = document.getElementById('notebookChatHistory');

    // 1. 追加用户气泡
    appendUserBubble(chatHistory, question);
    input.value = '';

    // 2. 创建 AI 气泡（流式输出）
    const ai = appendAiBubble(chatHistory);
    ai.textEl.classList.add('streaming');
    showToast('AI 正在综合多篇文档思考...', 'info');

    let currentUsage = null;
    let currentSources = [];
    let currentDiagnostics = null;

    try {
        await askNotebookStreamAPI(
            currentNotebookId,
            question,
            (chunk) => {
                ai.rawText += chunk;
                const { answer } = parseCitations(ai.rawText);
                ai.textEl.innerHTML = DOMPurify.sanitize(marked.parse(answer));
                chatHistory.scrollTop = chatHistory.scrollHeight;
            },
            (usage) => {
                currentUsage = usage;
            },
            (sources, diagnostics) => {
                currentSources = sources;
                currentDiagnostics = diagnostics;
            }
        );

        showToast('回答完成', 'success');
    } catch (error) {
        showToast('回答失败：' + error.message, 'error');
        ai.rawText = '获取回答失败，请稍后重试。';
        ai.textEl.textContent = ai.rawText;
    } finally {
        ai.textEl.classList.remove('streaming');

        const legacy = parseCitations(ai.rawText);
        const answer = legacy.answer;
        const citations = structuredSourcesToCitations(currentSources, answer);
        ai.textEl.innerHTML = DOMPurify.sanitize(marked.parse(answer));

        if (citations.length > 0) {
            renderCitationCards(citations, ai.citationEl);
        }
        renderRetrievalDiagnostics(currentDiagnostics, ai.citationEl);

        if (currentUsage) {
            ai.tokenEl.innerHTML = renderTokenUsageHtml(currentUsage);
            ai.tokenEl.style.display = 'block';
            accumulateSessionTokens(currentUsage.total);
        }

        document.getElementById('notebookClearChatBtn').style.display = 'inline-flex';
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }
}

// ==================== 笔记本整理 Agent ====================
function switchNotebookQAMode(mode) {
    currentNotebookQAMode = mode === 'agent' ? 'agent' : 'chat';
    document.getElementById('qaModeChat').classList.toggle('active', currentNotebookQAMode === 'chat');
    document.getElementById('qaModeAgent').classList.toggle('active', currentNotebookQAMode === 'agent');
    document.getElementById('notebookChatInputBox').style.display = currentNotebookQAMode === 'chat' ? 'flex' : 'none';
    document.getElementById('notebookAgentInputBox').style.display = currentNotebookQAMode === 'agent' ? 'flex' : 'none';
    document.getElementById('agentTimeline').style.display = currentNotebookQAMode === 'agent' ? 'block' : 'none';
    document.getElementById('notebookQADescription').textContent = currentNotebookQAMode === 'agent'
        ? 'Agent 会自主检索和阅读当前笔记本；创建整理稿前必须由你逐次批准'
        : '基于当前笔记本内的所有文档内容，综合回答你的问题';
    document.getElementById('notebookChatHistory').innerHTML = '';
    if (currentNotebookQAMode === 'agent') {
        loadNotebookAgentHistory(currentNotebookId);
    } else {
        loadNotebookChatHistory(currentNotebookId);
    }
}

async function loadNotebookAgentHistory(notebookId) {
    const container = document.getElementById('notebookChatHistory');
    const clearBtn = document.getElementById('notebookClearChatBtn');
    container.innerHTML = '';
    clearBtn.style.display = 'none';
    if (!notebookId) return;
    try {
        const history = await callBridge(
            window.electronAPI.getChatHistory(`agent:notebook:${notebookId}`)
        );
        if (history?.length) {
            const notebook = notebooks.find(item => item.id === notebookId);
            renderChatHistory(history, container, notebook?.name || '整理 Agent');
            clearBtn.style.display = 'inline-flex';
        }
    } catch (error) {
        console.warn('加载 Agent 历史失败:', error);
    }
}

async function askNotebookAgent() {
    if (!currentNotebookId || activeAgentRequestId) return;
    const input = document.getElementById('notebookAgentInput');
    const question = input.value.trim();
    if (!question) {
        showToast('请输入整理任务', 'warning');
        return;
    }

    const requestId = createRequestId('agent');
    activeAgentRequestId = requestId;
    const history = document.getElementById('notebookChatHistory');
    appendUserBubble(history, question);
    const ai = appendAiBubble(history);
    ai.textEl.classList.add('streaming');
    input.value = '';
    setAgentRunning(true);
    clearAgentTimeline();
    addAgentTimelineStep('Agent 正在分析当前笔记本…');
    let sources = [];
    let usage = null;

    const cleanupListener = window.electronAPI.onAgentEvent(async event => {
        if (event.requestId !== requestId) return;
        const data = event.data || {};
        switch (event.type) {
            case 'text-delta':
                ai.rawText += data.text || '';
                ai.textEl.innerHTML = DOMPurify.sanitize(marked.parse(ai.rawText));
                history.scrollTop = history.scrollHeight;
                break;
            case 'status':
                addAgentTimelineStep(data.message || 'Agent 状态更新');
                break;
            case 'tool-start':
                addAgentTimelineStep(`调用工具：${data.toolName || 'tool'}`);
                break;
            case 'tool-end':
                addAgentTimelineStep(`工具完成：${data.toolName || 'tool'}`);
                break;
            case 'sources':
                sources = data.sources || [];
                break;
            case 'usage':
                usage = data.usage;
                break;
            case 'approval-required':
                showAgentApproval(requestId, data);
                addAgentTimelineStep('等待你确认是否创建整理稿');
                break;
            case 'error':
                ai.textEl.classList.remove('streaming');
                ai.textEl.textContent = data.message || 'Agent 运行失败';
                addAgentTimelineStep(data.message || 'Agent 运行失败', true);
                showToast('Agent 运行失败：' + (data.message || ''), 'error');
                finishAgentUi(requestId, cleanupListener);
                break;
            case 'end':
                ai.textEl.classList.remove('streaming');
                if (data.finalText) {
                    ai.rawText = data.finalText;
                    ai.textEl.innerHTML = DOMPurify.sanitize(marked.parse(data.finalText));
                }
                const citations = structuredSourcesToCitations(sources, ai.rawText);
                if (citations.length) renderCitationCards(citations, ai.citationEl);
                if (usage) {
                    ai.tokenEl.innerHTML = renderTokenUsageHtml(usage);
                    ai.tokenEl.style.display = 'block';
                    accumulateSessionTokens(usage.total);
                }
                addAgentTimelineStep(data.aborted ? 'Agent 已停止' : 'Agent 任务完成');
                if (data.createdDocumentIds?.length) {
                    currentDocuments = await getDocumentsByNotebook(currentNotebookId);
                    notebookDocuments[currentNotebookId] = currentDocuments;
                    renderNotebookTree();
                    renderDocumentCards();
                    showToast('Agent 整理稿已创建，正在建立索引', 'success');
                }
                document.getElementById('notebookClearChatBtn').style.display = 'inline-flex';
                finishAgentUi(requestId, cleanupListener);
                break;
        }
    });

    try {
        await callBridge(window.electronAPI.startAgent({
            requestId,
            notebookId: currentNotebookId,
            prompt: question
        }));
    } catch (error) {
        ai.textEl.classList.remove('streaming');
        ai.textEl.textContent = error.message;
        addAgentTimelineStep(error.message, true);
        finishAgentUi(requestId, cleanupListener);
    }
}

function showAgentApproval(requestId, data) {
    pendingAgentApproval = {
        requestId,
        approvalId: data.approvalId
    };
    const args = data.arguments || {};
    document.getElementById('agentApprovalMeta').textContent =
        `标题：${args.title || '未命名'} · 来源文档 ID：${(args.sourceDocumentIds || []).join(', ') || '无'}`;
    document.getElementById('agentApprovalPreview').textContent = args.content || '';
    showModal('agentApprovalModal');
}

async function resolveAgentApproval(decision) {
    if (!pendingAgentApproval) return;
    const approval = pendingAgentApproval;
    pendingAgentApproval = null;
    closeModal('agentApprovalModal');
    try {
        await callBridge(window.electronAPI.resolveAgentApproval({
            ...approval,
            decision
        }));
    } catch (error) {
        showToast('审批失败：' + error.message, 'error');
    }
}

function stopNotebookAgent() {
    if (activeAgentRequestId) {
        window.electronAPI.abortAgent(activeAgentRequestId);
    }
}

function finishAgentUi(requestId, cleanupListener) {
    if (activeAgentRequestId === requestId) activeAgentRequestId = null;
    if (pendingAgentApproval?.requestId === requestId) {
        pendingAgentApproval = null;
        closeModal('agentApprovalModal');
    }
    setAgentRunning(false);
    cleanupListener();
}

function setAgentRunning(running) {
    document.getElementById('btnNotebookAgentSend').style.display = running ? 'none' : 'inline-flex';
    document.getElementById('btnNotebookAgentStop').style.display = running ? 'inline-flex' : 'none';
    document.getElementById('notebookAgentInput').disabled = running;
}

function clearAgentTimeline() {
    document.getElementById('agentTimeline').innerHTML = '';
}

function addAgentTimelineStep(text, isError = false) {
    const timeline = document.getElementById('agentTimeline');
    const item = document.createElement('div');
    item.className = `agent-step${isError ? ' error' : ''}`;
    item.textContent = text;
    timeline.appendChild(item);
    timeline.scrollTop = timeline.scrollHeight;
}

// ==================== Graph Lite 概念图 ====================
const graphTypeLabels = {
    person: '人物', organization: '组织', technology: '技术', product: '产品',
    paper: '论文', dataset: '数据集', method: '方法', concept: '概念', event: '事件',
    location: '地点', time: '时间', metric: '指标'
};
const graphRelationLabels = {
    authored_by: '作者', created_by: '创建者', uses: '使用', part_of: '组成', belongs_to: '属于',
    proposes: '提出', evaluates: '评估', compares_with: '比较', supports: '支持',
    contradicts: '反驳', collaborates_with: '合作', depends_on: '依赖', related_to: '相关'
};

function showGraphModal() {
    if (!currentNotebookId) {
        showToast('请先选择一个笔记本', 'warning');
        return;
    }
    resetGraphPanel();
    showModal('graphModal');
    loadGraphPanel();
}

function closeGraphModal() {
    if (activeGraphRequestId) {
        const leave = confirm('概念图仍在生成。关闭面板不会自动停止任务，是否关闭？');
        if (!leave) return;
    }
    closeModal('graphModal');
}

function resetGraphPanel() {
    currentGraph = null;
    graphPositions = new Map();
    graphViewport = { scale: 1, x: 0, y: 0 };
    document.getElementById('graphEmptyState').style.display = '';
    document.getElementById('graphProgressState').style.display = 'none';
    document.getElementById('graphCanvasState').style.display = 'none';
    document.getElementById('graphBuildBtn').style.display = '';
    document.getElementById('graphBuildBtn').disabled = false;
    document.getElementById('graphAbortBtn').style.display = 'none';
    document.getElementById('graphStatusText').textContent = '正在构建…';
    document.getElementById('graphProgressDetail').textContent = '';
    document.getElementById('graphProgressBar').style.width = '0%';
    document.getElementById('graphEstimate').textContent = '正在读取构建统计…';
    document.getElementById('graphInspector').innerHTML = '<div class="graph-inspector-empty">点击节点查看实体、关系和原文证据</div>';
    const notice = document.getElementById('graphCanvasNotice');
    notice.style.display = 'none';
    notice.textContent = '';
    document.getElementById('graphSvg').replaceChildren();
}

async function loadGraphPanel() {
    try {
        const [graph, estimate, configStatus] = await Promise.all([
            callBridge(window.electronAPI.getGraph(currentNotebookId)),
            callBridge(window.electronAPI.estimateGraph(currentNotebookId)),
            callBridge(window.electronAPI.getConfigStatus()).catch(() => null)
        ]);
        currentGraph = graph || { build: null, entities: [], relations: [], evidence: [] };
        graphConfigReady = configStatus?.deepseekReady !== false;
        renderGraphEstimate(estimate, configStatus);
        populateGraphFilters();
        const hasGraph = (currentGraph.entities || []).length > 0 || (currentGraph.relations || []).length > 0;
        if (hasGraph) {
            showGraphCanvas();
            const notice = document.getElementById('graphCanvasNotice');
            if (currentGraph.build?.status === 'stale') {
                notice.textContent = '文档已变化，当前显示的是旧图谱；重新生成可更新。';
                notice.style.display = '';
            } else if (currentGraph.build?.status === 'failed') {
                notice.textContent = currentGraph.build.error || '上次生成失败，当前显示旧图谱。';
                notice.style.display = '';
            }
        } else {
            document.getElementById('graphEmptyState').style.display = '';
            document.getElementById('graphProgressState').style.display = 'none';
            document.getElementById('graphCanvasState').style.display = 'none';
            if (currentGraph.build?.status === 'failed' || currentGraph.build?.status === 'interrupted') {
                document.getElementById('graphEstimate').textContent += ` · 上次构建${currentGraph.build.status === 'failed' ? '失败' : '已中断'}：${currentGraph.build.error || '未生成可用图谱'}`;
            }
        }
    } catch (error) {
        document.getElementById('graphEstimate').textContent = `读取概念图状态失败：${error.message}`;
        showToast('读取概念图状态失败：' + error.message, 'error');
    }
}

function renderGraphEstimate(estimate, configStatus = null) {
    if (!estimate) return;
    const chunkText = estimate.chunkCount == null ? '超限，未执行分词' : `${estimate.chunkCount} 个分块`;
    const callText = estimate.estimatedBatches == null ? '调用次数不估算' : `预计 ${estimate.estimatedBatches} 次 DeepSeek 调用`;
    const text = `文档 ${estimate.documentCount || 0} 篇 · ${chunkText} · ${callText}`;
    const limitText = estimate.withinLimits ? '在处理上限内' : '超过处理上限，请拆分笔记本';
    const configText = configStatus?.deepseekReady === false
        ? ` · DeepSeek 未配置（请编辑 ${configStatus.configPath || 'config.json'}）`
        : '';
    document.getElementById('graphEstimate').textContent = `${text} · ${limitText}${configText}`;
    document.getElementById('graphBuildBtn').disabled = !estimate.withinLimits || !graphConfigReady;
}

function showGraphCanvas() {
    document.getElementById('graphEmptyState').style.display = 'none';
    document.getElementById('graphProgressState').style.display = 'none';
    document.getElementById('graphCanvasState').style.display = '';
    document.getElementById('graphBuildBtn').style.display = '';
    document.getElementById('graphAbortBtn').style.display = 'none';
    renderGraphSvg();
}

function populateGraphFilters() {
    const entities = currentGraph?.entities || [];
    const relations = currentGraph?.relations || [];
    const entitySelect = document.getElementById('graphEntityTypeFilter');
    const relationSelect = document.getElementById('graphRelationTypeFilter');
    const currentEntity = entitySelect.value;
    const currentRelation = relationSelect.value;
    entitySelect.replaceChildren(new Option('全部实体类型', ''));
    [...new Set(entities.map(entity => entity.entity_type).filter(Boolean))].sort().forEach(type => {
        entitySelect.add(new Option(graphTypeLabels[type] || type, type));
    });
    relationSelect.replaceChildren(new Option('全部关系类型', ''));
    [...new Set(relations.map(relation => relation.relation_type).filter(Boolean))].sort().forEach(type => {
        relationSelect.add(new Option(graphRelationLabels[type] || type, type));
    });
    entitySelect.value = currentEntity;
    relationSelect.value = currentRelation;
}

function graphColor(type) {
    const colors = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777', '#7c3aed', '#2563eb'];
    let hash = 0;
    for (const char of String(type || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return colors[hash % colors.length];
}

function graphSvgPoint(event) {
    const svg = document.getElementById('graphSvg');
    const rect = svg.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 540;
    return {
        x: ((event.clientX - rect.left) / width) * 900,
        y: ((event.clientY - rect.top) / height) * 540
    };
}

function graphNodePosition(id, index, count) {
    if (graphPositions.has(Number(id))) return graphPositions.get(Number(id));
    const centerX = 450;
    const centerY = 270;
    const radius = Math.min(210, Math.max(80, 35 + count * 12));
    const angle = (Math.PI * 2 * index / Math.max(count, 1)) - Math.PI / 2;
    const position = { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
    graphPositions.set(Number(id), position);
    return position;
}

function applyGraphViewport() {
    const group = document.getElementById('graphViewportGroup');
    if (group) group.setAttribute('transform', `translate(${graphViewport.x} ${graphViewport.y}) scale(${graphViewport.scale})`);
}

function renderGraphSvg() {
    const svg = document.getElementById('graphSvg');
    if (!svg || !currentGraph) return;
    svg.replaceChildren();
    const NS = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(NS, 'defs');
    const marker = document.createElementNS(NS, 'marker');
    marker.setAttribute('id', 'graphArrow');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '7');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const arrow = document.createElementNS(NS, 'path');
    arrow.setAttribute('d', 'M0,0 L0,6 L7,3 z');
    arrow.setAttribute('fill', '#98a2b3');
    marker.appendChild(arrow);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const viewport = document.createElementNS(NS, 'g');
    viewport.id = 'graphViewportGroup';
    svg.appendChild(viewport);
    const query = (document.getElementById('graphSearchInput')?.value || '').trim().toLocaleLowerCase();
    const entityType = document.getElementById('graphEntityTypeFilter')?.value || '';
    const relationType = document.getElementById('graphRelationTypeFilter')?.value || '';
    const filtered = (currentGraph.entities || []).filter(entity => {
        if (entityType && entity.entity_type !== entityType) return false;
        if (!query) return true;
        const haystack = [entity.canonical_name, entity.description, ...(entity.aliases || [])].join(' ').toLocaleLowerCase();
        return haystack.includes(query);
    }).slice(0, 200);
    const visibleIds = new Set(filtered.map(entity => Number(entity.id)));
    const entitiesById = new Map((currentGraph.entities || []).map(entity => [Number(entity.id), entity]));
    const relations = (currentGraph.relations || []).filter(relation => {
        if (relationType && relation.relation_type !== relationType) return false;
        return visibleIds.has(Number(relation.source_entity_id)) && visibleIds.has(Number(relation.target_entity_id));
    });
    const positions = new Map(filtered.map((entity, index) => [Number(entity.id), graphNodePosition(entity.id, index, filtered.length)]));

    for (const relation of relations) {
        const source = positions.get(Number(relation.source_entity_id));
        const target = positions.get(Number(relation.target_entity_id));
        if (!source || !target) continue;
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', source.x);
        line.setAttribute('y1', source.y);
        line.setAttribute('x2', target.x);
        line.setAttribute('y2', target.y);
        line.setAttribute('class', 'graph-edge');
        line.setAttribute('marker-end', 'url(#graphArrow)');
        viewport.appendChild(line);
        const label = document.createElementNS(NS, 'text');
        label.setAttribute('x', (source.x + target.x) / 2);
        label.setAttribute('y', (source.y + target.y) / 2 - 5);
        label.setAttribute('class', 'graph-edge-label');
        label.textContent = graphRelationLabels[relation.relation_type] || relation.relation_type;
        viewport.appendChild(label);
    }

    for (const [index, entity] of filtered.entries()) {
        const point = positions.get(Number(entity.id));
        const group = document.createElementNS(NS, 'g');
        group.setAttribute('class', 'graph-node');
        group.setAttribute('data-entity-id', entity.id);
        group.setAttribute('transform', `translate(${point.x} ${point.y})`);
        group.addEventListener('click', event => {
            event.stopPropagation();
            showGraphInspector(Number(entity.id));
        });
        group.addEventListener('pointerdown', event => {
            event.stopPropagation();
            const start = graphSvgPoint(event);
            const world = { ...point };
            graphNodeDrag = { id: Number(entity.id), start, world, pointerId: event.pointerId };
            group.setPointerCapture?.(event.pointerId);
        });
        const circle = document.createElementNS(NS, 'circle');
        const radius = Math.min(32, 20 + Math.min(12, Number(entity.mention_count || 0)));
        circle.setAttribute('r', String(radius));
        circle.setAttribute('fill', graphColor(entity.entity_type));
        circle.setAttribute('class', 'graph-node-circle');
        group.appendChild(circle);
        const label = document.createElementNS(NS, 'text');
        label.setAttribute('class', 'graph-node-label');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('y', '4');
        label.textContent = String(entity.canonical_name || '').slice(0, 14);
        group.appendChild(label);
        const type = document.createElementNS(NS, 'text');
        type.setAttribute('class', 'graph-node-type');
        type.setAttribute('text-anchor', 'middle');
        type.setAttribute('y', '48');
        type.textContent = graphTypeLabels[entity.entity_type] || entity.entity_type;
        group.appendChild(type);
        viewport.appendChild(group);
    }
    applyGraphViewport();
    setupGraphInteractions();
}

let graphInteractionsReady = false;
function setupGraphInteractions() {
    if (graphInteractionsReady) return;
    const svg = document.getElementById('graphSvg');
    if (!svg) return;
    graphInteractionsReady = true;
    svg.addEventListener('pointermove', event => {
        if (!graphNodeDrag) return;
        const current = graphSvgPoint(event);
        const dx = (current.x - graphNodeDrag.start.x) / graphViewport.scale;
        const dy = (current.y - graphNodeDrag.start.y) / graphViewport.scale;
        graphPositions.set(graphNodeDrag.id, { x: graphNodeDrag.world.x + dx, y: graphNodeDrag.world.y + dy });
        const node = svg.querySelector(`[data-entity-id="${graphNodeDrag.id}"]`);
        const position = graphPositions.get(graphNodeDrag.id);
        if (node && position) node.setAttribute('transform', `translate(${position.x} ${position.y})`);
        // 边在拖动期间重新绘制，保持箭头和标签同步。
        renderGraphSvg();
    });
    svg.addEventListener('pointerup', () => { graphNodeDrag = null; });
    svg.addEventListener('pointercancel', () => { graphNodeDrag = null; });
    svg.addEventListener('pointerdown', event => {
        if (event.target !== svg) return;
        graphNodeDrag = { pan: true, start: graphSvgPoint(event), viewport: { ...graphViewport } };
    });
    svg.addEventListener('wheel', event => {
        event.preventDefault();
        const pointer = graphSvgPoint(event);
        const oldScale = graphViewport.scale;
        const nextScale = Math.min(2.5, Math.max(0.45, oldScale * (event.deltaY < 0 ? 1.1 : 0.9)));
        const worldX = (pointer.x - graphViewport.x) / oldScale;
        const worldY = (pointer.y - graphViewport.y) / oldScale;
        graphViewport.scale = nextScale;
        graphViewport.x = pointer.x - worldX * nextScale;
        graphViewport.y = pointer.y - worldY * nextScale;
        applyGraphViewport();
    }, { passive: false });
    svg.addEventListener('pointermove', event => {
        if (!graphNodeDrag?.pan) return;
        const current = graphSvgPoint(event);
        graphViewport.x = graphNodeDrag.viewport.x + current.x - graphNodeDrag.start.x;
        graphViewport.y = graphNodeDrag.viewport.y + current.y - graphNodeDrag.start.y;
        applyGraphViewport();
    });
}

function resetGraphViewport() {
    graphViewport = { scale: 1, x: 0, y: 0 };
    graphPositions = new Map();
    renderGraphSvg();
}

function showGraphInspector(entityId) {
    const entity = (currentGraph?.entities || []).find(item => Number(item.id) === Number(entityId));
    if (!entity) return;
    const entitiesById = new Map((currentGraph.entities || []).map(item => [Number(item.id), item]));
    const relations = (currentGraph.relations || []).filter(relation =>
        Number(relation.source_entity_id) === Number(entityId) || Number(relation.target_entity_id) === Number(entityId));
    const evidence = (currentGraph.evidence || []).filter(item => Number(item.entity_id) === Number(entityId)
        || relations.some(relation => Number(item.relation_id) === Number(relation.id)));
    const inspector = document.getElementById('graphInspector');
    inspector.innerHTML = `
        <div class="graph-inspector-title">${escapeHtml(entity.canonical_name)}</div>
        <div class="graph-inspector-type">${escapeHtml(graphTypeLabels[entity.entity_type] || entity.entity_type)} · 出现 ${Number(entity.mention_count || 0)} 次</div>
        <p class="graph-inspector-description">${escapeHtml(entity.description || '暂无简介')}</p>
        ${entity.aliases?.length ? `<div class="graph-inspector-section"><strong>别名</strong><div>${escapeHtml(entity.aliases.join('、'))}</div></div>` : ''}
        <div class="graph-inspector-section"><strong>关系</strong>
            ${relations.length ? `<ul>${relations.map(relation => {
                const otherId = Number(relation.source_entity_id) === Number(entityId) ? relation.target_entity_id : relation.source_entity_id;
                const other = entitiesById.get(Number(otherId));
                const direction = Number(relation.source_entity_id) === Number(entityId) ? '→' : '←';
                return `<li>${escapeHtml(direction)} ${escapeHtml(graphRelationLabels[relation.relation_type] || relation.relation_type)} ${escapeHtml(other?.canonical_name || '未知实体')}</li>`;
            }).join('')}</ul>` : '<div>暂无关系</div>'}
        </div>
        <div class="graph-inspector-section"><strong>原文证据</strong>
            ${evidence.length ? evidence.map(item => {
                const sourceDoc = (currentDocuments || []).find(doc => Number(doc.id) === Number(item.document_id));
                return `<button type="button" class="graph-evidence" data-document-id="${Number(item.document_id)}" data-start-char="${Number(item.start_char)}"><span>${escapeHtml(sourceDoc?.title || `文档 ${item.document_id}`)}</span><small>${escapeHtml(item.evidence_text || '')}</small></button>`;
            }).join('') : '<div>暂无可跳转证据</div>'}
        </div>`;
    inspector.querySelectorAll('.graph-evidence').forEach(button => {
        button.addEventListener('click', () => openGraphEvidence(Number(button.dataset.documentId), Number(button.dataset.startChar)));
    });
}

async function openGraphEvidence(documentId, startChar = 0) {
    closeModal('graphModal');
    if (Number(documentId) !== Number(currentDocumentId)) {
        await selectDocument(Number(documentId));
    }
    const content = document.getElementById('docContent');
    if (content) {
        content.style.display = 'block';
        document.getElementById('docContentToggle').textContent = '▼';
        const doc = currentDocuments.find(item => Number(item.id) === Number(documentId));
        if (doc?.content?.length) {
            content.scrollTop = Math.max(0, (Number(startChar) / doc.content.length) * content.scrollHeight - 80);
        }
        content.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

async function startGraphBuild() {
    if (!currentNotebookId || activeGraphRequestId) return;
    try {
        const estimate = await callBridge(window.electronAPI.estimateGraph(currentNotebookId));
        renderGraphEstimate(estimate);
        if (!graphConfigReady) {
            showToast('DeepSeek 未配置，请先检查 AI 配置路径', 'warning');
            return;
        }
        if (!estimate.withinLimits) return;
        const confirmed = confirm(`将处理 ${estimate.documentCount} 篇文档、约 ${estimate.estimatedBatches} 次 DeepSeek 调用。继续生成概念图吗？`);
        if (!confirmed) return;
        const requestId = createRequestId('graph');
        activeGraphRequestId = requestId;
        document.getElementById('graphEmptyState').style.display = 'none';
        document.getElementById('graphCanvasState').style.display = currentGraph?.entities?.length ? '' : 'none';
        document.getElementById('graphProgressState').style.display = '';
        document.getElementById('graphBuildBtn').style.display = 'none';
        document.getElementById('graphAbortBtn').style.display = '';
        document.getElementById('graphStatusText').textContent = '正在启动 Graph Lite…';
        await callBridge(window.electronAPI.buildGraph({ requestId, notebookId: currentNotebookId }));
    } catch (error) {
        activeGraphRequestId = null;
        document.getElementById('graphStatusText').textContent = error.message;
        document.getElementById('graphBuildBtn').style.display = '';
        document.getElementById('graphAbortBtn').style.display = 'none';
        showToast('启动概念图失败：' + error.message, 'error');
    }
}

function abortGraphBuild() {
    if (activeGraphRequestId) window.electronAPI.abortGraph(activeGraphRequestId);
}

async function handleGraphEvent(event) {
    if (!event || event.requestId !== activeGraphRequestId) return;
    const data = event.data || {};
    if (event.type === 'status') {
        document.getElementById('graphStatusText').textContent = data.message || data.status || '正在构建…';
    } else if (event.type === 'progress') {
        const total = Number(data.total || 0);
        const completed = Number(data.completed || 0);
        document.getElementById('graphStatusText').textContent = data.stage === 'saving' ? '正在保存概念图…' : '正在从文档抽取实体与关系…';
        document.getElementById('graphProgressDetail').textContent = total ? `${completed}/${total} 个批次` : '';
        document.getElementById('graphProgressBar').style.width = total ? `${Math.min(100, completed / total * 100)}%` : '5%';
    } else if (event.type === 'usage') {
        const usage = data.usage || {};
        document.getElementById('graphProgressDetail').textContent += ` · Token ${usage.total || 0}`;
    } else if (event.type === 'completed') {
        document.getElementById('graphStatusText').textContent = `生成完成：${data.entityCount || 0} 个实体、${data.relationCount || 0} 条关系`;
        await loadGraphPanel();
        finishGraphUi();
    } else if (event.type === 'aborted') {
        document.getElementById('graphStatusText').textContent = data.message || '图谱构建已停止，旧图谱保持不变';
        await loadGraphPanel();
        finishGraphUi();
    } else if (event.type === 'error') {
        document.getElementById('graphStatusText').textContent = data.message || '图谱构建失败，旧图谱保持不变';
        await loadGraphPanel();
        finishGraphUi();
        showToast(data.message || '图谱构建失败', 'error');
    } else if (event.type === 'end' && data.aborted) {
        finishGraphUi();
    }
}

function finishGraphUi() {
    activeGraphRequestId = null;
    document.getElementById('graphBuildBtn').style.display = '';
    document.getElementById('graphAbortBtn').style.display = 'none';
}

// ==================== 联网研究 ====================
async function showResearchModal() {
    resetResearchPanel();
    showModal('researchModal');
    try {
        const runs = await callBridge(window.electronAPI.listResearch(10));
        const resumable = runs.find(run =>
            ['awaiting_selection', 'interrupted', 'failed', 'aborted'].includes(run.status)
            && run.candidates?.length
        );
        if (resumable) {
            currentResearchRun = resumable;
            activeResearchRequestId = null;
            document.getElementById('researchTopic').value = resumable.topic;
            document.getElementById('researchNotebookTitle').value = resumable.topic;
            if (['awaiting_selection', 'interrupted'].includes(resumable.status)) {
                showResearchSelection(resumable.candidates.slice(0, 15), []);
                addResearchTimeline(resumable.status === 'interrupted'
                    ? '上次任务被应用关闭中断，候选资料已保留'
                    : '已恢复上次尚未创建的候选资料');
            } else {
                document.getElementById('researchStartBtn').textContent = '重试上次研究';
                document.getElementById('researchStatus').textContent = resumable.error || '可重试上次研究';
            }
        }
    } catch (error) {
        console.warn('读取研究历史失败:', error);
    }
}

function closeResearchModal() {
    if (activeResearchRequestId) {
        const leave = confirm('研究任务仍在运行。关闭面板不会自动停止任务，是否关闭？');
        if (!leave) return;
    }
    closeModal('researchModal');
}

function resetResearchPanel() {
    activeResearchRequestId = null;
    currentResearchRun = null;
    researchCandidates = [];
    researchDefaultSelectedIds = [];
    document.getElementById('researchInputStage').style.display = '';
    document.getElementById('researchProgressStage').style.display = 'none';
    document.getElementById('researchSelectionStage').style.display = 'none';
    document.getElementById('researchStartBtn').style.display = '';
    document.getElementById('researchStartBtn').disabled = false;
    document.getElementById('researchStartBtn').textContent = '开始搜索';
    document.getElementById('researchAbortBtn').style.display = 'none';
    document.getElementById('researchCreateBtn').style.display = 'none';
    document.getElementById('researchTimeline').innerHTML = '';
    setResearchStep(1);
}

function updateResearchModeCards() {
    document.querySelectorAll('.research-mode-card').forEach(card => {
        card.classList.toggle('selected', card.querySelector('input').checked);
    });
}

async function startResearch() {
    const topic = document.getElementById('researchTopic').value.trim();
    if (!topic) {
        showToast('请输入研究主题', 'error');
        return;
    }
    const existing = currentResearchRun;
    const requestId = existing && ['failed', 'aborted', 'interrupted'].includes(existing.status)
        ? existing.id
        : createRequestId('research');
    activeResearchRequestId = requestId;
    researchCandidates = [];
    researchDefaultSelectedIds = [];
    document.getElementById('researchInputStage').style.display = 'none';
    document.getElementById('researchProgressStage').style.display = '';
    document.getElementById('researchSelectionStage').style.display = 'none';
    document.getElementById('researchStartBtn').style.display = 'none';
    document.getElementById('researchAbortBtn').style.display = '';
    setResearchStep(2);
    addResearchTimeline('研究任务已提交');

    try {
        if (existing && ['failed', 'aborted', 'interrupted'].includes(existing.status)) {
            await callBridge(window.electronAPI.retryResearch({ requestId }));
        } else {
            const manualUrls = document.getElementById('researchManualUrls').value
                .split(/\r?\n/)
                .map(value => value.trim())
                .filter(Boolean);
            const payload = {
                requestId,
                topic,
                mode: document.querySelector('input[name="researchMode"]:checked').value,
                filters: {
                    sourceTypes: checkedValues('researchSource'),
                    languages: checkedValues('researchLanguage'),
                    yearFrom: document.getElementById('researchYearFrom').value,
                    yearTo: document.getElementById('researchYearTo').value,
                    excludeDomains: document.getElementById('researchExcludeDomains').value
                },
                manualUrls
            };
            await callBridge(window.electronAPI.startResearch(payload));
        }
    } catch (error) {
        activeResearchRequestId = null;
        document.getElementById('researchAbortBtn').style.display = 'none';
        document.getElementById('researchStartBtn').style.display = '';
        showToast('研究启动失败：' + error.message, 'error');
        addResearchTimeline(error.message);
    }
}

function checkedValues(name) {
    return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value);
}

function handleResearchEvent(event) {
    if (!event?.requestId) return;
    if (activeResearchRequestId && event.requestId !== activeResearchRequestId) return;
    if (!activeResearchRequestId && currentResearchRun?.id !== event.requestId) return;
    const { type, data = {} } = event;
    if (type === 'status') {
        document.getElementById('researchStatus').textContent = data.message || data.status;
        addResearchTimeline(data.message || data.status);
    } else if (type === 'query') {
        for (const query of data.queries || []) {
            addResearchTimeline(`检索（${query.language || 'auto'}）：${query.query}`);
        }
    } else if (type === 'candidates') {
        researchCandidates = data.candidates || researchCandidates;
        document.getElementById('researchStatus').textContent = `已发现 ${researchCandidates.length} 个候选来源`;
    } else if (type === 'progress') {
        if (data.warning) addResearchTimeline(`${data.provider || '来源'}：${data.warning}`);
        else if (data.total) {
            document.getElementById('researchStatus').textContent = `搜索进度 ${data.completed || 0}/${data.total}`;
        } else if (data.message) addResearchTimeline(data.message);
    } else if (type === 'usage' && data.usage) {
        accumulateSessionTokens(data.usage.total || 0);
    } else if (type === 'selection-ready') {
        researchDefaultSelectedIds = data.defaultSelectedIds || [];
        activeResearchRequestId = null;
        currentResearchRun = {
            id: event.requestId,
            topic: document.getElementById('researchTopic').value.trim(),
            mode: document.querySelector('input[name="researchMode"]:checked').value,
            status: 'awaiting_selection',
            candidates: data.candidates || researchCandidates
        };
        showResearchSelection(data.candidates || researchCandidates, researchDefaultSelectedIds);
    } else if (type === 'notebook-created') {
        addResearchTimeline('新笔记本与研究导读已创建');
        loadNotebooks().then(async () => {
            const notebookId = data.notebook?.id;
            if (notebookId) await selectNotebook(notebookId);
        });
    } else if (type === 'end') {
        activeResearchRequestId = null;
        document.getElementById('researchAbortBtn').style.display = 'none';
        if (data.status === 'completed') {
            document.getElementById('researchCreateBtn').style.display = 'none';
            showToast('研究笔记本创建成功，文档正在后台索引', 'success');
            setTimeout(() => closeModal('researchModal'), 700);
        }
    } else if (type === 'error') {
        activeResearchRequestId = null;
        document.getElementById('researchAbortBtn').style.display = 'none';
        document.getElementById('researchStartBtn').style.display = '';
        document.getElementById('researchStartBtn').textContent = '重试';
        addResearchTimeline(data.message || '研究任务失败');
        showToast(data.message || '联网研究失败', 'error');
    }
}

function showResearchSelection(candidates, selectedIds) {
    researchCandidates = candidates || [];
    const defaultCount = currentResearchRun?.mode === 'deep' ? 8 : 5;
    researchDefaultSelectedIds = selectedIds?.length
        ? selectedIds
        : researchCandidates.slice(0, defaultCount).map(candidate => candidate.id);
    document.getElementById('researchInputStage').style.display = 'none';
    document.getElementById('researchProgressStage').style.display = 'none';
    document.getElementById('researchSelectionStage').style.display = '';
    const startButton = document.getElementById('researchStartBtn');
    startButton.style.display = currentResearchRun?.status === 'interrupted' ? '' : 'none';
    startButton.textContent = '继续搜索';
    document.getElementById('researchAbortBtn').style.display = 'none';
    document.getElementById('researchCreateBtn').style.display = '';
    const titleInput = document.getElementById('researchNotebookTitle');
    if (!titleInput.value.trim()) titleInput.value = document.getElementById('researchTopic').value.trim();
    setResearchStep(3);
    renderResearchCandidates();
}

function renderResearchCandidates() {
    const selected = new Set(researchDefaultSelectedIds);
    const container = document.getElementById('researchCandidateList');
    container.innerHTML = researchCandidates.map(candidate => `
        <label class="research-candidate">
            <input type="checkbox" name="researchCandidate" value="${escapeHtml(candidate.id)}"
                   ${selected.has(candidate.id) ? 'checked' : ''} onchange="updateResearchSelectionCount()">
            <span>
                <span class="research-candidate-title">${escapeHtml(candidate.title)}</span>
                <span class="research-candidate-meta">${escapeHtml(candidate.provider)} · ${escapeHtml(candidate.publishedAt || '日期未知')} · ${escapeHtml((candidate.authors || []).slice(0, 3).join(', '))}</span>
                <span class="research-candidate-summary">${escapeHtml(candidate.summary || '暂无摘要')}</span>
                <button type="button" class="research-source-link" onclick="openResearchCandidate('${escapeHtml(candidate.id)}', event)">打开原始网页</button>
            </span>
        </label>
    `).join('');
    updateResearchSelectionCount();
}

function updateResearchSelectionCount() {
    const count = document.querySelectorAll('input[name="researchCandidate"]:checked').length;
    document.getElementById('researchSelectionCount').textContent = `已选择 ${count} 个来源`;
    document.getElementById('researchCreateBtn').disabled = count < 3 || count > 15;
}

async function openResearchCandidate(candidateId, event) {
    event.preventDefault();
    event.stopPropagation();
    const candidate = researchCandidates.find(item => item.id === candidateId);
    if (!candidate) return;
    try {
        await callBridge(window.electronAPI.openResearchSource(candidate.url));
    } catch (error) {
        showToast('无法打开来源：' + error.message, 'error');
    }
}

async function openStoredResearchSource(documentId, event) {
    event.stopPropagation();
    const document = currentDocuments.find(item => item.id === documentId);
    if (!document?.metadata?.url) return;
    try {
        await callBridge(window.electronAPI.openResearchSource(document.metadata.url));
    } catch (error) {
        showToast('无法打开来源：' + error.message, 'error');
    }
}

async function createResearchNotebook() {
    const candidateIds = [...document.querySelectorAll('input[name="researchCandidate"]:checked')]
        .map(input => input.value);
    if (candidateIds.length < 3 || candidateIds.length > 15) return;
    const requestId = currentResearchRun?.id;
    if (!requestId) {
        showToast('研究任务状态已丢失，请重新搜索', 'error');
        return;
    }
    activeResearchRequestId = requestId;
    document.getElementById('researchSelectionStage').style.display = 'none';
    document.getElementById('researchProgressStage').style.display = '';
    document.getElementById('researchCreateBtn').style.display = 'none';
    document.getElementById('researchAbortBtn').style.display = '';
    setResearchStep(2);
    try {
        await callBridge(window.electronAPI.createResearchNotebook({
            requestId,
            title: document.getElementById('researchNotebookTitle').value.trim(),
            candidateIds
        }));
    } catch (error) {
        activeResearchRequestId = null;
        showResearchSelection(researchCandidates, candidateIds);
        showToast('创建失败：' + error.message, 'error');
    }
}

function abortResearch() {
    if (!activeResearchRequestId) return;
    window.electronAPI.abortResearch(activeResearchRequestId);
    activeResearchRequestId = null;
    document.getElementById('researchAbortBtn').style.display = 'none';
    document.getElementById('researchStartBtn').style.display = '';
    document.getElementById('researchStartBtn').textContent = '重新开始';
    addResearchTimeline('用户已停止研究任务');
}

function setResearchStep(step) {
    [1, 2, 3].forEach(index => {
        document.getElementById(`researchStep${index}`).classList.toggle('active', index === step);
    });
}

function addResearchTimeline(text) {
    if (!text) return;
    const container = document.getElementById('researchTimeline');
    const item = document.createElement('div');
    item.className = 'research-timeline-item';
    item.textContent = text;
    container.appendChild(item);
    container.scrollTop = container.scrollHeight;
}

async function reindexCurrentNotebook() {
    if (!currentNotebookId) return;
    if (!confirm('将为当前笔记本的全部文档重新计算 Embedding，可能产生 API 费用。是否继续？')) return;
    try {
        const result = await callBridge(window.electronAPI.reindexNotebook(currentNotebookId));
        showToast(`已启动 ${result.count} 篇文档的重建任务`, 'success');
        currentDocuments = await getDocumentsByNotebook(currentNotebookId);
        notebookDocuments[currentNotebookId] = currentDocuments;
        renderDocumentCards();
    } catch (error) {
        showToast('重建索引失败：' + error.message, 'error');
    }
}

async function loadConfigStatus() {
    const element = document.getElementById('aiConfigStatus');
    try {
        const status = await callBridge(window.electronAPI.getConfigStatus());
        const deepseekControls = [
            document.getElementById('qaInput'),
            document.getElementById('btnDocQASend'),
            document.getElementById('notebookQAInput'),
            document.getElementById('btnNotebookQASend'),
            document.getElementById('notebookAgentInput'),
            document.getElementById('btnNotebookAgentSend'),
            document.getElementById('qaModeAgent')
        ].filter(Boolean);
        deepseekControls.forEach(control => {
            control.disabled = !status.deepseekReady;
            if (!status.deepseekReady && control.tagName === 'INPUT') {
                control.placeholder = `请先配置 DeepSeek Key：${status.configPath}`;
            }
        });
        const reindexButton = document.getElementById('btnReindexNotebook');
        if (reindexButton) {
            reindexButton.disabled = !status.zhipuReady;
            reindexButton.title = status.zhipuReady ? '' : `请先配置智谱 Embedding Key：${status.configPath}`;
        }
        const researchButton = document.getElementById('researchLaunchBtn');
        if (researchButton) {
            researchButton.disabled = !status.deepseekReady;
            researchButton.title = status.deepseekReady
                ? '从公开网络资料创建研究笔记本'
                : `联网研究需要现有 DeepSeek 配置：${status.configPath}`;
        }
        if (status.deepseekReady && status.zhipuReady) {
            element.textContent = `已就绪 · ${status.configPath}`;
            element.style.color = '#188038';
        } else {
            const missing = [
                !status.deepseekReady ? 'DeepSeek' : '',
                !status.zhipuReady ? '智谱 Embedding' : ''
            ].filter(Boolean).join('、');
            element.textContent = `缺少 ${missing} Key · ${status.configPath || ''}`;
            element.style.color = '#c5221f';
        }
    } catch (error) {
        element.textContent = error.message;
        element.style.color = '#c5221f';
    }
}

// ==================== Token 用量 ====================
function renderTokenUsageCard(containerId, usage) {
    const container = document.getElementById(containerId);
    if (!container || !usage) return;
    const cost = (usage.total * 0.0015 / 1000).toFixed(4);
    container.innerHTML = `
        <div class="token-usage-card">
            <span class="token-usage-icon">📊</span>
            <span class="token-usage-text">Token | 输入：${usage.prompt} | 输出：${usage.completion} | 总计：${usage.total}</span>
            <span class="token-usage-cost">💰 约 ¥${cost}</span>
        </div>
    `;
    container.style.display = 'block';
}

function accumulateSessionTokens(tokens) {
    window.sessionTokenTotal += tokens;
    updateSessionTotalDisplay();
}

function updateSessionTotalDisplay() {
    const el = document.getElementById('sessionTotalTokens');
    if (el) {
        el.textContent = window.sessionTokenTotal.toLocaleString() + ' tokens';
    }
}

// ==================== 右侧功能面板 ====================
function switchRightPanelTab(tabName) {
    const userSettingsTab = document.getElementById('userSettingsTab');
    const consoleTab = document.getElementById('consoleTab');
    const tabUserSettings = document.getElementById('tabUserSettings');
    const tabConsole = document.getElementById('tabConsole');

    if (tabName === 'userSettings') {
        userSettingsTab.style.display = 'block';
        consoleTab.style.display = 'none';
        tabUserSettings.classList.add('active');
        tabConsole.classList.remove('active');
    } else {
        userSettingsTab.style.display = 'none';
        consoleTab.style.display = 'block';
        tabUserSettings.classList.remove('active');
        tabConsole.classList.add('active');
    }
}

// ==================== 新建文档：模式切换 + 文件选择 ====================
function updateDocCreateModes() {
    const hasText = document.getElementById('checkText').checked;
    const hasFile = document.getElementById('checkFile').checked;
    
    // 至少勾选一个，如果都取消则自动勾回"输入内容"
    if (!hasText && !hasFile) {
        document.getElementById('checkText').checked = true;
        document.getElementById('docCreateTextSection').style.display = 'block';
        return;
    }
    
    document.getElementById('docCreateTextSection').style.display = hasText ? 'block' : 'none';
    document.getElementById('docCreateFileSection').style.display = hasFile ? 'block' : 'none';
}

async function triggerNativeFileSelect() {
    try {
        const filePath = await window.electronAPI.selectLocalFile();
        if (!filePath) return;
        
        selectedFile = filePath; // 此时存储的是本地物理文件路径字符串
        const basename = filePath.substring(filePath.lastIndexOf('\\') + 1).substring(filePath.lastIndexOf('/') + 1);
        
        document.getElementById('docCreateUploadArea').style.display = 'none';
        document.getElementById('selectedFileInfo').style.display = 'flex';
        document.getElementById('selectedFileName').textContent = basename;
        
        const titleInput = document.getElementById('documentTitle');
        if (!titleInput.value.trim()) {
            const dotIndex = basename.lastIndexOf('.');
            titleInput.value = dotIndex > 0 ? basename.substring(0, dotIndex) : basename;
        }
    } catch (e) {
        showToast('选择文件出错: ' + e.message, 'error');
    }
}

function onModalFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const supportedFormats = ['.txt', '.md', '.docx', '.pdf'];
    const fileName = file.name.toLowerCase();
    const isSupported = supportedFormats.some(format => fileName.endsWith(format));
    
    if (!isSupported) {
        showToast('请上传 .txt, .md, .docx 或 .pdf 文件', 'error');
        event.target.value = '';
        return;
    }
    selectedFile = file.path;
    document.getElementById('docCreateUploadArea').style.display = 'none';
    document.getElementById('selectedFileInfo').style.display = 'flex';
    document.getElementById('selectedFileName').textContent = file.name;
    
    const titleInput = document.getElementById('documentTitle');
    if (!titleInput.value.trim()) {
        const dotIndex = file.name.lastIndexOf('.');
        titleInput.value = dotIndex > 0 ? file.name.substring(0, dotIndex) : file.name;
    }
}

function clearSelectedFile() {
    selectedFile = null;
    document.getElementById('modalFileInput').value = '';
    document.getElementById('docCreateUploadArea').style.display = 'flex';
    document.getElementById('selectedFileInfo').style.display = 'none';
}

function resetDocCreateModal() {
    document.getElementById('documentTitle').value = '';
    document.getElementById('documentContent').value = '';
    selectedFile = null;
    document.getElementById('checkText').checked = true;
    document.getElementById('checkFile').checked = false;
    updateDocCreateModes();
    document.getElementById('modalFileInput').value = '';
    document.getElementById('docCreateUploadArea').style.display = 'flex';
    document.getElementById('selectedFileInfo').style.display = 'none';
}

function pollSummaryReady(docId, attempt, maxAttempts) {
    if (attempt > maxAttempts) {
        console.warn('[轮询] 摘要生成超时，docId=' + docId);
        return;
    }

    setTimeout(async () => {
        try {
            const doc = await fetchAPI(`/api/documents/${docId}`);
            const summaryReady = doc && doc.summary !== '摘要生成中...';
            const indexSettled = doc && ['ready', 'failed', 'stale'].includes(doc.index_status);
            if (summaryReady && indexSettled) {
                const idx = currentDocuments.findIndex(d => d.id === docId);
                if (idx !== -1) {
                    currentDocuments[idx] = doc;
                }
                if (notebookDocuments[currentNotebookId]) {
                    notebookDocuments[currentNotebookId] = currentDocuments;
                }
                // 如果在笔记本视图就刷新卡片，如果在文档视图且是当前文档就刷新摘要
                if (currentDocumentId === docId) {
                    selectDocument(docId);
                } else {
                    renderNotebookTree();
                    renderDocumentCards();
                }
            } else {
                pollSummaryReady(docId, attempt + 1, maxAttempts);
            }
        } catch (e) {
            console.warn('[轮询] 查询摘要失败: ' + e.message);
        }
    }, 2000);
}

// ==================== 弹窗控制 ====================
function showModal(modalId) {
    document.getElementById(modalId).classList.add('show');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

function showCreateNotebookModal() {
    showModal('createNotebookModal');
    setTimeout(() => document.getElementById('notebookName').focus(), 100);
}

function showRenameNotebookModal() {
    if (!currentNotebookId) return;
    
    const notebook = notebooks.find(n => n.id === currentNotebookId);
    if (notebook) {
        document.getElementById('renameNotebookName').value = notebook.name;
        document.getElementById('renameNotebookDescription').value = notebook.description || '';
    }
    
    showModal('renameNotebookModal');
    setTimeout(() => document.getElementById('renameNotebookName').focus(), 100);
}

function showCreateDocumentModal() {
    resetDocCreateModal();
    showModal('createDocumentModal');
    setTimeout(() => document.getElementById('documentTitle').focus(), 100);
}

// 点击弹窗外部关闭
window.onclick = function(event) {
    if (event.target.classList.contains('modal') && event.target.id !== 'agentApprovalModal') {
        if (event.target.id === 'graphModal') {
            closeGraphModal();
        } else {
            event.target.classList.remove('show');
        }
    }
}

// ==================== 工具函数 ====================
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== 引用溯源 ====================
function parseCitations(rawText, defaultTitle) {
    const parts = rawText.split('---');
    let answer = parts[0].trim();
    const citations = [];

    if (parts.length > 1) {
        const citationText = parts[1].trim();

        // 统一策略：始终按 [N] 前瞻拆分为独立段，确保每个引用各自成块
        const segments = citationText.split(/(?=\[\d+\])/);

        for (const segment of segments) {
            const seg = segment.trim();
            if (!seg) continue;

            // 先尝试匹配【文档：标题】格式
            const regex = /\[(\d+)\]\s*【?文档?：?([^】]+)】?\s*(.+)/;
            const match = seg.match(regex);
            if (match) {
                citations.push({
                    id: match[1],
                    title: match[2].trim(),
                    snippet: match[3].trim()
                });
                continue;
            }

            // 再尝试简单格式：[N] 原文片段
            const simpleRegex = /\[(\d+)\]\s*(.+)/;
            const simpleMatch = seg.match(simpleRegex);
            if (simpleMatch) {
                citations.push({
                    id: simpleMatch[1],
                    title: defaultTitle || '参考来源',
                    snippet: simpleMatch[2].trim()
                });
            }
        }
    }

    // 如果还是没有解析到引用，但正文中有 [N] 标记，生成空片段的引用
    if (citations.length === 0) {
        const inlineRegex = /\[(\d+)\]/g;
        let inlineMatch;
        while ((inlineMatch = inlineRegex.exec(answer)) !== null) {
            citations.push({
                id: inlineMatch[1],
                title: defaultTitle || '未知来源',
                snippet: ''
            });
        }
    }

    return { answer, citations };
}

function renderCitationCards(citations, container) {
    if (!citations || citations.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    let html = '<div class="citation-header">';
    html += '<span>参考来源</span>';
    html += '<button class="citation-toggle-btn" onclick="toggleCitationList(this)">展开</button>';
    html += '</div>';
    html += '<div class="citation-list" style="display:none">';

    citations.forEach(cite => {
        html += `
            <div class="citation-card" data-cite-id="${cite.id}">
                <div class="citation-number">[${cite.id}]</div>
                <div class="citation-content">
                    <div class="citation-title-row">
                        <span class="citation-title">${escapeHtml(cite.title)}</span>
                        <button class="citation-toggle-btn" onclick="toggleCitationSnippet(this)">展开</button>
                    </div>
                    <div class="citation-snippet citation-snippet-collapsed">${escapeHtml(cite.snippet)}</div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
    container.style.display = 'block';
}

/** 切换单条引用片段的展开/折叠 */
function toggleCitationSnippet(btn) {
    const card = btn.closest('.citation-card');
    const snippet = card.querySelector('.citation-snippet');
    const isCollapsed = snippet.classList.contains('citation-snippet-collapsed');

    if (isCollapsed) {
        snippet.classList.remove('citation-snippet-collapsed');
        btn.textContent = '收起';
    } else {
        snippet.classList.add('citation-snippet-collapsed');
        btn.textContent = '展开';
    }
}

/** 切换整个参考来源列表的展开/折叠 */
function toggleCitationList(btn) {
    const container = btn.closest('.citations-container');
    const list = container.querySelector('.citation-list');
    const isHidden = list.style.display === 'none';

    if (isHidden) {
        list.style.display = '';
        btn.textContent = '收起';
    } else {
        list.style.display = 'none';
        btn.textContent = '展开';
    }
}

function formatDate(dateString) {
    if (!dateString) return '未知时间';
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatFileSize(size) {
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==================== 摘要相关功能 ====================
async function generateSummary(documentId, event) {
    if (event) event.stopPropagation();
    
    try {
        showToast('正在生成摘要...', 'info');
        await generateSummaryAPI(documentId);
        showToast('摘要生成成功', 'success');
        currentDocuments = await getDocumentsByNotebook(currentNotebookId);
        notebookDocuments[currentNotebookId] = currentDocuments;
        renderNotebookTree();
        renderDocumentCards();
        // 如果正在文档详情页查看该文档，刷新摘要显示
        if (currentDocumentId === documentId) {
            selectDocument(documentId);
        }
    } catch (error) {
        showToast('摘要生成失败: ' + error.message, 'error');
    }
}

async function regenerateSummary(documentId, event) {
    if (event) event.stopPropagation();
    
    if (!confirm('确定要重新生成摘要吗？')) return;
    
    await generateSummary(documentId, event);
}

function toggleSummaryPreview(documentId, event) {
    if (event) event.stopPropagation();
    
    const preview = document.getElementById(`summary-preview-${documentId}`);
    const btn = event.target;
    
    if (preview.classList.contains('collapsed')) {
        preview.classList.remove('collapsed');
        btn.textContent = '收起';
    } else {
        preview.classList.add('collapsed');
        btn.textContent = '展开';
    }
}

// ==================== 上传进度遮罩 ====================
function showUploadOverlay() {
    document.getElementById('uploadOverlay').style.display = 'flex';
    const bar = document.getElementById('progressBar');
    bar.style.width = '0%';
    bar.style.transition = 'none';
    
    void bar.offsetWidth;
    
    bar.style.transition = 'width 3s ease-out';
    bar.style.width = '85%';
}

function hideUploadOverlay() {
    const bar = document.getElementById('progressBar');
    bar.style.transition = 'width 0.3s ease-out';
    bar.style.width = '100%';
    
    setTimeout(() => {
        document.getElementById('uploadOverlay').style.display = 'none';
        bar.style.width = '0%';
    }, 400);
}

// ==================== 拖动分隔条调整面板宽度 ====================
(function initResizeHandles() {
    const sidebar = document.querySelector('.sidebar');
    const rightPanel = document.querySelector('.right-panel');
    const leftHandle = document.getElementById('resizeLeft');
    const rightHandle = document.getElementById('resizeRight');

    if (!leftHandle || !rightHandle || !sidebar || !rightPanel) return;

    let isDragging = false;
    let currentHandle = null;
    let startX = 0;
    let startWidth = 0;

    function onMouseDown(e, handle, panel, isRight) {
        isDragging = true;
        currentHandle = { handle, panel, isRight };
        startX = e.clientX;
        startWidth = panel.getBoundingClientRect().width;
        handle.classList.add('active');
        document.body.classList.add('no-select');
        e.preventDefault();
    }

    leftHandle.addEventListener('mousedown', (e) => onMouseDown(e, leftHandle, sidebar, false));
    rightHandle.addEventListener('mousedown', (e) => onMouseDown(e, rightHandle, rightPanel, true));

    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !currentHandle) return;
        const dx = e.clientX - startX;
        let newWidth;
        if (currentHandle.isRight) {
            // 右侧面板：鼠标左移 → 面板变宽
            newWidth = startWidth - dx;
        } else {
            // 左侧面板：鼠标右移 → 面板变宽
            newWidth = startWidth + dx;
        }
        currentHandle.panel.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        if (currentHandle) {
            currentHandle.handle.classList.remove('active');
        }
        currentHandle = null;
        document.body.classList.remove('no-select');
    });
})();
