// Bole hue text (Hindi / Hinglish / English) se follow-up date-time aur form-answers ka SUGGESTION nikalna. Kuch bhi AI/server par nahi
// jaata — poori tarah browser mein, free. Sirf suggestion deta hai; user "Lagao" dabaye tabhi form mein aata hai.

const DEV = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};
// Devanagari shabdon ko pehle Roman mein badlo (JS ka \b Devanagari ke saath kaam nahi karta)
const DEVWORDS = [
  ['परसों', 'parso'], ['परसो', 'parso'], ['अगले हफ्ते', 'agle hafte'], ['अगले सप्ताह', 'agle hafte'], ['आज', 'aaj'], ['कल', 'kal'], ['सुबह', 'subah'], ['दोपहर', 'dopahar'],
  ['शाम', 'shaam'], ['रात', 'raat'], ['बजे', 'baje'], ['मिनट', 'minute'], ['घंटे', 'ghante'], ['घंटा', 'ghanta'], ['बाद', 'baad'], ['दिन', 'din'], ['हफ्ते', 'hafte'],
  ['आधा', 'aadha'], ['डेढ़', 'dedh'], ['डेढ', 'dedh'], ['ढाई', 'dhai'], ['सवा', 'sava'], ['साढ़े', 'saade'], ['साढे', 'saade'], ['पौने', 'paune'],
  ['सोमवार', 'somvar'], ['मंगलवार', 'mangalvar'], ['बुधवार', 'budhvar'], ['गुरुवार', 'guruvar'], ['वीरवार', 'veervar'], ['शुक्रवार', 'shukravar'], ['शनिवार', 'shanivar'], ['रविवार', 'ravivar'], ['इतवार', 'itwar'],
];
const deva = (s) => DEVWORDS.reduce((acc, [d, r]) => acc.split(d).join(' ' + r + ' '), s);
const norm = (s) => deva(String(s || '')).toLowerCase()
  .replace(/[०-९]/g, (c) => DEV[c])
  .replace(/[,।.!?]/g, ' ').replace(/\s+/g, ' ').trim();

// Hindi (Devanagari) ke saath-saath Roman spellings
const W = {
  today: /\b(aaj|aj|today|आज)\b/,
  tomorrow: /\b(kal|tomorrow|कल)\b/,
  dayAfter: /\b(parso|parson|day after tomorrow|परसों|परसो)\b/,
  nextWeek: /\b(agle hafte|agle week|next week|अगले हफ्ते|अगले सप्ताह)\b/,
  morning: /\b(subah|subha|morning|सुबह)\b/,
  noon: /\b(dopahar|dophar|afternoon|दोपहर)\b/,
  evening: /\b(shaam|sham|evening|शाम)\b/,
  night: /\b(raat|night|रात)\b/,
};
const WEEKDAYS = [
  [0, /\b(raviv?ar|sunday|sun|रविवार|इतवार|itwar)\b/], [1, /\b(somvar|somwar|monday|mon|सोमवार)\b/], [2, /\b(mangal(var|war)?|tuesday|tue|मंगलवार)\b/],
  [3, /\b(budh(var|war)?|wednesday|wed|बुधवार)\b/], [4, /\b(guru(var|war)?|veer(var|war)?|thursday|thu|गुरुवार|वीरवार)\b/],
  [5, /\b(shukra(var|war)?|friday|fri|शुक्रवार)\b/], [6, /\b(shani(var|war)?|saturday|sat|शनिवार)\b/],
];

function periodOf(t) {
  if (W.morning.test(t)) return 'am';
  if (W.noon.test(t)) return 'noon';
  if (W.evening.test(t)) return 'pm';
  if (W.night.test(t)) return 'night';
  return '';
}

function to24(h, period, hasAmPm) {
  if (hasAmPm === 'am') return h === 12 ? 0 : h;
  if (hasAmPm === 'pm') return h === 12 ? 12 : h + 12;
  if (h >= 13) return h;
  if (period === 'am') return h === 12 ? 0 : h;
  if (period === 'noon') return h === 12 ? 12 : (h <= 6 ? h + 12 : h);
  if (period === 'pm') return h === 12 ? 12 : h + 12;
  if (period === 'night') return h === 12 ? 0 : (h >= 6 ? h + 12 : h);
  // koi shabd nahi: business hours maan lo — 8..11 subah, 12 dopahar, 1..7 shaam
  if (h === 12) return 12;
  return h >= 8 ? h : h + 12;
}

/** @returns {{ hour, minute } | null} */
function parseClock(t) {
  const period = periodOf(t);
  let m;
  // sava / saade / dedh / dhai / paune
  if ((m = t.match(/\b(dedh|डेढ़|डेढ)\s*(baje|bje|बजे)?/))) return { hour: to24(1, period), minute: 30 };
  if ((m = t.match(/\b(dhai|dhaai|ढाई)\s*(baje|bje|बजे)?/))) return { hour: to24(2, period), minute: 30 };
  if ((m = t.match(/\b(sava|सवा)\s*(\d{1,2})/))) return { hour: to24(+m[2], period), minute: 15 };
  if ((m = t.match(/\b(saade|sade|साढ़े|साढे)\s*(\d{1,2})/))) return { hour: to24(+m[2], period), minute: 30 };
  if ((m = t.match(/\b(paune|paune|पौने)\s*(\d{1,2})/))) { const h = +m[2] - 1; return { hour: to24(h < 1 ? 12 : h, period), minute: 45 }; }
  // 4:30 pm / 4 pm / 16:00
  if ((m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a m|p m)\b/))) return { hour: to24(+m[1], period, /^a/.test(m[3]) ? 'am' : 'pm'), minute: +(m[2] || 0) };
  if ((m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) return { hour: +m[1] >= 13 ? +m[1] : to24(+m[1], period), minute: +m[2] };
  // 4 baje / 4:30 baje / 4 बजे
  if ((m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(baje|bje|bajey|बजे)\b/))) return { hour: to24(+m[1], period), minute: +(m[2] || 0) };
  if ((m = t.match(/\b(\d{1,2})\s*(o'?clock|oclock)\b/))) return { hour: to24(+m[1], period), minute: 0 };
  return null;
}

/** relative: "10 minute baad", "1 ghante baad", "aadha ghanta baad", "2 din baad" */
function parseRelative(t, now) {
  let m;
  if ((m = t.match(/\b(\d{1,3})\s*(min(?:ute|ut|s)?|मिनट)\b.*?\b(baad|bad|me|mein|में|बाद|later|after)\b/))) return new Date(now.getTime() + (+m[1]) * 60000);
  if ((m = t.match(/\b(\d{1,2})\s*(ghante|ghanta|ghnte|hour|hours|hr|hrs|घंटे|घंटा)\b.*?\b(baad|bad|me|mein|में|बाद|later|after)\b/))) return new Date(now.getTime() + (+m[1]) * 3600000);
  if (/\b(aadha|adha|आधा)\s*(ghanta|ghante|घंटा|hour)\b/.test(t)) return new Date(now.getTime() + 30 * 60000);
  if ((m = t.match(/\b(\d{1,2})\s*(din|days?|दिन)\b.*?\b(baad|bad|me|mein|में|बाद|later|after)\b/))) { const d = new Date(now); d.setDate(d.getDate() + (+m[1])); return { date: d }; }
  if ((m = t.match(/\b(\d{1,2})\s*(hafte|week|weeks|हफ्ते)\b.*?\b(baad|bad|बाद|later|after)\b/))) { const d = new Date(now); d.setDate(d.getDate() + 7 * (+m[1])); return { date: d }; }
  return null;
}

/** @returns {Date | null} — bole hue text se agla follow-up (local time) */
export function parseFollowup(text, now = new Date()) {
  const t = norm(text);
  if (!t) return null;

  const rel = parseRelative(t, now);
  if (rel instanceof Date) return rel;

  // din
  let day = null; // Date (00:00)
  const base = new Date(now); base.setHours(0, 0, 0, 0);
  const addDays = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
  if (W.dayAfter.test(t)) day = addDays(2);
  else if (W.tomorrow.test(t)) day = addDays(1);
  else if (W.nextWeek.test(t)) day = addDays(7);
  else if (rel && rel.date) day = new Date(new Date(rel.date).setHours(0, 0, 0, 0));
  else if (W.today.test(t)) day = addDays(0);
  else {
    for (const [wd, re] of WEEKDAYS) { if (re.test(t)) { let diff = (wd - now.getDay() + 7) % 7; if (diff === 0) diff = 7; day = addDays(diff); break; } }
  }

  const clock = parseClock(t);
  if (!day && !clock) return null;
  if (!clock) { // sirf din bola — 11:00 default? nahi: din ke liye 10:00 AM suggest karte hain
    const d = new Date(day); d.setHours(10, 0, 0, 0); return d;
  }
  let d = day ? new Date(day) : new Date(base);
  d.setHours(clock.hour, clock.minute, 0, 0);
  if (!day && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1); // sirf time bola aur wo nikal chuka — kal
  return d;
}

/** datetime-local input ki value: "YYYY-MM-DDTHH:mm" (local) */
export function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Bolne ke alag-alag tareeke (Roman + Hindi) -> stage ka naam. Sirf un stages ke liye jo config mein hain. Pehle aane wala shabd jeetta hai.
const STAGE_ALIASES = {
  'call back': ['call back', 'callback', 'कॉल बैक', 'कॉलबैक', 'दोबारा कॉल', 'बाद में कॉल', 'phir call', 'baad me call', 'baad mein call'],
  followup: ['followup', 'follow up', 'follow-up', 'फॉलोअप', 'फॉलो अप', 'फालो अप', 'फालोअप', 'फालो', 'फॉलो', 'फ़ॉलो', 'फ़ालो'],
  'visit customer': ['visit customer', 'visit', 'विजिट', 'विज़िट', 'दुकान पर आएगा', 'shop pe aayega', 'shop par aayega'],
  'hot lead': ['hot lead', 'hot', 'हॉट लीड', 'हॉट'],
  'video call': ['video call', 'वीडियो कॉल', 'वीडियो'],
  'order done': ['order done', 'order mila', 'order final', 'order confirm', 'ऑर्डर मिल', 'ऑर्डर फाइनल', 'ऑर्डर कन्फर्म', 'ऑर्डर डन'],
  lost: ['lost', 'not interested', 'interested nahi', 'nahi chahiye', 'लॉस्ट', 'रुचि नहीं', 'नहीं चाहिए', 'इंटरेस्टेड नहीं'],
  qualified: ['qualified', 'qualify', 'क्वालिफाइड', 'क्वालिफाई'],
};

/** Bole hue text se kaun sa stage bola gaya: { name, available } ya null.
 *  allNames = config ke saare stage naam (lowercase), availableNames = is lead ke liye (role/flow ke hisaab se) jo allowed hain.
 *  Stage ka exact label bhi pehchanta hai. available=false => stage hai to, par is lead par (jaise Sales ka stage LDR-wali lead par) nahi. */
export function stageFromSpeech(text, allNames, availableNames) {
  const low = ' ' + String(text || '').toLowerCase().replace(/[.,!?।"“”]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  let best = null;
  const consider = (name, phrase) => {
    const p = String(phrase).toLowerCase();
    const pos = low.indexOf(/^[a-z0-9 -]+$/.test(p) ? ' ' + p + ' ' : p); // Roman: poora shabd; Hindi: seedha
    if (pos >= 0 && (!best || pos < best.pos)) best = { name, pos };
  };
  [...new Set(allNames)].forEach((n) => {
    consider(n, n);
    (STAGE_ALIASES[n] || []).forEach((a) => consider(n, a));
  });
  if (!best) return null;
  return { name: best.name, available: availableNames.includes(best.name) };
}

/** form-fields ke select/radio options jo bole hue text mein aaye — { label: value } (sirf pehla match har field ka) */
export function matchFormAnswers(text, fields, splitList) {
  const t = ' ' + norm(text) + ' ';
  const out = {};
  (fields || []).forEach((f) => {
    const opts = splitList ? splitList(f.options) : String(f.options || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!opts.length) return;
    // lambe option pehle (jaise "Boutique Owner" ko "Boutique" se pehle)
    const hit = [...opts].sort((a, b) => b.length - a.length).find((o) => {
      const n = norm(o); return n.length >= 3 && t.includes(' ' + n + ' ');
    });
    if (hit) out[f.label] = hit;
  });
  return out;
}
