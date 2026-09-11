// Lead scoring — form answers se auto priority. Config/scoring doc se override ho sakta hai (baad me).
// Har rule: field label -> { answer substring : points }. Substring match (case-insensitive).

export const DEFAULT_RULES = {
  'Customer Type': {
    'existing shop': 30, 'boutique': 26, 'online seller': 20, 'reseller': 20,
    'new business': 10, 'personal use': -25,
  },
  'Bulk Requirement?': { 'yes': 25, 'no': -5 },
  'Approx Quantity Interested In': { '50+': 32, '20–50': 20, '20-50': 20, '10–20': 10, '10-20': 10, 'under 10': -12 },
  'Buying Intent': { 'immediate': 30, 'exploring': 6, 'future': 0 },
  'Customer Interested In': { 'visit store': 22, 'video call': 16, 'whatsapp catalog': 6, 'not interested': -30 },
  'Purchase Capacity / Budget': {}, // numeric — handled separately
};

export function computeScore(lead, rules = DEFAULT_RULES) {
  const ans = lead.form_answers || {};
  // flat f_* fields se bhi (migration ne ye bhare hain)
  const flat = {
    'Customer Type': lead.f_customer_type, 'Bulk Requirement?': lead.f_bulk,
    'Buying Intent': lead.f_intent, 'Customer Interested In': lead.f_interested_in,
    'Approx Quantity Interested In': lead.f_quantity,
  };
  let score = 0;
  for (const [label, map] of Object.entries(rules)) {
    const val = String(ans[label] ?? flat[label] ?? '').toLowerCase();
    if (!val) continue;
    for (const [needle, pts] of Object.entries(map)) {
      if (val.includes(String(needle).toLowerCase())) { score += pts; break; }
    }
  }
  // numeric budget bonus
  const budget = Number(String(ans['Purchase Capacity / Budget'] || '').replace(/[^\d]/g, ''));
  if (budget >= 100000) score += 25;
  else if (budget >= 30000) score += 12;

  // repeat customer bonus
  if (lead.order_count > 0) score += 15;

  const tier = score >= 55 ? 'hot' : score >= 22 ? 'warm' : 'cold';
  return { score, tier };
}

export const TIER_LABEL = { hot: 'HOT', warm: 'WARM', cold: 'COLD' };
export const TIER_CLASS = { hot: 'tier-hot', warm: 'tier-warm', cold: 'tier-cold' };
