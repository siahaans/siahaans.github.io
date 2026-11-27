/* costing.js - Costing Work Order: Man Power, Unit (VRA), Material  (Rencana vs Realisasi)
 *
 * Dipakai oleh work-order.html (tab "Costing"). Pengaturan harga disimpan di Firestore: config/costing.
 *
 * Rumus:
 *  Base HK        = UMP / pembagi (25)
 *  Man Power      = (HK Support + Operator) x Base HK + Premi.   Operator = Jlh Unit/Opt (1 HK per unit/operator per shift,
 *                   bisa dimatikan di Setting).
 *  Premi          = jika output (Ha per operator) >= Standar:  operator x Premi tercapai + (Ha - Standar x operator) x Premi lebih
 *  Unit           = HM x Harga VRA per model unit (Rp/HM)           (HM = Est HM/KM/Rit; realisasi = Realisasi HM/Rit)
 *  Material       = Total Kebutuhan / Realisasi x Harga material
 *  Realisasi dibandingkan dengan "target s.d. hari ini" (rencana baris yang sudah jatuh tempo atau sudah direalisasi).
 */
import { SHIFTS, fmt, dayInfo } from './timeline.js';
import { num, has, okIso, pk, clean, matsOf } from './util.js';

export const rp = n => (n < 0 ? '-' : '') + 'Rp ' + Math.round(Math.abs(n || 0)).toLocaleString('id-ID');

export const defaultCosting = () => ({ ump: 0, divisor: 25, opAsHk: true, premi: { def: { standar: 0, tetap: 0, lebih: 0 }, items: [] }, vra: [], pupuk: [] });
export const mergeCosting = s => {
  const d = defaultCosting(); s = s || {};
  return { ump: num(s.ump), divisor: s.divisor > 0 ? +s.divisor : 25, opAsHk: s.opAsHk !== false,
    premi: { def: Object.assign(d.premi.def, s.premi && s.premi.def), items: (s.premi && s.premi.items) || [] }, vra: s.vra || [], pupuk: s.pupuk || [] };
};

/* ---------- model ---------- */
export function buildCosting(o) {
  const S = mergeCosting(o.settings), today = o.today || '', start = okIso(o.start) ? o.start : '';
  const base = S.ump / S.divisor;
  const vra = new Map(S.vra.map(x => [pk(x.nama), num(x.harga)])), pup = new Map(S.pupuk.map(x => [pk(x.nama), num(x.harga)]));
  const rule = c => S.premi.items.find(x => has(x.kode) && pk(x.kode) === pk(c)) || S.premi.def;
  const prem = (ru, ops, ha) => {
    const std = num(ru.standar);
    if (!(std > 0) || ops <= 0) return { out: ops > 0 ? ha / ops : 0, amt: 0, hit: false };
    const out = ha / ops;
    return out + 1e-9 < std ? { out, amt: 0, hit: false } : { out, hit: true, amt: ops * num(ru.tetap) + Math.max(0, ha - std * ops) * num(ru.lebih) };
  };
  const T = () => ({ p: 0, pd: 0, r: 0, n: 0 });
  const tot = { mp: T(), un: T(), ma: T(), all: T() };
  const add = (k, p, r, e, due) => { [tot[k], tot.all].forEach(t => { t.p += p; if (due || e) t.pd += p; if (e) { t.r += r; t.n++; } }); };
  const rows = [], miss = { un: new Set(), ma: new Set() }, names = { codes: new Map(), units: new Set(), mats: new Set() };
  let haP = 0, haR = 0;

  (o.rows || []).forEach((r, i) => {
    const ms = matsOf(r);
    if (!['open', 'close', 'hk', 'uom', 'ukode', 'unik', 'unama', 'uest', 'uhk'].some(k => has(r[k])) && !ms.length) return;
    const iso = okIso(r.date) ? r.date : start, shift = [1, 2, 3].includes(+r.shift) ? +r.shift : 0, due = !!(iso && today && iso <= today);
    const it = { no: i + 1, iso, shift, name: clean(r.desc) || String(r.code || '').trim() || '(tanpa aktivitas)', paddock: String(r.paddock || '').trim() || '\u2013' };
    haP += num(r.open); haR += num(r.close);
    if (has(r.code)) names.codes.set(pk(r.code), { kode: String(r.code).trim(), nama: clean(r.desc) });

    // man power
    if (['hk', 'uom', 'unik', 'unama'].some(k => has(r[k]))) {
      const ru = rule(r.code), opsP = num(r.unik), opsR = num(r.unama), e = has(r.uom) || has(r.unama);
      const pP = prem(ru, opsP, num(r.open)), pR = prem(ru, opsR, num(r.close));
      const dP = num(r.hk) + (S.opAsHk ? opsP : 0), dR = num(r.uom) + (S.opAsHk ? opsR : 0);
      it.mp = { hkP: num(r.hk), hkR: num(r.uom), opsP, opsR, std: num(ru.standar), outP: pP.out, outR: pR.out, hit: pR.hit, premiR: pR.amt, e,
        costP: dP * base + pP.amt, costR: dR * base + pR.amt };
      add('mp', it.mp.costP, it.mp.costR, e, due);
    }
    // unit (VRA)
    if (has(r.ukode) || num(r.uest) || num(r.uhk)) {
      const k = String(r.ukode || '').trim() || '(unit)', price = vra.get(pk(k)), e = has(r.uhk);
      if (price == null) miss.un.add(k); names.units.add(k);
      it.un = { kode: k, hmP: num(r.uest), hmR: num(r.uhk), price: price || 0, e, costP: num(r.uest) * (price || 0), costR: num(r.uhk) * (price || 0) };
      add('un', it.un.costP, it.un.costR, e, due);
    }
    // material
    if (ms.length) it.ma = ms.map(m => {
      const k = String(m.mat || '').trim() || '(material)', price = pup.get(pk(k)), e = has(m.real);
      if (price == null) miss.ma.add(k); names.mats.add(k);
      const q = { name: k, sat: m.sat || '', dosis: String(m.dosis || '').trim(), qP: num(m.keb), qR: num(m.real), price: price || 0, e, costP: num(m.keb) * (price || 0), costR: num(m.real) * (price || 0) };
      add('ma', q.costP, q.costR, e, due);
      return q;
    });
    rows.push(it);
  });
  rows.sort((a, b) => (a.iso || '9999').localeCompare(b.iso || '9999') || [1, 2, 3, 0].indexOf(a.shift) - [1, 2, 3, 0].indexOf(b.shift) || a.no - b.no);
  return { S, base, rows, tot, ha: { p: haP, r: haR }, miss: { un: [...miss.un], ma: [...miss.ma] },
    names: { codes: [...names.codes.values()], units: [...names.units], mats: [...names.mats] } };
}

/* ---------- gaya (disisipkan sekali) ---------- */
function injectCss() {
  if (document.getElementById('cs-style')) return;
  const st = document.createElement('style'); st.id = 'cs-style';
  st.textContent = `
.cs-top{display:flex;align-items:center;gap:10px;margin-bottom:10px}.cs-top h2{flex:1;margin:0;font-size:18px}
.cs-btn{padding:7px 14px;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:6px;cursor:pointer;font:inherit}
.cs-btn.pri{background:var(--head);color:#fff;border-color:var(--head)}.cs-btn:disabled{opacity:.5;cursor:not-allowed}
.cs-warn{border:1px solid #d4a72c;background:rgba(212,167,44,.12);border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12px}
.cs-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-bottom:16px}
.cs-k{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--grey)}
.cs-k small{display:block;color:#7a8294;font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.cs-k b{display:block;font-size:20px;margin:2px 0}.cs-k span{display:block;font-size:11px;color:#7a8294}
.cs-k .up{color:#cf222e}.cs-k .dn{color:#2da44e}.cs-k.tot{border-color:var(--head);background:var(--paper)}
.cs-pn{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:14px}
.cs-pn h3{margin:0 0 6px;font-size:14px}.cs-sc{overflow-x:auto}
.cs-t{width:100%;border-collapse:collapse;font-size:12px;min-width:760px}
.cs-t th{background:var(--head);color:#fff;padding:5px 7px;text-align:left;font-size:11px}
.cs-t td{border-bottom:1px solid var(--line);padding:4px 7px;vertical-align:top}.cs-t .r{text-align:right;white-space:nowrap}
.cs-t tr.tt td{font-weight:700;background:var(--grey)}.cs-t .mu{color:#7a8294}.cs-t .hit{color:#2da44e;font-weight:700}.cs-t .nop{color:#cf222e}
.cs-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100;display:flex;justify-content:center;align-items:flex-start;overflow:auto;padding:20px 10px}
.cs-md{background:var(--paper);color:var(--ink);width:min(920px,100%);border-radius:12px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.cs-md h3{margin:16px 0 4px;font-size:14px;border-bottom:2px solid var(--line);padding-bottom:4px}.cs-md h2{margin:0}
.cs-md .hint{font-size:11px;color:#7a8294;margin:2px 0 6px}
.cs-md table{width:100%;border-collapse:collapse;font-size:12px}.cs-md th{text-align:left;font-size:10px;color:#7a8294;padding:2px 4px}
.cs-md td{padding:2px 3px}.cs-md input[type=text],.cs-md input[type=number]{width:100%;padding:6px;border:1px solid var(--line);border-radius:5px;background:var(--paper);color:var(--ink);font:inherit}
.cs-md .row{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:6px 0}.cs-md .row label{display:flex;align-items:center;gap:6px}.cs-md .row input[type=number]{width:140px}
.cs-md .acts{display:flex;gap:8px;margin-top:6px}.cs-md .foot{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;align-items:center}
@media print{.cs-ov{display:none}}`;
  document.head.appendChild(st);
}

function h(tag, cls, text, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/* ---------- jendela Setting ---------- */
function openSettings(S0, canEdit, names, onSave) {
  injectCss();
  const w = JSON.parse(JSON.stringify(mergeCosting(S0)));
  const ov = h('div', 'cs-ov', null, document.body), box = h('div', 'cs-md', null, ov), body = h('div', null, null, box);
  const close = () => ov.remove();
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });

  const field = (parent, obj, k, type, ph) => {
    const i = h('input', null, null, parent); i.type = type; i.disabled = !canEdit; if (ph) i.placeholder = ph;
    i.value = obj[k] == null ? '' : obj[k];
    i.oninput = () => { obj[k] = type === 'number' ? (i.value === '' ? 0 : +i.value) : i.value; if (obj === w) upd(); };
    return i;
  };
  let baseEl;
  const upd = () => { if (baseEl) baseEl.textContent = rp(w.divisor > 0 ? w.ump / w.divisor : 0) + ' per HK'; };

  function list(title, hint, arr, cols, blank, wo) {
    h('h3', null, title, body); h('div', 'hint', hint, body);
    const tb = h('table', null, null, body), hr = h('tr', null, null, h('thead', null, null, tb));
    cols.forEach(c => h('th', null, c[1], hr)); h('th', null, '', hr);
    const tbd = h('tbody', null, null, tb);
    arr.forEach((it, idx) => {
      const tr = h('tr', null, null, tbd);
      cols.forEach(c => field(h('td', null, null, tr), it, c[0], c[2]));
      const d = h('button', 'cs-btn', '\u00d7', h('td', null, null, tr)); d.disabled = !canEdit; d.onclick = () => { arr.splice(idx, 1); draw(); };
    });
    const a = h('div', 'acts', null, body);
    const add = h('button', 'cs-btn', '+ Tambah', a); add.disabled = !canEdit; add.onclick = () => { arr.push(Object.assign({}, blank)); draw(); };
    const fw = h('button', 'cs-btn', 'Ambil dari WO ini', a); fw.disabled = !canEdit;
    fw.onclick = () => { wo(arr); draw(); };
  }

  function draw() {
    body.textContent = '';
    h('h2', null, '\u2699 Setting Costing', body);
    if (!canEdit) h('div', 'cs-warn', 'Anda hanya bisa melihat. Hanya admin yang dapat menyimpan perubahan.', body);

    h('h3', null, '1. Base HK', body); h('div', 'hint', 'Base HK = UMP \u00f7 pembagi hari kerja.', body);
    const r1 = h('div', 'row', null, body);
    const l1 = h('label', null, 'UMP (Rp/bulan)', r1); field(l1, w, 'ump', 'number');
    const l2 = h('label', null, 'Pembagi (hari)', r1); field(l2, w, 'divisor', 'number');
    const l3 = h('label', null, 'Base HK = ', r1); baseEl = h('b', null, null, l3); upd();
    const r2 = h('div', 'row', null, body), l4 = h('label', null, null, r2), ck = h('input', null, null, l4);
    ck.type = 'checkbox'; ck.checked = w.opAsHk; ck.disabled = !canEdit; ck.onchange = () => { w.opAsHk = ck.checked; };
    l4.append(' Operator (Jlh Unit/Opt) dihitung sebagai HK = Base HK per unit per shift');

    h('h3', null, '2. Premi operator (berbasis output)', body);
    h('div', 'hint', 'Jika output (Ha per operator per shift) mencapai atau melebihi Standar, operator mendapat: Premi tercapai (Rp per operator) + Premi lebih (Rp per Ha di atas standar). Isi 0 jika tidak dipakai.', body);
    const rd = h('div', 'row', null, body); h('b', null, 'Aturan bawaan (aktivitas yang tidak terdaftar):', rd);
    [['standar', 'Standar Ha/opr'], ['tetap', 'Premi tercapai Rp'], ['lebih', 'Premi lebih Rp/Ha']].forEach(([k, t]) => { const l = h('label', null, t, rd); field(l, w.premi.def, k, 'number'); });
    list('Aturan per aktivitas (Op Code)', 'Aturan di sini menggantikan aturan bawaan untuk Op Code yang sama.', w.premi.items,
      [['kode', 'Op Code', 'text'], ['nama', 'Aktivitas', 'text'], ['standar', 'Standar (Ha/opr/shift)', 'number'], ['tetap', 'Premi tercapai (Rp/opr)', 'number'], ['lebih', 'Premi lebih (Rp/Ha)', 'number']],
      { kode: '', nama: '', standar: 0, tetap: 0, lebih: 0 },
      arr => names.codes.forEach(c => { if (!arr.some(x => pk(x.kode) === pk(c.kode))) arr.push({ kode: c.kode, nama: c.nama, standar: 0, tetap: 0, lebih: 0 }); }));
    box.querySelectorAll('h3').forEach(x => { if (x.textContent === 'Aturan per aktivitas (Op Code)') x.style.borderBottom = '0'; });

    list('3. VRA per model unit', 'Harga sewa/pakai unit, Rupiah per HM. Nama harus sama dengan Kode Unit di tabel Unit Kerja.', w.vra,
      [['nama', 'Model / Kode Unit', 'text'], ['harga', 'Rp per HM', 'number']], { nama: '', harga: 0 },
      arr => names.units.forEach(n => { if (!arr.some(x => pk(x.nama) === pk(n))) arr.push({ nama: n, harga: 0 }); }));

    list('4. Harga pupuk / material', 'Rupiah per satuan (misalnya per kg atau per liter), sama dengan satuan di kolom Total Kebutuhan. Nama harus sama dengan kolom Material.', w.pupuk,
      [['nama', 'Material', 'text'], ['satuan', 'Satuan', 'text'], ['harga', 'Rp per satuan', 'number']], { nama: '', satuan: '', harga: 0 },
      arr => names.mats.forEach(n => { if (!arr.some(x => pk(x.nama) === pk(n))) arr.push({ nama: n, satuan: '', harga: 0 }); }));

    const f = h('div', 'foot', null, body);
    const msg = h('span', 'hint', '', f);
    h('button', 'cs-btn', canEdit ? 'Batal' : 'Tutup', f).onclick = close;
    if (canEdit) {
      const sv = h('button', 'cs-btn pri', 'Simpan', f);
      sv.onclick = async () => {
        sv.disabled = true; msg.textContent = 'Menyimpan...';
        try { await onSave(mergeCosting(w)); close(); }
        catch (e) { msg.textContent = 'Gagal menyimpan: ' + (e.code || e.message) + (e.code === 'permission-denied' ? ' (cek Rules: config hanya boleh ditulis admin)' : ''); sv.disabled = false; }
      };
    }
  }
  draw();
}

/* ---------- tampilan ---------- */
const pair = (p, r, e, unit) => fmt(p) + (unit || '') + ' \u2192 ' + (e ? fmt(r) + (unit || '') : '\u2013');
const lbl = it => (it.iso ? dayInfo(it.iso).text : '\u2013') + ' \u00b7 ' + (it.shift ? 'S' + it.shift : '-');
function kpi(parent, title, t, cls) {
  const k = h('div', 'cs-k' + (cls ? ' ' + cls : ''), null, parent);
  h('small', null, title, k); h('b', null, t.n ? rp(t.r) : '\u2013', k);
  h('span', null, 'Rencana ' + rp(t.p) + (t.pd < t.p ? ' \u00b7 target s.d. hari ini ' + rp(t.pd) : ''), k);
  if (t.n && t.pd > 0) {
    const d = t.r - t.pd, p = d / t.pd * 100;
    h('span', d > 0 ? 'up' : 'dn', (d > 0 ? 'Lebih ' : 'Hemat ') + rp(Math.abs(d)) + ' (' + (d > 0 ? '+' : '') + Math.round(p * 10) / 10 + '%)', k);
  } else h('span', null, t.n ? '' : 'Belum ada realisasi', k);
}
function table(parent, title, head, data, tot) {
  const pn = h('div', 'cs-pn', null, parent); h('h3', null, title, pn);
  if (!data.length) { h('div', 'mu', 'Tidak ada data.', pn); return; }
  const sc = h('div', 'cs-sc', null, pn), tb = h('table', 'cs-t', null, sc);
  const hr = h('tr', null, null, h('thead', null, null, tb));
  head.forEach((x, i) => h('th', x[1] ? 'r' : null, x[0], hr));
  const bd = h('tbody', null, null, tb);
  data.forEach(cells => { const tr = h('tr', null, null, bd); cells.forEach((c, i) => { const td = h('td', head[i][1] ? 'r' : null, c.t != null ? c.t : c, tr); if (c.c) td.className += ' ' + c.c; }); });
  const tr = h('tr', 'tt', null, bd);
  head.forEach((x, i) => h('td', x[1] ? 'r' : null, i === 0 ? 'Total' : (tot[i] != null ? tot[i] : ''), tr));
}

export function renderCosting(el, m, info, opt) {
  injectCss(); info = info || {}; opt = opt || {};
  el.textContent = '';
  const root = h('div', 'tl cs', null, el);
  const top = h('div', 'cs-top', null, root);
  h('h2', null, 'Costing' + (info.title ? ' \u00b7 ' + info.title : ''), top);
  const sb = h('button', 'cs-btn pri', '\u2699 Setting', top);
  sb.onclick = () => openSettings(opt.settings, !!opt.canEdit, m.names, opt.onSave);

  const warn = [];
  if (!(m.base > 0)) warn.push('Base HK belum diatur (isi UMP di Setting).');
  if (m.miss.un.length) warn.push('VRA belum diatur: ' + m.miss.un.join(', ') + '.');
  if (m.miss.ma.length) warn.push('Harga material belum diatur: ' + m.miss.ma.join(', ') + '.');
  if (warn.length) h('div', 'cs-warn', warn.join(' ') + ' Biaya item tersebut dihitung Rp 0 sampai harga diisi.', root);
  if (!m.rows.length) { h('p', 'tl-empty', 'Belum ada data. Isi rencana dan realisasi pada tab Work Order.', root); return; }

  const kp = h('div', 'cs-kpi', null, root);
  kpi(kp, 'Man Power', m.tot.mp); kpi(kp, 'Unit (VRA)', m.tot.un); kpi(kp, 'Material', m.tot.ma); kpi(kp, 'Total Biaya', m.tot.all, 'tot');
  const ph = m.ha.p > 0 ? m.tot.all.p / m.ha.p : 0, rh = m.ha.r > 0 ? m.tot.all.r / m.ha.r : 0;
  const kh = h('div', 'cs-k', null, kp); h('small', null, 'Biaya per Hektar', kh);
  h('b', null, m.ha.r > 0 && m.tot.all.n ? rp(rh) : '\u2013', kh); h('span', null, 'Rencana ' + (ph ? rp(ph) : '\u2013') + ' per Ha', kh);
  h('span', null, 'Base HK ' + rp(m.base), kh);

  // Man Power
  const mp = m.rows.filter(x => x.mp);
  table(root, '\ud83d\udc77 Man Power  (Base HK ' + rp(m.base) + ')', [['Hari \u00b7 Shift'], ['Aktivitas \u00b7 Paddock'], ['HK Support', 1], ['Operator', 1], ['Output Ha/opr (std)', 1], ['Premi Realisasi', 1], ['Biaya Rencana', 1], ['Biaya Realisasi', 1]],
    mp.map(x => { const q = x.mp; return [lbl(x), x.name + ' \u00b7 ' + x.paddock, pair(q.hkP, q.hkR, q.e), pair(q.opsP, q.opsR, q.e),
      { t: (q.opsR ? fmt(q.outR) : '\u2013') + (q.std ? ' (' + fmt(q.std) + ')' : ''), c: q.e && q.std ? (q.hit ? 'hit' : 'nop') : '' },
      { t: q.e ? (q.premiR ? rp(q.premiR) + ' \u2713' : rp(0)) : '\u2013', c: q.hit ? 'hit' : '' }, rp(q.costP), q.e ? rp(q.costR) : '\u2013']; }),
    { 6: rp(m.tot.mp.p), 7: m.tot.mp.n ? rp(m.tot.mp.r) : '\u2013' });
  // Unit
  table(root, '\ud83d\ude9c Unit (VRA per HM)', [['Hari \u00b7 Shift'], ['Aktivitas \u00b7 Paddock'], ['Unit'], ['HM', 1], ['VRA Rp/HM', 1], ['Biaya Rencana', 1], ['Biaya Realisasi', 1]],
    m.rows.filter(x => x.un).map(x => { const q = x.un; return [lbl(x), x.name + ' \u00b7 ' + x.paddock, q.kode, pair(q.hmP, q.hmR, q.e), q.price ? rp(q.price) : { t: 'belum diatur', c: 'nop' }, rp(q.costP), q.e ? rp(q.costR) : '\u2013']; }),
    { 5: rp(m.tot.un.p), 6: m.tot.un.n ? rp(m.tot.un.r) : '\u2013' });
  // Material
  table(root, '\ud83e\uddea Material', [['Hari \u00b7 Shift'], ['Aktivitas \u00b7 Paddock'], ['Material'], ['Kebutuhan', 1], ['Harga/satuan', 1], ['Biaya Rencana', 1], ['Biaya Realisasi', 1]],
    m.rows.filter(x => x.ma).flatMap(x => x.ma.map(q => [lbl(x), x.name + ' \u00b7 ' + x.paddock, q.name + (q.dosis ? ' \u00b7 dosis ' + q.dosis : ''), pair(q.qP, q.qR, q.e, q.sat ? ' ' + q.sat : ''), q.price ? rp(q.price) : { t: 'belum diatur', c: 'nop' }, rp(q.costP), q.e ? rp(q.costR) : '\u2013'])),
    { 5: rp(m.tot.ma.p), 6: m.tot.ma.n ? rp(m.tot.ma.r) : '\u2013' });
  h('p', 'tl-note', 'Selisih dibandingkan dengan target s.d. hari ini (rencana baris yang sudah jatuh tempo atau sudah direalisasi). Operator dihitung 1 HK per unit per shift' + (m.S.opAsHk ? '.' : ' (dimatikan di Setting).'), root);
}
