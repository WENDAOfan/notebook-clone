// Read-only diagnostic: a year absent from all cited snippets needs human review.
// It is not a semantic entailment checker and must not be treated as a pass/fail grade.
const fs = require('node:fs');
const path = require('node:path');

function yearCandidates(report) {
  return (report.cases || []).flatMap(item => {
    const answer = String(item.answer || '');
    const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1])));
    const sourceText = (item.sources || []).filter(source => cited.has(Number(source.citationId)))
      .map(source => source.snippet || source.text || '').join('\n');
    const years = [...new Set(answer.match(/(?:19|20)\d{2}/g) || [])];
    return years.filter(year => !sourceText.includes(year)).map(year => ({
      id: item.id, year, citedSources: cited.size,
      note: '回答出现的年份不在已引用片段中；需人工结合否定/计划语境核对'
    }));
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--report') {
    console.error('用法：node eval/audit-year-claims.js --report <本地报告路径>');
    process.exitCode = 1;
  } else {
    const reportPath = path.resolve(args[1]);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    console.log(JSON.stringify({ report: reportPath, candidates: yearCandidates(report) }, null, 2));
  }
}

module.exports = { yearCandidates };
