import test from 'node:test';
import assert from 'node:assert/strict';
import { searchEntries, readFavorites } from '../src/discovery.js';

test('search ranks titles first and matches every normalized word', () => {
  const entries = [
    {id:'a', title:'图像工具', detail:'PDF 图片转换'},
    {id:'b', title:'PDF 工作台', detail:'文件合并与提取'},
    {id:'c', title:'阅读', detail:'摘录整理', tags:['C++'], url:'https://example.org/notes'}
  ];
  assert.deepEqual(searchEntries(entries, 'ＰＤＦ').map(item => item.id), ['b','a']);
  assert.deepEqual(searchEntries(entries, 'pdf 合并').map(item => item.id), ['b']);
  assert.deepEqual(searchEntries(entries, 'C++').map(item => item.id), ['c']);
  assert.deepEqual(searchEntries(entries, 'example.org').map(item => item.id), ['c']);
  assert.deepEqual(searchEntries(entries, 'not-found'), []);
  assert.deepEqual(searchEntries(entries, ''), entries);
});
test('malformed or obsolete favorite preferences do not break the directory', () => {
  const allowed = ['pdf','image','excerpt'];
  assert.deepEqual(readFavorites('{broken', allowed), []);
  assert.deepEqual(readFavorites('{"pdf":true}', allowed), []);
  assert.deepEqual(readFavorites('["pdf","unknown",null,3,"image","pdf"]', allowed), ['pdf','image']);
  assert.deepEqual(readFavorites(null, allowed), []);
});
