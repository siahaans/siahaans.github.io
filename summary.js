/* summary.js - Summary Rencana vs Aktual: per tanggal, Shift 1 (kiri) & Shift 2 (kanan)
 *
 * Dipakai oleh: work-order.html (tab "Summary").   Input: {start, rows, today, tol}
 *
 * Cara membaca isian (per tanggal + shift):
 *  - Baris RENCANA     = baris yang punya angka rencana (Open, Jlh HK Support, Jlh Unit/Opt, Est HM/Rit, Total Kebutuhan).
 *  - Baris DI LUAR RENCANA = baris yang hanya berisi realisasi. Catat kerja di paddock lain dengan menambah baris
 *    (mode Realisasi) di tanggal & shift yang sama, isi paddock aktual dan kolom realisasinya saja.
 *  - Lokasi : paddock rencana vs paddock yang benar-benar dikerjakan.
 *  - Luasan : Open vs Close pada paddock rencana (luasan di luar rencana ditampilkan sebagai catatan).
 *  - HK, Unit/Opr, Material : rencana vs total aktual satu shift (banyak material per baris dibaca dari rows[i].mats).
 *  - "Sesuai" = selisih dalam toleransi (%).
 */
import { SHIFTS, fmt, dayInfo } from './timeline.js';

const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return isFinite(n) ? n : 0; };
const has = s => String(s == null ? '' : s).trim() !== '';
const okIso = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const pk = s => String(s || '').trim().toUpperCase();
// material per baris: format baru rows[i].mats = [{mat,dosis,keb,real,sat}], format lama vnama/vnik/vest/vhk
const matsOf = r => Array.isArray(r.mats) ? r.mats.filter(m => has(m.mat) || has(m.keb) || has(m.real))
  : (has(r.vnama) || num(r.vest) || has(r.vhk) ? [{ mat: r.vnama, dosis: r.vnik, keb: r.vest, real: r.vhk, sat: '' }] : []);
const matName = m => (String(m.mat || '').trim() || '(material)') + (m.sat ? ' (' + m.sat + ')' : '');
const DOWL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export const SM = {
  ok:    { t: 'Sesuai',           c: '#2da44e' },
  less:  { t: 'Kurang',           c: '#e8590c' },
  more:  { t: 'Lebih',            c: '#0969da' },
  extra: { t: 'Di luar rencana',  c: '#8250df' },
  out:   { t: 'Tambahan di luar rencana', c: '#8250df' },
  diff:  { t: 'Berbeda dari rencana',     c: '#8250df' },
  skip:  { t: 'Sebagian tidak dikerjakan', c: '#cf222e' },
  miss:  { t: 'Belum diisi',      c: '#cf222e' },
  pend:  { t: 'Menunggu',         c: '#8c959f' }
};
const BAD = ['out', 'diff', 'skip', 'less', 'more', 'extra'];
const cat = s => s === 'ok' ? 'ok' : BAD.includes(s) ? 'bad' : s === 'none' ? null : 'blank';
const worst = a => ['less', 'more', 'extra', 'miss', 'pend', 'ok'].find(s => a.includes(s)) || 'none';

function cmp(plan, real, hasReal, tol, late) {
  if (!hasReal) return plan > 0 ? { s: late ? 'miss' : 'pend' } : { s: 'none' };
  if (plan <= 0) return real > 0 ? { s: 'extra', d: real } : { s: 'none' };
  const d = real - plan, p = d / plan * 100;
  return { s: Math.abs(p) <= tol + 1e-9 ? 'ok' : (d < 0 ? 'less' : 'more'), d, p };
}
const uniq = a => { const seen = new Set(), o = []; a.forEach(x => { if (!seen.has(pk(x))) { seen.add(pk(x)); o.push(x); } }); return o; };

export function buildSummary(o) {
  const tol = isFinite(+o.tol) ? Math.max(0, +o.tol) : 5, start = okIso(o.start) ? o.start : '', today = o.today || '';
  const gm = new Map();
  const z = () => ({ p: 0, r: 0, pTD: 0, hr: false });
  const WO = { ha: z(), hk: z(), un: z(), ma: z(), pad: new Map(), unit: new Map(), mat: new Map(), extra: 0 };
  (o.rows || []).forEach(r => {
    const ms = matsOf(r);
    const planned = [r.open, r.hk, r.unik, r.uest].some(x => num(x) > 0) || ms.some(m => num(m.keb) > 0);
    const rv = [r.close, r.uom, r.unama, r.uhk];
    const entered = rv.some(has) || ms.some(m => has(m.real)), worked = rv.some(x => num(x) > 0) || ms.some(m => num(m.real) > 0);
    if (!planned && !entered) return;
    const iso = okIso(r.date) ? r.date : start, shift = [1, 2, 3].includes(+r.shift) ? +r.shift : 0, k = iso + '|' + shift;
    if (!gm.has(k)) gm.set(k, { iso, shift, rows: [] });
    gm.get(k).rows.push({ r, ms, planned, entered, worked, pad: String(r.paddock || '').trim() || '(tanpa paddock)' });
    // total satu WO (seluruh tanggal & shift)
    const due = !!(iso && today && iso <= today);
    const acc = (e, pf, rf) => { const pv = num(r[pf]); if (planned) { e.p += pv; if (due) e.pTD += pv; } e.r += num(r[rf]); e.hr = e.hr || has(r[rf]); };
    const ent = (M, name, pf, rf) => { const k = pk(name); let e = M.get(k); if (!e) { e = Object.assign(z(), { name, dosis: '' }); M.set(k, e); } acc(e, pf, rf); };
    const accM = (e, m) => { const pv = num(m.keb); if (planned) { e.p += pv; if (due) e.pTD += pv; } e.r += num(m.real); e.hr = e.hr || has(m.real); };
    acc(WO.ha, 'open', 'close'); acc(WO.hk, 'hk', 'uom'); acc(WO.un, 'unik', 'unama');
    ms.forEach(m => accM(WO.ma, m));
    if (!planned) WO.extra += num(r.close);
    ent(WO.pad, String(r.paddock || '').trim() || '(tanpa paddock)', 'open', 'close');
    if (num(r.unik) > 0 || has(r.unama)) ent(WO.unit, String(r.ukode || '').trim() || '(unit)', 'unik', 'unama');
    ms.forEach(m => {
      const name = matName(m), k = pk(name); let e = WO.mat.get(k);
      if (!e) { e = Object.assign(z(), { name, dosis: '' }); WO.mat.set(k, e); }
      accM(e, m); if (!e.dosis && has(m.dosis)) e.dosis = String(m.dosis).trim();
    });
  });
  const groups = [...gm.values()];
  const lbl = g => (g.iso ? dayInfo(g.iso).text : 'tanpa tanggal') + ' \u00b7 ' + SHIFTS[g.shift].label;

  const planAt = new Map();
  groups.forEach(g => g.rows.filter(x => x.planned).forEach(x => {
    const k = pk(x.pad); if (!planAt.has(k)) planAt.set(k, []);
    if (!planAt.get(k).includes(lbl(g))) planAt.get(k).push(lbl(g));
  }));

  const kpi = {}; ['loc', 'luas', 'hk', 'unit', 'mat'].forEach(k => { kpi[k] = { ok: 0, bad: 0, blank: 0 }; });
  const tot = { n: 0, ok: 0, warn: 0 };

  groups.forEach(g => {
    const late = !!(g.iso && today && g.iso < today), P = g.rows.filter(x => x.planned);
    g.late = late; g.entered = g.rows.some(x => x.entered);
    // 1. lokasi
    const planP = uniq(P.map(x => x.pad)), realP = uniq(g.rows.filter(x => x.worked).map(x => x.pad));
    const ps = new Set(planP.map(pk)), rs = new Set(realP.map(pk));
    const out = realP.filter(n => !ps.has(pk(n))), skip = g.entered ? planP.filter(n => !rs.has(pk(n))) : [];
    let ls = !g.entered ? (late ? 'miss' : 'pend') : out.length && skip.length ? 'diff' : out.length ? 'out' : skip.length ? 'skip' : 'ok';
    g.loc = { s: ls, plan: planP, real: realP, out, skip, where: {} };
    if (ls === 'skip' && skip.length === planP.length) g.loc.t = 'Tidak dikerjakan';
    out.forEach(n => { g.loc.where[pk(n)] = (planAt.get(pk(n)) || []).filter(l => l !== lbl(g)); });
    // 2. luasan
    const sum = (arr, f) => arr.reduce((a, x) => a + num(x.r[f]), 0);
    g.luas = { p: sum(P, 'open'), r: sum(P, 'close'), extra: sum(g.rows.filter(x => !x.planned), 'close') };
    g.luas.c = cmp(g.luas.p, g.luas.r, g.rows.some(x => has(x.r.close)), tol, late);
    // 3. HK support
    g.hk = { p: sum(P, 'hk'), r: sum(g.rows, 'uom') };
    g.hk.c = cmp(g.hk.p, g.hk.r, g.rows.some(x => has(x.r.uom)), tol, late);
    // 4. unit/opr, 5. material (dikelompokkan per kode unit / nama material)
    const grp = (keyF, pf, rf, extra) => {
      const m = new Map();
      g.rows.forEach(x => {
        const k = keyF(x.r), e = m.get(k) || { name: k, p: 0, r: 0, hr: false, dosis: '' };
        if (x.planned) e.p += num(x.r[pf]);
        e.r += num(x.r[rf]); e.hr = e.hr || has(x.r[rf]);
        if (extra && !e.dosis && has(x.r[extra])) e.dosis = String(x.r[extra]).trim();
        m.set(k, e);
      });
      return [...m.values()].map(e => Object.assign(e, { c: cmp(e.p, e.r, e.hr, tol, late) })).filter(e => e.c.s !== 'none');
    };
    g.units = grp(r => String(r.ukode || '').trim() || '(unit)', 'unik', 'unama');
    g.mats = (() => {
      const m = new Map();
      g.rows.forEach(x => x.ms.forEach(mt => {
        const k = matName(mt), e = m.get(pk(k)) || { name: k, p: 0, r: 0, hr: false, dosis: '' };
        if (x.planned) e.p += num(mt.keb);
        e.r += num(mt.real); e.hr = e.hr || has(mt.real);
        if (!e.dosis && has(mt.dosis)) e.dosis = String(mt.dosis).trim();
        m.set(pk(k), e);
      }));
      return [...m.values()].map(e => Object.assign(e, { c: cmp(e.p, e.r, e.hr, tol, late) })).filter(e => e.c.s !== 'none');
    })();
    g.unitS = worst(g.units.map(u => u.c.s)); g.matS = worst(g.mats.map(u => u.c.s));

    const st = { loc: g.loc.s, luas: g.luas.c.s, hk: g.hk.c.s, unit: g.unitS, mat: g.matS };
    let bad = 0, blank = 0;
    Object.keys(st).forEach(k => { const c = cat(st[k]); if (c) { kpi[k][c]++; if (c === 'bad') bad++; if (c === 'blank') blank++; } });
    g.bad = bad;
    g.s = !g.entered ? (late ? 'miss' : 'pend') : bad ? 'warn' : blank ? 'part' : 'ok';
    tot.n++; if (g.s === 'ok') tot.ok++; if (g.s === 'warn') tot.warn++;
  });

  const byDay = new Map();
  groups.forEach(g => { if (!byDay.has(g.iso)) byDay.set(g.iso, { iso: g.iso, cards: {} }); byDay.get(g.iso).cards[g.shift] = g; });
  const days = [...byDay.values()].sort((a, b) => (a.iso || '9999').localeCompare(b.iso || '9999'));
  const used = [1, 2, 3, 0].filter(s => s < 3 && s > 0 || groups.some(g => g.shift === s));
  const fin = e => { const ref = e.pTD > 0 ? e.pTD : e.p; e.ref = ref; e.c = !e.hr ? (e.p > 0 ? { s: e.pTD > 0 ? 'miss' : 'pend' } : { s: 'none' }) : cmp(ref, e.r, true, tol, false); return e; };
  const lst = M => [...M.values()].map(fin).sort((a, b) => (b.p > 0) - (a.p > 0) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  const wo = { ha: fin(WO.ha), hk: fin(WO.hk), un: fin(WO.un), ma: fin(WO.ma), extra: WO.extra, paddocks: lst(WO.pad), units: lst(WO.unit), mats: lst(WO.mat) };
  return { tol, days, shifts: used, kpi, tot, today, wo };
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
const sg = n => (n > 0 ? '+' : '') + fmt(n);
function chipOf(c, parent, over) {
  const m = SM[c.s]; let t = over || m.t;
  if (c.s === 'less' || c.s === 'more') t += ' ' + fmt(Math.abs(c.d)) + ' (' + sg(Math.round(c.p * 10) / 10) + '%)';
  return chip(t, m.c, parent);
}
const blankS = s => s === 'miss' || s === 'pend';
function pair(parent, p, r, c, unit) {
  const v = h('div', 'sx-v', null, parent);
  h('small', null, 'Rencana', v); h('b', null, p ? fmt(p) + unit : '\u2013', v);
  h('i', null, '\u2192', v);
  h('small', null, 'Aktual', v); h('b', 'sx-r', blankS(c.s) ? '\u2013' : fmt(r) + unit, v).style.color = blankS(c.s) ? '' : SM[c.s].c;
}
function bar(parent, p, r, c) {
  if (!(p > 0) || blankS(c.s)) return;
  const b = h('div', 'sx-bar', null, parent), f = h('div', null, null, b);
  f.style.width = Math.min(100, r / p * 100) + '%'; f.style.background = SM[c.s].c;
}
function row(card, icon, title, c, over) {
  const m = h('div', 'sx-m', null, card), hd = h('div', 'sx-mh', null, m);
  h('span', 'sx-ic', icon, hd); h('b', null, title, hd);
  if (c && SM[c.s]) chipOf(c, hd, over);   // status 'none' (tidak ada rencana & realisasi) tidak diberi label
  return m;
}
const CARD = { ok: ['Sesuai rencana', '#2da44e'], part: ['Sebagian belum diisi', '#8c959f'], miss: ['Belum ada realisasi', '#cf222e'], pend: ['Menunggu realisasi', '#8c959f'] };

function drawCard(g, parent, sh) {
  const c = h('div', 'sx-c', null, parent); c.style.borderTopColor = SHIFTS[sh].color;
  const top = h('div', 'sx-ch', null, c); const t = h('b', null, SHIFTS[sh].label, top); t.style.color = SHIFTS[sh].color;
  if (!g) { c.classList.add('sx-empty'); h('span', 'sx-none', 'Tidak ada rencana', top); return; }
  g.s === 'warn' ? chip(g.bad + ' catatan', '#e8590c', top) : chip(CARD[g.s][0], CARD[g.s][1], top);

  // 1. lokasi
  const L = g.loc, lm = row(c, '\ud83d\udccd', 'Lokasi kerja', { s: L.s }, L.t);
  const tags = (label, names, fn) => {
    const d = h('div', 'sx-tg', null, lm); h('small', null, label, d);
    if (!names.length) h('span', 'sx-tag', '\u2013', d);
    names.forEach(n => { const s = h('span', 'sx-tag ' + fn(n), n, d); });
  };
  tags('Rencana', L.plan, n => L.skip.includes(n) ? 'sx-x' : '');
  tags('Aktual', g.entered ? L.real : [], n => L.out.includes(n) ? 'sx-o' : 'sx-g');
  L.out.forEach(n => { const w = L.where[pk(n)]; if (w && w.length) h('div', 'sx-note', n + ' terjadwal di ' + w.join(', '), lm); });

  // 2. luasan
  const lu = row(c, '\ud83d\udcd0', 'Luasan dikerjakan', g.luas.c);
  if (g.luas.c.s !== 'none') { pair(lu, g.luas.p, g.luas.r, g.luas.c, ' Ha'); bar(lu, g.luas.p, g.luas.r, g.luas.c); }
  if (g.luas.extra) h('div', 'sx-note', '+' + fmt(g.luas.extra) + ' Ha di luar paddock rencana', lu);

  // 3. HK support
  const hk = row(c, '\ud83d\udc77', 'HK Support', g.hk.c);
  if (g.hk.c.s !== 'none') { pair(hk, g.hk.p, g.hk.r, g.hk.c, ''); bar(hk, g.hk.p, g.hk.r, g.hk.c); }

  // 4. unit/opr
  const um = row(c, '\ud83d\ude9c', 'Unit / Operator', null);
  if (!g.units.length) h('div', 'sx-note', 'Tidak ada data unit', um);
  g.units.forEach(u => { const l = h('div', 'sx-l', null, um); h('span', null, u.name, l); pair(l, u.p, u.r, u.c, ''); chipOf(u.c, l); });

  // 5. material
  const mm = row(c, '\ud83e\uddea', 'Material (kebutuhan)', null);
  if (!g.mats.length) h('div', 'sx-note', 'Tidak ada data material', mm);
  g.mats.forEach(u => { const l = h('div', 'sx-l', null, mm); h('span', null, u.name + (u.dosis ? ' \u00b7 dosis ' + u.dosis : ''), l); pair(l, u.p, u.r, u.c, ''); chipOf(u.c, l); });
}

/* ---------- ringkasan seluruh WO ---------- */
const pc = (r, p) => p > 0 ? Math.round(r / p * 100) : null;
function stat(parent, icon, title, x, unit, lines) {
  const c = h('div', 'sx-s', null, parent), hd = h('div', 'sx-mh', null, c);
  h('span', 'sx-ic', icon, hd); h('b', null, title, hd);
  if (x.c.s !== 'none') chipOf(x.c, hd);
  const v = h('div', 'sx-big', null, c), b = h('b', null, x.hr ? fmt(x.r) : '\u2013', v);
  if (x.hr && SM[x.c.s]) b.style.color = SM[x.c.s].c;
  h('span', null, ' / ' + fmt(x.p) + unit + ' rencana', v);
  if (x.p > 0) {
    bar(c, x.p, x.r, x.hr ? x.c : { s: 'pend' });
    h('div', 'sx-note', (x.hr ? pc(x.r, x.p) + '% dari rencana WO' : 'Belum ada realisasi') + (x.pTD > 0 && x.pTD < x.p ? ' \u00b7 target s.d. hari ini ' + fmt(x.pTD) + unit : ''), c);
  }
  (lines || []).forEach(u => {
    const l = h('div', 'sx-l', null, c); h('span', null, u.name, l);
    h('b', null, (u.hr ? fmt(u.r) : '\u2013') + ' / ' + fmt(u.p), l);
    if (u.c.s !== 'none') chipOf(u.c, l);
  });
}
function listTable(parent, title, sub, head, items, tot, unit) {
  const box = h('div', 'sx-pnl', null, parent);
  h('b', null, title, box); h('div', 'sx-note', sub, box);
  const sc = h('div', 'sx-sc', null, box), tb = h('table', 'sx-t2', null, sc);
  const hr = h('tr', null, null, h('thead', null, null, tb));
  [head, 'Rencana', 'Realisasi', '%', 'Status'].forEach((x, i) => h('th', i && i < 4 ? 'r' : null, x, hr));
  const body = h('tbody', null, null, tb);
  const line = (e, name, cls) => {
    const tr = h('tr', cls, null, body);
    h('td', null, name, tr);
    h('td', 'r', e.p ? fmt(e.p) + unit : '\u2013', tr);
    h('td', 'r', e.hr ? fmt(e.r) + unit : '\u2013', tr);
    h('td', 'r', e.hr && e.p > 0 ? pc(e.r, e.p) + '%' : '\u2013', tr);
    const st = h('td', null, null, tr); if (e.c.s !== 'none') chipOf(e.c, st);
  };
  if (!items.length) { const tr = h('tr', null, null, body), td = h('td', 'sx-none', 'Belum ada data', tr); td.colSpan = 5; }
  items.forEach(e => line(e, e.name + (e.dosis ? ' \u00b7 dosis ' + e.dosis : ''), e.p > 0 ? '' : 'sx-out'));
  if (items.length > 1) line(tot, 'Total', 'sx-tot');
}
function drawWO(root, w) {
  const box = h('div', 'sx-wo', null, root);
  h('h3', null, 'Ringkasan seluruh Work Order \u00b7 Rencana vs Realisasi', box);
  const st = h('div', 'sx-stats', null, box);
  stat(st, '\ud83d\udcd0', 'Total Hektar', w.ha, ' Ha', []);
  stat(st, '\ud83d\udc77', 'Total HK Support', w.hk, '', []);
  stat(st, '\ud83d\ude9c', 'Total Unit / Operator', w.un, '', w.units);
  if (w.extra) { const last = st.firstChild.querySelector('.sx-note:last-child'); if (last) last.textContent += ' \u00b7 termasuk ' + fmt(w.extra) + ' Ha di luar rencana'; }
  const pn = h('div', 'sx-pn', null, box);
  const pl = w.paddocks.filter(e => e.p > 0), done = pl.filter(e => e.hr && e.r > 0).length, out = w.paddocks.filter(e => e.p <= 0 && e.r > 0).length;
  listTable(pn, '\ud83d\udccd Lokasi kerja (paddock)', pl.length + ' paddock rencana \u00b7 ' + done + ' sudah dikerjakan' + (out ? ' \u00b7 ' + out + ' di luar rencana' : ''), 'Paddock', w.paddocks, w.ha, ' Ha');
  listTable(pn, '\ud83e\uddea Material', w.mats.length + ' material direncanakan \u00b7 angka = total kebutuhan', 'Material', w.mats, w.ma, '');
}

export function renderSummary(el, m, info, opt, onOpt) {
  info = info || {}; opt = opt || {};
  el.textContent = '';
  const root = h('div', 'tl sx', null, el);
  h('h2', 'tl-title', 'Summary \u00b7 Rencana vs Aktual' + (info.title ? ' \u00b7 ' + info.title : ''), root);

  const bar0 = h('div', 'sx-bar0', null, root);
  const l1 = h('label', null, 'Toleransi \u00b1 ', bar0), ti = h('input', null, null, l1);
  ti.type = 'number'; ti.min = 0; ti.step = 1; ti.value = m.tol; l1.append(' %');
  ti.onchange = () => onOpt && onOpt({ tol: Math.max(0, +ti.value || 0) });
  const l2 = h('label', null, null, bar0), ck = h('input', null, null, l2);
  ck.type = 'checkbox'; ck.checked = !!opt.only; l2.append(' Hanya yang perlu perhatian'); ck.onchange = () => onOpt && onOpt({ only: ck.checked });

  if (!m.days.length) { h('p', 'tl-empty', 'Belum ada data. Isi rencana dan realisasi pada tab Work Order.', root); return; }

  drawWO(root, m.wo);
  // cincin ringkasan
  const kp = h('div', 'sx-kpi', null, root);
  [['loc', '\ud83d\udccd', 'Lokasi'], ['luas', '\ud83d\udcd0', 'Luasan'], ['hk', '\ud83d\udc77', 'HK Support'], ['unit', '\ud83d\ude9c', 'Unit/Opr'], ['mat', '\ud83e\uddea', 'Material']].forEach(([k, ic, name]) => {
    const x = m.kpi[k], ev = x.ok + x.bad, pc = ev ? Math.round(x.ok / ev * 100) : null;
    const t = h('div', 'sx-k', null, kp), rg = h('div', 'sx-ring', null, t);
    rg.style.setProperty('--p', pc == null ? 0 : pc); rg.style.setProperty('--rc', pc == null ? '#8c959f' : pc >= 90 ? '#2da44e' : pc >= 60 ? '#d4a72c' : '#cf222e');
    h('span', null, pc == null ? '\u2013' : pc + '%', rg);
    const tx = h('div', null, null, t); h('b', null, ic + ' ' + name, tx);
    h('small', null, ev ? x.ok + ' sesuai \u00b7 ' + x.bad + ' berbeda' + (x.blank ? ' \u00b7 ' + x.blank + ' menunggu' : '') : (x.blank ? x.blank + ' menunggu realisasi' : 'belum ada data'), tx);
  });

  const cols = m.shifts.length;
  const days = m.days.filter(d => !opt.only || Object.values(d.cards).some(g => g.s === 'warn' || g.s === 'miss'));
  if (!days.length) h('p', 'tl-empty', 'Semua sesuai rencana, tidak ada yang perlu diperhatikan.', root);
  days.forEach(d => {
    const sec = h('section', 'sx-day', null, root);
    const hd = h('div', 'sx-dh', null, sec);
    h('i', 'sx-dot', null, hd);
    const di = d.iso ? dayInfo(d.iso) : null;
    h('b', null, d.iso ? DOWL[new Date(d.iso + 'T00:00:00Z').getUTCDay()] + ', ' + di.long : 'Tanpa tanggal', hd);
    if (d.iso && d.iso === m.today) { chip('hari ini', '#b58900', hd); hd.classList.add('sx-now'); }
    const cs = Object.values(d.cards), nb = cs.filter(g => g.s === 'warn').length, no = cs.filter(g => g.s === 'ok').length;
    if (nb) chip(nb + ' shift perlu perhatian', '#e8590c', hd); else if (no === cs.length) chip('Semua sesuai', '#2da44e', hd);
    const gr = h('div', 'sx-g', null, sec); gr.style.gridTemplateColumns = 'repeat(' + cols + ',minmax(0,1fr))';
    m.shifts.forEach(sh => drawCard(d.cards[sh], gr, sh));
  });
  h('p', 'tl-note', 'Luasan dihitung di paddock rencana. HK, unit, dan material dihitung total satu shift. Toleransi ' + m.tol + '%.', root);
}
