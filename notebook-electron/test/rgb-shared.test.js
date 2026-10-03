const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../eval/rgb-shared');
const { ANSWERABLE_IDS, NO_ANSWER_IDS, buildSharedCorpus, rankOfDocument,
  summarizeRetrieval } = require('../eval/rgb-shared-lib');

function row(id, answer) {
  return { id, query: `测试问题 ${id} 的答案是什么？`, answer: [answer],
    positive: [`明确记载 ${id} 的答案是${answer}。`],
    negative: Array.from({ length: 5 }, (_, index) => `只讨论 ${id} 的背景资料 ${index}，没有结果。`) };
}

test('fixed shared suite has separate answerable and no-answer IDs', () => {
  assert.equal(ANSWERABLE_IDS.length, 20);
  assert.equal(NO_ANSWER_IDS.length, 10);
  assert.equal(new Set([...ANSWERABLE_IDS, ...NO_ANSWER_IDS]).size, 30);
  assert.ok(!ANSWERABLE_IDS.includes(58));
  assert.ok(!NO_ANSWER_IDS.includes(205));
});

test('shared adapter builds one corpus with neutral, unique documents and no exact answer leak', () => {
  const corpus = buildSharedCorpus([row(1, '甲答案'), row(2, '乙答案'), row(3, '丙答案')],
    { answerableIds: [1, 2], noAnswerIds: [3] });
  assert.equal(corpus.documents.length, 9);
  assert.equal(new Set(corpus.documents.map(doc => doc.textHash)).size, 9);
  assert.ok(corpus.documents.every(doc => /^资料\d+$/.test(doc.title)));
  assert.deepEqual(corpus.queries.map(item => item.type), ['answerable', 'answerable', 'no_answer']);
  assert.ok(corpus.documents.every(doc => !doc.text.includes('丙答案')));
});

test('shared adapter blocks no-answer labels leaked through other documents', () => {
  const first = row(1, '甲答案');
  const second = row(2, '乙答案');
  second.answer = ['甲答案'];
  second.positive = ['明确记载 2 的答案是甲答案。'];
  assert.throws(() => buildSharedCorpus([first, second], { answerableIds: [1], noAnswerIds: [2] }),
    /答案或别称出现在共享资料/);
  second.answer = ['乙答案'];
  second.positive = ['明确记载 2 的答案是乙答案。'];
  first.positive = ['明确记载 1 的答案是甲答案，另有别称线索。'];
  assert.throws(() => buildSharedCorpus([first, second], {
    answerableIds: [1], noAnswerIds: [2], answerAliases: { 2: ['别称线索'] }
  }), /答案或别称出现在共享资料/);
});

test('retrieval scores absent positive documents as misses', () => {
  assert.equal(rankOfDocument([{ documentId: 8 }, { documentId: 9 }], 9), 2);
  assert.equal(rankOfDocument([{ documentId: 8 }], 9), null);
  assert.deepEqual(summarizeRetrieval([
    { type: 'answerable', direct: { positiveRank: 1 } },
    { type: 'answerable', direct: { positiveRank: null } },
    { type: 'no_answer', direct: { positiveRank: null } }
  ]), { answerable: 2, recallAt1: 0.5, recallAt5: 0.5, mrr: 0.5 });
});

test('在线复测使用独立标签，不覆盖首次共享资料报告', () => {
  const options = parseArgs(['--online', '--rgb-root', '.', '--label', 'policy-v2']);
  assert.equal(options.online, true);
  assert.equal(options.label, 'policy-v2');
  assert.equal(parseArgs(['--online', '--rgb-root', '.', '--case-id', '86']).caseId, 86);
  assert.throws(() => parseArgs(['--rgb-root', '.', '--label', 'policy-v2']), /--label/);
  assert.throws(() => parseArgs(['--online', '--rgb-root', '.', '--label', '../escape']), /--label/);
  assert.throws(() => parseArgs(['--online', '--rgb-root', '.', '--case-id', 'wrong']), /--case-id/);
});
