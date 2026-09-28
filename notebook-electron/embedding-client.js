function isValidEmbedding(vector) {
  return Array.isArray(vector) && vector.length > 0 && vector.every(Number.isFinite)
    && vector.some(value => value !== 0) && Number.isFinite(Math.hypot(...vector));
}

async function invalidateCorruptIndexes(chunks, markStale) {
  const ids = new Set(chunks.filter(chunk => !isValidEmbedding(chunk.embedding))
    .map(chunk => Number(chunk.metadata?.documentId)).filter(Number.isSafeInteger));
  for (const id of ids) await markStale(id);
}

function validateEmbeddings(response, count) {
  if (!Array.isArray(response?.data) || response.data.length !== count) throw new Error('Embedding响应数量不匹配');
  const items = [...response.data].sort((a, b) => a.index - b.index);
  let dimensions;
  return items.map((item, index) => {
    if (item.index !== index) throw new Error('Embedding响应索引无效');
    const vector = item.embedding;
    if (!isValidEmbedding(vector)) {
      throw new Error('Embedding向量无效：必须为非零有限浮点数组');
    }
    dimensions ??= vector.length;
    if (vector.length !== dimensions) throw new Error('Embedding维度不一致');
    return vector;
  });
}

async function requestEmbeddings(client, provider, input, signal) {
  const response = await client.embeddings.create({
    model: provider.model || 'embedding-3',
    input,
    encoding_format: 'float'
  }, { signal });
  return validateEmbeddings(response, Array.isArray(input) ? input.length : 1);
}

module.exports = { requestEmbeddings, validateEmbeddings, invalidateCorruptIndexes };
