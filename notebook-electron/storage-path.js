const fs = require('node:fs');
const path = require('node:path');

const DATA_DIRECTORY = path.join('.local-data', 'notebook-electron');

function findWorkspaceRoot(startDirectory) {
  let directory = path.resolve(startDirectory);
  while (true) {
    if (fs.existsSync(path.join(directory, 'notebook-electron', 'SPEC_CODING.md'))
        && fs.existsSync(path.join(directory, 'notebook-electron', 'package.json'))) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function resolveStoragePath({ appDirectory, executablePath, isPackaged, defaultUserData, env = process.env }) {
  const override = env.NOTEBOOK_DATA_DIR;
  if (override !== undefined && override !== '') {
    if (!path.isAbsolute(override)) throw new Error('NOTEBOOK_DATA_DIR 必须是绝对路径');
    return path.resolve(override);
  }

  const workspaceRoot = findWorkspaceRoot(isPackaged ? path.dirname(executablePath) : appDirectory);
  if (workspaceRoot) return path.join(workspaceRoot, DATA_DIRECTORY);
  if (!isPackaged) throw new Error('无法定位开发工作区，拒绝退回到 C 盘创建空数据目录');
  return defaultUserData;
}

function configureStoragePaths(app, options) {
  const directory = resolveStoragePath(options);
  fs.mkdirSync(directory, { recursive: true });
  fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
  return directory;
}

module.exports = { findWorkspaceRoot, resolveStoragePath, configureStoragePaths };
