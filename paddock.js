/* paddock.js - "otak" master data paddock
 * Sumber data : paddock.csv (4 kolom: Paddock, Varietas, Status Paddock, Luasan (Ha))
 * Dipakai oleh: master-paddock.html dan work-order.html
 *
 * Aturan data:
 *  - Paddock bersifat UNIK: satu paddock = satu item.
 *  - Jika paddock yang sama muncul di banyak baris (varietas / status berbeda),
 *    SEMUA baris tetap disimpan di item.rows, dan luasnya DIJUMLAHKAN di item.luas.
 *
 * Bentuk satu item:
 *   { paddock, varietas, status, luas, varList, statList, rows:[{varietas,status,luas}] }
 *   - varietas / status : gabungan nilai unik, dipisah " / "
 *   - luas              : jumlah semua baris paddock tersebut
 *
 * Pemakaian:
 *   import {loadPaddocks, searchPaddocks, getPaddock, fmtLuas} from './paddock.js';
 *   const list = await loadPaddocks();
 *   const hasil = searchPaddocks(list, 'a12 tebu');
 */

const CSV_URL = 'paddock.csv';
const CACHE_KEY = 'paddockCsvCache';
let _p = null;

const ls = (k, v) => {
  try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (e) {}
};
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
const r4 = n => Math.round(n * 10000) / 10000; // hindari selisih desimal floating point

/* ---------- CSV parser (koma / titik koma / tab, tanda kutip, BOM) ---------- */
function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = c => first.split(c).length - 1;
  const d = [',', ';', '\t'].reduce((a, b) => (count(b) > count(a) ? b : a));
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = ''; rows.push(row); row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

/* ---------- angka: "12,5" | "12.5" | "1.234,56" | "1,234.56" ---------- */
function toNum(s) {
  s = String(s == null ? '' : s).trim().replace(/\s/g, '');
  if (!s) return null;
  const c = s.lastIndexOf(','), p = s.lastIndexOf('.');
  if (c > -1 && p > -1) s = c > p ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c > -1) s = s.replace(',', '.');
  else if (p > -1 && s.split('.').length > 2) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

/* ---------- pemetaan header ---------- */
const KEYS = {
  paddock:  ['paddock', 'kodepaddock', 'namapaddock', 'block', 'blok'],
  varietas: ['varietas', 'variety'],
  status:   ['statuspaddock', 'status'],
  luas:     ['luasanha', 'luasan', 'luasha', 'luasarea', 'luas', 'ha']
};
function mapHeader(h) {
  const m = {};
  h.forEach((x, i) => {
    const n = norm(x);
    for (const k in KEYS) if (m[k] === undefined && KEYS[k].includes(n)) m[k] = i;
  });
  return m;
}

// jumlah luas dari kumpulan baris (null jika semua kosong)
function sumLuas(rows) {
  let any = false, s = 0;
  rows.forEach(r => { if (r.luas != null) { any = true; s += r.luas; } });
  return any ? r4(s) : null;
}

function build(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const hdr = mapHeader(rows[0]);
  const hasHeader = hdr.paddock !== undefined;
  // jika header tidak dikenali, pakai urutan kolom: paddock, varietas, status, luas
  const m = hasHeader ? hdr : { paddock: 0, varietas: 1, status: 2, luas: 3 };
  const data = hasHeader ? rows.slice(1) : rows;
  const get = (r, k) => (m[k] === undefined ? '' : String(r[m[k]] == null ? '' : r[m[k]]).trim());

  // kelompokkan per paddock (tidak peka huruf besar/kecil); semua baris dipertahankan
  const map = new Map();
  for (const r of data) {
    const paddock = get(r, 'paddock');
    if (!paddock) continue;
    const key = paddock.toLowerCase();
    let it = map.get(key);
    if (!it) { it = { paddock, rows: [] }; map.set(key, it); }
    it.rows.push({ varietas: get(r, 'varietas'), status: get(r, 'status'), luas: toNum(get(r, 'luas')) });
  }

  const out = [...map.values()].map(it => {
    const uniq = f => [...new Set(it.rows.map(r => r[f]).filter(Boolean))];
    it.varList = uniq('varietas');
    it.statList = uniq('status');
    it.varietas = it.varList.join(' / ');
    it.status = it.statList.join(' / ');
    it.luas = sumLuas(it.rows);
    it._k = [it.paddock, ...it.varList, ...it.statList].join(' ').toLowerCase();
    return it;
  });
  return out.sort((a, b) => a.paddock.localeCompare(b.paddock, 'id', { numeric: true }));
}

/* ---------- API ---------- */

// Ambil semua paddock. Hasil disimpan di memori; jika offline memakai cache terakhir.
export function loadPaddocks(force) {
  if (_p && !force) return _p;
  _p = (async () => {
    let text;
    try {
      const r = await fetch(CSV_URL, { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      text = await r.text();
      ls(CACHE_KEY, text);
    } catch (e) {
      text = ls(CACHE_KEY);
      if (!text) { _p = null; throw e; }
    }
    return build(text);
  })();
  return _p;
}

// Cari di paddock / varietas / status (semua varietas & status paddock ikut dicari).
// Beberapa kata = semua harus cocok.
export function searchPaddocks(list, q, limit) {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  let res = list.filter(it => terms.every(t => it._k.includes(t)));
  if (terms.length) {
    const t0 = terms[0];
    const sc = it => {
      const p = it.paddock.toLowerCase();
      return p === t0 ? 0 : p.startsWith(t0) ? 1 : p.includes(t0) ? 2 : 3;
    };
    res = res
      .map(it => ({ it, s: sc(it) }))
      .sort((a, b) => a.s - b.s || a.it.paddock.localeCompare(b.it.paddock, 'id', { numeric: true }))
      .map(x => x.it);
  }
  return limit ? res.slice(0, limit) : res;
}

// Ambil satu paddock berdasarkan nama persis (tidak peka huruf besar/kecil).
export function getPaddock(list, name) {
  const k = String(name || '').trim().toLowerCase();
  return k ? list.find(it => it.paddock.toLowerCase() === k) || null : null;
}

// Baris detail milik satu paddock, opsional difilter varietas / status.
//   rowsOf(item, {varietas:'Q200', status:'Seed Production'})
export function rowsOf(it, f) {
  f = f || {};
  return it.rows.filter(r => (!f.varietas || r.varietas === f.varietas) && (!f.status || r.status === f.status));
}

// Nilai unik satu kolom (untuk filter), mis. distinct(list, 'status')
export function distinct(list, field) {
  const key = field === 'varietas' ? 'varList' : field === 'status' ? 'statList' : null;
  const vals = key ? list.flatMap(it => it[key]) : list.map(it => it[field]);
  return [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
}

export function totalLuas(list) {
  return r4(list.reduce((s, it) => s + (it.luas || 0), 0));
}

// Format angka gaya Indonesia: 1234.5 -> "1.234,5"
export function fmtLuas(n) {
  return n == null ? '' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

// Isi <datalist> untuk autocomplete (dipakai di work-order.html)
export function fillDatalist(el, list) {
  el.innerHTML = '';
  list.forEach(it => {
    const o = document.createElement('option');
    o.value = it.paddock;
    o.label = [it.varietas, it.luas != null ? fmtLuas(it.luas) + ' Ha' : ''].filter(Boolean).join(' · ');
    el.appendChild(o);
  });
}
