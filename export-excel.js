/* export-excel.js - export Work Order ke Excel (.xlsx)
 *
 * Tanpa library luar: file .xlsx ditulis langsung (ZIP + XML).
 *
 * Sheet 1 "Work Order": meniru cetakan PDF. Isi, urutan, gabungan sel (merge), warna,
 *          perataan, dan LEBAR KOLOM dibaca langsung dari tabel di halaman, jadi kalau
 *          Anda mengubah label/kolom di work-order.html, hasil Excel ikut berubah.
 * Sheet 2 "Timeline": hari x shift lengkap dengan kode warna (dari timeline.js).
 *
 * Pemakaian:
 *   exportWorkbook({root: elemenPaperWO, timeline: model, tlInfo: {title}, filename})
 */
import { SHIFTS, STATUS, cardLines, pillText, fmt, dayInfo } from './timeline.js';

/* ================= ZIP (tanpa kompresi) ================= */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const enc = new TextEncoder(), parts = [], cd = [];
  let off = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  files.forEach(f => {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, off, true);
    cd.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  });
  const cdSize = cd.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...cd, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ================= XLSX ================= */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

class Styles {
  constructor() {
    this.fonts = []; this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>']; this.nfs = []; this.xfs = []; this.cache = new Map();
    this.get({});   // gaya 0 = bawaan
  }
  idx(arr, x) { let i = arr.indexOf(x); if (i < 0) { arr.push(x); i = arr.length - 1; } return i; }
  get(o) {
    const key = JSON.stringify([o.sz || 9, !!o.b, !!o.i, o.color || '', o.fill || '', o.border || '', o.h || '', o.v || '', !!o.wrap, o.nf || '']);
    if (this.cache.has(key)) return this.cache.get(key);
    const font = this.idx(this.fonts, '<font>' + (o.b ? '<b/>' : '') + (o.i ? '<i/>' : '') + '<sz val="' + (o.sz || 9) + '"/><color rgb="FF' + (o.color || '000000') + '"/><name val="Arial"/></font>');
    const fill = o.fill ? this.idx(this.fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + o.fill + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
    const side = n => '<' + n + ' style="thin"><color rgb="FF222222"/></' + n + '>';
    const border = o.border === 'all' ? this.idx(this.borders, '<border>' + side('left') + side('right') + side('top') + side('bottom') + '<diagonal/></border>')
      : o.border === 'bottom' ? this.idx(this.borders, '<border><left/><right/><top/>' + side('bottom') + '<diagonal/></border>') : 0;
    let nf = 0;
    if (o.nf) { let i = this.nfs.indexOf(o.nf); if (i < 0) { this.nfs.push(o.nf); i = this.nfs.length - 1; } nf = 164 + i; }
    const al = '<alignment' + (o.h ? ' horizontal="' + o.h + '"' : '') + (o.v ? ' vertical="' + o.v + '"' : '') + (o.wrap ? ' wrapText="1"' : '') + '/>';
    const xf = '<xf numFmtId="' + nf + '" fontId="' + font + '" fillId="' + fill + '" borderId="' + border + '" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' + al + '</xf>';
    this.xfs.push(xf);
    const id = this.xfs.length - 1;
    this.cache.set(key, id);
    return id;
  }
  xml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (this.nfs.length ? '<numFmts count="' + this.nfs.length + '">' + this.nfs.map((f, i) => '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + esc(f) + '"/>').join('') + '</numFmts>' : '') +
      '<fonts count="' + this.fonts.length + '">' + this.fonts.join('') + '</fonts>' +
      '<fills count="' + this.fills.length + '">' + this.fills.join('') + '</fills>' +
      '<borders count="' + this.borders.length + '">' + this.borders.join('') + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + this.xfs.length + '">' + this.xfs.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }
}

class Sheet {
  constructor(name, st, opt) { this.name = name; this.st = st; this.opt = opt || {}; this.cells = new Map(); this.merges = []; this.cols = []; this.heights = new Map(); this.maxR = 1; this.maxC = 1; }
  set(r, c, v, style) {
    let row = this.cells.get(r); if (!row) { row = new Map(); this.cells.set(r, row); }
    row.set(c, { v, s: this.st.get(style || {}) });
    this.maxR = Math.max(this.maxR, r); this.maxC = Math.max(this.maxC, c);
  }
  merge(r1, c1, r2, c2, v, style) {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) this.set(r, c, r === r1 && c === c1 ? v : null, style);
    if (r1 !== r2 || c1 !== c2) this.merges.push(colName(c1) + r1 + ':' + colName(c2) + r2);
  }
  height(r, pt) { this.heights.set(r, Math.max(this.heights.get(r) || 0, Math.min(409, pt))); }
  cellXml(r, c, cell) {
    const ref = colName(c) + r, v = cell.v;
    if (v == null || v === '') return '<c r="' + ref + '" s="' + cell.s + '"/>';
    if (typeof v === 'number') return '<c r="' + ref + '" s="' + cell.s + '"><v>' + v + '</v></c>';
    if (Array.isArray(v)) {
      const runs = v.map(x => '<r><rPr>' + (x.b ? '<b/>' : '') + (x.i ? '<i/>' : '') + '<sz val="' + (x.sz || 9) + '"/><color rgb="FF' + (x.color || '000000') + '"/><rFont val="Arial"/></rPr><t xml:space="preserve">' + esc(clean(x.t)) + '</t></r>').join('');
      return '<c r="' + ref + '" s="' + cell.s + '" t="inlineStr"><is>' + runs + '</is></c>';
    }
    return '<c r="' + ref + '" s="' + cell.s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(clean(v)) + '</t></is></c>';
  }
  xml(first) {
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    x += '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:' + colName(this.maxC) + this.maxR + '"/>';
    x += '<sheetViews><sheetView workbookViewId="0" showGridLines="0"' + (first ? ' tabSelected="1"' : '') + '/></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
    x += '<cols>' + this.cols.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w.toFixed(2) + '" customWidth="1"/>').join('') + '</cols><sheetData>';
    [...this.cells.keys()].sort((a, b) => a - b).forEach(r => {
      const ht = this.heights.get(r);
      x += '<row r="' + r + '"' + (ht ? ' ht="' + ht.toFixed(1) + '" customHeight="1"' : '') + '>';
      const row = this.cells.get(r);
      [...row.keys()].sort((a, b) => a - b).forEach(c => { x += this.cellXml(r, c, row.get(c)); });
      x += '</row>';
    });
    x += '</sheetData>';
    if (this.merges.length) x += '<mergeCells count="' + this.merges.length + '">' + this.merges.map(m => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>';
    x += '<printOptions horizontalCentered="1"/><pageMargins left="0.31" right="0.31" top="0.31" bottom="0.31" header="0.1" footer="0.1"/>';
    x += '<pageSetup paperSize="9" orientation="' + (this.opt.landscape ? 'landscape' : 'portrait') + '" fitToWidth="1" fitToHeight="0"/></worksheet>';
    return x;
  }
}

class Workbook {
  constructor() { this.st = new Styles(); this.sheets = []; }
  add(name, opt) { const s = new Sheet(name, this.st, opt); this.sheets.push(s); return s; }
  toBlob() {
    const n = this.sheets.length, M = 'http://schemas.openxmlformats.org/', R = M + 'officeDocument/2006/relationships';
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + this.sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + R + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + M + 'spreadsheetml/2006/main" xmlns:r="' + R + '"><bookViews><workbookView/></bookViews><sheets>' + this.sheets.map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + this.sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + R + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (n + 1) + '" Type="' + R + '/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: '' }
    ];
    this.sheets.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: s.xml(i === 0) }));
    files[4].data = this.st.xml();   // gaya dibuat terakhir, setelah semua sel ditulis
    return zip(files);
  }
}

/* ================= membaca tabel di halaman ================= */
const TOTAL = 160;                      // total lebar kolom (satuan Excel)
const HDR = [0, 7, 8, 27, 33, 37, 47, 48, 63, 67, 100];       // batas kolom blok header (%)
const FOOT = [0, 18, 32, 49, 51, 67, 84, 100];                 // batas kolom blok footer (%)
const HEAD = { sz: 9, b: true, color: 'FFFFFF', fill: '1F3A73', h: 'center', v: 'center', border: 'all', wrap: true };
const CELL = { sz: 9, h: 'center', v: 'center', border: 'all', wrap: true };

function textOf(n) {
  let s = '';
  n.childNodes.forEach(c => {
    if (c.nodeType === 3) s += c.nodeValue;
    else if (c.nodeName === 'BR') s += '\n';
    else if (c.nodeType === 1 && !/^(INPUT|SELECT|BUTTON|SCRIPT)$/.test(c.nodeName)) s += textOf(c);
  });
  return s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}
function cellText(el) {
  const inp = el.querySelector('input[type=text],input[type=date]');
  return inp ? inp.value : textOf(el);
}
// angka ditulis sebagai angka Excel (bukan teks), dengan jumlah desimal yang sama seperti di layar
function parseVal(t) {
  t = String(t).trim();
  let m = /^(\d+(?:[.,]\d+)?)%$/.exec(t);
  if (m) { const dec = m[1].split(/[.,]/)[1]; return { v: parseFloat(m[1].replace(',', '.')) / 100, nf: dec ? '0.' + '0'.repeat(dec.length) + '%' : '0%' }; }
  m = /^-?\d+([.,]\d+)?$/.exec(t);
  if (!m || /^-?0\d/.test(t) || t.replace(/\D/g, '').length > 12) return { v: t };
  return { v: parseFloat(t.replace(',', '.')), nf: m[1] ? '0.' + '0'.repeat(m[1].length - 1) : null };
}
const fmtDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
function colBounds(table) {
  const w = [...table.querySelectorAll('colgroup col')].map(c => parseFloat(c.style.width) || 0);
  const tot = w.reduce((a, b) => a + b, 0) || 1; let acc = 0; const b = [0];
  w.forEach(x => { acc += x / tot * 100; b.push(Math.round(acc)); });
  b[b.length - 1] = 100;
  return b;
}
function lineCount(text, units, sz) {
  const cap = Math.max(4, units * (sz <= 8 ? 1.4 : 1.25));
  return String(text).split('\n').reduce((n, ln) => n + Math.max(1, Math.ceil(ln.length / cap)), 0);
}

function buildWorkOrderSheet(wb, root) {
  const ws = wb.add('Work Order', { landscape: false });
  const op = root.querySelector('#op'), uk = root.querySelector('#uk'), mp = root.querySelector('#mp');
  const bo = colBounds(op), bu = colBounds(uk), bm = colBounds(mp);
  const B = [...new Set([...bo, ...bu, ...bm, ...HDR, ...FOOT])].sort((a, b) => a - b);   // gabungan batas kolom semua blok
  const idx = p => B.indexOf(p);
  ws.cols = B.slice(0, -1).map((p, i) => (B[i + 1] - p) / 100 * TOTAL);
  const rng = (a, b) => [idx(a) + 1, Math.max(idx(a) + 1, idx(b))];
  const width = (a, b) => (b - a) / 100 * TOTAL;

  /* --- header --- */
  let r = 1;
  const kv = root.querySelector('.hd .kv:not(.f)'), kf = root.querySelector('.hd .kv.f');
  const labs = [...kv.querySelectorAll('b')].map(b => b.textContent), vals = [...kv.querySelectorAll('input,select')].map(e => e.value);
  labs.forEach((l, i) => {
    const row = r + i;
    let [c1, c2] = rng(0, 7); ws.merge(row, c1, row, c2, l, { sz: 9, b: true, v: 'center' });
    [c1, c2] = rng(7, 8); ws.merge(row, c1, row, c2, ':', { sz: 9, h: 'center', v: 'center' });
    [c1, c2] = rng(8, 27); ws.merge(row, c1, row, c2, vals[i] || '', { sz: 9, h: 'center', v: 'center', border: 'bottom' });
    ws.height(row, 16);
  });
  let [c1, c2] = rng(33, 67);
  ws.merge(r, c1, r, c2, root.querySelector('.hd h1').textContent, { sz: 13, b: true, h: 'center', v: 'center' });
  const fl = [...kf.querySelectorAll('b')].map(b => b.textContent), fv = [...kf.querySelectorAll('input')].map(e => fmtDate(e.value));
  fl.forEach((l, i) => {
    const row = r + 1 + i;
    let [a, b] = rng(37, 47); ws.merge(row, a, row, b, l, { sz: 9, b: true, v: 'center' });
    [a, b] = rng(47, 48); ws.merge(row, a, row, b, ':', { sz: 9, h: 'center', v: 'center' });
    [a, b] = rng(48, 63); ws.merge(row, a, row, b, fv[i] || '', { sz: 9, h: 'center', v: 'center', border: 'bottom' });
  });
  r += labs.length;
  ws.height(r, 6); r++;

  /* --- tabel --- */
  const addTable = (table, bounds) => {
    const trs = [...table.querySelectorAll('tr')].filter(tr => !tr.classList.contains('ctl') && !tr.hidden);
    const occ = trs.map(() => []);
    trs.forEach((tr, ri) => {
      let j = 0, lines = 1;
      [...tr.children].forEach(el => {
        while (occ[ri][j]) j++;
        const cs = el.colSpan || 1, rs = el.rowSpan || 1;
        for (let a = 0; a < rs; a++) for (let b = 0; b < cs; b++) if (occ[ri + a]) occ[ri + a][j + b] = true;
        const a1 = rng(bounds[j], bounds[j]), a2 = rng(bounds[j + cs - 1], bounds[j + cs]);
        const c1 = a1[0], c2 = Math.max(c1, a2[1]);
        const isTh = el.tagName === 'TH', text = cellText(el);
        let st, v = text;
        if (isTh) st = el.closest('.sig') ? { sz: 9, b: true, h: 'center', v: 'center', border: 'all', wrap: true } : HEAD;
        else {
          st = Object.assign({}, CELL);
          if (el.classList.contains('n')) st.fill = 'D9D9D9';
          if (el.classList.contains('t')) st.b = true;
          const p = parseVal(text); v = p.v; if (p.nf) st.nf = p.nf;
        }
        ws.merge(r + ri, c1, r + ri + rs - 1, c2, v, st);
        if (rs === 1) lines = Math.max(lines, lineCount(text, width(B[c1 - 1], B[c2]), 9));
        j += cs;
      });
      ws.height(r + ri, Math.max(17, lines * 11.5 + 5));
    });
    r += trs.length;
  };
  addTable(op, bo);
  ws.height(r, 7); r++;
  addTable(uk, bu);
  addTable(mp, bm);
  ws.height(r, 10); r++;

  /* --- footer: tanggal, lampiran, tanda tangan --- */
  const dt = [...root.querySelectorAll('.dt tr')].map(tr => [tr.children[0].textContent.trim(), fmtDate(tr.querySelector('input').value)]);
  const chk = [...root.querySelectorAll('.foot .chk')].map(d => ({ on: d.querySelector('input[type=checkbox]').checked, t: d.querySelector('span') ? d.querySelector('span').textContent : (d.querySelector('input.ln') || {}).value || '' }));
  const sig = [...root.querySelectorAll('.sig tr')];
  const sigH = [...sig[0].querySelectorAll('th')].map(t => t.textContent.trim()), sigN = [...sig[sig.length - 1].querySelectorAll('input')].map(i => i.value);
  const lab = (row, t, b = false) => { const [a, z] = rng(0, 49); ws.merge(row, a, row, z, t, { sz: 9, b, v: 'center' }); };
  const pair = (row, k, v) => {
    let [a, z] = rng(0, 18); ws.merge(row, a, row, z, k, { sz: 9, h: 'left', v: 'center', border: 'all' });
    [a, z] = rng(18, 32); ws.merge(row, a, row, z, v, { sz: 9, h: 'center', v: 'center', border: 'all' });
  };
  const sb = [51, 67, 84, 100];
  const A = r, B1 = r + 1, B3 = r + 3, C = r + 4;
  pair(A, dt[0][0], dt[0][1]); pair(B1, dt[1][0], dt[1][1]);
  lab(r + 2, 'Lampiran');
  lab(B3, (chk[0].on ? '\u2611 ' : '\u2610 ') + chk[0].t);
  lab(C, (chk[1].on ? '\u2611 ' : '\u2610 ') + chk[1].t);
  for (let i = 0; i < 3; i++) {
    const [a, z] = rng(sb[i], sb[i + 1]);
    ws.merge(A, a, A, z, sigH[i], { sz: 9, b: true, h: 'center', v: 'center', border: 'all' });
    ws.merge(B1, a, B3, z, '', { sz: 9, border: 'all' });
    ws.merge(C, a, C, z, sigN[i] || '', { sz: 9, h: 'center', v: 'center', border: 'all' });
  }
  [A, B1, B1 + 1, B3, C].forEach(x => ws.height(x, x >= B1 && x <= B3 ? 20 : 17));
  return ws;
}

/* ================= sheet Timeline ================= */
function buildTimelineSheet(wb, m, info) {
  info = info || {};
  const ws = wb.add('Timeline', { landscape: true });
  const nd = m.days.length, LW = 15, DW = 34;
  ws.cols = [LW].concat(m.days.map(() => DW));
  const last = nd + 1;
  let r = 1;
  const t = m.totals;
  ws.merge(r, 1, r, last, 'Timeline Work Order' + (info.title ? ' \u2013 ' + info.title : ''), { sz: 13, b: true, v: 'center' }); ws.height(r, 22); r++;
  ws.merge(r, 1, r, last,
    'Periode ' + dayInfo(m.start).long + ' \u2013 ' + dayInfo(m.end).long + '   |   Luas rencana ' + fmt(t.haPlan) + ' Ha, realisasi ' + fmt(t.haReal) + ' Ha' + (t.pct != null ? ' (' + Math.round(t.pct) + '%)' : '') +
    '   |   HK Support ' + fmt(t.hkPlan) + (t.hkReal ? ' (real ' + fmt(t.hkReal) + ')' : '') + '   |   HK Man Power ' + fmt(t.mpHk), { sz: 9, v: 'center' }); ws.height(r, 16); r += 2;

  // legenda kode warna
  const legend = (title, items) => {
    ws.set(r, 1, title, { sz: 9, b: true, v: 'center' });
    let c = 2;
    items.forEach(([label, hex]) => {
      if (c > last) { r++; c = 2; }
      ws.set(r, c, label, { sz: 8, b: true, color: 'FFFFFF', fill: hex, h: 'center', v: 'center', wrap: true, border: 'all' });
      if (label.length > 30) ws.height(r, 24);
      c++;
    });
    r++;
  };
  legend('Shift', m.lanes.map(l => [l.label, l.hex]));
  legend('Status', Object.keys(STATUS).map(k => [STATUS[k].label, STATUS[k].hex]));
  const palHex = c => c.replace('#', '').toUpperCase();
  legend('Aktivitas', m.acts.map(a => [a.name, palHex(a.color)]));
  r++;

  // header hari
  ws.set(r, 1, 'Shift / Hari', HEAD);
  m.days.forEach((d, i) => ws.set(r, i + 2, d.dow + '\n' + d.text + (d.today ? '\n(hari ini)' : ''), Object.assign({}, HEAD, { fill: d.today ? 'B58900' : d.weekend ? '8B2E2E' : '1F3A73' })));
  ws.height(r, m.days.some(d => d.today) ? 40 : 30); r++;

  // lajur shift
  m.lanes.forEach(l => {
    ws.set(r, 1, l.label, { sz: 10, b: true, color: 'FFFFFF', fill: l.hex, h: 'center', v: 'center', border: 'all', wrap: true });
    let maxLines = 2;
    m.days.forEach((d, i) => {
      const cards = l.cells[d.iso] || [], runs = []; let lines = 0;
      cards.forEach((c, k) => {
        if (k) { runs.push({ t: '\n\n', sz: 8 }); lines++; }
        runs.push({ t: c.name, b: true, color: palHex(c.color), sz: 9 });
        runs.push({ t: '  \u25CF ' + pillText(c), b: true, color: STATUS[c.status].hex, sz: 8 });
        const meta = (c.paddock || '\u2013') + ' \u00b7 baris #' + c.no;
        runs.push({ t: '\n' + meta, sz: 8, color: '57606A' });
        lines += lineCount(c.name + '  \u25CF ' + pillText(c), DW, 9) + lineCount(meta, DW, 8);
        cardLines(c).forEach(([k2, v]) => {
          runs.push({ t: '\n' + k2 + ': ', b: true, sz: 8, color: '57606A' });
          runs.push({ t: v, sz: 8 });
          lines += lineCount(k2 + ': ' + v, DW, 8);
        });
      });
      ws.set(r, i + 2, runs.length ? runs : '', { sz: 8, fill: l.tintHex, h: 'left', v: 'top', wrap: true, border: 'all' });
      maxLines = Math.max(maxLines, lines);
    });
    ws.height(r, Math.max(30, maxLines * 11 + 6));
    r++;
  });

  // ringkasan per hari
  const SUM = { sz: 9, h: 'center', v: 'center', wrap: true, border: 'all', fill: 'F6F8FA' };
  const srow = (label, fn) => {
    ws.set(r, 1, label, { sz: 9, b: true, fill: 'DDE3EC', h: 'center', v: 'center', wrap: true, border: 'all' });
    let mx = 1;
    m.days.forEach((d, i) => { const txt = fn(m.byDay[d.iso]); ws.set(r, i + 2, txt, SUM); mx = Math.max(mx, lineCount(txt, DW, 9)); });
    ws.height(r, Math.max(18, mx * 11.5 + 5));
    r++;
  };
  srow('Luas (Ha)', t2 => !t2.n ? '\u2013' : fmt(t2.haPlan) + ' rencana' + (t2.haReal ? '\n' + fmt(t2.haReal) + ' realisasi' + (t2.haPlan > 0 ? ' (' + Math.round(t2.haReal / t2.haPlan * 100) + '%)' : '') : ''));
  srow('HK Support', t2 => !t2.n || (!t2.hkPlan && !t2.hkReal) ? '\u2013' : fmt(t2.hkPlan) + (t2.hkReal ? ' \u2192 real ' + fmt(t2.hkReal) : ''));
  srow('HK Man Power', t2 => t2.mpHk ? fmt(t2.mpHk) : '\u2013');
  srow('Unit', t2 => t2.units.length ? t2.units.map(u => u.kode + (u.qty ? ' \u00d7' + fmt(u.qty) : '') + (u.hm ? ' \u00b7 ' + fmt(u.hm) + ' HM/Rit' : '')).join('\n') : '\u2013');
  srow('Material', t2 => t2.mats.length ? t2.mats.map(x => x.name + (x.need ? ' \u00b7 ' + fmt(x.need) : '') + (x.real ? ' \u2192 real ' + fmt(x.real) : '')).join('\n') : '\u2013');
  return ws;
}

/* ================= publik ================= */
export function exportWorkbook(o) {
  const wb = new Workbook();
  buildWorkOrderSheet(wb, o.root);
  if (o.timeline && o.timeline.cards && o.timeline.cards.length) buildTimelineSheet(wb, o.timeline, o.tlInfo);
  const blob = wb.toBlob();
  const name = String(o.filename || 'Work Order').replace(/[\\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Work Order';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name + '.xlsx';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  return blob;
}
