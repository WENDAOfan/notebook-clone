// ==================== 全局状态 ====================
let notebooks = [];
let currentNotebookId = null;
let currentDocuments = [];
let currentUser = null;

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    checkLoginStatus();
});

// ==================== 登录状态管理 ====================
function checkLoginStatus() {
    // 从 localStorage 读取用户信息
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showMainApp();
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
    loadNotebooks();
}

function showRegister() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    // 清空表单
    document.getElementById('registerUsername').value = '';
    document.getElementById('registerPassword').value = '';
    document.getElementById('registerConfirmPassword').value = '';
}

function showLogin() {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    // 清空表单
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
}

// ==================== API 封装 ====================
const API_BASE = '';

async function fetchAPI(url, options = {}) {
    try {
        const defaultHeaders = {
            'Content-Type': 'application/json',
        };
        
        // TODO: Day 13 JWT 改造后，在这里添加 Token
        // const token = localStorage.getItem('token');
        // if (token) {
        //     defaultHeaders['Authorization'] = 'Bearer ' + token;
        // }
        
        const response = await fetch(`${API_BASE}${url}`, {
            headers: defaultHeaders,
            ...options,
        });
        
        if (!response.ok) {
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
        const user = await loginAPI(username, password);
        currentUser = user;
        
        // 保存用户信息到 localStorage
        localStorage.setItem('currentUser', JSON.stringify(user));
        
        // TODO: Day 13 JWT 改造后，保存 Token
        // localStorage.setItem('token', token);
        
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
    // 清除登录状态
    currentUser = null;
    currentNotebookId = null;
    currentDocuments = [];
    notebooks = [];
    
    localStorage.removeItem('currentUser');
    // TODO: Day 13 JWT 改造后，清除 Token
    // localStorage.removeItem('token');
    
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

async function uploadDocumentFileAPI(file, notebookId) {
    const formData = new FormData();
    formData.append('file', file);
    
    const headers = {};
    // TODO: Day 13 JWT 改造后，在这里添加 Token
    // const token = localStorage.getItem('token');
    // if (token) {
    //     headers['Authorization'] = 'Bearer ' + token;
    // }
    
    const response = await fetch(`${API_BASE}/api/documents/upload?notebookId=${notebookId}`, {
        method: 'POST',
        headers: headers,
        body: formData,
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.code !== 200) {
        throw new Error(result.message || '上传失败');
    }
    
    return result.data;
}

// ==================== UI 渲染 ====================
function renderNotebookList() {
    const container = document.getElementById('notebookList');
    
    if (notebooks.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;">
                <div class="empty-state-icon">📭</div>
                <p>还没有笔记本</p>
                <p style="font-size: 12px; margin-top: 8px;">点击右上角按钮创建</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = notebooks.map(notebook => `
        <div class="notebook-item ${notebook.id === currentNotebookId ? 'active' : ''}" 
             onclick="selectNotebook(${notebook.id})" 
             title="${notebook.description || ''}">
            <span class="icon">📁</span>
            <span class="name">${escapeHtml(notebook.name)}</span>
        </div>
    `).join('');
}

function renderDocumentList() {
    const container = document.getElementById('documentList');
    const currentNotebook = notebooks.find(n => n.id === currentNotebookId);
    
    document.getElementById('currentNotebookName').textContent = 
        currentNotebook ? `📄 ${escapeHtml(currentNotebook.name)} - 文档列表` : '📄 文档列表';
    
    document.getElementById('contentActions').style.display = currentNotebookId ? 'flex' : 'none';
    
    document.getElementById('btnRename').disabled = !currentNotebookId;
    document.getElementById('btnDeleteNotebook').disabled = !currentNotebookId;
    
    if (!currentNotebookId) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📁</div>
                <p>请先在左侧选择一个笔记本</p>
            </div>
        `;
        return;
    }
    
    if (currentDocuments.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <p>这个笔记本还没有文档</p>
                <p style="font-size: 12px; margin-top: 8px;">点击上方按钮创建或上传</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = currentDocuments.map(doc => `
        <div class="document-item">
            <span class="document-icon">📄</span>
            <div class="document-info">
                <div class="document-title">${escapeHtml(doc.title)}</div>
                <div class="document-meta">
                    创建于 ${formatDate(doc.createTime)}
                    ${doc.content ? `· ${formatFileSize(doc.content.length)}` : ''}
                </div>
            </div>
            <div class="document-actions">
                <button class="btn btn-secondary btn-small" onclick="viewDocument(${doc.id})">查看</button>
                <button class="btn btn-danger btn-small" onclick="deleteDocument(${doc.id})">删除</button>
            </div>
        </div>
    `).join('');
}

// ==================== 事件处理 ====================
async function loadNotebooks() {
    try {
        notebooks = await getAllNotebooks();
        renderNotebookList();
    } catch (error) {
        showToast('加载笔记本失败: ' + error.message, 'error');
    }
}

async function selectNotebook(id) {
    currentNotebookId = id;
    renderNotebookList();
    
    try {
        currentDocuments = await getDocumentsByNotebook(id);
        renderDocumentList();
    } catch (error) {
        showToast('加载文档失败: ' + error.message, 'error');
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
        await createNotebookAPI({ name, description });
        closeModal('createNotebookModal');
        document.getElementById('notebookName').value = '';
        document.getElementById('notebookDescription').value = '';
        showToast('笔记本创建成功', 'success');
        await loadNotebooks();
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
        const currentNotebook = notebooks.find(n => n.id === currentNotebookId);
        if (currentNotebook) {
            document.getElementById('currentNotebookName').textContent = `📄 ${escapeHtml(name)} - 文档列表`;
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
        currentNotebookId = null;
        currentDocuments = [];
        showToast('笔记本删除成功', 'success');
        await loadNotebooks();
        renderDocumentList();
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
}

async function createDocument() {
    if (!currentNotebookId) return;
    
    const title = document.getElementById('documentTitle').value.trim();
    const content = document.getElementById('documentContent').value;
    
    if (!title) {
        showToast('请输入文档标题', 'error');
        return;
    }
    
    try {
        await createDocumentAPI({ title, content }, currentNotebookId);
        closeModal('createDocumentModal');
        document.getElementById('documentTitle').value = '';
        document.getElementById('documentContent').value = '';
        showToast('文档创建成功', 'success');
        currentDocuments = await getDocumentsByNotebook(currentNotebookId);
        renderDocumentList();
    } catch (error) {
        showToast('创建失败: ' + error.message, 'error');
    }
}

async function deleteDocument(id) {
    if (!confirm('确定要删除这个文档吗？')) return;
    
    try {
        await deleteDocumentAPI(id);
        showToast('文档删除成功', 'success');
        currentDocuments = await getDocumentsByNotebook(currentNotebookId);
        renderDocumentList();
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
}

function viewDocument(id) {
    const doc = currentDocuments.find(d => d.id === id);
    if (!doc) return;
    
    document.getElementById('viewDocumentTitle').textContent = doc.title;
    document.getElementById('viewDocumentContent').textContent = doc.content || '（无内容）';
    showModal('viewDocumentModal');
}

function triggerFileUpload() {
    document.getElementById('fileInput').click();
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.endsWith('.txt')) {
        showToast('请选择 .txt 文件', 'error');
        return;
    }
    
    try {
        showToast('正在上传...', 'info');
        await uploadDocumentFileAPI(file, currentNotebookId);
        showToast('文件上传成功', 'success');
        event.target.value = '';
        currentDocuments = await getDocumentsByNotebook(currentNotebookId);
        renderDocumentList();
    } catch (error) {
        showToast('上传失败: ' + error.message, 'error');
    }
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
