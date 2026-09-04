const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_CONTENT_CHARS = 120_000;

function candidateId(candidate) {
  const identity = candidate.doi || candidate.url || candidate.title;
  return crypto.createHash('sha256')
    .update(`${candidate.provider}:${String(identity).toLowerCase()}`)
    .digest('hex')
    .slice(0, 24);
}

function normalizeCandidate(candidate) {
  const normalized = {
    id: candidate.id,
    provider: candidate.provider,
    sourceType: candidate.sourceType || 'web',
    title: cleanText(candidate.title) || '未命名来源',
    url: candidate.url || '',
    authors: Array.isArray(candidate.authors) ? candidate.authors.filter(Boolean) : [],
    publishedAt: candidate.publishedAt || null,
    language: candidate.language || 'unknown',
    summary: cleanText(candidate.summary || ''),
    doi: candidate.doi ? String(candidate.doi).toLowerCase() : null,
    license: candidate.license || null,
    relevance: Number(candidate.relevance) || 0,
    metadata: candidate.metadata || {}
  };
  normalized.id = normalized.id || candidateId(normalized);
  return normalized;
}

class WikipediaProvider {
  constructor(fetchImpl = global.fetch) {
    this.name = 'wikipedia';
    this.fetchImpl = fetchImpl;
  }

  async search({ query, language = 'zh', limit = 5, signal }) {
    const lang = language === 'en' ? 'en' : 'zh';
    const endpoint = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    endpoint.searchParams.set('action', 'query');
    endpoint.searchParams.set('list', 'search');
    endpoint.searchParams.set('srsearch', query);
    endpoint.searchParams.set('srlimit', String(Math.min(limit, 10)));
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('origin', '*');
    const data = await fetchJson(endpoint, { signal, fetchImpl: this.fetchImpl });
    return (data.query?.search || []).map((item, index) => normalizeCandidate({
      provider: this.name,
      sourceType: 'encyclopedia',
      title: item.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title.replaceAll(' ', '_'))}`,
      language: lang,
      summary: stripHtml(item.snippet),
      relevance: 1 - index * 0.04,
      license: 'CC BY-SA',
      metadata: { pageId: item.pageid, wordCount: item.wordcount }
    }));
  }

  async fetch(candidate, { signal } = {}) {
    const lang = candidate.language === 'en' ? 'en' : 'zh';
    const endpoint = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    endpoint.searchParams.set('action', 'query');
    endpoint.searchParams.set('prop', 'extracts');
    endpoint.searchParams.set('explaintext', '1');
    endpoint.searchParams.set('exsectionformat', 'plain');
    endpoint.searchParams.set('pageids', String(candidate.metadata?.pageId || ''));
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('origin', '*');
    const data = await fetchJson(endpoint, { signal, fetchImpl: this.fetchImpl });
    const page = Object.values(data.query?.pages || {})[0];
    return buildSourceContent(candidate, page?.extract || candidate.summary, false);
  }
}

class CrossrefProvider {
  constructor(fetchImpl = global.fetch) {
    this.name = 'crossref';
    this.fetchImpl = fetchImpl;
  }

  async search({ query, language = 'en', filters = {}, limit = 5, signal }) {
    const endpoint = new URL('https://api.crossref.org/works');
    endpoint.searchParams.set('query.bibliographic', query);
    endpoint.searchParams.set('rows', String(Math.min(limit, 10)));
    endpoint.searchParams.set('select', 'DOI,title,author,published,URL,abstract,license,score,type');
    const dateFilters = [];
    if (filters.yearFrom) dateFilters.push(`from-pub-date:${filters.yearFrom}-01-01`);
    if (filters.yearTo) dateFilters.push(`until-pub-date:${filters.yearTo}-12-31`);
    if (dateFilters.length) endpoint.searchParams.set('filter', dateFilters.join(','));
    const data = await fetchJson(endpoint, {
      signal,
      fetchImpl: this.fetchImpl,
      headers: { 'User-Agent': 'NotebookClone/1.0 (local research app)' }
    });
    const items = data.message?.items || [];
    const maxScore = Math.max(...items.map(item => Number(item.score) || 0), 1);
    return items.map(item => normalizeCandidate({
      provider: this.name,
      sourceType: item.type || 'academic',
      title: item.title?.[0] || item.DOI,
      url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''),
      authors: (item.author || []).map(author => [author.given, author.family].filter(Boolean).join(' ')),
      publishedAt: crossrefDate(item.published),
      language: item.language || language,
      summary: stripHtml(item.abstract || ''),
      doi: item.DOI,
      license: item.license?.[0]?.URL || null,
      relevance: (Number(item.score) || 0) / maxScore
    }));
  }

  async fetch(candidate, { signal } = {}) {
    return fetchViaJina(candidate, { signal, fetchImpl: this.fetchImpl });
  }
}

class ArxivProvider {
  constructor(fetchImpl = global.fetch) {
    this.name = 'arxiv';
    this.fetchImpl = fetchImpl;
  }

  async search({ query, language = 'en', filters = {}, limit = 5, signal }) {
    const endpoint = new URL('https://export.arxiv.org/api/query');
    endpoint.searchParams.set('search_query', `all:${query}`);
    endpoint.searchParams.set('start', '0');
    endpoint.searchParams.set('max_results', String(Math.min(limit, 10)));
    endpoint.searchParams.set('sortBy', 'relevance');
    const xml = await fetchText(endpoint, {
      signal,
      fetchImpl: this.fetchImpl,
      headers: { 'User-Agent': 'NotebookClone/1.0' }
    });
    return parseArxivEntries(xml)
      .filter(item => inYearRange(item.publishedAt, filters))
      .map((item, index) => normalizeCandidate({
        ...item,
        provider: this.name,
        sourceType: 'preprint',
        language,
        relevance: 1 - index * 0.05
      }));
  }

  async fetch(candidate, { signal } = {}) {
    return fetchViaJina(candidate, { signal, fetchImpl: this.fetchImpl });
  }
}

class ManualUrlProvider {
  constructor(fetchImpl = global.fetch) {
    this.name = 'manual-url';
    this.fetchImpl = fetchImpl;
  }

  async search({ urls = [], signal }) {
    const candidates = [];
    for (const rawUrl of urls.slice(0, 5)) {
      const url = await validateExternalUrl(rawUrl, { signal });
      candidates.push(normalizeCandidate({
        provider: this.name,
        sourceType: 'web',
        title: url.hostname,
        url: url.toString(),
        language: 'unknown',
        summary: '用户指定的网页来源',
        relevance: 1
      }));
    }
    return candidates;
  }

  async fetch(candidate, { signal } = {}) {
    return fetchViaJina(candidate, { signal, fetchImpl: this.fetchImpl });
  }
}

function createDefaultProviders(fetchImpl = global.fetch) {
  return {
    wikipedia: new WikipediaProvider(fetchImpl),
    crossref: new CrossrefProvider(fetchImpl),
    arxiv: new ArxivProvider(fetchImpl),
    'manual-url': new ManualUrlProvider(fetchImpl)
  };
}

async function fetchViaJina(candidate, { signal, fetchImpl = global.fetch } = {}) {
  const target = await validateExternalUrl(candidate.url, { signal });
  const readerUrl = `https://r.jina.ai/${target.toString()}`;
  const text = await fetchText(readerUrl, {
    signal,
    fetchImpl,
    headers: { Accept: 'text/markdown', 'X-Return-Format': 'markdown' }
  });
  const cleaned = text.replace(/^Title:.*?\nURL Source:.*?\n(?:Published Time:.*?\n)?Markdown Content:\s*/s, '');
  return buildSourceContent(candidate, cleaned || candidate.summary, cleaned.length > MAX_CONTENT_CHARS);
}

function buildSourceContent(candidate, content, truncated) {
  const safeContent = String(content || '').slice(0, MAX_CONTENT_CHARS);
  return {
    title: candidate.title,
    content: `> 原始来源：${candidate.url}\n\n${safeContent}`,
    summary: candidate.summary || safeContent.slice(0, 600),
    truncated: Boolean(truncated || String(content || '').length > MAX_CONTENT_CHARS),
    fetchedAt: new Date().toISOString()
  };
}

async function fetchJson(url, options = {}) {
  return JSON.parse(await fetchText(url, options));
}

async function fetchText(url, {
  signal,
  fetchImpl = global.fetch,
  headers = {},
  timeoutMs = 30_000,
  maxRedirects = 5
} = {}) {
  let current = new URL(url);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetchImpl(current, {
      signal: combinedSignal,
      redirect: 'manual',
      headers
    });
    if (response.status >= 300 && response.status < 400) {
      if (redirect === maxRedirects) throw new Error('网络请求重定向次数过多');
      const location = response.headers.get('location');
      if (!location) throw new Error('网络请求返回无效重定向');
      current = new URL(location, current);
      await validateExternalUrl(current, { signal: combinedSignal });
      continue;
    }
    if (!response.ok) throw new Error(`网络请求失败（HTTP ${response.status}）`);
    const declaredSize = Number(response.headers.get('content-length')) || 0;
    if (declaredSize > MAX_RESPONSE_BYTES) throw new Error('来源响应体超过 5 MB 限制');
    const buffer = await readLimitedBody(response, MAX_RESPONSE_BYTES);
    return buffer.toString('utf8');
  }
  throw new Error('网络请求失败');
}

async function readLimitedBody(response, maximumBytes) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maximumBytes) throw new Error('来源响应体超过 5 MB 限制');
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('来源响应体超过 5 MB 限制');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function validateExternalUrl(rawUrl, { signal } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('无效的来源 URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('来源 URL 只允许 HTTP 或 HTTPS');
  }
  if (url.username || url.password) throw new Error('来源 URL 不允许包含登录凭据');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('禁止访问本机地址');
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('禁止访问私有或链路本地地址');
  } else {
    const addresses = await dns.lookup(hostname, { all: true, signal }).catch(() => []);
    if (addresses.some(item => isPrivateIp(item.address))) {
      throw new Error('来源域名解析到私有或链路本地地址');
    }
  }
  return url;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10
      || a === 127
      || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const value = ip.toLowerCase();
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isPrivateIp(mapped);
    return value === '::1'
      || value === '::'
      || value.startsWith('fc')
      || value.startsWith('fd')
      || value.startsWith('fe8')
      || value.startsWith('fe9')
      || value.startsWith('fea')
      || value.startsWith('feb')
      || value.startsWith('ff');
  }
  return true;
}

function parseArxivEntries(xml) {
  const entries = [];
  for (const match of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = match[1];
    const id = tagValue(block, 'id').split('/').pop();
    const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
      .map(author => decodeXml(author[1]).trim());
    entries.push({
      title: decodeXml(tagValue(block, 'title')).replace(/\s+/g, ' ').trim(),
      url: `https://arxiv.org/pdf/${id}`,
      authors,
      publishedAt: tagValue(block, 'published') || null,
      summary: decodeXml(tagValue(block, 'summary')).replace(/\s+/g, ' ').trim(),
      metadata: { arxivId: id }
    });
  }
  return entries;
}

function tagValue(text, tag) {
  return text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() || '';
}

function decodeXml(text) {
  return String(text)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function crossrefDate(value) {
  const parts = value?.['date-parts']?.[0];
  if (!parts?.length) return null;
  return `${parts[0]}-${String(parts[1] || 1).padStart(2, '0')}-${String(parts[2] || 1).padStart(2, '0')}`;
}

function inYearRange(date, filters = {}) {
  const year = Number(String(date || '').slice(0, 4));
  if (!year) return true;
  return (!filters.yearFrom || year >= Number(filters.yearFrom))
    && (!filters.yearTo || year <= Number(filters.yearTo));
}

function stripHtml(text) {
  return decodeXml(String(text || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function cleanText(text) {
  return String(text || '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = {
  WikipediaProvider,
  CrossrefProvider,
  ArxivProvider,
  ManualUrlProvider,
  createDefaultProviders,
  normalizeCandidate,
  candidateId,
  fetchText,
  validateExternalUrl,
  isPrivateIp,
  parseArxivEntries,
  MAX_CONTENT_CHARS
};
