const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extractor = require('../extractor');
const config = require('../config-service');
test('空文本和损坏 Word 必须失败，不返回错误正文', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  config.init({ userDataPath: dir });
  const original = config.getConfig().llamaParse;
  config.getConfig().llamaParse = null;
  t.after(() => { config.getConfig().llamaParse = original; });
  for (const name of ['empty.txt', 'broken.docx']) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, '');
    await assert.rejects(extractor.extractText(file));
  }
  const brokenPdf = path.join(dir, 'broken.pdf');
  fs.writeFileSync(brokenPdf, 'not a PDF');
  await assert.rejects(extractor.extractText(brokenPdf));
});
