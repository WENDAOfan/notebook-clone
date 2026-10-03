// Frozen before ranking implementation or online inspection. Synthetic only.
// Mixed title styles, omitted model codes, comparisons, semantic paraphrases.
const documents = [];
const names = ['澄月工坊', '橙月工坊', '澄悦工坊', '橙悦工坊', '溪石书屋', '溪时书屋',
  '栖石书屋', '栖时书屋', '云汀中心', '云町中心', '芸汀中心', '芸町中心',
  '岚川驿馆', '蓝川驿馆', '岚穿驿馆', '蓝穿驿馆'];
for (const [i, name] of names.entries()) {
  const price = i % 4 === 0 ? '单台成交金额未公开，现有资料不能确认。'
    : `单台成交金额为${31 + i}万元。`;
  documents.push(
    { id: `r${i}-delivery`, title: `交接归档｜${name}｜2026`,
      text: `${name}使用的设备为ZX-62。计划交付日为2026年5月2日，实际签收日期为2026年6月${i + 3}日。保修由实际签收日开始计算。` },
    { id: `r${i}-terms`, title: `${name}服务约定`,
      text: `${name}的设备整机保修${12 + i}个月。正常使用中的部件故障由供应商免费更换，人为损坏需要付费。这份条款没有再次抄写设备型号。` },
    { id: `r${i}-price`, title: `财务摘录（${name}）`,
      text: `${name}项目支出上限为${90 + i}万元，包括运输和培训。${price}项目总额不能代替单台设备价格。` },
    { id: `r${i}-hours`, title: `${name}开放时间`,
      text: `${name}周一至周五每天上午九点至下午五点开放，周六只接待预约。开放时间与设备交付、价格及保修无关。` },
    { id: `r${i}-network`, title: `网络登记-${i + 100}`,
      text: `${name}访客网络的临时口令有效期为${i + 2}小时。口令到期后需要重新领取。禁止用隔壁单位的网络规定代替本站规定。` }
  );
}
documents.push(
  { id: 'recovery', title: '操作手册第七节', text: '若验证手机丢失，可凭预先保存的离线恢复码重新进入账户。恢复码只允许使用一次。' },
  { id: 'cooling', title: '使用提醒', text: '设备散热口被遮挡会触发温度告警。移开遮挡物并等待冷却后才可以重新启动。' },
  { id: 'x10', title: 'ZX-620备用机', text: 'ZX-620设备整机保修60个月，与ZX-62是不同型号，不能相互套用条款。' }
);
const target = (documentId, contains) => ({ id: documentId, documentId, contains });
const q = (id, kind, query, expected, evidenceTargets) => ({ id, split: 'holdout', kind, query, expected,
  evidenceTargets, evidenceDocumentIds: [...new Set(evidenceTargets.map(t => t.documentId))] });
const questions = [
  q('new-delivery', 'answerable', '橙月工坊ZX-62实际哪天签收？', '2026年6月4日。', [target('r1-delivery', '实际签收日期为2026年6月4日')]),
  q('new-terms', 'answerable', '澄悦工坊ZX-62整机保修多久？', '14个月。', [target('r2-terms', '设备整机保修14个月')]),
  q('new-prices', 'answerable', '溪石书屋与溪时书屋ZX-62单台成交金额分别是多少？', '溪石书屋未公开，溪时书屋36万元。', [target('r4-price', '单台成交金额未公开'), target('r5-price', '单台成交金额为36万元')]),
  q('new-comparison', 'answerable', '云汀中心和云町中心的设备实际签收日期分别是什么？', '2026年6月11日和6月12日。', [target('r8-delivery', '实际签收日期为2026年6月11日'), target('r9-delivery', '实际签收日期为2026年6月12日')]),
  q('new-body-only', 'answerable', '栖时书屋访客无线网口令多久失效？', '9小时。', [target('r7-network', '临时口令有效期为9小时')]),
  q('new-semantic', 'answerable', '手机弄丢了，收不到验证消息，还有什么办法登录？', '使用预先保存的离线恢复码，每码一次。', [target('recovery', '凭预先保存的离线恢复码重新进入账户')]),
  q('new-cooling', 'answerable', '机器因为通风被堵出现过热提示，该怎样处理才能开机？', '移开遮挡物，等待冷却再启动。', [target('cooling', '移开遮挡物并等待冷却后才可以重新启动')]),
  q('new-no-prefix', 'answerable', '蓝川驿馆ZX-62实际成交金额是多少？', '44万元。', [target('r13-price', '单台成交金额为44万元')]),
  q('new-cross', 'answerable', '岚穿驿馆ZX-62保修从哪一天起算，持续多久？', '2026年6月17日起26个月。', [target('r14-delivery', '实际签收日期为2026年6月17日'), target('r14-terms', '设备整机保修26个月')]),
  q('new-no-price', 'no_answer', '澄月工坊ZX-62单台成交金额是多少？', '未公开，不能用项目上限代替。', [target('r0-price', '单台成交金额未公开')]),
  q('new-no-price-two', 'no_answer', '云汀中心ZX-62采购单价能确认吗？', '不能确认，单台成交金额未公开。', [target('r8-price', '单台成交金额未公开')]),
  q('new-no-price-three', 'no_answer', '岚川驿馆ZX-62实际买价是多少？', '未公开，不能借用其他驿馆价格。', [target('r12-price', '单台成交金额未公开')])
];
module.exports = { id: 'retrieval-holdout-v1', documents, questions };
