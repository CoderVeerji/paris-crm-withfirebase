// Bole hue text (Hindi / Hinglish / English) se follow-up date-time aur form-answers ka SUGGESTION nikalna. Kuch bhi AI/server par nahi
// jaata — poori tarah browser mein, free. Sirf suggestion deta hai; user "Lagao" dabaye tabhi form mein aata hai.

const DEV = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};
// Devanagari shabdon ko pehle Roman mein badlo (JS ka \b Devanagari ke saath kaam nahi karta)
const DEVWORDS = [
  ['तारीख', 'tarikh'], ['तारिख', 'tarikh'], ['तरीख', 'tarikh'],
  ['परसों', 'parso'], ['परसो', 'parso'], ['अगले हफ्ते', 'agle hafte'], ['अगले सप्ताह', 'agle hafte'], ['आज', 'aaj'], ['कल', 'kal'], ['सुबह', 'subah'], ['दोपहर', 'dopahar'],
  ['शाम', 'shaam'], ['रात', 'raat'], ['बजे', 'baje'], ['मिनट', 'minute'], ['घंटे', 'ghante'], ['घंटा', 'ghanta'], ['बाद', 'baad'], ['दिन', 'din'], ['हफ्ते', 'hafte'],
  ['आधा', 'aadha'], ['डेढ़', 'dedh'], ['डेढ', 'dedh'], ['ढाई', 'dhai'], ['सवा', 'sava'], ['साढ़े', 'saade'], ['साढे', 'saade'], ['पौने', 'paune'],
  ['सोमवार', 'somvar'], ['मंगलवार', 'mangalvar'], ['बुधवार', 'budhvar'], ['गुरुवार', 'guruvar'], ['वीरवार', 'veervar'], ['शुक्रवार', 'shukravar'], ['शनिवार', 'shanivar'], ['रविवार', 'ravivar'], ['इतवार', 'itwar'],
];
const DEVNUM = [
  ['पंद्रह', 'pandrah'], ['पन्द्रह', 'pandrah'], ['ग्यारह', 'gyarah'], ['बारह', 'barah'], ['तेरह', 'terah'], ['चौदह', 'chaudah'], ['सोलह', 'solah'], ['सत्रह', 'satrah'],
  ['अठारह', 'atharah'], ['उन्नीस', 'unnis'], ['बीस', 'bees'], ['तीस', 'tees'], ['पांच', 'paanch'], ['पाँच', 'paanch'], ['छह', 'chhe'], ['छः', 'chhe'], ['सात', 'saat'], ['आठ', 'aath'],
  ['नौ', 'nau'], ['दस', 'das'], ['तीन', 'teen'], ['चार', 'chaar'], ['एक', 'ek'], ['दो', 'do'],
  ['अगले महीने', 'agle mahine'], ['महीने', 'mahine'], ['महीना', 'mahine'], ['थोड़ी देर', 'thodi der'], ['थोड़ी देर', 'thodi der'], ['कुछ देर', 'thodi der'],
];
const NOTDEV = '(?<![\\u0900-\\u097F])'; const NOTDEV2 = '(?![\\u0900-\\u097F])';
const devaNum = (s) => DEVNUM.reduce((acc, [d, r]) => acc.replace(new RegExp(NOTDEV + d + NOTDEV2, 'g'), ' ' + r + ' '), s);
const fixDevaCall = (s) => s.replace(/(कॉल|काल|कौल)\s+(?=(?:आएगा|आएगी|आएंगे|आऊंगा|आऊंगी|आयेगा|आयेगी|आयेंगे)(?![\u0900-\u097F]))/g, 'कल ');
const deva = (s) => devaNum(DEVWORDS.reduce((acc, [d, r]) => acc.split(d).join(' ' + r + ' '), fixDevaCall(s)));

// Roman ank-shabd (do din baad, teen baje, saade paanch baje...) -> digits — sirf jab aage koi unit/ank ho ("do" jaise aam shabd aur
// "sat" (Saturday) ko bina unit ke na chhue)
const NUMW = {
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, paach: 5, chhe: 6, chhah: 6, chhey: 6, chah: 6, saat: 7, aath: 8, nau: 9, das: 10, dus: 10,
  gyarah: 11, barah: 12, baarah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20, ikkis: 21, bais: 22, teis: 23,
  chaubis: 24, pachchis: 25, chhabbis: 26, sattais: 27, atthais: 28, untis: 29, tees: 30, ikatees: 31,
};
const NUM_UNIT = '(?:baje|bje|bajey|din|dino|hafte|hafta|week|weeks|ghante|ghanta|ghnte|hour|hours|minute|min|mins|mahine|mahina|month|months|tarikh|tarik|tareekh|date|am|pm)';
const NUMW_RE = new RegExp('\\b(' + Object.keys(NUMW).join('|') + ')\\b(?=\\s+(?:' + NUM_UNIT + '|\\d))', 'g');
const numWords = (s) => { let x = s; for (let i = 0; i < 3; i++) x = x.replace(NUMW_RE, (m) => String(NUMW[m])); return x; };
// Chrome ke speech-to-text ki aam galat spellings (khaaskar en-IN) -> sahi shabd. "cal" = kal (tomorrow); "call" sirf tab jab uske baad seedha "aayega" jaisa
// aane wala kriya ho ("call aayegi" = kal aayegi); baaki "call karna" jaisa call hi rehta hai.
const MISHEAR = [
  [/\b(cal|kl|kaal)\b/g, 'kal'],
  [/\bcall\s+(?=(?:aayega|ayega|aaega|aega|aayegi|ayegi|aaegi|aegi|aayenge|ayenge|aaenge|aenge|aaunga|aunga|aaungi|aungi)\b)/g, 'kal '],
  [/\b(parsa|paarso|parsoh|parsoo)\b/g, 'parso'],
  [/\b(bajae|baaje|bajai|bajay|bhaje|bajhe)\b/g, 'baje'],
  [/\b(dupahar|dopehar|dupehar|dophar|do pehar|do pahar|do peher)\b/g, 'dopahar'],
  [/\b(saadhe|sadhe)\b/g, 'saade'], [/\bsawa\b/g, 'sava'],
  [/\b(tareekh|taarikh|tarek)\b/g, 'tarikh'], [/\b(haftey|haftay|hafto)\b/g, 'hafte'],
];
const fixHeard = (s) => MISHEAR.reduce((acc, [re, to]) => acc.replace(re, to), s);
const norm = (s) => numWords(fixHeard(deva(String(s || '')).toLowerCase())
  .replace(/[०-९]/g, (c) => DEV[c])
  .replace(/[,।.!?]/g, ' ').replace(/\s+/g, ' ').trim())
  // "4 se 5 baje", "4-5 baje" -> pehla time
  .replace(/\b(\d{1,2})\s*(?:se|to|-)\s*(\d{1,2})\s*(baje|bje|bajey)\b/g, '$1 $3')
  .replace(/\s+/g, ' ').trim();

// Hindi (Devanagari) ke saath-saath Roman spellings
const W = {
  today: /\b(aaj|aj|today|आज)\b/,
  tomorrow: /\b(kal|tomorrow|कल)\b/,
  dayAfter: /\b(parso|parson|parsoon|parsu|day after tomorrow|परसों|परसो)\b/,
  threeDays: /\b(narso|narson|tarso|tarson)\b/,
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
  if (/\b(dedh|डेढ़|डेढ)\s*(ghanta|ghante|hour)\b/.test(t)) return new Date(now.getTime() + 90 * 60000);
  if (/\b(dhai|dhaai|ढाई)\s*(ghanta|ghante|hour)\b/.test(t)) return new Date(now.getTime() + 150 * 60000);
  if (/\b(thodi der|kuch der|thodi der me|thodi der mein|shortly|in a while)\b/.test(t)) return new Date(now.getTime() + 60 * 60000);
  if ((m = t.match(/\b(\d{1,2})\s*(mahine|mahina|month|months)\b/))) { const d = new Date(now); d.setMonth(d.getMonth() + (+m[1])); return { date: d }; }
  if ((m = t.match(/\b(\d{1,2})\s*(din|days?|दिन)\b.*?\b(baad|bad|me|mein|में|बाद|later|after)\b/))) { const d = new Date(now); d.setDate(d.getDate() + (+m[1])); return { date: d }; }
  if ((m = t.match(/\b(\d{1,2})\s*(hafte|hafta|week|weeks|हफ्ते)\b.*?\b(baad|bad|me|mein|बाद|later|after)\b/))) { const d = new Date(now); d.setDate(d.getDate() + 7 * (+m[1])); return { date: d }; }
  // "teen din aayega" (baad/mein bole bina) — ank + din hi kaafi
  if ((m = t.match(/\b(\d{1,2})\s*(din|dino|days?)\b/))) { const d = new Date(now); d.setDate(d.getDate() + (+m[1])); return { date: d }; }
  return null;
}

/** "4 tarikh ko", "4 tarik", "28 date", "tarikh 4" -> mahine ka din. Aaj ya aage ka aane wala wahi tarikh; nikal chuki ho to agle mahine ki. */
function parseDayOfMonth(t, base) {
  const m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:tarikh|tarik|tareekh|taarikh|date)\b/) || t.match(/\b(?:tarikh|tarik|tareekh|taarikh|date)\s*(\d{1,2})\b/);
  if (!m) return null;
  const n = +m[1];
  if (n < 1 || n > 31) return null;
  for (let k = 0; k < 13; k++) {                       // 31 tarikh wale din ke bina mahine skip
    const d = new Date(base.getFullYear(), base.getMonth() + k, n);
    if (d.getDate() === n && d.getTime() >= base.getTime()) return d;
  }
  return null;
}

/** Jab sirf din bola ho (time nahi) — us din subah 11:00 baje. */
export const DEFAULT_FOLLOWUP_HOUR = 11;
const PERIOD_HOUR = { am: 11, noon: 13, pm: 17, night: 20 }; // hissa-e-din bola par ghanta nahi bola

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
  // "kal ya parso" -> pehla bola (kal); "kal nahi parso" -> sudhaar, aakhri bola (parso)
  const mentions = [];
  const addM = (re, n) => { const m = re.exec(t); if (m) mentions.push({ pos: m.index, n }); };
  addM(W.tomorrow, 1); addM(W.dayAfter, 2); addM(W.threeDays, 3); addM(W.nextWeek, 7);
  mentions.sort((a, b) => a.pos - b.pos);
  const negated = /\b(nahi|nahin|nhi|nai|nahee|not|no)\b/.test(t);
  const dom = parseDayOfMonth(t, base);
  const nextMonth = /\b(agle mahine|agle month|next month)\b/.test(t);
  if (nextMonth) {
    const m = t.match(/\b(\d{1,2})\s*(?:tarikh|tarik|tareekh|taarikh|date)\b/);
    day = m ? new Date(base.getFullYear(), base.getMonth() + 1, +m[1]) : new Date(base.getFullYear(), base.getMonth() + 1, base.getDate());
  } else if (mentions.length) day = addDays((negated ? mentions[mentions.length - 1] : mentions[0]).n);
  else if (rel && rel.date) day = new Date(new Date(rel.date).setHours(0, 0, 0, 0));
  else if (dom) day = dom;
  else if (W.today.test(t)) day = addDays(0);
  else {
    for (const [wd, re] of WEEKDAYS) { if (re.test(t)) { let diff = (wd - now.getDay() + 7) % 7; if (diff === 0) diff = 7; day = addDays(diff); break; } }
  }

  const clock = parseClock(t);
  const per = periodOf(t);
  // time ka sirf hissa-e-din bola ("shaam ko call karna") — aaj ka wo hissa, nikal chuka ho to kal
  if (!day && !clock && per) {
    const dd = new Date(base); dd.setHours(PERIOD_HOUR[per], 0, 0, 0);
    if (dd.getTime() <= now.getTime()) dd.setDate(dd.getDate() + 1);
    return dd;
  }
  if (!day && !clock) return null;
  if (!clock) { // sirf din bola (time nahi): koi hissa-e-din bola ho (shaam / dopahar / raat) to uska time, warna us din subah 11:00 baje
    const d = new Date(day); d.setHours(per ? PERIOD_HOUR[per] : DEFAULT_FOLLOWUP_HOUR, 0, 0, 0); return d;
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
  'order done': ['order done', 'order mila', 'order mil gaya', 'order mil gayi', 'order ho gaya', 'order ho gayi', 'order lag gaya', 'order final', 'order confirm', 'ऑर्डर मिल', 'ऑर्डर फाइनल', 'ऑर्डर कन्फर्म', 'ऑर्डर डन'],
  lost: ['lost', 'not interested', 'interested nahi', 'nahi chahiye', 'लॉस्ट', 'रुचि नहीं', 'नहीं चाहिए', 'इंटरेस्टेड नहीं'],
  qualified: ['qualified', 'qualify', 'क्वालिफाइड', 'क्वालिफाई'],
};

// Stage ka naam NAHI bola, par matlab se samajh aata hai (jaise "parso aayegi" = visit). Pehle match jeetta hai, is order mein:
// lost > hot lead > visit > call back > followup. 'qualified' (hand-off) aur 'order done' (paisa) kabhi matlab se nahi lagte — sirf naam bolne par.
// Roman: poore shabd/phrase; Hindi: seedha includes. Yahan sirf tab pahunchte hain jab koi stage ka naam bola hi nahi.
const ROM_COME = 'aayega|ayega|aaega|aega|aayegi|ayegi|aaegi|aegi|aayenge|ayenge|aaenge|aenge|aaunga|aunga|aaungi|aungi|aaoge|aaogi|pahunchega|pahunchegi|pahuchega|pahuchegi';
const INTENTS = [
  { stage: 'lost', rom: /\b(interested nahi|intrested nahi|nahi lena|nahi chahiye|nahi leni|mana kar diya|mana kar di|mana kiya|wrong number|galat number|band kar do|not interested|no interest|dead lead|zarurat nahi|zaroorat nahi|jarurat nahi|requirement nahi|dusre se le liya|kahin aur se|time pass|timepass|cancel|budget nahi|business band|retail nahi)\b/,
    hi: ['इंटरेस्टेड नहीं', 'इंटरेस्ट नहीं', 'रुचि नहीं', 'नहीं लेना', 'नहीं चाहिए', 'मना कर दिया', 'मना कर दी', 'गलत नंबर', 'बंद कर दो', 'जरूरत नहीं', 'ज़रूरत नहीं', 'दूसरे से ले लिया', 'कैंसिल', 'बजट नहीं', 'टाइम पास'] },
  { stage: 'hot lead', rom: /\b(pakka|pakki|confirm|order dega|order degi|order karega|order karegi|order dene|order de dega|ready to buy|ready hai|ready hain|lena hai|leni hai|kharidna|khareedna|pasand aaya|pasand aayi|pasand aa gaya|rate fix|bahut interested|very interested|full interested|jaldi chahiye|advance|payment kar|payment bhej|token|booking|book kar|final kar|sample pasand)\b/,
    hi: ['पक्का', 'ऑर्डर देगा', 'ऑर्डर देगी', 'ऑर्डर करेगा', 'ऑर्डर करेगी', 'लेना है', 'लेनी है', 'खरीदना', 'पसंद आया', 'पसंद आई', 'रेट फिक्स', 'बहुत इंटरेस्टेड', 'रेडी', 'एडवांस', 'पेमेंट कर', 'पेमेंट भेज', 'बुकिंग', 'फाइनल कर', 'सैंपल पसंद'] },
  { stage: 'visit customer', rom: new RegExp('\\b(' + ROM_COME + '|visit|shop pe|shop par|dukan pe|dukan par|showroom|milne aa|dekhne aa|maal dekhne|sample dekhne|nikal gaya|nikal gayi|pahunch)\\b'),
    hi: ['आएगा', 'आएगी', 'आयेगा', 'आयेगी', 'आएंगे', 'आयेंगे', 'आऊंगा', 'आऊंगी', 'आउंगा', 'आउंगी', 'आओगे', 'पहुंचेगा', 'पहुंचेगी', 'दुकान', 'शॉप', 'शोरूम', 'मिलने आ', 'देखने आ', 'निकल गया', 'निकल गई'] },
  { stage: 'call back', rom: /\b(call karna|call karna hai|call karenge|call karunga|call karungi|call kar dena|phone karna|phone karenge|phone karunga|dobara call|dubara call|phir call|baad me call|baad mein call|phone nahi utha|call nahi utha|phone nahi uthaya|call nahi uthaya|not picking|no answer|switch off|not reachable|busy tha|busy thi|busy hai|baat nahi hui|uthaya nahi|phone cut|call cut|phone band|number busy|line busy|out of coverage|reachable nahi|reply nahi|no reply|ring ja)\b/,
    hi: ['कॉल करना', 'कॉल करें', 'कॉल करूंगा', 'कॉल करूंगी', 'फोन करना', 'फ़ोन करना', 'फोन करूंगा', 'दोबारा कॉल', 'दुबारा कॉल', 'फिर कॉल', 'बाद में कॉल', 'फोन नहीं उठाया', 'कॉल नहीं उठाया', 'फोन नहीं उठा', 'स्विच ऑफ', 'बिजी', 'बात नहीं हुई', 'उठाया नहीं', 'फोन कट', 'कॉल कट', 'फोन बंद', 'रिप्लाई नहीं'] },
  { stage: 'video call', rom: /\b(video pe|video par|video pr|vc pe|vc par|video dikha|video mein dikha)\b/, hi: ['वीडियो पर', 'वीडियो पे', 'वीडियो में दिखा'] },
  { stage: 'video call', rom: /\b(video pe|video par|video pr|vc pe|vc par|video dikha|video mein dikha)\b/, hi: ['वीडियो पर', 'वीडियो पे', 'वीडियो में दिखा'] },
  { stage: 'followup', rom: /\b(khud bata|khud bol|bata denge|bata dengi|bata dunga|bata dungi|batayenge|batayegi|bataenge|bolega|bolegi|bolenge|bola hai|boli hai|kaha hai|kaha tha|soch ke|soch kar|sochke|dekhte hain|dekhenge|dekh lenge|baad mein batayenge|let us know|will tell|get back|catalogue bhej|catalog bhej|photo bhej|photos bhej|sample bhej|details bhej|rate bata|price bata|whatsapp pe|sochega|sochegi|sochenge|soch raha|soch rahi|baad mein baat|wait kar|intezaar|rate puch|price puch)\b/,
    hi: ['खुद बता', 'बता देंगे', 'बता देगा', 'बता देगी', 'बताएंगे', 'बोलेगा', 'बोलेगी', 'बोलेंगे', 'बोला है', 'बोली है', 'कहा है', 'सोच कर', 'सोचकर', 'देखते हैं', 'देखेंगे', 'कैटलॉग भेज', 'कैटलोग भेज', 'फोटो भेज', 'डिटेल भेज', 'रेट बता', 'रेट पूछ', 'सोचेगा', 'सोचेगी', 'सोच रहा', 'सोच रही', 'इंतजार', 'इंतज़ार'] },
];

// "Phone nahi utha / busy / switch off" = pakka Call Back. Sirf "call karunga / call karna hai" + (khud bata denge / soch raha / catalogue bheja) = Followup.
const CB_STRONG = /\b(nahi utha|nahi uthaya|uthaya nahi|phone cut|call cut|phone band|number busy|line busy|out of coverage|reachable nahi|reply nahi|no reply|no answer|not picking|switch off|busy tha|busy thi|busy hai|baat nahi hui|ring ja)\b/;
const CB_STRONG_HI = ['फोन नहीं उठा', 'कॉल नहीं उठा', 'स्विच ऑफ', 'बिजी', 'बात नहीं हुई', 'उठाया नहीं', 'फोन कट', 'कॉल कट', 'फोन बंद', 'रिप्लाई नहीं'];

/** Naam nahi bola — bole hue matlab se stage ka andaza. Return { name, available, inferred: true } ya null. */
function inferStage(text, allNames, availableNames) {
  const low = ' ' + String(text || '').toLowerCase().replace(/[.,!?।"“”]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  for (const it of INTENTS) {
    if (!allNames.includes(it.stage)) continue;                       // ye stage config mein hai hi nahi
    if (it.rom.test(low) || it.hi.some((p) => low.includes(p))) {
      if (it.stage === 'call back' && !(CB_STRONG.test(low) || CB_STRONG_HI.some((p) => low.includes(p)))) {
        const fu = INTENTS.find((x) => x.stage === 'followup');
        if (fu && allNames.includes('followup') && availableNames.includes('followup') && (fu.rom.test(low) || fu.hi.some((p) => low.includes(p)))) return { name: 'followup', available: true, inferred: true };
      }
      return { name: it.stage, available: availableNames.includes(it.stage), inferred: true };
    }
  }
  return null;
}

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
  if (!best) return inferStage(text, allNames, availableNames);
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
