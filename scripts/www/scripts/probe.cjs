/** 数据体检：检查 5 年序列的走势、OHLC 自洽性、各周期聚合结果 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

const makeEl = () => ({
  innerHTML: '', textContent: '', value: '', dataset: {}, scrollTop: 0, style: {},
  classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
});
const nodes = new Map();
const sandbox = {
  document: {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeEl()); return nodes.get(id); },
    querySelectorAll: () => [],
    body: { addEventListener() {} },
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  console, setTimeout, clearTimeout, Math, Number, Date, JSON, String,
};
vm.createContext(sandbox);
vm.runInContext(`${code}
;globalThis.__probe = {
  histLen: HISTORY.length,
  first: HISTORY[0],
  last: HISTORY[HISTORY.length-1],
  minClose: Math.min(...HISTORY.map(d=>d.close)),
  maxClose: Math.max(...HISTORY.map(d=>d.close)),
  minLow: Math.min(...HISTORY.map(d=>d.low)),
  maxHigh: Math.max(...HISTORY.map(d=>d.high)),
  today: todayBar(),
  periods: ['D','W','M','Q','Y'].map(p=>({p, n: periodBars(p).length})),
  badOHLC: HISTORY.filter(d=>!(d.low<=Math.min(d.open,d.close) && d.high>=Math.max(d.open,d.close))).length,
  gapBad: HISTORY.filter((d,i)=> i>0 && Math.abs(d.open - HISTORY[i-1].close) > 0.005).length,
  intakeRange: [Math.min(...HISTORY.map(d=>d.intake)), Math.max(...HISTORY.map(d=>d.intake))],
  netRange: [Math.min(...HISTORY.map(d=>d.net)), Math.max(...HISTORY.map(d=>d.net))],
  netMean: Math.round(HISTORY.reduce((s,d)=>s+d.net,0)/HISTORY.length),
  yearBars: periodBars('Y').map(b=>({k:b.key, o:b.open, c:b.close, n:b.n})),
  qBars: periodBars('Q').slice(-6).map(b=>({k:b.key, o:b.open, c:b.close})),
  statsW: rangeStats(sliceDays(periodRange('W').start, periodRange('W').end)),
  statsM: rangeStats(sliceDays(periodRange('M').start, periodRange('M').end)),
  statsWP: rangeStats(sliceDays(periodRange('W').prevStart, periodRange('W').prevEnd)),
};
`, sandbox);

const d = sandbox.__probe;
console.log('序列长度:', d.histLen, '（应为 1825）');
console.log('起始日:', d.first.date, d.first.close, '| 末日:', d.last.date, d.last.close);
console.log('收盘范围:', d.minClose, '~', d.maxClose);
console.log('最低 low:', d.minLow, '| 最高 high:', d.maxHigh);
console.log('OHLC 不自洽条数:', d.badOHLC, '| 开收盘断裂条数:', d.gapBad);
console.log('摄入范围:', d.intakeRange, '| 净缺口范围:', d.netRange, '| 净缺口均值:', d.netMean);
console.log('今日:', JSON.stringify(d.today));
console.log('各周期根数:', d.periods.map((x) => x.p + '=' + x.n).join(' '));
console.log('年线:', d.yearBars.map((b) => `${b.k} ${b.o}→${b.c} (${b.n}天)`).join('  '));
console.log('近 6 季:', d.qBars.map((b) => `${b.k} ${b.o}→${b.c}`).join('  '));
console.log('\n本周:', JSON.stringify({ n: d.statsW.n, net: d.statsW.netSum, theory: +d.statsW.theory.toFixed(2), actual: +d.statsW.actual.toFixed(2), ok: d.statsW.okDays, proOk: d.statsW.proOk }));
console.log('上周:', JSON.stringify(d.statsWP ? { n: d.statsWP.n, net: d.statsWP.netSum, actual: +d.statsWP.actual.toFixed(2) } : null));
console.log('本月:', JSON.stringify({ n: d.statsM.n, net: d.statsM.netSum, theory: +d.statsM.theory.toFixed(2), actual: +d.statsM.actual.toFixed(2), ok: d.statsM.okDays }));
