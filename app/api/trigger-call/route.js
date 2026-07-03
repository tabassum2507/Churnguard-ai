export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

// ─── KB feature → usage_events slug mapping ───────────────────────────────────
//
// Each entry is a feature article in rag/knowledge-base/ft-*.md.
// `slug` is the value that appears in usage_events.feature when a customer
// uses that feature. A null slug means usage can't be detected from events
// (the feature is always treated as potentially unused).
//
// Vapi's system prompt receives the unused list so Priya can organically ask
// "Have you had a chance to try [feature]?" — never as a forced sales pitch.
//
const KB_FEATURES = [
  { label: 'Custom Reports',         slug: 'reports'        },
  { label: 'API Access',             slug: 'api_access'     },
  { label: 'Slack Integration',      slug: 'integrations'   },
  { label: 'Team Collaboration',     slug: 'team_dashboard' },
  { label: 'Automated Alerts',       slug: null             },
  { label: 'Data Export Scheduling', slug: null             },
];

// ─── Context helpers ──────────────────────────────────────────────────────────

// Returns the number of whole days since the customer's most recent login,
// or null if no login appears in the provided event window.
function daysSinceLogin(events) {
  let latestMs = 0;
  for (const e of events) {
    if (e.event_type === 'login') {
      const ms = new Date(e.event_date).getTime();
      if (ms > latestMs) latestMs = ms;
    }
  }
  if (latestMs === 0) return null;
  return Math.floor((Date.now() - latestMs) / 86_400_000);
}

// Compares last-7-days activity count against a rolling weekly average of the
// prior 21 days. Returns a human-readable trend label for the system prompt.
function usageTrend(events) {
  const now = Date.now();
  const daysAgo = (s) => Math.floor((now - new Date(s).getTime()) / 86_400_000);
  const sum     = (arr) => arr.reduce((t, e) => t + (e.count ?? 0), 0);

  const recent = events.filter(e => daysAgo(e.event_date) <  7);
  const prior  = events.filter(e => { const d = daysAgo(e.event_date); return d >= 7 && d < 28; });

  const recentTotal      = sum(recent);
  const priorWeeklyAvg   = sum(prior) / 3; // 21 days ÷ 3 = weekly average

  if (priorWeeklyAvg === 0 && recentTotal === 0) return 'inactive';
  if (priorWeeklyAvg === 0)                       return 'recently activated';

  const ratio = recentTotal / priorWeeklyAvg;
  if (ratio >= 1.1)  return 'increasing';
  if (ratio >= 0.75) return 'stable';
  if (ratio >= 0.4)  return 'declining';
  return 'sharply declining';
}

// Returns display labels for KB features whose usage slug has not appeared
// in the customer's events. Capped at 3 to keep the prompt concise.
// Features with a null slug are always included (can't detect their usage).
function unusedFeatures(events) {
  const usedSlugs = new Set(
    events.filter(e => e.feature !== null).map(e => e.feature)
  );

  return KB_FEATURES
    .filter(f => f.slug === null || !usedSlugs.has(f.slug))
    .map(f => f.label)
    .slice(0, 3);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request) {
  const secret = request.headers.get('x-api-secret');
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let customer_id;
  try {
    ({ customer_id } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!customer_id) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // ── 1. Fetch customer ────────────────────────────────────────────────────────
  const { data: customer, error: customerErr } = await supabase
    .from('customers')
    .select('id, name, phone, company, plan, mrr, health_score, risk_level, last_contacted_at')
    .eq('id', customer_id)
    .single();

  if (customerErr) {
    const status = customerErr.code === 'PGRST116' ? 404 : 500;
    return NextResponse.json({ error: customerErr.message }, { status });
  }

  if (!customer.phone) {
    return NextResponse.json({ skipped: true, reason: 'No phone number on file' });
  }

  // 48-hour cooldown — mirrors the call_eligible check in churn-detection
  if (customer.last_contacted_at) {
    const hoursSince = (Date.now() - new Date(customer.last_contacted_at).getTime()) / 36e5;
    if (hoursSince < 48) {
      return NextResponse.json({
        skipped: true,
        reason:  `Last contacted ${Math.round(hoursSince)}h ago — within 48h cooldown`,
      });
    }
  }

  // ── 2. Fetch context data in parallel ────────────────────────────────────────
  //
  // 28 days covers: 7-day "recent" window + 21-day prior baseline for trend.
  // The same events array is reused for all three context computations.
  //
  const since28 = new Date(Date.now() - 28 * 86_400_000).toISOString().split('T')[0];
  const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString().split('T')[0];

  const [eventsRes, ticketsRes] = await Promise.all([
    supabase
      .from('usage_events')
      .select('event_type, feature, event_date, count')
      .eq('customer_id', customer_id)
      .gte('event_date', since28),

    supabase
      .from('support_tickets')
      .select('id')
      .eq('customer_id', customer_id)
      .in('status', ['open', 'escalated'])
      .gte('created_at', `${since14}T00:00:00Z`),
  ]);

  if (eventsRes.error)  throw eventsRes.error;
  if (ticketsRes.error) throw ticketsRes.error;

  const events  = eventsRes.data  ?? [];
  const tickets = ticketsRes.data ?? [];

  // ── 3. Compute all variable values ──────────────────────────────────────────
  const loginDays    = daysSinceLogin(events);
  const trend        = usageTrend(events);
  const unused       = unusedFeatures(events);

  const variableValues = {
    customer_name:    customer.name,
    company:          customer.company,
    plan:             customer.plan,
    days_since_login: loginDays !== null ? String(loginDays) : 'more than 28',
    usage_trend:      trend,
    open_tickets:     String(tickets.length),
    unused_features:  unused.length > 0 ? unused.join(', ') : 'none — all key features are in use',
  };

  // ── 4. Create the Vapi outbound call ─────────────────────────────────────────
  //
  // POST /call is the current Vapi endpoint for all call types (replaced the
  // older /call/phone). type:'outboundPhoneCall' is required.
  //
  let vapiCall;
  try {
    const vapiRes = await fetch('https://api.vapi.ai/call', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        type:          'outboundPhoneCall',
        name:          `ChurnGuard — ${customer.name} (${customer.plan})`,
        assistantId:   process.env.VAPI_ASSISTANT_ID,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: {
          number:                  customer.phone,
          name:                    customer.name,
          numberE164CheckEnabled:  true,
        },
        assistantOverrides: { variableValues },
      }),
    });

    if (!vapiRes.ok) {
      const body = await vapiRes.text();
      return NextResponse.json(
        { error: `Vapi API error ${vapiRes.status}`, detail: body },
        { status: 502 }
      );
    }

    vapiCall = await vapiRes.json();
  } catch (fetchErr) {
    return NextResponse.json(
      { error: 'Failed to reach Vapi API', detail: fetchErr.message },
      { status: 502 }
    );
  }

  // ── 5. Persist rescue_call row + stamp last_contacted_at ────────────────────
  //
  // Both writes go out in parallel. The rescue_calls row uses status='initiated'
  // (added via migration 002). The call-ended webhook will upsert it to the
  // final status once Vapi sends the end-of-call-report.
  //
  const [rescueRes] = await Promise.all([
    supabase
      .from('rescue_calls')
      .insert({
        customer_id:  customer.id,
        vapi_call_id: vapiCall.id,
        call_status:  'initiated',
        outcome:      'pending',
      })
      .select('id')
      .single(),

    supabase
      .from('customers')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', customer_id),
  ]);

  if (rescueRes.error) {
    // The Vapi call is already placed — log but don't fail the response.
    // The call-ended webhook will create the row via upsert when the call finishes.
    console.error('[trigger-call] rescue_calls insert failed:', rescueRes.error.message);
  }

  // ── 6. Return call details ────────────────────────────────────────────────────
  return NextResponse.json({
    success:        true,
    vapi_call_id:   vapiCall.id,
    rescue_call_id: rescueRes.data?.id ?? null,
    customer: {
      id:    customer.id,
      name:  customer.name,
      phone: customer.phone,
      plan:  customer.plan,
    },
    context: variableValues,
  });
}
