# Cost audit — Sep 2026 (pre-launch)

## Verdict: the ₹4.28 on the bill is 100% one-time development + migration cost (Sep 3–7). Steady-state = ₹0.

Every ongoing usage metric was pulled from the GCP Monitoring API and is at **1–5 % of the free tier**. Nothing bills continuously. The "it keeps growing when I refresh" is GCP's billing pipeline lag — usage is finalized 6–24 h later, so the month-to-date figure creeps up for a day or two after the actual spend, then stops.

### Where the ₹4.28 came from

| Line item | ₹ | Cause | Recurring? |
|---|---|---|---|
| **Cloud Functions** | 3.57 | **Cloud Build minutes** — the functions container is recompiled and redeployed on every `firebase deploy --only functions`. **42 builds Sep 4–8; Sep 4 alone = 49 build-minutes** (first-ever deploys: full `npm install`, no buildpack cache). Later builds are ~30 s each. Function *compute* = 5,456 vCPU-s / 1,040 GiB-s for the whole week = **3 % / 0.3 % of the monthly free grant**. Invocations 8.1 K / 2 M. | **No** — stops when we stop redeploying. |
| **Cloud Firestore** | 0.71 | Sep 3–4: the migration test-import + two `backfill-*.js` runs (2,500 docs each) + the duplicate-scan tool pushed **reads to 45–61 K/day** (free = 50 K) and **writes to 18 K/day** (free = 20 K). Over on 2 days only. | **No** — normal team usage is a fraction of this. |

### Proven NOT to be the cause
- **min-instances**: 0 on every function (all scale to zero) — checked via Cloud Run API.
- **Cloud Scheduler**: exactly 3 jobs = the free limit. The old ~₹17/mo (jobs #4–5) is already gone.
- **Cloud Run compute**: 5.5 K vCPU-s/week, ~20 K/month projected = 11 % of the 180 K free.
- **Artifact Registry**: 362 MB (free 500 MB), 3-day auto-cleanup policy active.
- **Cloud Logging**: 0.01 GB ingested (free 50 GB).
- **Network egress** (functions → NVIDIA / Gmail): 4.7 MB.
- **Eventarc / Pub/Sub**: event volume is a rounding error against the 6 M free.
- **Firestore storage**: DB is ~tens of MB (free 1 GB).

## Hard rules (keep it at ₹0)

1. **Never add a 4th `onSchedule` function.** Only 3 Cloud Scheduler jobs are free. New time-based work folds into `slaScan` or `dailyMaintenance`.
2. **Batch function deploys.** `firebase deploy --only functions` once, not one function at a time repeatedly — each deploy is a Cloud Build. During heavy dev this is the #1 cost.
3. **Backfill / migration / scan scripts are the Firestore cost.** They read/write thousands of docs. Run them deliberately, not casually. The one-time `migrate:wipe` at go-live is ~33 K writes + 33 K deletes ≈ **one-time ~₹5–20** for that day (expected).
4. Never pull a whole collection to the browser (the 9.6 MB getLeads incident).

## Optimisation applied

- **`slaScan` frequency `every 10 min` → `every 15 min`.** It was the single biggest function-compute slice (2,713 of 5,456 vCPU-s = 50 %, almost all cold-start overhead from running so often). 15-min cadence still satisfies the "5-minute nudge" rule (it fires within 5–20 min of the deadline) and cuts that compute by a third. Still 1 scheduler job.
- Morning brief + first-contact SLA folded into `slaScan` (no new job).
- All `slaScan` queries `limit ≤ 50` with time-window floors so alerted docs age out instead of being re-read forever.

## If a charge still appears after go-live

Pull the SKU-level breakdown (GCP Console → Billing → Reports → group by SKU). At the team's scale (25 users, ~11 K leads, normal daily calling) the free tier is not close to being exhausted — the dashboards read pre-aggregated `stats_daily` (1 read/day-of-range), lists are paginated + cached, counts use `getCountFromServer` (1 read).
