// Frozen before the first online run. Eighty fictional, closely related documents
// test whether a shared notebook can distinguish one-character site names and
// explicit unknowns. Do not edit the questions or evidence after seeing results.
const sites = [];
for (const first of ['松', '枫', '柏', '榆']) {
  for (const second of ['岚', '蓝']) {
    for (const direction of ['东', '西']) {
      const index = sites.length;
      sites.push({
        id: `s${String(index).padStart(2, '0')}`,
        name: `${first}${second}${direction}站`,
        index,
        plannedDay: index + 1,
        signedDay: index + 4,
        warrantyMonths: [12, 18, 24][index % 3],
        budgetCap: Number((24 + (index % 4) * 1.5).toFixed(1)),
        unitPrice: [0, 5, 10, 15].includes(index) ? null : (14 + (index % 7) * 0.6).toFixed(1),
        incident: ['pending', 'paid-repair', 'false-alarm', 'replaced'][index % 4],
        ceremony: ['unconfirmed', 'held', 'cancelled'][index % 3]
      });
    }
  }
}

function documentsFor(site) {
  const prefix = `${site.id}-`;
  const acceptance = `${site.name}的MP-42泵站改造排期表写的是2025年4月${site.plannedDay}日完工，排期不等于验收。三方验收单最终签字日期为2025年4月${site.signedDay}日。设备交接编号${site.id.toUpperCase()}-A，各站独立归档；保修起算只看本站签字单。`;
  const policy = `${site.name}采购合同第九条约定：MP-42主泵整机保修${site.warrantyMonths}个月，自本站三方验收签字日起算。控制器属于交付清单，但不因此自动获得相同的主泵整机条款。不同站点的期限不得互相借用。`;
  const incident = {
    pending: `${site.name}的MP-42主泵在2026年1月20日出现非人为绕组故障。设备组只提交免费换新申请；截至2026年3月31日没有供应商完成更换的交接记录。提出申请不等于已经换好。`,
    'paid-repair': `${site.name}的MP-42驱动器因人为改线损坏。供应商于2026年2月${site.index + 3}日完成收费维修；没有免费换新主泵。故障对象是驱动器，不是可以随意替换的整机。`,
    'false-alarm': `${site.name}在2026年1月20日发生控制柜误报警。现场复位后主泵运行正常，工单结论为未发现主泵故障；没有换新申请。报警时间不能作为损坏证据。`,
    replaced: `${site.name}的MP-42主泵发生非人为轴承故障。供应商于2026年2月${site.index + 5}日完成免费换新，交接单已签字；这不是仍停留在申请阶段。`
  }[site.incident];
  const drillPrefix = `${site.name}的切换演练原定2025年9月${site.index + 6}日，演练于2025年10月${site.index + 2}日实际完成。`;
  const drill = drillPrefix + {
    unconfirmed: '启动仪式只在方案中提出，复盘没有记录是否举行；不能把缺记录说成明确取消。',
    held: '复盘与签到表一致记载：启动仪式在切换演练前实际举行。',
    cancelled: '复盘明确写明启动仪式因天气取消；切换演练仍按上述日期完成。'
  }[site.ceremony];
  const budget = site.unitPrice === null
    ? `${site.name}采购预算上限${site.budgetCap}万元，覆盖设备、安装与培训。单台主泵成交价被遮盖，现有材料无法确认实际采购单价。预算总额不是单台价格，不能借用相近站点的发票。`
    : `${site.name}最终发票列出MP-42主泵实际采购单价${site.unitPrice}万元；采购预算上限${site.budgetCap}万元，另含安装与培训。预算上限不是单台成交价，其他站点的发票不适用于本站。`;
  return [
    { id: `${prefix}acceptance`, title: `${site.name}工程验收单`, text: acceptance },
    { id: `${prefix}policy`, title: `${site.name}主泵保修条款`, text: policy },
    { id: `${prefix}incident`, title: `${site.name}故障处理工单`, text: incident },
    { id: `${prefix}drill`, title: `${site.name}切换演练复盘`, text: drill },
    { id: `${prefix}budget`, title: `${site.name}预算与采购摘录`, text: budget }
  ];
}

const documents = sites.flatMap(documentsFor);
const target = (id, documentId, contains) => ({ id, documentId, contains });
const q = (id, split, kind, query, expected, evidenceTargets) => ({ id, split, kind, query, expected,
  evidenceDocumentIds: [...new Set(evidenceTargets.map(item => item.documentId))], evidenceTargets });

const questions = [
  q('dense-songlan-east-acceptance', 'calibration', 'answerable',
    '松岚东站MP-42最终哪天验收？4月1日又是什么日期？',
    '2025年4月4日签字验收；4月1日只是排期表中的预计完工日。',
    [target('signed', 's00-acceptance', '三方验收单最终签字日期为2025年4月4日')]),
  q('dense-songblue-east-warranty', 'calibration', 'answerable',
    '松蓝东站MP-42主泵整机保修多久？不要用松岚东站的合同。',
    '松蓝东站自本站验收签字日起保修24个月。',
    [target('warranty', 's02-policy', 'MP-42主泵整机保修24个月')]),
  q('dense-songblue-west-price', 'calibration', 'answerable',
    '松蓝西站MP-42主泵的实际采购单价是多少？',
    '最终发票列出的单价是15.8万元；预算上限不是单价。',
    [target('known-price', 's03-budget', 'MP-42主泵实际采购单价15.8万元')]),
  q('dense-songlan-east-price', 'calibration', 'no_answer',
    '松岚东站MP-42主泵实际采购单价是多少？',
    '现有资料没有披露实际单价；24万元是项目预算上限，不能当成单价。',
    [target('hidden-price', 's00-budget', '现有材料无法确认实际采购单价')]),
  q('dense-two-song-prices', 'calibration', 'answerable',
    '松蓝西站与松岚东站的MP-42主泵实际采购单价各是多少？',
    '松蓝西站15.8万元；松岚东站没有可确认的实际单价。',
    [target('known-price', 's03-budget', 'MP-42主泵实际采购单价15.8万元'),
      target('hidden-price', 's00-budget', '现有材料无法确认实际采购单价')]),
  q('dense-maplelan-east-status', 'calibration', 'answerable',
    '枫岚东站主泵的免费换新是已经完成，还是只提交申请？',
    '只提交了申请，截至2026年3月31日没有完成更换的交接记录。',
    [target('pending', 's04-incident', '截至2026年3月31日没有供应商完成更换的交接记录')]),
  q('dense-mapleblue-west-replaced', 'calibration', 'answerable',
    '枫蓝西站的MP-42故障后来实际完成了什么处理？',
    '2026年2月12日完成免费换新，交接单已签字。',
    [target('replaced', 's07-incident', '2026年2月12日完成免费换新')]),
  q('dense-birchblue-east-price', 'calibration', 'no_answer',
    '柏蓝东站MP-42主泵实际采购单价是多少？能用本站预算上限代替吗？',
    '实际单价被遮盖，无法确认；预算上限不能代替单价。',
    [target('hidden-price', 's10-budget', '现有材料无法确认实际采购单价')]),
  q('dense-mapleblue-east-alarm', 'holdout', 'answerable',
    '枫蓝东站2026年1月20日的报警能证明主泵损坏或已申请换新吗？',
    '不能；是误报警，工单未发现主泵故障，也没有换新申请。',
    [target('false-alarm', 's06-incident', '工单结论为未发现主泵故障；没有换新申请')]),
  q('dense-birchlan-west-ceremony', 'holdout', 'no_answer',
    '柏岚西站10月的切换演练前，启动仪式实际举行了吗？',
    '复盘没有记录是否举行，不能认定举行或取消；演练本身已完成。',
    [target('unknown-ceremony', 's09-drill', '复盘没有记录是否举行')]),
  q('dense-birchblue-west-ceremony', 'holdout', 'answerable',
    '柏蓝西站的启动仪式和切换演练分别是什么结果？',
    '启动仪式因天气取消，切换演练于2025年10月13日完成。',
    [target('cancelled', 's11-drill', '启动仪式因天气取消'),
      target('drill', 's11-drill', '演练于2025年10月13日实际完成')]),
  q('dense-elmlan-west-ceremony', 'holdout', 'answerable',
    '榆岚西站的启动仪式只是计划，还是有实际举行记录？',
    '复盘和签到表都记载启动仪式实际举行。',
    [target('held', 's13-drill', '启动仪式在切换演练前实际举行')]),
  q('dense-birch-dates', 'holdout', 'answerable',
    '柏岚东站和柏蓝东站分别是哪一天最终验收的？两个站名只差一字。',
    '柏岚东站为2025年4月12日，柏蓝东站为2025年4月14日。',
    [target('lan-date', 's08-acceptance', '三方验收单最终签字日期为2025年4月12日'),
      target('blue-date', 's10-acceptance', '三方验收单最终签字日期为2025年4月14日')]),
  q('dense-elmlan-east-eligibility', 'holdout', 'answerable',
    '榆岚东站2026年1月20日的主泵故障在保修期内吗？供应商已完成更换吗？',
    '2025年4月16日验收、保修12个月；故障发生在期内，但只有申请，未有完成交接记录。',
    [target('signed', 's12-acceptance', '三方验收单最终签字日期为2025年4月16日'),
      target('warranty', 's12-policy', 'MP-42主泵整机保修12个月'),
      target('pending', 's12-incident', '截至2026年3月31日没有供应商完成更换的交接记录')]),
  q('dense-two-elm-prices', 'holdout', 'answerable',
    '榆蓝东站与榆蓝西站的MP-42主泵实际采购单价各是多少？',
    '榆蓝东站为14.0万元；榆蓝西站实际单价未披露。',
    [target('known-price', 's14-budget', 'MP-42主泵实际采购单价14.0万元'),
      target('hidden-price', 's15-budget', '现有材料无法确认实际采购单价')]),
  q('dense-elmblue-west-ceremony', 'holdout', 'no_answer',
    '榆蓝西站的启动仪式在演练前真的举行了吗？',
    '复盘没有记录是否举行，不能认定举行或取消。',
    [target('unknown-ceremony', 's15-drill', '复盘没有记录是否举行')])
];

module.exports = { id: 'dense-near-v1', description: '16个一字相近站点、80份虚构短资料、16道固定新题的共享笔记本检索压力测试',
  documents, questions };
