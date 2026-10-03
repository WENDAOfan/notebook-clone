const test = require('node:test');
const assert = require('node:assert/strict');
const { extractLocalPdf } = require('../pdf-local-parser');

test('preserves Chinese text layer and OCRs only the blank scan page', async () => {
  const configs = [];
  class FakeLiteParse {
    constructor(config) { this.config = config; configs.push(config); }
    async parse() {
      return this.config.ocrEnabled === false
        ? { pages: [{ pageNum: 1, text: '中文保修条款' }, { pageNum: 2, text: '' }] }
        : { pages: [{ pageNum: 2, text: 'Scanned warranty 12 months.' }] };
    }
  }
  assert.equal(await extractLocalPdf('mixed.pdf', FakeLiteParse),
    '中文保修条款\n\nScanned warranty 12 months.');
  assert.deepEqual(configs[1], { ocrLanguage: 'chi_sim', targetPages: '2', quiet: true });
});

test('does not invoke OCR when all pages have readable text', async () => {
  let calls = 0;
  class FakeLiteParse {
    constructor(config) { assert.equal(config.ocrEnabled, false); }
    async parse() { calls++; return { pages: [{ pageNum: 1, text: '原生文本' }] }; }
  }
  assert.equal(await extractLocalPdf('text.pdf', FakeLiteParse), '原生文本');
  assert.equal(calls, 1);
});

test('empty, missing OCR page, and OCR-only documents fail explicitly', async () => {
  class EmptyLiteParse {
    constructor(config) { this.config = config; }
    async parse() { return this.config.ocrEnabled === false
      ? { pages: [{ pageNum: 1, text: '' }] } : { pages: [{ pageNum: 1, text: '' }] }; }
  }
  await assert.rejects(extractLocalPdf('empty.pdf', EmptyLiteParse), /PDF文本提取为空/);

  class MissingPageLiteParse extends EmptyLiteParse {
    async parse() { return this.config.ocrEnabled === false
      ? { pages: [{ pageNum: 1, text: '' }] } : { pages: [] }; }
  }
  await assert.rejects(extractLocalPdf('missing.pdf', MissingPageLiteParse), /OCR 未返回第 1 页/);

  class ScannedLiteParse extends EmptyLiteParse {
    async parse() { return this.config.ocrEnabled === false
      ? { pages: [{ pageNum: 1, text: '' }] }
      : { pages: [{ pageNum: 1, text: '扫描件文字' }] }; }
  }
  assert.equal(await extractLocalPdf('scan.pdf', ScannedLiteParse), '扫描件文字');
});
