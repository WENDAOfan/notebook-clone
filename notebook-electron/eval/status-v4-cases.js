// Frozen before the first online run. Distinguishes missing completion records
// from explicit non-completion and explicitly completed replacement.
const documents = [
  { id: 'jy-east', title: '霁云东站换新跟踪单',
    text: '霁云东站在2026年4月2日提交了主泵免费换新申请。截至2026年6月1日，档案中没有供应商完成换新的交接记录。跟踪单未附现场复核结果。' },
  { id: 'jy-west', title: '霁云西站现场复核单',
    text: '霁云西站在2026年4月2日提交了主泵免费换新申请。2026年6月1日现场复核确认供应商尚未实施换新，旧设备仍在原位。' },
  { id: 'jl-east', title: '霁蓝东站换新交接单',
    text: '霁蓝东站在2026年4月2日提交了主泵免费换新申请。供应商于2026年5月20日完成新主泵安装，三方于当日签署换新交接单。' },
  { id: 'jl-west', title: '霁蓝西站维修台账',
    text: '霁蓝西站在2026年5月3日提出主泵免费换新申请。截至2026年6月20日，维修台账没有换新完成单，也没有近期现场复核结果。' },
  { id: 'cy-east', title: '澄云东站现场核查记录',
    text: '澄云东站在2026年5月3日提出主泵免费换新申请。2026年6月20日现场核查确认替换设备仍未送达，主泵换新尚未实施。' },
  { id: 'cy-west', title: '澄云西站设备交接记录',
    text: '澄云西站在2026年5月3日提出主泵免费换新申请。供应商已于2026年6月10日完成换新，设备交接记录由双方签字确认。' }
];

const question = (id, split, kind, query, expected, documentId, contains) => ({
  id, split, kind, query, expected, evidenceDocumentIds: [documentId],
  evidenceTargets: [{ id: 'status', documentId, contains }]
});
const questions = [
  question('jy-east-record-gap', 'calibration', 'no_answer',
    '霁云东站主泵换新截至2026年6月1日究竟已经完成还是尚未完成？',
    '只知道已提交申请、档案没有完成交接记录；无法确认现场实际是否完成。',
    'jy-east', '档案中没有供应商完成换新的交接记录'),
  question('jy-west-not-done', 'calibration', 'answerable',
    '霁云西站主泵换新截至2026年6月1日完成了吗？',
    '现场复核明确确认尚未实施换新。',
    'jy-west', '现场复核确认供应商尚未实施换新'),
  question('jl-east-done', 'calibration', 'answerable',
    '霁蓝东站的主泵换新是否已经完成？',
    '2026年5月20日完成安装，三方签署交接单。',
    'jl-east', '2026年5月20日完成新主泵安装'),
  question('jl-west-record-gap', 'holdout', 'no_answer',
    '霁蓝西站到2026年6月20日主泵到底换好了没有？',
    '只有申请和缺少完成单、现场复核的记录；无法确认实际是否换好。',
    'jl-west', '维修台账没有换新完成单，也没有近期现场复核结果'),
  question('cy-east-not-done', 'holdout', 'answerable',
    '澄云东站到2026年6月20日主泵换新完成了吗？',
    '现场核查明确确认替换设备未送达、换新尚未实施。',
    'cy-east', '现场核查确认替换设备仍未送达，主泵换新尚未实施'),
  question('cy-west-done', 'holdout', 'answerable',
    '澄云西站的主泵换新有没有完成并交接？',
    '2026年6月10日完成换新，双方签字确认交接。',
    'cy-west', '2026年6月10日完成换新，设备交接记录由双方签字确认')
];

module.exports = { id: 'status-v4', description: '缺少完成记录、明确未完成、明确已完成的成对状态边界',
  documents, questions };
