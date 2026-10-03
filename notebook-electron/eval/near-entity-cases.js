// Fixed fictional near-entity challenge. Similar names and records are intentional.
// Freeze this file before the first online run; do not edit it to improve its score.
const sites = [
  {
    id: 'lan-north', name: '青岚北站', code: 'QLN', plan: '2025年4月10日',
    accepted: '2025年4月18日', warranty: 12,
    policy: '2025年7月1日起，主泵非人为故障可自原验收日起18个月内申请免费换新；人为损坏不适用。',
    incident: '2026年1月20日主泵电机绕组绝缘缺陷，设备组判定为非人为故障。值班员提交了免费换新申请，供应商是否完成更换尚无记录。',
    drill: '原定2025年9月14日演练，暴雨当天取消；实际于2025年10月2日完成切换演练。宣传组只提议设置十五分钟启动仪式，复盘没有记载该仪式是否举行。',
    budget: '项目预算上限24万元，覆盖采购、安装和培训。合同单价栏遮盖且没有最终发票，现有摘录无法给出主泵实际采购单价。'
  },
  {
    id: 'blue-north', name: '青蓝北站', code: 'QLB', plan: '2025年5月3日',
    accepted: '2025年5月6日', warranty: 18,
    policy: '主泵整机自验收签字日起保修18个月。档案中没有将人为损坏纳入免费换新的补充条款；人为改线造成的故障按收费维修处理。',
    incident: '2026年1月20日控制柜报警，拆检确认有人私自改线烧坏主泵驱动器，设备组判定为人为损坏。供应商按收费维修单在2026年2月2日修复驱动器，并非免费换新主泵。',
    drill: '原定2025年9月14日演练，当天按计划完成。复盘明确记载：十五分钟启动仪式也在切换演练前举行，签到表与照片已归档。',
    budget: '项目预算上限26万元；最终发票列出QH-27主泵实际采购单价18.5万元，安装与培训另列费用。预算上限不是单价。'
  },
  {
    id: 'clear-north', name: '清岚北站', code: 'QCN', plan: '2025年4月22日',
    accepted: '2025年4月28日', warranty: 24,
    policy: '主泵整机自验收签字日起保修24个月。非人为电机故障在保修期内由供应商维修或换新，处理完成后须补录设备交接单。',
    incident: '2026年2月5日主泵电机发生非人为故障，供应商于2026年2月20日完成换新并交回签字的设备交接单。此处明确记载实际完成，而不只是申请。',
    drill: '原定2025年9月20日演练，因场地冲突改为9月21日并完成切换。启动仪式因天气原因明确取消，复盘没有把取消仪式等同于取消演练。',
    budget: '项目预算上限25万元，公开合同摘录隐去主泵成交价格。档案管理员说必须查未公开发票才能确认实际单价。'
  },
  {
    id: 'lan-south', name: '青岚南站', code: 'QLS', plan: '2025年4月12日',
    accepted: '2025年4月19日', warranty: 12,
    policy: '主泵整机自验收签字日起保修12个月。一次报警不等于设备损坏，申请维修前须先读取现场工单的故障结论。',
    incident: '2026年1月20日控制柜出现短暂误报警，现场复位后主泵持续正常运行。工单明确写“未发现主泵故障”，没有提交免费换新申请。',
    drill: '原定2025年9月14日演练，当天因暴雨取消；改期后于2025年10月6日完成切换演练。方案曾提出启动仪式，但复盘没有记载是否实际举行。',
    budget: '项目预算上限24.5万元；最终发票列出QH-27主泵实际采购单价17.8万元，其他费用是管路施工与培训。'
  }
];

const documents = [];
for (const site of sites) {
  const title = `${site.name}QH-27`;
  documents.push({ id: `${site.id}-acceptance`, title: `${title}验收纪要`, text:
    `${site.name}工程周报曾预计${site.plan}完工，那个日期不是最终验收日。三方最终签字日期为${site.accepted}，纪要编号${site.code}-A。验收对象是QH-27主泵和随泵交付的控制器。站务组核查了铭牌、空载试转和交接清单；之后的例行巡查不构成第二次验收。档案室要求凡涉及保修起算，引用最终签字日期而非排期表。相邻站点的名称只差一字，但各站分别签字、分别归档。` });
  documents.push({ id: `${site.id}-policy`, title: `${title}保修条款`, text:
    `${site.name}采购合同第九条：QH-27主泵整机自验收签字日起保修${site.warranty}个月。${site.policy}档案员提醒，合同标的中还包括控制器，但不能仅凭标的清单就扩张主泵条款的适用范围。查询保修时应同时核对站名、最终验收日、故障对象和原因判定；其他站点的月数不能借用。` });
  documents.push({ id: `${site.id}-incident`, title: `${title}故障工单`, text:
    `${site.name}的QH-27工单编号${site.code}-I。${site.incident}工单仅适用于本站设备。另一站点在同一天也可能有报警，不能按日期把两个故障合并。设备组在备注中要求把“提出申请”“收费维修完成”和“免费换新完成”分别记账，避免状态被自动补全。` });
  documents.push({ id: `${site.id}-drill`, title: `${site.name}汛前演练复盘`, text:
    `${site.name}汛前演练方案与复盘合并归档。${site.drill}复盘把计划日期、实际演练和附属活动分别记录，不能因为同站点另一份方案写了启动仪式，就认定本站也举行。统计时只按实际完成的切换演练计一次，不把方案或静态检查另算一次。` });
  documents.push({ id: `${site.id}-budget`, title: `${site.name}预算摘录`, text:
    `${site.name}设备采购与施工费用分开核算。${site.budget}财务组提醒，一份材料没有价格时不能用相近站点的价格填空；预算上限、付款总额和单台主泵成交价是不同字段。` });
}

const target = (id, documentId, contains) => ({ id, documentId, contains });
const questions = [
  {
    id: 'near-lan-acceptance', split: 'calibration', kind: 'answerable',
    query: '青岚北站QH-27最终哪天验收？4月10日又是什么日期？',
    expected: '2025年4月18日验收；4月10日只是预计完工日。',
    evidenceDocumentIds: ['lan-north-acceptance'],
    evidenceTargets: [target('lan-acceptance', 'lan-north-acceptance', '三方最终签字日期为2025年4月18日')]
  },
  {
    id: 'near-blue-warranty', split: 'calibration', kind: 'answerable',
    query: '青蓝北站主泵整机保修多久？不要用青岚北站的条款回答。',
    expected: '青蓝北站自验收签字日起保修18个月。',
    evidenceDocumentIds: ['blue-north-policy'],
    evidenceTargets: [target('blue-warranty', 'blue-north-policy', '整机自验收签字日起保修18个月')]
  },
  {
    id: 'near-clear-replaced', split: 'calibration', kind: 'answerable',
    query: '清岚北站2026年2月的主泵故障只是申请换新，还是已经完成？',
    expected: '2026年2月20日已完成换新且有签字交接单。',
    evidenceDocumentIds: ['clear-north-incident'],
    evidenceTargets: [target('clear-completed', 'clear-north-incident', '2026年2月20日完成换新')]
  },
  {
    id: 'near-south-drill', split: 'calibration', kind: 'answerable',
    query: '青岚南站演练原定哪天，最后哪天完成？',
    expected: '原定2025年9月14日，当日因暴雨取消；实际2025年10月6日完成。',
    evidenceDocumentIds: ['lan-south-drill'],
    evidenceTargets: [target('south-drill', 'lan-south-drill', '于2025年10月6日完成切换演练')]
  },
  {
    id: 'near-lan-price', split: 'calibration', kind: 'no_answer',
    query: '青岚北站QH-27主泵的实际采购单价是多少？',
    expected: '现有摘录不提供实际单价；24万元是项目预算上限。',
    evidenceDocumentIds: ['lan-north-budget'],
    evidenceTargets: [target('lan-price-unknown', 'lan-north-budget', '现有摘录无法给出主泵实际采购单价')]
  },
  {
    id: 'near-lan-eligibility', split: 'calibration', kind: 'answerable',
    query: '青岚北站2026年1月20日的主泵故障是否在免费换新条件内？供应商已经换好吗？',
    expected: '验收2025年4月18日起18个月内，非人为故障，符合申请条件；只有申请记录，未确认供应商完成换新。',
    evidenceDocumentIds: ['lan-north-acceptance', 'lan-north-policy', 'lan-north-incident'],
    evidenceTargets: [target('lan-date', 'lan-north-acceptance', '三方最终签字日期为2025年4月18日'),
      target('lan-replacement-policy', 'lan-north-policy', '主泵非人为故障可自原验收日起18个月内申请免费换新'),
      target('lan-application', 'lan-north-incident', '供应商是否完成更换尚无记录')]
  },
  {
    id: 'near-blue-damage', split: 'holdout', kind: 'answerable',
    query: '青蓝北站2026年1月20日的损坏能按免费换新处理吗？后来完成了什么处理？',
    expected: '人为私自改线损坏，不属于免费换新；2026年2月2日完成收费维修驱动器。',
    evidenceDocumentIds: ['blue-north-policy', 'blue-north-incident'],
    evidenceTargets: [target('blue-policy', 'blue-north-policy', '人为改线造成的故障按收费维修处理'),
      target('blue-repair', 'blue-north-incident', '2026年2月2日修复驱动器')]
  },
  {
    id: 'near-compare-dates', split: 'holdout', kind: 'answerable',
    query: '青岚北站和清岚北站的QH-27分别是哪天验收？注意第一个字不同。',
    expected: '青岚北站2025年4月18日；清岚北站2025年4月28日。',
    evidenceDocumentIds: ['lan-north-acceptance', 'clear-north-acceptance'],
    evidenceTargets: [target('lan-date', 'lan-north-acceptance', '三方最终签字日期为2025年4月18日'),
      target('clear-date', 'clear-north-acceptance', '三方最终签字日期为2025年4月28日')]
  },
  {
    id: 'near-south-alarm', split: 'holdout', kind: 'answerable',
    query: '青岚南站2026年1月20日报警能证明主泵损坏并已申请免费换新吗？',
    expected: '不能；只是误报警，工单明确未发现主泵故障，也没有换新申请。',
    evidenceDocumentIds: ['lan-south-incident'],
    evidenceTargets: [target('south-false-alarm', 'lan-south-incident', '未发现主泵故障')]
  },
  {
    id: 'near-lan-ceremony', split: 'holdout', kind: 'no_answer',
    query: '青岚北站10月2日演练前的十五分钟启动仪式实际举行了吗？',
    expected: '只提议；复盘未记载，不能确认举行或未举行。',
    evidenceDocumentIds: ['lan-north-drill'],
    evidenceTargets: [target('lan-ceremony-unknown', 'lan-north-drill', '复盘没有记载该仪式是否举行')]
  },
  {
    id: 'near-two-prices', split: 'holdout', kind: 'answerable',
    query: '青蓝北站与青岚北站的QH-27主泵实际采购单价各是多少？',
    expected: '青蓝北站18.5万元；青岚北站实际单价未公开，不能用24万元预算填补。',
    evidenceDocumentIds: ['blue-north-budget', 'lan-north-budget'],
    evidenceTargets: [target('blue-price', 'blue-north-budget', '实际采购单价18.5万元'),
      target('lan-price-unknown', 'lan-north-budget', '现有摘录无法给出主泵实际采购单价')]
  },
  {
    id: 'near-clear-ceremony', split: 'holdout', kind: 'answerable',
    query: '清岚北站9月21日演练的启动仪式是否举行？演练本身呢？',
    expected: '启动仪式明确取消；演练在9月21日完成。',
    evidenceDocumentIds: ['clear-north-drill'],
    evidenceTargets: [target('clear-ceremony', 'clear-north-drill', '启动仪式因天气原因明确取消')]
  }
];

module.exports = { id: 'near-entity-v1', description: '四个近名站点的20份固定虚构资料与12题；检索精度和跨站事实边界专项',
  documents, questions };
