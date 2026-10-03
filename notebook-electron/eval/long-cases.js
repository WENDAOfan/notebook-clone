// Entirely fictional long-form materials. Generated records are deterministic
// and intentionally similar, so relevant facts are embedded among distractors.
const specs = [
  {
    id: 'star-ops', title: '星河站运行档案', subject: '星河站', topic: '设备巡检',
    anchors: {
      23: '验收单号XH-BAT-0420：星河站备用电源型号QX-7于2025年4月20日完成更换验收。'
    }
  },
  {
    id: 'near-ops', title: '星禾站运行档案', subject: '星禾站', topic: '设备巡检',
    anchors: {
      23: '验收单号XH-N-BAT-0522：星禾站备用电源型号QX-7于2025年5月22日完成更换验收。'
    }
  },
  {
    id: 'contract', title: '星河站采购合同摘录', subject: '星河站', topic: '合同归档',
    anchors: {
      17: '合同条款C-17：星河站QX-7设备自2025年4月20日验收起，原约定保修12个月；本摘录不载采购单价。'
    }
  },
  {
    id: 'addendum', title: '星河站补充协议', subject: '星河站', topic: '补充协议',
    anchors: {
      29: '补充协议A-29：自2025年6月1日起，星河站QX-7非人为故障免费换新期限改为原验收日起18个月；人为损坏不适用。'
    }
  },
  {
    id: 'incident', title: '星河站故障工单汇编', subject: '星河站', topic: '故障工单',
    anchors: {
      33: '工单I-33：2026年1月15日星河站QX-7自检报警，审查结论为非人为故障，值班人员申请免费换新。'
    }
  },
  {
    id: 'drill-plan', title: '星河站演练计划', subject: '星河站', topic: '演练筹备',
    anchors: {
      19: '演练计划P-19：星河站应急演练将于2025年9月14日进行，演练前拟安排十五分钟启动仪式。'
    }
  },
  {
    id: 'drill-outcome', title: '星河站演练后续记录', subject: '星河站', topic: '演练复盘',
    anchors: {
      31: '演练回顾R-31：原定2025年9月14日的星河站应急演练因暴雨取消，当天未举行；演练实际于2025年10月2日开展。资料未记载启动仪式后来是否举行。'
    }
  },
  {
    id: 'access-policy', title: '星河站日志取用规程', subject: '星河站', topic: '权限审核',
    anchors: {
      16: '规程旧版V1：取用星河站QX-7巡检日志只需值班主管审批。',
      30: '规程新版V2：自2025年7月1日起，取用星河站QX-7巡检日志除值班主管审批外，还需资产负责人二次审批；旧版单人审批不再适用。'
    }
  }
];

const workers = ['林甲', '陈乙', '周丙', '吴丁', '郑戊', '罗己'];
const components = ['供电柜', '温控单元', '通信箱', '告警面板', '传感器组', '风扇模块'];
const observations = ['指示灯稳定', '接线端子完整', '外壳无破损', '风道保持畅通', '数据上传正常', '备用端口已封存'];

function buildText(spec) {
  const paragraphs = [];
  for (let number = 1; number <= 36; number += 1) {
    const worker = workers[(number * 3 + spec.id.length) % workers.length];
    const component = components[(number + spec.title.length) % components.length];
    const observation = observations[(number * 2 + spec.subject.length) % observations.length];
    paragraphs.push(`第${String(number).padStart(2, '0')}节 ${spec.topic}记录。${spec.subject}的${component}由${worker}核查，${observation}；本项记录编号为${spec.id.toUpperCase()}-${String(number).padStart(3, '0')}。记录同时载明本周的交接班、例行复核和资料归档情况，未对其他站点作结论。`);
    if (spec.anchors[number]) paragraphs.push(spec.anchors[number]);
  }
  return paragraphs.join('\n\n');
}

const documents = specs.map(spec => ({ id: spec.id, title: spec.title, text: buildText(spec) }));
const target = (id, documentId, contains) => ({ id, documentId, contains });
const questions = [
  {
    id: 'long-star-acceptance', split: 'calibration', kind: 'answerable',
    query: '星河站QX-7备用电源是哪天完成更换验收的？',
    expected: '2025年4月20日；不能混淆星禾站的5月22日。',
    evidenceDocumentIds: ['star-ops'],
    evidenceTargets: [target('star-date', 'star-ops', '验收单号XH-BAT-0420')]
  },
  {
    id: 'long-near-acceptance', split: 'calibration', kind: 'answerable',
    query: '星禾站QX-7备用电源是哪天完成更换验收的？',
    expected: '2025年5月22日，不是星河站的日期。',
    evidenceDocumentIds: ['near-ops'],
    evidenceTargets: [target('near-date', 'near-ops', '验收单号XH-N-BAT-0522')]
  },
  {
    id: 'long-warranty', split: 'calibration', kind: 'answerable',
    query: '星河站QX-7原合同的保修期，与补充协议后非人为故障免费换新的期限和条件分别是什么？',
    expected: '原保修12个月；补充协议将非人为故障免费换新调整为原验收日起18个月，人为损坏不适用。',
    evidenceDocumentIds: ['contract', 'addendum'],
    evidenceTargets: [target('original-term', 'contract', '合同条款C-17'),
      target('new-term', 'addendum', '补充协议A-29')]
  },
  {
    id: 'long-drill', split: 'calibration', kind: 'answerable',
    query: '星河站应急演练原计划哪天举行，实际哪天开展？能确认启动仪式也举行了吗？',
    expected: '原计划2025年9月14日，当天取消；实际10月2日开展，启动仪式是否举行没有记录。',
    evidenceDocumentIds: ['drill-plan', 'drill-outcome'],
    evidenceTargets: [target('drill-plan', 'drill-plan', '演练计划P-19'),
      target('drill-outcome', 'drill-outcome', '演练回顾R-31')]
  },
  {
    id: 'long-price-unknown', split: 'calibration', kind: 'no_answer',
    query: '星河站QX-7设备的采购单价是多少？',
    expected: '现有资料未载采购单价，不能给出金额。',
    evidenceDocumentIds: ['contract'],
    evidenceTargets: [target('price-not-given', 'contract', '本摘录不载采购单价')]
  },
  {
    id: 'long-incident-coverage', split: 'holdout', kind: 'answerable',
    query: '星河站QX-7在2026年1月15日发生的故障，按补充协议是否落在免费换新范围内？请结合验收时间和故障性质说明。',
    expected: '2025年4月20日验收起18个月内；2026年1月15日仍在期限内，且工单认定非人为故障，因此符合补充协议写明的条件。',
    evidenceDocumentIds: ['star-ops', 'addendum', 'incident'],
    evidenceTargets: [target('acceptance', 'star-ops', '验收单号XH-BAT-0420'),
      target('coverage', 'addendum', '补充协议A-29'),
      target('incident', 'incident', '工单I-33')]
  },
  {
    id: 'long-access-current', split: 'holdout', kind: 'answerable',
    query: '星河站QX-7巡检日志旧规程如何审批，2025年7月1日后要谁审批？',
    expected: '旧版只需值班主管；新版增加资产负责人二次审批。',
    evidenceDocumentIds: ['access-policy'],
    evidenceTargets: [target('old-rule', 'access-policy', '规程旧版V1'),
      target('new-rule', 'access-policy', '规程新版V2')]
  },
  {
    id: 'long-disambiguation', split: 'holdout', kind: 'answerable',
    query: '5月22日完成QX-7更换验收的是星河站还是星禾站？两站各是什么日期？',
    expected: '5月22日的是星禾站；星河站是4月20日。',
    evidenceDocumentIds: ['star-ops', 'near-ops'],
    evidenceTargets: [target('star-date', 'star-ops', '验收单号XH-BAT-0420'),
      target('near-date', 'near-ops', '验收单号XH-N-BAT-0522')]
  },
  {
    id: 'long-original-ceremony', split: 'holdout', kind: 'answerable',
    query: '星河站9月14日原计划的启动仪式真的举行了吗？',
    expected: '当天演练因暴雨取消，不能说启动仪式举行；10月2日演练实际开展，但启动仪式是否举行无记录。',
    evidenceDocumentIds: ['drill-plan', 'drill-outcome'],
    evidenceTargets: [target('drill-plan', 'drill-plan', '演练计划P-19'),
      target('drill-outcome', 'drill-outcome', '演练回顾R-31')]
  },
  {
    id: 'long-old-serial-unknown', split: 'holdout', kind: 'no_answer',
    query: '星河站更换前的旧备用电源序列号是什么？',
    expected: '资料没有旧备用电源序列号，不能编造。',
    evidenceDocumentIds: ['star-ops'],
    evidenceTargets: [target('acceptance', 'star-ops', '验收单号XH-BAT-0420')]
  }
];

module.exports = { id: 'long-v1', description: '八份虚构多分块资料，含近似名称、跨文档条件、时态与无答案题',
  documents, questions };
