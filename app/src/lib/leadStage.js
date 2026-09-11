// Lead ki "effective" team-ownership — CLAUDE.md ka core model.
// `status` (LDR field: fresh/new/call back/qualified/dead/lost) + `sales_status` (Sales field)
// se decide hota hai lead ABHI kiski plate pe hai. Dashboard ke scheduled/followup/actionable
// views isi se scope hone chahiye — sirf ldr_uid/sales_uid se nahi (qualified lead pe dono set rehte).

const SS_TERMINAL = ['lost', 'dead', 'order done', 'order won'];
const ST_TERMINAL = ['dead', 'lost'];

const norm = (v) => String(v || '').toLowerCase().trim();

/** Lead band ho chuki? (koi follow-up baaki nahi) */
export function isClosed(l) {
  if (norm(l.outcome)) return true;
  const ss = norm(l.sales_status);
  const st = norm(l.status);
  return SS_TERMINAL.includes(ss) || (!ss && ST_TERMINAL.includes(st));
}

/** Abhi kiske paas: 'ldr' | 'sales' | 'closed' */
export function effectiveTeam(l) {
  if (isClosed(l)) return 'closed';
  const ss = norm(l.sales_status);
  const st = norm(l.status);
  if (ss || st === 'qualified') return 'sales';
  return 'ldr';
}

/** Selected team ke scheduled/followup/actionable view mein ye lead aani chahiye? */
export function ownedBy(l, teamRole) {
  return effectiveTeam(l) === teamRole;
}
