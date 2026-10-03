// Fixed before any model-reranking trial. Fictional long documents only.
const specs = [
  { id: 'a', title: '沉湾场馆运行纪要', facts: {
    11: '沉湾场馆的RX-19照明系统实际签收日为2026年1月12日。',
    44: '沉湾场馆设备室温度上限为32摄氏度，超过上限必须暂停运行。' } },
  { id: 'b', title: '尘湾场馆运行纪要', facts: {
    13: '尘湾场馆的RX-19照明系统实际签收日为2026年2月18日。',
    46: '尘湾场馆设备室温度上限为29摄氏度，超过上限必须暂停运行。' } },
  { id: 'contract', title: '沉湾场馆采购条款', facts: {
    21: '原采购条款规定沉湾场馆照明系统整机保修10个月。',
    49: '本合同摘录未提供单台设备成交价格，不能用项目预算替代。' } },
  { id: 'amendment', title: '沉湾场馆后续协议', facts: {
    25: '后续协议将沉湾场馆照明系统正常使用故障的免费维修期延长到实际签收日起16个月，人为损坏不适用。',
    51: '维护时应先切断主电源，再由两名值班员共同确认设备停止运转。' } },
  { id: 'access', title: '沉湾场馆归档规程', facts: {
    15: '2026年4月1日前，借阅沉湾场馆原始档案只需档案主管签字。',
    41: '2026年4月1日起，借阅沉湾场馆原始档案须档案主管和安全员共同签字，旧审批办法停止适用。' } },
  { id: 'safety', title: '现场操作说明', facts: {
    18: '便携终端被雨水淋湿后，必须关机并断开充电线，待专业人员检查后才能再次通电。',
    47: '本说明没有记录旧便携终端的出厂序列号。' } }
];
const documents = specs.map(spec => ({ id: spec.id, title: spec.title,
  text: Array.from({ length: 60 }, (_, i) => {
    const n = i + 1;
    return `${spec.title}第${n}节例行登记。本节记录室内整理、标牌清洁、资料装订及物品归位；登记员核对了储物格与设备柜，相关照片按日期归档。此项登记只证明当班完成例行核查，不表示其他项目已完成验收，不对其他场馆的规定作结论。记录号${spec.id.toUpperCase()}-${n}。`
      + (spec.facts[n] ? `\n\n${spec.facts[n]}` : '');
  }).join('\n\n') }));
const target = (doc, section) => ({ id: `${doc}-${section}`, documentId: doc,
  contains: specs.find(item => item.id === doc).facts[section] });
const q = (id, query, expected, evidenceTargets, kind = 'answerable') => ({
  id, split: 'holdout', kind, query, expected, evidenceTargets,
  evidenceDocumentIds: [...new Set(evidenceTargets.map(t => t.documentId))] });
const questions = [
  q('lr-a-date', '沉湾场馆RX-19实际签收日是哪天？', '2026年1月12日。', [target('a', 11)]),
  q('lr-b-date', '尘湾场馆RX-19实际签收日是哪天？', '2026年2月18日。', [target('b', 13)]),
  q('lr-a-temp', '沉湾场馆设备室达到多高温度以上需要暂停运行？', '超过32摄氏度。', [target('a', 44)]),
  q('lr-b-temp', '尘湾场馆设备室的温度上限是多少？', '29摄氏度。', [target('b', 46)]),
  q('lr-amendment', '沉湾场馆后续协议规定的免费维修期限和适用条件是什么？', '实际签收日起16个月，正常使用故障，人为损坏不适用。', [target('amendment', 25)]),
  q('lr-power', '沉湾场馆维护设备时先做什么、由谁确认停机？', '先切断主电源，由两名值班员共同确认。', [target('amendment', 51)]),
  q('lr-current', '2026年4月1日以后沉湾场馆原始档案借阅要谁签字？', '档案主管和安全员。', [target('access', 41)]),
  q('lr-semantic', '手持设备进水了，我能马上插上电源试试看吗？', '不能；先关机断开充电线，经专业检查再通电。', [target('safety', 18)]),
  q('lr-cross', '沉湾场馆原采购条款和后续协议分别规定多久保修或免费维修？', '原条款10个月，后续协议正常使用故障维修为实际签收日起16个月。', [target('contract', 21), target('amendment', 25)]),
  q('lr-same-doc', '沉湾场馆归档规程旧版和2026年4月起的新办法分别要谁批准？', '旧版档案主管，新版档案主管加安全员。', [target('access', 15), target('access', 41)]),
  q('lr-price', '沉湾场馆RX-19单台设备成交价格是多少？', '摘录未提供，不能用项目预算替代。', [target('contract', 49)], 'no_answer'),
  q('lr-serial', '旧便携终端出厂序列号是什么？', '说明没有记录。', [target('safety', 47)], 'no_answer')
];
module.exports = { id: 'long-ranking-holdout-v1', documents, questions };
