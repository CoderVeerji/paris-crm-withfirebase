/** rows -> CSV string. Har cell quote hota hai agar usme comma / quote / newline ho. */
export function toCsv(headers, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  rows.forEach((r) => lines.push(r.map(esc).join(',')));
  return lines.join('\n');
}

/** CSV file download trigger karo (browser). */
export function downloadCsv(filename, headers, rows) {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Multi-tab Excel file (SpreadsheetML 2003 — koi library nahi). Excel ise 2 tabs ke saath kholta hai.
 *  sheets = [{ name, headers, rows }]  (rows me [] = khaali line). */
export function downloadXlsx(filename, sheets) {
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    const num = s !== '' && !Number.isNaN(Number(s)) && /^-?\d+(\.\d+)?$/.test(s);
    return `<Cell><Data ss:Type="${num ? 'Number' : 'String'}">${esc(s)}</Data></Cell>`;
  };
  const sheetXml = (sh) => {
    const rows = [sh.headers, ...sh.rows].map((r) => (
      Array.isArray(r) && r.length ? `<Row>${r.map(cell).join('')}</Row>` : '<Row/>'
    )).join('');
    return `<Worksheet ss:Name="${esc(sh.name)}"><Table>${rows}</Table></Worksheet>`;
  };
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>`
    + `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`
    + sheets.map(sheetXml).join('') + `</Workbook>`;
  const blob = new Blob(['﻿' + xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename.replace(/\.csv$/, '') + '.xls';
  document.body.appendChild(a); a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Chhota CSV parser — quoted fields, embedded newlines/commas handle karta hai.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** header row se column index map. common naam samajh leta hai. */
export function mapColumns(header) {
  const norm = (h) => String(h).toLowerCase().replace(/[^a-z]/g, '');
  const idx = {};
  header.forEach((h, i) => {
    const n = norm(h);
    if (['name', 'fullname', 'customername', 'customer', 'partyname'].includes(n)) idx.name = i;
    else if (['phone', 'mobile', 'number', 'contact', 'phoneno', 'mobileno', 'whatsapp'].includes(n)) idx.phone = i;
    else if (['email', 'emailid', 'mail'].includes(n)) idx.email = i;
    else if (['company', 'shop', 'shopname', 'firm', 'business'].includes(n)) idx.company = i;
    else if (['city', 'town'].includes(n)) idx.city = i;
    else if (['state', 'province'].includes(n)) idx.state = i;
    else if (['source', 'leadsource'].includes(n)) idx.source = i;
    else if (['assign', 'assignto', 'assignedto', 'assigned', 'assignee', 'ldr', 'owner', 'qualifier', 'ldrname'].includes(n)) idx.assign = i;
  });
  return idx;
}
