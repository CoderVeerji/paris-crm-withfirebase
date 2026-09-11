// Date-range quick-picks — Meca, Audit Log, Call History sab yahi use karte hain (consistent UI).
import { istDay } from './stats';

export const RANGE_PRESETS = [
  { k: 'today', tk: 'rToday' },
  { k: 'yst', tk: 'rYst' },
  { k: 'w', tk: 'rWeek' },
  { k: 'm', tk: 'rMonth' },
  { k: 'all', tk: 'rAll' },
];

export function rangeFor(k, earliestDay = '2026-04-01') {
  const today = istDay();
  const d = (n) => istDay(Date.now() - n * 86400000);
  if (k === 'today') return [today, today];
  if (k === 'yst') return [d(1), d(1)];
  if (k === 'w') return [d(6), today];
  if (k === 'm') return [d(29), today];
  if (k === 'all') return [earliestDay, today];
  return [today, today];
}

/** "YYYY-MM-DD" -> Date, IST din ki shuruaat/aakhir — Firestore where('at', ...) range query ke liye */
export function dayStart(dayStr) { return new Date(`${dayStr}T00:00:00+05:30`); }
export function dayEnd(dayStr) { return new Date(`${dayStr}T23:59:59.999+05:30`); }
