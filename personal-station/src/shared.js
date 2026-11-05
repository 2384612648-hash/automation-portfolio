const paths = {
  convert:'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  music:'<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  diagram:'<rect x="8" y="2" width="8" height="6" rx="1"/><rect x="2" y="16" width="7" height="6" rx="1"/><rect x="15" y="16" width="7" height="6" rx="1"/><path d="M12 8v4H5v4m7-4h7v4"/>',
  graph:'<path d="M4 3v17h17M6 16c4 0 3-11 7-11s3 11 7 11"/>',
  language:'<path d="M3 5h12M9 2v3m4 0c-1 7-5 10-10 12m2-9c2 4 4 6 8 8m1 5 4-12 4 12m-6-4h4"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4Z"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  tools:'<path d="m14 6 4 4m-4-4 3-3 4 4-3 3-4 4-3 7-3-3 7-3M3 3l5 2 1 4-4-1Z"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  shield:'<path d="m12 3 8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6Z"/><path d="m8 12 3 3 5-6"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  x:'<path d="m6 6 12 12M6 18 18 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  external:'<path d="M14 3h7v7m0-7L10 14M10 3H4v17h17v-6"/>',
  file:'<path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 12h8m-8 4h6"/>',
  video:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/>',
  code:'<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
  link:'<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1" transform="translate(1 0) scale(.9 1)"/>',
  edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14ZM13 20h8"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  restore:'<path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  diff:'<path d="M4 5h16M4 10h6m6 0h4M4 15h9m3 0h4M4 20h16"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  up:'<path d="m6 14 6-6 6 6"/>',
  down:'<path d="m6 10 6 6 6-6"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
};
export const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.file) + '</svg>';
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const $ = (query, root = document) => root.querySelector(query);
export const $$ = (query, root = document) => [...root.querySelectorAll(query)];
export const bytes = value => value < 1024 ? value + ' B' : value < 1024 ** 2 ? (value / 1024).toFixed(1) + ' KB' : (value / 1024 ** 2).toFixed(2) + ' MB';
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
let toastTimer;
export function toast(message, error = false) {
  const el = $('#toast');
  clearTimeout(toastTimer); el.textContent = message; el.classList.toggle('error', error); el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 7000 : 4000);
}
export function showStatus(el, message, error = false) {
  el.textContent = message; el.classList.toggle('error', error);
}
