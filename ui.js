/* ui.js — helpers UI bersama: format, toast, empty state, ikon, top bar */
export const fmtRp   = n => (n < 0 ? '-' : '') + 'Rp ' + Math.round(Math.abs(n || 0)).toLocaleString('id-ID');
export const fmtNum  = n => Number(n || 0).toLocaleString('id-ID');
export const fmtDate = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
};

let toastEl;
export function toast(text, ms = 3500) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'app-toast';
    toastEl.hidden = true;
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.hidden = true; }, ms);
}

export function emptyState(el, { icon = '📄', title = 'Tidak ada data', sub = '', action } = {}) {
  el.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  wrap.innerHTML = `<div class="empty-ic">${icon}</div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn pri';
    b.textContent = action.label;
    b.onclick = action.onClick;
    wrap.appendChild(b);
  }
  el.appendChild(wrap);
}

const ICONS = {
  home:   '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  plus:   '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
};
export function icon(name, size = 18) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

export function mountTopbar(container, { email = '', onLogout, links = [] } = {}) {
  container.replaceChildren();
  container.className = 'topbar';

  const brand = document.createElement('a');
  brand.href = 'index.html';
  brand.className = 'brand';
  brand.innerHTML = '<span class="brand-logo">WO</span><b>GPA</b>';
  container.appendChild(brand);

  const nav = document.createElement('nav');
  nav.className = 'nav';
  links.forEach(l => {
    const a = document.createElement('a');
    a.href = l.href || '#';
    a.textContent = l.label;
    if (l.active) a.className = 'on';
    nav.appendChild(a);
  });
  container.appendChild(nav);

  const right = document.createElement('div');
  right.className = 'topbar-right';
  if (email) { const e = document.createElement('span'); e.className = 'who'; e.textContent = email; right.appendChild(e); }
  if (onLogout) {
    const b = document.createElement('button');
    b.className = 'btn sm';
    b.innerHTML = icon('logout', 14) + ' Keluar';
    b.onclick = onLogout;
    right.appendChild(b);
  }
  container.appendChild(right);
}