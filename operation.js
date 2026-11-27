/* operation.js - "otak" master data Operation (Op Code + Desc) per Department
 * Sumber data : operation.csv  (pemisah ; , atau tab)
 *   Kolom yang dikenali : Operation Code, Department, Description_ENG, Description_INA, Status
 *   Kolom lain (Aktivitas_INA, Kode_Aktivitas_INA/ENG, COA, dst.) ikut disimpan apa adanya.
 * Dipakai oleh: work-order.html (autocomplete Op Code & Desc, disaring per Department)
 *               master-operation.html (kelola master + simpan ke GitHub)
 *
 *   Op Code  <- "Operation Code"         (satu Op Code hanya boleh milik satu Department)
 *   Desc     <- "Description_ENG"        (Description_INA ikut dicari)
 *   Status   <- "Aktif" / "Nonaktif"     (kosong = Aktif; Nonaktif tidak muncul di autocomplete,
 *                                         tetapi tetap dikenali untuk WO lama)
 *
 * Pemakaian:
 *   import {loadOps, searchOps, getOpByCode, getOpByDesc, opsForDept} from './operation.js';
 *   const ops = await loadOps();
 */

export const OPS_URL = 'operation.csv';
const CACHE_KEY = 'operationCsvCache';
const PENDING_KEY = 'operationCsvPending';      // hasil simpan terakhir dari halaman master (menunggu GitHub Pages)
const PENDING_TTL = 15 * 60 * 1000;
let _p = null;

export const DEPTS = ['Agri - Land Development', 'Agri - Upkeep & Manuring', 'Agri - Planting', 'Agri - Road & Drainage Maintenance', 'Agri - Seed Planting'];

const ls = (k, v) => {
  try { return v === undefined ? localStorage.getItem(k) : (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)); } catch (e) {}
};
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

// "upkeep manuring", "Agri - Upkeep & Manuring", "UPKEEP & MANURING" -> "Agri - Upkeep & Manuring"
export function normDept(s) {
  const t = String(s == null ? '' : s).trim(), k = norm(t);
  if (!k) return '';
  const hit = DEPTS.find(d => norm(d) === k || norm(d.replace(/^Agri\s*-\s*/i, '')) === k);
  return hit || t;
}
export const isInactive = s => /^(non\s*-?\s*aktif|tidak(\s*aktif)?|inactive|no|n|0|false)$/i.test(String(s == null ? '' : s).trim());

/* ---------- CSV parser (koma / titik koma / tab, tanda kutip, BOM) ---------- */
function detect(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = c => first.split(c).length - 1;
  return [',', ';', '\t'].reduce((a, b) => (count(b) > count(a) ? b : a));
}
function parseCSV(text, d) {
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
  code:   ['operationcode', 'opcode', 'kodeoperasi', 'code', 'kode'],
  dept:   ['department', 'departement', 'departemen', 'dept', 'divisi'],
  desc:   ['descriptioneng', 'desceng', 'description', 'desc', 'deskripsi'],
  ina:    ['descriptionina', 'descina', 'deskripsiina', 'deskripsiindonesia'],
  status: ['status', 'aktif', 'active']
};
function mapHeader(h) {
  const m = {};
  h.forEach((x, i) => {
    const n = norm(x);
    for (const k in KEYS) if (m[k] === undefined && KEYS[k].includes(n)) m[k] = i;
  });
  return m;
}

/* Sumber mentah: header + semua sel, supaya bisa ditulis ulang tanpa kehilangan kolom.
 * meta = {delim, bom, eol, header:[...], idx:{code,dept,desc,ina,status}} ; rows = [[sel...], ...] */
export function parseOpsSource(text) {
  text = String(text == null ? '' : text);
  const bom = /^﻿/.test(text); text = text.replace(/^﻿/, '');
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const delim = detect(text);
  const all = parseCSV(text, delim);
  let header = all[0] || [], idx = mapHeader(header), rows = all.slice(1);
  if (idx.code === undefined || idx.desc === undefined) {          // tanpa header: kode, desc ENG, desc INA
    header = ['Operation Code', 'Description_ENG', 'Description_INA']; idx = mapHeader(header); rows = all;
  }
  header = header.map(x => String(x).trim());
  // kolom wajib ditambahkan bila belum ada
  if (idx.dept === undefined) { header.splice(idx.code + 1, 0, 'Department'); rows = rows.map(r => { r = r.slice(); r.splice(idx.code + 1, 0, ''); return r; }); idx = mapHeader(header); }
  if (idx.status === undefined) { header.push('Status'); idx = mapHeader(header); }
  rows = rows.map(r => { const o = header.map((_, i) => String(r[i] == null ? '' : r[i])); return o; });
  return { meta: { delim, bom, eol, header, idx }, rows };
}
const q = (v, d) => /["\r\n]/.test(v) || v.includes(d) ? '"' + v.replace(/"/g, '""') + '"' : v;
export function serializeOps(meta, rows) {
  const d = meta.delim || ';', line = r => meta.header.map((_, i) => q(String(r[i] == null ? '' : r[i]), d)).join(d);
  return (meta.bom ? '﻿' : '') + [meta.header.map(h => q(h, d)).join(d)].concat(rows.map(line)).join(meta.eol || '\r\n') + (meta.eol || '\r\n');
}

/* sel mentah -> item */
export function itemOf(meta, r) {
  const g = k => (meta.idx[k] === undefined ? '' : String(r[meta.idx[k]] == null ? '' : r[meta.idx[k]]).trim());
  const it = { code: g('code'), desc: g('desc'), ina: g('ina'), dept: normDept(g('dept')), active: !isInactive(g('status')) };
  it._k = [it.code, it.desc, it.ina].join(' ').toLowerCase();
  it._n = norm(it.desc);
  it._ni = norm(it.ina);
  return it;
}

// Op Code yang muncul lebih dari sekali: [{code, depts:[...], n}]
export function findDuplicates(items) {
  const m = new Map();
  items.forEach(it => { if (!it.code) return; const e = m.get(it.code) || { code: it.code, depts: [], n: 0 }; e.n++; if (!e.depts.includes(it.dept || '(tanpa department)')) e.depts.push(it.dept || '(tanpa department)'); m.set(it.code, e); });
  return [...m.values()].filter(e => e.n > 1);
}

function build(text) {
  const { meta, rows } = parseOpsSource(text);
  const seen = new Set(), out = [];
  for (const r of rows) {
    const it = itemOf(meta, r);
    if (!it.code || seen.has(it.code)) continue;       // kode ganda: yang pertama dipakai (master menampilkan peringatan)
    seen.add(it.code);
    out.push(it);
  }
  return out;
}

/* ---------- ambil teks CSV (dengan cache & hasil simpan yang belum ter-deploy) ---------- */
export function setPendingOps(text) { ls(PENDING_KEY, JSON.stringify({ t: Date.now(), text })); ls(CACHE_KEY, text); _p = null; }
export async function loadOpsText() {
  let text = null, err = null;
  try {
    const r = await fetch(OPS_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    text = await r.text();
  } catch (e) { err = e; }
  // hasil simpan dari halaman master dipakai sampai GitHub Pages selesai memperbarui file
  let pend = null; try { pend = JSON.parse(ls(PENDING_KEY) || 'null'); } catch (e) {}
  if (pend && pend.text) {
    if (text != null && text.replace(/\r/g, '') === pend.text.replace(/\r/g, '')) ls(PENDING_KEY, null);
    else if (Date.now() - pend.t < PENDING_TTL) text = pend.text;
    else ls(PENDING_KEY, null);
  }
  if (text != null) { ls(CACHE_KEY, text); return text; }
  text = ls(CACHE_KEY);
  if (!text) throw err || new Error('operation.csv tidak bisa dimuat');
  return text;
}

/* ---------- API ---------- */

// Ambil semua operation. Hasil disimpan di memori; jika offline memakai cache terakhir.
export function loadOps(force) {
  if (_p && !force) return _p;
  _p = loadOpsText().then(build, e => { _p = null; throw e; });
  return _p;
}

// Daftar untuk autocomplete: hanya yang aktif, dan bila department diisi hanya milik department itu.
export function opsForDept(list, dept) {
  const d = normDept(dept);
  return list.filter(it => it.active && (!d || !DEPTS.includes(d) || it.dept === d));
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
