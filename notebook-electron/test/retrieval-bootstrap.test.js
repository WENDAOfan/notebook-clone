const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { applicationPolicy } = require('../retrieval-runtime-policy');
const { DEFAULT_POLICY } = require('../retrieval-service');

// Execute the actual main-process startup with isolated Electron/storage adapters.
// No window, personal database, configuration file or network connection is opened.
async function bootstrap(settings, ready) {
  const calls = [];
  let startup;
  class Window {
    constructor() { calls.push(['window']); }
    loadFile() {}
    on() {}
  }
  const modules = {
    electron: { app: { isPackaged: false, getPath: () => '/isolated', on() {},
      whenReady: () => ({ then(fn) { startup = fn(); } }) },
      BrowserWindow: Window, ipcMain: { handle() {}, on() {} } },
    path, fs: {}, dns: {},
    './storage-path': { configureStoragePaths() {} },
    './database': { async init() { calls.push(['database']); }, async getAllNotebooks() { return []; } },
    './vector-store': { init() {}, store: [], async cleanupOrphans() {} },
    './embedding-client': { async invalidateCorruptIndexes() {} },
    './config-service': { init() { calls.push(['config']); return { deepseekReady: ready }; },
      getConfig: () => settings },
    './retrieval-runtime-policy': { applicationPolicy },
    './retrieval-service': { configure(options) { calls.push(['retrieval', options.thresholds]); } },
    './notebook-mcp': { async startNotebookMcp() { return null; } },
    './rag-service': {}, './extractor': {}, './agent-service': {},
    './research-service': {}, './graph-service': {}, './research-providers': {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'), {
    require(name) { assert.ok(Object.hasOwn(modules, name), `Unexpected startup dependency: ${name}`); return modules[name]; },
    __dirname: path.join(__dirname, '..'), process: { execPath: '/isolated/electron', platform: 'win32' },
    console: { error(...args) { throw new Error(`Startup failed: ${args.join(' ')}`); } }
  }, { filename: 'main.js' });
  await startup;
  return calls;
}

test('真实 main 在读取配置后、打开窗口前应用已验证紧凑重排策略', async () => {
  const calls = await bootstrap({}, true);
  assert.deepEqual(calls.map(call => call[0]), ['config', 'retrieval', 'database', 'window']);
  assert.deepEqual(calls[1][1], { ...DEFAULT_POLICY, rerank: true });
  const enabled = await bootstrap({ retrieval: { rerank: true } }, true);
  assert.deepEqual(enabled[1][1], { ...DEFAULT_POLICY, rerank: true });
});

test('真实 main 启动尊重关闭开关，并在模型未配置时保持离线策略', async () => {
  for (const [settings, ready] of [[{ retrieval: { rerank: false } }, true], [{}, false]]) {
    const calls = await bootstrap(settings, ready);
    assert.equal(calls[1][1].rerank, false);
  }
});
