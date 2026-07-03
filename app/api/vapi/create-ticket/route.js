export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

    const { customer_phone, subject, priority } = args;
    if (!customer_phone || !subject) {
      throw new Error('Missing required args: customer_phone, subject');
    }

    const safePhone    = String(customer_phone).trim();
    const safePriority = ['low', 'medium', 'high'].includes(priority) ? priority : 'medium';

    const supabase = createAdminClient();

    // ── Look up customer by phone ──────────────────────────────────────────────
    const { data: customer, error: lookupErr } = await supabase
      .from('customers')
      .select('id, name')
      .eq('phone', safePhone)
      .maybeSingle();

    if (lookupErr) throw lookupErr;

    if (!customer) {
      return NextResponse.json({
        results: [{
          toolCallId,
          result: "I couldn't find your account in our system. Could you double-check the phone number associated with your FlowMetric account?",
        }],
      });
    }

    // ── Create the support ticket ──────────────────────────────────────────────
    const { data: ticket, error: ticketErr } = await supabase
      .from('support_tickets')
      .insert({
        customer_id: customer.id,
        subject:     String(subject).trim(),
        status:      'open',
        priority:    safePriority,
      })
      .select('id')
      .single();

    if (ticketErr) throw ticketErr;

    // ── Log the interaction as a customer touchpoint ───────────────────────────
    // This gives the CS team a timeline of all customer contact across channels.
    const { error: touchpointErr } = await supabase
      .from('customer_touchpoints')
      .insert({
        customer_id: customer.id,
        channel:     'voice',
        content:     `Ticket created: ${subject}`,
        status:      'sent',
      });

    if (touchpointErr) {
      // Log but don't fail — the ticket is already created and is the priority
      console.warn('[create-ticket] touchpoint insert failed:', touchpointErr.message);
    }

    // First 8 chars of the UUID are unique enough to quote on a call
    const ref = ticket.id.replace(/-/g, '').slice(0, 8).toUpperCase();

    return NextResponse.json({
      results: [{
        toolCallId,
        result: `Done. I've created a support ticket for you. Your reference number is ${ref}. Our team will follow up within one business day.`,
      }],
    });

  } catch (err) {
    console.error('[vapi/create-ticket]', err.message);
    return NextResponse.json({
      results: [{
        toolCallId,
        result: "I wasn't able to create the ticket right now due to a technical issue. Please try again in a moment, or I can escalate this to a specialist instead.",
      }],
    });
  }
}
