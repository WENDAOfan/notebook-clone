const { getEncoding } = require('js-tiktoken');
let encoding;
const countTokens = text => (encoding ||= getEncoding('cl100k_base')).encode(text).length;

function isSentenceBoundary(text, index) {
  if (index < 0) return true;
  const character = text[index];
  if (/[。！？!?\r\n]/.test(character)) return true;
  // Don't break decimals, abbreviations or identifiers at an internal dot.
  return character === '.' && (index + 1 === text.length || /\s/.test(text[index + 1]));
}

// This helper receives only ready, hash-verified documents from retrieval.
// Never find text in another document, guess among repeats, or fall back to a
// document prefix. Returned text is one contiguous, exact original substring.
function restoreSentenceContext(candidate, document, { maxCharacters = 256, maxExtraTokens = 128 } = {}) {
  const keep = reason => ({ ...candidate, contextWindow: { status: 'unchanged', reason } });
  if (!document || Number(document.id) !== Number(candidate.metadata?.documentId)) return keep('document_not_in_scope');
  const body = document.content;
  const text = candidate.text;
  if (typeof body !== 'string' || typeof text !== 'string' || !text.length) return keep('missing_text');
  const originalStart = body.indexOf(text);
  if (originalStart < 0) return keep('no_exact_match');
  if (body.indexOf(text, originalStart + 1) >= 0) return keep('ambiguous_match');
  const originalEnd = originalStart + text.length;
  let start = originalStart;
  let end = originalEnd;
  while (start > 0 && originalStart - start < maxCharacters && !isSentenceBoundary(body, start - 1)) start--;
  if (!isSentenceBoundary(body, start - 1)) start = originalStart;
  while (end < body.length && end - originalEnd < maxCharacters && !isSentenceBoundary(body, end - 1)) end++;
  if (end < body.length && !isSentenceBoundary(body, end - 1)) end = originalEnd;
  const prefix = body.slice(start, originalStart);
  const suffix = body.slice(originalEnd, end);
  const addedTokens = countTokens(prefix) + countTokens(suffix);
  if (addedTokens > maxExtraTokens) return keep('extension_token_limit');
  return { ...candidate, text: body.slice(start, end), contextWindow: {
    status: start !== originalStart || end !== originalEnd ? 'expanded' : 'unchanged',
    reason: 'exact_original_range', start, end, originalStart, originalEnd, addedTokens,
    offsetUnit: 'UTF-16', maxCharacters, maxExtraTokens
  } };
}

module.exports = { restoreSentenceContext, isSentenceBoundary };
