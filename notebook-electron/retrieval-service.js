const { getEncoding } = require('js-tiktoken');
const db = require('./database');
const vectorStore = require('./vector-store');
const crypto = require('node:crypto');
const { rankCandidates } = require('./retrieval-ranking');
const reranker = require('./retrieval-reranker');
const { restoreSentenceContext } = require('./retrieval-context');

const DEFAULT_TOKEN_BUDGET = 8000;
const SEARCH_DEPTH = 30;
const RRF_K = 60;
const SIMILARITY_THRESHOLD = 0.35;
const DEFAULT_POLICY = Object.freeze({ similarityThreshold: SIMILARITY_THRESHOLD, keywordThreshold: 1,
  minimumKeywordMatches: 2, searchDepth: SEARCH_DEPTH, exactIdentifiers: true,
  ranking: 'lexical', phraseWeight: 0.6, identifierWeight: 0.02, maxChunks: 8,
  balancedPhrases: true, overlapPenalty: 0.1, sentenceContext: true, rerank: false });
let policy = { ...DEFAULT_POLICY };
let embeddingProvider = null;
let modelProvider = () => 'embedding-3';

function configure({ getEmbedding, getEmbeddingModel, thresholds }) {
  if (getEmbedding !== undefined) embeddingProvider = getEmbedding;
  if (getEmbeddingModel) modelProvider = getEmbeddingModel;
  if (thresholds) policy = { ...policy, ...thresholds };
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
  queryEmbedding = null,
  allowRerank = true,
  signal = null
}) {
  const started = Date.now();
  signal?.throwIfAborted();

  if (!['document', 'notebook'].includes(scopeType)) {
    throw new Error(`未知检索范围: ${scopeType}`);
  }
  const numericScopeId = Number(scopeId);
  const retrievalQuery = buildRetrievalQuery(query, history);
  let documents;

  if (scopeType === 'document') {
    const document = await db.getDocumentById(numericScopeId);
    documents = document ? [document] : [];
  } else {
    documents = await db.getDocumentsByNotebook(numericScopeId);
  }
  const warnings = [];
  const valid = new Map();
  const model = modelProvider();
  for (const document of documents) {
    const hash = crypto.createHash('sha256').update(document.content || '').digest('hex');
    const matches = metadata => Number(metadata?.documentId) === Number(document.id)
      && metadata.contentHash === hash && metadata.embeddingModel === model;
    if (document.index_status === 'ready' && document.content_hash === hash
        && vectorStore.store.some(chunk => matches(chunk.metadata))) {
      valid.set(Number(document.id), hash);
    } else {
      warnings.push(`未覆盖文档「${document.title}」：索引未就绪、缺失或过期，请重新索引。`);
    }
  }
  const filter = metadata => valid.has(Number(metadata?.documentId))
    && metadata.contentHash === valid.get(Number(metadata.documentId))
    && metadata.embeddingModel === model;
  let embedding = queryEmbedding;
  if (valid.size && !embedding && embeddingProvider) {
    try {
      embedding = await embeddingProvider(retrievalQuery, signal);
    } catch (error) {
      signal?.throwIfAborted();
      warnings.push(`向量检索不可用，已降级为 BM25：${error.message}`);
    }
  }
  signal?.throwIfAborted();

  const validEmbedding = values => Array.isArray(values) && values.length > 0
    && values.every(Number.isFinite) && values.some(value => value !== 0);
  const scopedChunks = vectorStore.store.filter(chunk => filter(chunk.metadata));
  const badDocumentVectors = scopedChunks.filter(chunk => !validEmbedding(chunk.embedding)).length;
  if (badDocumentVectors) warnings.push(`${badDocumentVectors}个文档分块向量无效（全零或非法），这些分块仅参与BM25检索。`);
  if (embedding && !validEmbedding(embedding)) {
    warnings.push('查询向量无效（全零或非法），已降级为BM25；请检查Embedding服务。');
    embedding = null;
  }
  const usableMetadata = new Set(scopedChunks.filter(chunk => validEmbedding(chunk.embedding) && chunk.embedding.length === embedding?.length).map(chunk => chunk.metadata));
  const vectorResults = embedding
    ? vectorStore.similaritySearch(embedding, policy.searchDepth, metadata => filter(metadata) && usableMetadata.has(metadata))
    : [];
  const keywordResults = vectorStore.keywordSearch(retrievalQuery, policy.searchDepth, filter);
  const fused = fuseResults(vectorResults, keywordResults);
  const queryTerms = new Set(vectorStore.tokenizeText(retrievalQuery));
  for (const candidate of fused) {
    const words = new Set(vectorStore.tokenizeText(candidate.text));
    candidate.keywordMatches = [...queryTerms].filter(term => words.has(term)).length;
  }
  const relevant = fused.filter(result =>
    result.vectorScore >= policy.similarityThreshold
    || result.keywordScore >= policy.keywordThreshold
    || (result.keywordScore > 0 && result.keywordMatches >= policy.minimumKeywordMatches)
  );
  const ranking = policy.ranking === 'lexical'
    ? rankCandidates(relevant, retrievalQuery, documents.filter(doc => valid.has(Number(doc.id))), policy) : null;
  let filtered = ranking ? ranking.ranked
    : policy.exactIdentifiers ? preferIdentifiers(relevant, retrievalQuery) : relevant;
  const readyDocuments = new Map(documents.filter(doc => valid.has(Number(doc.id))).map(doc => [Number(doc.id), doc]));
  if (ranking && policy.sentenceContext) {
    filtered = filtered.map(chunk => restoreSentenceContext(chunk, readyDocuments.get(Number(chunk.metadata?.documentId))));
  }
  let rerankDiagnostics = null;
  if (policy.rerank && allowRerank) {
    const reranked = await reranker.rerank(filtered, retrievalQuery, { signal });
    filtered = reranked.ranked;
    rerankDiagnostics = reranked.diagnostics;
    if (rerankDiagnostics.status === 'fallback') warnings.push(`相关性重排未完成，已退回基础排序：${rerankDiagnostics.reason}`);
  } else if (policy.rerank) {
    rerankDiagnostics = { status: 'skipped', reason: 'question_rerank_budget', elapsedMs: 0 };
  }
  const contextual = filtered;
  const selected = selectWithinBudget(contextual, {
    tokenBudget,
    maxChunks: ranking ? policy.maxChunks : Number.POSITIVE_INFINITY,
    maxPerDocument: scopeType === 'notebook' ? 3 : Number.POSITIVE_INFINITY
  });

  const sources = selected.map((chunk, index) => ({
    citationId: index + 1,
    chunkId: chunk.id,
    documentId: Number(chunk.metadata.documentId),
    documentTitle: chunk.metadata.documentTitle || '未知文档',
    chunkIndex: chunk.metadata.chunkIndex ?? null,
    snippet: chunk.text,
    ...(chunk.contextWindow ? { contextWindow: chunk.contextWindow } : {}),
    scores: {
      vector: chunk.vectorScore,
      bm25: chunk.keywordScore,
      rrf: chunk.rrfScore,
      ...(ranking ? { ranking: chunk.rankingScore, selection: chunk.selectionScore,
        phrase: chunk.phraseScore, identifier: chunk.identifierScore } : {})
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
      elapsedMs: Date.now() - started,
      policy: { ...policy },
      ...(rerankDiagnostics ? { reranker: rerankDiagnostics } : {}),
      ...(ranking ? { queryPhrases: ranking.phrases, queryIdentifiers: ranking.identifiers } : {}),
      contextWindows: contextual.filter(chunk => chunk.contextWindow).map(chunk => ({ chunkId: chunk.id, ...chunk.contextWindow })),
      candidates: fused.map(chunk => ({ chunkId: chunk.id, text: chunk.text, documentId: chunk.metadata.documentId,
        vector: chunk.vectorScore, bm25: chunk.keywordScore, keywordMatches: chunk.keywordMatches, rrf: chunk.rrfScore,
        ...(ranking ? { ranking: ranking.ranked.find(item => item.id === chunk.id)?.rankingScore,
          phraseMatches: ranking.ranked.find(item => item.id === chunk.id)?.phraseMatches,
          semanticPromotion: ranking.ranked.find(item => item.id === chunk.id)?.semanticPromotion,
          selectionScore: ranking.ranked.find(item => item.id === chunk.id)?.selectionScore,
          overlapDemotion: ranking.ranked.find(item => item.id === chunk.id)?.overlapDemotion,
          identifierMatches: ranking.ranked.find(item => item.id === chunk.id)?.identifierMatches } : {}),
        decision: selected.some(item => item.id === chunk.id) ? 'selected'
          : filtered.some(item => item.id === chunk.id) ? 'budget_or_duplicate_or_document_or_result_cap'
          : relevant.includes(chunk) ? 'identifier_filter' : 'below_threshold' })),
      warnings
    }
  };
}

// Product codes and other mixed alphanumeric identifiers are not interchangeable.
// Apply only when the candidate pool contains an exact identifier match.
function preferIdentifiers(candidates, query) {
  const ids = (String(query).toLowerCase().match(/[a-z0-9_-]+/g) || [])
    .filter(word => /[a-z]/.test(word) && /\d/.test(word));
  if (!ids.length) return candidates;
  const matches = candidates.filter(candidate => {
    const words = new Set(String(candidate.text).toLowerCase().match(/[a-z0-9_-]+/g) || []);
    return ids.some(id => words.has(id));
  });
  return matches.length ? matches : candidates;
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

function selectWithinBudget(candidates, { tokenBudget, maxPerDocument, maxChunks = Number.POSITIVE_INFINITY }) {
  const encoding = getEncoding('cl100k_base');
  const selected = [];
  const perDocument = new Map();
  let usedTokens = 0;

  for (const candidate of candidates) {
    if (selected.length >= maxChunks) break;
    const documentId = Number(candidate.metadata?.documentId);
    const count = perDocument.get(documentId) || 0;
    if (count >= maxPerDocument) continue;
    if (isNearDuplicate(candidate, selected)) continue;

    const tokenCount = encoding.encode(`[${selected.length + 1}] 来源：${candidate.metadata?.documentTitle || '未知文档'}\n${candidate.text || ''}\n\n---\n\n`).length;
    if (usedTokens + tokenCount > tokenBudget) continue;
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
  DEFAULT_POLICY,
  preferIdentifiers,
  configure,
  retrieve,
  buildRetrievalQuery,
  fuseResults,
  selectWithinBudget
};
