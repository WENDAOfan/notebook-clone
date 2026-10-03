const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreSentenceContext } = require('../retrieval-context');
const { selectWithinBudget } = require('../retrieval-service');
const { loadSuite } = require('../eval/production-cases');
const candidate = text => ({ id: 'chunk-1', text, metadata: { documentId: 1, documentTitle: '资料' } });

test('补齐被截断的首尾句，正文是同一原文的连续区间，ID不变', () => {
  const content = '无关前句。本站设备正常使用故障免费维修20个月；进水不适用。下一句内容。';
  const chunk = candidate('设备正常使用故障免费维修20个月；进水');
  const before = structuredClone(chunk);
  const result = restoreSentenceContext(chunk, { id: 1, content });
  assert.equal(result.text, '本站设备正常使用故障免费维修20个月；进水不适用。');
  assert.equal(result.id, chunk.id);
  assert.deepEqual(chunk, before);
  assert.equal(content.slice(result.contextWindow.start, result.contextWindow.end), result.text);
  assert.equal(result.contextWindow.status, 'expanded');
});

test('匹配缺失、歧义或跨文档时不猜测上下文', () => {
  const chunk = candidate('共同片段');
  for (const [doc, reason] of [[{ id: 1, content: '没有相同文本' }, 'no_exact_match'],
    [{ id: 1, content: '甲共同片段。乙共同片段。' }, 'ambiguous_match'],
    [{ id: 2, content: '机密共同片段。' }, 'document_not_in_scope']]) {
    const result = restoreSentenceContext(chunk, doc);
    assert.equal(result.text, chunk.text);
    assert.equal(result.contextWindow.reason, reason);
  }
});

test('长句、过大扩展和小数边界不引入无限上下文', () => {
  const chunk = candidate('唯一片段');
  const long = restoreSentenceContext(chunk, { id: 1, content: '前'.repeat(400) + chunk.text + '后'.repeat(400) });
  assert.equal(long.text, chunk.text);
  const limited = restoreSentenceContext(chunk, { id: 1, content: '前文很长。开头' + chunk.text + '结尾。' }, { maxExtraTokens: 1 });
  assert.equal(limited.contextWindow.reason, 'extension_token_limit');
  const decimal = restoreSentenceContext(candidate('14元'), { id: 1, content: '价格是3.14元。' });
  assert.equal(decimal.text, '价格是3.14元。');
});

test('扩展后的正文必须计入证据预算，不能用原块长度绕过上限', () => {
  const result = restoreSentenceContext(candidate('退款'), { id: 1, content: '需要核对申请人与购买记录后才能退款，审核期间不得重复提交。' });
  assert.ok(result.contextWindow.addedTokens > 0);
  assert.deepEqual(selectWithinBudget([result], { tokenBudget: 10, maxPerDocument: 3 }), []);
});

test('句边界独立新题保持固定，不改题抬分', () => {
  const suite = loadSuite('boundary-holdout');
  assert.equal(suite.sha256, 'e7e9ac3d579dfb9d5c9d097deb5a67e6fdbe837bd58d1c6d83d9939300f14128');
  assert.equal(suite.data.documents.length, 8);
  assert.equal(suite.data.questions.length, 12);
});
