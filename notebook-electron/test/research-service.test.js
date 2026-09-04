const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const researchService = require('../research-service');

function candidate(id, provider = 'wikipedia') {
  return {
    id,
    provider,
    sourceType: 'academic',
    title: `资料 ${id}`,
    url: `https://example.org/${id}`,
    authors: ['作者'],
    publishedAt: '2026-01-01',
    language: id.endsWith('en') ? 'en' : 'zh',
    summary: `关于研究主题的公开摘要 ${id}，包含足够的候选说明。`,
    doi: provider === 'crossref' ? `10.1000/${id}` : null,
    relevance: 0.8
  };
}

function fakeProvider(name, candidates) {
  return {
    name,
    async search() {
      return candidates.filter(item => item.provider === name);
    },
    async fetch(item) {
      return {
        content: `${item.title}\n\n这是已经清理的公开正文。`,
        truncated: false
      };
    }
  };
}

function fakeWebContents() {
  const events = [];
  const waiters = [];
  return {
    events,
    isDestroyed: () => false,
    send(channel, event) {
      events.push({ channel, ...event });
      for (const waiter of [...waiters]) {
        if (waiter.predicate(channel, event)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(event);
        }
      }
    },
    waitFor(type) {
      const existing = events.find(event => event.channel === 'research:event' && event.type === type);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), 2000);
        waiters.push({
          predicate: (channel, event) => {
            if (channel !== 'research:event' || event.type !== type) return false;
            clearTimeout(timer);
            return true;
          },
          resolve
        });
      });
    }
  };
}

test.before(async () => {
  await db.init(':memory:');
});

test.after(async () => {
  researchService.resetConfiguration();
  await db.close();
});

test('DOI、规范 URL 和标题按三级规则去重并确定性排序', () => {
  const base = candidate('a', 'crossref');
  const sameDoi = { ...candidate('b', 'crossref'), doi: base.doi, relevance: 0.95 };
  const sameUrl = { ...candidate('c'), url: 'https://example.org/a?utm_source=test' };
  const ranked = researchService.rankAndDedupe([base, sameDoi, sameUrl], researchService.normalizeFilters());
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'b');
});

test('快速研究只生成预览，确认后才事务创建研究笔记本', async () => {
  const candidates = [
    candidate('zh-1'),
    candidate('en-2', 'crossref'),
    candidate('en-3', 'arxiv'),
    candidate('zh-4'),
    candidate('en-5', 'crossref')
  ];
  const indexed = [];
  researchService.configure({
    providers: [
      fakeProvider('wikipedia', candidates),
      fakeProvider('crossref', candidates),
      fakeProvider('arxiv', candidates),
      fakeProvider('manual-url', [])
    ],
    expandQueries: async topic => [
      { query: topic, language: 'zh' },
      { query: topic, language: 'en' }
    ],
    generateGuide: async () => '# 研究导读\n\n发现 [1]、[2]、[3]。',
    indexDocumentAsync: async id => indexed.push(id)
  });

  const web = fakeWebContents();
  await researchService.start(web, {
    requestId: 'research-test-1',
    topic: '测试主题',
    mode: 'fast',
    filters: {},
    manualUrls: []
  });
  const selection = await web.waitFor('selection-ready');
  assert.equal(selection.data.candidates.length, 5);
  assert.equal((await db.getAllNotebooks()).length, 0);

  await researchService.createNotebook(web, {
    requestId: 'research-test-1',
    title: '自动研究笔记本',
    candidateIds: selection.data.candidates.slice(0, 3).map(item => item.id)
  });
  const created = await web.waitFor('notebook-created');
  const notebooks = await db.getAllNotebooks();
  const documents = await db.getDocumentsByNotebook(created.data.notebook.id);
  assert.equal(notebooks.length, 1);
  assert.equal(notebooks[0].origin, 'research');
  assert.equal(documents.filter(item => item.origin === 'research-source').length, 3);
  assert.equal(documents.filter(item => item.origin === 'research-guide').length, 1);
  assert.equal(indexed.length, 4);
  assert.equal((await db.getResearchRun('research-test-1')).status, 'completed');
});

test('少于三个来源时拒绝创建且不产生半成品', async () => {
  await db.createResearchRun({
    id: 'research-too-few',
    topic: '不足来源',
    mode: 'fast',
    status: 'awaiting_selection',
    candidates: [candidate('only-1'), candidate('only-2')]
  });
  await assert.rejects(
    researchService.createNotebook(fakeWebContents(), {
      requestId: 'research-too-few',
      candidateIds: ['only-1', 'only-2']
    }),
    /3–15/
  );
  assert.equal((await db.getAllNotebooks()).length, 1);
});

test('深度研究使用受限研究循环并默认选择前八个来源', async () => {
  const deepCandidates = Array.from({ length: 10 }, (_, index) =>
    candidate(`deep-${index + 1}`, index % 2 ? 'crossref' : 'arxiv')
  );
  let deepRunnerCalled = false;
  researchService.configure({
    providers: [
      fakeProvider('wikipedia', deepCandidates),
      fakeProvider('crossref', deepCandidates),
      fakeProvider('arxiv', deepCandidates),
      fakeProvider('manual-url', [])
    ],
    deepRunner: async ({ topic, search }) => {
      deepRunnerCalled = true;
      assert.equal(topic, '深度主题');
      await search({ query: 'deep topic', language: 'en', sourceTypes: ['crossref', 'arxiv'] });
      return deepCandidates;
    }
  });
  const web = fakeWebContents();
  await researchService.start(web, {
    requestId: 'research-deep-test',
    topic: '深度主题',
    mode: 'deep',
    filters: {},
    manualUrls: []
  });
  const selection = await web.waitFor('selection-ready');
  assert.equal(deepRunnerCalled, true);
  assert.equal(selection.data.candidates.length, 10);
  assert.equal(selection.data.defaultSelectedIds.length, 8);
});
