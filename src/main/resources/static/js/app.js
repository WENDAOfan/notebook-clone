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
window.sessionTokenTotal = 0;

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    checkLoginStatus();
});

// ==================== 登录状态管理 ====================
function checkLoginStatus() {
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('currentUser');

    if (savedToken && savedUser) {
        try {
            authToken = savedToken;
            currentUser = JSON.parse(savedUser);
            showMainApp();
        } catch (e) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUser');
            showAuthPage();
        }
    } else {
        showAuthPage();
    }
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
const API_BASE = '';

async function fetchAPI(url, options = {}) {
    try {
        const headers = {
            'Content-Type': 'application/json',
        };
        
        if (authToken) {
            headers['Authorization'] = 'Bearer ' + authToken;
        }
        
        const response = await fetch(`${API_BASE}${url}`, {
            headers: headers,
            ...options,
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                showToast('登录已过期，请重新登录', 'error');
                logout();
                return;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.code !== 200) {
            throw new Error(result.message || '操作失败');
        }
        
        return result.data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// ==================== 认证相关 API ====================
async function loginAPI(username, password) {
    return fetchAPI('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });
}

async function registerAPI(username, password) {
    return fetchAPI('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });
}

// ==================== 登录/注册处理 ====================
async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!username || !password) {
        showToast('请输入用户名和密码', 'error');
        return;
    }
    
    try {
        const response = await loginAPI(username, password);
        
        authToken = response.token;
        currentUser = {
            id: response.id,
            username: response.username,
            email: response.email
        };
        
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        showToast('登录成功', 'success');
        showMainApp();
    } catch (error) {
        showToast('登录失败: ' + error.message, 'error');
    }
}

async function register() {
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;
    
    if (!username || !password) {
        showToast('请输入用户名和密码', 'error');
        return;
    }
    
    if (password.length < 6) {
        showToast('密码至少需要6位', 'error');
        return;
    }
    
    if (password !== confirmPassword) {
        showToast('两次输入的密码不一致', 'error');
        return;
    }
    
    try {
        await registerAPI(username, password);
        showToast('注册成功，请登录', 'success');
        showLogin();
    } catch (error) {
        showToast('注册失败: ' + error.message, 'error');
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    currentNotebookId = null;
    currentDocuments = [];
    notebooks = [];
    currentDocumentId = null;
    expandedNotebooks = new Set();
    notebookDocuments = {};
    selectedFile = null;
    
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    
    showToast('已退出登录', 'info');
    showAuthPage();
}

// 回车键登录/注册
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const authPage = document.getElementById('authPage');
        if (authPage.style.display !== 'none') {
            const loginForm = document.getElementById('loginForm');
            if (loginForm.style.display !== 'none') {
                login();
            } else {
                register();
            }
        }
    }
});

// ==================== 笔记本相关 API ====================
async function getAllNotebooks() {
    return fetchAPI('/api/notebooks');
}

async function createNotebookAPI(data) {
    return fetchAPI('/api/notebooks', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

async function updateNotebookAPI(id, data) {
    return fetchAPI(`/api/notebooks/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}

async function deleteNotebookAPI(id) {
    return fetchAPI(`/api/notebooks/${id}`, {
        method: 'DELETE',
    });
}

// ==================== 文档相关 API ====================
async function generateSummaryAPI(id) {
    return fetchAPI(`/api/documents/${id}/summary`, {
        method: 'POST',
    });
}

async function getDocumentsByNotebook(notebookId) {
    return fetchAPI(`/api/documents/notebook/${notebookId}`);
}

async function createDocumentAPI(data, notebookId) {
    return fetchAPI(`/api/documents?notebookId=${notebookId}`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

async function deleteDocumentAPI(id) {
    return fetchAPI(`/api/documents/${id}`, {
        method: 'DELETE',
    });
}

async function uploadDocumentFileAPI(file, notebookId, additionalContent) {
    const formData = new FormData();
    formData.append('file', file);
    if (additionalContent) {
        formData.append('additionalContent', additionalContent);
    }
    
    const headers = {};
    if (authToken) {
        headers['Authorization'] = 'Bearer ' + authToken;
    }
    
    const response = await fetch(`${API_BASE}/api/documents/upload?notebookId=${notebookId}`, {
        method: 'POST',
        headers: headers,
        body: formData,
    });
    
    if (!response.ok) {
        if (response.status === 401) {
            showToast('登录已过期，请重新登录', 'error');
            logout();
            throw new Error('登录已过期');
        }
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.code !== 200) {
        throw new Error(result.message || '上传失败');
    }
    
    return result.data;
}

async function askDocumentAPI(documentId, question, useDocumentContext) {
    return fetchAPI(`/api/documents/${documentId}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question, useDocumentContext }),
    });
}

async function askNotebookAPI(notebookId, question) {
    return fetchAPI(`/api/notebooks/${notebookId}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question }),
    });
}

// ==================== SSE 流式请求封装 ====================
async function fetchStream(url, params, onChunk, onTokenUsage, onError) {
    const queryString = new URLSearchParams(params).toString();
    const fullUrl = `${API_BASE}${url}${queryString ? '?' + queryString : ''}`;

    const headers = {};
    if (authToken) {
        headers['Authorization'] = 'Bearer ' + authToken;
    }

    const response = await fetch(fullUrl, { headers });

    if (!response.ok) {
        throw new Error(`请求失败：${response.status} ${response.statusText}`);
    }

    if (!response.body) {
        throw new Error('响应体为空');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedData = false;

    function processBuffer() {
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop();

        for (const block of blocks) {
            const lines = block.split('\n');
            let eventName = 'message';
            let data = '';

            for (const line of lines) {
                const trimmedLine = line.replace(/\r$/, '');
                if (trimmedLine.startsWith('event:')) {
                    eventName = trimmedLine.slice(6).trim();
                } else if (trimmedLine.startsWith('data:')) {
                    data += trimmedLine.slice(5);
                }
            }

            if (!data) continue;

            if (eventName === 'token-usage') {
                try {
                    const usage = JSON.parse(data);
                    if (onTokenUsage) onTokenUsage(usage);
                } catch (e) {
                    console.warn('token-usage 解析失败:', data);
                }
            } else {
                onChunk(data);
            }
        }
    }

    try {
        while (true) {
            let done, value;
            try {
                ({ done, value } = await reader.read());
            } catch (readError) {
                if (receivedData) break;
                throw readError;
            }
            if (done) break;
            receivedData = true;

            buffer += decoder.decode(value, { stream: true });
            processBuffer();
        }
    } finally {
        reader.releaseLock();
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
        processBuffer();
    }
}

function askDocumentStreamAPI(documentId, question, useDocumentContext, onChunk, onTokenUsage) {
    return fetchStream(
        `/api/documents/${documentId}/ask/stream`,
        { question, useDocumentContext },
        onChunk,
        onTokenUsage
    );
}

function askNotebookStreamAPI(notebookId, question, onChunk, onTokenUsage) {
    return fetchStream(
        `/api/notebooks/${notebookId}/ask/stream`,
        { question },
        onChunk,
        onTokenUsage
    );
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
        
        html += `<div class="tree-notebook-item ${isActive ? 'active' : ''}" 
                       onclick="selectNotebook(${notebook.id})" 
                       title="${escapeHtml(notebook.description || '')}">
            <span class="tree-toggle" onclick="toggleNotebook(${notebook.id}, event)">${isExpanded ? '▼' : '▶'}</span>
            <span class="tree-notebook-icon">📁</span>
            <span class="tree-notebook-name">${escapeHtml(notebook.name)}</span>
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
                <div class="document-title">${escapeHtml(doc.title)}</div>
                <div class="document-meta">
                    创建于 ${formatDate(doc.createTime)}
                    ${doc.content ? ` · ${formatFileSize(doc.content.length)}` : ''}
                </div>
                ${summaryHtml}
            </div>
            <div class="document-actions">
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
            const uploadedDoc = await uploadDocumentFileAPI(selectedFile, currentNotebookId, additionalContent);
            hideUploadOverlay();
            showToast('文档创建成功，摘要生成中...', 'success');
            closeModal('createDocumentModal');
            resetDocCreateModal();
            currentDocuments.push(uploadedDoc);
            notebookDocuments[currentNotebookId] = currentDocuments;
            showNotebookView();
            pollSummaryReady(uploadedDoc.id, 1, 12);
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
            const { answer, citations } = parseCitations(msg.content, defaultTitle);
            ai.textEl.innerHTML = DOMPurify.sanitize(marked.parse(answer));
            if (citations.length > 0) {
                renderCitationCards(citations, ai.citationEl);
            }
        }
    }
    container.scrollTop = container.scrollHeight;
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
        await fetchAPI(`/api/notebooks/${currentNotebookId}/chat/history`, { method: 'DELETE' });
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

    try {
        await askDocumentStreamAPI(
            currentDocId,
            question,
            useDocumentContext,
            (chunk) => {
                ai.rawText += chunk;
                ai.textEl.textContent = ai.rawText;
                chatHistory.scrollTop = chatHistory.scrollHeight;
            },
            (usage) => {
                currentUsage = usage;
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
        const { answer, citations } = parseCitations(ai.rawText, currentDocTitle);
        ai.textEl.innerHTML = DOMPurify.sanitize(marked.parse(answer));

        if (citations.length > 0) {
            renderCitationCards(citations, ai.citationEl);
        }

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
    // Day 30：加载该笔记本的对话历史
    loadNotebookChatHistory(currentNotebookId);
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

    try {
        await askNotebookStreamAPI(
            currentNotebookId,
            question,
            (chunk) => {
                ai.rawText += chunk;
                ai.textEl.textContent = ai.rawText;
                chatHistory.scrollTop = chatHistory.scrollHeight;
            },
            (usage) => {
                currentUsage = usage;
            }
        );

        showToast('回答完成', 'success');
    } catch (error) {
        showToast('回答失败：' + error.message, 'error');
        ai.rawText = '获取回答失败，请稍后重试。';
        ai.textEl.textContent = ai.rawText;
    } finally {
        ai.textEl.classList.remove('streaming');

        const { answer, citations } = parseCitations(ai.rawText);
        ai.textEl.innerHTML = DOMPurify.sanitize(marked.parse(answer));

        if (citations.length > 0) {
            renderCitationCards(citations, ai.citationEl);
        }

        if (currentUsage) {
            ai.tokenEl.innerHTML = renderTokenUsageHtml(currentUsage);
            ai.tokenEl.style.display = 'block';
            accumulateSessionTokens(currentUsage.total);
        }

        document.getElementById('notebookClearChatBtn').style.display = 'inline-flex';
        chatHistory.scrollTop = chatHistory.scrollHeight;
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
    
    selectedFile = file;
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
            if (doc && doc.summary !== '摘要生成中...') {
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
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('show');
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
