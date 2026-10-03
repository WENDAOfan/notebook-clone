const { cleanText } = require('./text-cleaner');

/** Keep a usable text layer, and OCR only pages with no extracted text. */
async function extractLocalPdf(filePath, LiteParse) {
  const native = await new LiteParse({ ocrEnabled: false, quiet: true }).parse(filePath);
  const pages = native.pages || [];
  const emptyPages = pages.filter(page => !cleanText(page.text || '')).map(page => page.pageNum);
  let ocrByPage = new Map();
  if (emptyPages.length) {
    const ocr = await new LiteParse({ ocrLanguage: 'chi_sim',
      targetPages: emptyPages.join(','), quiet: true }).parse(filePath);
    ocrByPage = new Map(ocr.pages.map(page => [page.pageNum, page.text || '']));
    for (const pageNum of emptyPages) {
      if (!ocrByPage.has(pageNum)) throw new Error(`PDF OCR 未返回第 ${pageNum} 页`);
    }
  }
  const text = pages.map(page => cleanText(page.text || '')
    ? page.text : ocrByPage.get(page.pageNum) || '').join('\n\n');
  if (!cleanText(text)) throw new Error('PDF文本提取为空，无法用于问答');
  return text;
}

module.exports = { extractLocalPdf };
