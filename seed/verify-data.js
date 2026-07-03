#!/usr/bin/env node
'use strict';

// ─── Load .env.local ──────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

const envFile = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq  = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = (n)           => n.toLocaleString('en-IN');
const bar  = (n, max, w=28)=> '█'.repeat(Math.round((n / Math.max(max, 1)) * w)).padEnd(w);
const rule = (char = '─', w = 62) => char.repeat(w);

function dateNDaysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function daysAgoFromDateStr(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today - new Date(dateStr)) / 86_400_000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('✗  Missing Supabase env vars. Fill in .env.local first.');
    process.exit(1);
  }

  const header = '  ChurnGuard AI — Data Verification Report';
  const ts     = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  console.log('\n' + rule('═'));
  console.log(header);
  console.log(`  Generated: ${ts}`);
  console.log(rule('═') + '\n');

  // ── 1. Customer distribution ──────────────────────────────────────────────
  const { data: customers, error: custErr } = await supabase
    .from('customers')
    .select('id, name, risk_level, plan, mrr, health_score');
  if (custErr) throw custErr;

  const buckets = { low: [], medium: [], high: [], critical: [] };
  for (const c of customers) (buckets[c.risk_level] ??= []).push(c);

  const riskMeta = {
    low:      { label: 'HEALTHY',   arch: 'low risk  / daily users'       },
    medium:   { label: 'DECLINING', arch: 'medium   / usage dropping'     },
    high:     { label: 'AT_RISK',   arch: 'high     / gone silent 7-10d'  },
    critical: { label: 'CRITICAL',  arch: 'critical / gone silent 14d+'   },
  };

  const maxBucket = Math.max(...Object.values(buckets).map(a => a.length));

  console.log(rule() + '\n  CUSTOMERS BY RISK LEVEL\n' + rule());
  for (const [risk, { label }] of Object.entries(riskMeta)) {
    const n = buckets[risk].length;
    console.log(`  ${label.padEnd(10)} (${risk.padEnd(8)})  ${String(n).padStart(2)}  ${bar(n, maxBucket)}`);
  }
  console.log(`  ${''.padEnd(22)}  ──`);
  console.log(`  ${'Total'.padEnd(22)}  ${customers.length}\n`);

  // ── 2. Usage events ────────────────────────────────────────────────────────
  const [
    { count: evtTotal,  error: e1 },
    { count: loginTotal,error: e2 },
    { count: featTotal, error: e3 },
    { count: apiTotal,  error: e4 },
    { count: exportTotal,error:e5 },
    { data: minRow },
    { data: maxRow },
    { data: allCustIds },
  ] = await Promise.all([
    supabase.from('usage_events').select('*', { count: 'exact', head: true }),
    supabase.from('usage_events').select('*', { count: 'exact', head: true }).eq('event_type', 'login'),
    supabase.from('usage_events').select('*', { count: 'exact', head: true }).eq('event_type', 'feature_use'),
    supabase.from('usage_events').select('*', { count: 'exact', head: true }).eq('event_type', 'api_call'),
    supabase.from('usage_events').select('*', { count: 'exact', head: true }).eq('event_type', 'export'),
    supabase.from('usage_events').select('event_date').order('event_date', { ascending: true  }).limit(1),
    supabase.from('usage_events').select('event_date').order('event_date', { ascending: false }).limit(1),
    supabase.from('usage_events').select('customer_id').limit(10000),
  ]);
  for (const err of [e1,e2,e3,e4,e5]) if (err) throw err;

  const distinctCustomers = new Set(allCustIds.map(r => r.customer_id)).size;
  const minDate = minRow[0]?.event_date ?? 'n/a';
  const maxDate = maxRow[0]?.event_date ?? 'n/a';

  console.log(rule() + '\n  USAGE EVENTS\n' + rule());
  console.log(`  Total events    : ${fmt(evtTotal)}`);
  console.log(`    login         : ${fmt(loginTotal)}`);
  console.log(`    feature_use   : ${fmt(featTotal)}`);
  console.log(`    api_call      : ${fmt(apiTotal)}`);
  console.log(`    export        : ${fmt(exportTotal)}`);
  console.log(`  Date range      : ${minDate} → ${maxDate}`);
  console.log(`  Customers active: ${distinctCustomers} / ${customers.length}\n`);

  // ── 3. Support tickets ─────────────────────────────────────────────────────
  const { data: tickets, error: tickErr } = await supabase
    .from('support_tickets')
    .select('status, priority');
  if (tickErr) throw tickErr;

  const byStatus   = {};
  const byPriority = {};
  for (const t of tickets) {
    byStatus[t.status]     = (byStatus[t.status]     ?? 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
  }

  console.log(rule() + '\n  SUPPORT TICKETS\n' + rule());
  for (const [s, n] of Object.entries(byStatus)) {
    console.log(`  ${s.padEnd(12)}: ${n}`);
  }
  console.log(`  ${'Total'.padEnd(12)}: ${tickets.length}`);
  console.log(`  Priority  — high: ${byPriority.high ?? 0}  medium: ${byPriority.medium ?? 0}  low: ${byPriority.low ?? 0}\n`);

  // ── 4. Login trends for 3 sample customers ─────────────────────────────────
  // One representative from each of: HEALTHY, DECLINING, CRITICAL
  const samples = [
    buckets.low[0],
    buckets.medium[0],
    buckets.critical[0],
  ].filter(Boolean);

  const { data: loginEvents, error: loginErr } = await supabase
    .from('usage_events')
    .select('customer_id, event_date, count')
    .in('customer_id', samples.map(c => c.id))
    .eq('event_type', 'login')
    .gte('event_date', dateNDaysAgo(29));
  if (loginErr) throw loginErr;

  // Bin each login event into one of 4 weekly buckets (0 = oldest, 3 = newest)
  const loginsByCustomer = {};
  for (const { customer_id, event_date, count } of loginEvents) {
    const ago  = daysAgoFromDateStr(event_date);
    const week = ago >= 22 ? 0 : ago >= 15 ? 1 : ago >= 8 ? 2 : 3;
    if (!loginsByCustomer[customer_id]) loginsByCustomer[customer_id] = [0, 0, 0, 0];
    loginsByCustomer[customer_id][week] += count;
  }

  const WEEK_LABELS = [
    'Wk1  days 22-29  (oldest)',
    'Wk2  days 15-21',
    'Wk3  days  8-14',
    'Wk4  days  0-7   (recent)',
  ];

  function trendSummary(counts) {
    const [w1, w2, w3, w4] = counts;
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0)            return '— NO DATA';
    if (w4 === 0 && w1 > 0)    return '↓↓ GONE SILENT';
    if (w4 === 0 && w1 === 0)  return '↓↓ NEVER ACTIVE (this window)';
    if (w4 >= w1 * 0.85)       return '↔  STABLE';
    if (w4 >= w1 * 0.5)        return '↘  SLIPPING';
    return '↓  DECLINING';
  }

  console.log(rule() + '\n  30-DAY LOGIN TREND  (3 sample customers)\n' + rule());

  for (const customer of samples) {
    const counts = loginsByCustomer[customer.id] ?? [0, 0, 0, 0];
    const maxW   = Math.max(...counts, 1);

    console.log(`\n  ${customer.name}`);
    console.log(`  risk: ${customer.risk_level.padEnd(9)} plan: ${customer.plan.padEnd(10)} MRR: ₹${fmt(customer.mrr).padStart(6)}  health: ${customer.health_score}`);
    console.log('  ' + rule('·', 56));

    for (let w = 0; w < 4; w++) {
      const n     = counts[w];
      const label = WEEK_LABELS[w];
      console.log(`    ${label}  ${bar(n, maxW, 18)} ${String(n).padStart(2)} login${n !== 1 ? 's' : ' '}`);
    }
    console.log(`  Trend: ${trendSummary(counts)}`);
  }

  console.log('\n' + rule('═') + '\n');
}

main().catch(err => {
  console.error('\n✗ Verification failed:', err.message);
  process.exit(1);
});
