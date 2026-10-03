// Fixed questions for the production local-PDF parsing, indexing and Q&A path.
// The fixture PDFs are fictional, generated locally and excluded from Git.
module.exports = {
  id: 'pdf-local-v1',
  parserMode: 'local-pdf',
  documents: [
    {
      id: 'mixed', title: '混合 PDF 保修资料', fixtureFile: 'mixed-text-scan.pdf',
      text: '星桥X4整机保修期为30个月，核心部件保修期为42个月。\n'
        + 'Scanned fictional document: warranty 12 months.',
      expectedFacts: [
        '星桥X4整机保修期为30个月，核心部件保修期为42个月。',
        'Scanned fictional document: warranty 12 months.'
      ]
    },
    {
      id: 'x8', title: '星桥X8产品政策', fixtureFile: 'product-8.pdf',
      text: '星桥X8整机保修期为54个月，核心部件保修期为66个月。',
      expectedFacts: ['星桥X8整机保修期为54个月，核心部件保修期为66个月。']
    },
    {
      id: 'scan-zh', title: '星桥X9扫描资料', fixtureFile: 'scan-zh.pdf',
      text: '星桥X9整机保修期为15个月。',
      expectedFacts: ['星桥X9整机保修期为15个月。'],
      normalizeWhitespace: true
    }
  ],
  questions: [
    {
      id: 'x4-text-layer', split: 'calibration', kind: 'answerable',
      query: '星桥X4的整机保修期是多少个月？', expected: '30个月',
      evidenceDocumentIds: ['mixed'],
      evidenceTargets: [{ id: 'x4-policy', documentId: 'mixed',
        contains: '星桥X4整机保修期为30个月，核心部件保修期为42个月。' }]
    },
    {
      id: 'english-scan', split: 'calibration', kind: 'answerable',
      query: '混合 PDF 第二页英文扫描件写的 warranty 是多少个月？', expected: '12个月',
      evidenceDocumentIds: ['mixed'],
      evidenceTargets: [{ id: 'english-scan-line', documentId: 'mixed',
        contains: 'Scanned fictional document: warranty 12 months.' }]
    },
    {
      id: 'x8-text-layer', split: 'holdout', kind: 'answerable',
      query: '星桥X8核心部件的保修期是几个月？', expected: '66个月',
      evidenceDocumentIds: ['x8'],
      evidenceTargets: [{ id: 'x8-policy', documentId: 'x8',
        contains: '星桥X8整机保修期为54个月，核心部件保修期为66个月。' }]
    },
    {
      id: 'chinese-scan', split: 'holdout', kind: 'answerable',
      query: '星桥X9的整机保修期是多少个月？', expected: '15个月',
      evidenceDocumentIds: ['scan-zh'],
      evidenceTargets: [{ id: 'x9-scan-line', documentId: 'scan-zh',
        contains: '星桥X9整机保修期为15个月。', normalizeWhitespace: true }]
    },
    {
      id: 'cross-pdf', split: 'holdout', kind: 'answerable',
      query: '比较星桥X4和星桥X8的整机保修期，分别是几个月？', expected: 'X4为30个月，X8为54个月',
      evidenceDocumentIds: ['mixed', 'x8'],
      evidenceTargets: [
        { id: 'x4-policy', documentId: 'mixed',
          contains: '星桥X4整机保修期为30个月，核心部件保修期为42个月。' },
        { id: 'x8-policy', documentId: 'x8',
          contains: '星桥X8整机保修期为54个月，核心部件保修期为66个月。' }
      ]
    },
    {
      id: 'missing-x9-component', split: 'holdout', kind: 'no_answer',
      query: '星桥X9核心部件保修期是多少个月？', expected: '资料未提供，不能确定',
      evidenceDocumentIds: ['scan-zh'], evidenceTargets: []
    }
  ]
};
