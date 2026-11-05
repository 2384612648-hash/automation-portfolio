import { $, $$, icon, esc, bytes, download, showStatus } from './shared.js';
import { loadPdf, mergePdfs, extractPdf, parsePages, compareText } from './tools.js';

const drop = (id, accept, title, hint, multiple = false) => '<button class="dropzone" type="button" id="' + id + '-drop">' + icon('upload') + '<strong>' + title + '</strong><small>' + hint + '</small></button><input id="' + id + '-input" type="file" accept="' + accept + '" ' + (multiple ? 'multiple' : '') + ' hidden>';
function bindDrop(id, handler) {
  const zone = $('#' + id + '-drop'), input = $('#' + id + '-input');
  zone.onclick = () => input.click();
  input.onchange = () => { if (input.files.length) handler([...input.files]); input.value = ''; };
  zone.ondragover = event => { event.preventDefault(); zone.classList.add('dragging'); };
  zone.ondragleave = () => zone.classList.remove('dragging');
  zone.ondrop = event => { event.preventDefault(); zone.classList.remove('dragging'); if (!zone.disabled) handler([...event.dataTransfer.files]); };
}

export function mountPdf(container) {
  let mode = 'merge', files = [], busy = false, disposed = false;
  container.innerHTML = '<div class="tool-tabs" role="group" aria-label="PDF 操作"><button class="active" data-mode="merge">合并 PDF</button><button data-mode="split">拆分 / 提取页面</button></div><p class="tool-description" id="pdf-description"></p>' + drop('pdf', '.pdf,application/pdf', '点击选择，或把 PDF 拖到这里', '单次总计不超过 80 MB；不支持加密 PDF', true) + '<ol class="file-list" id="pdf-files"></ol><div id="pdf-split-controls" hidden><label>提取哪些页面？<input id="pdf-pages" placeholder="例如：1-3, 5, 8-10" aria-describedby="pdf-page-hint"></label><p id="pdf-page-hint" class="tool-description">按填写顺序提取；重复页码会自动去重。</p><label class="checkbox"><input id="pdf-separate" type="checkbox">每页单独生成 PDF，打包为 ZIP</label></div><div class="tool-actions"><button class="button primary" id="pdf-run" disabled>' + icon('download') + '<span>合并并下载</span></button><button class="button subtle" id="pdf-clear">清空文件</button></div><p class="tool-status" id="pdf-status" role="status"></p><div class="notice">处理过程在浏览器内完成。导出的 PDF 以页面内容为主，原文件的书签、复杂表单或数字签名可能无法保留，请核对重要文档。</div>';
  const status = $('#pdf-status', container);
  function render() {
    $('#pdf-description', container).textContent = mode === 'merge' ? '把多个 PDF 合成一份。文件从上到下，决定合并后的页面顺序。' : '选择一个 PDF，提取指定页码，或将每一页拆成独立文件。';
    $$('[data-mode]', container).forEach(button => { button.classList.toggle('active', button.dataset.mode === mode); button.disabled = busy; });
    $('#pdf-input', container).multiple = mode === 'merge';
    $('#pdf-drop', container).disabled = busy;
    $('#pdf-clear', container).disabled = busy || !files.length;
    $('#pdf-split-controls', container).hidden = mode !== 'split';
    $('#pdf-run', container).disabled = busy || (mode === 'merge' ? files.length < 2 : files.length !== 1);
    $('#pdf-run span', container).textContent = busy ? '处理中…' : mode === 'merge' ? '合并并下载' : '提取并下载';
    $('#pdf-files', container).innerHTML = files.map((file, index) => '<li class="file-row">' + icon('file') + '<div class="file-info"><span class="file-name" title="' + esc(file.name) + '">' + esc(file.name) + '</span><small>' + file.pages + ' 页 · ' + bytes(file.size) + '</small></div>' + (mode === 'merge' ? '<button class="icon-button" data-move="-1" data-index="' + index + '" title="上移" aria-label="上移 ' + esc(file.name) + '" ' + (index === 0 || busy ? 'disabled' : '') + '>' + icon('up') + '</button><button class="icon-button" data-move="1" data-index="' + index + '" title="下移" aria-label="下移 ' + esc(file.name) + '" ' + (index === files.length - 1 || busy ? 'disabled' : '') + '>' + icon('down') + '</button>' : '') + '<button class="icon-button" data-remove="' + index + '" title="移除" aria-label="移除 ' + esc(file.name) + '" ' + (busy ? 'disabled' : '') + '>' + icon('x') + '</button></li>').join('');
  }
  $$('[data-mode]', container).forEach(button => button.onclick = () => {
    if (busy || mode === button.dataset.mode) return;
    mode = button.dataset.mode; files = []; $('#pdf-pages', container).value = ''; showStatus(status, ''); render();
  });
  bindDrop('pdf', async incoming => {
    if (busy) return;
    if (mode === 'split' && incoming.length > 1) return showStatus(status, '拆分时请一次选择一个 PDF。', true);
    const total = incoming.reduce((sum, file) => sum + file.size, 0) + (mode === 'merge' ? files.reduce((sum, file) => sum + file.size, 0) : 0);
    if (total > 80 * 1024 ** 2 || files.length + incoming.length > 50) return showStatus(status, '单次最多 50 个文件，总大小不超过 80 MB。', true);
    busy = true; render(); showStatus(status, '正在读取 PDF…');
    const added = [], errors = [];
    for (const file of incoming) {
      try {
        if (!/\.pdf$/i.test(file.name)) throw new Error('请选择 PDF 文件');
        const buffer = await file.arrayBuffer();
        const doc = await loadPdf(buffer);
        if (doc.getPageCount() < 1) throw new Error('文件中没有页面');
        added.push({ name: file.name, size: file.size, buffer, pages: doc.getPageCount() });
      } catch (error) { errors.push(file.name + '：' + error.message); }
    }
    if (disposed) return;
    if (mode === 'split') {
      if (added.length) { files = added; $('#pdf-pages', container).value = '1-' + added[0].pages; }
    } else files.push(...added);
    busy = false; render(); showStatus(status, errors.length ? errors.join('；') : '已读取 ' + files.length + ' 个文件，共 ' + files.reduce((sum, file) => sum + file.pages, 0) + ' 页。', !!errors.length);
  });
  $('#pdf-files', container).onclick = event => {
    const button = event.target.closest('button'); if (!button || busy) return;
    if (button.dataset.remove !== undefined) files.splice(Number(button.dataset.remove), 1);
    else {
      const a = Number(button.dataset.index), b = a + Number(button.dataset.move);
      if (b >= 0 && b < files.length) [files[a], files[b]] = [files[b], files[a]];
    }
    showStatus(status, ''); render();
  };
  $('#pdf-clear', container).onclick = () => { if (!busy) { files = []; render(); showStatus(status, ''); } };
  $('#pdf-run', container).onclick = async () => {
    if (busy) return;
    busy = true; render(); showStatus(status, '正在处理，请保持当前页面打开…');
    await new Promise(resolve => setTimeout(resolve, 30));
    try {
      const separate = $('#pdf-separate', container).checked;
      const output = mode === 'merge' ? await mergePdfs(files.map(file => file.buffer)) : await extractPdf(files[0].buffer, parsePages($('#pdf-pages', container).value, files[0].pages), separate);
      if (disposed) return;
      const zipped = mode === 'split' && separate;
      download(new Blob([output], { type: zipped ? 'application/zip' : 'application/pdf' }), mode === 'merge' ? '零域-合并.pdf' : files[0].name.replace(/\.pdf$/i, '') + (zipped ? '-逐页.zip' : '-提取.pdf'));
      showStatus(status, '处理完成，已发起下载 · ' + bytes(output.length));
    } catch (error) { if (!disposed) showStatus(status, error.message || '处理失败，请换一份 PDF 重试。', true); }
    finally { busy = false; if (!disposed) render(); }
  };
  render();
  return () => { disposed = true; files = []; };
}

export function mountImage(container) {
  let source = null, bitmap = null, originalUrl = null, resultUrl = null, resultBlob = null, generation = 0, disposed = false, processing = false;
  container.innerHTML = '<p class="tool-description">调整图片尺寸与格式，生成适合分享或保存的文件。支持 JPEG、PNG、WebP；动画会转为静态图片。</p>' + drop('image', 'image/jpeg,image/png,image/webp', '点击选择，或把图片拖到这里', '一次处理一张 · 最大 30 MB / 4000 万像素') + '<div class="tool-controls"><label>输出格式<select id="image-format"><option value="image/webp">WebP · 体积通常较小</option><option value="image/jpeg">JPEG · 通用照片格式</option><option value="image/png">PNG · 无损编码</option></select></label><label>最长边（像素）<select id="image-width"><option value="1920">1920 px</option><option value="1280">1280 px</option><option value="2560">2560 px</option><option value="3840">3840 px</option><option value="0">保持原始尺寸</option></select></label><label><span class="quality-caption"><span>画质</span><output id="quality-value">80%</output></span><input id="image-quality" type="range" min="10" max="100" value="80"></label></div><div class="tool-actions"><button id="image-run" class="button primary" disabled>' + icon('image') + '处理图片</button><button id="image-download" class="button secondary" disabled>' + icon('download') + '下载结果</button><button id="image-clear" class="button subtle" disabled>清空</button></div><p class="tool-status" id="image-status" role="status"></p><div class="image-result" id="image-result" hidden><div class="preview-panel"><img id="image-original" alt="原始图片预览"><p id="image-original-label"></p></div><div class="preview-panel" id="image-after" hidden><img id="image-output" alt="处理后图片预览"><p id="image-output-label"></p></div><div class="result-summary" id="image-summary" hidden></div></div><div class="notice">小图不会被放大。JPEG 会把透明区域填成白色；PNG 的大小主要由尺寸决定。重新编码会移除大部分原图元数据，输出不保证一定更小。</div>';
  const status = $('#image-status', container);
  function clearResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null; resultBlob = null;
    $('#image-output', container).removeAttribute('src');
    $('#image-after', container).hidden = true; $('#image-summary', container).hidden = true;
    $('#image-download', container).disabled = true;
  }
  function clearAll() {
    generation++; clearResult(); if (originalUrl) URL.revokeObjectURL(originalUrl); originalUrl = null;
    if (bitmap) bitmap.close(); bitmap = null; source = null;
    $('#image-original', container).removeAttribute('src'); $('#image-result', container).hidden = true;
    $('#image-run', container).disabled = true; $('#image-clear', container).disabled = true;
  }
  function lock(value) {
    processing = value;
    $('#image-drop', container).disabled = value;
    $('#image-run', container).disabled = value || !bitmap;
    $('#image-clear', container).disabled = value || !bitmap;
    $('#image-format', container).disabled = value;
    $('#image-width', container).disabled = value;
    $('#image-quality', container).disabled = value || $('#image-format', container).value === 'image/png';
  }
  bindDrop('image', async files => {
    if (processing) return;
    if (files.length !== 1) return showStatus(status, '请一次选择一张图片。', true);
    const file = files[0];
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return showStatus(status, '请选择 JPEG、PNG 或 WebP 图片。', true);
    if (file.size > 30 * 1024 ** 2) return showStatus(status, '图片超过 30 MB，请先缩小后再试。', true);
    clearAll(); const current = generation; lock(true); showStatus(status, '正在读取图片…');
    try {
      const loaded = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (disposed || current !== generation) { loaded.close(); return; }
      if (loaded.width * loaded.height > 40000000) { loaded.close(); throw new Error('图片超过 4000 万像素，请先缩小尺寸。'); }
      bitmap = loaded; source = file; originalUrl = URL.createObjectURL(file);
      $('#image-original', container).src = originalUrl; $('#image-result', container).hidden = false;
      $('#image-original-label', container).textContent = '原图 · ' + bytes(file.size) + ' · ' + bitmap.width + ' × ' + bitmap.height + ' · ' + file.name;
      showStatus(status, '已读取图片，选择参数后点击“处理图片”。');
    } catch (error) { if (!disposed) showStatus(status, error.message || '图片无法解码，请检查文件。', true); }
    finally { if (!disposed) lock(false); }
  });
  ['image-quality', 'image-width', 'image-format'].forEach(id => $('#' + id, container).oninput = () => {
    generation++; clearResult();
    const png = $('#image-format', container).value === 'image/png';
    $('#image-quality', container).disabled = png;
    $('#quality-value', container).textContent = png ? '无损' : $('#image-quality', container).value + '%';
    if (bitmap) showStatus(status, '参数已更新，请重新处理。');
  });
  $('#image-run', container).onclick = async () => {
    if (!bitmap || processing) return;
    clearResult(); lock(true); showStatus(status, '正在处理图片…');
    const current = ++generation;
    await new Promise(resolve => setTimeout(resolve, 30));
    try {
      if (disposed) return;
      const max = Number($('#image-width', container).value), ratio = max ? Math.min(1, max / Math.max(bitmap.width, bitmap.height)) : 1;
      const width = Math.max(1, Math.round(bitmap.width * ratio)), height = Math.max(1, Math.round(bitmap.height * ratio));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法创建画布');
      const type = $('#image-format', container).value;
      if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, Number($('#image-quality', container).value) / 100));
      canvas.width = 1; canvas.height = 1;
      if (disposed || generation !== current) return;
      if (!blob) throw new Error('浏览器编码失败，请缩小尺寸后重试');
      if (blob.type !== type) throw new Error('当前浏览器不支持这个输出格式，请改用 PNG 或 JPEG');
      resultBlob = blob; resultUrl = URL.createObjectURL(blob);
      $('#image-output', container).src = resultUrl; $('#image-after', container).hidden = false;
      $('#image-output-label', container).textContent = '结果 · ' + bytes(blob.size) + ' · ' + width + ' × ' + height;
      const saved = (1 - blob.size / source.size) * 100;
      $('#image-summary', container).textContent = saved >= 0 ? '体积减少 ' + saved.toFixed(1) + '%，节省 ' + bytes(source.size - blob.size) + '。检查预览后即可下载。' : '结果比原图大 ' + (-saved).toFixed(1) + '%。原图可能已压缩过，可以降低画质、缩小尺寸或保留原图。';
      $('#image-summary', container).hidden = false; $('#image-download', container).disabled = false;
      showStatus(status, '处理完成，结果已在下方预览。');
    } catch (error) { if (!disposed) showStatus(status, error.message || '处理失败，请重试。', true); }
    finally { if (!disposed) lock(false); }
  };
  $('#image-download', container).onclick = () => { if (resultBlob) download(resultBlob, source.name.replace(/\.[^.]+$/, '') + '-处理.' + ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[resultBlob.type] || 'png')); };
  $('#image-clear', container).onclick = () => { if (!processing) { clearAll(); showStatus(status, ''); } };
  return () => { disposed = true; clearAll(); };
}

export function mountDiff(container) {
  let disposed = false, parts = null, running = false;
  container.innerHTML = '<p class="tool-description">比较两版笔记、提示词或代码。支持中文与换行，输入内容不会被保存；离开工具页后清空。</p><div class="diff-inputs"><label>原始文本<textarea id="diff-before" placeholder="把原文放在这里…" spellcheck="false"></textarea></label><label>修改后的文本<textarea id="diff-after" placeholder="把新版本放在这里…" spellcheck="false"></textarea></label></div><div class="tool-actions"><select id="diff-mode" aria-label="比较方式" style="width:auto"><option value="chars">按字符比较</option><option value="lines">按行比较</option></select><button id="diff-run" class="button primary">' + icon('diff') + '开始比较</button><button id="diff-swap" class="button secondary">交换两侧</button><button id="diff-clear" class="button subtle">清空</button><button id="diff-copy" class="button subtle" hidden>' + icon('copy') + '复制差异</button></div><p class="tool-status" id="diff-status" role="status"></p><div id="diff-legend" class="diff-legend" hidden><span>绿色：新增内容</span><span>红色删除线：删去内容</span></div><div id="diff-output" class="diff-output" hidden></div>';
  const before = $('#diff-before', container), after = $('#diff-after', container), status = $('#diff-status', container), output = $('#diff-output', container);
  function invalidate() {
    parts = null; output.hidden = true; output.replaceChildren(); $('#diff-legend', container).hidden = true; $('#diff-copy', container).hidden = true; showStatus(status, '');
  }
  before.oninput = after.oninput = $('#diff-mode', container).onchange = invalidate;
  $('#diff-swap', container).onclick = () => { [before.value, after.value] = [after.value, before.value]; invalidate(); };
  $('#diff-clear', container).onclick = () => { before.value = after.value = ''; invalidate(); before.focus(); };
  $('#diff-run', container).onclick = async () => {
    if (running) return;
    invalidate();
    if (!before.value && !after.value) return showStatus(status, '请先输入需要比较的文本。', true);
    running = true; $('#diff-run', container).disabled = true; showStatus(status, '正在比较…');
    await new Promise(resolve => setTimeout(resolve, 30));
    if (disposed) return;
    try {
      parts = compareText(before.value, after.value, $('#diff-mode', container).value);
      let added = 0, removed = 0;
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (part.added) added += [...part.value].length;
        if (part.removed) removed += [...part.value].length;
        const node = document.createElement(part.added ? 'ins' : part.removed ? 'del' : 'span');
        node.textContent = part.value; fragment.append(node);
      }
      output.replaceChildren(fragment); output.hidden = false; $('#diff-legend', container).hidden = false; $('#diff-copy', container).hidden = false;
      showStatus(status, added || removed ? '新增 ' + added + ' 个字符，删除 ' + removed + ' 个字符（含空白与换行）。' : '两段文本完全相同。');
    } catch (error) { showStatus(status, error.message, true); }
    finally { running = false; $('#diff-run', container).disabled = false; }
  };
  $('#diff-copy', container).onclick = async () => {
    if (!parts) return;
    try {
      await navigator.clipboard.writeText(parts.map(part => part.added ? '[新增]' + part.value + '[/新增]' : part.removed ? '[删除]' + part.value + '[/删除]' : part.value).join(''));
      showStatus(status, '已复制，使用 [新增] / [删除] 标记差异。');
    } catch { showStatus(status, '浏览器未允许复制。可以直接选择下方结果进行复制。', true); }
  };
  return () => { disposed = true; };
}
