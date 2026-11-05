import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { parsePages, mergePdfs, extractPdf, compareText } from '../src/tools.js';

async function fixture(widths) {
  const doc = await PDFDocument.create();
  for (const width of widths) doc.addPage([width, 500]);
  return doc.save();
}
async function widths(bytes) { return (await PDFDocument.load(bytes)).getPages().map(page => page.getWidth()); }

test('page ranges: preserve user order, deduplicate, validate boundaries', () => {
  assert.deepEqual(parsePages('3, 1-2，2', 3), [2,0,1]);
  for (const invalid of ['', '0', '1-4', '3-1', '1,,2', '-1', 'two', '1.5']) assert.throws(() => parsePages(invalid,3));
});
test('merge copies real pages in selected file order', async () => {
  const first = await fixture([200,300]), second = await fixture([400]);
  assert.deepEqual(await widths(await mergePdfs([first,second])), [200,300,400]);
  assert.deepEqual(await widths(await mergePdfs([second,first])), [400,200,300]);
  await assert.rejects(mergePdfs([first]));
});
test('extract preserves requested page order and ZIP contains valid independent PDFs', async () => {
  const input = await fixture([200,300,400]);
  assert.deepEqual(await widths(await extractPdf(input,[2,0])), [400,200]);
  const entries = unzipSync(await extractPdf(input,[2,0],true));
  assert.deepEqual(Object.keys(entries), ['page-003.pdf','page-001.pdf']);
  assert.deepEqual(await widths(entries['page-003.pdf']), [400]);
  assert.deepEqual(await widths(entries['page-001.pdf']), [200]);
  await assert.rejects(extractPdf(input,[3]));
});
test('invalid PDF fails clearly', async () => {
  await assert.rejects(mergePdfs([new Uint8Array([1,2,3]),await fixture([200])]), /无法读取/);
});
test('Chinese, emoji and newline differences reconstruct both original inputs', () => {
  for (const mode of ['chars','lines']) {
    const before = '你好🌱\n保留\n旧内容', after = '你好🌿\n保留\n新内容\n';
    const parts = compareText(before,after,mode);
    assert.equal(parts.filter(p => !p.added).map(p=>p.value).join(''),before);
    assert.equal(parts.filter(p => !p.removed).map(p=>p.value).join(''),after);
  }
  assert.deepEqual(compareText('相同','相同').map(p=>p.value),['相同']);
  assert.throws(() => compareText('a'.repeat(80001),''), /8 万/);
});
