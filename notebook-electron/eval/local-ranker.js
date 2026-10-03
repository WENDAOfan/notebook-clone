const { tokenizeText } = require('../vector-store');

// Experimental, offline-only scoring over already scoped/relevant candidates.
// A keyword repeated throughout a long chunk cannot drown out a useful sentence.
function rankLocalEvidence(candidates, query) {
  const terms = [...new Set(tokenizeText(query))];
  if (!terms.length || candidates.length < 2) return candidates;
  const records = candidates.map(item => ({ item,
    windows: item.text.split(/[。！？!?\r\n]+/).filter(Boolean)
      .map(text => ({ text, terms: new Set(tokenizeText(text)) })) }));
  const documents = new Map();
  for (const record of records) {
    const id = record.item.metadata.documentId;
    if (!documents.has(id)) documents.set(id, new Set());
    for (const window of record.windows) for (const term of window.terms) documents.get(id).add(term);
  }
  const weights = new Map(terms.map(term => {
    const df = [...documents.values()].filter(words => words.has(term)).length;
    return [term, Math.log(1 + (documents.size - df + .5) / (df + .5))];
  }));
  return records.map(({ item, windows }, order) => {
    const scored = windows.map(window => ({ text: window.text,
      score: terms.reduce((sum, term) => sum + (window.terms.has(term) ? weights.get(term) : 0), 0) }));
    const best = scored.reduce((left, right) => right.score > left.score ? right : left, { text: '', score: 0 });
    return { ...item, localEvidenceScore: best.score, localEvidenceWindow: best.text, localEvidenceOrder: order };
  }).sort((a, b) => Number(b.semanticPromotion) - Number(a.semanticPromotion)
    // Keep the established explicit-subject match ahead of mere topic overlap.
    // This changes order only; lower tiers remain available for multi-source answers.
    || (b.phraseScore || 0) - (a.phraseScore || 0)
    || b.localEvidenceScore - a.localEvidenceScore || a.localEvidenceOrder - b.localEvidenceOrder);
}

module.exports = { rankLocalEvidence };
