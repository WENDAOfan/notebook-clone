const test = require('node:test');
const assert = require('node:assert/strict');
const { applicationPolicy } = require('../retrieval-runtime-policy');
const { DEFAULT_POLICY } = require('../retrieval-service');
const { loadSuite } = require('../eval/production-cases');

test('库保持离线默认，桌面配置就绪时采用已验证紧凑重排', () => {
  assert.equal(DEFAULT_POLICY.rerank, false);
  assert.deepEqual(applicationPolicy({}, { deepseekReady: true }), { ...DEFAULT_POLICY, rerank: true });
  assert.deepEqual(applicationPolicy({ retrieval: { rerank: true } }, { deepseekReady: true }), { ...DEFAULT_POLICY, rerank: true });
  assert.equal(applicationPolicy().rerank, false);
  assert.equal(applicationPolicy({ retrieval: { rerank: true } }, { deepseekReady: false }).rerank, false);
});

test('应用尊重显式关闭设置，非法字符串不意外开启模型调用', () => {
  assert.equal(applicationPolicy({ retrieval: { rerank: false } }, { deepseekReady: true }).rerank, false);
  assert.equal(applicationPolicy({ retrieval: { rerank: 'false' } }, { deepseekReady: true }).rerank, false);
});

test('独立确认题冻结，不能在看到结果后改成容易题', () => {
  assert.equal(loadSuite('semantic-confirm').sha256, '2d1e57f77311dbd60ff69984ab1ff8f9df6e3f68cdacee31e5c372c57b4573f3');
  assert.equal(loadSuite('paragraph-confirm').sha256, '379568fe9f66be7b18832976f843943eb86e4ecbff8590db5ba6d87a6527d994');
});
