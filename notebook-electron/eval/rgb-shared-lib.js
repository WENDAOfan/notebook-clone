const { DATASET_SHA256, eligible, sha256 } = require('./rgb-mini-lib');

// Fixed before this run. ID 58 has a broader question than its positive passage;
// ID 205 is retained only as answerable because its negative passage leaks an alias.
const ANSWERABLE_IDS = [161, 127, 101, 126, 111, 153, 242, 251, 135, 205,
  12, 247, 136, 221, 4, 67, 105, 86, 117, 232];
const NO_ANSWER_IDS = [233, 69, 259, 56, 288, 196, 116, 106, 218, 173];
const NO_ANSWER_ALIASES = {
  233: ['希普金斯', 'Hipkins'], 69: ['457万'], 259: ['3月14日', 'March 14'],
  56: ['13657', '6.8亿吨'], 288: ['5月30日', 'May 30'], 196: ['兔圆圆'],
  116: ['42.21'], 106: ['穆尔穆', 'Murmu'], 218: ['孟买', 'Mumbai'],
  173: ['厦门', 'Xiamen']
};

function buildSharedCorpus(rows, { answerableIds = ANSWERABLE_IDS, noAnswerIds = NO_ANSWER_IDS,
  answerAliases = NO_ANSWER_ALIASES } = {}) {
  const byId = new Map(rows.map(row => [Number(row.id), row]));
  const ids = [...answerableIds, ...noAnswerIds];
  if (new Set(ids).size !== ids.length) throw new Error('共享测试题目 ID 重复');

  const seenTexts = new Set();
  const documents = [];
  const queries = [];
  const addDocument = (datasetId, role, text) => {
    if (typeof text !== 'string' || !text.trim()) throw new Error(`RGB ${datasetId} 有空文档`);
    const textHash = sha256(text);
    if (seenTexts.has(textHash)) return false;
    seenTexts.add(textHash);
    documents.push({ datasetId, role, text, textHash, title: `资料${documents.length + 1}` });
    return true;
  };

  for (const id of answerableIds) {
    const row = byId.get(Number(id));
    if (!eligible(row)) throw new Error(`RGB 有答案题 ${id} 不满足基本条件`);
    if (!addDocument(id, 'positive', row.positive[0])) throw new Error(`RGB ${id} 正例文档重复`);
    let negatives = 0;
    for (const text of row.negative) {
      if (negatives === 3) break;
      if (addDocument(id, 'negative', text)) negatives += 1;
    }
    if (negatives !== 3) throw new Error(`RGB ${id} 不足 3 篇唯一负例文档`);
    queries.push({ datasetId: id, type: 'answerable', query: row.query, expectedAnswers: row.answer,
      positiveTextHash: sha256(row.positive[0]) });
  }

  for (const id of noAnswerIds) {
    const row = byId.get(Number(id));
    if (!eligible(row)) throw new Error(`RGB 无答案题 ${id} 不满足基本条件`);
    const negative = row.negative.find(text => typeof text === 'string' && !seenTexts.has(sha256(text)));
    if (!negative || !addDocument(id, 'negative', negative)) throw new Error(`RGB ${id} 没有唯一负例文档`);
    queries.push({ datasetId: id, type: 'no_answer', query: row.query, expectedAnswers: row.answer,
      positiveTextHash: null });
  }

  for (const query of queries.filter(item => item.type === 'no_answer')) {
    const labels = [...query.expectedAnswers, ...(answerAliases[query.datasetId] || [])];
    const leaked = documents.filter(doc => labels.some(label =>
      doc.text.toLowerCase().includes(label.toLowerCase())));
    if (leaked.length) throw new Error(`RGB ${query.datasetId} 无答案题的答案或别称出现在共享资料：${leaked.map(doc => doc.datasetId).join(', ')}`);
  }
  const expectedDocumentCount = answerableIds.length * 4 + noAnswerIds.length;
  if (documents.length !== expectedDocumentCount) throw new Error('共享语料的文档数量与固定协议不符');

  const corpusHash = sha256(JSON.stringify(documents.map(doc => [doc.datasetId, doc.role, doc.textHash])));
  return { datasetSha256: DATASET_SHA256, answerableIds, noAnswerIds, corpusHash, documents, queries };
}

function rankOfDocument(sources, documentId) {
  const index = sources.findIndex(source => Number(source.documentId) === Number(documentId));
  return index < 0 ? null : index + 1;
}

function summarizeRetrieval(cases) {
  const answerable = cases.filter(item => item.type === 'answerable' && !item.error);
  const ranks = answerable.map(item => item.direct?.positiveRank ?? null);
  return {
    answerable: answerable.length,
    recallAt1: ranks.filter(rank => rank === 1).length / (answerable.length || 1),
    recallAt5: ranks.filter(rank => rank !== null && rank <= 5).length / (answerable.length || 1),
    mrr: ranks.reduce((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / (answerable.length || 1)
  };
}

module.exports = { ANSWERABLE_IDS, NO_ANSWER_IDS, NO_ANSWER_ALIASES,
  buildSharedCorpus, rankOfDocument, summarizeRetrieval };
