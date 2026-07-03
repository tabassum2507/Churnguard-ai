export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function POST(request) {
  const secret = request.headers.get('x-api-secret');
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { customer_id } = await request.json();
    if (!customer_id) {
      return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: customer, error: lookupErr } = await supabase
      .from('customers')
      .select('id, name, phone, plan, mrr, health_score, risk_level, last_contacted_at')
      .eq('id', customer_id)
      .single();

    if (lookupErr) throw lookupErr;

    if (!customer.phone) {
      return NextResponse.json({ skipped: true, reason: 'No phone number on file' });
    }

    // Enforce 48-hour cooldown — churn detection sets call_eligible using this same window
    if (customer.last_contacted_at) {
      const hoursSince = (Date.now() - new Date(customer.last_contacted_at).getTime()) / 36e5;
      if (hoursSince < 48) {
        return NextResponse.json({
          skipped: true,
          reason: `Last contacted ${Math.round(hoursSince)}h ago — within 48h cooldown`,
        });
      }
    }

    const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        assistantId:   process.env.VAPI_ASSISTANT_ID,
        customer: {
          number: customer.phone,
          name:   customer.name,
        },
        // Inject customer context so the assistant can personalise the conversation
        // Reference these in the system prompt with {{customerName}}, {{customerPlan}}, etc.
        assistantOverrides: {
          variableValues: {
            customerName:  customer.name,
            customerPlan:  customer.plan,
            customerMrr:   customer.mrr,
            healthScore:   customer.health_score,
            riskLevel:     customer.risk_level,
          },
        },
      }),
    });

    if (!vapiRes.ok) {
      const vapiErr = await vapiRes.text();
      throw new Error(`Vapi returned ${vapiRes.status}: ${vapiErr}`);
    }

    const vapiCall = await vapiRes.json();

    // Stamp now so churn detection skips this customer for the next 48h
    await supabase
      .from('customers')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', customer_id);

    return NextResponse.json({
      success:      true,
      vapi_call_id: vapiCall.id,
      customer_id:  customer.id,
      customer_name: customer.name,
    });

  } catch (err) {
    console.error('[trigger-call]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
