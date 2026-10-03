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
test('时间状态规则区分预告与已发生，同时允许已发生的证据', () => {
  assert.match(ANSWER_GROUNDING_POLICY, /计划.*预计.*将于/);
  assert.match(ANSWER_GROUNDING_POLICY, /不能仅凭当前日期推断实际发生/);
  assert.match(ANSWER_GROUNDING_POLICY, /原文明确记载已发生时则正常回答/);
  assert.match(ANSWER_GROUNDING_POLICY, /没有后续记录.*不等于事件确定未发生/);
  assert.match(ANSWER_GROUNDING_POLICY, /只有明确写出.*才能断言未举办/);
  assert.match(ANSWER_GROUNDING_POLICY, /附属安排同样只是计划/);
  assert.match(ANSWER_GROUNDING_POLICY, /若只问日期.*不主动添加无关的附属安排/);
  assert.match(ANSWER_GROUNDING_POLICY, /区分“记录状态”与“实际状态”/);
  assert.match(ANSWER_GROUNDING_POLICY, /没有完成交接记录.*不能断言现场实际/);
  assert.match(ANSWER_GROUNDING_POLICY, /现场核查明确写“未实施”.*才可说截至该日未完成/);
  assert.match(ANSWER_GROUNDING_POLICY, /完成交接单.*正常说已完成/);
});
