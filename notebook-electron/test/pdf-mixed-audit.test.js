const test = require('node:test');
const assert = require('node:assert/strict');
const { combineByPage } = require('../eval/pdf-mixed-audit');

test('pagewise diagnostic takes native text where present and OCR for blank pages', () => {
  const result = combineByPage(
    [{ pageNum: 1, text: '可复制中文' }, { pageNum: 2, text: '' }],
    [{ pageNum: 1, text: 'OCR 误识别' }, { pageNum: 2, text: '扫描页文字' }]
  );
  assert.deepEqual(result, [
    { page: 1, selected: 'native', text: '可复制中文' },
    { page: 2, selected: 'ocr', text: '扫描页文字' }
  ]);
});

test('pagewise diagnostic rejects mismatched page counts or numbers', () => {
  assert.throws(() => combineByPage([{ pageNum: 1, text: 'a' }], []), /页数不一致/);
  assert.throws(() => combineByPage([{ pageNum: 1, text: 'a' }], [{ pageNum: 2, text: 'b' }]), /页码不一致/);
});
