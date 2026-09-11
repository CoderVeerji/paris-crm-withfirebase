// Chhote formatting helpers — sab jagah consistent.

export function fmtStatus(s) {
  if (!s) return '—';
  return String(s).trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

const toDate = (ts) => {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return isNaN(d) ? null : d;
};

export function fmtDate(ts) {
  const d = toDate(ts);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

export function fmtDateTime(ts) {
  const d = toDate(ts);
  if (!d) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtMoney(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

/** overdue? (next_followup past hai) */
export function isPast(ts) {
  const d = toDate(ts);
  return d ? d < new Date() : false;
}
