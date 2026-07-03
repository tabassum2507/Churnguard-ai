export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

// ─── Vapi request parser (see search-kb/route.js for format notes) ────────────
function parseToolCall(body) {
  const msg = body?.message ?? {};

  if (msg.toolCallList?.length) {
    const tc = msg.toolCallList[0];
    return { toolCallId: tc.id, args: tc.arguments ?? {} };
  }

  if (msg.toolCalls?.length) {
    const tc   = msg.toolCalls[0];
    const raw  = tc.function?.arguments;
    const args = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
    return { toolCallId: tc.id, args };
  }

  throw new Error('No tool call found in request body');
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request) {
  let toolCallId = 'unknown';

  try {
    const body = await request.json();
    const { toolCallId: id, args } = parseToolCall(body);
    toolCallId = id;

    const { customer_phone, reason } = args;
    if (!customer_phone || !reason) {
      throw new Error('Missing required args: customer_phone, reason');
    }

    const safePhone  = String(customer_phone).trim();
    const safeReason = String(reason).trim();

    const supabase = createAdminClient();

    // ── Look up customer ───────────────────────────────────────────────────────
    const { data: customer, error: lookupErr } = await supabase
      .from('customers')
      .select('id, name, plan, mrr')
      .eq('phone', safePhone)
      .maybeSingle();

    if (lookupErr) throw lookupErr;

    if (!customer) {
      return NextResponse.json({
        results: [{
          toolCallId,
          result: "I've flagged this for our team, but I couldn't locate your account to attach it to. A specialist will still reach out — please check your email.",
        }],
      });
    }

    // ── Create an escalated support ticket ────────────────────────────────────
    // Escalated status routes this into the CS team's priority queue
    const { data: ticket, error: ticketErr } = await supabase
      .from('support_tickets')
      .insert({
        customer_id: customer.id,
        subject:     `Escalation via voice call: ${safeReason}`,
        status:      'escalated',
        priority:    'high',
      })
      .select('id')
      .single();

    if (ticketErr) throw ticketErr;

    // ── Log the touchpoint ────────────────────────────────────────────────────
    const { error: touchpointErr } = await supabase
      .from('customer_touchpoints')
      .insert({
        customer_id: customer.id,
        channel:     'voice',
        content:     `Escalated to human: ${safeReason}`,
        status:      'sent',
      });

    if (touchpointErr) {
      console.warn('[escalate] touchpoint insert failed:', touchpointErr.message);
    }

    // ── Fire n8n Workflow 5 webhook ───────────────────────────────────────────
    //
    // n8n picks this up and handles the Slack alert to the CS team, the
    // calendar invite, and the customer follow-up email.
    // If the URL isn't configured yet we log a warning but don't fail the call.
    //
    const webhookUrl = process.env.N8N_ESCALATION_WEBHOOK;

    if (webhookUrl) {
      try {
        const webhookRes = await fetch(webhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id:                    customer.id,
            customer_name:                  customer.name,
            customer_phone:                 safePhone,
            customer_plan:                  customer.plan,
            customer_mrr:                   customer.mrr,
            reason:                         safeReason,
            ticket_id:                      ticket.id,
            // Vapi can inject a transcript snippet here once the call ends
            transcript_snippet_placeholder: null,
          }),
        });

        if (!webhookRes.ok) {
          console.warn(`[escalate] n8n webhook returned ${webhookRes.status}`);
        }
      } catch (webhookErr) {
        // The escalation record is in Supabase — don't break the call over this
        console.warn('[escalate] n8n webhook request failed:', webhookErr.message);
      }
    } else {
      console.warn('[escalate] N8N_ESCALATION_WEBHOOK is not set — skipping webhook. Set it when you build n8n Workflow 5.');
    }

    // Fixed response string — consistent tone regardless of what happened above
    return NextResponse.json({
      results: [{
        toolCallId,
        result: "I've notified our customer success team. A specialist will reach out within one business day to make sure everything gets sorted out for you.",
      }],
    });

  } catch (err) {
    console.error('[vapi/escalate]', err.message);
    return NextResponse.json({
      results: [{
        toolCallId,
        result: "I've noted your concern and our team will follow up with you. I'm sorry for the trouble you're experiencing.",
      }],
    });
  }
}
