const test = require('node:test');
const assert = require('node:assert/strict');
const cases = require('../eval/cases.json');
const manifest = require('../eval/manifest.json');
test('验收数据固定为八份资料和五类各八题，校准与验收不重叠', () => {
  assert.equal(manifest.length, 8);
  assert.equal(cases.length, 40);
  assert.equal(new Set(cases.map(item => item.id)).size, 40);
  for (const category of ['fact','semantic','followup','multi','no_answer']) {
    for (const split of ['calibration','acceptance']) {
      assert.equal(cases.filter(item => item.category === category && item.split === split).length, 4);
    }
  }
});
