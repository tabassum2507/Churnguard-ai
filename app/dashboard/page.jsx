import { createAdminClient } from '@/lib/supabase';

// ─── Data fetchers (run server-side) ─────────────────────────────────────────

async function fetchStats(supabase) {
  const { data: customers } = await supabase
    .from('customers')
    .select('health_score, risk_level');

  if (!customers?.length) return { total: 0, critical: 0, atRisk: 0, avgHealth: 0 };

  const total   = customers.length;
  const critical = customers.filter(c => c.risk_level === 'critical').length;
  const atRisk   = customers.filter(c => c.risk_level === 'high' || c.risk_level === 'critical').length;
  const avgHealth = Math.round(
    customers.reduce((sum, c) => sum + c.health_score, 0) / total
  );

  return { total, critical, atRisk, avgHealth };
}

async function fetchRiskDistribution(supabase) {
  const { data } = await supabase
    .from('customers')
    .select('risk_level');

  const counts = { low: 0, medium: 0, high: 0, critical: 0 };
  (data ?? []).forEach(c => { counts[c.risk_level] = (counts[c.risk_level] ?? 0) + 1; });
  return counts;
}

async function fetchAtRiskCustomers(supabase) {
  const { data } = await supabase
    .from('customers')
    .select('id, name, company, plan, mrr, health_score, risk_level, last_contacted_at')
    .in('risk_level', ['high', 'critical'])
    .order('health_score', { ascending: true })
    .limit(20);

  return data ?? [];
}

async function fetchRecentCalls(supabase) {
  const { data } = await supabase
    .from('rescue_calls')
    .select('id, vapi_call_id, call_status, call_duration, outcome, created_at, customers(name, company)')
    .order('created_at', { ascending: false })
    .limit(10);

  return data ?? [];
}

// ─── Helper components ────────────────────────────────────────────────────────

function RiskBadge({ level }) {
  const styles = {
    low:      'bg-green-100  text-green-800',
    medium:   'bg-yellow-100 text-yellow-800',
    high:     'bg-orange-100 text-orange-800',
    critical: 'bg-red-100    text-red-800',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[level] ?? ''}`}>
      {level}
    </span>
  );
}

function OutcomeBadge({ outcome }) {
  const styles = {
    saved:     'bg-green-100  text-green-800',
    escalated: 'bg-blue-100   text-blue-800',
    churned:   'bg-red-100    text-red-800',
    pending:   'bg-gray-100   text-gray-600',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[outcome] ?? ''}`}>
      {outcome}
    </span>
  );
}

function StatCard({ label, value, sub, color }) {
  const colors = {
    green:  'border-green-400',
    yellow: 'border-yellow-400',
    red:    'border-red-400',
    blue:   'border-blue-400',
  };
  return (
    <div className={`rounded-lg border-l-4 ${colors[color] ?? 'border-gray-300'} bg-white shadow-sm p-5`}>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function HealthBar({ score }) {
  const color = score >= 75 ? 'bg-green-400'
              : score >= 50 ? 'bg-yellow-400'
              : score >= 30 ? 'bg-orange-400'
              :               'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm tabular-nums">{score}</span>
    </div>
  );
}

function formatINR(amount) {
  if (!amount || amount === 0) return '₹0';
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 36e5);
  if (h < 1)  return 'Just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export const revalidate = 60; // revalidate every 60 seconds

export default async function Dashboard() {
  const supabase = createAdminClient();

  const [stats, riskDist, atRiskCustomers, recentCalls] = await Promise.all([
    fetchStats(supabase),
    fetchRiskDistribution(supabase),
    fetchAtRiskCustomers(supabase),
    fetchRecentCalls(supabase),
  ]);

  const totalForBar = stats.total || 1;

  return (
    <main className="min-h-screen bg-gray-50 p-6 font-sans">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">ChurnGuard AI</h1>
        <p className="text-sm text-gray-500 mt-1">FlowMetric Customer Health Dashboard</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 mb-8 lg:grid-cols-4">
        <StatCard label="Total Customers"  value={stats.total}             color="blue" />
        <StatCard label="Avg Health Score" value={`${stats.avgHealth}/100`} color="green"
                  sub="across all accounts" />
        <StatCard label="At Risk"          value={stats.atRisk}
                  sub="high + critical risk" color="yellow" />
        <StatCard label="Critical"         value={stats.critical}
                  sub="need immediate rescue" color="red" />
      </div>

      {/* Risk distribution */}
      <div className="bg-white rounded-lg shadow-sm p-5 mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Risk Distribution</h2>
        <div className="space-y-3">
          {[
            { label: 'Low',      key: 'low',      color: 'bg-green-400' },
            { label: 'Medium',   key: 'medium',   color: 'bg-yellow-400' },
            { label: 'High',     key: 'high',     color: 'bg-orange-400' },
            { label: 'Critical', key: 'critical', color: 'bg-red-500' },
          ].map(({ label, key, color }) => {
            const count = riskDist[key] ?? 0;
            const pct   = Math.round((count / totalForBar) * 100);
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-14">{label}</span>
                <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs tabular-nums text-gray-600 w-12 text-right">
                  {count} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">

        {/* At-risk customers table */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">
              At-Risk Customers ({stats.atRisk})
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">High and critical risk — sorted by health score</p>
          </div>

          {atRiskCustomers.length === 0 ? (
            <p className="text-sm text-gray-400 p-5">No at-risk customers right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase tracking-wide bg-gray-50">
                    <th className="text-left px-4 py-2">Customer</th>
                    <th className="text-left px-4 py-2">Plan</th>
                    <th className="text-left px-4 py-2">MRR</th>
                    <th className="text-left px-4 py-2">Health</th>
                    <th className="text-left px-4 py-2">Risk</th>
                    <th className="text-left px-4 py-2">Last Call</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {atRiskCustomers.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{c.name}</div>
                        <div className="text-xs text-gray-400">{c.company}</div>
                      </td>
                      <td className="px-4 py-3 capitalize text-gray-600">{c.plan}</td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">{formatINR(c.mrr)}</td>
                      <td className="px-4 py-3"><HealthBar score={c.health_score} /></td>
                      <td className="px-4 py-3"><RiskBadge level={c.risk_level} /></td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{timeAgo(c.last_contacted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent rescue calls */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Recent Rescue Calls</h2>
            <p className="text-xs text-gray-400 mt-0.5">Latest 10 calls from Vapi</p>
          </div>

          {recentCalls.length === 0 ? (
            <p className="text-sm text-gray-400 p-5">No rescue calls recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase tracking-wide bg-gray-50">
                    <th className="text-left px-4 py-2">Customer</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-left px-4 py-2">Duration</th>
                    <th className="text-left px-4 py-2">Outcome</th>
                    <th className="text-left px-4 py-2">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentCalls.map(call => (
                    <tr key={call.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{call.customers?.name ?? '—'}</div>
                        <div className="text-xs text-gray-400">{call.customers?.company}</div>
                      </td>
                      <td className="px-4 py-3 capitalize text-gray-600">
                        {call.call_status?.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-600">
                        {formatDuration(call.call_duration)}
                      </td>
                      <td className="px-4 py-3"><OutcomeBadge outcome={call.outcome} /></td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{timeAgo(call.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
