// Frozen before local sentence relevance implementation; all facts fictional.
const definitions = [
  ['hours-a', '读者问答A', '澄桥阅览室周六开放时间为9:30至17:00；周日不开放。'],
  ['hours-b', '读者问答B', '橙桥阅览室周六开放时间为10:00至18:30；周日不开放。'],
  ['loan-old', '外借旧章程', '澄桥阅览室旧章程允许会员借阅21天，逾期须到柜台登记。'],
  ['loan-new', '外借修订通知', '自2026年7月15日起，澄桥阅览室会员借阅期改为28天，旧21天条款停止适用。'],
  ['unit-a', '维护操作手册A', '石溪实验站UV-6紫外灯累计运行400小时必须更换；更换前切断电源并等待灯管冷却。'],
  ['unit-b', '维护操作手册B', '石溪实验站UV-60紫外灯累计运行900小时必须更换；这一周期不适用于UV-6。'],
  ['expense', '费用说明', '石溪实验站UV-6成交价在公开文件中被删除，运输保险金额不是设备成交价。'],
  ['entry', '来访指引', '手机没电无法出示电子访客码时，访客可以凭护照或身份证在前台查询已批准的预约。'],
  ['software', '服务升级记录', 'Luma服务v2.4以前默认保留审计日志7天；从v2.4起默认保留30天，管理员可另行调整。'],
  ['refund', '退款问答', '星禾展馆取消的团体预约在5个工作日内原路退款，个人预约须在2个工作日内办理。'],
  ['drill', '培训纪要', '星禾展馆原定2026年9月3日开展的培训因停电取消，实际于9月8日举行。纪要没有记载合照环节是否开展。'],
  ['repair', '故障处理提示', '发现设备电池鼓包时应停止使用并交由维修人员处理，不得挤压或继续充电。']
];
const filler = [
  '资料复核人员检查页码及签收情况，将缺失附件交回补充；例行归档不替代业务批准。',
  '当日清点纸盒和工具，库存按颜色分柜，领用后应归还登记表；这些步骤不改变服务规则。',
  '本节是日常环境巡检，照明和走廊保持整洁，照片按拍摄日期归档；记录不代表其他活动已经举行。',
  '移交人员复核扫描副本与原件的一致性，破损封皮单独登记；涉及费用的问题以业务原件为准。'
];
const documents = definitions.map(([id, title, fact], index) => ({ id, title,
  text: Array.from({ length: 42 }, (_, n) => `归档${n + 1}：${filler[(n + index) % filler.length]}${filler[(n + index + 1) % filler.length]}`
    + (n === 13 + index ? `\n\n${fact}` : '')).join('\n\n') }));
const e = id => ({ id, documentId: id, contains: definitions.find(d => d[0] === id)[2] });
const q = (id, query, expected, ids, kind = 'answerable') => ({ id, query, expected, split: 'holdout', kind,
  evidenceTargets: ids.map(e), evidenceDocumentIds: ids });
const questions = [
  q('pc-hours-a', '澄桥阅览室星期六几点开门、几点关门？', '9:30至17:00。', ['hours-a']),
  q('pc-hours-b', '橙桥阅览室周六的开放时间？', '10:00至18:30。', ['hours-b']),
  q('pc-hours-compare', '澄桥和橙桥阅览室周六开放时间分别是什么？', '澄桥9:30至17:00，橙桥10:00至18:30。', ['hours-a', 'hours-b']),
  q('pc-new', '2026年8月澄桥阅览室会员能借多久？', '28天。', ['loan-new']),
  q('pc-loan-compare', '澄桥阅览室会员借阅期修订前后分别多少天？', '原21天，新28天。', ['loan-old', 'loan-new']),
  q('pc-unit', '石溪实验站UV-6灯运行多少小时需要换，不是UV-60？', '400小时。', ['unit-a']),
  q('pc-unit-compare', 'UV-6和UV-60紫外灯的强制更换周期分别是多少？', '400小时与900小时。', ['unit-a', 'unit-b']),
  q('pc-cooling', '石溪实验站换UV-6灯管前要先做什么？', '切断电源，等待灯管冷却。', ['unit-a']),
  q('pc-entry', '到了前台发现手机关机，打不开访客二维码，还能怎么核验？', '用护照或身份证查询已批准的预约。', ['entry']),
  q('pc-log', 'Luma从v2.3升级到v2.4，审计日志的默认保留期有什么变化？', '7天变为30天，可由管理员调整。', ['software']),
  q('pc-refund', '星禾展馆团体和个人取消预约的退款时间有什么区别？', '团体5个工作日，个人2个工作日。', ['refund']),
  q('pc-battery', '电池外壳明显膨胀了，可以压平再充电吗？', '不可以，停用并交维修，不挤压或继续充电。', ['repair']),
  q('pc-price', '石溪实验站每台UV-6花了多少钱？', '成交价被删除，不能用运输保险金额代替。', ['expense'], 'no_answer'),
  q('pc-photo', '星禾展馆9月8日的培训结束后拍合照了吗？', '未记载，不能推断。', ['drill'], 'no_answer')
];
module.exports = { id: 'paragraph-confirm-v1', documents, questions };
