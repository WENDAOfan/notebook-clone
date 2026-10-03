const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findWorkspaceRoot, resolveStoragePath, configureStoragePaths } = require('../storage-path');
const config = require('../config-service');

const projectDirectory = path.resolve(__dirname, '..');
const workspaceDirectory = path.resolve(projectDirectory, '..');
const expectedDataDirectory = path.join(workspaceDirectory, '.local-data', 'notebook-electron');

test('development and workspace-local packaged builds use the same ignored data directory', () => {
  assert.equal(findWorkspaceRoot(projectDirectory), workspaceDirectory);
  assert.equal(resolveStoragePath({
    appDirectory: projectDirectory,
    executablePath: 'C:\\electron.exe',
    isPackaged: false,
    defaultUserData: 'C:\\old-data',
    env: {}
  }), expectedDataDirectory);
  assert.equal(resolveStoragePath({
    appDirectory: path.join(projectDirectory, 'dist', 'win-unpacked', 'resources', 'app.asar'),
    executablePath: path.join(projectDirectory, 'dist', 'win-unpacked', 'NotebookClone.exe'),
    isPackaged: true,
    defaultUserData: 'C:\\old-data',
    env: {}
  }), expectedDataDirectory);
});

test('external packaged builds retain their default unless explicitly overridden', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-storage-test-'));
  try {
    const options = {
      appDirectory: root,
      executablePath: path.join(root, 'NotebookClone.exe'),
      isPackaged: true,
      defaultUserData: path.join(root, 'default'),
      env: {}
    };
    assert.equal(resolveStoragePath(options), options.defaultUserData);
    assert.equal(resolveStoragePath({ ...options, env: { NOTEBOOK_DATA_DIR: path.join(root, 'D-drive') } }),
      path.join(root, 'D-drive'));
    assert.throws(() => resolveStoragePath({ ...options, env: { NOTEBOOK_DATA_DIR: 'relative' } }),
      /绝对路径/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('both Electron paths are set before startup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-storage-test-'));
  try {
    const chosen = path.join(root, 'data');
    const calls = [];
    const app = { setPath(name, value) { calls.push([name, value]); } };
    assert.equal(configureStoragePaths(app, {
      appDirectory: root,
      executablePath: path.join(root, 'NotebookClone.exe'),
      isPackaged: true,
      defaultUserData: path.join(root, 'default'),
      env: { NOTEBOOK_DATA_DIR: chosen }
    }), chosen);
    assert.deepEqual(calls, [['userData', chosen], ['sessionData', chosen]]);
    assert.equal(fs.existsSync(chosen), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an existing user-data config takes precedence over the old development config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-storage-test-'));
  try {
    const chosen = path.join(root, 'config.json');
    fs.writeFileSync(chosen, JSON.stringify({ deepseek: { apiKey: 'test-key' } }));
    const status = config.init({ userDataPath: root, isPackaged: false });
    assert.equal(status.configPath, chosen);
    assert.equal(status.deepseekReady, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
