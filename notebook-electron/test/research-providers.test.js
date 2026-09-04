const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCandidate,
  candidateId,
  isPrivateIp,
  parseArxivEntries,
  validateExternalUrl
} = require('../research-providers');

test('候选来源 ID 稳定，基础字段会被规范化', () => {
  const input = {
    provider: 'crossref',
    title: '  Example   Paper ',
    url: 'https://doi.org/10.1000/XYZ',
    doi: '10.1000/XYZ',
    authors: ['A']
  };
  const first = normalizeCandidate(input);
  const second = normalizeCandidate(input);
  assert.equal(first.id, second.id);
  assert.equal(first.id, candidateId(first));
  assert.equal(first.title, 'Example Paper');
  assert.equal(first.doi, '10.1000/xyz');
});

test('arXiv Atom 响应可解析为候选资料', () => {
  const xml = `<feed><entry>
    <id>http://arxiv.org/abs/2601.12345v1</id>
    <published>2026-01-03T00:00:00Z</published>
    <title>Research &amp; Safety</title>
    <summary>A useful paper.</summary>
    <author><name>Alice</name></author>
  </entry></feed>`;
  const items = parseArxivEntries(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Research & Safety');
  assert.equal(items[0].metadata.arxivId, '2601.12345v1');
});

test('SSRF 防护识别本机、私网和链路本地地址', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.2', '172.16.1.1', '192.168.2.3', '169.254.1.2', '::1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  await assert.rejects(validateExternalUrl('file:///tmp/a'), /HTTP/);
  await assert.rejects(validateExternalUrl('http://127.0.0.1/admin'), /私有|本机/);
  await assert.rejects(validateExternalUrl('http://localhost:8080'), /本机/);
});
