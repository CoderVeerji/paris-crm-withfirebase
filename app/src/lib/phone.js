// Phone normalize — worldwide, "+CC NUMBER" format. Migration ke same rules.
export function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return { formatted: '', digits: '', valid: false };
  const cleaned = s.replace(/[^\d+ ]/g, '').replace(/\s+/g, ' ').trim();
  let cc, num;
  if (cleaned.startsWith('+')) {
    const rest = cleaned.slice(1);
    const parts = rest.split(' ');
    if (parts.length > 1) { cc = parts[0].replace(/\D/g, ''); num = parts.slice(1).join('').replace(/\D/g, ''); }
    else {
      const d = rest.replace(/\D/g, '');
      if (d.length >= 12) { cc = d.slice(0, 2); num = d.slice(2); }
      else if (d.length === 11) { cc = d.slice(0, 1); num = d.slice(1); }
      else { cc = '91'; num = d; }
    }
  } else {
    const d = cleaned.replace(/\D/g, '');
    if (d.length === 10) { cc = '91'; num = d; }
    else if (d.length === 12 && d.startsWith('91')) { cc = '91'; num = d.slice(2); }
    else if (d.length > 10) { cc = d.slice(0, d.length - 10); num = d.slice(-10); }
    else { cc = '91'; num = d; }
  }
  const valid = !!cc && num.length >= 6 && num.length <= 12;
  return { formatted: valid ? `+${cc} ${num}` : s, digits: valid ? cc + num : num, valid };
}
