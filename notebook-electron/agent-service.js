const crypto = require('crypto');
const {
  Agent,
  Runner,
  OpenAIProvider,
  tool,
  setTracingDisabled
} = require('@openai/agents');
const { z } = require('zod');
const configService = require('./config-service');
const db = require('./database');
const retrievalService = require('./retrieval-service');

setTracingDisabled(true);

const pendingRuns = new Map();
const MAX_TURNS = 12;
const RUN_TIMEOUT_MS = 180_000;
let indexDocument = documentId => require('./rag-service').indexDocumentAsync(documentId);

function configure({ indexDocumentAsync } = {}) {
  if (indexDocumentAsync) indexDocument = indexDocumentAsync;
}

function createTools() {
  return [
    tool({
      name: 'list_notebook_documents',
      description: '列出当前笔记本中的文档标题、摘要、来源类型和索引状态。',
      parameters: z.object({}),
      timeoutMs: 10_000,
      execute: async (_args, runContext) => {
        const { notebookId } = runContext.context;
        const documents = await db.getDocumentsByNotebook(notebookId);
        return documents.map(document => ({
          id: document.id,
          title: document.title,
          summary: document.summary,
          origin: document.origin,
          indexStatus: document.index_status,
          chunkCount: document.chunk_count
        }));
      }
    }),
    tool({
      name: 'search_notebook',
      description: '在当前笔记本内检索与问题最相关的文档片段，返回带编号的可引用来源。',
      parameters: z.object({
        query: z.string().min(1).max(1000)
      }),
      timeoutMs: 30_000,
      execute: async ({ query }, runContext) => {
        const context = runContext.context;
        const result = await retrievalService.retrieve({
          scopeType: 'notebook',
          scopeId: context.notebookId,
          query,
          // Semantic reranking is budgeted by the Q&A loop only. The organizer
          // retains local retrieval; enabling the desktop policy must not add
          // unaccounted model calls to its separate tool/approval lifecycle.
          allowRerank: false,
          tokenBudget: 8000
        });
        for (const source of result.sources) {
          context.sources.set(source.chunkId, source);
        }
        context.send('sources', { sources: [...context.sources.values()] });
        return {
          sources: result.sources.map(source => ({
            citationId: source.citationId,
            documentId: source.documentId,
            documentTitle: source.documentTitle,
            snippet: source.snippet
          })),
          diagnostics: result.diagnostics
        };
      }
    }),
    tool({
      name: 'read_document_excerpt',
      description: '从当前笔记本的一篇文档中读取最多 12000 个字符。长文可用不同 startChar 分段读取。',
      parameters: z.object({
        documentId: z.number().int().positive(),
        startChar: z.number().int().min(0)
      }),
      timeoutMs: 10_000,
      execute: async ({ documentId, startChar }, runContext) => {
        const document = await requireScopedDocument(runContext.context.notebookId, documentId);
        const content = document.content || '';
        const excerpt = content.slice(startChar, startChar + 12_000);
        return {
          documentId: document.id,
          title: document.title,
          startChar,
          endChar: startChar + excerpt.length,
          totalChars: content.length,
          truncated: startChar + excerpt.length < content.length,
          excerpt
        };
      }
    }),
    tool({
      name: 'create_organization_draft',
      description: '在当前笔记本中新建一篇整理稿。此工具只新增文档，绝不修改或删除原文。',
      parameters: z.object({
        title: z.string().min(1).max(100),
        content: z.string().min(1).max(50_000),
        sourceDocumentIds: z.array(z.number().int().positive()).max(100)
      }),
      needsApproval: true,
      timeoutMs: 15_000,
      execute: async ({ title, content, sourceDocumentIds }, runContext) => {
        const { notebookId } = runContext.context;
        const uniqueIds = [...new Set(sourceDocumentIds.map(Number))];
        const sourceDocuments = [];
        for (const documentId of uniqueIds) {
          sourceDocuments.push(await requireScopedDocument(notebookId, documentId));
        }
        const sourceFooter = sourceDocuments.length
          ? `\n\n---\n\n来源文档：\n${sourceDocuments.map(doc => `- ${doc.title}（ID: ${doc.id}）`).join('\n')}`
          : '';
        const document = await db.createDocument(
          notebookId,
          title.trim(),
          `${content.trim()}${sourceFooter}`,
          '摘要生成中...',
          0,
          {
            origin: 'agent',
            metadata: {
              agent: 'notebook-organizer',
              sourceDocumentIds: uniqueIds,
              createdAt: new Date().toISOString()
            }
          }
        );
        indexDocument(document.id);
        runContext.context.createdDocumentIds.push(document.id);
        return {
          created: true,
          documentId: document.id,
          title: document.title,
          sourceDocumentIds: uniqueIds
        };
      }
    })
  ];
}

async function requireScopedDocument(notebookId, documentId) {
  const document = await db.getDocumentById(Number(documentId));
  if (!document || Number(document.notebook_id) !== Number(notebookId)) {
    throw new Error('文档不存在或不属于当前笔记本');
  }
  return document;
}

function start(webContents, payload) {
  const requestId = payload.requestId || crypto.randomUUID();
  if (pendingRuns.has(requestId)) {
    throw new Error('相同 requestId 的 Agent 任务已经存在');
  }
  const question = String(payload.prompt || '').trim();
  if (!question) throw new Error('Agent 任务不能为空');

  const providerConfig = configService.requireProvider('deepseek');
  const provider = new OpenAIProvider({
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseURL,
    useResponses: false,
    strictFeatureValidation: false
  });
  const runner = new Runner({ modelProvider: provider });
  const agent = new Agent({
    name: '笔记本整理 Agent',
    model: providerConfig.model || 'deepseek-chat',
    instructions: `你是一个谨慎的笔记本整理助手，只能处理当前笔记本。
先使用工具了解文档，再进行总结、对比、目录或学习提纲整理。
所有事实都必须来自工具返回的文档，引用时使用 [N]。
禁止要求访问其他笔记本、文件系统或互联网。
禁止修改或删除原文。
只有当用户明确要求保存整理结果时，才调用 create_organization_draft。
调用创建工具时提供完整可直接保存的 Markdown，并准确列出来源文档 ID。`,
    tools: createTools(),
    modelSettings: {
      toolChoice: 'auto',
      parallelToolCalls: false
    }
  });

  const entry = {
    requestId,
    notebookId: Number(payload.notebookId),
    question,
    webContents,
    provider,
    runner,
    agent,
    controller: new AbortController(),
    timer: null,
    fullText: '',
    sources: new Map(),
    createdDocumentIds: [],
    approvals: new Map()
  };
  entry.send = (type, data = {}) => send(entry, type, data);
  entry.timer = setTimeout(() => expire(requestId), RUN_TIMEOUT_MS);
  pendingRuns.set(requestId, entry);
  send(entry, 'status', { message: '整理 Agent 已启动' });

  buildAgentInput(entry).then(input => processRun(entry, input)).catch(error => finishWithError(entry, error));
  return { requestId };
}

async function buildAgentInput(entry) {
  const notebook = await db.getNotebookById(entry.notebookId);
  if (!notebook) {
    throw new Error('当前笔记本不存在');
  }
  const history = await db.getChatHistory(`agent:notebook:${entry.notebookId}`);
  const recent = history.slice(-10).map(message =>
    `${message.role === 'user' ? '用户' : 'Agent'}：${message.content}`
  ).join('\n\n');
  return recent
    ? `以下是最近对话，仅用于理解上下文：\n${recent}\n\n当前任务：${entry.question}`
    : entry.question;
}

async function processRun(entry, inputOrState) {
  try {
    const stream = await entry.runner.run(entry.agent, inputOrState, {
      stream: true,
      maxTurns: MAX_TURNS,
      signal: entry.controller.signal,
      context: {
        notebookId: entry.notebookId,
        requestId: entry.requestId,
        sources: entry.sources,
        createdDocumentIds: entry.createdDocumentIds,
        send: entry.send
      },
      toolExecution: {
        preApprovalInputGuardrails: true,
        maxFunctionToolConcurrency: 1
      }
    });

    for await (const event of stream) {
      if (event.type === 'raw_model_stream_event' && event.data?.type === 'output_text_delta') {
        entry.fullText += event.data.delta;
        send(entry, 'text-delta', { text: event.data.delta });
      } else if (event.type === 'run_item_stream_event' && event.name === 'tool_called') {
        send(entry, 'tool-start', describeRunItem(event.item));
      } else if (event.type === 'run_item_stream_event' && event.name === 'tool_output') {
        send(entry, 'tool-end', describeRunItem(event.item));
      }
    }
    await stream.completed;

    if (stream.interruptions.length) {
      entry.approvals.clear();
      stream.interruptions.forEach((interruption, index) => {
        const approvalId = interruption.rawItem?.callId
          || interruption.rawItem?.id
          || `${entry.requestId}:${index}`;
        entry.approvals.set(approvalId, interruption);
        send(entry, 'approval-required', {
          approvalId,
          toolName: interruption.name,
          arguments: safeParseJson(interruption.arguments)
        });
      });
      entry.state = stream.state;
      return;
    }

    const finalText = String(stream.finalOutput || entry.fullText || '任务已完成');
    const usage = stream.runContext.usage;
    await db.saveChatMessage(
      `agent:notebook:${entry.notebookId}`,
      'user',
      entry.question,
      null,
      entry.notebookId
    );
    await db.saveChatMessage(
      `agent:notebook:${entry.notebookId}`,
      'assistant',
      finalText,
      null,
      entry.notebookId,
      {
        mode: 'agent',
        sources: [...entry.sources.values()],
        createdDocumentIds: entry.createdDocumentIds,
        usage: {
          prompt: usage.inputTokens,
          completion: usage.outputTokens,
          total: usage.totalTokens
        }
      }
    );
    send(entry, 'usage', {
      usage: {
        prompt: usage.inputTokens,
        completion: usage.outputTokens,
        total: usage.totalTokens
      }
    });
    send(entry, 'end', {
      createdDocumentIds: entry.createdDocumentIds,
      finalText
    });
    cleanup(entry);
  } catch (error) {
    finishWithError(entry, error);
  }
}

function resolveApproval({ requestId, approvalId, decision }) {
  const entry = pendingRuns.get(requestId);
  if (!entry || !entry.state) throw new Error('待审批的 Agent 任务不存在或已过期');
  const interruption = entry.approvals.get(approvalId);
  if (!interruption) throw new Error('审批项不存在或已经处理');

  if (decision === 'approve') {
    entry.state.approve(interruption, { alwaysApprove: false });
  } else if (decision === 'reject') {
    entry.state.reject(interruption, {
      alwaysReject: false,
      message: '用户拒绝了本次写入，请不要保存，并继续给出可选方案。'
    });
  } else {
    throw new Error('无效的审批决定');
  }
  entry.approvals.delete(approvalId);
  send(entry, 'status', { message: decision === 'approve' ? '已批准，继续执行' : '已拒绝，继续执行' });
  processRun(entry, entry.state);
  return { requestId, approvalId, decision };
}

function abort(requestId) {
  const entry = pendingRuns.get(requestId);
  if (!entry) return false;
  entry.controller.abort();
  send(entry, 'end', { aborted: true, createdDocumentIds: entry.createdDocumentIds });
  cleanup(entry);
  return true;
}

function expire(requestId) {
  const entry = pendingRuns.get(requestId);
  if (!entry) return false;
  entry.controller.abort();
  send(entry, 'error', { message: 'Agent 运行超过 180 秒，已安全终止' });
  cleanup(entry);
  return true;
}

function describeRunItem(item) {
  const json = typeof item.toJSON === 'function' ? item.toJSON() : item;
  const raw = json?.rawItem || {};
  return {
    toolName: raw.name || json?.toolName || item?.name || 'tool',
    arguments: safeParseJson(raw.arguments),
    output: summarizeOutput(json?.output ?? item?.output)
  };
}

function summarizeOutput(output) {
  if (output === undefined) return undefined;
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  return text.length > 1000 ? `${text.slice(0, 1000)}…` : text;
}

function safeParseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return { raw: String(value) };
  }
}

function send(entry, type, data = {}) {
  if (!entry.webContents.isDestroyed()) {
    entry.webContents.send('agent:event', {
      requestId: entry.requestId,
      type,
      data
    });
  }
}

function finishWithError(entry, error) {
  if (!pendingRuns.has(entry.requestId)) return;
  if (error.name === 'AbortError') {
    send(entry, 'end', { aborted: true, createdDocumentIds: entry.createdDocumentIds });
  } else {
    console.error('[整理 Agent] 运行失败:', error);
    send(entry, 'error', { message: error.message || 'Agent 运行失败' });
  }
  cleanup(entry);
}

function cleanup(entry) {
  clearTimeout(entry.timer);
  pendingRuns.delete(entry.requestId);
  entry.provider.close().catch(() => {});
}

module.exports = {
  configure,
  start,
  resolveApproval,
  abort,
  expire,
  createTools,
  requireScopedDocument,
  pendingRuns
};
