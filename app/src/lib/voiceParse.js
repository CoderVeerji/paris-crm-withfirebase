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
  else if (parseDayOfMonth(t, base)) day = parseDayOfMonth(t, base);
  else if (W.today.test(t)) day = addDays(0);
  else {
    for (const [wd, re] of WEEKDAYS) { if (re.test(t)) { let diff = (wd - now.getDay() + 7) % 7; if (diff === 0) diff = 7; day = addDays(diff); break; } }
  }

  const clock = parseClock(t);
  if (!day && !clock) return null;
  if (!clock) { // sirf din bola (time nahi) — us din subah 11:00 baje
    const d = new Date(day); d.setHours(DEFAULT_FOLLOWUP_HOUR, 0, 0, 0); return d;
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
  { stage: 'lost', rom: /\b(interested nahi|intrested nahi|nahi lena|nahi chahiye|nahi leni|mana kar diya|mana kar di|mana kiya|wrong number|galat number|band kar do|not interested|no interest|dead lead)\b/,
    hi: ['इंटरेस्टेड नहीं', 'इंटरेस्ट नहीं', 'रुचि नहीं', 'नहीं लेना', 'नहीं चाहिए', 'मना कर दिया', 'मना कर दी', 'गलत नंबर', 'बंद कर दो'] },
  { stage: 'hot lead', rom: /\b(pakka|pakki|confirm|order dega|order degi|order karega|order karegi|order dene|order de dega|ready to buy|ready hai|ready hain|lena hai|leni hai|kharidna|khareedna|pasand aaya|pasand aayi|pasand aa gaya|rate fix|bahut interested|very interested|full interested|jaldi chahiye)\b/,
    hi: ['पक्का', 'ऑर्डर देगा', 'ऑर्डर देगी', 'ऑर्डर करेगा', 'ऑर्डर करेगी', 'लेना है', 'लेनी है', 'खरीदना', 'पसंद आया', 'पसंद आई', 'रेट फिक्स', 'बहुत इंटरेस्टेड', 'रेडी'] },
  { stage: 'visit customer', rom: new RegExp('\\b(' + ROM_COME + '|visit|shop pe|shop par|dukan pe|dukan par|showroom|milne aa)\\b'),
    hi: ['आएगा', 'आएगी', 'आयेगा', 'आयेगी', 'आएंगे', 'आयेंगे', 'आऊंगा', 'आऊंगी', 'आउंगा', 'आउंगी', 'आओगे', 'पहुंचेगा', 'पहुंचेगी', 'दुकान', 'शॉप', 'शोरूम', 'मिलने आ'] },
  { stage: 'call back', rom: /\b(call karna|call karna hai|call karenge|call karunga|call karungi|call kar dena|phone karna|phone karenge|phone karunga|dobara call|dubara call|phir call|baad me call|baad mein call|phone nahi utha|call nahi utha|phone nahi uthaya|call nahi uthaya|not picking|no answer|switch off|not reachable|busy tha|busy thi|busy hai)\b/,
    hi: ['कॉल करना', 'कॉल करें', 'कॉल करूंगा', 'कॉल करूंगी', 'फोन करना', 'फ़ोन करना', 'फोन करूंगा', 'दोबारा कॉल', 'दुबारा कॉल', 'फिर कॉल', 'बाद में कॉल', 'फोन नहीं उठाया', 'कॉल नहीं उठाया', 'फोन नहीं उठा', 'स्विच ऑफ', 'बिजी'] },
  { stage: 'followup', rom: /\b(khud bata|khud bol|bata denge|bata dengi|bata dunga|bata dungi|batayenge|batayegi|bataenge|bolega|bolegi|bolenge|bola hai|boli hai|kaha hai|kaha tha|soch ke|soch kar|sochke|dekhte hain|dekhenge|dekh lenge|baad mein batayenge|let us know|will tell|get back)\b/,
    hi: ['खुद बता', 'बता देंगे', 'बता देगा', 'बता देगी', 'बताएंगे', 'बोलेगा', 'बोलेगी', 'बोलेंगे', 'बोला है', 'बोली है', 'कहा है', 'सोच कर', 'सोचकर', 'देखते हैं', 'देखेंगे'] },
];

/** Naam nahi bola — bole hue matlab se stage ka andaza. Return { name, available, inferred: true } ya null. */
function inferStage(text, allNames, availableNames) {
  const low = ' ' + String(text || '').toLowerCase().replace(/[.,!?।"“”]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  for (const it of INTENTS) {
    if (!allNames.includes(it.stage)) continue;                       // ye stage config mein hai hi nahi
    if (it.rom.test(low) || it.hi.some((p) => low.includes(p))) return { name: it.stage, available: availableNames.includes(it.stage), inferred: true };
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
