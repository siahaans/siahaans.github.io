/* paddock.js - "otak" master data paddock
 * Sumber data : paddock.csv (4 kolom: Paddock, Varietas, Status Paddock, Luasan (Ha))
 * Dipakai oleh: master-paddock.html (lihat + edit) dan work-order.html (autocomplete)
 *
 * Aturan data:
 *  - Paddock bersifat UNIK: satu paddock = satu item.
 *  - Jika paddock yang sama muncul di banyak baris (varietas / status berbeda),
 *    SEMUA baris tetap disimpan di item.rows, dan luasnya DIJUMLAHKAN di item.luas.
 *
 * Bentuk satu item:
 *   { paddock, varietas, status, luas, varList, statList, rows:[{varietas,status,luas,src}] }
 *   - varietas / status : gabungan nilai unik, dipisah " / "
 *   - luas              : jumlah semua baris paddock tersebut
 *
 * Untuk mengedit CSV: parseSource -> applyEdits -> serializeSource.
 * Format asli (pemisah kolom, header, koma desimal, BOM, akhir baris) dipertahankan,
 * dan sel yang tidak diubah ditulis persis seperti aslinya.
 */

import { ls, lsDel, norm } from './util.js';
import { detectDelim, parseCSV } from './csv.js';

const CSV_URL = 'paddock.csv';
const CACHE_KEY = 'paddockCsvCache';
const PEND_KEY = 'paddockCsvPending';   // hasil edit terakhir yang mungkin belum tayang di GitHub Pages
const PEND_MS = 15 * 60 * 1000;
let _t = null, _p = null;

const r4 = n => Math.round(n * 10000) / 10000; // hindari selisih desimal floating point
const pk = s => String(s == null ? '' : s).trim().toLowerCase();

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
export const parseNum = toNum;

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

/* ---------- baca CSV mentah: {meta, rows}; tiap row menyimpan raw (semua sel asli) ---------- */
export function parseSource(text) {
  text = String(text == null ? '' : text);
  const bom = text.charCodeAt(0) === 0xFEFF, body = bom ? text.slice(1) : text;
  const delim = detectDelim(body), eol = body.indexOf('\r\n') > -1 ? '\r\n' : '\n';
  const trail = /\n$/.test(body);
  const table = parseCSV(body, delim);
  const meta = { delim, eol, bom, trail, header: null, map: { paddock: 0, varietas: 1, status: 2, luas: 3 }, ncols: 4, decimal: delim === ';' ? ',' : '.' };
  if (!table.length) return { meta, rows: [] };
  const hdr = mapHeader(table[0]), hasHeader = hdr.paddock !== undefined;
  // jika header tidak dikenali, pakai urutan kolom: paddock, varietas, status, luas
  const data = hasHeader ? table.slice(1) : table;
  if (hasHeader) { meta.map = hdr; meta.header = table[0].slice(); }
  meta.ncols = Math.max(hasHeader ? table[0].length : 0, data.reduce((m, r) => Math.max(m, r.length), 0), 4);
  const m = meta.map;
  const get = (r, k) => (m[k] === undefined ? '' : String(r[m[k]] == null ? '' : r[m[k]]).trim());
  let dec = null;
  const rows = data.map(r => {
    const raw = r.slice(); while (raw.length < meta.ncols) raw.push('');
    const lt = get(r, 'luas').replace(/\s/g, '');
    if (dec === null) { if (/^-?\d+,\d+$/.test(lt)) dec = ','; else if (/^-?\d+\.\d+$/.test(lt)) dec = '.'; }
    return { raw, paddock: get(r, 'paddock'), varietas: get(r, 'varietas'), status: get(r, 'status'), luas: toNum(get(r, 'luas')) };
  });
  if (dec) meta.decimal = dec;
  return { meta, rows };
}

/* ---------- tulis kembali ke teks CSV ---------- */
export function serializeSource(meta, rows) {
  const q = c => {
    c = String(c == null ? '' : c);
    return (c.indexOf(meta.delim) > -1 || /["\r\n]/.test(c)) ? '"' + c.replace(/"/g, '""') + '"' : c;
  };
  const lines = [];
  if (meta.header) lines.push(meta.header.map(q).join(meta.delim));
  rows.forEach(r => lines.push(r.raw.map(q).join(meta.delim)));
  return (meta.bom ? '\uFEFF' : '') + lines.join(meta.eol) + (meta.trail ? meta.eol : '');
}

const fmtCell = (n, meta) => n == null ? '' : String(r4(n)).replace('.', meta.decimal);

// Buat baris CSV dari nilai baru. Jika ada src, sel yang tidak berubah tetap seperti aslinya.
export function makeRow(meta, v, src) {
  const raw = src ? src.raw.slice() : new Array(meta.ncols).fill('');
  while (raw.length < meta.ncols) raw.push('');
  const put = (k, val) => { if (meta.map[k] !== undefined) raw[meta.map[k]] = val; };
  const name = String(v.paddock || '').trim(), vr = String(v.varietas || '').trim(), st = String(v.status || '').trim();
  const luas = v.luas == null ? null : v.luas;
  if (!src || src.paddock !== name) put('paddock', name);
  if (!src || src.varietas !== vr) put('varietas', vr);
  if (!src || src.status !== st) put('status', st);
  if (!src || src.luas !== luas) put('luas', fmtCell(luas, meta));
  return { raw, paddock: name, varietas: vr, status: st, luas };
}

/* Terapkan daftar edit ke baris dasar. Edit = {key, name, details:[{varietas,status,luas,src}], del}
 * key = nama paddock (huruf kecil) yang diedit; jika tidak ditemukan, baris ditambahkan di akhir. */
export function applyEdits(rows, edits, meta) {
  let out = rows.slice();
  for (const e of edits) {
    const idx = [];
    out.forEach((r, i) => { if (pk(r.paddock) === e.key) idx.push(i); });
    const nr = e.del ? [] : e.details.map(d => makeRow(meta, { paddock: e.name, varietas: d.varietas, status: d.status, luas: d.luas }, d.src));
    if (idx.length) {
      const drop = new Set(idx), res = [];
      out.forEach((r, i) => { if (i === idx[0]) res.push(...nr); if (!drop.has(i)) res.push(r); });
      out = res;
    } else out = out.concat(nr);
  }
  return out;
}

/* ---------- kelompokkan per paddock ---------- */
export function groupRows(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.paddock) continue;
    const key = r.paddock.toLowerCase();
    let it = map.get(key);
    if (!it) { it = { paddock: r.paddock, rows: [] }; map.set(key, it); }
    it.rows.push({ varietas: r.varietas, status: r.status, luas: r.luas, src: r });
  }
  const sumLuas = rs => { let any = false, s = 0; rs.forEach(r => { if (r.luas != null) { any = true; s += r.luas; } }); return any ? r4(s) : null; };
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
const build = text => groupRows(parseSource(text).rows);

/* ---------- API ---------- */

// Hasil edit yang baru di-commit ke GitHub bisa terlambat tayang di GitHub Pages;
// simpan sementara supaya halaman lain di browser ini langsung memakai data terbaru.
export function setPendingCsv(text) {
  ls(PEND_KEY, JSON.stringify({ text, t: Date.now() }));
  ls(CACHE_KEY, text);
}
function readPend() {
  try { const p = JSON.parse(ls(PEND_KEY) || 'null'); return p && p.text ? p : null; } catch (e) { return null; }
}

// Ambil teks CSV. Hasil disimpan di memori; jika offline memakai cache terakhir.
export function loadCsvText(force) {
  if (_t && !force) return _t;
  _t = (async () => {
    let text;
    try {
      const r = await fetch(CSV_URL, { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      text = await r.text();
      ls(CACHE_KEY, text);
      const pend = readPend();
      if (pend) {
        if (pend.text === text || Date.now() - pend.t >= PEND_MS) lsDel(PEND_KEY);
        else text = pend.text;
      }
    } catch (e) {
      const pend = readPend();
      text = pend ? pend.text : ls(CACHE_KEY);
      if (!text) { _t = null; throw e; }
    }
    return text;
  })();
  return _t;
}

// Ambil semua paddock (sudah dikelompokkan per paddock).
export function loadPaddocks(force) {
  if (_p && !force) return _p;
  _p = loadCsvText(force).then(build).catch(e => { _p = null; throw e; });
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
  const k = pk(name);
  return k ? list.find(it => it.paddock.toLowerCase() === k) || null : null;
}

// Baris detail milik satu paddock, opsional difilter varietas / status.
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
