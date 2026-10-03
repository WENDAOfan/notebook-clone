// Diagnose the installed LiteParse modes on fictional, locally generated PDFs.
// This does not read AI configuration or call a hosted parser/model.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--label' || !/^[a-z0-9-]{1,32}$/.test(argv[1])) {
    throw new Error('用法：node eval/pdf-mode-audit.js --label <小写字母数字连字符>');
  }
  const reportPath = path.join(__dirname, `pdf-mode-${argv[1]}-report.json`);
  if (fs.existsSync(reportPath)) throw new Error(`报告已存在，拒绝覆盖：${reportPath}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const samples = manifest.filter(item => item.file.endsWith('.pdf'));
  samples.push({ file: 'scan.pdf', fact: 'Scanned fictional document: warranty 12 months.' });
  const { LiteParse } = await import('@llamaindex/liteparse');
  const { cleanText } = require('../text-cleaner');
  const report = { kind: 'installed-liteparse-mode-comparison', startedAt: new Date().toISOString(),
    liteparseVersion: require('@llamaindex/liteparse/package.json').version, samples: [] };
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  for (const sample of samples) {
    const filePath = path.join(__dirname, 'fixtures', sample.file);
    const entry = { file: sample.file, fileSha256: sha256(fs.readFileSync(filePath)),
      expectedText: sample.fact, complexity: null, modes: [] };
    report.samples.push(entry);
    const classifier = new LiteParse({ ocrLanguage: 'chi_sim', quiet: true });
    entry.complexity = (await classifier.isComplex(filePath)).map(page => ({
      page: page.pageNumber, needsOcr: page.needsOcr, reasons: page.reasons
    }));
    for (const [mode, config] of [
      ['production-default', { ocrLanguage: 'chi_sim', quiet: true }],
      ['native-only', { ocrEnabled: false, quiet: true }]
    ]) {
      const started = Date.now();
      try {
        const parsed = await new LiteParse(config).parse(filePath);
        const cleaned = cleanText(parsed.text);
        entry.modes.push({ mode, rawChars: parsed.text.length, cleanedChars: cleaned.length,
          expectedTextPresent: cleaned.includes(sample.fact), elapsedMs: Date.now() - started,
          pages: parsed.pages.map(page => ({ page: page.pageNum, chars: page.text.length,
            expectedTextPresent: page.text.includes(sample.fact) })) });
      } catch (error) {
        entry.modes.push({ mode, error: error.message, elapsedMs: Date.now() - started });
      }
      save();
    }
  }
  report.finishedAt = new Date().toISOString();
  report.status = 'DIAGNOSTIC_COMPLETE';
  save();
  console.log(JSON.stringify({ reportPath, liteparseVersion: report.liteparseVersion,
    samples: report.samples.map(entry => ({ file: entry.file,
      complexity: entry.complexity,
      modes: entry.modes.map(mode => ({ mode: mode.mode, cleanedChars: mode.cleanedChars,
        expectedTextPresent: mode.expectedTextPresent, error: mode.error })) })) }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
