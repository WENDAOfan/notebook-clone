const crypto = require('node:crypto');

const DATASET_SHA256 = '6691483d440c931ed7d00120d419361fafe61bf35fc29e89adc37e999a56504d';
const SAMPLE_IDS = [254, 161, 127];
const SAMPLE_SEED = 'rgb-mini-v1:';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseJsonl(text) {
  return String(text).split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`RGB JSONL 第 ${index + 1} 条无法解析：${error.message}`);
    }
  });
}

function eligible(row) {
  const answer = row?.answer?.[0];
  return Array.isArray(row.answer) && row.answer.length === 1
    && typeof answer === 'string' && answer.length >= 2
    && typeof row.query === 'string' && row.query.length >= 8 && row.query.length <= 60
    && Array.isArray(row.positive) && typeof row.positive[0] === 'string'
    && row.positive[0].includes(answer)
    && Array.isArray(row.negative) && row.negative.length >= 4
    && row.negative.slice(0, 4).every(text => typeof text === 'string' && !text.includes(answer));
}

function selectSamples(rows) {
  const selected = rows.filter(eligible).sort((left, right) =>
    sha256(`${SAMPLE_SEED}${left.id}`).localeCompare(sha256(`${SAMPLE_SEED}${right.id}`))
  ).slice(0, SAMPLE_IDS.length);
  if (selected.length !== SAMPLE_IDS.length || selected.some((item, index) => item.id !== SAMPLE_IDS[index])) {
    throw new Error(`RGB 样本选择与固定清单不符；预期 ${SAMPLE_IDS.join(', ')}`);
  }
  return selected;
}

function makeVariants(row) {
  if (!eligible(row)) throw new Error(`RGB 样本 ${row?.id} 不满足首批选择条件`);
  const variants = [
    { type: 'answerable', passages: [{ role: 'positive', text: row.positive[0] }, ...row.negative.slice(0, 3).map(text => ({ role: 'negative', text }))] },
    { type: 'no_answer', passages: row.negative.slice(0, 4).map(text => ({ role: 'negative', text })) }
  ];
  return variants.map(variant => {
    const id = `zh_refine-${row.id}-${variant.type}`;
    const documents = variant.passages.map((passage, index) => ({ ...passage, sortKey: sha256(`${id}:${index}`) }))
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
      .map(({ role, text }, index) => ({ role, text, title: `资料${index + 1}` }));
    return { id, datasetId: row.id, type: variant.type, query: row.query, expectedAnswers: row.answer, documents };
  });
}

function assess(caseData, result, positiveDocumentId) {
  const answer = String(result.answer || '');
  const sources = result.sources || [];
  const citations = [...answer.matchAll(/[\[【](\d+)[\]】]/g)].map(match => Number(match[1]));
  const known = new Set(sources.map(source => source.citationId));
  return {
    expectedStringPresent: caseData.type === 'answerable'
      ? caseData.expectedAnswers.some(value => typeof value === 'string' && answer.includes(value)) : null,
    labeledPositivePassageInTop5: caseData.type === 'answerable'
      ? sources.slice(0, 5).some(source => Number(source.documentId) === Number(positiveDocumentId)) : null,
    hasCitation: citations.length > 0,
    citationIdsValid: citations.every(id => known.has(id)),
    refusalHeuristic: caseData.type === 'no_answer'
      ? /未找到|无法找到|没有|未提供|缺少|无法确定|不能确定|无相关|不包含|无法回答|没有提到|未提及/.test(answer)
        && !caseData.expectedAnswers.some(value => typeof value === 'string' && answer.includes(value)) : null
  };
}

module.exports = { DATASET_SHA256, SAMPLE_IDS, sha256, parseJsonl, eligible, selectSamples, makeVariants, assess };
