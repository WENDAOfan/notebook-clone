// Audit the production extractor's local fallback without reading AI keys or using a model.
const fs = require('node:fs');
const path = require('node:path');

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--label' || !/^[a-z0-9-]{1,32}$/.test(argv[1])) {
    throw new Error('用法：node eval/parser-local-audit.js --label <小写字母数字连字符>');
  }
  const reportPath = path.join(__dirname, `parser-local-${argv[1]}-report.json`);
  if (fs.existsSync(reportPath)) throw new Error(`报告已存在，拒绝覆盖：${reportPath}`);

  // This runs in a separate process. Force the real extractText entrypoint down its local path.
  const config = require('../config-service');
  config.getConfig = () => ({});
  const extractor = require('../extractor');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const report = { kind: 'production-local-parser-audit', status: 'RUNNING',
    startedAt: new Date().toISOString(), documents: [], boundaries: [] };
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  for (const item of manifest) {
    const started = Date.now();
    try {
      const text = await extractor.extractText(path.join(__dirname, 'fixtures', item.file));
      report.documents.push({ file: item.file, chars: text.length,
        requiredFactPresent: text.includes(item.fact), elapsedMs: Date.now() - started });
    } catch (error) {
      report.documents.push({ file: item.file, error: error.message, requiredFactPresent: false,
        elapsedMs: Date.now() - started });
    }
    save();
  }
  const normalizeOcr = text => text.replace(/\s+/g, '');
  const boundaryCases = [
    { file: 'empty.txt', expectedResult: 'error' },
    { file: 'broken.pdf', expectedResult: 'error' },
    { file: 'scan.pdf', fact: 'Scanned fictional document: warranty 12 months.' },
    { file: 'scan-zh.pdf', fact: '星桥X9整机保修期为15个月。' }
  ];
  for (const { file, fact } of boundaryCases) {
    const started = Date.now();
    try {
      const text = await extractor.extractText(path.join(__dirname, 'fixtures', file));
      report.boundaries.push({ file, result: 'extracted', chars: text.length,
        ...(fact ? { requiredFactPresent: normalizeOcr(text).includes(normalizeOcr(fact)) } : {}),
        elapsedMs: Date.now() - started });
    } catch (error) {
      report.boundaries.push({ file, result: 'error', error: error.message,
        elapsedMs: Date.now() - started });
    }
    save();
  }
  report.status = report.documents.every(item => item.requiredFactPresent)
    && boundaryCases.every(({ file, expectedResult, fact }) => {
      const result = report.boundaries.find(item => item.file === file);
      return expectedResult ? result.result === expectedResult
        : result.result === 'error' || result.requiredFactPresent === true;
    })
    ? 'PASS' : 'FAIL';
  report.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ status: report.status, reportPath,
    documentFacts: report.documents.map(item => [item.file, item.requiredFactPresent]),
    boundaries: report.boundaries.map(item => [item.file, item.result]) }, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
