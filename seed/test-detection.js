#!/usr/bin/env node
'use strict';

// ─── Detection logic (mirrored from app/api/churn-detection/route.js) ─────────
// Keeping it inline here so this script is self-contained and runnable without
// Next.js. If you extract signals to a shared lib later, import from there.

const SIGNALS = {
  LOGIN_DROP:      { weight: 30, label: 'Login frequency dropped >50 % vs 3-week average' },
  NO_RECENT_LOGIN: { weight: 25, label: 'No login in the last 7 days'                     },
  FEATURE_STALL:   { weight: 15, label: 'No feature usage in the last 14 days (was active before)' },
  TICKET_SPIKE:    { weight: 15, label: '2+ open/escalated tickets in the last 14 days'   },
  LOW_ENGAGEMENT:  { weight: 15, label: 'Fewer than 3 total interactions in the last 7 days' },
};

// NOTE: This is the function under test. We'll print what it returns for each
// mock customer so we can spot misclassifications before touching real data.
//
// FIXED: raised 'low' boundary from ≥70 to ≥75.
// Reason: LOGIN_DROP alone deducts 30 pts → health = 70. With the old ≥70
// boundary a clearly declining customer read as "low risk" (healthy). The fix
// moves 70 into the 'medium' band where it belongs.
function getRiskLevel(score) {
  if (score >= 75) return 'low';
  if (score >= 50) return 'medium';
  if (score >= 30) return 'high';
  return 'critical';
}

function detectSignals(events, recentTickets) {
  const now        = Date.now();
  const MS_PER_DAY = 86_400_000;
  const daysAgo    = (s) => Math.floor((now - new Date(s).getTime()) / MS_PER_DAY);

  const last7    = events.filter(e => daysAgo(e.event_date) <  7);
  const last14   = events.filter(e => daysAgo(e.event_date) <  14);
  const before14 = events.filter(e => daysAgo(e.event_date) >= 14);
  const week1    = events.filter(e => { const d = daysAgo(e.event_date); return d >=  7 && d < 14; });
  const week2    = events.filter(e => { const d = daysAgo(e.event_date); return d >= 14 && d < 21; });
  const week3    = events.filter(e => { const d = daysAgo(e.event_date); return d >= 21 && d < 28; });

  const sumCount = (arr)       => arr.reduce((a, e) => a + (e.count ?? 0), 0);
  const logins   = (arr)       => arr.filter(e => e.event_type === 'login');
  const features = (arr)       => arr.filter(e => e.event_type === 'feature_use' && e.feature);

  const triggered = [];

  const recentLoginCount = sumCount(logins(last7));
  const avgWeeklyLogins  = (sumCount(logins(week1)) + sumCount(logins(week2)) + sumCount(logins(week3))) / 3;
  if (avgWeeklyLogins > 0 && recentLoginCount < avgWeeklyLogins * 0.5) triggered.push('LOGIN_DROP');

  if (!last7.some(e => e.event_type === 'login')) triggered.push('NO_RECENT_LOGIN');

  const recentFeats  = new Set(features(last14).map(e => e.feature));
  const historicFeats = new Set(features(before14).map(e => e.feature));
  if (historicFeats.size > 0 && recentFeats.size === 0) triggered.push('FEATURE_STALL');

  if (recentTickets.length >= 2) triggered.push('TICKET_SPIKE');

  if (sumCount(last7) < 3) triggered.push('LOW_ENGAGEMENT');

  return triggered;
}

// ─── Mock data helpers ────────────────────────────────────────────────────────

const BASE = new Date();
BASE.setHours(0, 0, 0, 0);

function dateStr(daysAgo) {
  const d = new Date(BASE);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

// Build a compact usage_events array from a spec:
//   [ [startDaysAgo, endDaysAgo, eventType, feature, count], ... ]
// startDaysAgo > endDaysAgo (oldest → newest).
function buildEvents(id, specs) {
  const events = [];
  for (const [start, end, type, feat, count] of specs) {
    for (let d = start; d >= end; d--) {
      events.push({ customer_id: id, event_type: type, feature: feat ?? null, event_date: dateStr(d), count: count ?? 1 });
    }
  }
  return events;
}

function ticket(id, daysAgo) {
  return { customer_id: id, status: 'open', created_at: new Date(BASE.getTime() - daysAgo * 86_400_000).toISOString() };
}

// ─── Mock customers (2 per archetype) ────────────────────────────────────────
//
// Events are crafted to precisely match each archetype's behavioural pattern
// so we can verify the detection logic without needing a live database.

const MOCK = [
  // ── HEALTHY ─────────────────────────────────────────────────────────────────
  // Daily logins + rich feature use across all 30 days. No tickets.
  {
    id: 'h1', name: 'Aarav Sharma',   archetype: 'HEALTHY',
    events: buildEvents('h1', [
      [29,  0, 'login',        null,              2],   // 2 logins/day, every day
      [29,  0, 'feature_use',  'project_boards',  3],
      [29,  0, 'feature_use',  'time_tracking',   2],
      [29,  0, 'feature_use',  'reports',         1],
      [ 6,  0, 'api_call',     'api_access',     10],  // daily API calls this week
      [ 6,  0, 'export',       'reports',         1],
    ]),
    tickets: [],
  },
  {
    id: 'h2', name: 'Priya Nair',     archetype: 'HEALTHY',
    events: buildEvents('h2', [
      [29,  0, 'login',        null,              1],
      [29,  0, 'feature_use',  'gantt_chart',     4],
      [29,  0, 'feature_use',  'milestones',      2],
      [29,  0, 'feature_use',  'team_dashboard',  1],
      [29, 14, 'api_call',     'api_access',      8],  // API calls in older period too
    ]),
    tickets: [],
  },

  // ── DECLINING ───────────────────────────────────────────────────────────────
  // Frequency drops week-over-week: daily → 3×/week → 1×/week.
  // Features narrow from 4 to 1-2 over time.
  //
  // d3 is the boundary stress-test: last-7-days volume is high enough that
  // LOW_ENGAGEMENT does NOT fire, so only LOGIN_DROP deducts (30 pts → health 70).
  // With the OLD ≥70='low' boundary this classified as "low" (wrong).
  // With the FIXED ≥75='low' boundary health 70 → 'medium' (correct).
  {
    id: 'd1', name: 'Vivek Patel',    archetype: 'DECLINING',
    events: buildEvents('d1', [
      // week3 (21-27 days ago) — daily
      [27, 21, 'login',        null,              1],
      [27, 21, 'feature_use',  'project_boards',  3],
      [27, 21, 'feature_use',  'time_tracking',   2],
      [27, 21, 'feature_use',  'gantt_chart',     1],
      [27, 21, 'feature_use',  'reports',         1],
      // week2 (14-20 days ago) — ~3×/week (days 15, 18, 20)
      [20, 20, 'login',        null,              1],
      [20, 20, 'feature_use',  'project_boards',  2],
      [18, 18, 'login',        null,              1],
      [18, 18, 'feature_use',  'project_boards',  2],
      [15, 15, 'login',        null,              1],
      [15, 15, 'feature_use',  'project_boards',  1],
      // week1 (7-13 days ago) — ~1×/week (days 7, 12)
      [12, 12, 'login',        null,              1],
      [12, 12, 'feature_use',  'project_boards',  1],  // narrowed to 1 feature
      [ 7,  7, 'login',        null,              1],
      [ 7,  7, 'feature_use',  'project_boards',  1],
      // last 7 days — 1 login today
      [ 0,  0, 'login',        null,              1],
      [ 0,  0, 'feature_use',  'project_boards',  1],
    ]),
    tickets: [],
  },
  // d3: LOGIN_DROP only — the boundary stress-test described above
  {
    id: 'd3', name: 'Gaurav Kapoor',  archetype: 'DECLINING',
    events: buildEvents('d3', [
      // week3: heavy logins (21 total) to establish a strong baseline
      [27, 21, 'login', null, 3],
      // week2: moderate (3×/week = 9 total)
      [20, 20, 'login', null, 3], [18, 18, 'login', null, 3], [15, 15, 'login', null, 3],
      // week1: tapering (2×/week = 6 total)
      [12, 12, 'login', null, 3], [7, 7, 'login', null, 3],
      // last7: 1 login-day with count=3 + 2 feature events → sumCount=7 ≥ 3, so
      // LOW_ENGAGEMENT does NOT fire. Only LOGIN_DROP fires (3 < 12 avg × 0.5=6).
      [0,  0, 'login',       null,             3],
      [0,  0, 'feature_use', 'project_boards', 2],
      [0,  0, 'feature_use', 'reports',        2],
    ]),
    tickets: [],
  },
  {
    id: 'd2', name: 'Meera Singh',    archetype: 'DECLINING',
    events: buildEvents('d2', [
      [27, 21, 'login', null, 1],
      [27, 21, 'feature_use', 'reports',         2],
      [27, 21, 'feature_use', 'integrations',    1],
      [20, 20, 'login', null, 1], [20, 20, 'feature_use', 'reports', 1],
      [18, 18, 'login', null, 1], [18, 18, 'feature_use', 'reports', 1],
      [15, 15, 'login', null, 1], [15, 15, 'feature_use', 'reports', 1],
      [12, 12, 'login', null, 1], [12, 12, 'feature_use', 'reports', 1],
      [ 7,  7, 'login', null, 1],
      // Last 7: only 1 login today, 1 feature → sumCount=2 which is < 3
      [ 0,  0, 'login', null, 1],
    ]),
    tickets: [],  // Declining may have 0-1 open tickets; 0 here keeps it clean
  },

  // ── AT_RISK ──────────────────────────────────────────────────────────────────
  // Was active daily until 8 days ago — then went completely silent.
  // Has 1-2 open tickets filed recently.
  {
    id: 'a1', name: 'Rohit Kumar',    archetype: 'AT_RISK',
    events: buildEvents('a1', [
      [29,  8, 'login',        null,             1],   // active every day until 8 days ago
      [29,  8, 'feature_use',  'project_boards', 2],
      [29,  8, 'feature_use',  'gantt_chart',    1],
      // Days 0-7: no events (the silence)
    ]),
    tickets: [ ticket('a1', 5) ],   // 1 ticket, 5 days ago — under the spike threshold
  },
  {
    id: 'a2', name: 'Kavya Joshi',    archetype: 'AT_RISK',
    events: buildEvents('a2', [
      [29,  9, 'login',        null,             1],
      [29,  9, 'feature_use',  'time_tracking',  2],
      [29,  9, 'feature_use',  'reports',        1],
    ]),
    tickets: [ ticket('a2', 4), ticket('a2', 10) ],  // 2 tickets; one within last 14d
  },

  // ── CRITICAL ─────────────────────────────────────────────────────────────────
  // Sporadic activity that stopped ≥14 days ago. 2-3 open tickets, one escalated.
  {
    id: 'c1', name: 'Sanjay Gupta',   archetype: 'CRITICAL',
    events: buildEvents('c1', [
      [27, 14, 'login',        null,             1],   // active (sporadically) until 14d ago
      [27, 14, 'feature_use',  'reports',        1],
      // Days 0-13: no events
    ]),
    tickets: [ ticket('c1', 3), ticket('c1', 7), ticket('c1', 20) ],
    //  ↑ 2 within last 14d (days 3 and 7) → TICKET_SPIKE fires
  },
  {
    id: 'c2', name: 'Divya Mehta',    archetype: 'CRITICAL',
    events: buildEvents('c2', [
      [25, 16, 'login',        null,             1],
      [25, 16, 'feature_use',  'integrations',   1],
    ]),
    tickets: [ ticket('c2', 2), ticket('c2', 9) ],
  },
];

// ─── Run detection and collect results ───────────────────────────────────────

// Arrays allow "either is acceptable" for archetypes that can legitimately land
// in two adjacent bands depending on how many signals fire.
const EXPECTED = {
  HEALTHY:   ['low'],
  DECLINING: ['medium', 'high'],    // never 'low'; high is OK if LOW_ENGAGEMENT also fires
  AT_RISK:   ['high', 'critical'],  // critical is valid when TICKET_SPIKE co-fires
  CRITICAL:  ['critical'],
};

const results = MOCK.map(({ id, name, archetype, events, tickets }) => {
  const recentTickets14 = tickets.filter(t => {
    const days = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86_400_000);
    return days < 14;
  });

  const triggered    = detectSignals(events, recentTickets14);
  const deduction    = triggered.reduce((s, k) => s + SIGNALS[k].weight, 0);
  const health_score = Math.max(0, 100 - deduction);
  const risk_level   = getRiskLevel(health_score);
  const acceptable   = EXPECTED[archetype];
  const pass         = acceptable.includes(risk_level);

  return { name, archetype, acceptable, risk_level, health_score, triggered, pass };
});

// ─── Print report ─────────────────────────────────────────────────────────────

const W = { name: 20, arch: 10, exp: 10, got: 10, score: 7 };
const rule = (c = '─', n = 80) => c.repeat(n);
const pad  = (s, w) => String(s).padEnd(w);

console.log('\n' + rule('═'));
console.log('  ChurnGuard AI — Signal Detection Test');
console.log('  Thresholds: LOGIN_DROP=30 | NO_RECENT=25 | FEAT_STALL=15 | TICKET_SPIKE=15 | LOW_ENG=15');
console.log('  Risk bands: ≥75 low  50-74 medium  30-49 high  <30 critical  (fixed from ≥70)');
console.log(rule('═'));
console.log(
  '  ' +
  pad('Customer', W.name) +
  pad('Archetype', W.arch) +
  pad('Acceptable', W.exp) +
  pad('Got', W.got) +
  pad('Score', W.score) +
  'Signals fired'
);
console.log('  ' + rule('─', 78));

for (const r of results) {
  const status  = r.pass ? '✓' : '✗';
  const sigLine = r.triggered.length ? r.triggered.join(', ') : '(none)';
  console.log(
    `  ${status} ` +
    pad(r.name, W.name) +
    pad(r.archetype, W.arch) +
    pad(r.acceptable.join('/'), W.exp) +
    pad(r.risk_level, W.got) +
    pad(r.health_score, W.score) +
    sigLine
  );
}

const passing = results.filter(r => r.pass).length;
const total   = results.length;
console.log('\n  ' + rule('─', 78));
console.log(`  Accuracy: ${passing}/${total}`);

// ─── Diagnose failures ────────────────────────────────────────────────────────

const failures = results.filter(r => !r.pass);
if (failures.length > 0) {
  console.log('\n' + rule('─'));
  console.log('  THRESHOLD DIAGNOSIS');
  console.log(rule('─'));

  for (const f of failures) {
    const signalWeights = f.triggered.map(k => `${k}(${SIGNALS[k].weight})`).join(' + ') || '(none)';
    console.log(`\n  ✗ ${f.name}  [${f.archetype}]`);
    console.log(`    Signals  : ${signalWeights || '—'}  →  deduction ${100 - f.health_score}`);
    console.log(`    Score    : ${f.health_score}   Expected band: ${f.expected}   Got band: ${f.risk_level}`);

    if (f.archetype === 'DECLINING' && f.risk_level === 'low') {
      console.log(`    Root cause: LOGIN_DROP alone deducts 30 pts → score 70, which sits`);
      console.log(`                exactly at the ≥70='low' boundary. DECLINING customers`);
      console.log(`                trigger the clearest signal of decline but still read as healthy.`);
      console.log(`    Fix       : Raise the 'low' boundary from ≥70 to ≥75 so a score of 70`);
      console.log(`                falls into 'medium' instead.`);
    }
  }
} else {
  console.log('\n  All archetypes classified correctly.');
}

console.log('\n' + rule('═') + '\n');
