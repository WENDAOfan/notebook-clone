const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../database');
const vectors = require('../vector-store');
const config = require('../config-service');
const rag = require('../rag-service');
const cases = require('./grounding-cases.json');
async function main() {
  if (!process.argv.includes('--online')) throw new Error('需显式传入 --online');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-eval-'));
  const report = { status: 'RUNNING', cases: [], startedAt: new Date().toISOString(),
    codeHash: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../answer-policy.js'))).update(fs.readFileSync(path.join(__dirname, '../rag-service.js'))).digest('hex'),
    datasetHash: crypto.createHash('sha256').update(JSON.stringify(cases)).digest('hex') };
  const save = () => fs.writeFileSync(path.join(__dirname, 'grounding-report.json'), JSON.stringify(report, null, 2));
  try {
    const status = config.init({ userDataPath: dir });
    if (!status.deepseekReady || !status.zhipuReady) throw new Error('模型配置缺失');
    report.models = { chat: config.getConfig().deepseek.model || 'deepseek-chat', embedding: config.getConfig().zhipu.model || 'embedding-3' };
    await db.init(':memory:'); vectors.init(path.join(dir, 'vectors.json'));
    const nb = await db.createNotebook('事实边界专项虚构资料', '');
    for (const c of cases) {
      const doc = await db.createDocument(nb.id, c.id, c.text, '固定测试摘要');
      await rag.indexDocumentAsync(doc.id);
      if ((await db.getDocumentById(doc.id)).index_status !== 'ready') throw new Error('索引失败');
      const start = Date.now();
      const result = { ...c, answer: '', sources: [], error: null };
      await rag.handleAskStream({ sender: { isDestroyed: () => false, send(channel, data) {
        if (channel === 'chat:chunk') result.answer += data.text;
        if (channel === 'chat:sources') { result.sources = structuredClone(data.sources); result.diagnostics = structuredClone(data.diagnostics); }
        if (channel === 'chat:error') result.error = data.message;
      } } }, { id: doc.id, type: 'doc', question: c.question, useDocContext: true });
      result.elapsedMs = Date.now() - start;
      report.cases.push(result); save(); console.log(c.id, result.answer);
    }
    report.status = 'AWAITING_REVIEW';
  } catch (error) {
    report.status = 'BLOCKED'; report.error = error.message; process.exitCode = 1;
  } finally {
    save(); await db.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
