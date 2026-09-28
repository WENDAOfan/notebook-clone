const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const rag = require('../rag-service');
const { ANSWER_GROUNDING_POLICY } = require('../answer-policy');
test('事实规则进入文档/笔记本及最终回答，但不影响普通聊天', async () => {
  await db.init(':memory:');
  try {
    const notebook = await db.createNotebook('规则测试', '');
    const doc = await db.createDocument(notebook.id, '资料', '资料');
    for (const [type, enabled] of [['doc', true], ['notebook', true], ['doc', false]]) {
      const prompts = [];
      rag.configureAskClient(() => ({ provider: {}, client: { chat: { completions: { create: async request => {
        prompts.push(request.messages[0].content);
        const delta = enabled && prompts.length < 4
          ? { tool_calls: [{ index: 0, id: 'bad', function: { name: 'unknown', arguments: '{}' } }] }
          : { content: '回答' };
        return (async function* () { yield { choices: [{ delta }] }; })();
      } } } } }));
      const events = [];
      await rag.handleAskStream({ sender: { isDestroyed: () => false, send(channel) { events.push(channel); } } }, { id: type === 'doc' ? doc.id : notebook.id, type, question: '问题', useDocContext: enabled });
      assert.ok(!events.includes('chat:error'));
      assert.ok(events.includes('chat:end'));
      assert.equal(prompts.length, enabled ? 4 : 1);
      assert.ok(prompts.every(prompt => prompt.includes(ANSWER_GROUNDING_POLICY) === enabled));
    }
  } finally { rag.configureAskClient(null); await db.close(); }
});
test('新事实边界集正反例成对，不修改前轮验收题', () => {
  const cases = require('../eval/grounding-cases.json');
  assert.equal(cases.length, 12);
  assert.equal(cases.filter(c => c.id.endsWith('positive')).length, 6);
  assert.equal(cases.filter(c => c.id.endsWith('negative')).length, 6);
});
