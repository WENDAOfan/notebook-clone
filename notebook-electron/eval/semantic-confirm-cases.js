// Independent fictional confirmation set, fixed before the first online run.
const records = [
  ['handover-a', '交接备忘A', { 9: '宁川工坊的LT-4封装机于2026年2月11日完成签收。',
    25: '宁川工坊LT-4封装机的密封垫每45天更换一次。' }],
  ['handover-b', '交接备忘B', { 11: '凝川工坊的LT-4封装机于2026年2月16日完成签收。',
    27: '凝川工坊LT-4封装机的密封垫每75天更换一次。' }],
  ['other', '型号适用说明', { 15: '宁川工坊LT-40封装机的密封垫每100天更换一次，这项规定不适用于LT-4。' }],
  ['original', '维修约定原件摘录', { 13: '宁川工坊原维修约定为签收日起9个月内免费处理正常使用故障。',
    29: '宁川工坊设备成交价在公开摘录中未披露，维护费不得当作成交价。' }],
  ['amendment', '维修约定变更附件', { 17: '宁川工坊变更附件把正常使用故障的免费处理期限改为签收日起15个月，私自拆机造成的损坏不适用。' }],
  ['access', '归档岗位工作规则', { 7: '2026年6月1日以前，宁川工坊借阅检测报告只需技术主管批准。',
    23: '2026年6月1日起，宁川工坊借阅检测报告须技术主管和质检员共同批准，旧办法不再有效。' }],
  ['visitor', '来访须知与应急处置', { 5: '忘记带纸质预约单的来访者，可凭预约邮件中的二维码和本人证件核验入内。',
    21: '闻到配电箱焦糊味时，不应继续开机排查，应先断开总电源，再通知持证电工检查。' }],
  ['events', '培训活动归档说明', { 19: '宁川工坊原定2026年4月8日开展疏散培训，因道路封闭取消，实际在4月22日举行。',
    31: '归档说明没有记录合影环节是否举行，不能以疏散培训已完成推断合影已完成。' }]
];
const prose = [
  '文件管理员对本周收集的纸质记录逐项编号，核对签名、附件和页码。需要补充的材料列入待办清单，已完成的归档工作另行登记，不代替业务部门作出结论。',
  '当天的环境检查涵盖公共走廊、会议室和储物区域。工作人员记录照明情况并整理桌面，清点可重复使用的办公用品，异常项目交由下一班复核。',
  '备用材料按类别和领用日期分柜存放。管理人员检查外包装完整性，缺少标签的物品重新标注，领取与归还分别登记，未形成采购价格或保修期限的补充约定。',
  '归档副本应与原件的次序对应，遇到模糊页时重新扫描。复核人员抽查了电子文件能否打开，并把损坏文件交回重做，纸质原件暂存于指定文件盒。'
];
const documents = records.map(([id, title, facts], index) => ({ id, title,
  text: Array.from({ length: 32 }, (_, i) => `归档段落${i + 1}，记录号${id.toUpperCase()}-${i + 1}。${prose[(i + index) % prose.length]}`
    + (facts[i + 1] ? `\n\n${facts[i + 1]}` : '')).join('\n\n') }));
const e = (documentId, section) => ({ id: `${documentId}-${section}`, documentId,
  contains: records.find(item => item[0] === documentId)[2][section] });
const q = (id, query, expected, evidenceTargets, kind = 'answerable') => ({ id, split: 'holdout', kind,
  query, expected, evidenceTargets, evidenceDocumentIds: [...new Set(evidenceTargets.map(e => e.documentId))] });
const questions = [
  q('sc-date', '宁川工坊LT-4哪天签收？', '2026年2月11日。', [e('handover-a', 9)]),
  q('sc-dates', '宁川工坊和凝川工坊的LT-4分别哪天签收？', '宁川2月11日，凝川2月16日。', [e('handover-a', 9), e('handover-b', 11)]),
  q('sc-pad', '宁川工坊LT-4密封垫多久更换？不要用LT-40的周期。', '45天。', [e('handover-a', 25)]),
  q('sc-near-pad', '凝川工坊LT-4密封垫更换周期是多少？', '75天。', [e('handover-b', 27)]),
  q('sc-amendment', '宁川工坊变更附件规定的免费处理期限和排除条件是什么？', '签收日起15个月，正常使用故障，私自拆机造成的损坏除外。', [e('amendment', 17)]),
  q('sc-contracts', '宁川工坊原维修约定和变更附件分别承诺多久免费处理？', '原9个月，变更15个月，均从签收日起。', [e('original', 13), e('amendment', 17)]),
  q('sc-access', '2026年6月前后，宁川工坊检测报告借阅分别由谁批准？', '之前技术主管；之后技术主管和质检员共同批准。', [e('access', 7), e('access', 23)]),
  q('sc-visitor', '预约纸张忘带了，还能用什么凭证进去？', '预约邮件二维码和本人证件。', [e('visitor', 5)]),
  q('sc-burning', '配电箱有烧焦的味道，能继续开机找原因吗？', '不能；先断总电源，再通知持证电工。', [e('visitor', 21)]),
  q('sc-training', '宁川工坊疏散培训原计划和实际日期是什么？', '原2026年4月8日取消，实际4月22日。', [e('events', 19)]),
  q('sc-price', '宁川工坊LT-4成交价格是多少？', '公开摘录未披露，不能用维护费代替。', [e('original', 29)], 'no_answer'),
  q('sc-photo', '宁川工坊合影环节有没有举行？', '未记录，不能从培训完成推断。', [e('events', 31)], 'no_answer')
];
module.exports = { id: 'semantic-confirm-v1', documents, questions };
