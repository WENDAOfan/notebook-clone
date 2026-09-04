const { getEncoding } = require('js-tiktoken');
const db = require('./database');
const vectorStore = require('./vector-store');

const DEFAULT_TOKEN_BUDGET = 8000;
const SEARCH_DEPTH = 30;
const RRF_K = 60;
const SIMILARITY_THRESHOLD = 0.35;
let embeddingProvider = null;

function configure({ getEmbedding }) {
  embeddingProvider = getEmbedding;
}

function buildRetrievalQuery(query, history = []) {
  const current = String(query || '').trim();
  const needsContext = current.length < 12
    || /^(它|这|那|这些|那些|上面|前面|其中|该)/.test(current);
  if (!needsContext) return current;
  const recentQuestions = history
    .filter(message => message.role === 'user')
    .slice(-2)
    .map(message => message.content)
    .filter(Boolean);
  return [...recentQuestions, current].join('\n');
}

async function retrieve({
  scopeType,
  scopeId,
  query,
  history = [],
  tokenBudget = DEFAULT_TOKEN_BUDGET,
  queryEmbedding = null
}) {
  if (!['document', 'notebook'].includes(scopeType)) {
    throw new Error(`未知检索范围: ${scopeType}`);
  }
  const numericScopeId = Number(scopeId);
  const retrievalQuery = buildRetrievalQuery(query, history);
  let allowedDocumentIds;

  if (scopeType === 'document') {
    const document = await db.getDocumentById(numericScopeId);
    allowedDocumentIds = document ? [document.id] : [];
  } else {
    const documents = await db.getDocumentsByNotebook(numericScopeId);
    allowedDocumentIds = documents.map(document => document.id);
  }
  const allowedSet = new Set(allowedDocumentIds);
  const filter = metadata => allowedSet.has(Number(metadata?.documentId));

  const warnings = [];
  let embedding = queryEmbedding;
  if (!embedding && embeddingProvider) {
    try {
      embedding = await embeddingProvider(retrievalQuery);
    } catch (error) {
      warnings.push(`向量检索不可用，已降级为 BM25：${error.message}`);
    }
  }

  const vectorResults = embedding
    ? vectorStore.similaritySearch(embedding, SEARCH_DEPTH, filter)
    : [];
  const keywordResults = vectorStore.keywordSearch(retrievalQuery, SEARCH_DEPTH, filter);
  const fused = fuseResults(vectorResults, keywordResults);
  const filtered = fused.filter(result =>
    result.vectorScore === null
    || result.vectorScore >= SIMILARITY_THRESHOLD
    || result.keywordScore > 0
  );
  const selected = selectWithinBudget(filtered, {
    tokenBudget,
    maxPerDocument: scopeType === 'notebook' ? 3 : Number.POSITIVE_INFINITY
  });

  const sources = selected.map((chunk, index) => ({
    citationId: index + 1,
    chunkId: chunk.id,
    documentId: Number(chunk.metadata.documentId),
    documentTitle: chunk.metadata.documentTitle || '未知文档',
    chunkIndex: chunk.metadata.chunkIndex ?? null,
    snippet: chunk.text,
    scores: {
      vector: chunk.vectorScore,
      bm25: chunk.keywordScore,
      rrf: chunk.rrfScore
    }
  }));
  const chunks = selected.map((chunk, index) => ({
    ...chunk,
    citationId: index + 1
  }));

  return {
    chunks,
    sources,
    context: chunks.map(chunk =>
      `[${chunk.citationId}] 来源：${chunk.metadata.documentTitle || '未知文档'}\n${chunk.text}`
    ).join('\n\n---\n\n'),
    diagnostics: {
      scopeType,
      scopeId: numericScopeId,
      retrievalQuery,
      vectorCandidates: vectorResults.length,
      keywordCandidates: keywordResults.length,
      fusedCandidates: fused.length,
      selectedChunks: chunks.length,
      tokenBudget,
      warnings
    }
  };
}

function fuseResults(vectorResults, keywordResults) {
  const candidates = new Map();
  vectorResults.forEach((item, rank) => {
    candidates.set(item.id, {
      ...item,
      vectorScore: item.score,
      keywordScore: 0,
      rrfScore: 1 / (RRF_K + rank + 1)
    });
  });
  keywordResults.forEach((item, rank) => {
    const existing = candidates.get(item.id);
    if (existing) {
      existing.keywordScore = item.score;
      existing.rrfScore += 1 / (RRF_K + rank + 1);
    } else {
      candidates.set(item.id, {
        ...item,
        vectorScore: null,
        keywordScore: item.score,
        rrfScore: 1 / (RRF_K + rank + 1)
      });
    }
  });
  return [...candidates.values()].sort((left, right) =>
    right.rrfScore - left.rrfScore
    || (right.keywordScore || 0) - (left.keywordScore || 0)
    || (right.vectorScore || 0) - (left.vectorScore || 0)
  );
}

function selectWithinBudget(candidates, { tokenBudget, maxPerDocument }) {
  const encoding = getEncoding('cl100k_base');
  const selected = [];
  const perDocument = new Map();
  let usedTokens = 0;

  for (const candidate of candidates) {
    const documentId = Number(candidate.metadata?.documentId);
    const count = perDocument.get(documentId) || 0;
    if (count >= maxPerDocument) continue;
    if (isNearDuplicate(candidate, selected)) continue;

    const tokenCount = encoding.encode(candidate.text || '').length;
    if (selected.length > 0 && usedTokens + tokenCount > tokenBudget) continue;
    selected.push(candidate);
    usedTokens += tokenCount;
    perDocument.set(documentId, count + 1);
  }
  return selected;
}

function isNearDuplicate(candidate, selected) {
  const current = normalizeForDuplicate(candidate.text);
  if (!current) return false;
  return selected.some(existing => {
    if (Number(existing.metadata?.documentId) !== Number(candidate.metadata?.documentId)) {
      return false;
    }
    const previous = normalizeForDuplicate(existing.text);
    const shorter = current.length < previous.length ? current : previous;
    const longer = current.length < previous.length ? previous : current;
    return shorter.length >= 80 && longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.8)));
  });
}

function normalizeForDuplicate(text) {
  return String(text || '').replace(/\s+/g, '').toLowerCase();
}

module.exports = {
  configure,
  retrieve,
  buildRetrievalQuery,
  fuseResults,
  selectWithinBudget
};
