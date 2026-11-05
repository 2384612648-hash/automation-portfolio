import { $, $$, esc, icon } from './shared.js';
import { searchEntries } from './discovery.js';

export function mountQuickSearch(getEntries) {
  const dialog = $('#quick-dialog'), input = $('#quick-query'), results = $('#quick-results');
  function render() {
    const matches = searchEntries(getEntries(), input.value), shown = matches.slice(0,20);
    $('#quick-count').textContent = matches.length ? `${matches.length} 个结果${matches.length > 20 ? '，显示前 20 个；可输入更多关键词' : ''}` : '没有匹配结果';
    results.innerHTML = shown.length ? shown.map(entry => `<a class="quick-result" href="${esc(entry.href)}" ${entry.external ? 'target="_blank" rel="noopener noreferrer"' : ''}><span class="quick-result-icon">${icon(entry.icon)}</span><span class="quick-result-copy"><strong>${esc(entry.title)}</strong><small>${esc(entry.detail)}</small></span><span class="quick-result-type">${esc(entry.type)} ${entry.external ? '↗' : '→'}</span></a>`).join('') : '<div class="quick-empty">试试工具名称、标签或收藏标题。<br>这里搜索本站内容，不会向搜索引擎发送关键词。</div>';
  }
  function open() {
    if (document.querySelector('dialog[open]')) return;
    input.value = ''; render(); dialog.showModal(); input.focus();
  }
  $('#quick-open').onclick = open;
  $('#quick-close').onclick = () => dialog.close();
  input.oninput = render;
  results.addEventListener('click', event => { if (event.target.closest('a')) dialog.close(); });
  dialog.addEventListener('keydown', event => {
    if (event.isComposing) return;
    // Search inputs otherwise consume Escape to clear text before the dialog can close.
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
    const links = $$('.quick-result', results), index = links.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); (links[Math.min(index + 1, links.length - 1)] || input).focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); (links[index - 1] || input).focus(); }
    if (event.key === 'Enter' && document.activeElement === input && links.length) { event.preventDefault(); links[0].click(); }
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.altKey || event.repeat) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); if (dialog.open) dialog.close(); else open();
    }
  });
}
