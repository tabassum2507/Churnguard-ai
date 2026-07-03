export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

// Maps Vapi's endedReason string to the call_status_type enum
function mapCallStatus(endedReason) {
  if (!endedReason) return 'failed';
  const r = endedReason.toLowerCase();
  if (r.includes('voicemail'))                                              return 'voicemail';
  if (r.includes('no-answer') || r.includes('busy') || r.includes('did-not-answer')) return 'no_answer';
  if (r.includes('ended') || r.includes('complete') || r.includes('hangup')) return 'completed';
  return 'failed';
}

// Vapi successEvaluation is a string 'true'/'false' or a boolean
function mapOutcome(successEvaluation) {
  return (successEvaluation === 'true' || successEvaluation === true) ? 'saved' : 'pending';
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request) {
  // Optional: verify webhook secret set in the Vapi dashboard
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
  if (webhookSecret) {
    const incoming = request.headers.get('x-vapi-secret');
    if (incoming !== webhookSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ received: true });
  }

  // Vapi sends several event types to the same webhook URL; we only care about end-of-call-report
  if (body?.message?.type !== 'end-of-call-report') {
    return NextResponse.json({ received: true });
  }

  try {
    const msg      = body.message;
    const call     = msg.call     ?? {};
    const analysis = msg.analysis ?? {};
    const artifact = msg.artifact ?? {};

    const vapiCallId    = call.id;
    const customerPhone = call.customer?.number;

    if (!vapiCallId || !customerPhone) {
      return NextResponse.json({ received: true, note: 'Missing call.id or customer.number — skipped' });
    }

    let callDuration = null;
    if (call.startedAt && call.endedAt) {
      callDuration = Math.round(
        (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
      );
    }

    const supabase = createAdminClient();

    const { data: customer, error: lookupErr } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', customerPhone)
      .maybeSingle();

    if (lookupErr) throw lookupErr;

    if (!customer) {
      console.warn(`[call-ended] No customer found for phone ${customerPhone}`);
      return NextResponse.json({ received: true, note: 'Customer not found — skipped' });
    }

    const callStatus = mapCallStatus(msg.endedReason);
    let   outcome    = mapOutcome(analysis.successEvaluation);

    // If the escalate tool was used during this call, override the outcome
    const callStart = call.startedAt ? new Date(call.startedAt).toISOString()
                                     : new Date(Date.now() - 3_600_000).toISOString();

    const { count: escalationCount } = await supabase
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customer.id)
      .eq('status', 'escalated')
      .gte('created_at', callStart);

    if (escalationCount > 0) outcome = 'escalated';

    // Upsert so re-delivered webhooks are idempotent
    const { error: upsertErr } = await supabase
      .from('rescue_calls')
      .upsert(
        {
          customer_id:      customer.id,
          vapi_call_id:     vapiCallId,
          call_status:      callStatus,
          call_duration:    callDuration,
          outcome,
          transcript:       artifact.transcript  ?? null,
          solution_offered: analysis.summary     ?? null,
        },
        { onConflict: 'vapi_call_id' }
      );

    if (upsertErr) throw upsertErr;

    return NextResponse.json({ received: true });

  } catch (err) {
    console.error('[vapi/call-ended]', err.message);
    // Always return 200 — non-200 causes Vapi to retry which can create duplicates
    return NextResponse.json({ received: true, error: err.message });
  }
}
