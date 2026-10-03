const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJsonl, eligible, selectSamples, REVIEWED_20_IDS, REVIEWED_20_EXCLUDED_IDS,
  makeVariants, assess } = require('../eval/rgb-mini-lib');

function record() {
  return {
    id: 254,
    query: '某次颁奖典礼的获奖人是谁？',
    answer: ['测试人物'],
    positive: ['报道确认获奖人是测试人物。'],
    negative: ['这篇报道只介绍颁奖流程。', '这篇文章回顾其他奖项。', '另一则新闻介绍主持人。', '现场采访没有提及获奖人。']
  };
}

test('RGB JSONL adapter reads separate records without changing the upstream format', () => {
  const rows = parseJsonl(`${JSON.stringify(record())}\n${JSON.stringify({ ...record(), id: 161 })}\n`);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.id), [254, 161]);
});

test('RGB mini pairs equal-size isolated document sets with neutral titles', () => {
  const row = record();
  assert.equal(eligible(row), true);
  const [answerable, noAnswer] = makeVariants(row);
  assert.equal(answerable.documents.length, 4);
  assert.equal(noAnswer.documents.length, 4);
  assert.equal(answerable.documents.filter(doc => doc.role === 'positive').length, 1);
  assert.equal(noAnswer.documents.filter(doc => doc.role === 'positive').length, 0);
  assert.ok(answerable.documents.every(doc => /^资料\d+$/.test(doc.title)));
  assert.deepEqual(answerable.documents.filter(doc => doc.role === 'negative').map(doc => doc.text).sort(), row.negative.slice(0, 3).sort());
  assert.deepEqual(noAnswer.documents.map(doc => doc.text).sort(), row.negative.slice(0, 4).sort());
});

test('RGB mini rejects a negative passage containing the expected answer', () => {
  const row = record();
  row.negative[3] = '这里泄漏了测试人物';
  assert.equal(eligible(row), false);
  assert.throws(() => makeVariants(row));
});

test('RGB reviewed set fixes 20 unique cases and keeps rejected evidence labels outside the set', () => {
  assert.equal(REVIEWED_20_IDS.length, 20);
  assert.equal(new Set(REVIEWED_20_IDS).size, 20);
  assert.equal(REVIEWED_20_EXCLUDED_IDS.length, 7);
  assert.ok(REVIEWED_20_EXCLUDED_IDS.every(id => !REVIEWED_20_IDS.includes(id)));
  assert.throws(() => selectSamples([], 'unknown'), /未知 RGB 样本集/);
  assert.throws(() => selectSamples([record()], 'reviewed20'), /固定清单不符/);
});

test('RGB automatic checks separate answer text, retrieved evidence and citation number', () => {
  const [answerable, noAnswer] = makeVariants(record());
  const result = { answer: '获奖人是测试人物[1]。', sources: [{ citationId: 1, documentId: 42 }] };
  assert.deepEqual(assess(answerable, result, 42), {
    expectedStringPresent: true,
    labeledPositivePassageInTop5: true,
    hasCitation: true,
    citationIdsValid: true,
    refusalHeuristic: null
  });
  const invalid = assess(answerable, { ...result, answer: '获奖人是测试人物[2]。' }, 42);
  assert.equal(invalid.citationIdsValid, false);
  const refusal = assess(noAnswer, { answer: '资料未提供获奖人，无法确定。', sources: [] }, null);
  assert.equal(refusal.refusalHeuristic, true);
  assert.equal(refusal.expectedStringPresent, null);
  const alternateRefusal = assess(noAnswer,
    { answer: '文档未给出具体日期，无法据此确认。', sources: [] }, null);
  assert.equal(alternateRefusal.refusalHeuristic, true);
});
