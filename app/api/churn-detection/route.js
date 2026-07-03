export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

// ─── Signal catalogue ─────────────────────────────────────────────────────────
//
// Each signal represents one measurable warning sign of churn.
// weight = points deducted from the base health score of 100 when the signal
// fires. Weights sum to 100 so a customer triggering everything scores 0.
//
const SIGNALS = {
  LOGIN_DROP: {
    weight: 30,
    label:  'Login frequency dropped >50 % vs 3-week average',
  },
  NO_RECENT_LOGIN: {
    weight: 25,
    label:  'No login in the last 7 days',
  },
  FEATURE_STALL: {
    weight: 15,
    label:  'No feature usage in the last 14 days (was active before)',
  },
  TICKET_SPIKE: {
    weight: 15,
    label:  '2+ open / escalated tickets created in the last 14 days',
  },
  LOW_ENGAGEMENT: {
    weight: 15,
    label:  'Fewer than 3 total interactions in the last 7 days',
  },
};

// ─── Risk tier mapping ────────────────────────────────────────────────────────

// Boundary raised from ≥70 to ≥75 for 'low':
// LOGIN_DROP alone deducts 30 pts → health 70. Under ≥70='low' that incorrectly
// reads as healthy. ≥75 moves a score of 70 into 'medium' where it belongs.
function getRiskLevel(score) {
  if (score >= 75) return 'low';
  if (score >= 50) return 'medium';
  if (score >= 30) return 'high';
  return 'critical';
}

// ─── Signal detection ─────────────────────────────────────────────────────────
//
// Analyses one customer's last 28 days of events and their recent open tickets.
// Returns an array of the signal keys that fired.
//
function detectSignals(events, recentTickets) {
  const now      = Date.now();
  const MS_PER_DAY = 86_400_000;

  // Converts a DATE string ("2025-06-20") to how many complete days ago it was.
  // DATE columns parse as UTC midnight, which is consistent across time zones.
  const daysAgo = (dateStr) =>
    Math.floor((now - new Date(dateStr).getTime()) / MS_PER_DAY);

  // ── Time-window buckets ───────────────────────────────────────────────────
  const last7    = events.filter(e => daysAgo(e.event_date) <  7);
  const last14   = events.filter(e => daysAgo(e.event_date) <  14);
  const before14 = events.filter(e => daysAgo(e.event_date) >= 14);

  // Three non-overlapping prior weeks used as the login-frequency baseline.
  // Spreading across 3 weeks smooths out holiday/seasonal dips.
  const week1 = events.filter(e => { const d = daysAgo(e.event_date); return d >=  7 && d < 14; });
  const week2 = events.filter(e => { const d = daysAgo(e.event_date); return d >= 14 && d < 21; });
  const week3 = events.filter(e => { const d = daysAgo(e.event_date); return d >= 21 && d < 28; });

  // Sum the `count` column — each row is an aggregated daily total, not one event
  const sumCount = (arr) => arr.reduce((acc, e) => acc + (e.count ?? 0), 0);
  const logins   = (arr) => arr.filter(e => e.event_type === 'login');

  const triggered = [];

  // ── Signal 1: LOGIN_DROP ────────────────────────────────────────────────
  //
  // A drop of ≥50 % vs the rolling average is our threshold — small dips are
  // noise; halving login frequency is a strong intent-to-leave signal.
  //
  // Only fires when a meaningful baseline exists (>0) to avoid false positives
  // for brand-new customers who haven't established a pattern yet.
  //
  const recentLoginCount  = sumCount(logins(last7));
  const avgWeeklyLogins   = (sumCount(logins(week1)) + sumCount(logins(week2)) + sumCount(logins(week3))) / 3;

  if (avgWeeklyLogins > 0 && recentLoginCount < avgWeeklyLogins * 0.5) {
    triggered.push('LOGIN_DROP');
  }

  // ── Signal 2: NO_RECENT_LOGIN ───────────────────────────────────────────
  //
  // A binary check: has the customer opened the product at all this week?
  // Can co-fire with LOGIN_DROP to amplify severity (both signals deducted).
  //
  if (!last7.some(e => e.event_type === 'login')) {
    triggered.push('NO_RECENT_LOGIN');
  }

  // ── Signal 3: FEATURE_STALL ─────────────────────────────────────────────
  //
  // Measures whether the customer has stopped exploring the product.
  // We only flag this when they WERE using features (historicalFeatures.size > 0)
  // — a stall from a previously active state is far more meaningful than a
  // customer who never adopted features in the first place.
  //
  const features        = (arr) => arr.filter(e => e.event_type === 'feature_use' && e.feature);
  const recentFeatures  = new Set(features(last14).map(e => e.feature));
  const historicFeatures = new Set(features(before14).map(e => e.feature));

  if (historicFeatures.size > 0 && recentFeatures.size === 0) {
    triggered.push('FEATURE_STALL');
  }

  // ── Signal 4: TICKET_SPIKE ──────────────────────────────────────────────
  //
  // Support tickets are a leading indicator — customers who file multiple
  // tickets in a short window are often frustrated and considering leaving.
  // A single ticket is normal; two or more in 14 days is the alert threshold.
  //
  if (recentTickets.length >= 2) {
    triggered.push('TICKET_SPIKE');
  }

  // ── Signal 5: LOW_ENGAGEMENT ────────────────────────────────────────────
  //
  // Catches customers who may still log in occasionally but barely touch the
  // product. Summing the `count` column captures true interaction volume
  // (e.g., 10 API calls on one day = count of 10, not count of 1 row).
  // <3 total interactions in a week means effectively idle.
  //
  if (sumCount(last7) < 3) {
    triggered.push('LOW_ENGAGEMENT');
  }

  return triggered;
}

// ─── Batch update helper ──────────────────────────────────────────────────────
//
// Supabase doesn't support multi-row UPDATEs with different values per row, so
// we run individual updates in parallel — but capped to 10 concurrent requests
// to stay within connection pool limits.
//
async function batchUpdate(supabase, updates, concurrency = 10) {
  for (let i = 0; i < updates.length; i += concurrency) {
    await Promise.all(
      updates.slice(i, i + concurrency).map(({ id, health_score, risk_level }) =>
        supabase
          .from('customers')
          .update({ health_score, risk_level })
          .eq('id', id)
      )
    );
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request) {
  // Guard: only n8n (or authorised callers) may trigger detection runs.
  // The secret is set as an env var and sent as a custom header from n8n.
  const incomingSecret = request.headers.get('x-api-secret');
  if (!incomingSecret || incomingSecret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  try {
    // Date boundaries for our queries (ISO date strings, e.g. "2025-06-20")
    const daysAgoStr = (n) =>
      new Date(Date.now() - n * 86_400_000).toISOString().split('T')[0];

    const since28days = daysAgoStr(28); // covers all 5 signal windows
    const since14days = daysAgoStr(14); // ticket-spike window

    // ── Fetch everything in parallel ────────────────────────────────────────
    const [customersRes, eventsRes, ticketsRes] = await Promise.all([
      supabase
        .from('customers')
        .select('id, name, phone, plan, mrr, last_contacted_at'),

      // 28 days of events is enough for: 7-day recent window + 3 × 7-day baseline
      supabase
        .from('usage_events')
        .select('customer_id, event_type, feature, event_date, count')
        .gte('event_date', since28days),

      // Only open/escalated tickets — resolved tickets no longer signal friction
      supabase
        .from('support_tickets')
        .select('customer_id, status, created_at')
        .in('status', ['open', 'escalated'])
        .gte('created_at', since14days + 'T00:00:00Z'),
    ]);

    if (customersRes.error) throw customersRes.error;
    if (eventsRes.error)    throw eventsRes.error;
    if (ticketsRes.error)   throw ticketsRes.error;

    const customers  = customersRes.data;
    const allEvents  = eventsRes.data;
    const allTickets = ticketsRes.data;

    // ── Index by customer_id for O(1) lookup ────────────────────────────────
    const eventsByCustomer  = {};
    const ticketsByCustomer = {};

    for (const e of allEvents)  (eventsByCustomer[e.customer_id]  ??= []).push(e);
    for (const t of allTickets) (ticketsByCustomer[t.customer_id] ??= []).push(t);

    // ── Score every customer ─────────────────────────────────────────────────
    const results = customers.map((customer) => {
      const events  = eventsByCustomer[customer.id]  ?? [];
      const tickets = ticketsByCustomer[customer.id] ?? [];

      const triggered    = detectSignals(events, tickets);
      const deduction    = triggered.reduce((sum, key) => sum + SIGNALS[key].weight, 0);
      const health_score = Math.max(0, 100 - deduction);
      const risk_level   = getRiskLevel(health_score);

      return { ...customer, health_score, risk_level, triggered };
    });

    // ── Persist updated scores ──────────────────────────────────────────────
    await batchUpdate(supabase, results);

    // ── Build the flagged list for n8n ──────────────────────────────────────
    //
    // n8n iterates this array and fires a Vapi call for each entry where
    // call_eligible is true. We include customers not contacted in the last
    // 48 h to avoid hammering the same person on repeated detection runs.
    //
    const cutoff48h = new Date(Date.now() - 48 * 3_600_000).toISOString();

    const flagged = results
      .filter(c => c.risk_level === 'high' || c.risk_level === 'critical')
      .map(c => ({
        id:                c.id,
        name:              c.name,
        phone:             c.phone,
        plan:              c.plan,
        mrr:               c.mrr,
        health_score:      c.health_score,
        risk_level:        c.risk_level,
        triggered_signals: c.triggered.map(key => ({
          key,
          label:  SIGNALS[key].label,
          weight: SIGNALS[key].weight,
        })),
        // True when: never called before  OR  last call was >48 h ago
        call_eligible:     c.last_contacted_at === null || c.last_contacted_at < cutoff48h,
        last_contacted_at: c.last_contacted_at,
      }));

    return NextResponse.json({ processed: results.length, flagged });

  } catch (err) {
    console.error('[churn-detection]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
