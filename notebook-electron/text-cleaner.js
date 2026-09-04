/**
 * 过滤疑似水印的行：字符间有大量空格且长度较长。
 */
function removeWatermarkLines(text) {
  return text.split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.length < 12) return true;
      const spaceCount = (trimmed.match(/ /g) || []).length;
      const spaceRatio = spaceCount / trimmed.length;
      return spaceRatio <= 0.4;
    })
    .join('\n');
}

/**
 * 去除非空且重复出现 3 次以上的行（通常是页眉、页脚或水印）。
 */
function removeRepeatedLines(text) {
  const lines = text.split('\n');
  const lineCounts = {};

  for (const line of lines) {
    const stripped = line.trim();
    if (stripped) {
      lineCounts[stripped] = (lineCounts[stripped] || 0) + 1;
    }
  }

  return lines
    .filter(line => {
      const stripped = line.trim();
      if (!stripped) return true;
      return (lineCounts[stripped] || 0) < 3;
    })
    .join('\n');
}

/**
 * 清洗提取后的文本，同时保留换行、回车和制表符等有意义的排版字符。
 */
function cleanText(raw) {
  if (!raw) return '';

  let cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  cleaned = removeWatermarkLines(cleaned);
  cleaned = removeRepeatedLines(cleaned);
  cleaned = cleaned.split('\n')
    .map(line => line.trim())
    .join('\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

module.exports = {
  cleanText,
  removeRepeatedLines,
  removeWatermarkLines
};

