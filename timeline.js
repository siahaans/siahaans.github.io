/* timeline.js - menyusun isi Work Order menjadi Timeline per hari & shift
 *
 * Dipakai oleh: work-order.html (tab "Timeline") dan export-excel.js (sheet "Timeline").
 *
 * Input  : {start, end, rows, today}  (rows = baris Work Order dari collect(), tanggal YYYY-MM-DD)
 * Output : buildTimeline() -> model; renderTimeline(el, model) -> menggambar ke halaman.
 *
 * Satu baris Operation + baris Unit Kerja yang berpasangan = satu "kartu" aktivitas
 * pada satu hari dan satu shift:
 *   Luas   : Open (rencana) / Close (realisasi)
 *   HK     : Jlh HK Support (rencana) / Jlh Realisasi
 *   Unit   : Kode Unit, Jlh Unit/Opt, Est & Realisasi HM/Rit
 *   Material: Material, Dosis, Total Kebutuhan / Total Realisasi
 *
 * Kode warna:
 *   Lajur  = Shift   (1 biru, 2 oranye, 3 ungu, tanpa shift abu-abu)
 *   Garis kiri kartu = Aktivitas (satu warna per Op Code)
 *   Lencana = Status realisasi (hijau tercapai, kuning sebagian, merah belum direalisasi, abu rencana)
 */

import { num, has, okIso, clean as cleanName } from './util.js';

export const SHIFTS = {
  1: { label: 'Shift 1',     color: '#1f6feb', tint: 'rgba(31,111,235,.10)', hex: '1F6FEB', tintHex: 'DDF4FF' },
  2: { label: 'Shift 2',     color: '#e8590c', tint: 'rgba(232,89,12,.10)',  hex: 'E8590C', tintHex: 'FFE8D6' },
  3: { label: 'Shift 3',     color: '#8250df', tint: 'rgba(130,80,223,.10)', hex: '8250DF', tintHex: 'F0E6FF' },
  0: { label: 'Tanpa Shift', color: '#6e7781', tint: 'rgba(110,119,129,.10)', hex: '6E7781', tintHex: 'EAEEF2' }
};
export const STATUS = {
  done: { label: 'Tercapai',         color: '#2da44e', hex: '2DA44E' },
  part: { label: 'Sebagian',         color: '#d4a72c', hex: 'B58900' },
  late: { label: 'Belum direalisasi', color: '#cf222e', hex: 'CF222E' },
  plan: { label: 'Rencana',          color: '#8c959f', hex: '6E7781' }
};
const PAL = ['#0969da', '#1a7f37', '#bf3989', '#b35900', '#0a7ea4', '#8250df', '#cf222e', '#4c6ef5', '#2b8a3e', '#d9480f', '#7048e8', '#0b7285'];
const MAX_DAYS = 62;

/* ---------- util ---------- */
const r2 = n => Math.round(n * 100) / 100;
export const fmt = n => r2(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const DN = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const toD = s => { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
const toIso = d => d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
export function dayInfo(s) {
  const d = toD(s), w = d.getUTCDay();
  return { dow: DN[w], text: d.getUTCDate() + ' ' + MN[d.getUTCMonth()], long: d.getUTCDate() + ' ' + MN[d.getUTCMonth()] + ' ' + d.getUTCFullYear(), weekend: w === 0 || w === 6 };
}

/* ---------- model ---------- */
export function buildTimeline(o) {
  const rows = o.rows || [], start = okIso(o.start) ? o.start : '', end = okIso(o.end) ? o.end : '', today = o.today || '';
  const cards = [], unplaced = [], actMap = new Map();

  rows.forEach((r, i) => {
    const active = ['code', 'desc', 'paddock', 'open', 'close', 'hk', 'uom', 'ukode', 'vnama'].some(k => has(r[k]));
    if (!active) return;
    const date = okIso(r.date) ? r.date : start;
    const shift = [1, 2, 3].includes(+r.shift) ? +r.shift : 0;
    const name = cleanName(r.desc) || (has(r.code) ? r.code : '(tanpa aktivitas)');
    const key = has(r.code) ? String(r.code).trim() : name;
    if (!actMap.has(key)) actMap.set(key, { key, code: has(r.code) ? String(r.code).trim() : '', name, color: PAL[actMap.size % PAL.length] });
    const haPlan = num(r.open), haReal = num(r.close), hasReal = has(r.close);
    const c = {
      no: i + 1, iso: date, shift, key, code: has(r.code) ? String(r.code).trim() : '', name,
      color: actMap.get(key).color,
      paddock: String(r.paddock || '').trim(),
      haPlan, haReal, hasReal, pct: haPlan > 0 ? haReal / haPlan * 100 : null,
      hkPlan: num(r.hk), hkReal: num(r.uom), hasHkReal: has(r.uom),
      unit: has(r.ukode) || num(r.unik) > 0 ? { kode: String(r.ukode || '').trim(), qty: num(r.unik), qtyReal: num(r.unama), hm: num(r.uest), hmReal: num(r.uhk) } : null,
      mat: has(r.vnama) || num(r.vest) > 0 ? { name: String(r.vnama || '').trim(), dosis: String(r.vnik || '').trim(), need: num(r.vest), real: num(r.vhk) } : null,
      mpHk: num(r.mhk) + num(r.phk),
      mpNames: [r.mnama, r.pnama].filter(has).map(s => String(s).trim())
    };
    c.status = c.hasReal ? ((haPlan > 0 ? haReal >= haPlan - 1e-9 : haReal > 0) ? 'done' : 'part') : (date && today && date < today ? 'late' : 'plan');
    (date ? cards : unplaced).push(c);
  });

  // rentang hari: Forecast Start - End, diperluas jika ada kartu di luar rentang
  const isos = cards.map(c => c.iso).concat(start ? [start] : [], end ? [end] : []).sort();
  const days = []; let truncated = false;
  if (isos.length) {
    let d = isos[0];
    const last = isos[isos.length - 1];
    while (d <= last) {
      if (days.length >= MAX_DAYS) { truncated = true; break; }
      days.push(Object.assign({ iso: d, today: d === today }, dayInfo(d)));
      d = addDays(d, 1);
    }
  }
  const dset = new Set(days.map(d => d.iso));
  const used = cards.filter(c => dset.has(c.iso));

  // lajur per shift (hanya yang terpakai)
  const lanes = [1, 2, 3, 0].filter(k => used.some(c => c.shift === k)).map(k => {
    const cells = {};
    used.filter(c => c.shift === k).forEach(c => { (cells[c.iso] = cells[c.iso] || []).push(c); });
    return Object.assign({ key: k, cells }, SHIFTS[k]);
  });

  // total per hari
  const byDay = {};
  days.forEach(d => { byDay[d.iso] = { haPlan: 0, haReal: 0, hkPlan: 0, hkReal: 0, mpHk: 0, n: 0, units: new Map(), mats: new Map() }; });
  used.forEach(c => {
    const t = byDay[c.iso];
    t.n++; t.haPlan += c.haPlan; t.haReal += c.haReal; t.hkPlan += c.hkPlan; t.hkReal += c.hkReal; t.mpHk += c.mpHk;
    if (c.unit) {
      const k = c.unit.kode || '(unit)', u = t.units.get(k) || { kode: k, qty: 0, qtyReal: 0, hm: 0, hmReal: 0 };
      u.qty += c.unit.qty; u.qtyReal += c.unit.qtyReal; u.hm += c.unit.hm; u.hmReal += c.unit.hmReal; t.units.set(k, u);
    }
    if (c.mat) {
      const k = c.mat.name || '(material)', m = t.mats.get(k) || { name: k, need: 0, real: 0 };
      m.need += c.mat.need; m.real += c.mat.real; t.mats.set(k, m);
    }
  });
  Object.keys(byDay).forEach(k => { byDay[k].units = [...byDay[k].units.values()]; byDay[k].mats = [...byDay[k].mats.values()]; });

  const totals = { haPlan: 0, haReal: 0, hkPlan: 0, hkReal: 0, mpHk: 0, n: used.length, workDays: 0 };
  days.forEach(d => {
    const t = byDay[d.iso]; totals.haPlan += t.haPlan; totals.haReal += t.haReal; totals.hkPlan += t.hkPlan; totals.hkReal += t.hkReal; totals.mpHk += t.mpHk;
    if (t.n) totals.workDays++;
  });
  totals.pct = totals.haPlan > 0 ? totals.haReal / totals.haPlan * 100 : null;

  return { start: days.length ? days[0].iso : '', end: days.length ? days[days.length - 1].iso : '', days, lanes, byDay, totals, acts: [...actMap.values()], unplaced, truncated, cards: used };
}

/* ---------- isi kartu (dipakai tampilan & Excel) ---------- */
export function cardLines(c) {
  const L = [];
  if (c.haPlan || c.hasReal) L.push(['Luas', fmt(c.haPlan) + ' Ha' + (c.hasReal ? ' \u2192 real ' + fmt(c.haReal) + ' Ha' : '')]);
  if (c.hkPlan || c.hasHkReal) L.push(['HK', fmt(c.hkPlan) + (c.hasHkReal ? ' \u2192 real ' + fmt(c.hkReal) : '')]);
  if (c.unit) L.push(['Unit', (c.unit.kode || '(unit)') + (c.unit.qty ? ' \u00d7' + fmt(c.unit.qty) : '') + (c.unit.hm ? ' \u00b7 ' + fmt(c.unit.hm) + ' HM/Rit' : '') + (c.unit.hmReal ? ' \u2192 real ' + fmt(c.unit.hmReal) : '')]);
  if (c.mat) L.push(['Material', (c.mat.name || '(material)') + (c.mat.dosis ? ' \u00b7 dosis ' + c.mat.dosis : '') + (c.mat.need ? ' \u00b7 butuh ' + fmt(c.mat.need) : '') + (c.mat.real ? ' \u2192 real ' + fmt(c.mat.real) : '')]);
  if (c.mpHk) L.push(['Man Power', 'HK ' + fmt(c.mpHk) + (c.mpNames.length ? ' (' + c.mpNames.join(', ') + ')' : '')]);
  return L;
}
export function pillText(c) {
  return c.hasReal && c.pct != null ? Math.round(c.pct) + '%' : STATUS[c.status].label;
}

/* ---------- isi kartu versi sederhana (khusus tampilan timeline) ---------- */
export function cardSimple(c) {
  const st = STATUS[c.status];
  let progress, width = 0;
  if (c.hasReal && c.haPlan > 0) {
    progress = Math.round(c.pct) + '% \u00b7 ' + st.label + ' (' + fmt(c.haReal) + ' dari ' + fmt(c.haPlan) + ' Ha)';
    width = Math.min(100, c.pct);
  } else if (c.hasReal) {
    progress = 'Realisasi ' + fmt(c.haReal) + ' Ha (di luar rencana)'; width = 100;
  } else progress = st.label;
  return {
    lokasi: c.paddock || '\u2013',
    luasan: (c.haPlan ? fmt(c.haPlan) + ' Ha' : '\u2013') + (c.hasReal ? ' \u2192 real ' + fmt(c.haReal) + ' Ha' : ''),
    progress, width
  };
}

/* ---------- gambar ke halaman ---------- */
function h(tag, cls, text, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function renderTimeline(el, m, info) {
  info = info || {};
  el.textContent = '';
  const root = h('div', 'tl', null, el);

  h('h2', 'tl-title', 'Timeline' + (info.title ? ' \u00b7 ' + info.title : ''), root);

  if (!m.days.length || !m.cards.length) {
    h('p', 'tl-empty', m.days.length ? 'Belum ada aktivitas. Isi Op Code, Desc, shift, dan target pada tab Work Order, maka timeline tersusun otomatis.' : 'Isi Forecast Start pada tab Work Order terlebih dahulu.', root);
    return;
  }

  // ringkasan
  const sum = h('div', 'tl-sum', null, root);
  const box = (label, val, sub, cls) => { const b = h('div', 'tl-box' + (cls ? ' ' + cls : ''), null, sum); h('small', null, label, b); h('b', null, val, b); if (sub) h('span', null, sub, b); };
  const t = m.totals;
  box('Periode', dayInfo(m.start).text + ' \u2013 ' + dayInfo(m.end).long, m.days.length + ' hari \u00b7 ' + t.workDays + ' hari ada aktivitas');
  box('Luas Rencana', fmt(t.haPlan) + ' Ha', m.cards.length + ' aktivitas');
  box('Luas Realisasi', fmt(t.haReal) + ' Ha', t.pct != null ? Math.round(t.pct) + '% dari rencana' : '', t.pct == null ? '' : t.pct >= 100 ? 'good' : 'mid');
  box('HK Support', fmt(t.hkPlan), t.hkReal ? 'realisasi ' + fmt(t.hkReal) : '');
  box('HK Man Power', fmt(t.mpHk), 'dari tabel Man Power Support');

  // legenda kode warna
  const lg = h('div', 'tl-legend', null, root);
  const grp = (title, items) => {
    const g = h('div', 'tl-lg', null, lg); h('b', null, title, g);
    items.forEach(([label, color]) => { const s = h('span', 'chip', null, g); const d = h('i', null, null, s); d.style.background = color; s.append(label); });
  };
  grp('Shift', [1, 2, 3, 0].filter(k => m.lanes.some(l => l.key === k)).map(k => [SHIFTS[k].label, SHIFTS[k].color]));
  grp('Status', Object.keys(STATUS).map(k => [STATUS[k].label, STATUS[k].color]));
  grp('Aktivitas', m.acts.map(a => [a.name, a.color]));

  // tabel hari x shift
  const sc = h('div', 'tl-scroll', null, root);
  const tb = h('table', 'tl-grid', null, sc);
  const head = h('tr', null, null, h('thead', null, null, tb));
  h('th', 'corner', 'Shift / Hari', head);
  m.days.forEach(d => {
    const th = h('th', 'day' + (d.weekend ? ' wk' : '') + (d.today ? ' today' : ''), null, head);
    h('div', 'dn', d.dow, th); h('div', 'dd', d.text, th);
    if (d.today) h('div', 'dtd', 'hari ini', th);
  });
  const body = h('tbody', null, null, tb);

  m.lanes.forEach(l => {
    const tr = h('tr', 'lane', null, body);
    const lh = h('th', 'lh', l.label, tr); lh.style.background = l.color;
    m.days.forEach(d => {
      const td = h('td', 'cell' + (d.weekend ? ' wk' : '') + (d.today ? ' today' : ''), null, tr);
      td.style.background = l.tint;
      (l.cells[d.iso] || []).forEach(c => {
        const cd = h('div', 'card', null, td); cd.style.setProperty('--ac', c.color);
        h('div', 'ct', null, cd).appendChild(h('b', null, c.name));        // 1. activity
        const row = (k, v, bold) => { const r = h('div', 'cr', null, cd); h('i', null, k, r); h(bold ? 'b' : 'span', null, v, r); };
        const s = cardSimple(c);
        row('Lokasi', s.lokasi, true);                                      // 2. lokasi kerja & luasan
        row('Luasan', s.luasan);
        row('Progress', s.progress);                                        // 3. progress
        const bar = h('div', 'pbar', null, cd), f = h('div', null, null, bar);
        f.style.width = s.width + '%'; f.style.background = STATUS[c.status].color;
      });
    });
  });

  if (m.truncated) h('p', 'tl-note', 'Rentang tanggal lebih dari ' + MAX_DAYS + ' hari, hanya ' + MAX_DAYS + ' hari pertama yang ditampilkan.', root);
  if (m.unplaced.length) h('p', 'tl-note', m.unplaced.length + ' baris belum punya tanggal (isi Forecast Start) sehingga belum masuk timeline.', root);
}
