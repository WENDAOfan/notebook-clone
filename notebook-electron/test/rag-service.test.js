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

test('中文重叠切块不引入原文没有的 UTF-8 替换字符', () => {
  const document = require('../eval/long-cases').documents.find(item => item.id === 'star-ops');
  assert.ok(!document.text.includes('\uFFFD'));
  const chunks = splitTextIntoChunks(document.text, 512, 50);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every(chunk => !chunk.includes('\uFFFD')));
  const encoding = getEncoding('cl100k_base');
  assert.ok(chunks.every(chunk => encoding.encode(chunk).length <= 512));
  const plan = require('../eval/long-cases').documents.find(item => item.id === 'drill-plan');
  const planChunks = splitTextIntoChunks(plan.text, 512, 50);
  assert.ok(planChunks.filter(chunk => chunk.includes('演练计划P-19')).length >= 2,
    '重叠片段应保留完整的首个汉字，而不是从字节中间开始');
});

test('修正 Unicode 边界后仍保留分块前后的唯一记录标记', () => {
  const markers = Array.from({ length: 60 }, (_, index) => `【记录${String(index).padStart(3, '0')}】`);
  const input = markers.map(marker => `${marker}星河站备用设备每周完成一次例行巡检，记录人确认外壳、接口与状态灯。`).join('\n\n');
  const chunks = splitTextIntoChunks(input, 128, 16);
  assert.ok(chunks.length > 1);
  for (const marker of markers) assert.ok(chunks.some(chunk => chunk.includes(marker)), marker);
  assert.ok(chunks.every(chunk => !chunk.includes('\uFFFD')));
});
