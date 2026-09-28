const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-ui-smoke-'));
  const brokenPdf = path.join(temporary, 'broken.pdf');
  fs.writeFileSync(brokenPdf, 'not a PDF');
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'ui-launch.cjs')], env: { ...process.env, NOTEBOOK_SMOKE_DATA: temporary } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.electronAPI && typeof renderRetrievalDiagnostics === 'function');
    const result = await page.evaluate(async brokenFile => {
      const notebook = (await window.electronAPI.createNotebook({ name: 'UI隔离测试', description: '' })).data;
      const upload = await window.electronAPI.uploadDocumentFile(brokenFile, notebook.id, '说明不能掩盖失败', '失败文件');
      const documents = await window.electronAPI.getDocumentsByNotebook(notebook.id);
      const container = document.createElement('div');
      document.body.appendChild(container);
      renderRetrievalDiagnostics({ warnings: ['未覆盖文档：待索引', '引用校验未通过'], rounds: [{ retrievalQuery: '测试' }] }, container);
      const history = document.createElement('div');
      document.body.appendChild(history);
      renderChatHistory([{ role: 'assistant', content: '答案[99]', metadata: { sources: [], retrieval: { warnings: ['引用校验未通过'] } } }], history, '文档');
      return { uploadCode: upload.code, documents: documents.data.length, warning: container.textContent,
        details: container.querySelectorAll('details').length, fakeCards: history.querySelectorAll('.citation-card').length,
        historyWarning: history.textContent.includes('引用校验未通过') };
    }, brokenPdf);
    assert.notEqual(result.uploadCode, 200);
    assert.equal(result.documents, 0);
    assert.match(result.warning, /未覆盖文档/);
    assert.equal(result.details, 1);
    assert.equal(result.fakeCards, 0);
    assert.equal(result.historyWarning, true);
    const scope = await app.evaluate(async () => {
      const { db, rag, retrieval, vectors, crypto } = globalThis.__notebookSmoke;
      const notebook = await db.createNotebook('问答测试', '');
      const ready = await db.createDocument(notebook.id, '就绪文档', '型号X1保修12个月');
      const pending = await db.createDocument(notebook.id, '待索引文档', '待索引');
      const hash = crypto.createHash('sha256').update(ready.content).digest('hex');
      await db.updateDocumentIndexStatus(ready.id, 'ready', { contentHash: hash });
      await vectors.replaceDocumentChunks(ready.id, [{ id: 'smoke', text: ready.content, embedding: [1,0], metadata: { documentId: ready.id, documentTitle: ready.title, contentHash: hash, embeddingModel: 'embedding-3' } }]);
      retrieval.configure({ getEmbedding: async () => [1,0] });
      rag.configureAskClient(() => ({ provider: {}, client: { chat: { completions: { create: async options => {
        const delta = options.messages.some(message => message.role === 'tool') ? { content: '答案[1]' } : { tool_calls: [{ index: 0, id: 'smoke', function: { name: 'search_knowledge_base', arguments: '{"query":"型号X1保修"}' } }] };
        return (async function* () { yield { choices: [{ delta }] }; })();
      } } } } }));
      return { notebookId: notebook.id, pendingId: pending.id };
    });
    const ask = async payload => page.evaluate(payload => new Promise((resolve, reject) => {
      let sources;
      const cleanSources = window.electronAPI.onChatSources(data => { if (data.requestId === payload.requestId) sources = data; });
      const cleanEnd = window.electronAPI.onChatEnd(data => { if (data.requestId === payload.requestId) { cleanSources(); cleanEnd(); cleanError(); resolve({ ...data, sources }); } });
      const cleanError = window.electronAPI.onChatError(data => { if (data.requestId === payload.requestId) { cleanSources(); cleanEnd(); cleanError(); reject(new Error(data.message)); } });
      window.electronAPI.askStream(payload);
      if (payload.cancel) setTimeout(() => window.electronAPI.abortAsk(payload.requestId), 20);
    }), payload);
    const partial = await ask({ id: scope.notebookId, type: 'notebook', useDocContext: true, question: '保修多久', requestId: 'partial' });
    assert.equal(partial.sources.sources.length, 1);
    assert.match(partial.sources.diagnostics.warnings.join(''), /待索引文档/);
    const pending = await ask({ id: scope.pendingId, type: 'doc', useDocContext: true, question: '保修多久', requestId: 'pending' });
    assert.equal(pending.sources.sources.length, 0);
    await app.evaluate(() => { globalThis.__notebookSmoke.rag.configureAskClient(() => ({ provider: {}, client: { chat: { completions: { create: async () => new Promise(() => {}) } } } })); });
    const aborted = await ask({ id: scope.notebookId, type: 'notebook', useDocContext: false, question: '你好', requestId: 'abort', cancel: true });
    assert.equal(aborted.aborted, true);
    result.partialNotebook = true;
    result.pendingDocument = true;
    result.abort = true;
    fs.writeFileSync(path.join(__dirname, 'ui-smoke-report.json'), JSON.stringify({ status: 'PASS', ...result }, null, 2));
    console.log(result);
  } finally {
    if (app) await app.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
