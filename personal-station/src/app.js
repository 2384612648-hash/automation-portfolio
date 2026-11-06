import {mountHud,motionAllowed} from './hud.js';
import { $, $$, esc, icon, download, toast } from './shared.js';
import { mountPdf, mountImage, mountDiff } from './tool-ui.js';
import { mountExcerpt, mountConverter, mountMetronome } from './daily-ui.js';
import { searchEntries, readFavorites } from './discovery.js';
import { mountQuickSearch } from './quick-search.js';
import { mountToday } from './today.js';
import { mountFeeds } from './feeds.js';
import { extraTools, mountUtility } from './utility-ui.js';
import { mountProxy } from './proxy.js';

const kinds = { article: ['文章 / 网页', 'file'], video: ['视频', 'video'], project: ['开源项目', 'code'], other: ['其他', 'link'] };
const toolDefinitions = [
  { id: 'pdf', icon: 'file', title: 'PDF 工作台', english: 'DOCUMENT', format: 'PDF / ZIP', detail: '合并文档，拆分或提取指定页面。', subtitle: '合并、拆分、提取。让文档保持你需要的样子。', steps: ['选择 PDF', '调整顺序 / 页码', '下载结果'] },
  { id: 'image', icon: 'image', title: '图像处理', english: 'IMAGE', format: 'PNG / JPG / WEBP', detail: '压缩图片，调整尺寸与输出格式。', subtitle: '在体积与画质之间，找到合适的平衡。', steps: ['选择图片', '设置并处理', '预览与下载'] },
  { id: 'diff', icon: 'diff', title: '文本差异', english: 'COMPARE', format: 'TEXT / CODE', detail: '对照两个版本，清楚标出每处增删。', subtitle: '笔记、提示词或代码，看清每一处变化。', steps: ['粘贴两版文本', '开始比较', '查看 / 复制差异'] },
  { id: 'excerpt', icon: 'bookmark', title: '摘录整理', english: 'READING', format: '阅读 / OBSIDIAN', detail: '整理复制文本，区分摘录与想法，导出笔记。', subtitle: '让读过的内容，有出处，也有自己的理解。', steps: ['填写来源与摘录', '整理 / 写下想法', '导出 Markdown'] },
  { id: 'convert', icon: 'convert', title: '单位换算', english: 'CONVERT', format: '学习 / 日常', detail: '长度、角度、转速、温度与文件大小换算。', subtitle: '从日常单位到工程量，随手换算。', steps: ['选择类别', '输入数值与单位', '查看 / 复制结果'] },
  { id: 'metronome', icon: 'music', title: '节拍器', english: 'RHYTHM', format: '钢琴 / 节奏', detail: '调整速度与每小节拍数，也可点按测速。', subtitle: '留一段空间，练习喜欢的旋律。', steps: ['设置速度与拍数', '点击开始', '停止 / 调整节奏'] }
];
toolDefinitions.push(...extraTools);
const onlineTools = [
  { id:'smallpdf', icon:'file', title:'Smallpdf', english:'DOCUMENT', url:'https://smallpdf.com/cn#r=app', detail:'PDF 与 Word、Excel、PPT 等格式转换；补充本地文档处理。', format:'文件转换', note:'免费使用有限额，部分功能需付费。文件由第三方网站处理。' },
  { id:'drawio', icon:'diagram', title:'diagrams.net', english:'DIAGRAM', url:'https://app.diagrams.net/', detail:'画流程图、思维结构与项目架构图，把思路展开。', format:'流程图 / 架构图', note:'免费绘图。可选择保存到设备，保留 .drawio 文件便于修改。' },
  { id:'desmos', icon:'graph', title:'Desmos', english:'MATH', url:'https://www.desmos.com/calculator?lang=zh-CN', detail:'输入函数、观察图像，用滑块探索参数变化。', format:'数学 / 函数图像', note:'在线图形计算器；需要联网打开。' },
  { id:'deepl', icon:'language', title:'DeepL', english:'LANGUAGE', url:'https://www.deepl.com/translator', detail:'阅读英文资料时查询句段翻译，结合原文核对意思。', format:'外语 / 资料阅读', note:'在线翻译，额度与可用功能以网站为准。' }
];
let bookmarks = [], token = '', loaded = false, editingId = null, cleanupTool = null;
let filters = { query: '', kind: 'all', tag: '', sort: 'new' }, saving = false;
const main = $('#main');
const route = () => location.hash.slice(1) || 'today';
const routeTrail = [route()];
const live = () => bookmarks.filter(item => !item.deleted_at);
const allTools = [...toolDefinitions, ...onlineTools];
const favoriteKey = 'zero:tool-favorites:v1';
let favorites = [];
try { favorites = readFavorites(localStorage.getItem(favoriteKey), allTools.map(tool => tool.id)); } catch { /* Preferences are optional in restricted browsers. */ }
let toolFilter = 'all', toolQuery = '';
const toolGroups = [['all','全部'],['favorites','常用'],['files','文件与文本'],['daily','学习与生活'],['developer','开发与数据'],['online','在线工具']];

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch('/api/' + path, { ...options, headers: { 'Content-Type': 'application/json', 'X-Station-Token': token, ...options.headers } });
  } catch { throw new Error('连接不到零域服务器，请检查 Tailscale 连接后重试。'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('服务返回了无法读取的数据，请刷新后重试。'); }
  if (!response.ok) throw new Error(data.error || '操作失败，请重试。');
  return data;
}
function update(item) {
  const index = bookmarks.findIndex(entry => entry.id === item.id);
  if (index < 0) bookmarks.unshift(item); else bookmarks[index] = item;
  renderNav();
  if (['all', 'later', 'starred', 'trash'].includes(route())) renderLibrary(route());
}
function navItem(key, label, symbol, count) {
  const active = route() === key || (key === 'tools' && route().startsWith('tools/'));
  return '<a class="nav-item' + (active ? ' active' : '') + '" href="#' + key + '"' + (active ? ' aria-current="page"' : '') + '>' + icon(symbol) + '<span>' + label + '</span>' + (count !== undefined ? '<span class="count">' + count + '</span>' : '') + '</a>';
}
function renderNav() {
  const current = route();
  $$('[data-top-route]').forEach(link => {
    const active = link.dataset.topRoute === current || (link.dataset.topRoute === 'tools' && current.startsWith('tools/'));
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  const section = current.startsWith('tools') ? 'tools' : ['today','feeds'].includes(current) ? 'today' : current === 'proxy' ? 'tools' : 'all';
  $$('[data-dock]').forEach(link => {
    const active = link.dataset.dock === section;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  $('#route-back').disabled = routeTrail.length < 2 && !current.startsWith('tools/');
  const items = live();
  $('#navigation').innerHTML = '<div class="nav-label"><span>我的空间</span></div>' + navItem('today', '今日', 'graph') + navItem('feeds', '信息流', 'clock') + navItem('all', '信息库', 'grid', items.length) + navItem('later', '待读队列', 'clock', items.filter(item => !item.is_read).length) + navItem('starred', '星标库', 'star', items.filter(item => item.starred).length) + '<div class="nav-label nav-label-secondary"><span>工作空间</span></div>' + navItem('tools', '工具台', 'tools') + navItem('proxy', '服务器代理', 'tools') + navItem('trash', '回收区', 'trash');
}
function toolCards(items = favorites.length ? favorites.map(id => allTools.find(tool => tool.id === id)).slice(0,6) : toolDefinitions.slice(0,3)) {
  return '<div class="tool-grid">' + items.map(tool => {
    const pinned = favorites.includes(tool.id), external = !!tool.url;
    return '<article class="tool-card' + (external ? ' online-card' : '') + '" data-tool="' + tool.id + '"><a class="tool-card-link" href="' + esc(tool.url || '#tools/' + tool.id) + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '><div class="tool-card-top"><span class="tool-symbol">' + icon(tool.icon) + '</span></div><div class="tool-card-copy"><h3>' + tool.title + '</h3><p>' + tool.detail + '</p>' + '' + '</div><div class="tool-card-bottom"><span>' + (external ? '外部网站 ↗' : '浏览器内') + ' · ' + tool.format + '</span>' + icon(external ? 'external' : 'arrow').replace('<svg ', '<svg class="arrow" ') + '</div></a><button class="tool-pin icon-button' + (pinned ? ' starred' : '') + '" data-action="pin-tool" data-tool-id="' + tool.id + '" aria-pressed="' + pinned + '" aria-label="' + (pinned ? '取消常用：' : '设为常用：') + tool.title + '" title="' + (pinned ? '取消常用' : '设为常用') + '">' + icon('star') + '</button>' + (external ? '<details class="tool-note"><summary>使用说明</summary><p>' + tool.note + '</p></details>' : '') + '</article>';
  }).join('') + '</div>';
}
function renderToolDirectory(query = toolQuery) {
  toolQuery = query;
  const matched = new Set(searchEntries(allTools, query).map(tool => tool.id));
  const selected = items => items.filter(tool => matched.has(tool.id));
  const pinned = selected(favorites.map(id => allTools.find(tool => tool.id === id)));
  const groupItems = {files:toolDefinitions.filter((t,i)=>i<3||t.group==='files'), daily:toolDefinitions.filter((t,i)=>i>=3&&i<6||t.group==='daily'), developer:toolDefinitions.filter(t=>t.group==='developer'), online:onlineTools};
  const visible = key => toolFilter === key || toolFilter === 'all';
  const group = key => visible(key) ? selected(groupItems[key]).filter(tool => toolFilter !== 'all' || !favorites.includes(tool.id)) : [];
  const files = group('files'), daily = group('daily'), developer = group('developer'), online = group('online');
  const section = (number,title,caption,content) => '<section class="module-panel tool-directory"><div class="section-title"><div class="section-heading"><h2>' + title + '</h2></div></div>' + content + '</section>';
  const showPinned = toolFilter === 'all' || toolFilter === 'favorites';
  $('#tool-directory-results').innerHTML = (showPinned && pinned.length ? section('★','常用工具','星标置顶 · 仅保存在当前浏览器',toolCards(pinned)) : '') + (files.length ? section('01','文件与文本','本地处理 · 无需上传',toolCards(files)) : '') + (daily.length ? section('02','学习与生活','本地处理 · 无需订阅',toolCards(daily)) : '') + (developer.length ? section('04','开发与数据','',toolCards(developer)) : '') + (online.length ? section('03','在线工具','新标签页打开 · 不自动上传文件',toolCards(online)) : '') || '<div class="empty-state"><div class="empty-symbol">' + icon(toolFilter === 'favorites' ? 'star' : 'search') + '</div><h3>' + (toolFilter === 'favorites' && !favorites.length ? '把顺手的工具放在最前面' : '没有匹配的工具') + '</h3><p>' + (toolFilter === 'favorites' && !favorites.length ? '点击工具卡片右上角的星星，下次回来更好找。' : '试试其他关键词，或清除当前分类和搜索条件。') + '</p><button class="button secondary" data-action="reset-tools">查看全部工具</button></div>';
  $('#tool-match-count').textContent = (files.length + daily.length + developer.length + online.length + (showPinned ? pinned.length : 0)) + ' 个工具';
  $('#tool-categories').innerHTML = toolGroups.map(([id,label]) => '<button class="chip' + (toolFilter === id ? ' active' : '') + '" data-action="filter-tools" data-filter="' + id + '" aria-pressed="' + (toolFilter === id) + '">' + label + '<small>' + (id === 'all' ? allTools.length : id === 'favorites' ? favorites.length : groupItems[id].length) + '</small></button>').join('');
  $('#clear-tool-search').hidden = !query;
}
function heading(title, detail, action = '') {
  return '<div class="page-heading"><h1>' + title + '</h1>' + action + '</div>';
}
function renderLibrary(view) {
  const labels = { all: ['信息库', '你的链接、笔记与灵感，在这里连接。'], later: ['待读队列', '留住值得看的内容，按自己的节奏回来。'], starred: ['星标库', '让重要的信息，始终触手可及。'], trash: ['回收区', '暂存移除的内容，需要时随时恢复。'] };
  const [title, detail] = labels[view]; $('#breadcrumb').textContent = title;
  main.innerHTML = heading(title, detail, view === 'trash' ? '' : '<button class="button primary" data-action="add">' + icon('plus') + '收录链接</button>') +
    '<section class="module-panel" aria-label="收藏列表"><div class="section-title"><div class="section-heading"><h2>' + (view === 'all' ? '已收录' : title) + '<span id="result-count"></span></h2></div><button class="button subtle small" data-action="reset-filters" id="reset-filters" hidden>清除筛选</button></div><div class="filters"><div class="search-box">' + icon('search') + '<input id="search" type="search" placeholder="搜索标题、链接、备注或标签…" aria-label="搜索信息库" value="' + esc(filters.query) + '"></div><select id="kind-filter" aria-label="按类型筛选"><option value="all">全部类型</option>' + Object.entries(kinds).map(([key, value]) => '<option value="' + key + '" ' + (filters.kind === key ? 'selected' : '') + '>' + value[0] + '</option>').join('') + '</select><select id="sort-filter" aria-label="收藏排序"><option value="new" ' + (filters.sort === 'new' ? 'selected' : '') + '>最新收藏</option><option value="old" ' + (filters.sort === 'old' ? 'selected' : '') + '>最早收藏</option><option value="updated" ' + (filters.sort === 'updated' ? 'selected' : '') + '>最近修改</option><option value="title" ' + (filters.sort === 'title' ? 'selected' : '') + '>标题排序</option></select></div><div id="tag-filters" class="chips" aria-label="按标签筛选"></div><div id="bookmark-results"></div></section>' +
    (view === 'all' ? '<section class="quick-tools module-panel" aria-label="快捷工具"><div class="section-title"><div class="section-heading"><h2>工具台</h2></div><a class="button subtle small" href="#tools">进入工具台 ' + icon('arrow') + '</a></div>' + toolCards() + '</section>' : '');
  $('#search').oninput = event => { filters.query = event.target.value; filterLibrary(view); };
  $('#kind-filter').onchange = event => { filters.kind = event.target.value; filterLibrary(view); };
  $('#sort-filter').onchange = event => { filters.sort = event.target.value; filterLibrary(view); };
  filterLibrary(view);
}
function baseItems(view) {
  return bookmarks.filter(item => view === 'trash' ? !!item.deleted_at : !item.deleted_at && (view !== 'starred' || item.starred) && (view !== 'later' || !item.is_read));
}
function card(item, trashed) {
  const type = kinds[item.kind] || kinds.other;
  let host = ''; try { host = new URL(item.url).hostname.replace(/^www\./, ''); } catch { host = '链接'; }
  const date = new Date(item.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  return '<article class="bookmark-card" data-id="' + esc(item.id) + '"><div class="card-top"><span class="kind-badge"><span class="kind-icon">' + icon(type[1]) + '</span>' + type[0] + '</span>' + (trashed ? '' : '<button class="icon-button ' + (item.starred ? 'starred' : '') + '" data-action="star" aria-label="' + (item.starred ? '取消星标' : '添加星标') + '" title="' + (item.starred ? '取消星标' : '添加星标') + '" aria-pressed="' + item.starred + '">' + icon('star') + '</button>') + '</div><a class="card-title" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(item.title) + '">' + esc(item.title) + '</a><div class="card-source" title="' + esc(item.url) + '">' + esc(host) + ' ↗</div>' + (item.note ? '<p class="card-note">' + esc(item.note) + '</p>' : '') + '<div class="card-tags">' + item.tags.map(tag => '<span class="tag">' + esc(tag) + '</span>').join('') + '</div><div class="card-footer"><span class="read-indicator">' + (item.is_read ? icon('check') + ' 已读' : icon('clock') + ' 待读') + ' · ' + esc(date) + '</span><div class="card-actions">' + (trashed ? '<button class="button subtle small" data-action="restore">' + icon('restore') + '恢复</button>' : '<button class="icon-button" data-action="read" aria-label="' + (item.is_read ? '标为未读' : '标为已读') + '" title="' + (item.is_read ? '标为未读' : '标为已读') + '">' + icon(item.is_read ? 'clock' : 'check') + '</button><button class="icon-button" data-action="edit" aria-label="查看或编辑收藏" title="查看或编辑收藏">' + icon('edit') + '</button><button class="icon-button" data-action="trash" aria-label="移到回收区" title="移到回收区">' + icon('trash') + '</button>') + '</div></div></article>';
}
function filterLibrary(view) {
  const all = baseItems(view), query = filters.query.trim().toLocaleLowerCase();
  const tags = [...new Set(all.flatMap(item => item.tags))].sort((a,b) => a.localeCompare(b,'zh-CN'));
  if (!tags.includes(filters.tag)) filters.tag = '';
  $('#tag-filters').innerHTML = tags.length ? '<button class="chip ' + (!filters.tag ? 'active' : '') + '" data-tag="">全部标签</button>' + tags.map(tag => '<button class="chip ' + (filters.tag === tag ? 'active' : '') + '" data-tag="' + esc(tag) + '">' + esc(tag) + '</button>').join('') : '';
  const items = all.filter(item => (filters.kind === 'all' || item.kind === filters.kind) && (!filters.tag || item.tags.includes(filters.tag)) && (!query || [item.title,item.url,item.note,...item.tags].join('\n').toLocaleLowerCase().includes(query)));
  items.sort((a,b) => filters.sort === 'title' ? a.title.localeCompare(b.title,'zh-CN') : filters.sort === 'old' ? new Date(a.created_at) - new Date(b.created_at) : new Date(b[filters.sort === 'updated' ? 'updated_at' : 'created_at']) - new Date(a[filters.sort === 'updated' ? 'updated_at' : 'created_at']));
  $('#result-count').textContent = items.length + ' 条';
  const filtered = !!(query || filters.tag || filters.kind !== 'all'); $('#reset-filters').hidden = !filtered;
  const result = $('#bookmark-results');
  if (items.length) { result.innerHTML = '<div class="bookmark-grid">' + items.map(item => card(item, view === 'trash')).join('') + '</div>'; return; }
  const title = filtered ? '暂时没有找到匹配的收藏' : view === 'trash' ? '这里还没有移除的内容' : view === 'starred' ? '把重要的内容标上星星' : view === 'later' ? '当前没有待看的收藏' : '接入你的第一条信息';
  const detail = filtered ? '试试其他关键词，或清除类型与标签筛选。' : view === 'trash' ? '从信息库移除的条目会出现在这里，不会立即消失。' : view === 'starred' ? '点击收藏卡片上的星星，常用内容就会出现在这里。' : view === 'later' ? '新收藏默认加入待读队列，你可以按自己的节奏慢慢看。' : '粘贴链接，写下标题；标签和备注可以之后再补。';
  result.innerHTML = '<div class="empty-state"><div class="empty-symbol">' + icon(filtered ? 'search' : view === 'trash' ? 'trash' : view === 'starred' ? 'star' : 'bookmark') + '</div><h3>' + title + '</h3><p>' + detail + '</p>' + (filtered ? '<button class="button secondary" data-action="reset-filters">清除筛选</button>' : view === 'all' ? '<button class="button primary" data-action="add">' + icon('plus') + '收录第一条链接</button>' : '') + '</div>';
}
function renderTools() {
  const selected = route().split('/')[1], tool = toolDefinitions.find(item => item.id === selected);
  $('#breadcrumb').textContent = tool ? '工具台 / ' + tool.title : '工具台';
  main.dataset.tool = tool?.id || '';
  if (!tool) {
    main.innerHTML = heading('工具台', '', '<span class="directory-total">' + allTools.length + '<small>可用工具</small></span>') + '<div class="tools-toolbar"><div class="tool-directory-search"><div class="search-box">' + icon('search') + '<input id="tool-search" type="search" aria-label="搜索工具" placeholder="搜索名称或用途，如 PDF、阅读、钢琴…" value="' + esc(toolQuery) + '"><button id="clear-tool-search" class="icon-button" type="button" aria-label="清空工具搜索" hidden>' + icon('x') + '</button></div><span id="tool-match-count" role="status"></span></div><div id="tool-categories" class="chips" role="group" aria-label="工具分类"></div></div><div id="tool-directory-results"></div><details class="usage-note"><summary>保存与隐私</summary><p>本地工具在浏览器内处理，离开前请下载结果；星标仅保存在当前浏览器。在线工具由第三方提供。</p></details>';
    renderToolDirectory();
    $('#tool-search').oninput = event => renderToolDirectory(event.target.value);
    $('#clear-tool-search').onclick = () => { $('#tool-search').value = ''; renderToolDirectory(''); $('#tool-search').focus(); };
    return;
  }
  main.innerHTML = heading(tool.title, '', '<a class="button secondary" href="#tools">返回工具台</a>') + '<nav class="tool-switcher" aria-label="切换工具">' + toolDefinitions.map(entry => '<a data-tool="' + entry.id + '" href="#tools/' + entry.id + '" class="' + (entry.id === tool.id ? 'active' : '') + '"' + (entry.id === tool.id ? ' aria-current="page"' : '') + '>' + icon(entry.icon) + entry.title + '</a>').join('') + '</nav><ol class="tool-guide" aria-label="操作步骤">' + tool.steps.map((step,index) => '<li><b aria-hidden="true">0' + (index + 1) + '</b>' + step + '</li>').join('') + '</ol><div class="tool-workspace" id="tool-container"></div>';
  const mount=({ pdf: mountPdf, image: mountImage, diff: mountDiff, excerpt: mountExcerpt, convert: mountConverter, metronome: mountMetronome })[tool.id];
  cleanupTool = mount ? mount($('#tool-container')) : mountUtility($('#tool-container'),tool.id);
}
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let pageAnimations = [];
function stopPageMotion() { pageAnimations.forEach(animation => animation.cancel()); pageAnimations = []; }
motionPreference.addEventListener('change', stopPageMotion);
function render() {
  stopPageMotion();
  if (cleanupTool) { cleanupTool(); cleanupTool = null; }
  closeMenu(); renderNav();
  if (!loaded) { main.innerHTML = '<div class="loading">正在连接零域…</div>'; return; }
  const current = route();
  main.dataset.route = current;
  main.dataset.tool = '';
  if (current === 'today') {
    $('#breadcrumb').textContent = '今日';
    cleanupTool = mountToday(main, item => {
      if(item.original_title && item.translation_status !== 'ready'){toast('中文翻译尚未完成，请稍后收录。', true);return;}
      openForm();
      const form = $('#bookmark-form');
      form.elements.url.value = item.url; form.elements.title.value = item.title;
      form.elements.kind.value = 'article'; form.elements.tags.value = '新闻';
      form.elements.note.value = '来源：' + item.source + (item.published_at ? '\n发布时间：' + item.published_at : '');
    });
  }
  else if (current === 'feeds') {
    $('#breadcrumb').textContent = '信息流';
    cleanupTool = mountFeeds(main, api, item => {
      if(item.original_title && item.translation_status !== 'ready'){toast('中文翻译尚未完成，请稍后收录。', true);return;}
      openForm();
      const form = $('#bookmark-form');
      form.elements.url.value = item.url; form.elements.title.value = item.title;
      form.elements.kind.value = 'article'; form.elements.tags.value = '信息流, ' + item.topics.join(', ');
      form.elements.note.value = '来源：' + item.sources.map(s => s.name).join(' / ') + (item.published_at ? '\n发布时间：' + item.published_at : '');
    });
  }
  else if (current === 'proxy') {
    $('#breadcrumb').textContent = '服务器代理';
    cleanupTool = mountProxy(main, api);
  }
  else if (current.startsWith('tools')) renderTools();
  else if (['all','later','starred','trash'].includes(current)) renderLibrary(current);
  else { location.hash = 'all'; return; }
  document.title = $('#breadcrumb').textContent + ' · 零域 ZERO';
  if (motionAllowed()) {
    // Dialogs own their transitions. Opacity leaves sticky positioning and hit areas stable.
    pageAnimations = [...main.children].filter(element => element.tagName !== 'DIALOG' && !element.hidden)
      .map((element,index) => element.animate(
        [{ opacity:0, transform:"translateY(12px)" }, { opacity:1, transform:"translateY(-1px)",offset:.8 }, {opacity:1,transform:"translateY(0)"}],
        { duration:360, delay:Math.min(index * 35,105), easing:'cubic-bezier(.16,1,.3,1)', fill:'backwards' }
      ));
  }
}
async function load() {
  main.innerHTML = '<div class="loading">正在连接零域…</div>';
  try { const data = await api('state'); bookmarks = data.bookmarks; token = data.token; loaded = true; render(); }
  catch (error) { main.innerHTML = '<div class="empty-state"><div class="empty-symbol">' + icon('database') + '</div><h3>还没连接到零域</h3><p>' + esc(error.message) + '</p><button class="button primary" data-action="retry">重新连接</button></div>'; }
}

function openForm(item) {
  if (!loaded) return toast('请等待零域连接完成。', true);
  editingId = item?.id || null;
  const form = $('#bookmark-form'); form.reset(); $('#form-error').textContent = '';
  $('#form-heading').textContent = item ? '编辑收录' : '收录链接';
  if (item) {
    for (const key of ['url','title','kind','note']) form.elements[key].value = item[key];
    form.elements.tags.value = item.tags.join(', ');
    form.elements.starred.checked = item.starred; form.elements.is_read.checked = item.is_read;
  }
  $('#bookmark-dialog').showModal();
  (item ? form.elements.title : form.elements.url).focus({preventScroll:true});
}
$('#bookmark-form').elements.url.addEventListener('change', event => {
  if (editingId) return;
  try {
    const host = new URL(event.target.value).hostname;
    $('#bookmark-form').elements.kind.value = /(^|\.)(bilibili\.com|b23\.tv|youtube\.com|youtu\.be)$/.test(host) ? 'video' : /(^|\.)(github\.com|gitlab\.com|gitee\.com)$/.test(host) ? 'project' : 'article';
  } catch { /* Native URL validation explains incomplete links on save. */ }
});
$('#bookmark-form').onsubmit = async event => {
  event.preventDefault(); if (saving) return;
  const form = event.currentTarget, values = new FormData(form);
  const payload = { title: values.get('title'), url: values.get('url'), note: values.get('note'), kind: values.get('kind'), tags: [...new Set(values.get('tags').split(/[,，]/).map(tag => tag.trim()).filter(Boolean))], starred: form.elements.starred.checked, is_read: form.elements.is_read.checked };
  saving = true; $('#save-bookmark').disabled = true; $('#save-bookmark').textContent = '保存中…'; $('#form-error').textContent = '';
  try {
    const item = await api('bookmarks' + (editingId ? '/' + editingId : ''), { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    update(item); $('#bookmark-dialog').close(); toast(editingId ? '收藏已更新' : '已收录到信息库');
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { saving = false; $('#save-bookmark').disabled = false; $('#save-bookmark').textContent = '保存到信息库'; }
};
main.onclick = async event => {
  const tag = event.target.closest('[data-tag]');
  if (tag) { filters.tag = tag.dataset.tag; filterLibrary(route()); return; }
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  if (action === 'pin-tool') {
    const id = button.dataset.toolId;
    if (!allTools.some(tool => tool.id === id)) return;
    const adding = !favorites.includes(id);
    favorites = adding ? [...favorites,id] : favorites.filter(entry => entry !== id);
    let persisted = true;
    try { localStorage.setItem(favoriteKey, JSON.stringify(favorites)); } catch { persisted = false; }
    if (route() === 'tools') renderToolDirectory(); else if (route() === 'all') renderLibrary('all');
    const replacement = $('[data-tool-id="' + id + '"]', main);
    (replacement || $('#tool-search') || main).focus();
    toast(persisted ? (adding ? '已设为常用，工具台和首页优先展示' : '已取消常用') : '本次已生效，但浏览器禁止保存偏好，刷新后可能丢失', !persisted);
    return;
  }
  if (action === 'filter-tools') {
    toolFilter = button.dataset.filter; renderToolDirectory();
    $('[data-filter="' + toolFilter + '"]').focus(); return;
  }
  if (action === 'reset-tools') { toolFilter = 'all'; $('#tool-search').value = ''; renderToolDirectory(''); $('#tool-search').focus(); return; }
  if (action === 'retry') return load();
  if (action === 'add') return openForm();
  if (action === 'reset-filters') { filters = { query:'',kind:'all',tag:'',sort:'new' }; renderLibrary(route()); return; }
  const item = bookmarks.find(entry => entry.id === button.closest('[data-id]')?.dataset.id); if (!item) return;
  if (action === 'edit') return openForm(item);
  button.disabled = true;
  try {
    if (action === 'star' || action === 'read') {
      const key = action === 'star' ? 'starred' : 'is_read';
      update(await api('bookmarks/' + item.id, { method:'PUT', body:JSON.stringify({ ...item, [key]:!item[key] }) }));
      if (action === 'read') toast(item.is_read ? '已放回待读队列' : '已标为读过');
    } else if (action === 'trash') {
      update(await api('bookmarks/' + item.id, { method:'DELETE', body:'{}' })); toast('已移到“回收区”，可以随时恢复');
    } else if (action === 'restore') {
      update(await api('bookmarks/' + item.id + '/restore', { method:'POST', body:'{}' })); toast('收藏已恢复');
    }
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
};

$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
$$('[data-close]').forEach(button => button.onclick = () => { if (!saving) $('#' + button.dataset.close).close(); });
$('#bookmark-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
function renderBackups(data) {
  const s = data.status;
  $('#backup-status').textContent = '现有 ' + s.count + ' 份 · 保留最近 ' + s.keep + ' 份 · 每 ' + s.interval_hours + ' 小时自动备份' + (s.error ? ' · ' + s.error : '');
  $('#backup-list').innerHTML = data.backups.length ? data.backups.map(entry => '<a class="backup-item" href="/api/backups/' + encodeURIComponent(entry.name) + '" download="' + esc(entry.name) + '"><span>' + esc(new Date(entry.created_at).toLocaleString('zh-CN', { hour12: false })) + '</span><small>' + Math.max(1, Math.round(entry.size / 1024)) + ' KB · 下载</small></a>').join('') : '<p class="muted">还没有备份。点“立即备份”生成第一份。</p>';
}
async function loadBackups() {
  try { renderBackups(await api('backups')); }
  catch (error) { $('#backup-status').textContent = error.message; }
}
$('#backup-create').onclick = async () => {
  const button = $('#backup-create'); button.disabled = true; button.textContent = '备份中…';
  try { const entry = await api('backups', { method: 'POST', body: '{}' }); toast('已生成备份 ' + entry.name.replace('zero-backup-', '').replace('.zip', '')); await loadBackups(); }
  catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.textContent = '立即备份'; }
};
$('#data-button').onclick = () => { closeMenu(); $('#data-result').textContent = ''; $('#data-dialog').showModal(); loadBackups(); };
const dateStamp = () => new Date().toLocaleDateString('sv-SE');
$('#export-json').onclick = async () => {
  const button = $('#export-json'); button.disabled = true;
  try { const data = await api('export'); download(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}), '零域信息库-' + dateStamp() + '.json'); $('#data-result').textContent = '已发起 JSON 下载，包含 ' + data.bookmarks.length + ' 条收藏（含回收区）。'; }
  catch (error) { $('#data-result').textContent = error.message; }
  finally { button.disabled = false; }
};
function markdownText(value) { return value.replace(/[\\`*_{}\[\]<>#!|]/g, '\\$&').replace(/\r?\n/g, ' '); }
$('#export-md').onclick = async () => {
  const button = $('#export-md'); button.disabled = true;
  try {
    const data = await api('export');
    const items = data.bookmarks.filter(item => !item.deleted_at);
    const output = '# 零域信息库\n\n导出日期：' + dateStamp() + '\n\n' + items.map(item => '## ' + markdownText(item.title) + '\n\n- 来源：[' + markdownText(item.url) + '](<' + item.url.replace(/[<>]/g,c=>encodeURIComponent(c)) + '>)\n- 类型：' + kinds[item.kind][0] + '\n- 标签：' + (item.tags.map(markdownText).join('、') || '无') + '\n- 状态：' + (item.is_read?'已读':'待读') + (item.starred?' / 星标':'') + '\n- 收藏时间：' + item.created_at + '\n' + (item.note ? '\n### 我的备注\n\n' + item.note + '\n' : '')).join('\n---\n\n');
    download(new Blob([output],{type:'text/markdown;charset=utf-8'}), '零域信息库-' + dateStamp() + '.md'); $('#data-result').textContent = '已发起 Markdown 下载，导出 ' + items.length + ' 条有效收藏。';
  } catch (error) { $('#data-result').textContent = error.message; }
  finally { button.disabled = false; }
};
$('#import-json').onclick = () => $('#import-file').click();
$('#import-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const button = $('#import-json'); button.disabled = true; $('#data-result').textContent = '正在读取并校验…';
  try {
    if (file.size > 12 * 1024 ** 2) throw new Error('文件超过 12 MB，请缩小后再导入。');
    let payload; try { payload = JSON.parse(await file.text()); } catch { throw new Error('这不是有效的 JSON 文件，请选择本站导出的文件。'); }
    const result = await api('import',{method:'POST',body:JSON.stringify(payload)});
    const state = await api('state'); bookmarks = state.bookmarks; token = state.token; renderNav();
    if (['all','later','starred','trash'].includes(route())) renderLibrary(route());
    $('#data-result').textContent = '导入完成：新增 ' + result.added + ' 条，跳过 ' + result.skipped + ' 条相同链接。';
  } catch (error) { $('#data-result').textContent = error.message; }
  finally { button.disabled = false; }
};
// The full navigation is a drawer on desktop and mobile.
const mobileNavigation = window.matchMedia('(min-width: 0px)');
let menuTrigger = $('#menu-button');
function syncSidebar() {
  const open = mobileNavigation.matches && $('#sidebar').classList.contains('open');
  const hidden = mobileNavigation.matches && !open;
  $('#sidebar').inert = hidden;
  $('#sidebar').setAttribute('aria-hidden', String(hidden));
  $('#nav-backdrop').classList.toggle('open', open);
  document.documentElement.classList.toggle('menu-open', open);
  $('.workspace').inert = open;
  $('#menu-button').setAttribute('aria-expanded', String(open));
  $('#dock-menu').setAttribute('aria-expanded', String(open));
}
function closeMenu() {
  const returnFocus = mobileNavigation.matches && $('#sidebar').contains(document.activeElement);
  $('#sidebar').classList.remove('open'); syncSidebar();
  if (returnFocus) menuTrigger.focus({preventScroll:true});
}
function openMenu(event) {
  menuTrigger = event.currentTarget;
  $('#sidebar').classList.add('open'); syncSidebar();
  ($('#sidebar .active') || $('#sidebar a')).focus({preventScroll:true});
}
$('#menu-button').onclick = openMenu;
$('#dock-menu').onclick = openMenu;
$('#route-back').onclick = () => {
  if (routeTrail.length > 1) { routeTrail.pop(); location.hash = routeTrail.pop(); }
  else if (route().startsWith('tools/')) location.hash = 'tools';
};
$('#menu-close').onclick = closeMenu;
$('#sidebar').addEventListener('keydown', event => {
  if (!mobileNavigation.matches || event.key !== 'Tab') return;
  const controls = $$('a,button', $('#sidebar')).filter(el => !el.disabled && el.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
mobileNavigation.addEventListener('change', closeMenu);
syncSidebar();
$('#nav-backdrop').onclick = closeMenu;
$('#sidebar').addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
$('.skip').onclick = event => { event.preventDefault(); main.focus(); main.scrollIntoView({ block:'start' }); };
window.addEventListener('hashchange', () => { if (routeTrail.at(-1) !== route()) routeTrail.push(route()); filters = {query:'',kind:'all',tag:'',sort:'new'}; render(); window.scrollTo({top:0,behavior:'instant'}); });
mountHud();
document.addEventListener("zero:motion",()=>{if(!motionAllowed())stopPageMotion();});
renderNav(); load();
mountQuickSearch(() => [
  {title:'今日',detail:'全球股指 K线 汇率 今日重点 新闻 文学 摘句',href:'#today',external:false,icon:'graph',type:'页面'},
  ...allTools.map(tool => ({...tool, href:tool.url || '#tools/' + tool.id, external:!!tool.url, type:tool.url ? '在线工具' : '本地工具'})),
  ...live().map(item => ({...item, href:item.url, external:true, detail:item.note || item.url, icon:kinds[item.kind]?.[1] || 'link', type:'信息库'}))
]);
