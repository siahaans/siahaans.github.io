/* unit.js - "otak" master data Unit & Implement/Gandengan
 * Sumber data : unit.csv  (pemisah ; , atau tab)
 *   Kolom yang dikenali : Tipe (Unit / Implement), Kode, Status (Aktif / Nonaktif)
 *   Kolom lain (mis. Jenis, nanti) ikut disimpan apa adanya dan tampil di "Kolom lainnya" pada master.
 *   Tipe     : "Unit" = kendaraan/alat (kode unit); "Implement" = gandengan yang menempel ke unit (nama).
 *              Tipe kosong = Unit.
 *   Status   : kosong = Aktif; Nonaktif tidak muncul di pilihan Work Order baru, tetapi WO lama tetap terbaca.
 * Dipakai oleh: work-order.html (pilihan unit & implement), master-unit.html (kelola master + simpan ke GitHub)
 *
 * Pemakaian:
 *   import {loadUnits, unitsOf, searchUnits, getUnit} from './unit.js';
 *   const list = await loadUnits();            // [{type:'unit'|'impl', code, active}]
 *   searchUnits(list, 'tr01', {type:'unit', limit:20});
 */

import { ls, norm } from './util.js';
import { detectDelim, parseCSV } from './csv.js';

export const UNIT_URL = 'unit.csv';
const CACHE_KEY = 'unitCsvCache';
const PENDING_KEY = 'unitCsvPending';          // hasil simpan terakhir dari halaman master (menunggu GitHub Pages)
const PENDING_TTL = 15 * 60 * 1000;
let _p = null;

export const TYPES = { unit: 'Unit', impl: 'Implement' };


// "Implement", "implemen", "Gandengan" -> 'impl' ; selain itu 'unit'
export const typeOf = s => /impl|gandeng|attach/i.test(String(s == null ? '' : s)) ? 'impl' : 'unit';
export const isInactive = s => /^(non\s*-?\s*aktif|tidak(\s*aktif)?|inactive|no|n|0|false)$/i.test(String(s == null ? '' : s).trim());

/* ---------- pemetaan header ---------- */
const KEYS = {
  type:   ['tipe', 'type', 'jenisdata'],
  code:   ['kode', 'kodeunit', 'nama', 'namaimplement', 'code'],
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
 * meta = {delim, bom, eol, header:[...], idx:{type,code,status}} ; rows = [[sel...], ...] */
export function parseUnitSource(text) {
  text = String(text == null ? '' : text);
  const bom = /^\uFEFF/.test(text); text = text.replace(/^\uFEFF/, '');
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const delim = detectDelim(text, [';', ',', '\t']);
  const all = parseCSV(text, delim);
  let header = all[0] || [], idx = mapHeader(header), rows = all.slice(1);
  if (idx.code === undefined) {                       // tanpa header: tipe, kode, status
    header = ['Tipe', 'Kode', 'Status']; idx = mapHeader(header); rows = all;
  }
  header = header.map(x => String(x).trim());
  if (idx.type === undefined) { header.unshift('Tipe'); rows = rows.map(r => ['Unit'].concat(r)); idx = mapHeader(header); }
  if (idx.status === undefined) { header.push('Status'); idx = mapHeader(header); }
  rows = rows.map(r => header.map((_, i) => String(r[i] == null ? '' : r[i])));
  return { meta: { delim: delim === ',' && !all.length ? ';' : delim, bom, eol, header, idx }, rows };
}
const q = (v, d) => /["\r\n]/.test(v) || v.includes(d) ? '"' + v.replace(/"/g, '""') + '"' : v;
export function serializeUnits(meta, rows) {
  const d = meta.delim || ';', eol = meta.eol || '\r\n';
  const line = r => meta.header.map((_, i) => q(String(r[i] == null ? '' : r[i]), d)).join(d);
  return (meta.bom ? '\uFEFF' : '') + [meta.header.map(h => q(h, d)).join(d)].concat(rows.map(line)).join(eol) + eol;
}

/* sel mentah -> item */
export function itemOf(meta, r) {
  const g = k => (meta.idx[k] === undefined ? '' : String(r[meta.idx[k]] == null ? '' : r[meta.idx[k]]).trim());
  const it = { type: typeOf(g('type')), code: g('code'), active: !isInactive(g('status')) };
  it._k = it.code.toLowerCase();
  return it;
}

// Kode yang muncul lebih dari sekali dalam tipe yang sama: [{type, code, n}]
export function findDuplicates(items) {
  const m = new Map();
  items.forEach(it => {
    if (!it.code) return;
    const k = it.type + '|' + it.code.toLowerCase();
    const e = m.get(k) || { type: it.type, code: it.code, n: 0 };
    e.n++; m.set(k, e);
  });
  return [...m.values()].filter(e => e.n > 1);
}

function build(text) {
  const { meta, rows } = parseUnitSource(text);
  const seen = new Set(), out = [];
  for (const r of rows) {
    const it = itemOf(meta, r);
    const k = it.type + '|' + it.code.toLowerCase();
    if (!it.code || seen.has(k)) continue;              // kode ganda: yang pertama dipakai (master menampilkan peringatan)
    seen.add(k); out.push({ type: it.type, code: it.code, active: it.active, _k: it._k });
  }
  return out;
}

/* ---------- ambil teks CSV (dengan cache & hasil simpan yang belum ter-deploy) ---------- */
export function setPendingUnits(text) { ls(PENDING_KEY, JSON.stringify({ t: Date.now(), text })); ls(CACHE_KEY, text); _p = null; }
export async function loadUnitText() {
  let text = null, err = null;
  try {
    const r = await fetch(UNIT_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    text = await r.text();
  } catch (e) { err = e; }
  let pend = null; try { pend = JSON.parse(ls(PENDING_KEY) || 'null'); } catch (e) {}
  if (pend && pend.text) {
    if (text != null && text.replace(/\r/g, '') === pend.text.replace(/\r/g, '')) ls(PENDING_KEY, null);
    else if (Date.now() - pend.t < PENDING_TTL) text = pend.text;
    else ls(PENDING_KEY, null);
  }
  if (text != null) { ls(CACHE_KEY, text); return text; }
  text = ls(CACHE_KEY);
  if (!text) throw err || new Error('unit.csv tidak bisa dimuat');
  return text;
}

/* ---------- API ---------- */

// Ambil semua unit & implement. Hasil disimpan di memori; jika offline memakai cache terakhir.
export function loadUnits(force) {
  if (_p && !force) return _p;
  _p = loadUnitText().then(build, e => { _p = null; throw e; });
  return _p;
}

// Daftar satu tipe ('unit' / 'impl'). Secara bawaan hanya yang aktif; all=true = termasuk nonaktif.
export const unitsOf = (list, type, all) => list.filter(it => (!type || it.type === type) && (all || it.active));

// Cari di kode. Beberapa kata = semua harus cocok. opts: {type, limit, all}
export function searchUnits(list, qs, opts) {
  opts = opts || {};
  const terms = String(qs || '').toLowerCase().split(/\s+/).filter(Boolean);
  let res = unitsOf(list, opts.type, opts.all).filter(it => terms.every(t => it._k.includes(t)));
  if (terms.length) {
    const t0 = terms[0];
    const sc = it => it._k === t0 ? 0 : it._k.startsWith(t0) ? 1 : 2;
    res = res.map((it, i) => ({ it, i, s: sc(it) })).sort((a, b) => a.s - b.s || a.i - b.i).map(x => x.it);
  }
  return opts.limit ? res.slice(0, opts.limit) : res;
}

// Cari persis berdasarkan kode (abaikan huruf besar/kecil, spasi, tanda baca). type opsional.
export function getUnit(list, code, type) {
  const n = norm(code);
  return n ? list.find(it => (!type || it.type === type) && norm(it.code) === n) || null : null;
}
