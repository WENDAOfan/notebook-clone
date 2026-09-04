const fs = require('fs');
const path = require('path');

let config = null;
let configPath = null;
let lastError = null;

function hasRealKey(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && !value.startsWith('YOUR_');
}

function init({ userDataPath, isPackaged = false }) {
  const devPath = path.join(__dirname, 'config.json');
  const userPath = path.join(userDataPath, 'config.json');
  const templatePath = path.join(__dirname, 'config.example.json');

  configPath = isPackaged ? userPath : (fs.existsSync(devPath) ? devPath : userPath);
  lastError = null;

  if (!fs.existsSync(configPath) && fs.existsSync(templatePath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.copyFileSync(templatePath, configPath);
  }

  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    config = {};
    lastError = error.message;
  }

  return getStatus();
}

function getConfig() {
  if (!config) {
    throw new Error('AI 配置服务尚未初始化');
  }
  return config;
}

function getStatus() {
  const current = config || {};
  return {
    configPath,
    error: lastError,
    deepseekReady: hasRealKey(current.deepseek?.apiKey),
    zhipuReady: hasRealKey(current.zhipu?.apiKey),
    llamaParseReady: hasRealKey(current.llamaParse?.apiKey)
  };
}

function requireProvider(name) {
  const current = getConfig();
  const provider = current[name];
  if (!provider || !hasRealKey(provider.apiKey)) {
    const error = new Error(`${name} API Key 未配置，请编辑 ${configPath || 'config.json'}`);
    error.code = 'AI_CONFIG_MISSING';
    throw error;
  }
  return provider;
}

module.exports = {
  init,
  getConfig,
  getStatus,
  requireProvider
};
