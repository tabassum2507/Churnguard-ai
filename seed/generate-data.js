#!/usr/bin/env node
'use strict';

// ─── Load .env.local ──────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

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

// ─── Supabase admin client (mirrors createAdminClient from lib/supabase.js) ───
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ─── Replace with your real number before running live call tests ─────────────
const MY_PHONE_NUMBER = '+91XXXXXXXXXX';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rand   = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick   = (arr)      => arr[Math.floor(Math.random() * arr.length)];
const pickN  = (arr, n)   => [...arr].sort(() => Math.random() - 0.5).slice(0, Math.min(n, arr.length));

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

const subDays    = (n)  => { const d = new Date(TODAY); d.setDate(d.getDate() - n); return d; };
const toDateStr  = (d)  => d.toISOString().split('T')[0];

// ─── Domain data ──────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Aarav',   'Arjun',   'Vivek',   'Rohit',   'Kiran',
  'Priya',   'Neha',    'Ananya',  'Suresh',  'Ramesh',
  'Kavya',   'Meera',   'Divya',   'Sanjay',  'Rajesh',
  'Pooja',   'Aisha',   'Farhan',  'Deepak',  'Nisha',
  'Varun',   'Shreya',  'Ankita',  'Vikas',   'Tanvi',
  'Mohit',   'Ritu',    'Gaurav',  'Simran',  'Ajay',
  'Ritika',  'Harsh',   'Pallavi', 'Nikhil',  'Swati',
  'Manish',  'Sneha',   'Kunal',   'Rekha',   'Aditya',
  'Shweta',  'Pankaj',  'Lavanya', 'Tarun',   'Geeta',
  'Yash',    'Bhavna',  'Sachin',  'Madhuri', 'Chetan',
];

const LAST_NAMES = [
  'Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Joshi', 'Mehta', 'Shah',
  'Nair',   'Iyer',  'Reddy', 'Rao',   'Mishra','Agarwal','Bose', 'Chopra',
  'Desai',  'Pillai','Menon', 'Kapoor','Saxena','Srivastava','Verma','Pandey','Tiwari',
];

// Mix of startups and mid-size Indian companies
const COMPANIES = [
  'Zoho Ventures',      'Razortech Labs',    'Finstack India',    'Groww Analytics',
  'Shiprocket Tech',    'ClearMinds AI',     'Skillenza Dev',     'Myntra Digital',
  'Unacademy Ops',      'Meesho Growth',     'PhonePe Dev',       'BharatPe Tech',
  'OYO Insights',       'Vedantu Analytics', 'Swiggy Data Labs',  'Delhivery Tech',
  'UrbanCompany Dev',   'Zetwerk Digital',   'Mobikwik Growth',   'Licious Tech',
  'Wipro Digital',      'HCL Analytics',     'Mphasis Solutions', 'Hexaware Tech',
  'L&T Infotech',       'Mindtree Ops',      'NIIT Technologies', 'Mastek India',
  'Zensar Growth',      'Persistent Systems','KPIT Technologies', 'Cyient Data',
  'Birlasoft Dev',      'Sonata Software',   'Tata Elxsi Analytics',
];

const FLOWMETRIC_FEATURES = [
  'project_boards', 'time_tracking', 'gantt_chart', 'reports',
  'integrations',   'api_access',    'team_dashboard', 'budget_tracking',
  'milestones',     'custom_fields',
];

const MRR_MAP = { free: 0, starter: 2000, pro: 8000, enterprise: 25000 };

const TICKET_SUBJECTS_MILD = [
  'How do I export data?',
  'Dashboard loading slowly',
  'Need help with Gantt chart setup',
  'Reports not generating correctly',
  'Where can I find the API documentation?',
  'How do I set up recurring milestones?',
];

const TICKET_SUBJECTS_SERIOUS = [
  'Cannot invite team members',
  'API integration not working',
  'Data not syncing across projects',
  'Login issues — locked out of account',
  'Billing inquiry — unexpected charge this month',
  'Critical: project data appears to be missing',
];

const PHONE_PREFIXES = ['98', '97', '96', '95', '94', '93', '91', '90', '87', '86'];

// ─── Usage event builders (one per archetype) ─────────────────────────────────

function buildHealthyEvents(customerId) {
  const events   = [];
  const features = pickN(FLOWMETRIC_FEATURES, rand(3, 5));

  for (let d = 29; d >= 0; d--) {
    const date = toDateStr(subDays(d));
    const ts   = subDays(d).toISOString();

    // Daily login, 1-3 sessions
    events.push({ customer_id: customerId, event_type: 'login', feature: null, event_date: date, count: rand(1, 3), created_at: ts });

    // 2-3 features used per day
    for (const f of pickN(features, rand(2, 3))) {
      events.push({ customer_id: customerId, event_type: 'feature_use', feature: f, event_date: date, count: rand(2, 8), created_at: ts });
    }

    // API calls every 3 days
    if (d % 3 === 0) {
      events.push({ customer_id: customerId, event_type: 'api_call', feature: 'api_access', event_date: date, count: rand(5, 30), created_at: ts });
    }

    // Export once a week
    if (d % 7 === 0) {
      events.push({ customer_id: customerId, event_type: 'export', feature: 'reports', event_date: date, count: rand(1, 3), created_at: ts });
    }
  }
  return events;
}

function buildDecliningEvents(customerId) {
  const events        = [];
  const allFeatures   = pickN(FLOWMETRIC_FEATURES, rand(3, 5));
  const narrowFeatures = allFeatures.slice(0, rand(1, 2)); // narrows over time

  for (let d = 29; d >= 0; d--) {
    // d=29 → oldest (29 days ago); d=0 → today
    // Frequency drops week over week: daily → 3x/week → 1x/week
    let shouldLogin;
    if (d >= 20)      shouldLogin = true;        // days 20-29 ago: daily
    else if (d >= 10) shouldLogin = d % 3 === 0; // days 10-19 ago: ~3x/week
    else              shouldLogin = d % 7 === 0; // days 0-9 ago:   ~1x/week

    if (!shouldLogin) continue;

    const date        = toDateStr(subDays(d));
    const ts          = subDays(d).toISOString();
    const activeFeats = d >= 10 ? allFeatures : narrowFeatures;

    events.push({ customer_id: customerId, event_type: 'login', feature: null, event_date: date, count: 1, created_at: ts });
    for (const f of pickN(activeFeats, rand(1, 2))) {
      events.push({ customer_id: customerId, event_type: 'feature_use', feature: f, event_date: date, count: rand(1, 4), created_at: ts });
    }
  }
  return events;
}

function buildAtRiskEvents(customerId) {
  const events      = [];
  const lastActive  = rand(7, 10); // no activity in most recent 7-10 days
  const features    = pickN(FLOWMETRIC_FEATURES, rand(2, 4));

  for (let d = 29; d >= lastActive; d--) {
    const date = toDateStr(subDays(d));
    const ts   = subDays(d).toISOString();
    events.push({ customer_id: customerId, event_type: 'login', feature: null, event_date: date, count: rand(1, 2), created_at: ts });
    for (const f of pickN(features, rand(1, 2))) {
      events.push({ customer_id: customerId, event_type: 'feature_use', feature: f, event_date: date, count: rand(1, 4), created_at: ts });
    }
  }
  return events;
}

function buildCriticalEvents(customerId) {
  const events      = [];
  const lastActive  = rand(14, 18); // silent for 14+ days
  const features    = pickN(FLOWMETRIC_FEATURES, rand(1, 3));

  for (let d = 29; d >= lastActive; d--) {
    if (d % 2 !== 0) continue; // sporadic even when active

    const date = toDateStr(subDays(d));
    const ts   = subDays(d).toISOString();
    events.push({ customer_id: customerId, event_type: 'login', feature: null, event_date: date, count: 1, created_at: ts });
    if (features.length > 0) {
      events.push({ customer_id: customerId, event_type: 'feature_use', feature: features[0], event_date: date, count: rand(1, 2), created_at: ts });
    }
  }
  return events;
}

// ─── Ticket builder ───────────────────────────────────────────────────────────
function buildTickets(customerId, archetype) {
  const cfg = {
    HEALTHY:   { count: 0 },
    DECLINING: { count: rand(0, 1), pool: TICKET_SUBJECTS_MILD,    baseP: 'low',    ageRange: [7,  20] },
    AT_RISK:   { count: rand(1, 2), pool: TICKET_SUBJECTS_MILD,    baseP: 'medium', ageRange: [3,  10] },
    CRITICAL:  { count: rand(2, 3), pool: [...TICKET_SUBJECTS_MILD, ...TICKET_SUBJECTS_SERIOUS], baseP: 'high', ageRange: [1, 7] },
  }[archetype];

  if (!cfg.count) return [];

  const tickets = [];
  const used    = new Set();

  for (let i = 0; i < cfg.count; i++) {
    let subject;
    // Avoid duplicate subjects per customer
    let attempts = 0;
    do { subject = pick(cfg.pool); } while (used.has(subject) && ++attempts < 20);
    used.add(subject);

    tickets.push({
      customer_id: customerId,
      subject,
      // First ticket on a CRITICAL account gets escalated
      status:     i === 0 && archetype === 'CRITICAL' ? 'escalated' : 'open',
      priority:   i === 0 ? cfg.baseP : pick(['low', 'medium']),
      created_at: subDays(rand(cfg.ageRange[0], cfg.ageRange[1])).toISOString(),
    });
  }
  return tickets;
}

// ─── Customer builder ─────────────────────────────────────────────────────────
function buildCustomer(index, archetype) {
  const firstName = FIRST_NAMES[index]; // 50 unique first names for 50 customers
  const lastName  = pick(LAST_NAMES);
  const company   = COMPANIES[index % COMPANIES.length];
  const domain    = company.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
  const email     = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@${domain}.in`;
  const phone     = index < 3
    ? MY_PHONE_NUMBER
    : `+91${pick(PHONE_PREFIXES)}${String(rand(10000000, 99999999))}`;

  let plan, healthScore, riskLevel, signupDaysAgo;

  switch (archetype) {
    case 'HEALTHY':
      plan          = pick(['pro', 'enterprise']);
      healthScore   = rand(80, 100);
      riskLevel     = 'low';
      signupDaysAgo = rand(60, 365);
      break;
    case 'DECLINING':
      plan          = pick(['starter', 'pro']);
      healthScore   = rand(50, 70);
      riskLevel     = 'medium';
      signupDaysAgo = rand(45, 180);
      break;
    case 'AT_RISK':
      plan          = pick(['starter', 'pro']);
      healthScore   = rand(30, 49);
      riskLevel     = 'high';
      signupDaysAgo = rand(30, 120);
      break;
    case 'CRITICAL':
      plan          = pick(['free', 'starter']); // downgraded
      healthScore   = rand(5, 29);
      riskLevel     = 'critical';
      signupDaysAgo = rand(30, 90);
      break;
  }

  return {
    id:                randomUUID(),
    name:              `${firstName} ${lastName}`,
    email,
    phone,
    company,
    plan,
    signup_date:       toDateStr(subDays(signupDaysAgo)),
    mrr:               MRR_MAP[plan],
    health_score:      healthScore,
    risk_level:        riskLevel,
    last_contacted_at: null,
    created_at:        subDays(signupDaysAgo).toISOString(),
  };
}

// ─── Batch insert ─────────────────────────────────────────────────────────────
async function batchInsert(table, rows) {
  if (!rows.length) return;
  const BATCH = 100;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).insert(slice);
    if (error) throw new Error(`[${table}] ${error.message}`);
    done += slice.length;
    console.log(`  ✓ ${table}: ${done}/${rows.length}`);
  }
}

// ─── Truncate (--fresh) ───────────────────────────────────────────────────────
async function truncateAll() {
  console.log('🗑  --fresh: clearing existing rows...');
  // Delete child tables before parent; rescue_calls and support_tickets cascade
  // from customers but kb_documents is independent
  for (const table of ['rescue_calls', 'support_tickets', 'usage_events', 'kb_documents', 'customers']) {
    const { error } = await supabase.from(table).delete().not('id', 'is', null);
    if (error) throw new Error(`[clear ${table}] ${error.message}`);
    console.log(`  ✓ cleared ${table}`);
  }
  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('✗  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    console.error('   Copy .env.local.example → .env.local and fill in your Supabase credentials.');
    process.exit(1);
  }

  console.log('🚀 ChurnGuard AI — seeding FlowMetric\n');

  if (process.argv.includes('--fresh')) await truncateAll();

  // ── Build records in memory ────────────────────────────────────────────────
  const ARCHETYPES = [
    ...Array(15).fill('HEALTHY'),
    ...Array(15).fill('DECLINING'),
    ...Array(10).fill('AT_RISK'),
    ...Array(10).fill('CRITICAL'),
  ];

  const customers  = ARCHETYPES.map((archetype, i) => ({ archetype, ...buildCustomer(i, archetype) }));
  const allEvents  = [];
  const allTickets = [];

  const evtBuilders = {
    HEALTHY:   buildHealthyEvents,
    DECLINING: buildDecliningEvents,
    AT_RISK:   buildAtRiskEvents,
    CRITICAL:  buildCriticalEvents,
  };

  for (const { id, archetype } of customers) {
    allEvents.push(...evtBuilders[archetype](id));
    allTickets.push(...buildTickets(id, archetype));
  }

  // ── Insert ─────────────────────────────────────────────────────────────────
  console.log('📥 Inserting customers...');
  await batchInsert('customers', customers.map(({ archetype, ...c }) => c));

  console.log(`\n📥 Inserting ${allEvents.length} usage events...`);
  await batchInsert('usage_events', allEvents);

  console.log(`\n📥 Inserting ${allTickets.length} support tickets...`);
  await batchInsert('support_tickets', allTickets);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete!\n');
  console.log(`  customers : ${customers.length}`);
  console.log(`  events    : ${allEvents.length}`);
  console.log(`  tickets   : ${allTickets.length}`);
  console.log('\n  Archetype breakdown:');
  for (const a of ['HEALTHY', 'DECLINING', 'AT_RISK', 'CRITICAL']) {
    console.log(`    ${a.padEnd(10)}  ${customers.filter(c => c.archetype === a).length} customers`);
  }
  console.log('\n  ⚠️  Replace MY_PHONE_NUMBER at the top of this file before running call tests.\n');
}

main().catch(err => {
  console.error('\n✗ Seed failed:', err.message);
  process.exit(1);
});
