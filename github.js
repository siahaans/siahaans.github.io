/* github.js - simpan master CSV sebagai commit GitHub (dipakai master-paddock / -operation / -unit)
 *   const {ghCfg, fileUrl, gh, ghErr, b64dec, b64enc, openGh} = createGithub({key:'ghCfgOps', path:'operation.csv', toast});
 * Dialog pengaturan (#dlgGh, #ghRepo, #ghBranch, #ghPath, #ghToken, #ghMsg, #bGh, #ghClose, #ghSave, #ghClear, #ghTest) ikut dipasang.
 * Token disimpan di localStorage browser ini saja ('ghToken'); gunakan fine-grained token khusus repo ini (Contents: read & write).
 */
import { ls, lsDel } from './util.js';

const $ = id => document.getElementById(id);
export const b64dec = s => new TextDecoder('utf-8', { ignoreBOM: true }).decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
export const b64enc = t => { const b = new TextEncoder().encode(t); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(s); };

export async function gh(method, url, body) {
  const t = ls('ghToken');
  if (!t) { const e = new Error('Token GitHub belum diisi.'); e.status = 0; throw e; }
  const r = await fetch('https://api.github.com' + url, { method, cache: 'no-store', headers: Object.assign({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + t }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || ('HTTP ' + r.status)); e.status = r.status; throw e; }
  return j;
}
export function ghErr(e) {
  if (e.status === 0) return 'Token GitHub belum diisi.';
  if (e.status === 401) return 'Token tidak valid atau sudah kedaluwarsa.';
  if (e.status === 403) return 'Token tidak punya izin (perlu Contents: Read and write) atau terkena batas permintaan GitHub.';
  if (e.status === 404) return 'Repo, branch, atau file tidak ditemukan, atau token tidak punya akses ke repo ini.';
  if (e.status === 409 || e.status === 422) return 'Konflik versi file di GitHub. Coba lagi.';
  return e.message || 'Gagal terhubung ke GitHub.';
}
export const fileUrl = c => '/repos/' + c.repo + '/contents/' + c.path.split('/').map(encodeURIComponent).join('/');

export function createGithub({ key, path, toast }) {
  const defaults = () => {
    let repo = ''; try { repo = (JSON.parse(ls('ghCfg') || '{}').repo) || ''; } catch (e) {}   // repo dibagi antar halaman master
    const h = location.hostname;
    if (!repo && /\.github\.io$/.test(h)) { const seg = location.pathname.split('/')[1] || ''; repo = h.split('.')[0] + '/' + ((seg && !seg.includes('.')) ? seg : h); }
    return { repo, branch: '', path };
  };
  const ghCfg = () => { let c = {}; try { c = JSON.parse(ls(key) || '{}'); } catch (e) {} return Object.assign(defaults(), c); };
  const readGh = () => ({ repo: $('ghRepo').value.trim(), branch: $('ghBranch').value.trim(), path: $('ghPath').value.trim() || path });
  const msgBox = (txt, color) => { $('ghMsg').style.color = color || ''; $('ghMsg').textContent = txt || ''; };

  function openGh(msg) {
    const c = ghCfg();
    $('ghRepo').value = c.repo; $('ghBranch').value = c.branch; $('ghPath').value = c.path; $('ghToken').value = ls('ghToken') || '';
    msgBox(msg, '#d33'); $('dlgGh').showModal();
  }
  $('bGh').onclick = () => openGh();
  $('ghClose').onclick = () => $('dlgGh').close();
  $('ghSave').onclick = () => {
    const c = readGh();
    if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo)) { msgBox('Repo harus berformat pemilik/nama, contoh: siahaans/siahaans.github.io', '#d33'); return; }
    ls(key, JSON.stringify(c)); const t = $('ghToken').value.trim(); if (t) ls('ghToken', t);
    $('dlgGh').close(); toast('Pengaturan GitHub tersimpan.');
  };
  $('ghClear').onclick = () => { lsDel('ghToken'); $('ghToken').value = ''; msgBox('Token dihapus dari browser ini.'); };
  $('ghTest').onclick = async () => {
    const c = readGh(); msgBox('Menguji...');
    const t = $('ghToken').value.trim(); if (t) ls('ghToken', t);
    try {
      const rp = await gh('GET', '/repos/' + c.repo);
      const f = await gh('GET', fileUrl(c) + (c.branch ? '?ref=' + encodeURIComponent(c.branch) : ''));
      const w = rp.permissions ? (rp.permissions.push ? 'akses tulis: ya' : 'akses tulis: TIDAK (token hanya baca)') : 'akses tulis: tidak diketahui';
      msgBox('Terhubung. File ' + f.path + ' ditemukan (' + f.size + ' byte), ' + w + '.', rp.permissions && !rp.permissions.push ? '#d33' : '#2ea043');
    } catch (e) { msgBox(ghErr(e), '#d33'); }
  };
  return { ghCfg, fileUrl, gh, ghErr, b64dec, b64enc, openGh };
}
