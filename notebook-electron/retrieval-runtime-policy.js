const { DEFAULT_POLICY } = require('./retrieval-service');

// Desktop opts into the validated compact reranker when its provider is ready.
// Importing the library or running offline tests must never start model calls.
function applicationPolicy(settings = {}, readiness = {}) {
  const requested = settings.retrieval?.rerank;
  return { ...DEFAULT_POLICY,
    rerank: readiness.deepseekReady === true && (requested === undefined || requested === true) };
}

module.exports = { applicationPolicy };
