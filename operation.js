/* operation.js - "otak" master data Operation (Op Code + Desc)
 * Sumber data : operation.csv  (kolom: Operation Code, Description_ENG, Description_INA)
 * Dipakai oleh: work-order.html (autocomplete kolom Op Code & Desc)
 *
 *   Op Code  <- kolom "Operation Code"
 *   Desc     <- kolom "Description_ENG"
 *   Description_INA ikut dicari (mengetik "cabut gulma" menemukan "Manual Weeding"),
 *   tetapi yang diisikan ke Work Order tetap Description_ENG.
 *
 * Pemakaian:
 *   import {loadOps, searchOps, getOpByCode, getOpByDesc} from './operation.js';
 *   const ops = await loadOps();
 */

const OPS_URL = 'operation.csv';
const CACHE_KEY = 'operationCsvCache';
let _p = null;

const ls = (k, v) => {
  try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (e) {}
};
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

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

/* ---------- pemetaan header ---------- */
const KEYS = {
  code: ['operationcode', 'opcode', 'kodeoperasi', 'code', 'kode'],
  desc: ['descriptioneng', 'desceng', 'description', 'desc', 'deskripsi'],
  ina:  ['descriptionina', 'descina', 'deskripsiina', 'deskripsiindonesia']
};
function mapHeader(h) {
  const m = {};
  h.forEach((x, i) => {
    const n = norm(x);
    for (const k in KEYS) if (m[k] === undefined && KEYS[k].includes(n)) m[k] = i;
  });
  return m;
}

function build(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const hdr = mapHeader(rows[0]), hasHeader = hdr.code !== undefined && hdr.desc !== undefined;
  // jika header tidak dikenali, pakai urutan kolom: kode, desc ENG, desc INA
  const m = hasHeader ? hdr : { code: 0, desc: 1, ina: 2 };
  const data = hasHeader ? rows.slice(1) : rows;
  const get = (r, k) => (m[k] === undefined ? '' : String(r[m[k]] == null ? '' : r[m[k]]).trim());
  const seen = new Set(), out = [];
  for (const r of data) {
    const code = get(r, 'code');
    if (!code || seen.has(code)) continue;       // kode ganda: yang pertama dipakai
    seen.add(code);
    const it = { code, desc: get(r, 'desc'), ina: get(r, 'ina') };
    it._k = [it.code, it.desc, it.ina].join(' ').toLowerCase();
    it._n = norm(it.desc);
    it._ni = norm(it.ina);
    out.push(it);
  }
  return out;
}

/* ---------- API ---------- */

// Ambil semua operation. Hasil disimpan di memori; jika offline memakai cache terakhir.
export function loadOps(force) {
  if (_p && !force) return _p;
  _p = (async () => {
    let text;
    try {
      const r = await fetch(OPS_URL, { cache: 'no-cache' });
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

// Cari di kode / Description_ENG / Description_INA. Beberapa kata = semua harus cocok.
export function searchOps(list, q, limit) {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  let res = list.map((it, i) => ({ it, i })).filter(x => terms.every(t => x.it._k.includes(t)));
  if (terms.length) {
    const t0 = terms[0];
    const sc = it => it.code === t0 ? 0 : it.code.startsWith(t0) ? 1 : it.desc.toLowerCase().includes(t0) ? 2 : 3;
    res = res.sort((a, b) => sc(a.it) - sc(b.it) || a.i - b.i);
  }
  res = res.map(x => x.it);
  return limit ? res.slice(0, limit) : res;
}

// Cari persis berdasarkan kode.
export function getOpByCode(list, code) {
  const c = String(code == null ? '' : code).trim();
  return c ? list.find(it => it.code === c) || null : null;
}

// Cari persis berdasarkan deskripsi (abaikan huruf besar/kecil, spasi, dan tanda baca).
// Deskripsi bahasa Indonesia juga dikenali.
export function getOpByDesc(list, desc) {
  const n = norm(desc);
  return n ? list.find(it => it._n === n) || list.find(it => it._ni === n) || null : null;
}
