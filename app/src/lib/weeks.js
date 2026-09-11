// "Week" model — ek business week = MANGALWAR se ITWAAR (Tue–Sun). Somwar weekly-off.
// Weeks 1 January se number hote hain: Week 1, Week 2, Week 3 …
// Data window har week ka [Tue 00:00 → agla Mon 23:59] hota hai (7 din) taaki Somwar ka
// koi data (jo aam taur pe 0 hota hai) kisi week se bahar na chhoote. Display end hamesha
// Sunday dikhta hai.
//
// Ye file (aur functions/index.js ka mirror block) week ka SINGLE source of truth hai.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST = 5.5 * 3600 * 1000;
const noon = (day) => new Date(`${day}T12:00:00+05:30`);
const iso = (dt) => dt.toISOString().slice(0, 10);

/** IST date-string ka din: 0=Sun … 6=Sat */
export const dow = (day) => noon(day).getUTCDay();
/** din +/- n */
export const addDays = (day, n) => { const d = noon(day); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
/** aaj (IST) */
export const istToday = () => new Date(Date.now() + IST).toISOString().slice(0, 10);

const sundayOnOrBefore = (day) => { const d = dow(day); return d === 0 ? day : addDays(day, -d); };

/** kisi saal ke week-anchors: Week 1 ka start, aur pehla Mangalwar (Week 2 ka start). */
function anchors(year) {
  const jan1 = `${year}-01-01`;
  const w1Start = dow(jan1) === 1 ? addDays(jan1, 1) : jan1;   // Jan 1 Somwar ho to Mangal se
  let firstTue = w1Start;
  while (dow(firstTue) !== 2) firstTue = addDays(firstTue, 1);
  if (firstTue === w1Start) firstTue = addDays(w1Start, 7);    // Jan 1 khud Mangal → Week 2 agle Mangal se
  return { w1Start, firstTue };
}

/** us saal ka aakhri week number (~52) */
export function maxWeekOfYear(year) {
  return weekNumFor(`${year}-12-31`, year) || 52;
}

/** ek din kis week number mein aata hai (us saal ke andar). null = year se pehle. */
export function weekNumFor(day, year = Number(day.slice(0, 4))) {
  const { w1Start, firstTue } = anchors(year);
  if (day < w1Start) return null;
  if (day < firstTue) return 1;
  const diff = Math.round((noon(day) - noon(firstTue)) / 86400000);
  return 2 + Math.floor(diff / 7);
}

/** week number ka poora range: start(Tue/Jan1), end(Sun, display), dataEnd(Mon), days[] */
export function weekRange(num, year = Number(istToday().slice(0, 4))) {
  const { w1Start, firstTue } = anchors(year);
  const start = num <= 1 ? w1Start : addDays(firstTue, (num - 2) * 7);
  const dataEnd = num <= 1 ? addDays(firstTue, -1) : addDays(start, 6);
  const end = sundayOnOrBefore(dataEnd);
  const days = [];
  for (let d = start; d <= dataEnd; d = addDays(d, 1)) days.push(d);
  return { num, year, start, end, dataEnd, days };
}

/** abhi tak jo aakhri Tue–Sun week POORA ho chuka hai */
export function latestCompleteWeek(refDay = istToday()) {
  let year = Number(refDay.slice(0, 4));
  let n = weekNumFor(refDay, year) || 1;
  let r = weekRange(n, year);
  while (r.end >= refDay) {
    if (n > 1) n -= 1;
    else { year -= 1; n = maxWeekOfYear(year); }
    r = weekRange(n, year);
  }
  return r;
}

/** dropdown ke liye — Week 1 se latest-complete tak, newest first */
export function weekOptions(year = Number(istToday().slice(0, 4)), cap = 80) {
  const last = latestCompleteWeek();
  const lastNum = last.year === year ? last.num : (last.year > year ? maxWeekOfYear(year) : 0);
  const out = [];
  for (let n = lastNum; n >= 1 && out.length < cap; n--) out.push(weekRange(n, year));
  return out;
}

export const fmtDayShort = (day) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
export const weekLabel = (r) => `Week ${r.num} · ${fmtDayShort(r.start)} – ${fmtDayShort(r.end)}`;
export const weekId = (r) => `${r.year}-W${String(r.num).padStart(2, '0')}`;

/** ek report doc ({week_num, year, week_start, week_end} — naya format ya {week_start,week_end} — purana) ka label */
export function reportLabel(w) {
  if (w.week_num) return `Week ${w.week_num} · ${fmtDayShort(w.week_start)} – ${fmtDayShort(w.week_end)}`;
  return `${fmtDayShort(w.week_start)} – ${fmtDayShort(w.week_end)}`;
}
