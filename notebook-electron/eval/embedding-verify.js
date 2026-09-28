const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const config = require('../config-service');
const rag = require('../rag-service');
const db = require('../database');
const vectors = require('../vector-store');
const retrieval = require('../retrieval-service');
const fixtures = [
  ['账号安全', '启用双重验证后，手机丢失时可以使用事先保存的离线恢复码重新登录账户。', '验证身份的设备找不到了，怎样重新进入账号？'],
  ['电池说明', '磷酸铁锂电池只能在零摄氏度至四十五摄氏度之间充电，低温环境应暂停充电。', '冬天室外太冷的时候还能给蓄电池补电吗？'],
  ['退款规定', '商品退回验收后，退款将在三个工作日内通过原支付渠道返还。', '寄回的东西检查完了，钱什么时候退到我的支付账户？'],
  ['存储要求', '鲜奶开封后需放在冰箱冷藏，并在两天内饮用完毕。', '没喝完的牛奶怎样保存，多久必须喝掉？'],
  ['交通指南', '机场快线每隔十五分钟发车，末班车于晚上十一点从航站楼出发。', '深夜下飞机后，还有接驳列车回市区吗？'],
  ['培训报名', '参加进阶编程班之前必须通过基础测验，未通过者应先完成入门课程。', '编程初学者能直接去学高级课程吗？']
];
async function main() {
  if (!process.argv.includes('--online')) throw new Error('需要 --online');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedding-verify-'));
  const report = { status: 'RUNNING', startedAt: new Date().toISOString(), cases: [], documents: [] };
  try {
    config.init({ userDataPath: dir });
    const provider = config.requireProvider('zhipu');
    report.model = provider.model || 'embedding-3';
    report.sdkVersion = JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('openai')), 'package.json'), 'utf8')).version;
    report.encodingFormat = 'float';
    await db.init(':memory:'); vectors.init(path.join(dir, 'vectors.json'));
    const nb = await db.createNotebook('语义探针虚构资料', '');
    for (const [title, content] of fixtures) {
      const doc = await db.createDocument(nb.id, title, content, '固定摘要');
      await rag.indexDocumentAsync(doc.id);
      if ((await db.getDocumentById(doc.id)).index_status !== 'ready') throw new Error('索引失败');
      const v = vectors.store.find(v => v.metadata.documentId === doc.id).embedding;
      report.documents.push({ title, dimensions: v.length, norm: Math.hypot(...v) });
    }
    for (const [title, , query] of fixtures) {
      const embedding = await rag.getEmbedding(query);
      const dense = vectors.similaritySearch(embedding, 6);
      const hybrid = await retrieval.retrieve({ scopeType: 'notebook', scopeId: nb.id, query, queryEmbedding: embedding });
      report.cases.push({ title, query, dimensions: embedding.length, norm: Math.hypot(...embedding),
        denseRank: dense.findIndex(c => c.metadata.documentTitle === title) + 1,
        dense: dense.map(c => ({ title: c.metadata.documentTitle, score: c.score })),
        hybridRank: hybrid.sources.findIndex(c => c.documentTitle === title) + 1,
        warnings: hybrid.diagnostics.warnings });
    }
    report.status = report.cases.every(c => c.denseRank === 1 && c.hybridRank <= 3 && c.hybridRank > 0 && !c.warnings.length) ? 'PASS' : 'FAIL';
  } catch (error) { report.status = 'BLOCKED'; report.reason = error.message; }
  finally {
    fs.writeFileSync(path.join(__dirname, 'embedding-verification.json'), JSON.stringify(report, null, 2));
    await db.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
