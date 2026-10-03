// Diagnose whether the production local PDF parser preserves both types of page.
// All inputs are fictional local fixtures; the cloud parser and model are disabled.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const configService = require('../config-service');
const { cleanText } = require('../text-cleaner');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const expected = [
  '星桥X4整机保修期为30个月，核心部件保修期为42个月。',
  'Scanned fictional document: warranty 12 months.'
];

function combineByPage(nativePages, ocrPages) {
  if (nativePages.length !== ocrPages.length) throw new Error('两种解析模式的页数不一致');
  return nativePages.map((page, index) => {
    if (page.pageNum !== ocrPages[index].pageNum) throw new Error('两种解析模式的页码不一致');
    const nativeText = cleanText(page.text || '');
    const ocrText = cleanText(ocrPages[index].text || '');
    return { page: page.pageNum, selected: nativeText ? 'native' : 'ocr',
      text: nativeText || ocrText };
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--label' || !/^[a-z0-9-]{1,32}$/.test(argv[1])) {
    throw new Error('用法：node eval/pdf-mixed-audit.js --label <小写字母数字连字符>');
  }
  const filePath = path.join(__dirname, 'fixtures', 'mixed-text-scan.pdf');
  const reportPath = path.join(__dirname, `pdf-mixed-${argv[1]}-report.json`);
  if (!fs.existsSync(filePath)) throw new Error('缺少混合 PDF，先运行 build-mixed-pdf.py');
  if (fs.existsSync(reportPath)) throw new Error(`报告已存在，拒绝覆盖：${reportPath}`);

  // Force the same local fallback used by production, without reading credentials.
  configService.getConfig = () => ({ llamaParse: { apiKey: '' } });
  const { extractText } = require('../extractor');
  const { LiteParse } = await import('@llamaindex/liteparse');
  const report = {
    kind: 'mixed-pdf-local-parser-audit',
    startedAt: new Date().toISOString(),
    fixture: { file: path.basename(filePath), sha256: sha256(fs.readFileSync(filePath)),
      sources: ['product-4.pdf', 'scan.pdf'].map(file => ({ file,
        sha256: sha256(fs.readFileSync(path.join(__dirname, 'fixtures', file))) })) },
    liteparseVersion: require('@llamaindex/liteparse/package.json').version,
    expected
  };

  const nativeStart = Date.now();
  const native = await new LiteParse({ ocrEnabled: false, quiet: true }).parse(filePath);
  report.native = { elapsedMs: Date.now() - nativeStart,
    pages: native.pages.map(page => ({ page: page.pageNum, cleanedChars: cleanText(page.text).length,
      expectedPresent: expected.map(fact => cleanText(page.text).includes(fact)) })) };

  const ocrStart = Date.now();
  const ocr = await new LiteParse({ ocrLanguage: 'chi_sim', quiet: true }).parse(filePath);
  report.defaultOcr = { elapsedMs: Date.now() - ocrStart,
    pages: ocr.pages.map(page => ({ page: page.pageNum, cleanedChars: cleanText(page.text).length,
      expectedPresent: expected.map(fact => cleanText(page.text).includes(fact)) })) };

  const productionStart = Date.now();
  const productionText = await extractText(filePath);
  report.productionLocal = { elapsedMs: Date.now() - productionStart,
    cleanedChars: productionText.length, expectedPresent: expected.map(fact => productionText.includes(fact)) };

  // Diagnostic only: proves that these two parser outputs contain both facts.
  // It is not a general PDF quality rule and is not used by the app.
  const combined = combineByPage(native.pages, ocr.pages);
  report.pagewiseProbe = { pages: combined.map(page => ({ page: page.page,
    selected: page.selected, cleanedChars: page.text.length,
    expectedPresent: expected.map(fact => page.text.includes(fact)) })),
  expectedPresent: expected.map(fact => combined.some(page => page.text.includes(fact))) };
  report.status = 'DIAGNOSTIC_COMPLETE';
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath, productionLocal: report.productionLocal,
    pagewiseProbe: report.pagewiseProbe }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { combineByPage, main };
