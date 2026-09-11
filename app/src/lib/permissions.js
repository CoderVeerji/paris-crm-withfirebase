// ===================================================================
// RBAC — role ke hisaab se kaun kya KAR sakta hai (buttons/menus).
//
// YAAD RAHE: ye client-side gating hai (UX ke liye). ASLI security Firestore
// rules mein hai (firestore.rules) — koi console se bypass kare to rules rok deti hain.
// Is file ka matrix aur rules ek doosre ka mirror hain — dono ek saath badalne chahiye.
//
// Permission format: "resource:action". Scope-wale (leads dekhna) alag helper se.
// ===================================================================

// Har role ka DEFAULT permission-set. admin = '*' (sab).
export const ROLE_PERMS = {
  admin: '*',
  md: [
    'leads:view', 'leads:create', 'leads:edit', 'leads:reassign',
    'reports:dashboard', 'reports:analytics', 'reports:meca', 'reports:monitor', 'reports:weekly', 'reports:audit', 'reports:export',
    'users:view',
  ],
  tl: [
    'leads:view', 'leads:create', 'leads:edit', 'leads:reassign',
    'reports:dashboard', 'reports:meca', 'reports:monitor', 'reports:weekly',
    'users:view',
  ],
  ldr: [
    'leads:view', 'leads:create', 'leads:edit',
    'reports:dashboard',
  ],
  sales: [
    'leads:view', 'leads:create', 'leads:edit', 'orders:create',
    'reports:dashboard',
  ],
};

// Saari possible permissions — Settings ke matrix mein dikhane ke liye (labels ke saath).
export const ALL_PERMS = [
  { key: 'leads:view', grp: 'Leads', label: 'View leads' },
  { key: 'leads:create', grp: 'Leads', label: 'Create lead' },
  { key: 'leads:edit', grp: 'Leads', label: 'Edit lead / take action' },
  { key: 'leads:reassign', grp: 'Leads', label: 'Reassign lead owner', hard: true },
  { key: 'leads:delete', grp: 'Leads', label: 'Delete lead (to recycle)', hard: true },
  { key: 'leads:bulk', grp: 'Leads', label: 'Bulk import / bulk actions', hard: true },
  { key: 'orders:create', grp: 'Sales', label: 'Record an order' },
  { key: 'users:view', grp: 'Team', label: 'View team members' },
  { key: 'users:manage', grp: 'Team', label: 'Add / edit / deactivate users', hard: true },
  { key: 'reports:dashboard', grp: 'Reports', label: 'Dashboard' },
  { key: 'reports:meca', grp: 'Reports', label: 'MECA performance report' },
  { key: 'reports:analytics', grp: 'Reports', label: 'Business Analytics' },
  { key: 'reports:monitor', grp: 'Reports', label: 'Live Team Monitor' },
  { key: 'reports:weekly', grp: 'Reports', label: 'Weekly Report' },
  { key: 'reports:export', grp: 'Reports', label: 'Reports & Export (Excel/CSV)' },
  { key: 'reports:audit', grp: 'Reports', label: 'Audit Log' },
  { key: 'tickets:manage', grp: 'Admin', label: 'Manage help tickets', hard: true },
  { key: 'settings:edit', grp: 'Admin', label: 'Edit settings / automation / access', hard: true },
  { key: 'config:builders', grp: 'Admin', label: 'Edit forms & pipeline stages', hard: true },
  { key: 'recycle:manage', grp: 'Admin', label: 'Recycle bin (restore / purge)', hard: true },
];

export const CONFIGURABLE_ROLES = ['md', 'tl', 'ldr', 'sales']; // admin hamesha sab, config nahi hota

/**
 * @param role   user ka role
 * @param perm   "resource:action"
 * @param cfg    useConfig() ka object — cfg.access.perms se admin ke overrides aate hain
 */
export function can(role, perm, cfg) {
  if (role === 'admin') return true;
  const base = ROLE_PERMS[role];
  if (base === '*') return true;
  // config/access.perms.{role}.{perm} = true/false — admin ke overrides (defaults ke upar)
  const ov = cfg?.access?.perms?.[role];
  if (ov && perm in ov) return !!ov[perm];
  return Array.isArray(base) && base.includes(perm);
}

/** Lead-list ka scope — kaunsi leads dikhengi. Rules bhi yahi enforce karti hain. */
export function leadScope(role) {
  if (role === 'admin' || role === 'md' || role === 'tl') return 'all';
  return 'own'; // ldr/sales — apni (ldr ko fresh-pool bhi, wo leads.js handle karta hai)
}

/** Kisi role ke saare effective permissions (defaults + overrides) — matrix render ke liye */
export function effectivePerms(role, cfg) {
  if (role === 'admin') return ALL_PERMS.map((p) => p.key);
  const set = new Set(ROLE_PERMS[role] || []);
  const ov = cfg?.access?.perms?.[role] || {};
  for (const [k, v] of Object.entries(ov)) { if (v) set.add(k); else set.delete(k); }
  return [...set];
}
