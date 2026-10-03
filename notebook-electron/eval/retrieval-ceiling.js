// Exact best evidence reciprocal-rank sum over the real production chunks.
// Diagnostic only: never used by the retriever, never rescales reported MRR.
const { splitTextIntoChunks } = require('../rag-service');
function idealReciprocalSum(masks, targetCount) {
  if (targetCount > 16) throw new Error('精确上限审计最多支持16处证据');
  const full = (1 << targetCount) - 1;
  const count = value => value.toString(2).replace(/0/g, '').length;
  let states = new Map([[0, 0]]);
  let best = targetCount === 0 ? 0 : -Infinity;
  for (let rank = 1; rank <= targetCount; rank++) {
    const next = new Map();
    for (const [covered, score] of states) for (const mask of masks) {
      const added = mask & ~covered;
      if (!added) continue;
      const joined = covered | mask;
      const value = score + count(added) / rank;
      next.set(joined, Math.max(next.get(joined) ?? -Infinity, value));
      if (joined === full) best = Math.max(best, value);
    }
    states = next;
  }
  return Number.isFinite(best) ? best : null;
}
function auditCeiling(suite) {
  const chunks = suite.data.documents.flatMap(doc => splitTextIntoChunks(doc.text, 512, 50)
    .map(text => ({ documentId: doc.id, text })));
  const rows = suite.data.questions.filter(q => q.kind !== 'no_answer').map(q => {
    const targets = q.evidenceTargets || [];
    const masks = [...new Set(chunks.map(chunk => targets.reduce((mask, target, i) =>
      chunk.documentId === target.documentId && chunk.text.includes(target.contains) ? mask | (1 << i) : mask, 0)).filter(Boolean))];
    return { id: q.id, targets: targets.length, coverageMasks: masks,
      idealReciprocalSum: idealReciprocalSum(masks, targets.length) };
  });
  const count = rows.reduce((sum, row) => sum + row.targets, 0);
  return { suite: suite.data.id, suiteSha256: suite.sha256, chunks: chunks.length, rows,
    evidenceTargets: count, theoreticalEvidenceMRR: rows.every(row => row.idealReciprocalSum !== null)
      ? rows.reduce((sum, row) => sum + row.idealReciprocalSum, 0) / count : null };
}
if (require.main === module) {
  const { loadSuite } = require('./production-cases');
  console.log(JSON.stringify(auditCeiling(loadSuite(process.argv[2] || 'long')), null, 2));
}
module.exports = { idealReciprocalSum, auditCeiling };
