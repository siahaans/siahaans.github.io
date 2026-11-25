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
 *  - HK, Unit/Opr, Material : rencana vs total aktual satu shift.
 *  - "Sesuai" = selisih dalam toleransi (%).
 */
import { SHIFTS, fmt, dayInfo } from './timeline.js';

const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return isFinite(n) ? n : 0; };
const has = s => String(s == null ? '' : s).trim() !== '';
const okIso = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const pk = s => String(s || '').trim().toUpperCase();
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
  (o.rows || []).forEach(r => {
    const planned = [r.open, r.hk, r.unik, r.uest, r.vest].some(x => num(x) > 0);
    const rv = [r.close, r.uom, r.unama, r.uhk, r.vhk];
    if (!planned && !rv.some(has)) return;
    const iso = okIso(r.date) ? r.date : start, shift = [1, 2, 3].includes(+r.shift) ? +r.shift : 0, k = iso + '|' + shift;
    if (!gm.has(k)) gm.set(k, { iso, shift, rows: [] });
    gm.get(k).rows.push({ r, planned, entered: rv.some(has), worked: rv.some(x => num(x) > 0), pad: String(r.paddock || '').trim() || '(tanpa paddock)' });
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
    g.mats = grp(r => String(r.vnama || '').trim() || '(material)', 'vest', 'vhk', 'vnik');
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
  return { tol, days, shifts: used, kpi, tot, today };
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
  if (c) chipOf(c, hd, over);
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
