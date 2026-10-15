// State naam ek hi roop mein save ho — "up", "U.P.", "uttar pardesh" sab -> "Uttar Pradesh" (Settings ki State_List ka naam).
// Pehle users dropdown ki jagah khud "up" / "mp" type kar dete the, to report (state-wise count `state == 'Uttar Pradesh'`)
// mein wo leads chhoot jaati thi. DYNAMIC: canonical naam admin ki `State_List` se aate hain, aur admin apne short-forms
// `State_Aliases` (Settings) mein add kar sakta hai ("up=Uttar Pradesh, mp=Madhya Pradesh") — code mein kuch hardcode nahi karna padta.
// Neeche ke BUILTIN sirf common India short-forms ka default hain; "uk" jaan-boojh kar nahi (Uttarakhand vs United Kingdom — saaf nahi).

const compact = (v) => String(v || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

const BUILTIN = {
  up: 'Uttar Pradesh', mp: 'Madhya Pradesh', hp: 'Himachal Pradesh', ap: 'Andhra Pradesh', tn: 'Tamil Nadu',
  wb: 'West Bengal', bengal: 'West Bengal', jk: 'Jammu & Kashmir', jandk: 'Jammu & Kashmir', jammukashmir: 'Jammu & Kashmir',
  mh: 'Maharashtra', gj: 'Gujarat', rj: 'Rajasthan', ka: 'Karnataka', kl: 'Kerala', ts: 'Telangana', tg: 'Telangana',
  od: 'Odisha', orissa: 'Odisha', pb: 'Punjab', hr: 'Haryana', br: 'Bihar', jh: 'Jharkhand', cg: 'Chhattisgarh', chattisgarh: 'Chhattisgarh',
  uttaranchal: 'Uttarakhand', uk: null, dl: 'Delhi', newdelhi: 'Delhi', ncr: 'Delhi', delhincr: 'Delhi', pondicherry: 'Puducherry',
  as: 'Assam', ar: 'Arunachal Pradesh', mz: 'Mizoram', nl: 'Nagaland', mn: 'Manipur', ml: 'Meghalaya', sk: 'Sikkim', tr: 'Tripura', ga: 'Goa',
};

let LIST = []; // [{ name, key }]
let ALIAS = {}; // compact -> naam (admin ke aliases BUILTIN se upar)

function splitCsv(str) { return String(str || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean); }

/** ConfigProvider settings load hone par ek baar bulao. */
export function setStateConfig(stateList, aliasStr) {
  LIST = splitCsv(stateList).map((name) => ({ name, key: compact(name) }));
  ALIAS = {};
  // "up=Uttar Pradesh, mp = Madhya Pradesh" (comma ya nayi line se alag)
  splitCsv(aliasStr).forEach((pair) => {
    const i = pair.indexOf('=');
    if (i > 0) { const k = compact(pair.slice(0, i)); const v = pair.slice(i + 1).trim(); if (k && v) ALIAS[k] = v; }
  });
}

// Damerau (adjacent swap = 1 galti) — "pardesh" vs "pradesh" jaisi typo pakadne ke liye
function lev(a, b) {
  const m = a.length; const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}

const inList = (key) => LIST.find((x) => x.key === key);

/** Jo likha hai use State_List ke sahi naam mein badlo. Pehchaan na paye to jaisa likha (trim karke) wahi chhod do — data khona nahi. */
export function normalizeState(raw) {
  const txt = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!txt) return '';
  const key = compact(txt);
  const exact = inList(key);
  if (exact) return exact.name;
  const target = Object.prototype.hasOwnProperty.call(ALIAS, key) ? ALIAS[key] : BUILTIN[key];
  if (target) { const hit = inList(compact(target)); return hit ? hit.name : target; }
  if (key.length >= 6) { // typo ("utter pardesh", "maharastra") — sirf tab jab ek hi naam nazdeek ho
    const near = LIST.filter((x) => x.key.length >= 6 && lev(key, x.key) <= 2);
    if (near.length === 1) return near[0].name;
  }
  return txt;
}
