const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const config = require('./config.json');
const { cleanText } = require('./text-cleaner');

// ==================== 文本清洗工具函数 ====================

// ==================== LlamaParse 云端解析 ====================

/**
 * 等待指定毫秒数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带有自动重试机制的 fetch 封装器
 * @param {string} url 请求地址
 * @param {object} options fetch 参数项
 * @param {number} maxRetries 最大重试次数，默认 3 次
 * @param {number} delay 每次重试前的等待时间（毫秒），默认 1500 毫秒
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3, delay = 1500) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      const isRetryable = err.name === 'TypeError'
        || err.code === 'ECONNRESET'
        || err.message.includes('fetch failed');

      if (isRetryable && i < maxRetries - 1) {
        console.warn(`[Network] 请求失败 (${err.message})。正在进行第 ${i + 1}/${maxRetries} 次自动重试...`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

/**
 * 调用 LlamaParse API 解析文件，返回结构化 Markdown 文本。
 * 采用"上传 → 轮询 → 拉取结果"的两步异步模式。
 *
 * @param {string} filePath 本地文件绝对路径
 * @returns {Promise<string>} Markdown 格式的文档文本
 */
async function extractWithLlamaParse(filePath) {
  const llamaConfig = config.llamaParse;
  if (!llamaConfig || !llamaConfig.apiKey) {
    throw new Error('LlamaParse API Key 未配置');
  }

  const apiKey = llamaConfig.apiKey;
  const baseURL = llamaConfig.baseURL || 'https://api.cloud.llamaindex.ai/api/parsing';
  const language = llamaConfig.language || 'ch_sim';
  const resultType = llamaConfig.resultType || 'markdown';

  console.log(`[LlamaParse] 开始上传文件: ${path.basename(filePath)}`);

  // --- 步骤 1：上传文件 ---
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  // Node.js 18+ 内置 FormData & fetch
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
  formData.append('file', blob, fileName);
  formData.append('language', language);
  formData.append('result_type', resultType);

  const uploadRes = await fetchWithRetry(`${baseURL}/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`LlamaParse 上传失败 (${uploadRes.status}): ${errText}`);
  }

  const uploadData = await uploadRes.json();
  const jobId = uploadData.id;
  if (!jobId) {
    throw new Error('LlamaParse 未返回有效的 job ID');
  }

  console.log(`[LlamaParse] 上传成功，Job ID: ${jobId}，开始轮询...`);

  // --- 步骤 2：轮询任务状态 ---
  const MAX_POLLS = 60;  // 最多等待 300 秒
  const POLL_INTERVAL = 5000; // 每次间隔 5 秒

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL);

    const statusRes = await fetchWithRetry(`${baseURL}/job/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!statusRes.ok) {
      const errText = await statusRes.text();
      throw new Error(`LlamaParse 轮询失败 (${statusRes.status}): ${errText}`);
    }

    const statusData = await statusRes.json();
    const status = statusData.status;

    console.log(`[LlamaParse] 轮询 ${i + 1}/${MAX_POLLS}，状态: ${status}`);

    if (status === 'SUCCESS') {
      // --- 步骤 3：拉取 Markdown 结果 ---
      const resultRes = await fetchWithRetry(`${baseURL}/job/${jobId}/result/${resultType}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!resultRes.ok) {
        const errText = await resultRes.text();
        throw new Error(`LlamaParse 拉取结果失败 (${resultRes.status}): ${errText}`);
      }

      const resultData = await resultRes.json();
      // LlamaParse 返回格式: { markdown: "..." } 或 { pages: [{md: "..."}] }
      const markdownText = resultData.markdown
        || (resultData.pages && resultData.pages.map(p => p.md || p.text || '').join('\n\n'))
        || '';

      console.log(`[LlamaParse] 解析成功，提取文本长度: ${markdownText.length} 字符`);
      return markdownText;

    } else if (status === 'ERROR' || status === 'FAILED') {
      throw new Error(`LlamaParse 任务失败，状态: ${status}，详情: ${JSON.stringify(statusData)}`);
    }
    // 其他状态 (PENDING / STARTED) 继续等待
  }

  throw new Error(`LlamaParse 解析超时（超过 ${MAX_POLLS * POLL_INTERVAL / 1000} 秒）`);
}

// ==================== 主入口：智能分发解析 ====================

/**
 * 依据后缀类型解析文件并清洗文本。
 * - .txt / .md：直接本地读取
 * - .pdf / .docx：优先使用 LlamaParse 云端解析，失败时降级至本地（LiteParse / mammoth）
 *
 * @param {string} filePath 本地文件路径
 * @returns {Promise<string>} 解析清洗后的文本
 */
async function extractText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  let rawText = '';

  // TXT / MD：本地直读，无需云端
  if (ext === '.txt' || ext === '.md') {
    rawText = fs.readFileSync(filePath, 'utf-8');
    return cleanText(rawText);
  }

  // PDF / DOCX：优先 LlamaParse，失败时 fallback 到本地库
  if (ext === '.pdf' || ext === '.docx') {
    const llamaApiKey = config.llamaParse && config.llamaParse.apiKey;

    if (llamaApiKey) {
      try {
        console.log(`[Extractor] 检测到 LlamaParse API Key，尝试云端解析: ${path.basename(filePath)}`);
        rawText = await extractWithLlamaParse(filePath);
        // LlamaParse 输出的 Markdown 本身已很干净，仅做轻度清洗
        return cleanText(rawText);
      } catch (err) {
        console.warn(`[Extractor] LlamaParse 解析失败，降级至本地（LiteParse/mammoth）。原因: ${err.message}`, err.cause || '');
        // 继续执行下方的 fallback 逻辑
      }
    } else {
      console.log(`[Extractor] 未配置 LlamaParse API Key，使用本地解析（LiteParse/mammoth）: ${path.basename(filePath)}`);
    }

    // ---- Fallback：本地解析（LiteParse for PDF, mammoth for DOCX）----
    if (ext === '.docx') {
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        rawText = result.value;
      } catch (e) {
        rawText = `[Word文档解析失败: ${e.message}]\n文件名: ${path.basename(filePath)}`;
      }
    } else if (ext === '.pdf') {
      try {
        // @llamaindex/liteparse 是 ESM 包，需用动态 import() 加载
        const { LiteParse } = await import('@llamaindex/liteparse');
        const parser = new LiteParse({ ocrLanguage: 'chi_sim' });
        const result = await parser.parse(filePath);
        rawText = result.markdown || result.text || '';
        if (!rawText || rawText.trim().length === 0) {
          rawText = `[PDF文本提取为空，该文件可能是扫描版/图片型PDF，暂无法提取文本内容]\n文件名: ${path.basename(filePath)}`;
        }
      } catch (e) {
        rawText = `[PDF解析失败: ${e.message}]\n文件名: ${path.basename(filePath)}`;
      }
    }

    return cleanText(rawText);
  }

  throw new Error(`不支持的文件格式: ${ext}`);
}

module.exports = {
  extractText,
  cleanText
};
