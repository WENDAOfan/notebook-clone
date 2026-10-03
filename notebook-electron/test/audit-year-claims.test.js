const test = require('node:test');
const assert = require('node:assert/strict');
const { yearCandidates } = require('../eval/audit-year-claims');

test('仅提示已引用证据未出现的年份，不把它判成自动错误', () => {
  const report = { cases: [
    { id: 'unsupported', answer: '2024年2月9日宣布[1]。',
      sources: [{ citationId: 1, snippet: '2月9日宣布。' }] },
    { id: 'supported', answer: '2023年2月3日宣布[2]。',
      sources: [{ citationId: 2, snippet: '2023年2月3日宣布。' }] }
  ] };
  assert.deepEqual(yearCandidates(report).map(item => [item.id, item.year]),
    [['unsupported', '2024']]);
});
