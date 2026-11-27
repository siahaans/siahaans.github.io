/* csv.js - pembaca CSV bersama (koma / titik koma / tab, tanda kutip, BOM)
 * Dipakai oleh: paddock.js, operation.js, unit.js
 */

// Tebak pemisah dari baris pertama. order = urutan prioritas jika jumlahnya sama.
export function detectDelim(text, order) {
  const first = String(text).split(/\r?\n/, 1)[0] || '';
  const count = c => first.split(c).length - 1;
  return (order || [',', ';', '\t']).reduce((a, b) => (count(b) > count(a) ? b : a));
}

export function parseCSV(text, d) {
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
