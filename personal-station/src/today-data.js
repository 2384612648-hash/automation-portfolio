export const marketOptions = [
  ['sp500','标普 500','global'],['nasdaq','纳斯达克综合','global'],['dow','道琼斯工业','global'],['hsi','恒生指数','global'],['shanghai','上证指数','global'],
  ['shenzhen','深证成指','global'],['chinext','创业板指','global'],['csi300','沪深 300','global']
];
export const excerpts = [
  { text:'其实地上本没有路，走的人多了，也便成了路。',book:'故乡',author:'鲁迅',note:'经典选读 · 简体转写',url:'https://zh.wikisource.org/zh-hans/故乡' },
  { text:'我是一只猫。还没有名字。',book:'我是猫',author:'夏目漱石',note:'经典选读 · 日文开篇，本站译写',original:'吾輩は猫である。名前はまだ無い。',url:'https://www.aozora.gr.jp/cards/000148/files/789_14547.html' },
  { text:'幸福的家庭彼此相似；每个不幸的家庭，各有自己的不幸。',book:'安娜·卡列尼娜',author:'列夫·托尔斯泰',note:'经典选读 · 依 Garnett 英译本开篇译写',url:'https://www.gutenberg.org/files/1399/1399-h/1399-h.htm' },
  { text:'我想把自己塑造成一个积极的人，早日走向更广阔的世界。',book:'经营未来',author:'李明博',note:'我的阅读记录 · 第一章摘录，整理排版空格',url:'' }
];
export function validateQuote(value) {
  if (!value || typeof value !== 'object') throw new Error('摘句格式不正确');
  const result = {};
  for (const [key,max] of [['text',500],['book',80],['author',80],['note',150]]) {
    if (typeof value[key] !== 'string' || value[key].length > max) throw new Error('请检查摘句、书名与作者的长度');
    result[key] = value[key].trim();
  }
  if (!result.text || !result.book) throw new Error('请填写摘句和书名');
  return result;
}
export function inspectBars(bars) {
  if (!bars.length) return null;
  const last = bars.at(-1), previous = bars.at(-2);
  const pct = (a,b) => b > 0 ? (a/b-1)*100 : null;
  const ma20 = bars.length >= 20 ? bars.slice(-20).reduce((s,b)=>s+b.close,0)/20 : null;
  return {last, change:previous ? pct(last.close,previous.close) : null, period:pct(last.close,bars[0].close),ma20,high:Math.max(...bars.map(b=>b.high)),low:Math.min(...bars.map(b=>b.low))};
}
export function chartGeometry(bars, width=760, height=260) {
  if (!bars.length) return null;
  const low = Math.min(...bars.map(b=>b.low)), high = Math.max(...bars.map(b=>b.high));
  const margin = Math.max((high-low)*.12,high*.002,0.001), bottom=low-margin, top=high+margin;
  const y = value => 18+(top-value)/(top-bottom)*(height-44);
  const step=(width-94)/bars.length;
  return {top,bottom,step,points:bars.map((b,i)=>({x:18+(i+.5)*step,open:y(b.open),close:y(b.close),high:y(b.high),low:y(b.low)})),ticks:[0,.5,1].map(t=>({value:top-(top-bottom)*t,y:18+t*(height-44)}))};
}
