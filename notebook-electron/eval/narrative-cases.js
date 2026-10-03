// Fixed, fictional Chinese records written as ordinary prose rather than repeated filler.
// Freeze the questions and evidence labels before any online run; do not tune on holdout.
const documents = [
  {
    id: 'qinglan-acceptance', title: '青岚北站改造验收纪要', text: `2025年4月18日下午，青岚北站完成了QH-27主泵的更换验收。参加验收的有站务组、设备组和施工单位，三方当场核对了机身铭牌、控制柜接线和空载试转记录。纪要编号为QL-A-0418。验收结论只针对主泵及随泵交付的控制器，并不表示站内所有传感器都在当天更新。

项目在3月遇到过一次供货延期。施工单位把旧泵临时留作备用，直到新泵通过耐压检查才拆除旁路。值班人员特别提醒，历史维修单里也有“北站”二字，不能仅凭简称认定是这台设备。最终签字页确认的日期是4月18日，早期排期表上出现的4月10日只是预计完工日。

验收附件记录了六小时试运行的流量和电流，没有列出被拆旧泵的序列号。附件中另外列着电缆桥架的整改建议，但此项没有改变主泵的验收日期。档案室将纸质纪要与设备照片一起归档，后续保修起算以三方签字的验收日期为准。`
  },
  {
    id: 'qinglan-contract', title: '青岚北站设备采购合同摘录', text: `采购合同签订于2025年2月，标的是青岚北站一套QH-27主泵及配套控制器。合同第九条约定：主泵整机自验收签字之日起保修12个月。合同把正常磨损的滤芯列为耗材，要求站务组按月登记更换；滤芯的更换不自动延长主泵保修期。

合同附件有安装培训、到货检查和付款节点，但本次归档摘录将单价栏遮盖，没有公开主泵的实际采购单价。另有一份预算批复提到项目资金上限，预算上限不等于成交价格。合同文字也没有给旧泵序列号，因此不能从合同推断被拆设备的型号尾号。

5月初的例行审计曾询问保修是否从交货日开始。采购组在书面答复中重申应从验收签字日起算，并要求工作人员引用第九条，而不是拿物流签收日代替。合同摘录本身未记载后来的补充协议是否已经生效。`
  },
  {
    id: 'qinglan-addendum', title: '青岚北站采购补充协议', text: `施工单位和采购组于2025年6月3日签署了补充协议，约定从7月1日起适用新的换新条款。补充协议A-07写明：青岚北站QH-27主泵发生非人为故障时，免费换新的期限调整为原验收日起18个月；人为损坏不在该换新条款范围。期限仍从原验收日计算，并非从签署日重新起算。

补充协议只扩展主泵的非人为故障换新，不改变滤芯作为耗材的安排，也未承诺替换站内全部监测传感器。设备组要求值班员提交故障工单和原因判定后再申请换新，不能仅凭“泵站报警”四个字直接认定符合条件。

档案批注解释，原合同的12个月整机保修与补充协议的18个月特定换新条款应分别描述。两份文件用词和适用范围不同，不能把“18个月免费换新”改写为“所有设备保修18个月”。`
  },
  {
    id: 'qinglan-incident', title: '青岚北站一月故障工单', text: `2026年1月20日清晨，青岚北站值班员发现QH-27主泵电机温升异常，随即停机并启用备用线路。工单QL-I-0120记载的故障对象是2025年4月验收的主泵，不是滤芯，也不是青蓝北站的同型号设备。

维修人员拆检后发现电机绕组绝缘缺陷。设备组在1月22日签字的原因判定中将其列为非人为故障，没有发现私自改线或外力损坏。值班员随后提交免费换新申请；工单只记录了申请动作，没有写供应商已经完成更换，也未给出新设备交付日期。

同一周另一张单据记录了雨量传感器通信中断。传感器故障与主泵绕组问题分属两条工单，不能用传感器的处理状态推断主泵是否已换新。值班员在交班备注中要求后续查询时分别引用两张单据。`
  },
  {
    id: 'qinglan-drill-plan', title: '青岚北站汛前演练方案', text: `运行组在2025年8月下旬拟定了汛前演练方案，计划于9月14日组织青岚北站的停电切换演练。方案先安排人员点名，再进行设备切换和复盘。宣传组另提议在演练开始前设置十五分钟的启动仪式，供周边单位观摩；这一环节尚待现场条件确认。

方案中的“计划”栏和“实施记录”栏是分开的。打印版只填了计划时间、参演角色和安全边界，没有实施记录的签名，也没有现场照片。后续如有改期，应以运行组的复盘记录为准，不能把方案列出的日期直接当作实际发生日期。

方案还列有备选天气处置：若降雨超过警戒线，暂停户外集合并另行通知。该条只是预案，不表示当时已经触发，也不表示启动仪式一定取消。`
  },
  {
    id: 'qinglan-drill-review', title: '青岚北站演练复盘记录', text: `9月14日当天出现持续暴雨，运行组通知取消原定演练，现场没有进行停电切换。复盘记录R-1002确认：演练实际于2025年10月2日开展，三项切换动作均完成，最后进行了二十分钟的值班复盘。

复盘文件列出了参演人员、切换结果和故障处置时间，但没有记录宣传组提议的启动仪式是否在10月2日举行。10月2日的演练确实发生，不等于原方案里每一个附属环节也都发生。复盘文件也没有补填启动仪式的照片或签到表。

关于9月14日，记录用的是“取消”而非“延期到当天晚些时候”。雨停后只做了设备静态检查，没有按演练流程启动切换。运行组希望以后统计活动次数时不要把方案和复盘各算一次。`
  },
  {
    id: 'qinglan-access', title: '青岚北站巡检日志取用规程', text: `2025年上半年使用的V1规程要求，外部协作人员取用青岚北站QH-27巡检日志前取得值班主管批准。审批登记簿保留了用途、领取时间和归还时间，值班主管可单独签批。V1没有资产负责人二次确认环节。

修订后的V2规程自2025年7月1日起生效。按照新版，外部协作人员取用同一批巡检日志时，先由值班主管审核用途，再由资产负责人二次审批；只有第一道签字不能发放。新版只改变日志取用权限，不改变设备保修条款，也不替代故障原因判定。

规程末尾写明，旧版单人审批方式在新版生效后不再适用。档案室在7月3日退回过一份只带值班主管签名的申请，并要求补齐资产负责人意见。这是执行记录，不是另外一套审批规则。`
  },
  {
    id: 'qinglan-budget', title: '青岚北站改造预算与审计备忘', text: `项目预算批复为不超过24万元，覆盖主泵采购、安装培训、配套管路和现场测试。财务人员强调，这个总额是支出上限，不是QH-27主泵的成交单价，也不是已经支付的总额。

审计备忘列出了需要检查的三份凭证：采购合同、到货单和最终发票。本次公开摘录没有附最终发票，合同中的单价栏也被遮盖。因此现有资料无法给出主泵实际采购单价；不能用24万元预算总额直接回答单价问题。

预算说明还提到下一年度可能增设远程监控模块，但没有批准型号与数量。该意向和今年的主泵采购分开记账，不应拿它补足缺失的发票信息。`
  },
  {
    id: 'qinglan-relocation', title: '青岚北站备用泵迁移讨论纪要', text: `2026年2月的联席会上，有人提议将青岚北站拆下的旧备用泵迁往青蓝北站，以便后者开展教学展示。会议纪要把这项列在“待评估建议”栏，并要求先核实旧泵安全性和两站接口尺寸。

3月复核时，资产组仍未批准迁移；会议记录写明暂不安排运输。档案里没有出库单、交接单或抵达青蓝北站的证明。提议目的和最终执行是两件事，不能因为青蓝北站被写进建议就说旧泵已经迁去。

设备组建议把旧泵留在青岚北站库房，等年度资产盘点后再讨论去向。此建议也没有形成最终处置决定。文件没有旧泵序列号，无法凭这份纪要补出序列号。`
  },
  {
    id: 'qinglan-neighbor', title: '青蓝北站QH-27验收简报', text: `青蓝北站与青岚北站只有一字之差，两站都安装过QH-27系列主泵。青蓝北站这台设备的三方验收日期为2025年5月6日，简报编号为QLB-A-0506；青岚北站4月的纪要不适用于青蓝北站。

青蓝北站工程在五一假期后才完成联调。早期周报曾计划5月3日交付，但控制器参数需要重新设定，因此没有在3日签字。最终验收页和站务组台账都写5月6日。

简报没有披露青蓝北站设备的采购单价，也未提及青岚北站1月的故障。两个站点可能共用供应商，但合同和工单各自归档；对比日期时应同时核对站名和纪要编号。`
  }
];

const archiveNotes = {
  'qinglan-acceptance': `验收后的第一周，站务组继续观察振动曲线，每天把读数抄入运行本。4月21日的记录只是运行巡查，不是第二次验收。施工单位要求把附件里的旧泵照片与新泵铭牌分开命名，以免以后查询“QH-27北站主泵”时误把旧泵照片当作新泵出厂证明。设备组还发现一处电缆标签写得不够清楚，要求补贴标识；这一整改不影响已签字的主泵验收结论。档案员把排期表和验收纪要分别装订，提示查阅者按文件性质使用日期。`,
  'qinglan-contract': `付款条款把首付款、到货款和验收款分别列示，任何一笔付款的日期都不能代替设备验收日期。采购组没有在公开摘录中给出各笔金额。培训记录显示两名值班员学会了停机检查和手动复位，培训完成也不改变合同保修起算规则。档案员在页脚注明，遇到补充协议时应并列查阅，不能只摘录合同首页的“12个月”就推断后来没有其他约定。`,
  'qinglan-addendum': `协议起草时，双方曾讨论是否把所有辅助设备一并纳入换新，但最终签字版没有采纳这个提议。站务组后来制作的速查卡只摘了“18个月”三个字，采购组要求补上非人为故障、主泵和原验收日起算的限定条件。档案目录把签署日期和生效日期分开登记，因为6月签字不意味着6月以前的工单都自动获得新条款。申请换新仍须依照工单材料核实具体故障对象。`,
  'qinglan-incident': `当班记录载明报警初现于06时40分，07时10分完成停机，下午才开始拆检。现场照片只覆盖主泵电机和控制柜，无法证明供应商后来是否安排货车送来新泵。资产台账在这份工单归档时仍标记“申请处理中”，后续可能有其他材料，但本评测资料没有提供。另一张传感器单据上的“已恢复通信”只说明传感器恢复，不应移用到电机换新结论。`,
  'qinglan-drill-plan': `演练方案还指定了观察员记录断电到备用线路接管所需时间，并要求参演者不得跨过临时警戒线。宣传组的观摩安排附在方案末尾，没有负责人的确认签名。运行组在内部邮件中提醒，方案获批只代表允许准备，不是对每个流程环节完成情况的证明。若演练改期，原计划表保留作版本比较，实际日期和执行项目要查阅之后的复盘。`,
  'qinglan-drill-review': `切换计时表显示，10月2日第一次切换用时三分十二秒，第二次切换用时二分五十七秒，观察员在表上签字。计时表只覆盖设备操作，不覆盖会场活动。复盘中列出的二十分钟值班讨论发生在切换动作完成后，不能把它解释成方案拟议的十五分钟开场仪式。档案员把9月14日静态检查单与10月2日演练记录放在不同目录，避免把静态检查误算为一次完整演练。`,
  'qinglan-access': `V2还要求登记查询范围，借阅人只能领取申请表中列出的月份，不能因为审批通过就复制整个档案库。值班主管主要判断用途，资产负责人主要核对资料敏感程度，两道意见均保存在同一张申请单。7月3日那次退回并不说明申请人被永久拒绝，只说明当时材料不全。规程没有赋予协作人员直接修改巡检日志的权限；取用与修改是不同操作。`,
  'qinglan-budget': `预算表把设备采购和施工服务放在不同科目，项目上限里还预留了风险费用。若有人按总额除以设备台数估算单价，也会把培训和管路费用错误摊入主泵价格。财务组要求以合同未遮盖版本和发票核对真实成交价，但这两件原件均不在当前提供的资料里。审计备忘只说明证据缺口，没有暗示价格为零，也没有说明供应商免费交付。`,
  'qinglan-relocation': `会议还讨论了旧泵继续在库房做教学模型的可能性，但没有确定责任人和实施日期。后勤组说运输需要专门包装和资产转移单，任何口头建议都不能代替这两项手续。3月复核后，有人又提议先做安全检测；这仍属于待办事项。资料库里没有后续的检测结果，也没有能把这台旧泵与青蓝北站现有QH-27主泵关联起来的序列号。`,
  'qinglan-neighbor': `青蓝北站的验收简报有单独的站点公章，青岚北站纪要则由另一组人员签署。站务组提醒外部维护人员不要把“青岚”和“青蓝”自动纠正为同一个名称。五月的试运行记录包含控制器参数调整过程，但没有青岚北站设备的保修信息。简报末尾的待办项是培训两名新值班员，与此前四月青岚北站的设备交付无关。`
};
for (const document of documents) document.text += `\n\n${archiveNotes[document.id]}`;

const target = (id, documentId, contains) => ({ id, documentId, contains });
const questions = [
  {
    id: 'narrative-acceptance', split: 'calibration', kind: 'answerable',
    query: '青岚北站QH-27主泵实际是哪天验收的？4月10日是什么日期？',
    expected: '实际2025年4月18日验收；4月10日只是早期预计完工日。',
    evidenceDocumentIds: ['qinglan-acceptance'],
    evidenceTargets: [target('acceptance-date', 'qinglan-acceptance', '最终签字页确认的日期是4月18日')]
  },
  {
    id: 'narrative-warranty', split: 'calibration', kind: 'answerable',
    query: '青岚北站主泵原合同保修和补充协议的免费换新分别如何规定？',
    expected: '原合同主泵整机自验收起保修12个月；补充协议自7月1日起适用，非人为故障免费换新期限为原验收日起18个月，人为损坏不适用。',
    evidenceDocumentIds: ['qinglan-contract', 'qinglan-addendum'],
    evidenceTargets: [target('original-warranty', 'qinglan-contract', '主泵整机自验收签字之日起保修12个月'),
      target('extended-replacement', 'qinglan-addendum', '原验收日起18个月')]
  },
  {
    id: 'narrative-drill', split: 'calibration', kind: 'answerable',
    query: '青岚北站停电切换演练原定何时，实际何时举行？',
    expected: '原定2025年9月14日，因暴雨取消；实际2025年10月2日举行。',
    evidenceDocumentIds: ['qinglan-drill-plan', 'qinglan-drill-review'],
    evidenceTargets: [target('planned-drill', 'qinglan-drill-plan', '计划于9月14日组织'),
      target('actual-drill', 'qinglan-drill-review', '实际于2025年10月2日开展')]
  },
  {
    id: 'narrative-access', split: 'calibration', kind: 'answerable',
    query: '外部协作人员取用青岚北站日志，V1和2025年7月1日起的V2分别需要谁审批？',
    expected: 'V1只需值班主管；V2先由值班主管审核，再由资产负责人二次审批。',
    evidenceDocumentIds: ['qinglan-access'],
    evidenceTargets: [target('old-access', 'qinglan-access', '值班主管可单独签批'),
      target('new-access', 'qinglan-access', '资产负责人二次审批')]
  },
  {
    id: 'narrative-price', split: 'calibration', kind: 'no_answer',
    query: 'QH-27主泵的实际采购单价是多少元？',
    expected: '现有公开摘录没有成交单价，24万元是项目预算上限，不能当作单价。',
    evidenceDocumentIds: ['qinglan-contract', 'qinglan-budget'],
    evidenceTargets: [target('price-redacted', 'qinglan-contract', '单价栏遮盖'),
      target('budget-limit', 'qinglan-budget', '支出上限，不是QH-27主泵的成交单价')]
  },
  {
    id: 'narrative-incident', split: 'holdout', kind: 'answerable',
    query: '2026年1月青岚北站主泵的故障是否满足补充协议免费换新的条件？能说供应商已经换好了吗？',
    expected: '验收日2025年4月18日起18个月内，故障在2026年1月20日且被判定非人为，满足申请条件；只有申请记录，不能说已经换好。',
    evidenceDocumentIds: ['qinglan-acceptance', 'qinglan-addendum', 'qinglan-incident'],
    evidenceTargets: [target('start-date', 'qinglan-acceptance', '2025年4月18日下午'),
      target('replacement-rule', 'qinglan-addendum', '非人为故障时，免费换新的期限调整为原验收日起18个月'),
      target('failure-and-status', 'qinglan-incident', '工单只记录了申请动作')]
  },
  {
    id: 'narrative-neighbor', split: 'holdout', kind: 'answerable',
    query: '青岚北站与青蓝北站的QH-27各在哪天验收？5月6日属于哪一站？',
    expected: '青岚北站2025年4月18日；青蓝北站2025年5月6日，5月6日属于青蓝北站。',
    evidenceDocumentIds: ['qinglan-acceptance', 'qinglan-neighbor'],
    evidenceTargets: [target('qinglan-date', 'qinglan-acceptance', '2025年4月18日下午'),
      target('qinglan-neighbor-date', 'qinglan-neighbor', '三方验收日期为2025年5月6日')]
  },
  {
    id: 'narrative-relocation', split: 'holdout', kind: 'answerable',
    query: '旧备用泵是否已经从青岚北站运到青蓝北站？请区分提议和后续记录。',
    expected: '只是提出迁移建议；3月资产组未批准，暂不运输，现有资料不能说已经运到。',
    evidenceDocumentIds: ['qinglan-relocation'],
    evidenceTargets: [target('relocation-proposal', 'qinglan-relocation', '待评估建议'),
      target('relocation-followup', 'qinglan-relocation', '资产组仍未批准迁移')]
  },
  {
    id: 'narrative-ceremony', split: 'holdout', kind: 'no_answer',
    query: '10月2日青岚北站演练开始前，十五分钟启动仪式实际举行了吗？',
    expected: '演练举行了，但资料没有记录启动仪式是否举行，不能肯定或否定。',
    evidenceDocumentIds: ['qinglan-drill-plan', 'qinglan-drill-review'],
    evidenceTargets: [target('ceremony-proposal', 'qinglan-drill-plan', '提议在演练开始前设置十五分钟的启动仪式'),
      target('ceremony-unrecorded', 'qinglan-drill-review', '没有记录宣传组提议的启动仪式是否在10月2日举行')]
  },
  {
    id: 'narrative-old-serial', split: 'holdout', kind: 'no_answer',
    query: '青岚北站被拆下的旧备用泵序列号是多少？',
    expected: '验收附件和迁移纪要均未给出旧泵序列号。',
    evidenceDocumentIds: ['qinglan-acceptance', 'qinglan-relocation'],
    evidenceTargets: [target('serial-absent-a', 'qinglan-acceptance', '没有列出被拆旧泵的序列号'),
      target('serial-absent-b', 'qinglan-relocation', '文件没有旧泵序列号')]
  }
];

module.exports = { id: 'narrative-v1', description: '十份虚构自然叙述资料，固定十题，检验跨文档、相近站名、时态与拒答',
  documents, questions };
