import {
  ShieldCheck,
  Clock,
  Network,
  Inbox,
  AlertTriangle,
  Layers,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import { useCMDBHealthMetrics } from '../../api/endpoints';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';

interface DashboardViewProps {
  onNavigate: (view: string) => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const { data: metrics, isLoading } = useCMDBHealthMetrics();

  const totalCIs = metrics?.total_in_service_cis ?? 0;
  const verifiedCount = metrics?.fresh_cis_count ?? 0;
  const staleCount = metrics?.stale_cis_count ?? 0;
  const orphanCount = metrics?.orphan_ci_count ?? 0;
  const pendingHandshakes = metrics?.pending_edges_count ?? 0;
  const freshnessRatio = metrics?.freshness_rate ? Math.round(metrics.freshness_rate * 100) : 100;
  const openFlags = 0;

  return (
    <div className="space-y-6 max-w-7xl w-full mx-auto animate-in fade-in-50 duration-150">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-primary">CMDB Governance & Health Overview</h1>
          <p className="text-xs text-secondary mt-1">
            Real-time telemetry across decentralized service intake, graph topologies, and bi-weekly owner verification loops.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary" size="sm" onClick={() => onNavigate('digest')}>
            Review My Digest
          </Button>
          <Button variant="primary" size="sm" onClick={() => onNavigate('catalog')}>
            Catalog Search <ArrowRight className="w-3.5 h-3.5 ml-1 stroke-[1.5]" />
          </Button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Active CIs */}
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-2xs font-mono font-medium uppercase text-muted tracking-wider">
                Total Active CIs
              </span>
              <div className="text-2xl font-semibold tabular-nums text-primary mt-1">
                {isLoading ? '...' : totalCIs.toLocaleString()}
              </div>
              <div className="text-3xs text-secondary mt-1 flex items-center gap-1">
                <Layers className="w-3 h-3 text-accent stroke-[1.5]" />
                <span>Across prod, dr, and staging</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-md bg-tier2-bg border border-tier2-border flex items-center justify-center text-accent">
              <Layers className="w-5 h-5 stroke-[1.5]" />
            </div>
          </CardContent>
        </Card>

        {/* KPI 2: Verification Freshness */}
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-2xs font-mono font-medium uppercase text-muted tracking-wider">
                Verification Freshness
              </span>
              <div className="text-2xl font-semibold tabular-nums text-inservice mt-1">
                {isLoading ? '...' : `${freshnessRatio}%`}
              </div>
              <div className="text-3xs text-secondary mt-1 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-inservice stroke-[1.5]" />
                <span>{verifiedCount} verified in &lt;60 days</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-md bg-surface-sunken border border-subtle flex items-center justify-center text-inservice">
              <TrendingUp className="w-5 h-5 stroke-[1.5]" />
            </div>
          </CardContent>
        </Card>

        {/* KPI 3: Stale & Orphan CIs */}
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-2xs font-mono font-medium uppercase text-muted tracking-wider">
                Stale & Orphaned CIs
              </span>
              <div className="text-2xl font-semibold tabular-nums text-deprecated mt-1">
                {isLoading ? '...' : staleCount + orphanCount}
              </div>
              <div className="text-3xs text-secondary mt-1 flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-deprecated stroke-[1.5]" />
                <span>{staleCount} stale • {orphanCount} orphans</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-md bg-tier1-bg border border-tier1-border flex items-center justify-center text-deprecated">
              <Clock className="w-5 h-5 stroke-[1.5]" />
            </div>
          </CardContent>
        </Card>

        {/* KPI 4: Pending Handshakes & Flags */}
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-2xs font-mono font-medium uppercase text-muted tracking-wider">
                Pending Actions
              </span>
              <div className="text-2xl font-semibold tabular-nums text-primary mt-1">
                {isLoading ? '...' : pendingHandshakes + openFlags}
              </div>
              <div className="text-3xs text-secondary mt-1 flex items-center gap-1.5">
                <Inbox className="w-3 h-3 text-muted stroke-[1.5]" />
                <span>{pendingHandshakes} handshakes • {openFlags} flags</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-md bg-surface-sunken border border-subtle flex items-center justify-center text-muted">
              <AlertTriangle className="w-5 h-5 stroke-[1.5]" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid: Architecture Principles & Direct Action Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Architectural Highlights & Quick Tasks */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="w-4 h-4 text-accent stroke-[1.5]" />
                Decentralized Service Governance Workflows
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-secondary leading-relaxed">
                ETCMS replaces manual asset-tracking bureaucracy with distributed service intake and automated ownership handshakes:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div
                  onClick={() => onNavigate('digest')}
                  className="p-3.5 bg-surface-sunken border border-subtle hover:border-hairline rounded-md cursor-pointer transition-colors hover:bg-hover"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">Bi-Weekly Verification Queue</span>
                    <ArrowRight className="w-3.5 h-3.5 text-accent stroke-[1.5]" />
                  </div>
                  <p className="text-2xs text-secondary mt-1">
                    Review and one-click verify operational CIs, clear dispute flags, and safely retire leaf services.
                  </p>
                </div>

                <div
                  onClick={() => onNavigate('handshakes')}
                  className="p-3.5 bg-surface-sunken border border-subtle hover:border-hairline rounded-md cursor-pointer transition-colors hover:bg-hover"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">Cross-Boundary Handshakes</span>
                    <ArrowRight className="w-3.5 h-3.5 text-accent stroke-[1.5]" />
                  </div>
                  <p className="text-2xs text-secondary mt-1">
                    Review incoming dependencies where external applications declare relationships to your infrastructure.
                  </p>
                </div>

                <div
                  onClick={() => onNavigate('graph')}
                  className="p-3.5 bg-surface-sunken border border-subtle hover:border-hairline rounded-md cursor-pointer transition-colors hover:bg-hover"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">Blast Radius & Impact Analysis</span>
                    <ArrowRight className="w-3.5 h-3.5 text-accent stroke-[1.5]" />
                  </div>
                  <p className="text-2xs text-secondary mt-1">
                    Sub-500ms cycle-safe graph queries identifying all upstream applications affected if a database or host fails.
                  </p>
                </div>

                <div
                  onClick={() => onNavigate('campaigns')}
                  className="p-3.5 bg-surface-sunken border border-subtle hover:border-hairline rounded-md cursor-pointer transition-colors hover:bg-hover"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">Tokenized Intake Campaigns</span>
                    <ArrowRight className="w-3.5 h-3.5 text-accent stroke-[1.5]" />
                  </div>
                  <p className="text-2xs text-secondary mt-1">
                    Generate secure cryptographic magic links for Team Leads to register services without account hurdles.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Col: Anti-ITAM Invariant & Heuristic Guidelines */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xs font-semibold text-primary uppercase tracking-wider">
                Invariant Guardrails
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-secondary">
              <div className="p-3 bg-tier0-bg border border-tier0-border rounded-md">
                <span className="font-semibold text-tier0 block mb-0.5">Strict Anti-ITAM Enforcement</span>
                ETCMS rejects all asset-tracking fields (<code className="text-2xs font-mono text-tier0">cost</code>, <code className="text-2xs font-mono text-tier0">purchase_cost</code>, <code className="text-2xs font-mono text-tier0">warranty</code>).
              </div>

              <div className="p-3 bg-tier2-bg border border-tier2-border rounded-md">
                <span className="font-semibold text-accent block mb-0.5">Canonical Graph Direction</span>
                Edges follow <code className="text-2xs font-mono text-accent">Consumer &rarr; Provider</code>. Self-loops are strictly blocked at database constraints.
              </div>

              <div className="p-3 bg-surface-sunken border border-subtle rounded-md">
                <span className="font-semibold text-primary block mb-0.5">Append-Only Audit Immutability</span>
                Database triggers strictly prohibit <code className="text-2xs font-mono text-inservice">UPDATE</code>, <code className="text-2xs font-mono text-inservice">DELETE</code>, or <code className="text-2xs font-mono text-inservice">TRUNCATE</code> on audit tables.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
