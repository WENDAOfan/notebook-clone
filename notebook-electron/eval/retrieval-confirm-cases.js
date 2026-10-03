// Frozen before the comparative-query regression repair. Uneven corpus families.
const documents = [
  { id: 'summer', title: '夏湾档案', text: '夏湾展馆的消防复验于2026年2月7日通过，登记号HY-27。参观者应从南门进入。' },
  { id: 'similar', title: '厦湾档案', text: '厦湾展馆的消防复验于2026年3月9日通过，登记号XY-39。参观者应从西门进入。' },
  { id: 'summer-price', title: '夏湾票务说明', text: '夏湾展馆普通票定价为26元，团体票尚未公布价格。普通票金额不能作为团体价格。' },
  { id: 'similar-price', title: '厦湾票务说明', text: '厦湾展馆普通票定价为38元，团体票每人29元。' },
  { id: 'private', title: '工作人员备忘', text: '石榆展馆周三闭馆，其余日期正常开放。周三不接受预约参观。' },
  { id: 'quiet', title: '入场须知', text: '手提行李超过四十厘米需先放入寄存柜，再进入展厅。贵重物品自行保管。' },
  { id: 'support', title: '远程服务说明', text: '游客遗失纸质票据时，可以出示购票订单中的二维码重新验证入场资格。' },
  { id: 'warranty', title: '南港馆条款', text: '南港馆的LT-8投影机保修14个月，时间从正式签收当天开始计算。' },
  { id: 'signed', title: '南港馆交接单', text: '该馆投影机于2026年1月8日正式签收。交接单未再次填写设备型号。' },
  { id: 'wrong-code', title: 'LT-80条款', text: 'LT-80投影机保修60个月，与LT-8无关。' }
];
for (let i = 0; i < 30; i++) documents.push({ id: `noise-${i}`, title: `夏湾工作记录第${i + 1}号`,
  text: `夏湾展馆资料室第${i + 1}号记录：本月完成灯具清洁和储物柜整理，登记号QA-${i + 1}。记录不涉及复验时间或票价。` });
const q = (id, kind, query, expected, targets) => ({ id, split: 'holdout', kind, query, expected,
  evidenceTargets: targets.map(([documentId, contains]) => ({ id: documentId, documentId, contains })),
  evidenceDocumentIds: targets.map(([documentId]) => documentId) });
const questions = [
  q('confirm-dates', 'answerable', '夏湾展馆和厦湾展馆分别在哪天通过消防复验？', '夏湾2026年2月7日，厦湾2026年3月9日。', [['summer', '2026年2月7日通过'], ['similar', '2026年3月9日通过']]),
  q('confirm-price', 'answerable', '夏湾和厦湾的普通票价分别是多少？', '26元和38元。', [['summer-price', '普通票定价为26元'], ['similar-price', '普通票定价为38元']]),
  q('confirm-sparse', 'answerable', '厦湾展馆游客走哪个入口？', '西门。', [['similar', '参观者应从西门进入']]),
  q('confirm-code', 'answerable', '南港馆LT-8保修多久，从哪天开始？', '14个月，从2026年1月8日起。', [['warranty', '保修14个月'], ['signed', '2026年1月8日正式签收']]),
  q('confirm-body', 'answerable', '石榆展馆每星期哪天不接待游客？', '周三。', [['private', '石榆展馆周三闭馆']]),
  q('confirm-semantic', 'answerable', '门票找不到了，手机买票记录能不能帮我进场？', '可出示购票订单二维码重新验证。', [['support', '购票订单中的二维码重新验证入场资格']]),
  q('confirm-bag', 'answerable', '我带了一个五十厘米的手提包，能直接带进展厅吗？', '不能，超过四十厘米需要先寄存。', [['quiet', '超过四十厘米需先放入寄存柜']]),
  q('confirm-group-unknown', 'no_answer', '夏湾展馆团体票每人多少钱？', '尚未公布，不能套用普通票价。', [['summer-price', '团体票尚未公布价格']]),
  q('confirm-groups', 'answerable', '夏湾和厦湾的团体票价都公开了吗？', '夏湾未公开，厦湾29元每人。', [['summer-price', '团体票尚未公布价格'], ['similar-price', '团体票每人29元']]),
  q('confirm-group-known', 'answerable', '厦湾展馆团体参观每人多少钱？', '29元。', [['similar-price', '团体票每人29元']])
];
module.exports = { id: 'retrieval-confirm-v1', documents, questions };
