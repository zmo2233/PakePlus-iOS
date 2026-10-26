/**
 * 轻量渲染自检：用最小 DOM 桩跑通三个视图，抓 undefined / NaN 这类运行时脏值。
 * 不是单元测试框架，只做冒烟验证。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

const nodes = new Map();
const makeEl = () => ({
  innerHTML: '',
  textContent: '',
  value: '',
  dataset: {},
  scrollTop: 0,
  style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {},
});

const documentStub = {
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, makeEl());
    return nodes.get(id);
  },
  querySelectorAll() {
    return [];
  },
  body: { addEventListener() {} },
};

const _ls = new Map();
const localStorageStub = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
};

const sandbox = {
  document: documentStub,
  localStorage: localStorageStub,
  console,
  setTimeout,
  clearTimeout,
  Math,
  Number,
  Date,
  JSON,
  /* 备份码走 base64，Node 侧把浏览器这几个全局补上 */
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  TextEncoder,
  TextDecoder,
};

vm.createContext(sandbox);
const wrapped = `${code}
;globalThis.__views = ['market','nearby','log','review','profile'].map(function(v){
  state.view = v; render();
  return { view: v, html: document.getElementById('view').innerHTML };
});
;globalThis.__pf = ['nutri','set','data'].map(function(k){
  state.pfTab = k; state.view = 'profile'; render();
  return { tab: k, html: document.getElementById('view').innerHTML };
});
;globalThis.__periods = ['D','W','M','Q','Y'].map(function(p){
  state.period = p; state.view = 'market'; render();
  var bars = periodBars(p);
  return {
    p: p,
    n: bars.length,
    html: document.getElementById('view').innerHTML,
    first: bars[0], last: bars[bars.length-1],
    badOHLC: bars.filter(function(b){ return !(b.low <= Math.min(b.open,b.close) && b.high >= Math.max(b.open,b.close)); }).length
  };
});
;globalThis.__engine = {
  len: HISTORY.length,
  firstDate: HISTORY[0].date,
  lastDate: HISTORY[HISTORY.length-1].date,
  lastClose: HISTORY[HISTORY.length-1].close,
  minClose: Math.min.apply(null, HISTORY.map(function(d){return d.close;})),
  maxClose: Math.max.apply(null, HISTORY.map(function(d){return d.close;})),
  totalKg: HISTORY.reduce(function(s,d){return s+d.net;},0)/KCAL_PER_KG,
  gapBad: HISTORY.filter(function(d,i){ return i>0 && Math.abs(d.open - HISTORY[i-1].close) > 0.005; }).length,
  todayClose: selBar().close,
  todayOpen: selBar().open,
  streak: liveStreak(),
  yBars: periodBars('Y').map(function(b){ return { k:b.key, o:b.open, c:b.close }; })
};
;globalThis.__review = ['W','M'].map(function(k){
  state.reviewPeriod = k; state.view = 'review'; render();
  var r = periodRange(k);
  var ds = sliceDays(r.start, r.end);
  var st = rangeStats(ds);
  return {
    kind: k, label: r.label, n: ds.length,
    netSum: st.netSum, theory: st.theory, actual: st.actual, ok: st.okDays,
    html: document.getElementById('view').innerHTML
  };
});
;globalThis.__calc = {
  intake: intake(), burn: burn(), net: net(), kg: kgDelta(),
  fit: OPEN_PRICE - (state.weight + kgDelta()),
  bmr: bmr(), neat: neat(), tdee: tdee(), exercise: exerciseBurn(),
  budget: intakeBudget(), surplus: surplus(), td: targetDeficit()
};
;globalThis.__food = {
  a: caloriesOf({ per100: 89, grams: 350 }),
  b: caloriesOf({ per100: 36, grams: 500 }),
  c: caloriesOf({ per100: 470, grams: 200 }),
  eff: efficiency(shops[0]),
  shopCount: shops.length
};
;globalThis.__nutri = (function(){
  return { t: nutritionTargets(), g: dayNutrients(), budget: intakeBudget() };
})();
;globalThis.__parse = [
  ['能量 1234kJ 蛋白质 5.6g 脂肪 3.2g 碳水化合物 12.5g 膳食纤维 2.1g', { k:295, p:5.6, f:3.2, c:12.5, fb:2.1 }],
  ['营养成分表 每100克 能量 1671千焦 蛋白质 8.9克 脂肪 12.3克 碳水化合物 56.7克 膳食纤维 3.4克 钠 456毫克', { k:399, p:8.9, f:12.3, c:56.7, fb:3.4 }],
  ['蛋 白 质 5.6   脂 肪 3.2', { p:5.6, f:3.2 }],
  ['能量 200kcal 反式脂肪 0g 脂肪 10g', { k:200, f:10 }],
  ['蛋自质 7.2 脂防 4.1 碳水 30', { p:7.2, f:4.1, c:30 }],
  ['每100克 能量 1000kJ 12% 蛋白质 5.0g 8% 脂肪 3.0g 5% 碳水化合物 40.0g 13% 膳食纤维 2.0g 8%', { k:239, p:5, f:3, c:40, fb:2 }],
  ['每份（30g） 能量 500kJ 蛋白质 6.0g 脂肪 4.0g 碳水化合物 15.0g', { k:398, p:20, f:13.3, c:50 }],
  ['营养成分表 每100毫升 能量 180kJ 蛋白质 0g 脂肪 0g 碳水化合物 10.6g', { k:43, p:0, f:0, c:10.6 }]
].map(function(c){ return { input: c[0], got: parseNutritionText(c[0]), want: c[1] }; });
;globalThis.__budget = (function(){
  var out = {};
  out.w = state.weight;
  out.male = Math.round(bmrMifflin(out.w, 175, 32, 'male'));
  out.female = Math.round(bmrMifflin(out.w, 175, 32, 'female'));
  out.harris = Math.round(bmrHarris(out.w, 175, 32, 'male'));

  var keep = { mode: profile.mode, sex: profile.sex, age: profile.age, height: profile.height, activity: profile.activity, deficit: profile.deficit, manualKcal: profile.manualKcal };

  profile.mode='auto'; profile.sex='male'; profile.age=32; profile.height=175; profile.activity=1.3; profile.deficit=500;
  out.auto = budgetInfo();

  profile.mode='manual'; profile.manualKcal=1600;
  out.manual = budgetInfo();

  profile.mode='auto'; profile.activity=1.2; profile.deficit=1200;
  out.clamped = budgetInfo();

  profile.sex='female'; profile.deficit=1200;
  out.femaleClamp = budgetInfo();

  /* 恢复用户设置 */
  profile.mode=keep.mode; profile.sex=keep.sex; profile.age=keep.age;
  profile.height=keep.height; profile.activity=keep.activity;
  profile.deficit=keep.deficit; profile.manualKcal=keep.manualKcal;
  return out;
})();
;globalThis.__vol = [30, 90, 365].map(function(r){
  state.volRange = r; state.view = 'market'; render();
  var ds = volWindow(r);
  var st = volStats(ds);
  return {
    range: r, n: ds.length,
    sd: st.sd, weekly: st.weekly, snr: st.snr, inBandPct: st.inBandPct,
    maLast: st.maLast, theoryLast: st.theoryLast, maxUp: st.maxUp, maxDown: st.maxDown,
    html: document.getElementById('view').innerHTML
  };
});
;state.volRange = 30;
globalThis.__volRange = state.volRange;
;globalThis.__learn = (function(){
  var before = userFoods.length;
  learnFood('楼下那家红烧肉', 456);
  learnFood('楼下那家红烧肉', 470);
  var hits = searchFood('红烧肉');
  return {
    before: before,
    after: userFoods.length,
    kcal: userFoods[0] ? userFoods[0].k : null,
    first: hits[0] ? hits[0].n : null,
    mine: hits[0] ? !!hits[0].mine : false,
    total: hits.length
  };
})();
;globalThis.__board = (function(){
  var W = 360;
  function check(items, H){
    var blocks = squarify(items.slice().sort(function(a,b){return b.v-a.v;}), 0, 0, W, H);
    var total = items.reduce(function(s,i){return s+i.v;},0);
    var sum = 0, worst = 0, oob = 0, ov = 0;
    blocks.forEach(function(b){
      sum += b.w*b.h;
      var want = (b.v/total)*W*H, got = b.w*b.h;
      worst = Math.max(worst, Math.abs(got-want)/want);
      if (b.x < -1e-6 || b.y < -1e-6 || b.x+b.w > W+1e-6 || b.y+b.h > H+1e-6) oob++;
    });
    for (var i=0;i<blocks.length;i++) for (var j=i+1;j<blocks.length;j++){
      var a=blocks[i], c=blocks[j];
      var ox = Math.min(a.x+a.w, c.x+c.w) - Math.max(a.x, c.x);
      var oy = Math.min(a.y+a.h, c.y+c.h) - Math.max(a.y, c.y);
      if (ox > 0.01 && oy > 0.01) ov++;
    }
    return { n: blocks.length, areaErr: Math.abs(sum - W*H), ratioErr: worst, oob: oob, overlap: ov };
  }
  var sell = [{label:'基础代谢',v:1581},{label:'日常活动 ×1.3',v:474},{label:'慢跑',v:234},{label:'力量训练',v:193}];
  var buy  = [{label:'红烧肉盖饭',v:820},{label:'奶茶（三分糖）',v:380},{label:'拿铁（大杯）',v:380},{label:'鸡胸沙拉',v:310}];
  var sellSum = sell.reduce(function(s,i){return s+i.v;},0);
  var buySum  = buy.reduce(function(s,i){return s+i.v;},0);
  var hz = boardHeights(sellSum, buySum);
  return {
    sell: check(sell, 100),
    buy: check(buy, 72),
    lopsided: check([{label:'a',v:900},{label:'b',v:40},{label:'c',v:30},{label:'d',v:20},{label:'e',v:10}], 100),
    twelve: check(Array.from({length:12},function(_,i){return {label:'x'+i,v:100+i*37};}), 110),
    heights: hz,
    ratio: hz.hb / hz.hi,
    wantRatio: sellSum / buySum,
    edgeZero: boardHeights(0, 0),
    fit: [
      fitText('日常活动 ×1.3', 85, 10.5),
      fitText('红烧肉盖饭', 120, 10.5),
      fitText('这个项目名字特别长超过一块地方', 56, 10.5)
    ]
  };
})();
;globalThis.__boardTab = (function(){
  var keep = state.boardTab;
  state.boardTab = 'month'; render();
  var html = document.getElementById('view').innerHTML;
  state.boardTab = keep; render();
  return {
    mtd: html.includes('MTD'),
    active: /class="bd-tab on" data-board="month"/.test(html),
    rects: (html.match(/<rect/g) || []).length,
    intake: html.split("hsl(152").length - 1,
    week: (html.indexOf("第1周") >= 0 ? 1 : 0),
    cells: (html.match(/本月净缺口/g) || []).length
  };
})();
;globalThis.__date = (function(){
  var t = todayStr();
  var past = HISTORY[HISTORY.length - 8].date;
  var rec = histRecord(past);
  switchDate(past);
  var a1 = { date: past, intake: intake(), burn: burn(), net: net(), cast: net()/KCAL_PER_KG,
             archived: !!archivedDay(), last: ALL_DAYS()[ALL_DAYS().length-1].date,
             recIntake: rec.intake, recBurn: rec.burn, recNet: rec.net,
             price: liveWeight(), recClose: rec.close,
             html: document.getElementById('view').innerHTML,
             barDate: document.querySelector ? 0 : 0 };
  state.logs.push({ id: 9991, type: 'food', name: '补记午餐', kcal: 500, p: 30, f: 12, c: 40, fb: 5 });
  saveLogs();
  state.view = 'market'; render();
  var a2 = { intake: intake(), archived: !!archivedDay(),
             last: ALL_DAYS()[ALL_DAYS().length-1].date,
             html: document.getElementById('view').innerHTML };
  switchDate(t);
  var a3 = { intake: intake(), archived: !!archivedDay(), date: state.selDate,
             last: ALL_DAYS()[ALL_DAYS().length-1].date, today: t };
  switchDate(past);
  var a4 = { intake: intake(), count: state.logs.length, archived: !!archivedDay() };
  switchDate(t);
  return { past: past, a1: a1, a2: a2, a3: a3, a4: a4, keys: Object.keys(DAY_STORE) };
})();
;globalThis.__link = (function(){
  /* K 线密度三档 */
  state.view = 'market'; state.period = 'D';
  state.kZoom = 0; render(); var n0 = periodBars('D').length;
  state.kZoom = 1; render(); var n1 = periodBars('D').length;
  state.kZoom = 2; render(); var n2 = periodBars('D').length;
  state.kZoom = 1; render();

  /* 静态基线：这一帧什么都没改，不应该有任何补间标记 */
  var h1 = document.getElementById('view').innerHTML;
  var base = {
    groups: (h1.match(/class="bd-blk/g) || []).length,
    buyJump: h1.indexOf('data-view="nearby"') >= 0,
    sellJump: h1.indexOf('data-view="log"') >= 0,
    fromCount: (h1.match(/data-from/g) || []).length,
    zoomBtns: (h1.match(/data-kzoom/g) || []).length
  };

  /* 买一笔 1200 kcal 的炸鸡桶，再看同一张大盘 */
  state.logs.push({ id: 9002, type: 'food', name: '炸鸡桶', kcal: 1200, p: 42, f: 78, c: 96, fb: 3 });
  render();
  var h2 = document.getElementById('view').innerHTML;
  var after = {
    groups: (h2.match(/class="bd-blk/g) || []).length,
    fromCount: (h2.match(/data-from/g) || []).length,
    flash: (h2.match(/bd-flash/g) || []).length,
    animSvg: h2.indexOf('class="bd-anim"') >= 0,
    hasNew: h2.indexOf('炸鸡桶') >= 0,
    intake: intake()
  };

  /* 换交易日应当判定为"换了一张图"：不补间、直接落地 */
  var past = HISTORY[HISTORY.length - 10].date;
  switchDate(past);
  var h3 = document.getElementById('view').innerHTML;
  var ctxBreak = { fromCount: (h3.match(/data-from/g) || []).length };
  switchDate(todayStr());

  /* 卖一笔，卖盘应该动 */
  state.view = 'market'; render();
  var h4 = document.getElementById('view').innerHTML;
  var beforeSell = (h4.match(/data-from/g) || []).length;
  state.logs.push({ id: 9003, type: 'burn', name: '爬楼梯', kcal: 260, mins: 25, met: 6 });
  render();
  var h5 = document.getElementById('view').innerHTML;

  /* 补间数学：DOM 桩里没有真实元素，手工造一个 rect 并接管 rAF 时钟，
     确认第 3 帧在中间、最后一帧落到目标值、data-from 被清掉。 */
  var q = [];
  globalThis.requestAnimationFrame = function (cb) { q.push(cb); };
  var fake = {
    attrs: { x: '9', y: '9', width: '9', height: '9', 'data-from': '0,0,10,10' },
    getAttribute: function (k) { return this.attrs[k]; },
    setAttribute: function (k, v) { this.attrs[k] = v; },
    removeAttribute: function (k) { delete this.attrs[k]; }
  };
  document.querySelectorAll = function () { return [fake]; };
  bindBoardAnim();
  var clock = 1000, mid = null;
  for (var i = 0; i < 7; i++) {
    clock += 100;
    var batch = q.splice(0);
    batch.forEach(function (cb) { cb(clock); });
    if (i === 2) mid = { x: Number(fake.attrs.x), w: Number(fake.attrs.width) };
  }
  var end = { x: Number(fake.attrs.x), y: Number(fake.attrs.y),
              w: Number(fake.attrs.width), h: Number(fake.attrs.height),
              cleared: !('data-from' in fake.attrs) };
  document.querySelectorAll = function () { return []; };
  globalThis.requestAnimationFrame = undefined;

  return { n0: n0, n1: n1, n2: n2, base: base, after: after, ctxBreak: ctxBreak,
           beforeSell: beforeSell, sellFrom: (h5.match(/data-from/g) || []).length,
           mid: mid, end: end,
           /* 窄块按三级密度只留数字，所以这里查数值而不是名字 */
           sellNamed: h5.indexOf('-260') >= 0 };
})();
;globalThis.__ex = (function(){
  var keep = { pick: state.exDraft.pick, name: state.exDraft.name, met: state.exDraft.met, mins: state.exDraft.mins, kcal: state.exDraft.kcal };
  var w = state.weight;
  var out = {
    weight: w,
    kcalRun30: metBurn(8.3, 30),
    kcalRun60: metBurn(8.3, 60),
    kcalWalk30: metBurn(4.3, 30),
    rawMet30: Math.round(8.3 * w * 0.5),        // 不减 1 的错误写法，用来对比差多少
    zero: metBurn(8.3, 0),
    metOne: metBurn(1, 60)                       // MET=1 应当为 0
  };

  state.view = 'log';
  state.exEditId = null;
  state.exDraft = { pick: 1, name: '慢跑', met: 8.3, mins: 30, kcal: null };
  render();
  syncExDom();
  out.html = document.getElementById('view').innerHTML;
  out.formula = document.getElementById('ex-formula').textContent;
  out.formKcal = document.getElementById('ex-kcal').value;

  /* 点跳绳，再改 45 分钟 */
  pickEx(5);
  out.pickMet = state.exDraft.met;
  state.exDraft.mins = 45;
  state.exDraft.kcal = null;
  syncExDom();
  out.pickKcalDom = document.getElementById('ex-kcal').value;

  /* 手改消耗值 */
  state.exDraft.kcal = 300;
  syncExDom();
  out.manualDom = document.getElementById('ex-kcal').value;

  /* 保存 */
  var before = state.logs.length, beforeBurn = exerciseBurn();
  saveEx();
  var added = state.logs[state.logs.length - 1];
  out.countDelta = state.logs.length - before;
  out.addedName = added.name;
  out.addedKcal = added.kcal;
  out.addedMins = added.mins;
  out.burnDelta = exerciseBurn() - beforeBurn;

  /* 点开编辑 → 改 60 分钟 → 保存：改时长应回到公式值 */
  state.exEditId = added.id;
  state.exDraft = { pick: -1, name: added.name, met: added.met, mins: added.mins, kcal: added.kcal };
  state.exDraft.mins = 60;
  state.exDraft.kcal = null;
  var b2 = exerciseBurn();
  saveEx();
  out.editKcal = state.logs[state.logs.length - 1].kcal;
  out.editBurnDelta = exerciseBurn() - b2;
  out.editExpect = metBurn(added.met, 60);

  /* 复原，别污染后续用例 */
  state.logs.pop();
  state.exDraft = keep;
  state.exEditId = null;
  return out;
})();
;globalThis.__backup = (function(){
  var out = {};
  var ALL = ['calex.daylog.v2','calex.shops.v1','calex.myfoods.v1','calex.profile.v1','calex.snap.idx','calex.meta.v1'];
  var orig = {};
  ALL.forEach(function(k){ orig[k] = localStorage.getItem(k); });

  /* ---- 造一份已知数据，模拟"已经记了几天" ---- */
  localStorage.setItem('calex.daylog.v2', JSON.stringify({
    '2026-10-20': [{id:1,type:'food',name:'米饭',kcal:300},{id:2,type:'burn',name:'慢跑',kcal:200}],
    '2026-10-21': [{id:3,type:'food',name:'鸡胸',kcal:250}]
  }));
  localStorage.setItem('calex.shops.v1', JSON.stringify([{id:'s1',shop:'甲',dish:'A'},{id:'s2',shop:'乙',dish:'B'}]));
  localStorage.setItem('calex.myfoods.v1', JSON.stringify([{n:'自制沙拉',k:80}]));
  localStorage.setItem('calex.profile.v1', JSON.stringify({mode:'auto',sex:'male',age:30,height:180,activity:1.3,deficit:500,manualKcal:1800,weight:70.5}));

  var pack = buildBackup();
  out.pack = { app: pack.app, schema: pack.schema, days: pack.stats.days, items: pack.stats.items,
               shops: pack.stats.shops, foods: pack.stats.foods,
               first: pack.stats.first, last: pack.stats.last };
  out.bytes = JSON.stringify(pack).length;

  /* ---- 1) 文件通道：JSON 往返 ---- */
  var back = parseBackup(JSON.stringify(pack));
  out.roundTrip = { days: back.stats.days, items: back.stats.items,
                    weight: back.data.profile ? back.data.profile.weight : null,
                    shops: (back.data.shops || []).length };

  /* ---- 2) 备份码通道：base64 往返 ---- */
  var code = backupCode();
  out.code = { tag: code.slice(0,7), len: code.length, days: parseBackup(code).stats.days };

  /* ---- 3) 脏输入必须被挡住，不能往 localStorage 里灌 ---- */
  out.rejects = ['', 'hello', '{"a":1}', '{"app":"other","data":{}}', 'CALEX1:!!!not-base64']
    .map(function(t){ try { parseBackup(t); return 0; } catch(e){ return 1; } });

  /* ---- 4) 覆盖恢复：本机数据应被整体替换 ---- */
  localStorage.setItem('calex.daylog.v2', JSON.stringify({'2026-01-01':[{id:9,type:'food',name:'别的',kcal:1}]}));
  applyData(back.data);
  var after = dataStats(collectData());
  out.replace = { days: after.days, items: after.items,
                  same: JSON.stringify(collectData().daylog) === JSON.stringify(back.data.daylog) };

  /* ---- 5) 合并：本机多一天 + 同一天多一笔，都不能丢 ---- */
  var cur = {
    daylog: { '2026-10-21': [{id:3,type:'food',name:'鸡胸',kcal:250},{id:4,type:'food',name:'新记的',kcal:100}],
              '2026-10-25': [{id:5,type:'food',name:'升级后记的',kcal:120}] },
    shops: [{id:'s9',shop:'新店',dish:'C'}],
    foods: [{n:'新食物',k:50}],
    profile: {mode:'manual',manualKcal:1500}
  };
  var merged = mergeData(cur, back.data);
  out.merge = {
    days: Object.keys(merged.daylog).sort().join(','),
    items: dataStats(merged).items,
    shops: merged.shops.length,
    foods: merged.foods.length,
    day1021: merged.daylog['2026-10-21'].length,     /* 同一天 1 旧 + 1 新，且旧的不能重复 */
    profileKept: merged.profile.manualKcal            /* 合并时设置保留本机 */
  };

  /* ---- 6) applyData 只动 4 个已知键 ---- */
  localStorage.setItem('calex.other', 'keepme');
  applyData(merged);
  out.isolated = localStorage.getItem('calex.other') === 'keepme';

  /* ---- 7) 快照环形：存 9 份只留 6 份，最老的被淘汰 ---- */
  localStorage.removeItem('calex.snap.idx');
  for (var i = 0; i < 9; i++) takeSnapshot('t' + i, true);
  var idx = snapIndex();
  out.snap = {
    n: idx.length,
    newest: idx[0].reason,
    oldest: idx[idx.length - 1].reason,
    stored: idx.filter(function(s){ return !!localStorage.getItem('calex.snap.' + s.id); }).length
  };

  /* ---- 8) 回滚：改成错的数据，回滚后应恢复原样 ---- */
  localStorage.removeItem('calex.snap.idx');
  applyData({ daylog: { '2026-10-01': [{id:1,type:'food',name:'a',kcal:1}],
                        '2026-10-02': [{id:2,type:'food',name:'b',kcal:2}] },
              shops: [], foods: [], profile: {} });
  var sid = takeSnapshot('回滚测试', true);
  applyData({ daylog: { '2026-10-03': [{id:3,type:'food',name:'c',kcal:3}] },
              shops: [], foods: [], profile: {} });
  var mid = dataStats(collectData()).days;
  restoreSnapshot(sid);
  out.rollback = { mid: mid, after: dataStats(collectData()).days, snaps: snapIndex().length };

  /* ---- 9) 空库不该产生快照（避免把演示数据当成用户数据） ---- */
  localStorage.removeItem('calex.snap.idx');
  ['calex.daylog.v2','calex.shops.v1','calex.myfoods.v1','calex.profile.v1'].forEach(function(k){ localStorage.removeItem(k); });
  out.emptySnap = takeSnapshot('空库', false) === null;

  /* ---- 复原 ---- */
  snapIndex().forEach(function(s){ localStorage.removeItem('calex.snap.' + s.id); });
  ['calex.snap.idx','calex.other'].forEach(function(k){ localStorage.removeItem(k); });
  ALL.forEach(function(k){
    if (orig[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, orig[k]);
  });
  return out;
})();
`;
vm.runInContext(wrapped, sandbox);

let failed = 0;
const fail = (msg) => {
  console.log('  FAIL ' + msg);
  failed++;
};

for (const v of sandbox.__views) {
  const bad = [];
  if (v.html.includes('undefined')) bad.push('undefined');
  if (v.html.includes('NaN')) bad.push('NaN');
  if (v.html.trim().length < 500) bad.push('内容过短(' + v.html.length + ')');
  console.log(`${v.view.padEnd(8)} ${String(v.html.length).padStart(6)} bytes  ${bad.length ? 'FAIL: ' + bad.join(',') : 'OK'}`);
  bad.forEach(fail);
}

const pm = sandbox.__periods;
console.log('\n周期 K 线自检:');
/* 默认「中」档：日 24 / 周 26 / 月 18 / 季 12 / 年 5，刻意比原来少一半，避免糊成一片 */
const wantN = { D: 24, W: 26, M: 18, Q: 12, Y: 5 };
pm.forEach((x) => {
  const bad = [];
  if (x.html.includes('undefined') || x.html.includes('NaN')) bad.push('脏值');
  if (x.badOHLC) bad.push('OHLC 不自洽 ' + x.badOHLC);
  if (!x.html.includes('k-wrap')) bad.push('缺少图表');
  if (x.n !== wantN[x.p]) bad.push(`根数 ${x.n} ≠ ${wantN[x.p]}`);
  if (!(x.last.close > 60 && x.last.close < 90)) bad.push('末根收盘异常 ' + x.last.close);
  console.log(`  ${x.p} ${String(x.n).padStart(2)} 根  ${x.first.from} → ${x.last.to}  收 ${x.last.close}  ${bad.length ? 'FAIL: ' + bad.join(',') : 'OK'}`);
  bad.forEach(fail);
});

const eg = sandbox.__engine;
console.log('\n行情引擎自检:');
console.log(`  序列 ${eg.len} 天  ${eg.firstDate} → ${eg.lastDate}`);
console.log(`  收盘区间 ${eg.minClose} ~ ${eg.maxClose}，累计缺口折算 ${eg.totalKg.toFixed(2)} kg`);
console.log(`  末日收盘 ${eg.lastClose}（应等于当前报价 64.20）| 今日实时 ${eg.todayOpen} → ${eg.todayClose}`);
console.log(`  连续做空 ${eg.streak} 天 | 年线 ${eg.yBars.map((b) => b.k + ':' + b.o + '→' + b.c).join(' ')}`);
if (eg.len !== 1825) fail('序列应为 1825 天，实际 ' + eg.len);
if (Math.abs(eg.lastClose - 64.2) > 0.005) fail('末日收盘应等于 64.20，实际 ' + eg.lastClose);
if (eg.gapBad !== 0) fail('存在开收盘断裂 ' + eg.gapBad + ' 处');
if (Math.abs(eg.totalKg - -15.2) > 0.08) fail('累计缺口折算应逼近 -15.20 kg，实际 ' + eg.totalKg.toFixed(2));
if (Math.abs(eg.todayOpen - 64.2) > 0.005) fail('今日开盘应等于昨收 64.20，实际 ' + eg.todayOpen);
if (Math.abs(eg.todayClose - sandbox.__calc.fit - 64.2) > 0.005 && Math.abs(eg.todayClose - (64.2 + sandbox.__calc.kg)) > 0.005) {
  fail('今日收盘应等于昨收 + 净缺口当量');
}
if (eg.streak < 1) fail('连续做空天数应大于 0');
if (eg.yBars.length !== 5) fail('年线应显示 5 根（默认档位），实际 ' + eg.yBars.length);

const rv = sandbox.__review;
console.log('\n复盘页自检:');
rv.forEach((x) => {
  const bad = [];
  if (x.html.includes('undefined') || x.html.includes('NaN')) bad.push('脏值');
  if (x.n !== (x.kind === 'W' ? 7 : 30)) bad.push('窗口天数 ' + x.n);
  if (!x.html.includes('达标日历')) bad.push('缺少日历');
  if (!x.html.includes('小结')) bad.push('缺少小结');
  if (!x.html.includes('成绩单')) bad.push('缺少环比');
  console.log(`  ${x.kind} ${x.label} ${x.n} 天  净缺口 ${x.netSum} kcal · 理论 ${x.theory.toFixed(2)} kg · 实际 ${x.actual.toFixed(2)} kg · 达标 ${x.ok} 天  ${bad.length ? 'FAIL' : 'OK'}`);
  bad.forEach(fail);
});


const c = sandbox.__calc;
/* 屏幕按盈亏口径显示：赚了是正数，所以显示值 = −net */
const profit = -c.net;
console.log('\n计算自检:');
console.log(`  摄入 ${c.intake} / 消耗 ${c.burn} / 净额(内) ${c.net} → 盈亏 ${profit > 0 ? '+' : ''}${profit} kcal / 折算 ${c.kg.toFixed(4)} kg / 空头仓位 ${c.fit.toFixed(2)} kg`);
if (c.intake !== 1890) fail('摄入应为 1890，实际 ' + c.intake);
if (c.burn !== c.bmr + c.neat + c.exercise) fail('总消耗应 = 基础代谢 + 日常活动 + 运动');
if (c.neat !== c.tdee - c.bmr) fail('日常活动应 = TDEE − BMR');
if (c.net !== c.intake - c.burn) fail('净额应 = 摄入 − 消耗');
if (c.surplus !== c.intake - c.budget) fail('盈余应 = 摄入 − 预算');

const marketHtml = sandbox.__views[0].html;
if (!marketHtml.includes('64.20')) fail('行情页缺少当前体重 64.20');
/* 行情页的数值落在大盘缺口上（"净额"字样在卖出页） */
const gapRe = new RegExp('bd-gap-n (down|up|flat)"><span>[\u2197\u2198\u2192] ' + (profit > 0 ? '\\+' : '-') + Math.abs(profit) + '</span>');
if (!gapRe.test(marketHtml)) fail('大盘缺口应按盈亏口径显示，内部净额 ' + c.net);
const logHtml = sandbox.__views[2].html;
if (!logHtml.includes('净额 ' + (profit > 0 ? '+' : '-') + Math.abs(profit))) fail('卖出页净额应按盈亏口径显示，内部净额 ' + c.net);
if (!marketHtml.includes('体重波动')) fail('行情页缺少体重波动卡片');
if (!marketHtml.includes('今日热量')) fail('行情页缺少热量预算卡片');
if (!/class="bd-gap-n (up|down|flat)"/.test(marketHtml)) fail('大盘卡缺少净缺口配色');
if (c.net < 0 && !marketHtml.includes('bd-gap-n down')) fail('净缺口为负时应使用 down 配色');
if (c.net > 0 && !marketHtml.includes('bd-gap-n up')) fail('净缺口为正时应使用 up 配色');

const f = sandbox.__food;
console.log('\n克重换算自检:');
console.log(`  89 kcal/100g × 350g = ${f.a} kcal`);
console.log(`  36 kcal/100g × 500g = ${f.b} kcal`);
console.log(`  470 kcal/100g × 200g = ${f.c} kcal`);
console.log(`  轻食工坊做空效率 = ${f.eff} kcal/元，默认标的 ${f.shopCount} 个`);
if (f.a !== 312) fail('89×350/100 应为 312，实际 ' + f.a);
if (f.b !== 180) fail('36×500/100 应为 180，实际 ' + f.b);
if (f.c !== 940) fail('470×200/100 应为 940，实际 ' + f.c);
if (f.shopCount !== 6) fail('默认标的应为 6 个，实际 ' + f.shopCount);
if (f.eff < 19 || f.eff > 20) fail('轻食工坊做空效率应落在 19~20，实际 ' + f.eff);

const lr = sandbox.__learn;
console.log('\n个人食物库自检:');
console.log(`  录入前 ${lr.before} 条 → 录入后 ${lr.after} 条（同名重复录入应只更新）`);
console.log(`  热量更新为 ${lr.kcal}，搜索首条「${lr.first}」${lr.mine ? '（标记为我的）' : ''}，共 ${lr.total} 条结果`);
if (lr.before !== 0) fail('初始个人食物库应为空，实际 ' + lr.before);
if (lr.after !== 1) fail('同名食物重复录入应只保留 1 条，实际 ' + lr.after);
if (lr.kcal !== 470) fail('同名食物热量应更新为 470，实际 ' + lr.kcal);
if (!lr.mine) fail('搜索结果应优先返回个人食物库条目');
if (lr.total < 2) fail('搜索「红烧肉」应同时命中个人库与内置库，实际 ' + lr.total + ' 条');

const nu = sandbox.__nutri;
console.log('\n营养目标自检:');
console.log(`  目标  热量 ${nu.t.kcal} / 蛋白 ${nu.t.p}g / 脂肪 ${nu.t.f}g / 碳水 ${nu.t.c}g / 纤维 ${nu.t.fb}g`);
console.log(`  已摄入 热量 ${nu.g.kcal} / 蛋白 ${nu.g.p}g / 脂肪 ${nu.g.f}g / 碳水 ${nu.g.c}g / 纤维 ${nu.g.fb}g`);
if (nu.t.kcal !== nu.budget) fail('热量目标应等于当日预算，实际 ' + nu.t.kcal + ' vs ' + nu.budget);
if (nu.t.p !== Math.round(64.2 * 1.8)) fail('蛋白目标应为体重×1.8，实际 ' + nu.t.p);
if (nu.t.f !== Math.round((nu.budget * 0.25) / 9)) fail('脂肪目标应为预算的 25% 供能，实际 ' + nu.t.f);
if (nu.t.c !== Math.max(0, Math.round((nu.budget - nu.t.p * 4 - nu.t.f * 9) / 4))) fail('碳水应补齐剩余热量，实际 ' + nu.t.c);
if (nu.g.kcal !== 1890) fail('今日热量应为 1890，实际 ' + nu.g.kcal);
if (nu.g.p !== 78) fail('今日蛋白应为 78g，实际 ' + nu.g.p);
if (nu.g.f !== 83) fail('今日脂肪应为 83g，实际 ' + nu.g.f);
if (nu.g.c !== 205) fail('今日碳水应为 205g，实际 ' + nu.g.c);
if (nu.g.fb !== 9) fail('今日纤维应为 9g，实际 ' + nu.g.fb);

console.log('\n成分表解析自检:');
sandbox.__parse.forEach((c) => {
  const bad = Object.keys(c.want).filter((k) => c.got[k] !== c.want[k]);
  const label = c.input.length > 36 ? c.input.slice(0, 36) + '…' : c.input;
  console.log(`  ${bad.length ? 'FAIL' : 'OK  '} ${label}`);
  if (bad.length) {
    console.log(`       期望 ${JSON.stringify(c.want)} → 实际 ${JSON.stringify(c.got)}`);
    fail('解析不符: ' + label);
  }
});

const nutriHtml = sandbox.__pf[0].html;
if (!nutriHtml.includes('营养素达标')) fail('营养分段缺少达标卡');
if (!nutriHtml.includes('蛋白质')) fail('营养分段缺少蛋白质行');
if (!nutriHtml.includes('膳食纤维')) fail('营养分段缺少膳食纤维行');
if (!nutriHtml.includes('今日还缺什么')) fail('营养分段缺少未达标清单');
if (!nutriHtml.includes('data-pftab="nutri"')) fail('「我的」页缺少营养分段切换');
if (nutriHtml.includes('data-pf="height"')) fail('营养分段不应混进设置项');

/* ---------- 导航结构：买入 / 卖出 / 营养并入我的 ---------- */
console.log('\n导航结构自检:');
const navBlock = html.slice(html.indexOf('<nav>'), html.indexOf('</nav>'));
const navViews = [...navBlock.matchAll(/data-view="(\w+)"/g)].map((m) => m[1]);
console.log(`  页签 ${navViews.length} 个: ${navViews.join(' / ')}`);
if (navViews.join(',') !== 'market,nearby,log,review,profile') fail('导航页签应为 5 个（行情/买入/卖出/复盘/我的），实际 ' + navViews.join(','));
if (!navBlock.includes('买入')) fail('导航缺少「买入」');
if (!navBlock.includes('卖出')) fail('导航缺少「卖出」');
if (navBlock.includes('营养')) fail('营养不应再占独立页签');
if (navBlock.includes('附近')) fail('「附近」应改名为「买入」');
if (navBlock.includes('记账')) fail('「记账」应改名为「卖出」');

const nearbyHtml = sandbox.__views[1].html;
if (!nearbyHtml.includes('350g')) fail('附近页缺少克重显示');
if (!nearbyHtml.includes('312 kcal')) fail('附近页缺少按克重换算的热量');
if (!nearbyHtml.includes('data-edit')) fail('附近页缺少编辑入口');
if (!nearbyHtml.includes('添加自己的标的')) fail('附近页缺少新增入口');

/* ---------- 预算测算 ---------- */
const b = sandbox.__budget;
console.log('\n热量预算自检:');
console.log(`  64.2kg / 175cm / 32 岁 → BMR 男 ${b.male} · 女 ${b.female} · Harris ${b.harris} kcal`);
console.log(`  自动模式: 预算 ${b.auto.kcal} = TDEE ${b.auto.tdee} + 运动 ${b.auto.exercise} − 缺口 ${b.auto.deficit}`);
console.log(`  手动模式: 预算 ${b.manual.kcal}（不随运动变化）`);
console.log(`  缺口 1200 触发下限: 男 ${b.clamped.raw} → ${b.clamped.kcal}（下限 ${b.clamped.floor}）`);
console.log(`  女性同条件: ${b.femaleClamp.raw} → ${b.femaleClamp.kcal}（下限 ${b.femaleClamp.floor}）`);

if (b.male !== Math.round(10 * b.w + 6.25 * 175 - 5 * 32 + 5)) fail('男性 BMR 与 Mifflin 公式不符');
if (b.female !== Math.round(10 * b.w + 6.25 * 175 - 5 * 32 - 161)) fail('女性 BMR 与 Mifflin 公式不符');
if (b.female >= b.male) fail('同身高体重年龄下女性 BMR 应低于男性');
if (b.harris <= b.male) fail('Harris-Benedict 应高于 Mifflin（这是已知的系统性偏高）');
if (b.auto.tdee !== Math.round((10 * b.w + 6.25 * 175 - 5 * 32 + 5) * 1.3)) fail('TDEE 应 = BMR × 活动系数');
if (b.auto.kcal !== b.auto.tdee + b.auto.exercise - 500) fail('自动预算应 = TDEE + 运动 − 缺口，实际 ' + b.auto.kcal);
if (b.auto.capped) fail('正常缺口不该触发下限');
if (b.manual.kcal !== 1600) fail('手动模式预算应等于手填值，实际 ' + b.manual.kcal);
if (!b.clamped.capped) fail('缺口 1200 应触发安全下限');
if (b.clamped.kcal !== b.clamped.floor) fail('触发下限后预算应等于下限');
if (b.femaleClamp.floor >= b.clamped.floor) fail('女性安全下限应低于男性');
if (b.clamped.kcal < Math.round(b.clamped.bmr * 0.85)) fail('预算不应低于基础代谢的 85%');
if (b.clamped.kcal >= b.clamped.bmr + 200) fail('下限夹紧后不应仍接近 BMR 之上很多');

const profileHtml = sandbox.__pf[1].html;
if (!profileHtml.includes('热量设置')) fail('我的页缺少标题');
if (!profileHtml.includes('data-pftab="set"')) fail('「我的」页缺少设置分段切换');
if (!profileHtml.includes('data-pf="height"')) fail('设置分段缺身高输入');
if (!profileHtml.includes('基础代谢 BMR')) fail('我的页缺少 BMR 行');
if (!profileHtml.includes('Mifflin')) fail('我的页缺少公式说明');
if (!profileHtml.includes('data-pf="height"')) fail('我的页缺身高输入');
if (!profileHtml.includes('data-pf="weight"')) fail('我的页缺体重输入');
if (!profileHtml.includes('data-act')) fail('我的页缺活动系数选择');
if (!profileHtml.includes('data-mode="manual"')) fail('我的页缺手动预算切换');

/* ---------- 体重波动曲线 ---------- */
console.log('\n体重波动自检:');
sandbox.__vol.forEach((v) => {
  const bad = [];
  if (v.n !== v.range) bad.push(`窗口 ${v.n} ≠ ${v.range}`);
  if (!(v.sd > 0.05 && v.sd < 2)) bad.push('sigma 异常 ' + v.sd);
  if (!isFinite(v.weekly)) bad.push('趋势非数');
  if (v.inBandPct < 45 || v.inBandPct > 90) bad.push(`带内比例 ${v.inBandPct.toFixed(0)}% 不合常理`);
  if (v.maxUp < 0 || v.maxDown > 0) bad.push('最大单日涨跌方向错');
  if (v.html.includes('undefined') || v.html.includes('NaN')) bad.push('脏值');
  if (!v.html.includes('vol-wrap')) bad.push('缺少曲线');
  console.log(
    `  ${String(v.range).padStart(3)} 天  σ ±${v.sd.toFixed(2)}kg  趋势 ${v.weekly.toFixed(2)} kg/周  信号噪音比 1:${Math.round(1 / v.snr)}  带内 ${v.inBandPct.toFixed(0)}%  ${bad.length ? 'FAIL: ' + bad.join(',') : 'OK'}`
  );
  bad.forEach(fail);
});
/* 长窗口下理论体重与实际应当收敛（水分是零均值过程，时间越长基差越小） */
const longVol = sandbox.__vol[2];
if (Math.abs(longVol.maLast - longVol.theoryLast) > 1.5) {
  fail('1 年窗口下实际与理论体重偏离过大：' + (longVol.maLast - longVol.theoryLast).toFixed(2) + ' kg');
}
/* 波动窗口应保持默认 30 天 */
if (sandbox.__volRange !== 30) fail('波动窗口默认值应为 30 天');

/* ---------- 今日大盘（方块图） ---------- */
console.log('\n今日大盘方块图自检:');
const bd = sandbox.__board;
[
  ['卖盘 4 块', bd.sell],
  ['买盘 4 块', bd.buy],
  ['极端悬殊 5 块', bd.lopsided],
  ['12 块', bd.twelve]
].forEach(([name, r]) => {
  const bad = [];
  if (r.areaErr > 0.05) bad.push('面积不守恒，偏差 ' + r.areaErr.toFixed(2));
  if (r.ratioErr > 0.001) bad.push('面积比例误差 ' + (r.ratioErr * 100).toFixed(3) + '%');
  if (r.oob) bad.push(r.oob + ' 块越界');
  if (r.overlap) bad.push(r.overlap + ' 处重叠');
  console.log(
    `  ${name.padEnd(12)} ${r.n} 块  面积误差 ${r.ratioErr === 0 ? '0%' : (r.ratioErr * 100).toFixed(3) + '%'}  ${bad.length ? 'FAIL: ' + bad.join(',') : 'OK'}`
  );
  bad.forEach(fail);
});
/* 两区高度比必须等于两边热量比 —— 这是“面积 = 热量”的核心语义 */
if (Math.abs(bd.ratio - bd.wantRatio) > 0.02) {
  fail(`两区高度比 ${bd.ratio.toFixed(3)} 应等于热量比 ${bd.wantRatio.toFixed(3)}`);
}
if (!bd.heights || bd.heights.hb + bd.heights.hi !== 172) fail('两区高度合计应为 172');
if (bd.edgeZero.hb !== bd.edgeZero.hi) fail('两边都为 0 时应各占一半');
console.log(
  `  高度比 ${bd.ratio.toFixed(3)} vs 热量比 ${bd.wantRatio.toFixed(3)}  合计 ${(bd.heights.hb + bd.heights.hi).toFixed(0)}  OK`
);
/* 文字截断：短中文不该被误截，长文本必须带省略号 */
if (bd.fit[0] !== '日常活动 ×1.3') fail('“日常活动 ×1.3”不该被截断，实际 ' + bd.fit[0]);
if (bd.fit[1] !== '红烧肉盖饭') fail('“红烧肉盖饭”不该被截断，实际 ' + bd.fit[1]);
if (!bd.fit[2].endsWith('…')) fail('超宽文本应带省略号，实际 ' + bd.fit[2]);
console.log(`  文字截断  ${JSON.stringify(bd.fit[0])} · ${JSON.stringify(bd.fit[2])}  OK`);
if (!sandbox.__views[0].html.includes('bd-canvas')) fail('行情页缺少大盘画布');
/* 红绿已按「红=赚/达标、绿=亏/超标」对调：买入侧=绿(152)，卖出侧=红(357) */
if (!/<rect[^>]*hsl\(152/.test(sandbox.__views[0].html)) fail('今日大盘没有渲染出摄入方块（应为绿系）');
if (!/<rect[^>]*hsl\(357/.test(sandbox.__views[0].html)) fail('今日大盘没有渲染出消耗方块（应为红系）');
/* 第一屏：大盘卡必须排在 K 线之前 */
const iBoard = sandbox.__views[0].html.indexOf('bd-card');
const iKline = sandbox.__views[0].html.indexOf('kcard');
if (iBoard < 0 || iKline < 0 || iBoard > iKline) fail('今日大盘应位于首页第一屏（K 线之前）');
if (iBoard > 160) fail('今日大盘应是行情页的第一张卡片，实际偏移 ' + iBoard);
/* 月度口径：同一张画布只换数据，不换视觉语言 */
const bt = sandbox.__boardTab;
if (!bt.mtd) fail('月度大盘应带 MTD 标记');
if (!bt.active) fail('切到月度后 tab 应显示选中态');
if (!bt.cells) fail('月度口径应显示“本月净缺口”');
if (!bt.week) fail('月度口径应显示“已过 N 天”');
if (bt.intake < 3) fail('月度口径应按周成块（摄入色块只有 ' + bt.intake + ' 个）');
console.log(`  月度口径  ${bt.intake} 个摄入色块 · MTD ${bt.mtd ? '有' : '无'} · 已过天数 ${bt.week ? 'OK' : 'ERR'}`);

/* ---------- 运动录入 ---------- */
console.log('\n运动录入自检:');
const ex = sandbox.__ex;
const k30 = ex.kcalRun30;
if (k30 !== Math.round((8.3 - 1) * ex.weight * 0.5)) fail('慢跑 30 分钟消耗算错：' + k30);
if (Math.abs(ex.kcalRun60 - k30 * 2) > 1) fail('时长翻倍消耗应翻倍（允许 1 kcal 舍入）');
if (!(ex.kcalWalk30 < k30)) fail('快走强度低，消耗应小于慢跑');
if (ex.rawMet30 - k30 !== Math.round(ex.weight * 0.5)) fail('减 1 的差额应正好等于 1 MET × 体重 × 时长');
if (ex.zero !== 0) fail('时长 0 时消耗应为 0');
if (ex.metOne !== 0) fail('MET=1（纯静息）额外消耗应为 0');
console.log(
  `  ${ex.weight}kg 慢跑(8.3MET) 30min = ${k30} kcal  | 不减 1 会多算 ${ex.rawMet30 - k30} kcal  | MET=1 → ${ex.metOne}`
);

const needIds = ['id="ex-name"', 'id="ex-met"', 'id="ex-min"', 'id="ex-kcal"', 'id="ex-save"'];
needIds.forEach((k) => {
  if (!ex.html.includes(k)) fail('记账页缺少表单元素 ' + k);
});
if (!ex.html.includes('data-exedit')) fail('记账页的运动记录缺少编辑入口');
if (!ex.html.includes('记入卖盘')) fail('记账页缺少保存按钮');
if (!ex.html.includes('(MET − 1)')) fail('记账页缺少公式说明');
if (ex.formKcal != String(k30)) fail('表单初始消耗应为 ' + k30 + '，实际 ' + ex.formKcal);
if (!ex.formula.includes('8.3 − 1')) fail('公式行显示不正确：' + ex.formula);
console.log(`  表单渲染 5 个输入项齐全 · 初始消耗 ${ex.formKcal} · 公式 ${ex.formula}`);

if (ex.pickMet !== 12.3) fail('点跳绳后 MET 应为 12.3，实际 ' + ex.pickMet);
if (Number(ex.pickKcalDom) !== Math.round((12.3 - 1) * ex.weight * 0.75)) {
  fail('跳绳 45 分钟应重算为 ' + Math.round((12.3 - 1) * ex.weight * 0.75) + '，实际 ' + ex.pickKcalDom);
}
if (Number(ex.manualDom) !== 300) fail('手改消耗后输入框应为 300，实际 ' + ex.manualDom);
console.log(`  点跳绳 → MET ${ex.pickMet} · 45min → ${ex.pickKcalDom} kcal · 手改 → ${ex.manualDom}`);

if (ex.countDelta !== 1) fail('保存后应新增 1 条记录，实际 ' + ex.countDelta);
if (ex.addedKcal !== 300) fail('保存的应是手改值 300，实际 ' + ex.addedKcal);
if (ex.burnDelta !== 300) fail('保存后总消耗应 +300，实际 +' + ex.burnDelta);
console.log(`  保存 新增 ${ex.addedName} ${ex.addedMins}min ${ex.addedKcal}kcal · 总消耗 +${ex.burnDelta}`);
if (ex.editKcal !== ex.editExpect) fail('编辑改时长后应回到公式值 ' + ex.editExpect + '，实际 ' + ex.editKcal);
/* 这条记录原本是手改的 300，改成公式值后，增量 = 公式值 − 300 */
if (ex.editBurnDelta !== ex.editExpect - ex.addedKcal) {
  fail('编辑保存后总消耗增量应为 ' + (ex.editExpect - ex.addedKcal) + '，实际 ' + ex.editBurnDelta);
}
console.log(`  编辑 改为 60min → ${ex.editKcal} kcal（回到公式值）· 总消耗 ${ex.addedKcal}→${ex.addedKcal + ex.editBurnDelta}`);

/* ---------- 交易日选择 ---------- */
const dt = sandbox.__date;
console.log('\n交易日选择自检:');
console.log(`  切到 ${dt.past}（归档） 摄入 ${dt.a1.intake} / 消耗 ${dt.a1.burn} / 净 ${dt.a1.net} · 收盘 ${dt.a1.price} · 序列末日 ${dt.a1.last}`);
console.log(`  补记一笔 → 摄入 ${dt.a2.intake} · 归档态 ${dt.a2.archived ? '是' : '否'} · 序列末日 ${dt.a2.last}`);
console.log(`  回到今天 ${dt.a3.today} → 摄入 ${dt.a3.intake} · 再切回补记日 摄入 ${dt.a4.intake}`);
if (!dt.a1.archived) fail('过去的空白日应进入归档态');
if (dt.a1.intake !== dt.a1.recIntake) fail('归档日摄入应取历史汇总 ' + dt.a1.recIntake + '，实际 ' + dt.a1.intake);
if (dt.a1.burn !== dt.a1.recBurn) fail('归档日消耗应取历史汇总 ' + dt.a1.recBurn + '，实际 ' + dt.a1.burn);
if (dt.a1.net !== dt.a1.recNet) fail('归档日净额应取历史汇总 ' + dt.a1.recNet + '，实际 ' + dt.a1.net);
if (Math.abs(dt.a1.price - dt.a1.recClose) > 0.001) fail('归档日报价应等于那天收盘 ' + dt.a1.recClose + '，实际 ' + dt.a1.price);
if (dt.a1.last !== dt.past) fail('K 线应截止到所选日 ' + dt.past + '，实际 ' + dt.a1.last);
if (!dt.a1.html.includes('归档')) fail('归档日行情页应有「归档」标记');
if (!dt.a1.html.includes('运动与活动')) fail('归档日大盘应显示按比例折算的消耗块');
if (!dt.a1.html.includes('碳水')) fail('归档日大盘应按宏量营养拆分摄入');
if (dt.a2.archived) fail('补记之后不应再是归档态（否则会和归档数重复计算）');
if (dt.a2.intake !== 500) fail('补记 500 kcal 后摄入应为 500，实际 ' + dt.a2.intake);
if (dt.a2.last !== dt.past) fail('补记后 K 线仍应截止到所选日');
if (!dt.a2.html.includes('补记午餐')) fail('补记的记录应出现在当日大盘里');
if (dt.a3.intake !== 1890) fail('回到今天后摄入应恢复为 1890，实际 ' + dt.a3.intake);
if (dt.a3.date !== dt.a3.today) fail('回到今天后 selDate 应为今天');
if (dt.a3.last !== dt.a3.today) fail('回到今天后序列末日应为今天');
if (dt.a4.intake !== 500 || dt.a4.count !== 1) fail('按日存储应保留补记那天的 1 笔 / 500 kcal，实际 ' + dt.a4.count + ' 笔 / ' + dt.a4.intake);
if (dt.keys.indexOf(dt.past) < 0) fail('补记的日期应写进存储');

/* ---------- K 线密度 + 大盘与买卖联动 ---------- */
const lk = sandbox.__link;
console.log('\nK 线密度自检:');
console.log(`  日线 疏 ${lk.n0} / 中 ${lk.n1} / 密 ${lk.n2} 根`);
if (!(lk.n0 < lk.n1 && lk.n1 < lk.n2)) fail('三档根数应递增，实际 ' + lk.n0 + '/' + lk.n1 + '/' + lk.n2);
if (lk.n1 > 30) fail('默认日线不宜超过 30 根（太密集），实际 ' + lk.n1);
if (lk.base.zoomBtns !== 3) fail('K 线卡应有 3 个密度档位按钮，实际 ' + lk.base.zoomBtns);

console.log('\n大盘联动自检:');
console.log(`  静态基线 ${lk.base.groups} 个方块 · 补间标记 ${lk.base.fromCount} 个（应为 0）`);
console.log(`  买一笔 1200 → ${lk.after.groups} 个方块 · 补间 ${lk.after.fromCount} 个 · 新块高亮 ${lk.after.flash} 个 · 动画外框 ${lk.after.animSvg ? '有' : '无'}`);
console.log(`  换交易日（应不补间）${lk.ctxBreak.fromCount} 个 · 卖一笔 260 → 补间 ${lk.sellFrom} 个`);
if (lk.base.fromCount !== 0) fail('没有任何改动的一帧不该出现补间标记');
if (!lk.base.buyJump || !lk.base.sellJump) fail('方块应分别链到买入 / 卖出页');
if (lk.after.groups <= lk.base.groups) fail('买入一笔后方块数应增加');
if (!lk.after.hasNew) fail('新买的「炸鸡桶」应出现在买盘');
if (lk.after.fromCount < 2) fail('买入后方块应发生位移/缩放（补间标记 ' + lk.after.fromCount + ' 个）');
if (!lk.after.animSvg) fail('补间时应给 SVG 挂 bd-anim');
if (lk.after.flash < 1) fail('新出现的方块应有 bd-flash 高亮');
if (lk.ctxBreak.fromCount !== 0) fail('换交易日后不应补间（那是另一张图）');
if (lk.beforeSell !== 0) fail('卖一笔之前基线不该有补间标记');
if (lk.sellFrom < 1) fail('卖出一笔后卖盘应发生位移/缩放');
if (!lk.sellNamed) fail('新卖的「爬楼梯 260 kcal」应出现在卖盘（窄块只留数字也是合规的）');
console.log(`\n补间插值自检:`);
console.log(`  (0,10) → (9,9)  第3帧 x=${lk.mid.x} w=${lk.mid.w} · 末帧 x=${lk.end.x} w=${lk.end.w} · 标记已清 ${lk.end.cleared ? '是' : '否'}`);
if (!(lk.mid.x > 0 && lk.mid.x < 9) || !(lk.mid.w >= 9 && lk.mid.w <= 10)) fail('中间帧应停在起止之间，实际 x=' + lk.mid.x + ' w=' + lk.mid.w);
if (lk.end.x !== 9 || lk.end.w !== 9) fail('末帧应精确落到目标几何，实际 ' + lk.end.x + '/' + lk.end.w);
if (!lk.end.cleared) fail('动画结束后应清掉 data-from');

/* ---------- 本地数据 / 备份 / 恢复 ---------- */
const bk = sandbox.__backup;
console.log('\n备份恢复自检:');
console.log(`  备份包 ${bk.bytes} B · ${bk.pack.days} 天 / ${bk.pack.items} 笔 / 盘口 ${bk.pack.shops} / 食物 ${bk.pack.foods} · 跨度 ${bk.pack.first}~${bk.pack.last}`);
console.log(`  文件往返 ${bk.roundTrip.days} 天 ${bk.roundTrip.items} 笔 · 体重回带 ${bk.roundTrip.weight} · 盘口 ${bk.roundTrip.shops}`);
console.log(`  备份码 ${bk.code.tag}… 长度 ${bk.code.len} · 解出 ${bk.code.days} 天`);
console.log(`  脏输入拦截 ${bk.rejects.join('')}（5 个全 1 才算过）`);
console.log(`  覆盖恢复 → ${bk.replace.days} 天 / ${bk.replace.items} 笔 · 与备份一致 ${bk.replace.same ? '是' : '否'}`);
console.log(`  合并 → 日期 ${bk.merge.days} · 共 ${bk.merge.items} 笔 · 盘口 ${bk.merge.shops} · 食物 ${bk.merge.foods} · 10-21 当天 ${bk.merge.day1021} 笔 · 设置保留 ${bk.merge.profileKept}`);
console.log(`  快照环形 → 存 9 份留 ${bk.snap.n} 份（${bk.snap.oldest} … ${bk.snap.newest}）· 实体 ${bk.snap.stored}`);
console.log(`  回滚 → 改乱后 ${bk.rollback.mid} 天，回滚后 ${bk.rollback.after} 天 · 快照 ${bk.rollback.snaps} 份（含回滚前保护）`);

if (bk.pack.app !== 'calex') fail('备份包应带 app 标识');
if (bk.pack.schema !== 1) fail('备份包应带 schema 版本');
if (bk.pack.days !== 2 || bk.pack.items !== 3) fail('备份摘要统计不对：' + bk.pack.days + '天/' + bk.pack.items + '笔');
if (bk.roundTrip.days !== 2 || bk.roundTrip.items !== 3) fail('JSON 往返后数据量变了');
if (bk.roundTrip.weight !== 70.5) fail('体重应随备份带走，实际 ' + bk.roundTrip.weight);
if (bk.code.tag !== 'CALEX1:') fail('备份码应有 CALEX1: 前缀');
if (bk.code.days !== 2) fail('备份码解不出数据');
if (bk.rejects.join('') !== '11111') fail('脏输入应全部被拒，实际 ' + bk.rejects.join(''));
if (bk.replace.days !== 2 || !bk.replace.same) fail('覆盖恢复后数据应与备份完全一致');
if (bk.merge.days !== '2026-10-20,2026-10-21,2026-10-25') fail('合并后日期并集不对：' + bk.merge.days);
if (bk.merge.items !== 5) fail('合并后应为 5 笔（备份 3 + 本机新增 2，id3 重复只留一份），实际 ' + bk.merge.items);
if (bk.merge.day1021 !== 2) fail('同一天应合并成 2 笔（旧的 1 笔 + 新的 1 笔），实际 ' + bk.merge.day1021);
if (bk.merge.shops !== 3) fail('盘口应合并成 3 个，实际 ' + bk.merge.shops);
if (bk.merge.foods !== 2) fail('食物库应合并成 2 条，实际 ' + bk.merge.foods);
if (bk.merge.profileKept !== 1500) fail('合并时设置应保留本机值，实际 ' + bk.merge.profileKept);
if (!bk.isolated) fail('恢复不应动到备份范围之外的键');
if (bk.snap.n !== 6) fail('快照应只留 6 份，实际 ' + bk.snap.n);
if (bk.snap.oldest !== 't3' || bk.snap.newest !== 't8') fail('快照淘汰顺序不对：' + bk.snap.oldest + '…' + bk.snap.newest);
if (bk.snap.stored !== 6) fail('索引里的快照应有实体，实际 ' + bk.snap.stored);
if (bk.rollback.mid !== 1 || bk.rollback.after !== 2) fail('回滚没恢复数据：改乱 ' + bk.rollback.mid + ' 天 → ' + bk.rollback.after + ' 天');
if (bk.rollback.snaps !== 2) fail('回滚前应自动多存一份保护快照，实际 ' + bk.rollback.snaps);
if (!bk.emptySnap) fail('空库不应生成快照');

/* 数据分段 HTML 冒烟 */
const dataHtml = sandbox.__pf[2].html;
console.log(`  数据分段 ${dataHtml.length} B`);
if (dataHtml.includes('undefined') || dataHtml.includes('NaN')) fail('数据分段出现脏值');
if (!dataHtml.includes('data-pftab="data"')) fail('「我的」页缺少数据分段切换');
if (!dataHtml.includes('data-dp="export"')) fail('数据页缺少导出备份');
if (!dataHtml.includes('data-dp="import"')) fail('数据页缺少文件恢复');
if (!dataHtml.includes('data-dp="wipe"')) fail('数据页缺少清空入口');
if (!dataHtml.includes('dp-persist')) fail('数据页缺少长期保存状态位');

/* ---------- 红绿语义：红 = 赚 / 达标，绿 = 亏 / 超标 ---------- */
console.log('\n配色方向自检:');
if (!/--up:#3DD68C; --down:#E5484D/.test(html)) fail('红绿未对调：--up 应为绿、--down 应为红');
if (!/-\-danger:#E5484D/.test(html)) fail('缺少 --danger：危险按钮不能跟着涨跌互换');
if (!/\.cal-cell\.ok\{[^}]*#E5484D/.test(html)) fail('达标日历格应为红');
if (!/\.cal-cell\.long\{[^}]*#3DD68C/.test(html)) fail('超标日历格应为绿');
if (!/\.bd-pill\.ok\{[^}]*rgba\(229,72,77/.test(html)) fail('「已达标」药丸底色应为红');
if (!/\.bd-pill\.bad\{[^}]*rgba\(61,214,140/.test(html)) fail('「还差 N kcal」药丸底色应为绿');
if (!/\.btns \.danger\{[^}]*var\(--danger\)/.test(html)) fail('删除按钮应恒为红');
if (!/\.dp-btn\.danger\{[^}]*#F0807F/.test(html)) fail('清空按钮应恒为红');
if (!/\.tk-live\{[\s\S]*?#3DD68C/.test(html)) fail('LIVE 徽标应保持绿');
if (!/const UP = '#3DD68C', DOWN = '#E5484D'/.test(html)) fail('K 线：涨应为绿、跌应为红');

/* 数据层跟随：负值(=盈余/体重下跌)落到 down 类，而 down 现在是红 */
const mk = sandbox.__views[0].html;
if (!/class="tk-badge down"/.test(mk) && !/class="tk-badge up"/.test(mk)) fail('报价卡缺涨跌徽标');
const okRed = /\.ok\{[^}]*#E5484D/.test(html);
const negRed = /--down:#E5484D/.test(html);
if (!okRed || !negRed) fail('「好结果」与「负数」应同为红');
console.log('  红绿方向  红=赚/达标 · 绿=亏/超标 · 危险按钮与 LIVE 徽标除外  OK');

/* ---------- 正负口径：赚了是正数、亏了是负数 ---------- */
console.log('\n正负口径自检:');
if (profit > 0) {
  if (!marketHtml.includes('↗')) fail('有缺口(赚)时大盘箭头应朝上');
  if (!/目标<\/span>\s*<b>\+\d+ kcal/.test(marketHtml)) fail('大盘目标应显示为 +N kcal');
  if (!marketHtml.includes('bd-gap-n down')) fail('赚(缺口)应配 down 类 = 红');
} else if (profit < 0) {
  if (!marketHtml.includes('↘')) fail('盈余(亏)时大盘箭头应朝下');
  if (!marketHtml.includes('bd-gap-n up')) fail('亏(盈余)应配 up 类 = 绿');
}
/* 复盘主数字同样取反 */
const rvHtml = sandbox.__views[3] && sandbox.__views[3].html;
if (rvHtml && /rv-hero-num/.test(rvHtml) && c.net !== 0) {
  if (!/rv-hero-num[^>]*>\+/.test(rvHtml) && !/rv-hero-num[^>]*>-/.test(rvHtml)) fail('复盘主数字缺少正负号');
}
console.log(`  盈亏 ${profit > 0 ? '+' : ''}${profit} kcal → ${profit > 0 ? '正数·红色·箭头朝上' : '负数·绿色·箭头朝下'}  OK`);

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
