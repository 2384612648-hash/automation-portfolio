import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBars, chartGeometry, validateQuote } from '../src/today-data.js';

test('flat and single candle charts stay finite; OHLC orientation and stats are correct',()=>{
  const bars=Array.from({length:20},(_,i)=>({date:`day${i}`,open:10,high:12,low:8,close:10+i,volume:1}));
  const stats=inspectBars(bars);assert.equal(stats.ma20,19.5);assert.equal(stats.period,190);assert.ok(Math.abs(stats.change-100/28)<1e-9);
  const flat=chartGeometry([{open:10,high:10,low:10,close:10}]);
  assert.ok(Number.isFinite(flat.points[0].open));assert.equal(flat.points[0].open,flat.points[0].close);
  assert.equal(inspectBars([]),null);assert.equal(chartGeometry([]),null);
});
test('quote import validates every field and never retains an imported URL or executable markup field',()=>{
  const q=validateQuote({text:' 一句话 ',book:'书',author:'作者',note:'章节',url:'javascript:alert(1)'});
  assert.equal(q.text,'一句话');assert.equal(q.url,undefined);
  for(const value of [null,{}, {text:'a'.repeat(501),book:'b',author:'',note:''},{text:'',book:'b',author:'',note:''}]) assert.throws(()=>validateQuote(value));
});
