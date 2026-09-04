const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WikipediaProvider,
  CrossrefProvider,
  ArxivProvider
} = require('../research-providers');

test('真实公开接口可返回规范化研究候选', {
  skip: process.env.RUN_ONLINE_RESEARCH_TESTS !== '1',
  timeout: 90_000
}, async () => {
  const controller = new AbortController();
  const providers = [
    new WikipediaProvider(),
    new CrossrefProvider(),
    new ArxivProvider()
  ];
  const results = await Promise.all(providers.map(provider => provider.search({
    query: 'retrieval augmented generation',
    language: 'en',
    filters: {},
    limit: 2,
    signal: controller.signal
  })));
  for (const candidates of results) {
    assert.ok(candidates.length > 0);
    assert.ok(candidates[0].id);
    assert.match(candidates[0].url, /^https?:\/\//);
  }
});
