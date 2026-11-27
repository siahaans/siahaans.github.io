/* util.js - helper kecil yang dipakai bersama (sebelumnya disalin di banyak file)
 * Dipakai oleh: csv.js, paddock.js, operation.js, unit.js, timeline.js, summary.js, costing.js,
 *               firebase.js, github.js dan halaman master.
 */

/* localStorage yang aman: ls(k) baca, ls(k, v) tulis, ls(k, null) hapus */
export const ls = (k, v) => {
  try { return v === undefined ? localStorage.getItem(k) : (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)); } catch (e) {}
};
export const lsDel = k => ls(k, null);

/* huruf kecil tanpa spasi/tanda baca, untuk membandingkan nama */
export const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/* angka & teks */
export const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return isFinite(n) ? n : 0; };
export const has = s => String(s == null ? '' : s).trim() !== '';
export const okIso = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
export const pk = s => String(s || '').trim().toUpperCase();
export const clean = s => String(s || '').trim().replace(/\s*-\s*\d{5,}$/, '').replace(/\s{2,}/g, ' ');   // buang kode di belakang desc

// material per baris: format baru rows[i].mats = [{mat,dosis,keb,real,sat}], format lama vnama/vnik/vest/vhk
export const matsOf = r => Array.isArray(r.mats) ? r.mats.filter(m => has(m.mat) || has(m.keb) || has(m.real))
  : (has(r.vnama) || num(r.vest) || has(r.vhk) ? [{ mat: r.vnama, dosis: r.vnik, keb: r.vest, real: r.vhk, sat: '' }] : []);
