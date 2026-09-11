// { iso2, code (calling), name, len: [min,max] digits of the local number (country code ke baad) }
export const COUNTRIES = [
  { iso: 'IN', code: '91', name: 'India', len: [10, 10] },
  { iso: 'NP', code: '977', name: 'Nepal', len: [10, 10] },
  { iso: 'BD', code: '880', name: 'Bangladesh', len: [10, 10] },
  { iso: 'LK', code: '94', name: 'Sri Lanka', len: [9, 9] },
  { iso: 'BT', code: '975', name: 'Bhutan', len: [8, 8] },
  { iso: 'PK', code: '92', name: 'Pakistan', len: [10, 10] },
  { iso: 'AE', code: '971', name: 'UAE', len: [9, 9] },
  { iso: 'SA', code: '966', name: 'Saudi Arabia', len: [9, 9] },
  { iso: 'OM', code: '968', name: 'Oman', len: [8, 8] },
  { iso: 'QA', code: '974', name: 'Qatar', len: [8, 8] },
  { iso: 'KW', code: '965', name: 'Kuwait', len: [8, 8] },
  { iso: 'BH', code: '973', name: 'Bahrain', len: [8, 8] },
  { iso: 'US', code: '1', name: 'United States', len: [10, 10] },
  { iso: 'CA', code: '1', name: 'Canada', len: [10, 10] },
  { iso: 'GB', code: '44', name: 'United Kingdom', len: [10, 10] },
  { iso: 'AU', code: '61', name: 'Australia', len: [9, 9] },
  { iso: 'NZ', code: '64', name: 'New Zealand', len: [8, 9] },
  { iso: 'SG', code: '65', name: 'Singapore', len: [8, 8] },
  { iso: 'MY', code: '60', name: 'Malaysia', len: [9, 10] },
  { iso: 'TH', code: '66', name: 'Thailand', len: [9, 9] },
  { iso: 'ID', code: '62', name: 'Indonesia', len: [9, 12] },
  { iso: 'PH', code: '63', name: 'Philippines', len: [10, 10] },
  { iso: 'CN', code: '86', name: 'China', len: [11, 11] },
  { iso: 'HK', code: '852', name: 'Hong Kong', len: [8, 8] },
  { iso: 'JP', code: '81', name: 'Japan', len: [10, 10] },
  { iso: 'KR', code: '82', name: 'South Korea', len: [9, 10] },
  { iso: 'DE', code: '49', name: 'Germany', len: [10, 11] },
  { iso: 'FR', code: '33', name: 'France', len: [9, 9] },
  { iso: 'IT', code: '39', name: 'Italy', len: [9, 10] },
  { iso: 'ES', code: '34', name: 'Spain', len: [9, 9] },
  { iso: 'NL', code: '31', name: 'Netherlands', len: [9, 9] },
  { iso: 'BE', code: '32', name: 'Belgium', len: [8, 9] },
  { iso: 'CH', code: '41', name: 'Switzerland', len: [9, 9] },
  { iso: 'SE', code: '46', name: 'Sweden', len: [7, 9] },
  { iso: 'RU', code: '7', name: 'Russia', len: [10, 10] },
  { iso: 'TR', code: '90', name: 'Turkey', len: [10, 10] },
  { iso: 'ZA', code: '27', name: 'South Africa', len: [9, 9] },
  { iso: 'NG', code: '234', name: 'Nigeria', len: [10, 10] },
  { iso: 'KE', code: '254', name: 'Kenya', len: [9, 9] },
  { iso: 'EG', code: '20', name: 'Egypt', len: [10, 10] },
  { iso: 'BR', code: '55', name: 'Brazil', len: [10, 11] },
  { iso: 'MX', code: '52', name: 'Mexico', len: [10, 10] },
];

export function flag(iso) {
  if (!iso || iso.length !== 2) return '🌐';
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

export const byCode = (code) => COUNTRIES.find((c) => c.code === String(code)) || COUNTRIES[0];

/** digits (sirf local number, country code ke bina) is selected country ke liye sahi length ke hain? */
export function phoneLenOk(code, digits) {
  const c = byCode(code);
  const [min, max] = c.len || [6, 12];
  const n = String(digits || '').replace(/\D/g, '').length;
  return n >= min && n <= max;
}

/** poore digits (cc+number, jaise lead.phone_digits) ko {cc, num} me todo — CountryPicker ko prefill karne ke liye */
export function splitDigits(fullDigits) {
  const d = String(fullDigits || '').replace(/\D/g, '');
  const candidates = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length);
  for (const c of candidates) {
    if (d.startsWith(c.code)) {
      const rest = d.slice(c.code.length);
      const [min, max] = c.len || [6, 12];
      if (rest.length >= min && rest.length <= max) return { cc: c.code, num: rest };
    }
  }
  if (d.startsWith('91') && d.length > 10) return { cc: '91', num: d.slice(2) };
  return { cc: '91', num: d };
}
