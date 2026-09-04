const test = require('node:test');
const assert = require('node:assert/strict');
const { getEncoding } = require('js-tiktoken');

const { splitTextIntoChunks } = require('../rag-service');

test('超长无标点单句也不会超过 chunkSize', () => {
  const input = '超长句子'.repeat(300);
  const chunks = splitTextIntoChunks(input, 128, 16);
  const encoding = getEncoding('cl100k_base');

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(encoding.encode(chunk).length <= 128);
  }
});

test('分块保留段落语义且不产生空块', () => {
  const chunks = splitTextIntoChunks('第一段内容。\n\n第二段内容。\n\n第三段内容。', 32, 4);
  assert.ok(chunks.length >= 1);
  assert.ok(chunks.every(chunk => chunk.trim().length > 0));
  assert.match(chunks.join('\n'), /第一段内容/);
  assert.match(chunks.join('\n'), /第三段内容/);
});
