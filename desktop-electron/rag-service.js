const { OpenAI } = require('openai');
const { getEncoding } = require('js-tiktoken');
const config = require('./config.json');
const db = require('./database');
const vectorStore = require('./vector-store');

// 1. 初始化 DeepSeek 与 智谱 AI 客户端
const deepseekClient = new OpenAI({
  apiKey: config.deepseek.apiKey,
  baseURL: config.deepseek.baseURL
});

const zhipuClient = new OpenAI({
  apiKey: config.zhipu.apiKey,
  baseURL: config.zhipu.baseURL
});

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
  
  // 1. 先按照段落（双换行及以上）切分
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const para of paragraphs) {
    const paraTokens = enc.encode(para);
    
    // 如果单个段落本身就超过了限制，需要按句子细分
    if (paraTokens.length > chunkSize) {
      // 先把当前累积的 chunk 结算并存入
      if (currentChunk.length > 0) {
        chunks.push(enc.decode(currentChunk));
        currentChunk = [];
        currentLength = 0;
      }
      
      // 按常见句尾标点切分大段落（使用正向后瞻断言，保留分隔符）
      const sentences = para.split(/(?<=[。？！；\n])/);
      for (const sentence of sentences) {
        const sentenceTokens = enc.encode(sentence);
        if (currentLength + sentenceTokens.length > chunkSize) {
          if (currentChunk.length > 0) {
            chunks.push(enc.decode(currentChunk));
          }
          // 保留重叠部分作为新分块的开头
          const overlapCount = Math.min(chunkOverlap, currentChunk.length);
          currentChunk = currentChunk.slice(currentChunk.length - overlapCount).concat(sentenceTokens);
          currentLength = currentChunk.length;
        } else {
          currentChunk.push(...sentenceTokens);
          currentLength += sentenceTokens.length;
        }
      }
    } else {
      // 段落较小，尝试与之前的累积内容合并
      if (currentLength + paraTokens.length > chunkSize) {
        if (currentChunk.length > 0) {
          chunks.push(enc.decode(currentChunk));
        }
        const overlapCount = Math.min(chunkOverlap, currentChunk.length);
        currentChunk = currentChunk.slice(currentChunk.length - overlapCount).concat(paraTokens);
        currentLength = currentChunk.length;
      } else {
        currentChunk.push(...paraTokens);
        currentLength += paraTokens.length;
        // 保留段落换行语义
        currentChunk.push(...enc.encode("\n\n"));
        currentLength += 2;
      }
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(enc.decode(currentChunk));
  }

  return chunks.filter(c => c.trim().length > 0);
}

/**
 * 获取文本向量
 */
async function getEmbedding(text) {
  const response = await zhipuClient.embeddings.create({
    model: config.zhipu.model || 'embedding-3',
    input: text
  });
  return response.data[0].embedding;
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
    const response = await zhipuClient.embeddings.create({
      model: config.zhipu.model || 'embedding-3',
      input: batch
    });
    // 保证接口返回排序与输入一致
    const batchEmbeddings = response.data
      .sort((a, b) => a.index - b.index)
      .map(item => item.embedding);
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
async function compressHistoryIfNeed(messages) {
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
    const response = await deepseekClient.chat.completions.create({
      model: config.deepseek.model || 'deepseek-chat',
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
    });

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

  const response = await deepseekClient.chat.completions.create({
    model: config.deepseek.model || 'deepseek-chat',
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
function indexDocumentAsync(documentId) {
  doIndexDocument(documentId).catch(err => {
    console.error(`[后台索引进程] 严重错误 | 文档 ID: ${documentId} |`, err);
  });
}

async function doIndexDocument(documentId) {
  console.log(`[后台索引进程] 开始处理文档 ID: ${documentId}`);
  const doc = await db.getDocumentById(documentId);
  if (!doc) {
    console.warn(`[后台索引进程] 文档 ID ${documentId} 不存在，终止`);
    return;
  }

  // 1. 生成摘要
  if (!doc.summary || doc.summary === "摘要生成中...") {
    try {
      const summary = await generateSummary(doc.content);
      await db.updateDocumentSummary(documentId, summary);
      console.log(`[后台索引进程] 文档 ${documentId} 摘要更新完毕`);
    } catch (e) {
      console.error(`[后台索引进程] 文档 ${documentId} 摘要生成失败:`, e.message);
      await db.updateDocumentSummary(documentId, "摘要生成失败，请点击重新生成");
    }
  }

  // 2. 切片分块与向量计算
  if (!doc.content || doc.content.trim().length === 0) {
    console.log(`[后台索引进程] 文档内容为空，无需向量切片`);
    return;
  }

  try {
    const chunks = splitTextIntoChunks(doc.content, 512, 50);
    console.log(`[后台索引进程] 文档 ${documentId} 切片完成，共计 ${chunks.length} 块`);

    if (chunks.length > 0) {
      const embeddings = await getEmbeddings(chunks);
      const enrichedChunks = chunks.map((chunkText, i) => ({
        id: `doc:${documentId}:chunk:${i}`,
        text: chunkText,
        metadata: {
          documentId: documentId,
          documentTitle: doc.title
        },
        embedding: embeddings[i]
      }));

      // 存入向量存储
      await vectorStore.add(enrichedChunks);
      // 更新数据库切片数
      await db.updateDocumentChunkCount(documentId, enrichedChunks.length);
      console.log(`[后台索引进程] 文档 ${documentId} 向量化切片持久化成功`);
    }
  } catch (e) {
    console.error(`[后台索引进程] 文档 ${documentId} 向量化失败:`, e);
  }
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

let activeAbortController = null;

/**
 * 中断当前的 AI 问答请求
 */
function abortActiveAsk() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
    console.log("[RAG服务] 对话流请求已被用户强行中断");
  }
}

/**
 * 响应流式问答核心逻辑 (IPC 桥接实现)
 */
async function handleAskStream(event, payload) {
  const { id, type, question, useDocContext } = payload;
  const webContents = event.sender;
  const sessionId = type === 'doc' ? `doc:${id}` : `notebook:${id}`;

  try {
    // 1. 获取并过滤多轮对话上下文历史
    const rawHistory = await db.getChatHistory(sessionId);
    let historyMessages = rawHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // 智能压缩
    historyMessages = await compressHistoryIfNeed(historyMessages);

    // 2. 向量检索 (RAG)
    let context = "";
    if (useDocContext) {
      const queryEmbedding = await getEmbedding(question);

      let filterFunc;
      let topK;
      const SIMILARITY_THRESHOLD = 0.35; // 向量余弦相似度阈值

      if (type === 'doc') {
        filterFunc = (meta) => meta.documentId === Number(id);
        topK = 5;
      } else {
        // 笔记本级：查询笔记本内所有文档ID
        const docs = await db.getDocumentsByNotebook(Number(id));
        const docIds = docs.map(d => d.id);
        filterFunc = (meta) => docIds.includes(meta.documentId);
        topK = 8;
      }

      // 混合检索：向量语义 + 关键词精确 + RRF 融合 + 阈值过滤
      const relevantChunks = hybridSearch(queryEmbedding, question, topK, filterFunc, SIMILARITY_THRESHOLD);
      if (relevantChunks.length > 0) {
        context = relevantChunks.map((chunk, idx) => {
          const title = chunk.metadata.documentTitle || "未知文档";
          return `[${idx + 1}] 来源：${title}\n${chunk.text}`;
        }).join('\n\n---\n\n');
      } else {
        // 降级：未分块完成时，单文档直接拉取前 8000 字符
        if (type === 'doc') {
          const doc = await db.getDocumentById(Number(id));
          if (doc && doc.content) {
            context = doc.content.length > 8000 
              ? doc.content.substring(0, 8000) + "\n...（内容已截断）" 
              : doc.content;
          }
        }
      }
    }

    // 3. 构建 Prompt
    let systemPrompt = "";
    let userPrompt = "";

    if (type === 'doc') {
      systemPrompt = useDocContext
        ? `你是一位知识库问答助手。请严格遵循以下规则：
1. 只基于用户提供的【文档内容】回答问题
2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
3. 回答要简洁，控制在 300 字以内
4. 不要添加文档中没有的信息
5. 每段内容前面标注了 [N] 来源：文档标题，回答时如果引用了某段内容，必须在引用处添加标记 [N]
6. 回答末尾必须用 "---" 分隔，然后列出参考来源，每个引用独占一行，格式为：[N] 【文档：标题】原文片段`
        : `你是一位通用知识问答助手。请遵循以下规则：
1. 基于你的知识库回答用户问题
2. 回答要简洁，控制在 300 字以内
3. 如果不确定，如实说明`;

      userPrompt = useDocContext && context
        ? `【文档内容】\n${context}\n\n【用户问题】\n${question}`
        : question;
    } else {
      // 笔记本级别问答
      systemPrompt = `你是一位知识库问答助手。请严格遵循以下规则：
1. 只基于用户提供的【文档内容】回答问题
2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
3. 回答要简洁，控制在 300 字以内
4. 不要添加文档中没有的信息
5. 如果有多篇文档，综合各篇文档的信息进行回答
6. 每段内容前面标注了 [N] 来源：文档标题，回答时如果引用了某段内容，必须在引用处添加标记 [N]
7. 回答末尾必须用 "---" 分隔，然后列出所有参考来源，每个引用独占一行，格式为：[N] 【文档：标题】原文片段`;

      userPrompt = `【文档内容】\n${context || "（文档内容为空，无法提供背景上下文）"}\n\n【用户问题】\n${question}`;
    }

    const requestMessages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: userPrompt }
    ];

    // 4. 调用大模型并开启 Streaming 推送 (传入 abort 信号)
    activeAbortController = new AbortController();
    const stream = await deepseekClient.chat.completions.create({
      model: config.deepseek.model || 'deepseek-chat',
      messages: requestMessages,
      stream: true
    }, { signal: activeAbortController.signal });

    let fullAnswer = "";
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || "";
      if (text) {
        fullAnswer += text;
        webContents.send('chat:chunk', text);
      }
    }

    activeAbortController = null; // 请求完毕清空

    // 5. 对话历史双向保存并做轮数裁剪
    const docId = type === 'doc' ? Number(id) : null;
    const nbId = type === 'notebook' ? Number(id) : null;
    await db.saveChatMessage(sessionId, 'user', question, docId, nbId);
    await db.saveChatMessage(sessionId, 'assistant', fullAnswer, docId, nbId);
    await db.truncateHistory(sessionId, 1000); // 裁剪过长历史

    // 6. 精确估算 Token 用量，通过 IPC 推送前端展示
    const enc = getEncoding('cl100k_base');
    const promptTokens = enc.encode(systemPrompt + userPrompt).length +
                         historyMessages.reduce((sum, m) => sum + enc.encode(m.content).length, 0);
    const completionTokens = enc.encode(fullAnswer).length;
    
    webContents.send('chat:token-usage', {
      prompt: promptTokens,
      completion: completionTokens,
      total: promptTokens + completionTokens
    });
    
    // 发送流结束信号
    webContents.send('chat:end');

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log("[RAG 问答流] 请求已由用户成功中断");
      webContents.send('chat:end');
      return;
    }
    console.error("[RAG 问答流] 失败:", err);
    webContents.send('chat:error', err.message || "大模型连接超时，请重试");
  }
}

module.exports = {
  splitTextIntoChunks,
  getEmbedding,
  getEmbeddings,
  tokenizeQuery,
  hybridSearch,
  generateSummary,
  indexDocumentAsync,
  generateDocumentSummarySync,
  handleAskStream,
  abortActiveAsk
};
