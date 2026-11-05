import test from 'node:test';
import assert from 'node:assert/strict';
import {crossRates,marketStats,normalizeSeries,movingAverage,sparkline} from '../src/charts.js';
import {shuffledIndices,dailyQuoteIndex} from '../src/reading.js';
import {formatJson,convertText,timestampValue,isoTimestamp,generatePassword} from '../src/utility-data.js';
test('cross rates align dates, invert units and preserve same-currency identity',()=>{
 const s={CNY:[{date:'2026-10-02',value:7},{date:'2026-10-01',value:8}],EUR:[{date:'2026-10-02',value:.9}]};
 assert.deepEqual(crossRates(s,'CNY','EUR'),[{date:'2026-10-02',value:.9/7}]);
 assert.equal(crossRates(s,'CNY','USD')[1].value,1/7);
 assert.ok(crossRates(s,'CNY','CNY').every(r=>r.value===1));
 assert.equal(crossRates(s,'USD','USD').length,2);assert.deepEqual(crossRates(s,'GBP','CNY'),[]);
 assert.deepEqual(normalizeSeries([{date:'bad',value:1},{date:'2026-10-01',value:0},{date:'2026-10-02',value:NaN}]),[]);
});
test('market metrics use close drawdowns and sample volatility; flat series stay finite',()=>{
 const bars=[100,120,90,99].map((close,i)=>({date:'2026-10-0'+(i+1),open:close,close,high:close+1,low:close-1,volume:1}));
 const s=marketStats(bars);assert.equal(s.drawdown,-25);assert.ok(Math.abs(s.change-10)<1e-10);assert.ok(Math.abs(s.period+1)<1e-10);
 assert.deepEqual(movingAverage(bars,2).map(r=>r.value),[110,105,94.5]);
 assert.equal(marketStats([bars[0]]).volatility,null);assert.equal(marketStats([]),null);
 assert.ok(!sparkline([{date:'2026-10-01',value:10}]).includes('NaN'));
});
test('reading deck contains every item exactly once before exhaustion',()=>{
 for(const n of [0,1,4,3473]){const a=shuffledIndices(n);assert.equal(a.length,n);assert.equal(new Set(a).size,n);assert.ok(a.every(i=>i>=0&&i<n));}
});
test('text tools round-trip Unicode, validate JSON and enforce timestamp units',()=>{
 const input='中文 😃\nquotes " & /';assert.equal(convertText(convertText(input,'base64-encode'),'base64-decode'),input);
 assert.equal(convertText(convertText(input,'json-encode'),'json-decode'),input);
 assert.equal(convertText(convertText(input,'url-encode'),'url-decode'),input);
 assert.equal(formatJson('{"a":1}',true),'{"a":1}');assert.throws(()=>formatJson('{bad}'));
 assert.equal(timestampValue('0','seconds').toISOString(),'1970-01-01T00:00:00.000Z');
 assert.equal(isoTimestamp('1970-01-01T08:00:00+08:00'),0);assert.throws(()=>isoTimestamp('2026-11-01T12:00:00'));
 assert.throws(()=>timestampValue('1e30','seconds'));assert.throws(()=>timestampValue('999999999999999999','milliseconds'));
});
test('password rejection sampling removes modulo bias and respects bounds',()=>{
 const api={getRandomValues(a){a.set(Array.from({length:a.length},(_,i)=>i%2?1:255));return a;}};
 assert.equal(generatePassword(8,'abc',api),'bbbbbbbb');assert.throws(()=>generatePassword(7,'abc'));assert.throws(()=>generatePassword(8,''));
});

test('daily quote stays fixed in Shanghai date and changes across midnight',()=>{
 const a=new Date('2026-10-31T16:01:00Z'),b=new Date('2026-11-01T15:59:00Z'),c=new Date('2026-11-01T16:01:00Z');
 assert.equal(dailyQuoteIndex(3473,a),dailyQuoteIndex(3473,b));assert.notEqual(dailyQuoteIndex(3473,b),dailyQuoteIndex(3473,c));assert.equal(dailyQuoteIndex(0,a),0);
});
