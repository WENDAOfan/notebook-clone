const test = require('node:test');
const assert = require('node:assert/strict');
const { Agent, Runner, RunContext } = require('@openai/agents');

const db = require('../database');
const agentService = require('../agent-service');

let notebook;
let source;
let indexedDocuments = [];

function createFakeApprovalRunner(callId) {
  let modelTurn = 0;
  const model = {
    async getResponse() {
      throw new Error('本测试只允许流式模型调用');
    },
    async *getStreamedResponse() {
      modelTurn += 1;
      const output = modelTurn === 1
        ? [{
            type: 'function_call',
            id: `item-${callId}`,
            callId,
            name: 'create_organization_draft',
            arguments: JSON.stringify({
              title: `伪模型整理稿-${callId}`,
              content: '# 整理稿\n\n来自伪模型工具循环。',
              sourceDocumentIds: [source.id]
            })
          }]
        : [{
            type: 'message',
            id: `message-${callId}`,
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: '审批流程已完成。' }]
          }];
      yield {
        type: 'response_done',
        response: {
          id: `response-${callId}-${modelTurn}`,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          output
        }
      };
    }
  };
  const runner = new Runner({
    modelProvider: { getModel: () => model }
  });
  const agent = new Agent({
    name: '伪模型整理 Agent',
    model: 'fake-model',
    instructions: '按测试要求调用工具。',
    tools: agentService.createTools()
  });
  return { runner, agent };
}

async function consume(stream) {
  for await (const _event of stream) {
    // 必须消费流，SDK 才会执行到暂停或结束状态。
  }
  await stream.completed;
}

function createAgentContext() {
  return {
    notebookId: notebook.id,
    createdDocumentIds: [],
    sources: new Map(),
    send: () => {}
  };
}

test.before(async () => {
  await db.init(':memory:');
  notebook = await db.createNotebook('Agent 测试笔记本', '');
  source = await db.createDocument(notebook.id, '原始资料', '只读原始内容');
  agentService.configure({
    indexDocumentAsync: documentId => indexedDocuments.push(documentId)
  });
});

test.after(async () => {
  await db.close();
});

test('创建整理稿工具始终需要审批', async () => {
  const createTool = agentService.createTools().find(tool => tool.name === 'create_organization_draft');
  assert.equal(await createTool.needsApproval(), true);
});

test('整理 Agent 不继承问答专用的付费重排调用', async t => {
  const retrieval = require('../retrieval-service');
  let received;
  t.mock.method(retrieval, 'retrieve', async options => {
    received = options;
    return { sources: [], diagnostics: {} };
  });
  const search = agentService.createTools().find(tool => tool.name === 'search_notebook');
  await search.invoke(new RunContext(createAgentContext()), JSON.stringify({ query: '测试资料' }));
  assert.equal(received.allowRerank, false);
  assert.equal(received.scopeId, notebook.id);
});

test('批准后的创建工具只新增 Agent 整理稿并保留来源', async () => {
  const createTool = agentService.createTools().find(tool => tool.name === 'create_organization_draft');
  const context = new RunContext({
    notebookId: notebook.id,
    createdDocumentIds: [],
    sources: new Map(),
    send: () => {}
  });
  const result = await createTool.invoke(context, JSON.stringify({
    title: '整理后的提纲',
    content: '# 提纲\n\n核心结论。',
    sourceDocumentIds: [source.id]
  }));
  const created = await db.getDocumentById(result.documentId);

  assert.equal(created.origin, 'agent');
  assert.deepEqual(created.metadata.sourceDocumentIds, [source.id]);
  assert.match(created.content, /来源文档/);
  assert.deepEqual(indexedDocuments, [created.id]);
  assert.equal((await db.getDocumentById(source.id)).content, '只读原始内容');
});

test('Agent 工具不能读取其他笔记本的文档', async () => {
  const otherNotebook = await db.createNotebook('其他笔记本', '');
  const otherDocument = await db.createDocument(otherNotebook.id, '私有资料', '不可访问');
  const readTool = agentService.createTools().find(tool => tool.name === 'read_document_excerpt');
  const context = new RunContext({
    notebookId: notebook.id,
    createdDocumentIds: [],
    sources: new Map(),
    send: () => {}
  });
  const output = await readTool.invoke(context, JSON.stringify({
    documentId: otherDocument.id,
    startChar: 0
  }));

  assert.match(String(output), /不属于当前笔记本/);
});

test('伪模型完整循环在批准前不写入，批准后只新增一份整理稿', async () => {
  const baseline = (await db.getDocumentsByNotebook(notebook.id)).length;
  const { runner, agent } = createFakeApprovalRunner('approve');
  const context = createAgentContext();
  const first = await runner.run(agent, '请保存整理稿', {
    stream: true,
    maxTurns: 12,
    context,
    toolExecution: { maxFunctionToolConcurrency: 1 }
  });
  await consume(first);

  assert.equal(first.interruptions.length, 1);
  assert.equal((await db.getDocumentsByNotebook(notebook.id)).length, baseline);

  first.state.approve(first.interruptions[0], { alwaysApprove: false });
  const resumed = await runner.run(agent, first.state, {
    stream: true,
    maxTurns: 12,
    context,
    toolExecution: { maxFunctionToolConcurrency: 1 }
  });
  await consume(resumed);

  const documents = await db.getDocumentsByNotebook(notebook.id);
  assert.equal(resumed.interruptions.length, 0);
  assert.equal(documents.length, baseline + 1);
  assert.equal(documents.filter(document => document.title === '伪模型整理稿-approve').length, 1);
});

test('伪模型写入被拒绝后不会新增文档', async () => {
  const baseline = (await db.getDocumentsByNotebook(notebook.id)).length;
  const { runner, agent } = createFakeApprovalRunner('reject');
  const context = createAgentContext();
  const first = await runner.run(agent, '请保存整理稿', {
    stream: true,
    maxTurns: 12,
    context
  });
  await consume(first);

  first.state.reject(first.interruptions[0], {
    alwaysReject: false,
    message: '测试拒绝本次写入'
  });
  const resumed = await runner.run(agent, first.state, {
    stream: true,
    maxTurns: 12,
    context
  });
  await consume(resumed);

  assert.equal(resumed.interruptions.length, 0);
  assert.equal((await db.getDocumentsByNotebook(notebook.id)).length, baseline);
});

test('伪模型持续调用工具时会被最大轮次安全终止', async () => {
  let turn = 0;
  const model = {
    async getResponse() {
      throw new Error('本测试只允许流式模型调用');
    },
    async *getStreamedResponse() {
      turn += 1;
      yield {
        type: 'response_done',
        response: {
          id: `loop-response-${turn}`,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          output: [{
            type: 'function_call',
            id: `loop-item-${turn}`,
            callId: `loop-call-${turn}`,
            name: 'list_notebook_documents',
            arguments: '{}'
          }]
        }
      };
    }
  };
  const runner = new Runner({ modelProvider: { getModel: () => model } });
  const agent = new Agent({
    name: '最大轮次测试 Agent',
    model: 'fake-model',
    instructions: '持续调用工具。',
    tools: agentService.createTools()
  });
  const stream = await runner.run(agent, '循环测试', {
    stream: true,
    maxTurns: 2,
    context: createAgentContext()
  });

  await assert.rejects(
    () => consume(stream),
    error => error?.name === 'MaxTurnsExceededError' || /max turns/i.test(error?.message || '')
  );
});

test('中止 Agent 会取消控制器、发送结束事件并清理运行状态', async () => {
  const requestId = 'abort-test';
  const events = [];
  const controller = new AbortController();
  agentService.pendingRuns.set(requestId, {
    requestId,
    controller,
    timer: setTimeout(() => {}, 60_000),
    createdDocumentIds: [],
    provider: { close: () => Promise.resolve() },
    webContents: {
      isDestroyed: () => false,
      send: (_channel, event) => events.push(event)
    }
  });

  assert.equal(agentService.abort(requestId), true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(agentService.pendingRuns.has(requestId), false);
  assert.equal(events[0].type, 'end');
  assert.equal(events[0].data.aborted, true);
});

test('Agent 在等待审批时超时也会主动报错并清理运行状态', async () => {
  const requestId = 'timeout-test';
  const events = [];
  const controller = new AbortController();
  agentService.pendingRuns.set(requestId, {
    requestId,
    controller,
    timer: setTimeout(() => {}, 60_000),
    createdDocumentIds: [],
    provider: { close: () => Promise.resolve() },
    webContents: {
      isDestroyed: () => false,
      send: (_channel, event) => events.push(event)
    }
  });

  assert.equal(agentService.expire(requestId), true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(agentService.pendingRuns.has(requestId), false);
  assert.equal(events[0].type, 'error');
  assert.match(events[0].data.message, /180 秒/);
});
