import { PDFDocument } from 'pdf-lib';
import { diffChars, diffLines } from 'diff';
import { zipSync } from 'fflate';

export function parsePages(raw, total) {
  if (!Number.isSafeInteger(total) || total < 1) throw new Error('PDF 没有可用页面');
  if (!raw.trim()) throw new Error('请填写页码，例如 1-3, 5');
  const selected = [];
  for (const part of raw.replace(/，/g, ',').split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('页码格式有误，请使用 1-3, 5 这样的写法');
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (first < 1 || last > total || first > last) throw new Error('页码应在 1 至 ' + total + ' 之间，范围从小到大填写');
    for (let i = first; i <= last; i++) if (!selected.includes(i - 1)) selected.push(i - 1);
  }
  return selected;
}

export async function loadPdf(data) {
  try { return await PDFDocument.load(data); }
  catch { throw new Error('无法读取这个 PDF。它可能损坏或有密码；请先解密后重试。'); }
}
export async function mergePdfs(buffers) {
  if (buffers.length < 2) throw new Error('合并需要至少两个 PDF');
  const out = await PDFDocument.create();
  for (const buffer of buffers) {
    const input = await loadPdf(buffer);
    const pages = await out.copyPages(input, input.getPageIndices());
    pages.forEach(page => out.addPage(page));
  }
  return out.save();
}
export async function extractPdf(buffer, pages, separate = false) {
  const input = await loadPdf(buffer);
  if (!pages.length || pages.some(p => !Number.isSafeInteger(p) || p < 0 || p >= input.getPageCount())) throw new Error('选择的页码无效');
  if (separate) {
    const entries = {};
    for (const page of pages) {
      const out = await PDFDocument.create();
      const [copied] = await out.copyPages(input, [page]); out.addPage(copied);
      entries['page-' + String(page + 1).padStart(3, '0') + '.pdf'] = await out.save();
    }
    return zipSync(entries, { level: 0 });
  }
  const out = await PDFDocument.create();
  (await out.copyPages(input, pages)).forEach(page => out.addPage(page));
  return out.save();
}
export function compareText(before, after, mode = 'chars') {
  if (before.length + after.length > 80000) throw new Error('首版每次支持合计 8 万字符，请分段比较');
  const result = (mode === 'lines' ? diffLines : diffChars)(before, after, { timeout: 1500 });
  if (!result) throw new Error('两段文本差异过大，计算已停止。请缩短内容或改为按行比较。');
  return result;
}
