/* summary.js - ringkasan Rencana vs Realisasi per hari & shift
 *
 * Dipakai oleh: work-order.html (tab "Summary").
 * Input : {start, rows, today, tol}  (rows = collect().rows)
 *
 * Cara membaca isian:
 *  - Baris RENCANA   = baris yang punya angka rencana (Open, Jlh HK Support, Jlh Unit/Opt, Est HM/Rit, Total Kebutuhan).
 *  - Baris DI LUAR RENCANA = baris yang hanya punya realisasi (Close/Jlh Realisasi/dst) tanpa angka rencana.
 *    Catat pekerjaan di paddock lain dengan menambah baris (mode Realisasi), pilih tanggal & shift yang sama,
 *    isi paddock sebenarnya dan kolom realisasinya saja.
 *  - Satu "grup" = satu tanggal + satu shift. Paddock rencana vs paddock yang benar-benar dikerjakan dibandingkan per grup.
 *  - Realisasi vs rencana dinilai "Sesuai" jika selisihnya dalam toleransi (%).
 */
import { SHIFTS, fmt, dayInfo } from './timeline.js';

const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return isFinite(n) ? n : 0; };
const has = s => String(s == null ? '' : s).trim() !== '';
const okIso = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const pk = s => String(s || '').trim().toUpperCase();
const cleanName = s => String(s || '').trim().replace(/\s*-\s*\d{5,}$/, '').replace(/\s{2,}/g, ' ');

export const SM = {
  ok:    { t: 'Sesuai',           c: '#2da44e' },
  less:  { t: 'Kurang',           c: '#e8590c' },
  more:  { t: 'Lebih',            c: '#0969da' },
  extra: { t: 'Di luar rencana',  c: '#8250df' },
  out:   { t: 'Di luar rencana',  c: '#8250df' },
  skip:  { t: 'Tidak dikerjakan', c: '#cf222e' },
  miss:  { t: 'Belum diisi',      c: '#cf222e' },
  pend:  { t: 'Menunggu',         c: '#8c959f' }
};

function cmp(plan, real, hasReal, tol, late) {
  if (!hasReal) return plan > 0 ? { s: late ? 'miss' : 'pend' } : { s: 'none' };
  if (plan <= 0) return real > 0 ? { s: 'extra', d: real } : { s: 'none' };
  const d = real - plan, p = d / plan * 100;
  return { s: Math.abs(p) <= tol + 1e-9 ? 'ok' : (d < 0 ? 'less' : 'more'), d, p };
}
const worst = a => ['miss', 'less', 'more', 'extra', 'pend', 'ok'].find(s => a.includes(s)) || 'none';
const label = g => g.iso ? dayInfo(g.iso).dow + ' ' + dayInfo(g.iso).text + ' \u00b7 ' + SHIFTS[g.shift].label : 'Tanpa tanggal \u00b7 ' + SHIFTS[g.shift].label;

export function buildSummary(o) {
  const tol = isFinite(+o.tol) ? Math.max(0, +o.tol) : 5, start = okIso(o.start) ? o.start : '', today = o.today || '';
  const gm = new Map();
  (o.rows || []).forEach((r, i) => {
    const planned = [r.open, r.hk, r.unik, r.uest, r.vest].some(x => num(x) > 0);
    const rv = [r.close, r.uom, r.unama, r.uhk, r.vhk];
    if (!planned && !rv.some(has)) return;
    const worked = rv.some(x => num(x) > 0);
    const iso = okIso(r.date) ? r.date : start, shift = [1, 2, 3].includes(+r.shift) ? +r.shift : 0;
    const late = !!(iso && today && iso < today);
    const it = {
      no: i + 1, planned, worked, extra: !planned && worked,
      name: cleanName(r.desc) || String(r.code || '').trim(),
      paddock: String(r.paddock || '').trim() || '(tanpa paddock)',
      luas: { p: num(r.open), r: num(r.close), c: cmp(num(r.open), num(r.close), has(r.close), tol, late) },
      hk:   { p: num(r.hk),   r: num(r.uom),   c: cmp(num(r.hk),   num(r.uom),   has(r.uom),   tol, late) },
      qty:  { p: num(r.unik), r: num(r.unama), c: cmp(num(r.unik), num(r.unama), has(r.unama), tol, late) },
      hm:   { p: num(r.uest), r: num(r.uhk),   c: cmp(num(r.uest), num(r.uhk),   has(r.uhk),   tol, late) },
      mat:  { p: num(r.vest), r: num(r.vhk),   c: cmp(num(r.vest), num(r.vhk),   has(r.vhk),   tol, late),
              name: String(r.vnama || '').trim(), dosis: String(r.vnik || '').trim() },
      unitKode: String(r.ukode || '').trim()
    };
    it.unitS = worst([it.qty.c.s, it.hm.c.s]);
    const k = iso + '|' + shift;
    if (!gm.has(k)) gm.set(k, { iso, shift, late, items: [] });
    gm.get(k).items.push(it);
  });

  const order = [1, 2, 3, 0];
  const groups = [...gm.values()].sort((a, b) => (a.iso || '9999').localeCompare(b.iso || '9999') || order.indexOf(a.shift) - order.indexOf(b.shift));

  // paddock yang direncanakan, per grup (untuk catatan "terjadwal di ...")
  const planAt = new Map();
  groups.forEach(g => g.items.filter(x => x.planned).forEach(x => {
    const k = pk(x.paddock); if (!planAt.has(k)) planAt.set(k, []); const l = label(g);
    if (!planAt.get(k).includes(l)) planAt.get(k).push(l);
  }));

  const kpi = { pad: { ok: 0, skip: 0, out: 0, wait: 0 } };
  ['luas', 'hk', 'unit', 'mat'].forEach(k => { kpi[k] = { ok: 0, less: 0, more: 0, miss: 0, pend: 0 }; });
  const tot = { haPlan: 0, haReal: 0, haExtra: 0, hkPlan: 0, hkReal: 0, hkExtra: 0 };

  groups.forEach(g => {
    const planP = new Set(g.items.filter(x => x.planned).map(x => pk(x.paddock)));
    const realP = new Set(g.items.filter(x => x.worked).map(x => pk(x.paddock)));
    g.planP = [...new Set(g.items.filter(x => x.planned).map(x => x.paddock))];
    g.realP = [...new Set(g.items.filter(x => x.worked).map(x => x.paddock))];
    g.items.forEach(x => {
      const k = pk(x.paddock);
      if (x.planned) x.pad = (x.worked || realP.has(k)) ? 'ok' : realP.size ? 'skip' : (g.late ? 'miss' : 'pend');
      else {
        x.pad = planP.has(k) ? 'ok' : 'out';
        if (x.pad === 'out') x.elsewhere = (planAt.get(k) || []).filter(l => l !== label(g));
      }
    });
    g.status = !realP.size ? (g.late ? 'miss' : 'pend') : g.items.some(x => x.pad === 'out') ? 'out' : g.items.some(x => x.pad === 'skip') ? 'skip' : 'ok';
    if (realP.size) {
      planP.forEach(p => { realP.has(p) ? kpi.pad.ok++ : kpi.pad.skip++; });
      realP.forEach(p => { if (!planP.has(p)) kpi.pad.out++; });
    } else kpi.pad.wait += planP.size;
    g.items.forEach(x => {
      if (x.planned) {
        [['luas', x.luas.c.s], ['hk', x.hk.c.s], ['unit', x.unitS], ['mat', x.mat.c.s]].forEach(([k, s]) => { if (kpi[k][s] != null) kpi[k][s]++; });
        tot.haPlan += x.luas.p; tot.haReal += x.luas.r; tot.hkPlan += x.hk.p; tot.hkReal += x.hk.r;
      } else { tot.haExtra += x.luas.r; tot.hkExtra += x.hk.r; }
    });
  });
  return { tol, groups, kpi, tot };
}

/* ---------- gambar ke halaman ---------- */
function h(tag, cls, text, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const chip = (txt, color, parent) => { const s = h('span', 'pill', txt, parent); s.style.background = color; return s; };
const fp = n => (n > 0 ? '+' : '') + fmt(n);
function chipOf(c, parent) {
  const m = SM[c.s]; let t = m.t;
  if (c.s === 'less' || c.s === 'more') t += ' ' + fmt(Math.abs(c.d)) + ' (' + fp(Math.round(c.p * 10) / 10) + '%)';
  return chip(t, m.c, parent);
}
function met(td, lab, x, unit) {
  if (x.c.s === 'none') return;
  const d = h('div', 'sy-m', null, td);
  h('span', 'sy-l', lab, d);
  const real = x.c.s === 'miss' || x.c.s === 'pend' ? '\u2013' : fmt(x.r);
  h('span', null, (x.p ? fmt(x.p) : '\u2013') + ' \u2192 ' + real + (unit ? ' ' + unit : ''), d);
  chipOf(x.c, d);
}
const bad = it => ['out', 'skip', 'miss'].includes(it.pad) || [it.luas.c.s, it.hk.c.s, it.unitS, it.mat.c.s].some(s => ['less', 'more', 'miss', 'extra'].includes(s));
const GTXT = { ok: 'Paddock sesuai rencana', out: 'Ada pekerjaan di luar paddock rencana', skip: 'Ada paddock rencana yang tidak dikerjakan', miss: 'Belum ada realisasi', pend: 'Menunggu realisasi' };

export function renderSummary(el, m, info, opt, onOpt) {
  info = info || {}; opt = opt || {};
  el.textContent = '';
  const root = h('div', 'tl sy', null, el);
  h('h2', 'tl-title', 'Summary \u00b7 Rencana vs Realisasi' + (info.title ? ' \u00b7 ' + info.title : ''), root);

  const bar = h('div', 'sy-bar', null, root);
  const l1 = h('label', null, 'Toleransi \u00b1 ', bar), ti = h('input', null, null, l1);
  ti.type = 'number'; ti.min = 0; ti.step = 1; ti.value = m.tol; l1.append(' %');
  ti.onchange = () => onOpt && onOpt({ tol: Math.max(0, +ti.value || 0) });
  const l2 = h('label', null, null, bar), ck = h('input', null, null, l2);
  ck.type = 'checkbox'; ck.checked = !!opt.only; l2.append(' Hanya tampilkan yang tidak sesuai');
  ck.onchange = () => onOpt && onOpt({ only: ck.checked });

  if (!m.groups.length) { h('p', 'tl-empty', 'Belum ada data. Isi rencana (Open, HK, unit, material) dan realisasinya pada tab Work Order.', root); return; }

  // kartu ringkasan
  const sum = h('div', 'tl-sum', null, root);
  const box = (lab, val, subs, cls) => { const b = h('div', 'tl-box' + (cls ? ' ' + cls : ''), null, sum); h('small', null, lab, b); h('b', null, val, b); subs.filter(Boolean).forEach(s => h('span', null, s, b)); };
  const k = m.kpi, t = m.tot, pe = k.pad.ok + k.pad.skip;
  box('1. Paddock sesuai rencana', pe ? k.pad.ok + '/' + pe : '\u2013',
    ['paddock rencana yang dikerjakan', k.pad.out ? k.pad.out + ' paddock di luar rencana' : '', k.pad.wait ? k.pad.wait + ' menunggu realisasi' : ''],
    pe ? (k.pad.skip || k.pad.out ? 'bad' : 'good') : '');
  const mk = (lab, key, extra) => { const x = k[key], ev = x.ok + x.less + x.more;
    box(lab, ev ? x.ok + '/' + ev : '\u2013', ['sesuai' + (x.less ? ' \u00b7 ' + x.less + ' kurang' : '') + (x.more ? ' \u00b7 ' + x.more + ' lebih' : ''), extra, x.miss + x.pend ? (x.miss + x.pend) + ' belum diisi' : ''], ev ? (x.less || x.more ? 'bad' : 'good') : ''); };
  mk('2. Luasan sesuai rencana', 'luas', 'Total ' + fmt(t.haReal) + ' dari ' + fmt(t.haPlan) + ' Ha' + (t.haPlan > 0 ? ' (' + Math.round(t.haReal / t.haPlan * 100) + '%)' : '') + (t.haExtra ? ' \u00b7 +' + fmt(t.haExtra) + ' Ha di luar rencana' : ''));
  mk('3. HK Support sesuai', 'hk', 'Total ' + fmt(t.hkReal) + ' dari ' + fmt(t.hkPlan) + (t.hkExtra ? ' \u00b7 +' + fmt(t.hkExtra) + ' di luar rencana' : ''));
  mk('4. Unit/Opr sesuai', 'unit', '');
  mk('5. Material sesuai', 'mat', '');

  const lg = h('div', 'tl-legend', null, root), g0 = h('div', 'tl-lg', null, lg);
  h('b', null, 'Status', g0);
  ['ok', 'less', 'more', 'out', 'skip', 'miss', 'pend'].filter((s, i, a) => a.findIndex(z => SM[z].t === SM[s].t) === i).forEach(s => {
    const c = h('span', 'chip', null, g0), d = h('i', null, null, c); d.style.background = SM[s].c; c.append(SM[s].t);
  });
  h('span', 'tl-note', 'Toleransi ' + m.tol + '%: selisih realisasi vs rencana di bawah itu dianggap Sesuai.', lg);

  const sc = h('div', 'tl-scroll', null, root), tb = h('table', 'sy-t', null, sc);
  const hr = h('tr', null, null, h('thead', null, null, tb));
  ['Baris / Aktivitas', 'Paddock', 'Luasan (Ha)', 'HK Support', 'Unit / Operator', 'Material'].forEach(x => h('th', null, x, hr));
  const body = h('tbody', null, null, tb);
  let shown = 0;
  m.groups.forEach(g => {
    const items = opt.only ? g.items.filter(bad) : g.items;
    if (opt.only && !items.length && (g.status === 'ok' || g.status === 'pend')) return;
    shown++;
    const gh = h('tr', 'gh', null, body), td = h('td', null, null, gh); td.colSpan = 6;
    const sw = h('i', 'sy-sw', null, td); sw.style.background = SHIFTS[g.shift].color;
    td.append(label(g) + '   ');
    chip(GTXT[g.status], SM[g.status === 'ok' ? 'ok' : g.status === 'out' ? 'out' : g.status === 'skip' ? 'skip' : g.status === 'miss' ? 'miss' : 'pend'].c, td);
    h('small', null, '   Rencana: ' + (g.planP.join(', ') || '\u2013') + '  |  Realisasi: ' + (g.realP.join(', ') || '\u2013'), td);
    items.forEach(it => {
      const tr = h('tr', null, null, body);
      const c1 = h('td', null, null, tr); h('b', null, '#' + it.no, c1); c1.append(' ' + (it.name || ''));
      const c2 = h('td', null, null, tr); h('b', null, it.paddock, c2); c2.append(' '); chip(SM[it.pad].t, SM[it.pad].c, c2);
      if (it.elsewhere && it.elsewhere.length) h('div', 'tl-note', 'terjadwal di: ' + it.elsewhere.join('; '), c2);
      const c3 = h('td', null, null, tr); met(c3, 'Ha', it.luas, '');
      const c4 = h('td', null, null, tr); met(c4, 'HK', it.hk, '');
      const c5 = h('td', null, null, tr); if (it.unitKode) h('div', null, it.unitKode, c5);
      met(c5, 'Unit/Opt', it.qty, ''); met(c5, 'HM/Rit', it.hm, '');
      const c6 = h('td', null, null, tr); if (it.mat.name) h('div', null, it.mat.name + (it.mat.dosis ? ' \u00b7 dosis ' + it.mat.dosis : ''), c6);
      met(c6, 'Butuh', it.mat, '');
    });
  });
  if (!shown) h('p', 'tl-empty', 'Semua sudah sesuai rencana, tidak ada yang perlu ditampilkan.', root);
}
