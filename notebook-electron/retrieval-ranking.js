// Query/title phrase features augment RRF without discarding semantic evidence.
// This uses only the scoped corpus and query, never evaluation labels or answers.
const normalize = value => String(value || '').normalize('NFKC').toLowerCase();
const identifiers = value => (normalize(value).match(/[a-z0-9_-]+/g) || [])
  .filter(word => /[a-z]/.test(word) && /\d/.test(word));

function queryPhrases(query, documents) {
  const runs = normalize(query).match(/[\u4e00-\u9fff]+/g) || [];
  const terms = new Set();
  for (const run of runs) {
    for (let length = Math.min(12, run.length); length >= 3; length--) {
      for (let offset = 0; offset <= run.length - length; offset++) terms.add(run.slice(offset, offset + length));
    }
  }
  const titles = documents.map(doc => normalize(doc.title));
  const found = [...terms].map(text => ({ text,
    documentFrequency: titles.filter(title => title.includes(text)).length })).filter(item => item.documentFrequency);
  // Repeated title phrases identify a family of documents. A longer, one-off
  // title continuation must not suppress that family's other kinds of evidence.
  // Only a title-leading phrase may suppress a longer continuation. A common
  // interior suffix (e.g. "lake center") must not erase a distinct full name.
  const repeated = found.filter(item => item.documentFrequency >= 2
    && titles.some(title => title.startsWith(item.text)));
  const normalizedQuery = normalize(query);
  const spans = text => {
    const matches = [];
    for (let offset = normalizedQuery.indexOf(text); offset >= 0; offset = normalizedQuery.indexOf(text, offset + 1)) {
      matches.push([offset, offset + text.length]);
    }
    return matches;
  };
  const repeatedSpans = repeated.flatMap(item => spans(item.text));
  // Keep an independently mentioned name even if it only has one document.
  // Repetition suppresses only continuations of the same phrase, not other names.
  const pool = repeated.length ? [...repeated, ...found.filter(item => item.documentFrequency === 1
    && spans(item.text).some(([start, end]) => !repeatedSpans.some(([left, right]) => start < right && left < end)))] : found;
  return pool.filter(item => !pool.some(other => other.text.length > item.text.length && other.text.includes(item.text)))
    .map(item => ({ ...item, weight: item.text.length * Math.log(1 + (titles.length + 1) / (item.documentFrequency + 1)) }));
}

function rankCandidates(candidates, query, documents, {
  phraseWeight = 0.6, identifierWeight = 0.02, balancedPhrases = false, overlapPenalty = 0
} = {}) {
  const phrases = queryPhrases(query, documents);
  // A leading title name is an anchor, whereas a trailing generic topic (such
  // as "budget") must not make every other entity look equally relevant.
  const anchors = phrases.filter(phrase => documents.some(doc => normalize(doc.title).startsWith(phrase.text)));
  const maxWeight = Math.max(1, ...phrases.map(phrase => phrase.weight));
  const ids = [...new Set(identifiers(query))];
  // RRF gives two votes to a lexical distractor, but only one to a semantic
  // paraphrase with no shared tokens. Preserve the strongest eligible dense
  // result in this specific case. Candidates have already passed relevance gates.
  const denseBest = candidates.filter(item => Number.isFinite(item.vectorScore))
    .reduce((best, item) => !best || item.vectorScore > best.vectorScore ? item : best, null);
  const semanticFirst = denseBest?.keywordScore === 0 ? denseBest.id : null;
  const ranked = candidates.map(candidate => {
    const text = normalize(candidate.text);
    const title = normalize(candidate.metadata?.documentTitle);
    const phraseMatches = phrases.filter(phrase => title.includes(phrase.text) || text.includes(phrase.text));
    const words = new Set(identifiers(`${title}\n${text}`));
    const identifierMatches = ids.filter(id => words.has(id));
    const phraseScore = balancedPhrases && anchors.length ? Number(anchors.some(phrase => phraseMatches.includes(phrase)))
      : Math.max(0, ...phraseMatches.map(phrase => phrase.weight)) / maxWeight;
    const identifierScore = ids.length ? identifierMatches.length / ids.length : 0;
    const rankingScore = candidate.rrfScore / (2 / 61)
      + phraseWeight * phraseScore + identifierWeight * identifierScore;
    return { ...candidate, rankingScore, phraseScore, identifierScore,
      semanticPromotion: candidate.id === semanticFirst,
      phraseMatches: phraseMatches.map(phrase => phrase.text), identifierMatches };
  }).sort((a, b) => Number(b.semanticPromotion) - Number(a.semanticPromotion)
    || b.rankingScore - a.rankingScore || b.rrfScore - a.rrfScore);
  // Only adjacent overlapping text receives a soft redundancy penalty. Distinct
  // facts in the same document (for example old/new rules) are not penalized.
  const diversified = [];
  const remaining = [...ranked];
  const overlapSets = new Map(ranked.map(item => [item.id, new Set()]));
  if (overlapPenalty > 0) {
    for (const current of ranked) for (const previous of ranked) {
      if (current !== previous && boundaryOverlap(current, previous)) overlapSets.get(current.id).add(previous.id);
    }
  }
  while (remaining.length) {
    const overlaps = item => diversified.some(previous => overlapSets.get(item.id).has(previous.id));
    const score = item => item.rankingScore - (overlaps(item) ? overlapPenalty : 0);
    remaining.sort((a, b) => Number(b.semanticPromotion) - Number(a.semanticPromotion)
      || score(b) - score(a) || b.rankingScore - a.rankingScore || b.rrfScore - a.rrfScore);
    const item = remaining.shift();
    diversified.push({ ...item, selectionScore: score(item), overlapDemotion: overlaps(item) && overlapPenalty > 0 });
  }
  return { ranked: diversified, phrases, identifiers: ids };
}

function boundaryOverlap(left, right) {
  if (left.metadata?.documentId == null || left.metadata.documentId !== right.metadata?.documentId) return false;
  const a = normalize(left.text).replace(/\s+/g, '');
  const b = normalize(right.text).replace(/\s+/g, '');
  // Production chunk overlap is bounded. Compare the text, not unstable chunk IDs.
  for (let size = Math.min(256, a.length, b.length); size >= 32; size--) {
    // Penalize only the continuation, never the preceding complete passage
    // merely because a higher-ranked continuation repeats its tail.
    if (b.endsWith(a.slice(0, size))) return true;
  }
  return false;
}

module.exports = { rankCandidates, queryPhrases, boundaryOverlap };
