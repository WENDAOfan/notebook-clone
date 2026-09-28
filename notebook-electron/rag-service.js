const { OpenAI } = require('openai');
const { getEncoding } = require('js-tiktoken');
const crypto = require('crypto');
const { ANSWER_GROUNDING_POLICY } = require('./answer-policy');
const { requestEmbeddings } = require('./embedding-client');
const configService = require('./config-service');
const db = require('./database');
const vectorStore = require('./vector-store');
const retrievalService = require('./retrieval-service');

let deepseekClient = null;
let zhipuClient = null;

function getDeepseekClient() {
  const provider = configService.requireProvider('deepseek');
  if (!deepseekClient) {
    deepseekClient = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });
  }
  return { client: deepseekClient, provider };
}

function getZhipuClient() {
  const provider = configService.requireProvider('zhipu');
  if (!zhipuClient) {
    zhipuClient = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });
  }
  return { client: zhipuClient, provider };
}

/**
 * 依据 Token 数量进行分块
 * @param {string} text 待分块文本
 * @param {number} chunkSize 每个分块 Token 上限 (默认 512)
 * @param {number} chunkOverlap 重合 Token 数 (默认 50)
 * @returns {Array<string>} 分块文本数组
 */
function splitTextIntoChunks(text, chunkSize = 512, chunkOverlap = 100) {
  if (!text) return [];
  const enc = getEncoding('cl100k_base');
  const chunks = [];
  const overlap = Math.min(Math.max(chunkOverlap, 0), Math.max(chunkSize - 1, 0));
  let current = [];

  const flush = () => {
    if (!current.length) return;
    const value = enc.decode(current).trim();
    if (value) chunks.push(value);
    current = current.slice(Math.max(0, current.length - overlap));
  };

  const appendTokens = tokens => {
    let offset = 0;
    while (offset < tokens.length) {
      const capacity = chunkSize - current.length;
      if (capacity <= 0) flush();
      const available = chunkSize - current.length;
      const take = Math.min(available, tokens.length - offset);
      current.push(...tokens.slice(offset, offset + take));
      offset += take;
      if (current.length >= chunkSize) flush();
    }
  };

  for (const paragraph of text.split(/\n\n+/)) {
    const paragraphTokens = enc.encode(paragraph);
    if (paragraphTokens.length <= chunkSize) {
      const separator = current.length ? enc.encode('\n\n') : [];
      if (current.length + separator.length + paragraphTokens.length > chunkSize) flush();
      if (current.length) appendTokens(separator);
      appendTokens(paragraphTokens);
      continue;
    }
    for (const sentence of paragraph.split(/(?<=[。？！；.!?;\n])/)) {
      const sentenceTokens = enc.encode(sentence);
      if (current.length && current.length + sentenceTokens.length > chunkSize) flush();
      appendTokens(sentenceTokens);
    }
  }
  if (current.length) {
    const value = enc.decode(current).trim();
    if (value) chunks.push(value);
  }
  return [...new Set(chunks)];
}

/**
 * 获取文本向量
 */
async function getEmbedding(text, signal) {
  const { client, provider } = getZhipuClient();
  return (await requestEmbeddings(client, provider, text, signal))[0];
}

/**
 * 批量获取文本向量（减少网络请求次数）
 */
async function getEmbeddings(texts) {
  if (!texts || texts.length === 0) return [];
  const embeddings = [];
  const batchSize = 16; // 限制单批最高并发条数

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const { client, provider } = getZhipuClient();
    const batchEmbeddings = await requestEmbeddings(client, provider, batch);
    embeddings.push(...batchEmbeddings);
  }
  return embeddings;
}

// ==================== 混合检索（Hybrid Search）====================

/**
 * 查询分词：从用户问题中提取可用于关键词检索的搜索词。
 * - 中文：提取连续中文字符序列，≥2 字符
 * - 英文：提取单词，≥3 字符，转小写
 *
 * @param {string} query 用户原始查询
 * @returns {Array<string>} 去重后的搜索词数组
 */
function tokenizeQuery(query) {
  if (!query) return [];
  const terms = [];

  // 提取中文字符序列（连续2个及以上的中文字符）
  const chineseMatches = query.match(/[\u4e00-\u9fff]{2,}/g);
  if (chineseMatches) {
    terms.push(...chineseMatches);
  }

  // 提取英文单词（3个及以上字母）
  const englishMatches = query.match(/[a-zA-Z]{3,}/g);
  if (englishMatches) {
    terms.push(...englishMatches.map(w => w.toLowerCase()));
  }

  // 去重
  return [...new Set(terms)];
}

/**
 * 混合检索：向量检索 + 关键词检索 + RRF 融合排序 + 相似度阈值过滤。
 *
 * 流程：
 * 1. 向量检索 top30（语义匹配）
 * 2. 关键词检索 top30（精确匹配）
 * 3. RRF (Reciprocal Rank Fusion) 融合两路排名
 * 4. 过滤掉向量相似度低于阈值的结果（纯关键词命中仍保留）
 * 5. 取 topK 返回
 *
 * @param {Array<number>} queryEmbedding 查询向量
 * @param {string} query 原始查询文本（用于关键词检索）
 * @param {number} topK 最终返回条数
 * @param {Function|null} filterFunc 元数据过滤函数
 * @param {number} threshold 向量余弦相似度阈值，低于此值的结果被过滤
 * @returns {Array} 融合排序后的分块列表 [{ id, text, metadata, score, vectorScore }]
 */
function hybridSearch(queryEmbedding, query, topK = 5, filterFunc = null, threshold = 0.35) {
  const RRF_K = 60; // RRF 平滑常数，防止排名靠前的结果权重过大
  const SEARCH_DEPTH = 30; // 两路检索各取 top30 做候选池

  // --- 路径 A：向量语义检索 ---
  const vectorResults = vectorStore.similaritySearch(queryEmbedding, SEARCH_DEPTH, filterFunc);

  // --- 路径 B：关键词精确检索 ---
  const terms = tokenizeQuery(query);
  const keywordResults = terms.length > 0
    ? vectorStore.keywordSearch(terms, SEARCH_DEPTH, filterFunc)
    : [];

  // --- RRF 融合 ---
  const rrfMap = new Map();

  vectorResults.forEach((item, rank) => {
    rrfMap.set(item.id, {
      id: item.id,
      text: item.text,
      metadata: item.metadata,
      vectorScore: item.score,
      rrfScore: 1.0 / (RRF_K + rank + 1)
    });
  });

  keywordResults.forEach((item, rank) => {
    if (rrfMap.has(item.id)) {
      rrfMap.get(item.id).rrfScore += 1.0 / (RRF_K + rank + 1);
    } else {
      rrfMap.set(item.id, {
        id: item.id,
        text: item.text,
        metadata: item.metadata,
        vectorScore: null,
        rrfScore: 1.0 / (RRF_K + rank + 1)
      });
    }
  });

  // 按 RRF 综合得分降序排列
  let fused = Array.from(rrfMap.values());
  fused.sort((a, b) => b.rrfScore - a.rrfScore);

  // 阈值过滤：有向量分数的必须达标，纯关键词命中的保留（它们弥补了向量检索的盲区）
  if (threshold > 0) {
    fused = fused.filter(item =>
      item.vectorScore === null || item.vectorScore >= threshold
    );
  }

  const finalResults = fused.slice(0, topK);

  console.log(`[混合检索] 向量候选 ${vectorResults.length} + 关键词候选 ${keywordResults.length} → 融合 ${fused.length} → 返回 ${finalResults.length} (阈值=${threshold})`);

  return finalResults;
}

/**
 * 估算文本 Token
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length * 1.3);
}

/**
 * 估算对话历史 Token 总量
 */
function estimateHistoryTokens(messages) {
  return messages.reduce((acc, msg) => acc + estimateTokens(msg.content), 0);
}

/**
 * 智能历史消息压缩 (Day 30.5 移植)
 */
async function compressHistoryIfNeed(messages, signal) {
  const HISTORY_TOKEN_BUDGET = 300000;
  const KEEP_RECENT_MESSAGES = 200; // 最近的200条消息不压缩

  const totalTokens = estimateHistoryTokens(messages);
  if (totalTokens <= HISTORY_TOKEN_BUDGET || messages.length <= KEEP_RECENT_MESSAGES) {
    return messages;
  }

  const splitIndex = messages.length - KEEP_RECENT_MESSAGES;
  const oldMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  // 拼接历史为一段大文本以供 AI 做摘要
  let oldText = "";
  for (const msg of oldMessages) {
    const roleName = msg.role === 'user' ? '用户' : 'AI';
    oldText += `${roleName}: ${msg.content}\n\n`;
  }

  console.log(`[上下文压缩] 对话历史 Token (${totalTokens}) 溢出预算，正在压缩旧消息...`);
  try {
    const { client, provider } = getDeepseekClient();
    const response = await client.chat.completions.create({
      model: provider.model || 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `你是一个对话摘要助手。请将以下对话历史压缩为一段简洁的摘要。
要求：
1. 保留用户问过的所有问题和 AI 回答的关键要点
2. 保留具体的术语、数字、名称等细节
3. 控制在 300 字以内
4. 用中文输出
5. 不要添加任何解释，直接输出摘要内容`
        },
        {
          role: 'user',
          content: `请压缩以下对话历史：\n\n${oldText}`
        }
      ]
    }, { signal });

    const summary = response.choices[0].message.content;
    const summaryMessage = {
      role: 'assistant',
      content: `【对话摘要】以下是之前对话的概要：\n${summary}`
    };

    console.log(`[上下文压缩] 压缩完成，从 ${oldMessages.length} 条缩减为 1 条摘要消息`);
    return [summaryMessage, ...recentMessages];
  } catch (e) {
    console.error("[上下文压缩] 摘要生成出错，保留原历史:", e);
    return messages;
  }
}

/**
 * 调用 AI 生成文档摘要
 */
async function generateSummary(content) {
  if (!content || content.trim().length < 50) {
    return "内容过短，无需摘要";
  }

  const truncatedContent = content.length > 8000
    ? content.substring(0, 8000) + "\n...（内容已截断）"
    : content;

  const { client, provider } = getDeepseekClient();
  const response = await client.chat.completions.create({
    model: provider.model || 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content: `你是一位专业的文档摘要助手。请遵循以下规则：
1. 用 2~4 句话概括文档的核心内容
2. 回答控制在 200 字以内
3. 语言简洁，突出关键信息（主题、核心观点、用途）
4. 不要复述原文，用自己的话总结`
      },
      {
        role: 'user',
        content: `请为以下文档生成摘要：\n\n${truncatedContent}`
      }
    ]
  });

  return response.choices[0].message.content;
}

/**
 * 后台异步进行文档摘要及向量切片 (对应 Java 中的 @Async)
 */
const indexJobs = new Map();

function indexDocumentAsync(documentId) {
  cancelIndexing(documentId);
  const controller = new AbortController();
  const promise = doIndexDocument(documentId, controller.signal)
    .catch(err => {
      if (err.name !== 'AbortError') {
        console.error(`[后台索引进程] 严重错误 | 文档 ID: ${documentId} |`, err);
      }
    })
    .finally(() => {
      if (indexJobs.get(Number(documentId))?.controller === controller) {
        indexJobs.delete(Number(documentId));
      }
    });
  indexJobs.set(Number(documentId), { controller, promise });
  return promise;
}

function cancelIndexing(documentId) {
  const job = indexJobs.get(Number(documentId));
  if (job) {
    job.controller.abort();
    indexJobs.delete(Number(documentId));
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('索引任务已中止');
    error.name = 'AbortError';
    throw error;
  }
}

async function doIndexDocument(documentId, signal = null) {
  console.log(`[后台索引进程] 开始处理文档 ID: ${documentId}`);
  const doc = await db.getDocumentById(documentId);
  if (!doc) {
    console.warn(`[后台索引进程] 文档 ID ${documentId} 不存在，终止`);
    return;
  }
  const contentHash = crypto.createHash('sha256').update(doc.content || '').digest('hex');
  await db.updateDocumentIndexStatus(documentId, 'indexing', { contentHash });

  // 1. 生成摘要
  if (!doc.summary || doc.summary === "摘要生成中...") {
    try {
      throwIfAborted(signal);
      const summary = await generateSummary(doc.content);
      throwIfAborted(signal);
      await db.updateDocumentSummary(documentId, summary);
      console.log(`[后台索引进程] 文档 ${documentId} 摘要更新完毕`);
    } catch (e) {
      console.error(`[后台索引进程] 文档 ${documentId} 摘要生成失败:`, e.message);
      await db.updateDocumentSummary(documentId, "摘要生成失败，请点击重新生成");
    }
  }

  // 2. 切片分块与向量计算
  if (!doc.content || doc.content.trim().length === 0) {
    await vectorStore.replaceDocumentChunks(documentId, []);
    await db.updateDocumentChunkCount(documentId, 0);
    await db.updateDocumentIndexStatus(documentId, 'ready', {
      indexedAt: new Date().toISOString(),
      contentHash
    });
    console.log(`[后台索引进程] 文档内容为空，无需向量切片`);
    return;
  }

  try {
    throwIfAborted(signal);
    const chunks = splitTextIntoChunks(doc.content, 512, 50);
    console.log(`[后台索引进程] 文档 ${documentId} 切片完成，共计 ${chunks.length} 块`);

    if (chunks.length > 0) {
      const embeddings = await getEmbeddings(chunks);
      throwIfAborted(signal);
      const latest = await db.getDocumentById(documentId);
      if (!latest) {
        throwIfAborted({ aborted: true });
      }
      const latestHash = crypto.createHash('sha256').update(latest.content || '').digest('hex');
      if (latestHash !== contentHash) {
        await db.markDocumentIndexStale(documentId);
        return;
      }
      const embeddingModel = configService.requireProvider('zhipu').model || 'embedding-3';
      let searchOffset = 0;
      const enrichedChunks = chunks.map((chunkText, i) => ({
        id: `doc:${documentId}:${contentHash.slice(0, 12)}:${i}`,
        text: chunkText,
        metadata: (() => {
          let charStart = doc.content.indexOf(chunkText, Math.max(0, searchOffset - 1000));
          if (charStart < 0) charStart = doc.content.indexOf(chunkText);
          if (charStart < 0) charStart = 0;
          const charEnd = charStart + chunkText.length;
          searchOffset = charEnd;
          return {
            schemaVersion: 2,
            documentId: Number(documentId),
            documentTitle: doc.title,
            chunkIndex: i,
            charStart,
            charEnd,
            contentHash,
            embeddingModel
          };
        })(),
        embedding: embeddings[i]
      }));

      await vectorStore.replaceDocumentChunks(documentId, enrichedChunks);
      await db.updateDocumentChunkCount(documentId, enrichedChunks.length);
      await db.updateDocumentIndexStatus(documentId, 'ready', {
        indexedAt: new Date().toISOString(),
        contentHash
      });
      console.log(`[后台索引进程] 文档 ${documentId} 向量化切片持久化成功`);
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    console.error(`[后台索引进程] 文档 ${documentId} 向量化失败:`, e);
    const existing = await db.getDocumentById(documentId);
    if (existing) {
      await db.updateDocumentIndexStatus(documentId, 'failed', {
        error: e.message,
        contentHash
      });
    }
  }
}

async function reindexNotebook(notebookId) {
  const documents = await db.getDocumentsByNotebook(Number(notebookId));
  for (const document of documents) {
    indexDocumentAsync(document.id);
  }
  return documents.length;
}

/**
 * 重新生成已有文档摘要 (同步方法)
 */
async function generateDocumentSummarySync(documentId) {
  const doc = await db.getDocumentById(documentId);
  if (!doc) throw new Error("文档不存在");
  const summary = await generateSummary(doc.content);
  return await db.updateDocumentSummary(documentId, summary);
}

const activeAskControllers = new Map();
let askClientProvider = getDeepseekClient;
function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * 中断当前的 AI 问答请求
 */
function abortActiveAsk(requestId = null) {
  if (requestId && activeAskControllers.has(requestId)) {
    activeAskControllers.get(requestId).abort();
    activeAskControllers.delete(requestId);
  } else if (!requestId) {
    for (const controller of activeAskControllers.values()) controller.abort();
    activeAskControllers.clear();
  }
}

/**
 * 响应流式问答核心逻辑 (IPC 桥接实现)
 */
async function handleAskStream(event, payload) {
  const { id, type, question, useDocContext, requestId = crypto.randomUUID() } = payload;
  const webContents = event.sender;
  const sessionId = type === 'doc' ? `doc:${id}` : `notebook:${id}`;
  const controller = new AbortController();
  activeAskControllers.set(requestId, controller);
  const startedAt = Date.now();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 180000);
  const send = (channel, data = {}) => {
    if (!webContents.isDestroyed()) {
      webContents.send(channel, { requestId, ...data });
    }
  };

  try {
    // 1. 获取并过滤多轮对话上下文历史
    const rawHistory = await db.getChatHistory(sessionId);
    let historyMessages = rawHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // 智能压缩
    historyMessages = await abortable(compressHistoryIfNeed(historyMessages, controller.signal), controller.signal);
    controller.signal.throwIfAborted();

    // 2. 意图自适应与 Agentic RAG 工具配置
    const allSources = [];
    const retrievalDiagnostics = { rounds: [], warnings: [], compressionMs: Date.now() - startedAt };
    let searches = 0;
    let evidenceTokens = 0;
    const encoding = getEncoding('cl100k_base');

    const tools = [
      {
        type: 'function',
        function: {
          name: 'search_knowledge_base',
          description: '在知识库中进行混合语义与关键词检索，获取文档事实切块。凡涉及文档事实、技术概念、具体方案或对比分析时必须调用。',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '提炼出的精准搜索词（支持中英文关键词或术语短语）'
              }
            },
            required: ['query']
          }
        }
      }
    ];

    // 3. 构建分层提示词
    let systemPrompt = "";
    if (!useDocContext) {
      systemPrompt = `你是一位通用知识问答助手。请遵循以下规则：
1. 基于你的知识库回答用户问题
2. 回答要简洁，控制在 300 字以内
3. 如果不确定，如实说明`;
    } else if (type === 'doc') {
      systemPrompt = `你是一位智能文档问答助手，当前正在协助用户阅读单篇文档。你拥有调用 search_knowledge_base 工具检索文档切块的能力。
请严格遵循以下规则：
1. 【意图自适应】：
   - 若用户是在打招呼、日常闲聊、或针对对话历史进行总结/追问/回忆（如"我刚才问了什么"、"总结你上一轮的回答"、"用更通俗的方式再说一遍"），请直接结合上下文历史自然作答，【严禁】调用检索工具。
   - 凡是涉及文档中的客观事实、技术方案、具体概念、细节知识时，你【必须】调用 search_knowledge_base 工具检索切块后再作答。
2. 【客观严谨与溯源】：
   - 引用检索结果中的事实时，必须在对应句子末尾标注来源编号 [N]（如 [1]、[2]）；
   - 若检索工具返回无相关内容且上下文无法推导，请明确回答"根据文档内容，无法找到相关答案"；
   - 严禁编造未在文档中出现的事实。
3. 【清晰简洁】：回答控制在 400 字以内，不要自行编造参考来源列表，界面会根据 [N] 渲染。`;
    } else {
      systemPrompt = `你是一位智能笔记本问答助手，当前正在协助用户研读整个笔记本下的多篇文档。你拥有调用 search_knowledge_base 工具混合检索文档库的能力。
请严格遵循以下规则：
1. 【意图自适应】：
   - 若用户是在打招呼、日常闲聊、或针对对话历史进行总结/追问/回忆（如"我刚才问了什么"、"总结你上一轮的回答"、"用更通俗的方式再说一遍"），请直接结合上下文历史自然作答，【严禁】调用检索工具。
   - 凡是涉及笔记本内文档的客观事实、技术方案、具体概念、细节知识或多文档对比时，你【必须】调用 search_knowledge_base 工具检索证据后再作答。
2. 【多步检索与综合对比】：
   - 若用户的问题较为复杂（例如涉及跨篇对比、多概念综合），你可以自主提炼不同的检索词发起多步检索，搜集齐各方面证据后再做综合回答。
3. 【客观严谨与溯源】：
   - 引用检索结果中的事实时，必须在对应句子末尾标注来源编号 [N]（如 [1]、[2]）；
   - 若多轮检索后仍无相关内容且上下文无法推导，请明确回答"根据文档内容，无法找到相关答案"；
   - 严禁编造未在检索结果中出现的事实。
4. 【清晰简洁】：回答控制在 400 字以内，不要自行编造参考来源列表，界面会根据 [N] 渲染。`;
    }

    const requestMessages = [
      { role: 'system', content: systemPrompt + (useDocContext ? ANSWER_GROUNDING_POLICY : '') },
      ...historyMessages,
      { role: 'user', content: question }
    ];

    // 4. 调用大模型并开启 Agentic RAG 流式工具循环 (传入 abort 信号)
    const { client, provider } = askClientProvider();

    let fullAnswer = "";
    let estimatedPromptTokens = 0;
    const MAX_TURNS = 3;

    for (let turn = 0; turn <= MAX_TURNS; turn++) {
      controller.signal.throwIfAborted();
      estimatedPromptTokens += encoding.encode(JSON.stringify(requestMessages) + (useDocContext && turn < MAX_TURNS ? JSON.stringify(tools) : '')).length;
      const stream = await abortable(client.chat.completions.create({
        model: provider.model || 'deepseek-chat',
        messages: requestMessages,
        tools: useDocContext && turn < MAX_TURNS ? tools : undefined,
        tool_choice: useDocContext && turn < MAX_TURNS ? 'auto' : undefined,
        stream: true
      }, { signal: controller.signal }), controller.signal);

      let toolCalls = [];
      let isToolTurn = false;
      let bufferedText = '';

      const iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await abortable(iterator.next(), controller.signal);
        if (next.done) break;
        const chunk = next.value;
        controller.signal.throwIfAborted();
        const delta = chunk.choices[0]?.delta;
        if (delta?.tool_calls?.length) {
          isToolTurn = true;
          for (const tc of delta.tool_calls) {
            if (!toolCalls[tc.index]) {
              toolCalls[tc.index] = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
            }
            if (tc.id) toolCalls[tc.index].id = tc.id;
            if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
            if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
          }
        }
        if (delta?.content) {
          if (!isToolTurn) {
            if (useDocContext && turn < MAX_TURNS) {
              bufferedText += delta.content;
            } else {
              fullAnswer += delta.content;
              send('chat:chunk', { text: delta.content });
            }
          }
        }
      }

      if (!isToolTurn || toolCalls.length === 0) {
        if (bufferedText) {
          fullAnswer += bufferedText;
          send('chat:chunk', { text: bufferedText });
        }
        break;
      }

      // 记录助手产生的 tool_calls
      requestMessages.push({
        role: 'assistant',
        content: null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments }
        }))
      });

      // 依次执行工具调用
      for (const tc of toolCalls) {
        let args;
        try { args = JSON.parse(tc.arguments); } catch { args = null; }
        if (!useDocContext || tc.name !== 'search_knowledge_base' || typeof args?.query !== 'string' || !args.query.trim() || searches >= 6 || turn === MAX_TURNS) {
          requestMessages.push({ role: 'tool', tool_call_id: tc.id,
            content: '工具不可用：名称或参数无效，或已达检索预算。请依据已有证据完成回答，不能编造。' });
          continue;
        }
        if (tc.name === 'search_knowledge_base') {
          searches += 1;
          const searchQuery = args.query.trim();

          const retrieval = await abortable(retrievalService.retrieve({
            scopeType: type === 'doc' ? 'document' : 'notebook',
            scopeId: Number(id),
            query: searchQuery,
            history: historyMessages,
            tokenBudget: 8000 - evidenceTokens,
            signal: controller.signal
          }), controller.signal);
          retrievalDiagnostics.rounds.push(retrieval.diagnostics);
          retrievalDiagnostics.warnings = [...new Set([...retrievalDiagnostics.warnings, ...retrieval.diagnostics.warnings])];

          // 新文档尚未完成索引时，单文档问答安全兜底读取原文
          const chunksToUse = retrieval.chunks;

          const formattedChunks = [];
          for (const chunk of chunksToUse) {
            const chunkKey = chunk.id || chunk.chunkId;
            let existing = allSources.find(s => s.chunkId === chunkKey);
            let citationId;
            if (existing) {
              continue;
            } else {
              citationId = allSources.length + 1;
              const cost = encoding.encode(`[${citationId}] 来源：${chunk.metadata?.documentTitle || '未知文档'}\n${chunk.text}\n\n---\n\n`).length;
              if (evidenceTokens + cost > 8000) continue;
              evidenceTokens += cost;
              allSources.push({
                citationId,
                chunkId: chunkKey,
                documentId: Number(chunk.metadata?.documentId || chunk.documentId),
                documentTitle: chunk.metadata?.documentTitle || chunk.documentTitle || '未知文档',
                chunkIndex: chunk.metadata?.chunkIndex ?? chunk.chunkIndex ?? null,
                snippet: chunk.text || chunk.snippet,
                scores: chunk.scores || {
                  vector: chunk.vectorScore ?? null,
                  bm25: chunk.keywordScore ?? null,
                  rrf: chunk.rrfScore ?? null
                }
              });
            }
            formattedChunks.push(`[${citationId}] 来源：${chunk.metadata?.documentTitle || chunk.documentTitle || '未知文档'}\n${chunk.text || chunk.snippet}`);
          }

          send('chat:sources', { sources: allSources, diagnostics: retrievalDiagnostics });

          const toolContext = formattedChunks.length
            ? formattedChunks.join('\n\n---\n\n')
            : '知识库中未检索到与该查询相关的内容。';

          requestMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `${retrieval.diagnostics.warnings.length ? '检索状态（非文档证据）：' + retrieval.diagnostics.warnings.join('\n') + '\n' : ''}${toolContext}`
          });
        }
      }
    }

    if (!fullAnswer.trim()) throw new Error('模型未生成最终回答，请重试');
    const invalid = [...fullAnswer.matchAll(/[\[【](\d+)[\]】]/g)].map(match => Number(match[1]))
      .filter(number => !allSources.some(source => source.citationId === number));
    if (invalid.length) retrievalDiagnostics.warnings.push(`引用校验未通过：${[...new Set(invalid)].join(', ')}`);
    retrievalDiagnostics.evidenceTokens = evidenceTokens;
    retrievalDiagnostics.elapsedMs = Date.now() - startedAt;
    send('chat:sources', { sources: allSources, diagnostics: retrievalDiagnostics });

    activeAskControllers.delete(requestId);

    // 5. 对话历史双向保存并做轮数裁剪
    const docId = type === 'doc' ? Number(id) : null;
    const nbId = type === 'notebook' ? Number(id) : null;
    await db.saveChatMessage(sessionId, 'user', question, docId, nbId);
    // 6. 估算 Token 用量并保存结构化来源
    const enc = getEncoding('cl100k_base');
    const promptTokens = estimatedPromptTokens;
    const completionTokens = enc.encode(fullAnswer).length;
    const usage = {
      prompt: promptTokens,
      completion: completionTokens,
      total: promptTokens + completionTokens,
      estimated: true
    };
    await db.saveChatMessage(sessionId, 'assistant', fullAnswer, docId, nbId, {
      sources: allSources,
      usage,
      mode: useDocContext ? 'agentic_rag' : 'general',
      retrieval: retrievalDiagnostics
    });
    await db.truncateHistory(sessionId, 1000);
    
    send('chat:token-usage', { usage });
    send('chat:end');

  } catch (err) {
    activeAskControllers.delete(requestId);
    if (err.name === 'AbortError') {
      if (timedOut) { send('chat:error', { message: '问答超过 180 秒，已终止' }); return; }
      console.log("[RAG 问答流] 请求已由用户成功中断");
      send('chat:end', { aborted: true });
      return;
    }
    console.error("[RAG 问答流] 失败:", err);
    send('chat:error', { message: err.message || "大模型连接超时，请重试" });
  } finally {
    clearTimeout(timer);
    activeAskControllers.delete(requestId);
  }
}

retrievalService.configure({ getEmbedding, getEmbeddingModel: () => configService.getConfig().zhipu?.model || 'embedding-3' });

module.exports = {
  configureAskClient: provider => { askClientProvider = provider || getDeepseekClient; },
  splitTextIntoChunks,
  getEmbedding,
  getEmbeddings,
  tokenizeQuery,
  hybridSearch,
  generateSummary,
  indexDocumentAsync,
  cancelIndexing,
  reindexNotebook,
  generateDocumentSummarySync,
  handleAskStream,
  abortActiveAsk
};
