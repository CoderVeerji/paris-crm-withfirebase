# Workflow checklist — har phase se pehle yahi dekhna

**Rule:** koi bhi phase shuru karne se pehle, teeno role ka poora din ka kaam start-to-end likho aur har step ka button/screen tick karo. Ye galti dobara nahi (Add-Lead screen chhoot gaya tha kyunki workflow trace nahi kiya).

---

## LDR — daily

| # | Kaam | Screen / button | Status |
|---|------|-----------------|--------|
| 1 | Inquiry aayi (call / WhatsApp / walk-in) → **naya lead banao** | Leads → FAB **+** → New Lead sheet | ✅ |
| 2 | Naya lead banate waqt duplicate number | New Lead → auto dup-check → "open existing" / "mark urgent" | ✅ |
| 3 | Fresh pool dekho | Leads → **Fresh Pool** chip / menu | ✅ |
| 4 | Fresh lead uthao + call karo | tap card → **Call** button (tel:) | ✅ |
| 5 | Call ka result log karo (Call Back + date) | LeadSheet → Action tab → stage + date + remark | ✅ |
| 6 | Qualify + sales ko bhejo | Action → "Qualified" + (optional) assign / auto round-robin | ✅ |
| 7 | Dead / lost mark | Action → "Dead / Lost" | ✅ |
| 8 | Aaj ki pending calls | Leads → **Pending Calls** menu (followup due) | ✅ |
| 9 | Lead ki info galat (naam / phone) — theek karo | LeadSheet → Details → **Edit info** | ✅ |
| 10 | Attempt limit → auto review queue | ✅ auto-flag on Nth attempt + admin "give more attempts" |
| 11 | Attendance Present/Absent | ✅ Dashboard toggle (LDR/Sales self) + admin override |

## Sales — daily

| # | Kaam | Screen | Status |
|---|------|--------|--------|
| 1 | Naye qualified leads (mujhe assign) | menu **New Qualified Leads** | ✅ |
| 2 | Aaj ke followups | menu **My Follow-ups** | ✅ |
| 3 | Call → stage update (Followup / Hot / Video Call / Visit) | LeadSheet Action | ✅ |
| 4 | Order done → amount | Action → "Order Done" → ₹ amount | ✅ |
| 5 | Lost | Action → "Lost" | ✅ |
| 6 | Meri saari leads | menu **All My Leads** | ✅ |
| 7 | Walk-in / direct lead khud daalo | FAB **+** (sales → auto qualified + self-assigned) | ✅ |
| 8 | WhatsApp bhejo | card / sheet → WhatsApp button (wa.me) | ✅ |
| 9 | Notifications (nayi lead / SLA) | 🔔 bell (topbar) | ✅ in-app · ⏳ FCM push Phase 6 |
| 10 | Customer ki poori history (repeat buyer) | ✅ LeadSheet → Details → Order history section |

## Admin — daily / weekly

| # | Kaam | Screen | Status |
|---|------|--------|--------|
| 1 | Live team monitor | menu **Live Team Monitor** | ✅ |
| 2 | Weekly performance report | menu **Weekly Report** | ✅ |
| 3 | MECA scorecard | menu **MECA Report** | ✅ |
| 4 | Business analytics / trend | menu **Business Analytics** | ✅ |
| 5 | Data health — junk / overdue fix | menu **Data Health** → Leads select mode → bulk | ✅ |
| 6 | Naye users add / role / active-inactive / transfer leads | menu **Users & Team** | ✅ |
| 7 | Settings — sources, states, WA template, **SLA rules**, work hours | menu **System Settings** | ✅ |
| 8 | Form fields / pipeline stages | menu **Form / Stage Builder** | ✅ |
| 9 | Bulk import (CSV) | menu **Bulk Import** + sample file | ✅ |
| 10 | Bulk assign / archive / delete | Leads → ✓✓ select mode | ✅ |
| 11 | Recycle bin (restore) | menu **Recycle Bin** | ✅ |
| 12 | Audit log (kisne kya badla) | menu **Audit Log** | ✅ |
| 13 | Stats rebuild + re-score leads | Settings → bottom | ✅ |
| 14 | Manual re-assign / mark urgent from admin | ✅ LeadSheet → Details → Reassign (admin) |
| 15 | Duplicate merge tool | ✅ Data Health → Duplicate leads (scan + merge) |

---

## Bache hue (Phase 5b / 6)

- Customer 360 — ek phone/shop ki saari leads + orders + history
- Duplicate merge tool
- Manager review queue (attempt limit se pehle)
- Attendance toggle in UI
- Admin "manual re-assign" quick action
- FCM lock-screen push
- PWA install + offline queue
- Weekly report email (SMTP)
- Per-stage automation (e.g. "Video Call chunte hi 2 din baad ka followup auto")
