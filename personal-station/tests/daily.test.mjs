import test from 'node:test';
import assert from 'node:assert/strict';
import { convertUnit, tidyExcerpt, readingMarkdown } from '../src/daily-tools.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
test('engineering and everyday conversions preserve known values', () => {
  near(convertUnit(180, 'angle', 'deg', 'rad'), Math.PI);
  near(convertUnit(60, 'rotation', 'rpm', 'rad/s'), Math.PI * 2);
  near(convertUnit(36, 'speed', 'km/h', 'm/s'), 10);
  near(convertUnit(1, 'mass', 'jin', 'kg'), .5);
  near(convertUnit(1, 'length', 'in', 'mm'), 25.4);
  near(convertUnit(1, 'data', 'MiB', 'MB'), 1.048576);
  near(convertUnit(32, 'temperature', 'F', 'C'), 0);
  near(convertUnit(0, 'temperature', 'K', 'C'), -273.15);
  near(convertUnit(-40, 'temperature', 'C', 'F'), -40);
  near(convertUnit('1e3', 'time', 'ms', 's'), 1);
});
test('invalid, cross-category and overflow inputs cannot produce misleading results', () => {
  for (const value of ['', ' ', 'abc', 'Infinity', '1e999']) assert.throws(() => convertUnit(value, 'length', 'm', 'cm'));
  assert.throws(() => convertUnit(1, 'length', 'm', 'kg'));
  assert.throws(() => convertUnit(-1, 'temperature', 'K', 'C'));
  assert.throws(() => convertUnit('1e308', 'length', 'km', 'mm'));
});
test('excerpt cleanup is opt-in for line joining and preserves paragraph boundaries', () => {
  const input = '  第一行\r\n 第二行  \r\n\r\n\r\n下一段  ';
  assert.equal(tidyExcerpt(input), '第一行\n第二行\n\n下一段');
  assert.equal(tidyExcerpt(input, true), '第一行 第二行\n\n下一段');
});
test('Markdown export separates source, original excerpt and personal response', () => {
  const md = readingMarkdown({title:'阅读 [测试]', source:'示例书，第 3 页', excerpt:'原文 😀\n\n第二段', thought:'我的理解', date:'2026-10-26'});
  assert.ok(md.includes('# 阅读 \\[测试\\]'));
  assert.ok(md.includes('来源 / 书名：示例书，第 3 页'));
  assert.ok(md.includes('> 原文 😀\n> \n> 第二段'));
  assert.ok(md.includes('## 我的想法\n\n我的理解'));
  assert.throws(() => readingMarkdown({title:'', excerpt:'有内容'}));
});
