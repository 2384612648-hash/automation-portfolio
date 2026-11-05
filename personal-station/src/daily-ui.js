import { $, $$, esc, download, showStatus } from './shared.js';
import { unitGroups, convertUnit, tidyExcerpt, readingMarkdown } from './daily-tools.js';

export function mountExcerpt(container) {
  container.innerHTML = `<p class="tool-description">给读过的内容留一张有出处的卡片。原文和自己的想法分开，导出后可放进 Obsidian；当前输入只保留到离开此页。</p>
    <div class="utility-fields"><label>笔记标题<input id="note-title" maxlength="200" placeholder="这段内容在讲什么？"></label><label>来源 / 书名 / 页码<input id="note-source" maxlength="2000" placeholder="粘贴网址，或填写书名与页码"></label></div>
    <div class="diff-inputs"><label>原文摘录<textarea id="note-excerpt" maxlength="80000" placeholder="粘贴原文，保留它本来的意思…"></textarea></label><label>我的想法<textarea id="note-thought" maxlength="20000" placeholder="我怎样理解？还有什么问题？"></textarea></label></div>
    <div class="excerpt-stats" id="note-count">0 字符 · 0 个汉字 · 0 个英文单词</div>
    <label class="checkbox"><input type="checkbox" id="note-join">整理时合并段内换行（适合 PDF 复制文本，段落之间请保留空行）</label>
    <div class="tool-actions"><button class="button secondary" id="note-tidy">整理摘录空白</button><button class="button subtle" id="note-undo" disabled>撤销整理</button><button class="button primary" id="note-export">导出 Markdown</button><button class="button secondary" id="note-copy">复制 Markdown</button></div>
    <p class="tool-status" id="note-status" role="status"></p>`;
  const excerpt = $('#note-excerpt', container), status = $('#note-status', container);
  let previous = null;
  function counts() {
    const value = excerpt.value;
    $('#note-count', container).textContent = `${[...value].length} 字符 · ${(value.match(/\p{Script=Han}/gu) || []).length} 个汉字 · ${(value.match(/[a-zA-Z]+(?:['’-][a-zA-Z]+)*/g) || []).length} 个英文单词`;
  }
  excerpt.oninput = counts;
  $('#note-tidy', container).onclick = () => {
    previous = excerpt.value; excerpt.value = tidyExcerpt(previous, $('#note-join', container).checked);
    $('#note-undo', container).disabled = false; counts(); showStatus(status, '已整理首尾空白与多余空行；请核对原意，可以撤销本次整理。');
  };
  $('#note-undo', container).onclick = () => { if (previous !== null) excerpt.value = previous; previous = null; $('#note-undo', container).disabled = true; counts(); showStatus(status, '已恢复整理前的摘录。'); };
  function output() { return readingMarkdown({title: $('#note-title', container).value, source: $('#note-source', container).value, excerpt: excerpt.value, thought: $('#note-thought', container).value, date: new Date().toLocaleDateString('sv-SE')}); }
  $('#note-export', container).onclick = () => {
    try {
      const text = output(), filename = $('#note-title', container).value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 80) || '阅读摘录';
      download(new Blob([text], {type:'text/markdown;charset=utf-8'}), filename + '.md'); showStatus(status, '已发起 Markdown 下载，可移入自己的笔记库。');
    } catch (error) { showStatus(status, error.message, true); }
  };
  $('#note-copy', container).onclick = async () => { try { await navigator.clipboard.writeText(output()); showStatus(status, '已复制 Markdown。'); } catch (error) { showStatus(status, error.message.includes('请填写') ? error.message : '复制未获允许，请使用 Markdown 下载。', true); } };
  return () => {};
}

export function mountConverter(container) {
  container.innerHTML = `<p class="tool-description">学习、文件管理和日常生活里的常用换算。角度与转速单列，MB 与 MiB 明确区分。</p>
    <label>换算类别<select id="unit-group">${Object.entries(unitGroups).map(([key, value]) => `<option value="${key}">${value.title}</option>`).join('')}</select></label>
    <div class="utility-fields"><label>输入数值<input id="unit-value" type="text" inputmode="decimal" value="1" maxlength="80"></label><label>原单位<select id="unit-from"></select></label><label>目标单位<select id="unit-to"></select></label></div>
    <div class="conversion-result"><span>换算结果</span><output id="unit-result" aria-live="polite"></output><small id="unit-equation"></small></div>
    <div class="tool-actions"><button class="button secondary" id="unit-swap">交换单位</button><button class="button subtle" id="unit-copy">复制结果</button></div><p class="tool-status" id="unit-status" role="status"></p>`;
  const group = $('#unit-group', container), from = $('#unit-from', container), to = $('#unit-to', container), input = $('#unit-value', container), result = $('#unit-result', container), status = $('#unit-status', container);
  let value = '';
  function calculate() {
    showStatus(status, '');
    try {
      value = Number(convertUnit(input.value, group.value, from.value, to.value).toPrecision(12)).toString();
      result.textContent = value;
      $('#unit-equation', container).textContent = input.value + ' ' + from.selectedOptions[0].textContent + ' ≈ ' + value + ' ' + to.selectedOptions[0].textContent;
      $('#unit-copy', container).disabled = false;
    } catch (error) { value = ''; result.textContent = '—'; $('#unit-equation', container).textContent = ''; $('#unit-copy', container).disabled = true; showStatus(status, error.message, true); }
  }
  function options() { const html = unitGroups[group.value].units.map(unit => `<option value="${esc(unit[0])}">${esc(unit[1])}</option>`).join(''); from.innerHTML = to.innerHTML = html; to.selectedIndex = 1; calculate(); }
  group.onchange = options; from.onchange = to.onchange = input.oninput = calculate;
  $('#unit-swap', container).onclick = () => { [from.value, to.value] = [to.value, from.value]; calculate(); };
  $('#unit-copy', container).onclick = async () => { try { await navigator.clipboard.writeText(value); showStatus(status, '已复制数值。'); } catch { showStatus(status, '复制未获允许，可直接选择上方结果复制。', true); } };
  options(); return () => {};
}

export function mountMetronome(container) {
  container.innerHTML = `<p class="tool-description">为钢琴或节奏练习打拍。点击开始后发声，每小节第一拍为高音；切换工具或隐藏页面会自动停止。</p>
    <div class="metronome-face"><span class="eyebrow">FIND YOUR TEMPO</span><strong id="tempo-display">80<small>BPM</small></strong><div class="beat-lights" id="beat-lights" aria-hidden="true"></div></div>
    <div class="utility-fields"><label>速度 BPM（30—240）<input id="tempo" type="number" min="30" max="240" step="1" value="80"></label><label>每小节拍数<select id="meter"><option value="2">2 拍</option><option value="3">3 拍</option><option value="4" selected>4 拍</option><option value="6">6 拍</option></select></label><label>音量<input id="volume" type="range" min="0" max="100" value="25"></label></div>
    <div class="tool-actions"><button class="button primary" id="metro-start">开始节拍</button><button class="button secondary" id="metro-stop" disabled>停止</button><button class="button subtle" id="metro-tap">点按测速</button></div><p class="tool-status" id="metro-status" role="status">准备好了再开始，无需计时或打卡。</p>`;
  const tempo = $('#tempo', container), meter = $('#meter', container), status = $('#metro-status', container);
  let context = null, interval = null, frame = null, running = false, disposed = false, next = 0, beat = 0, queue = [], taps = [];
  function lights() { $('#beat-lights', container).innerHTML = Array.from({length:Number(meter.value)}, (_,i) => `<span class="${i === 0 ? 'downbeat' : ''}">${i + 1}</span>`).join(''); }
  function bpm() { const n = Number(tempo.value); if (!Number.isInteger(n) || n < 30 || n > 240) throw new Error('速度请输入 30—240 之间的整数。'); return n; }
  function stop(message = '已停止。') {
    running = false; clearInterval(interval); cancelAnimationFrame(frame); queue = [];
    if (context) { const old = context; context = null; old.close().catch(() => {}); }
    $('#metro-start', container).disabled = false; $('#metro-stop', container).disabled = true;
    $$('input:not(#volume), select', container).forEach(el => el.disabled = false); $('#metro-tap', container).disabled = false;
    lights(); showStatus(status, message);
  }
  function schedule() {
    if (!running || !context) return;
    if (next < context.currentTime) next = context.currentTime + .03;
    while (next < context.currentTime + .1) {
      const osc = context.createOscillator(), gain = context.createGain();
      osc.frequency.value = beat === 0 ? 1100 : 750;
      gain.gain.setValueAtTime(0, next); gain.gain.linearRampToValueAtTime(Number($('#volume', container).value) / 100 * .3, next + .003); gain.gain.exponentialRampToValueAtTime(.0001, next + .055);
      osc.connect(gain); gain.connect(context.destination); osc.start(next); osc.stop(next + .06);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      queue.push({time:next, beat}); next += 60 / bpm(); beat = (beat + 1) % Number(meter.value);
    }
  }
  function draw() {
    if (!running || !context) return;
    while (queue.length && queue[0].time <= context.currentTime) { const current = queue.shift(); $$('#beat-lights span', container).forEach((el,i) => el.classList.toggle('active', i === current.beat)); }
    frame = requestAnimationFrame(draw);
  }
  $('#metro-start', container).onclick = async () => {
    try {
      bpm(); const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) throw new Error('当前浏览器不支持声音播放。');
      $('#metro-start', container).disabled = true; $('#metro-stop', container).disabled = false;
      const audio = new Audio(); context = audio; await audio.resume();
      if (disposed || context !== audio || document.hidden) { if (context === audio) stop(); return; }
      running = true; beat = 0; next = context.currentTime + .06;
      $$('input:not(#volume), select', container).forEach(el => el.disabled = true); $('#metro-tap', container).disabled = true;
      showStatus(status, '正在播放 · ' + bpm() + ' BPM。调整速度或拍数前请先停止。'); schedule(); interval = setInterval(schedule, 25); draw();
    } catch (error) { stop(); showStatus(status, error.message || '无法播放声音，请重新点击开始。', true); }
  };
  $('#metro-stop', container).onclick = () => stop();
  tempo.oninput = () => { $('#tempo-display', container).firstChild.textContent = tempo.value || '—'; };
  meter.onchange = lights;
  $('#metro-tap', container).onclick = () => {
    const now = performance.now(); if (taps.length && now - taps.at(-1) > 2200) taps = [];
    taps.push(now); taps = taps.slice(-7);
    if (taps.length < 2) return showStatus(status, '继续按同样的节奏点按，至少两次。');
    tempo.value = Math.max(30, Math.min(240, Math.round(60000 * (taps.length - 1) / (now - taps[0])))); tempo.oninput(); showStatus(status, '点按估算：' + tempo.value + ' BPM，点击开始试听。');
  };
  function onHidden() { if (document.hidden && context) stop('页面已隐藏，节拍已停止。'); }
  document.addEventListener('visibilitychange', onHidden); lights();
  return () => { disposed = true; stop(); document.removeEventListener('visibilitychange', onHidden); };
}
