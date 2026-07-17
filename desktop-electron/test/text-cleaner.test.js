const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanText } = require('../text-cleaner');

test('cleanText 删除控制字符，但保留换行和制表符内容', () => {
  const result = cleanText('  第一行\x00\x07  \n\t第二行\t  ');

  assert.equal(result, '第一行\n第二行');
});

test('cleanText 删除出现三次及以上的重复页眉', () => {
  const input = [
    '课程讲义', '第一部分',
    '课程讲义', '第二部分',
    '课程讲义', '第三部分'
  ].join('\n');

  assert.equal(cleanText(input), '第一部分\n第二部分\n第三部分');
});

test('cleanText 删除空格比例过高的疑似水印行', () => {
  const input = '正常正文\n水 印 文 字 水 印 文 字\n另一段正文';

  assert.equal(cleanText(input), '正常正文\n另一段正文');
});

test('cleanText 将三个以上连续换行规整为两个', () => {
  assert.equal(cleanText('第一段\n\n\n\n第二段'), '第一段\n\n第二段');
});

test('cleanText 对 null、undefined 和空字符串返回空文本', () => {
  assert.equal(cleanText(null), '');
  assert.equal(cleanText(undefined), '');
  assert.equal(cleanText(''), '');
});

