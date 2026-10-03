const test = require('node:test');
const assert = require('node:assert/strict');
const { idealReciprocalSum } = require('../eval/retrieval-ceiling');
test('独立两份证据的倒数排名平均最高为0.75，不是1', () => {
  assert.equal(idealReciprocalSum([1, 2], 2) / 2, .75);
});
test('一块同时支持两处证据时可以同为第一，不能按文档数量猜测上限', () => {
  assert.equal(idealReciprocalSum([1, 2, 3], 2) / 2, 1);
  assert.equal(idealReciprocalSum([1], 2), null);
  assert.equal(idealReciprocalSum([3, 4], 3), 2.5);
});
