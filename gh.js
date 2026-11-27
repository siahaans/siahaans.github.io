/* gh.js — helper GitHub API */
import { ls } from "./fb.js";

const DEFAULTS = () => {
  let repo = '';
  try { repo = JSON.parse(ls('ghCfg') || '{}').repo || ''; } catch { /* ignore */ }
  const h = location.hostname;
  if (!repo && /\.github\.io$/.test(h)) {
    const seg = location.pathname.split('/')[1] || '';
    repo = h.split('.')[0] + '/' + (seg && !seg.includes('.') ? seg : h);
  }
  return { repo, branch: '', path: '' };
};

export function ghCfg(key = 'ghCfgOps') {
  let c = {};
  try { c = JSON.parse(ls(key) || '{}'); } catch { /* ignore */ }
  return Object.assign(DEFAULTS(), c);
}

const fileUrl = (cfg, path) =>
  '/repos/' + cfg.repo + '/contents/' + (path || cfg.path).split('/').map(encodeURIComponent).join('/');

const b64dec = s => new TextDecoder('utf-8', { ignoreBOM: true })
  .decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const b64enc = t => {
  const b = new TextEncoder().encode(t);
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return btoa(s);
};

export async function gh(method, url, body) {
  const t = ls('ghToken');
  if (!t) { const e = new Error('Token GitHub belum diisi.'); e.status = 0; throw e; }
  const r = await fetch('https://api.github.com' + url, {
    method, cache: 'no-store',
    headers: Object.assign(
      { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + t },
      body ? { 'Content-Type': 'application/json' } : {}
    ),
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || 'HTTP ' + r.status); e.status = r.status; throw e; }
  return j;
}

export function ghErr(e) {
  if (!e) return 'Gagal terhubung ke GitHub.';
  if (e.status === 0)   return 'Token GitHub belum diisi.';
  if (e.status === 401) return 'Token tidak valid atau sudah kedaluwarsa.';
  if (e.status === 403) return 'Token tidak punya izin (perlu Contents: Read and write) atau kena batas GitHub.';
  if (e.status === 404) return 'Repo, branch, atau file tidak ditemukan.';
  if (e.status === 409 || e.status === 422) return 'Konflik versi file di GitHub. Coba lagi.';
  return e.message || 'Gagal terhubung ke GitHub.';
}

export async function ghReadFile(cfg, path) {
  const f = await gh('GET', fileUrl(cfg, path) + (cfg.branch ? '?ref=' + encodeURIComponent(cfg.branch) : ''));
  return { text: b64dec(f.content), sha: f.sha, path: f.path, size: f.size };
}

export async function ghWriteFile(cfg, path, text, message, sha) {
  return gh('PUT', fileUrl(cfg, path), Object.assign(
    { message, content: b64enc(text), sha },
    cfg.branch ? { branch: cfg.branch } : {}
  ));
}