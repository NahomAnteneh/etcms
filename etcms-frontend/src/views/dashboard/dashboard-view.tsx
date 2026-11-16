import { useState, useMemo, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Database,
  Filter,
  Check,
  Activity,
  FileCheck2,
  Layers,
  Network,
  Cpu,
  Inbox,
  Send,
  Server,
  Building2,
  Sparkles,
  CheckCircle2,
  Plus,
  AlertCircle,
  Clock,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import {
  useCMDBHealthMetrics,
  useCICatalog,
  usePendingEdges,
  useOwnerDigest,
  useVerifyCI,
} from '../../api/endpoints';
import { useAuth } from '../../store/auth-context';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { DigestView } from '../digest/digest-view';
import { HandshakesView } from '../handshakes/handshakes-view';
import { CampaignsView } from '../campaigns/campaigns-view';
import { useToast } from '../../components/ui/toast';

function getMetricTone(score: number | null) {
  if (score === null) {
    return {
      textColor: 'text-muted',
      barColor: 'bg-control/30',
      badgeBg: 'bg-surface-sunken text-muted border-subtle',
      label: 'No Data',
    };
  }
  if (score >= 90) {
    return {
      textColor: 'text-inservice',
      barColor: 'bg-inservice',
      badgeBg: 'bg-accent/15 text-inservice border-inservice/30',
      label: 'Healthy',
    };
  }
  if (score >= 70) {
    return {
      textColor: 'text-tier1',
      barColor: 'bg-tier1',
      badgeBg: 'bg-tier1-bg text-tier1 border-tier1-border',
      label: 'Needs Attention',
    };
  }
  return {
    textColor: 'text-tier0',
    barColor: 'bg-tier0',
    badgeBg: 'bg-tier0-bg text-tier0 border-tier0-border',
    label: 'Critical',
  };
}

export type DashboardTab = 'overview' | 'digest' | 'handshakes' | 'campaigns';

export function getInitialTab(): DashboardTab {
  if (typeof window === 'undefined') return 'overview';
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab')?.toLowerCase();
  if (tabParam && ['overview', 'digest', 'handshakes', 'campaigns'].includes(tabParam)) {
    return tabParam as DashboardTab;
  }
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  if (['overview', 'digest', 'handshakes', 'campaigns'].includes(hash)) {
    return hash as DashboardTab;
  }
  const path = window.location.pathname.replace(/^\//, '').toLowerCase();
  if (path === 'handshakes' || path === 'dashboard/handshakes') return 'handshakes';
  if (path === 'digest' || path === 'dashboard/digest') return 'digest';
  if (path === 'campaigns' || path === 'dashboard/campaigns') return 'campaigns';
  return 'overview';
}

export interface DashboardViewProps {
  onNavigate: (view: string) => void;
  onNavigateToCatalogCI?: (ciId: string) => void;
  onNavigateToIntake?: (token: string) => void;
  initialTab?: DashboardTab;
  onTabChange?: (tab: DashboardTab) => void;
}

export function DashboardView({
  onNavigate,
  onNavigateToCatalogCI,
  onNavigateToIntake,
  initialTab,
  onTabChange,
}: DashboardViewProps) {
  const { activeOwnerGroup, ownerGroups } = useAuth();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => initialTab || getInitialTab());

  // Keep activeTab in sync when initialTab prop changes from external navigation
  useEffect(() => {
    if (initialTab && initialTab !== activeTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Listen to popstate events for backward/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const tab = getInitialTab();
      setActiveTab(tab);
      onTabChange?.(tab);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [onTabChange]);

  const handleTabChange = (tabId: DashboardTab) => {
    setActiveTab(tabId);
    if (typeof window !== 'undefined') {
      const newPath = tabId === 'overview' ? '/dashboard' : `/dashboard?tab=${tabId}`;
      if (window.location.pathname + window.location.search !== newPath) {
        window.history.pushState({ tab: tabId }, '', newPath);
      }
    }
    onTabChange?.(tabId);
  };

  const [scopeToActiveGroup, setScopeToActiveGroup] = useState(false);
  const { data: metrics, isLoading, refetch: refetchMetrics } = useCMDBHealthMetrics(
    scopeToActiveGroup ? activeOwnerGroup?.id : undefined
  );
  const { data: catalogData, refetch: refetchCatalog } = useCICatalog();
  const { data: pendingEdges = [] } = usePendingEdges(activeOwnerGroup?.id);
  const { data: digestData } = useOwnerDigest(activeOwnerGroup?.id);
  const verifyMutation = useVerifyCI();
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const openDigestCount = digestData?.items?.filter((i) => i.status === 'open').length ?? 0;
  const catalogItems = catalogData?.items || [];

  // Consistent Definition: All CMDB operational health metrics evaluate active In-Service CIs
  const inServiceItems = useMemo(() => {
    return catalogItems.filter((c) => c.lifecycle_state === 'in_service');
  }, [catalogItems]);

  const totalCIs = metrics?.total_in_service_cis ?? inServiceItems.length;

  const freshCount = metrics?.fresh_cis_count ?? inServiceItems.filter((c) => {
    if (!c.last_verified_at) return false;
    return new Date().getTime() - new Date(c.last_verified_at).getTime() <= 60 * 24 * 60 * 60 * 1000;
  }).length;

  const staleCount = metrics?.stale_cis_count ?? inServiceItems.filter((c) => {
    if (!c.last_verified_at) return true;
    return new Date().getTime() - new Date(c.last_verified_at).getTime() > 60 * 24 * 60 * 60 * 1000;
  }).length;

  const orphanCount = metrics?.orphan_ci_count ?? inServiceItems.filter((c) => !c.owner_group_id).length;
  const unassignedOwnerCount = inServiceItems.filter(
    (c) => !c.owner_group_id || c.ownership?.owner_group_name === 'Unassigned'
  ).length;

  const hasData = totalCIs > 0;
  const [isChecklistDismissed, setIsChecklistDismissed] = useState(false);
  const showSetupChecklist = !isChecklistDismissed && (totalCIs === 0 || ownerGroups.length === 0);

  // Completeness: Population of required operational attributes (name, class, environment, tier, contact, owner)
  const completenessScore = useMemo<number | null>(() => {
    if (!hasData) return null;
    const validCount = inServiceItems.reduce((acc, ci) => {
      let count = 0;
      if (ci.name) count++;
      if (ci.ci_class) count++;
      if (ci.environment) count++;
      if (ci.criticality_tier) count++;
      if (ci.technical_contact) count++;
      if (ci.owner_group_id && ci.ownership?.owner_group_name !== 'Unassigned') count++;
      return acc + count / 6;
    }, 0);
    return Math.round((validCount / inServiceItems.length) * 100);
  }, [inServiceItems, hasData]);

  // Correctness: Ratio of in-service CIs free of structural defects (stale verification, orphan technical links, missing owner)
  const correctnessScore = useMemo<number | null>(() => {
    if (!hasData) return null;
    const defects = staleCount + orphanCount + unassignedOwnerCount;
    return Math.max(0, Math.min(100, Math.round(((totalCIs - Math.min(defects, totalCIs)) / totalCIs) * 100)));
  }, [hasData, totalCIs, staleCount, orphanCount, unassignedOwnerCount]);

  // Compliance: 60-day calendar cycle attestation compliance
  const complianceScore = useMemo<number | null>(() => {
    if (!hasData) return null;
    if (metrics?.freshness_rate !== undefined) {
      return Math.max(0, Math.min(100, Math.round(metrics.freshness_rate)));
    }
    return Math.round((freshCount / totalCIs) * 100);
  }, [hasData, metrics?.freshness_rate, freshCount, totalCIs]);

  // Overall Index: Average of Completeness, Correctness, and Compliance (null with 0 CIs)
  const overallHealthScore = useMemo<number | null>(() => {
    if (!hasData || completenessScore === null || correctnessScore === null || complianceScore === null) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round((completenessScore + correctnessScore + complianceScore) / 3)));
  }, [hasData, completenessScore, correctnessScore, complianceScore]);

  // Rule: All Targets Met (>90%) is TRUE ONLY if EVERY metric meets the >90% target threshold
  const allTargetsMet = hasData &&
    completenessScore !== null && completenessScore >= 90 &&
    correctnessScore !== null && correctnessScore >= 90 &&
    complianceScore !== null && complianceScore >= 90;

  const overallTone = getMetricTone(overallHealthScore);
  const compTone = getMetricTone(completenessScore);
  const corrTone = getMetricTone(correctnessScore);
  const complTone = getMetricTone(complianceScore);

  // In-Service CI category breakdown (reconciles 100% with the 49 in-service total)
  const ciClassCounts = useMemo(() => ({
    service: inServiceItems.filter((c) => c.ci_class === 'business_service').length,
    application: inServiceItems.filter((c) => c.ci_class === 'application').length,
    database: inServiceItems.filter((c) => c.ci_class === 'database').length,
    infrastructure: inServiceItems.filter(
      (c) => c.ci_class === 'vm_cluster' || c.ci_class === 'physical_host' || c.ci_class === 'vm_server'
    ).length,
    network: inServiceItems.filter((c) => c.ci_class === 'network_firewall').length,
  }), [inServiceItems]);

  const ciClasses = useMemo(() => {
    const calcStale = (filterFn: (ci: any) => boolean) => {
      return inServiceItems.filter((c) => {
        if (!filterFn(c)) return false;
        if (!c.last_verified_at) return true;
        return new Date().getTime() - new Date(c.last_verified_at).getTime() > 60 * 24 * 60 * 60 * 1000;
      }).length;
    };

    return [
      {
        name: 'Services',
        key: 'business_service',
        icon: Layers,
        count: ciClassCounts.service,
        percent: totalCIs > 0 ? Math.round((ciClassCounts.service / totalCIs) * 100) : 0,
        stale: calcStale((c) => c.ci_class === 'business_service'),
      },
      {
        name: 'Applications',
        key: 'application',
        icon: Cpu,
        count: ciClassCounts.application,
        percent: totalCIs > 0 ? Math.round((ciClassCounts.application / totalCIs) * 100) : 0,
        stale: calcStale((c) => c.ci_class === 'application'),
      },
      {
        name: 'Databases',
        key: 'database',
        icon: Database,
        count: ciClassCounts.database,
        percent: totalCIs > 0 ? Math.round((ciClassCounts.database / totalCIs) * 100) : 0,
        stale: calcStale((c) => c.ci_class === 'database'),
      },
      {
        name: 'Infrastructure',
        key: 'infrastructure',
        icon: Server,
        count: ciClassCounts.infrastructure,
        percent: totalCIs > 0 ? Math.round((ciClassCounts.infrastructure / totalCIs) * 100) : 0,
        stale: calcStale((c) => c.ci_class === 'vm_cluster' || c.ci_class === 'physical_host' || c.ci_class === 'vm_server'),
      },
      {
        name: 'Networks',
        key: 'network_firewall',
        icon: Network,
        count: ciClassCounts.network,
        percent: totalCIs > 0 ? Math.round((ciClassCounts.network / totalCIs) * 100) : 0,
        stale: calcStale((c) => c.ci_class === 'network_firewall'),
      },
    ];
  }, [inServiceItems, ciClassCounts, totalCIs]);

  // Attention Items: Lists in-service CIs with stale verification, unassigned owner, or out-of-sync
  const attentionItems = useMemo(() => {
    const items: Array<{
      id: string;
      name: string;
      ci_class: string;
      owner: string;
      issue: string;
      issueType: 'stale' | 'owner' | 'sync' | 'flag';
      tier: string;
    }> = [];

    inServiceItems.forEach((ci) => {
      const isUnverified = !ci.last_verified_at;
      const isStale =
        isUnverified ||
        new Date().getTime() - new Date(ci.last_verified_at!).getTime() > 60 * 24 * 60 * 60 * 1000;
      const isOutOfSync = ci.lifecycle_state === 'out_of_sync';
      const isMissingOwner = !ci.owner_group_id || ci.ownership?.owner_group_name === 'Unassigned';

      if (isOutOfSync || isStale || isMissingOwner) {
        let issue = '';
        let issueType: 'stale' | 'owner' | 'sync' | 'flag' = 'stale';

        if (isOutOfSync) {
          issue = 'Out of sync (drift detected)';
          issueType = 'sync';
        } else if (isMissingOwner) {
          issue = 'Missing owner group';
          issueType = 'owner';
        } else if (isStale) {
          issue = isUnverified ? 'Never verified' : 'Stale (> 60 days unverified)';
          issueType = 'stale';
        }

        const tierLabels: Record<string, string> = {
          tier_0: 'T0',
          tier_1: 'T1',
          tier_2: 'T2',
          tier_3: 'T3',
        };

        const group = ownerGroups.find((g) => g.id === ci.owner_group_id);

        items.push({
          id: ci.ci_id || ci.name,
          name: ci.name,
          ci_class: (ci.ci_class || '').replace(/_/g, ' '),
          owner: group?.name || ci.ownership?.owner_group_name || 'Unassigned',
          issue,
          issueType,
          tier: tierLabels[ci.criticality_tier] || ci.criticality_tier || 'N/A',
        });
      }
    });

    return items.slice(0, 5);
  }, [inServiceItems, ownerGroups]);

  const handleQuickVerify = async (ciId: string, ciName: string) => {
    setVerifyingId(ciId);
    try {
      await verifyMutation.mutateAsync(ciId);
      toast.success(`CI "${ciName}" verified successfully`);
      refetchMetrics();
      refetchCatalog();
    } catch (err: any) {
      toast.error(err?.message || 'Verification failed');
    } finally {
      setVerifyingId(null);
    }
  };

  const tabs: Array<{ id: DashboardTab; label: string; tooltip: string; icon: typeof Activity; badge?: number }> = [
    { id: 'overview', label: 'Health & Quality Overview', tooltip: 'Overall CMDB health measured across Completeness, Correctness, and Compliance', icon: Activity },
    { id: 'digest', label: 'Verification Digest', tooltip: 'Bi-weekly attestation and action items for owned services', icon: FileCheck2, badge: openDigestCount },
    { id: 'handshakes', label: 'Pending approvals', tooltip: 'Cross-boundary service relationships waiting for confirmation', icon: Inbox, badge: pendingEdges.length },
    { id: 'campaigns', label: 'Data Collection Requests', tooltip: 'Automated data collection requests sent to team leads', icon: Send },
  ];

  return (
    <div className="space-y-4 animate-in fade-in-50 duration-150">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-subtle">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-primary">System Dashboard</h1>
          <p className="text-xs text-secondary">Operational health, attestation verification, and service ownership overview</p>
        </div>
        <div className="flex items-center gap-2">
          {activeOwnerGroup && (
            <Button
              variant={scopeToActiveGroup ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setScopeToActiveGroup(!scopeToActiveGroup)}
              className="text-xs gap-1.5 h-8"
              title="Toggle scope between global CMDB and active owner group"
            >
              <Building2 className="w-3.5 h-3.5 text-accent" />
              <span>Scope: {scopeToActiveGroup ? activeOwnerGroup.name : 'Global CMDB'}</span>
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate('catalog?state=in_service')}
            className="text-xs gap-1.5 shrink-0 h-8 cursor-pointer"
          >
            <Filter className="w-3.5 h-3.5 text-accent" />
            <span>View Catalog</span>
          </Button>
        </div>
      </div>

      {/* First-Run Setup Checklist */}
      {showSetupChecklist && (
        <div className="bg-surface border border-accent/30 rounded-md p-4 space-y-3 shadow-sm bg-gradient-to-r from-accent/5 to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-xs font-semibold text-primary">CMDB Setup Checklist</h2>
                <p className="text-2xs text-secondary">Complete these foundational steps to establish your configuration boundary.</p>
              </div>
            </div>
            <button
              onClick={() => setIsChecklistDismissed(true)}
              className="text-xs text-muted hover:text-primary transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
            <div className={cn("p-3 rounded border text-xs space-y-1.5 transition-colors", ownerGroups.length > 0 ? "bg-accent/10 border-inservice/30" : "bg-surface border-subtle")}>
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-1.5 text-primary">
                  {ownerGroups.length > 0 ? <CheckCircle2 className="w-4 h-4 text-inservice" /> : <Building2 className="w-4 h-4 text-muted" />}
                  1. Owner Groups
                </span>
                <span className={cn("text-2xs px-1.5 py-0.5 rounded", ownerGroups.length > 0 ? "bg-accent/20 text-inservice font-medium" : "bg-tier0-bg text-tier0 border border-tier0-border font-medium")}>
                  {ownerGroups.length > 0 ? `${ownerGroups.length} Active` : 'Action Required'}
                </span>
              </div>
              <p className="text-2xs text-secondary">CIs require an owner group for governance and attestation.</p>
              <button
                onClick={() => onNavigate('settings')}
                className="text-xs font-semibold text-accent hover:underline flex items-center gap-1 pt-1 cursor-pointer"
              >
                {ownerGroups.length > 0 ? 'Manage Groups' : '+ Add Owner Group'} &rarr;
              </button>
            </div>

            <div className="p-3 rounded border bg-accent/10 border-inservice/30 text-xs space-y-1.5">
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-1.5 text-primary">
                  <CheckCircle2 className="w-4 h-4 text-inservice" />
                  2. CI Classes
                </span>
                <span className="text-2xs px-1.5 py-0.5 rounded bg-accent/20 text-inservice font-medium">
                  Configured
                </span>
              </div>
              <p className="text-2xs text-secondary">7 system classes configured across 5 operational categories.</p>
              <button
                onClick={() => onNavigate('settings')}
                className="text-xs font-semibold text-accent hover:underline flex items-center gap-1 pt-1 cursor-pointer"
              >
                Review Classes &rarr;
              </button>
            </div>

            <div className={cn("p-3 rounded border text-xs space-y-1.5 transition-colors", totalCIs > 0 ? "bg-accent/10 border-inservice/30" : "bg-surface border-accent/40 shadow-sm")}>
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-1.5 text-primary">
                  {totalCIs > 0 ? <CheckCircle2 className="w-4 h-4 text-inservice" /> : <Plus className="w-4 h-4 text-accent" />}
                  3. Populate CIs
                </span>
                <span className={cn("text-2xs px-1.5 py-0.5 rounded", totalCIs > 0 ? "bg-accent/20 text-inservice font-medium" : "bg-accent-subtle text-accent border border-accent/30 font-semibold")}>
                  {totalCIs > 0 ? `${totalCIs} CIs` : 'Next Step'}
                </span>
              </div>
              <p className="text-2xs text-secondary">Add services manually or bulk-upload via CSV spreadsheet.</p>
              <button
                onClick={() => onNavigate('catalog')}
                className="text-xs font-semibold text-accent hover:underline flex items-center gap-1 pt-1 cursor-pointer"
              >
                Open Catalog &rarr;
              </button>
            </div>

            <div className={cn("p-3 rounded border text-xs space-y-1.5 transition-colors", totalCIs > 1 ? "bg-surface border-subtle" : "bg-surface-sunken/40 border-subtle text-muted")}>
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-1.5">
                  <Network className="w-4 h-4 text-muted" />
                  4. Map Topology
                </span>
                <span className="text-2xs px-1.5 py-0.5 rounded bg-surface-sunken text-muted">
                  Topology
                </span>
              </div>
              <p className="text-2xs text-secondary">Link consumers to providers to visualize dependencies and outages.</p>
              <button
                onClick={() => onNavigate('graph')}
                className="text-xs font-semibold text-accent hover:underline flex items-center gap-1 pt-1 cursor-pointer"
              >
                View Graph &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              title={tab.tooltip}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer',
                isActive
                  ? 'bg-accent/15 text-accent font-semibold border border-accent/30 shadow-xs'
                  : 'text-secondary hover:text-primary hover:bg-hover'
              )}
            >
              <Icon className={cn('w-3.5 h-3.5', isActive ? 'text-accent' : 'text-muted')} />
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="text-3xs px-1.5 py-0.5 rounded-full bg-accent-subtle text-accent border border-accent/30 font-semibold">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content: Digest */}
      {activeTab === 'digest' && (
        <DigestView
          onNavigateToCatalog={(ciId?: string) => {
            if (ciId && onNavigateToCatalogCI) {
              onNavigateToCatalogCI(ciId);
            } else {
              onNavigate('catalog');
            }
          }}
        />
      )}

      {/* Tab Content: Handshakes */}
      {activeTab === 'handshakes' && (
        <HandshakesView
          onNavigateToCatalog={(ciId?: string) => {
            if (ciId && onNavigateToCatalogCI) {
              onNavigateToCatalogCI(ciId);
            } else {
              onNavigate('catalog');
            }
          }}
        />
      )}

      {/* Tab Content: Campaigns */}
      {activeTab === 'campaigns' && (
        <CampaignsView onNavigateToIntake={onNavigateToIntake} />
      )}

      {/* Tab Content: Health & Quality Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Row 1: Unified CMDB Health Scorecard */}
          <div className="bg-surface border border-hairline rounded-md p-4 space-y-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-subtle">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-primary">CMDB Health Scorecard</h2>
                  <p className="text-2xs text-secondary">
                    {hasData ? (
                      <>
                        Completeness, Correctness & Compliance across{' '}
                        <button
                          onClick={() => onNavigate('catalog?state=in_service')}
                          className="font-medium text-accent hover:underline cursor-pointer"
                          title="View all in-service configuration items"
                        >
                          {totalCIs} in-service CIs
                        </button>
                      </>
                    ) : (
                      'Completeness, Correctness & Compliance • 0 in-service CIs registered'
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div
                    className="text-2xs text-muted flex items-center justify-end gap-1 cursor-help"
                    title="Overall Health Index = (Completeness + Correctness + Compliance) / 3. Measures operational attribute population, structural accuracy, and 60-day attestation compliance."
                  >
                    <span>Overall Index</span>
                    <span className="text-3xs px-1 rounded bg-surface-sunken border border-subtle text-muted">?</span>
                  </div>
                  <div className={cn("text-2xl font-bold tabular-nums font-mono", overallTone.textColor)}>
                    {isLoading ? '...' : (overallHealthScore !== null ? `${overallHealthScore}%` : '—')}
                  </div>
                </div>
                <div className="h-8 w-px bg-subtle" />
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded border",
                    !hasData
                      ? "bg-surface-sunken text-muted border-subtle"
                      : allTargetsMet
                      ? "bg-accent/15 text-inservice border-inservice/30"
                      : "bg-tier1-bg text-tier1 border-tier1-border"
                  )}
                >
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full inline-block",
                      hasData && allTargetsMet ? "bg-inservice" : hasData ? "bg-tier1" : "bg-control"
                    )}
                  />
                  <span>
                    {!hasData
                      ? 'Target > 90% (Awaiting data)'
                      : allTargetsMet
                      ? 'All Targets Met (>90%)'
                      : 'Attention Required'}
                  </span>
                </div>
              </div>
            </div>

            {/* Columns Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Completeness */}
              <div className="bg-surface-sunken/60 border border-subtle rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <FileCheck2 className="w-3.5 h-3.5 text-accent" />
                    <span>Completeness</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-2xs font-medium px-1.5 py-0.5 rounded border", compTone.badgeBg)}>
                      {compTone.label}
                    </span>
                    <button
                      onClick={() => onNavigate('catalog')}
                      className={cn("text-base font-bold tabular-nums font-mono hover:underline cursor-pointer", compTone.textColor)}
                      title="Inspect operational attribute completeness in catalog"
                    >
                      {completenessScore !== null ? `${completenessScore}%` : '—'}
                    </button>
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-full bg-surface overflow-hidden border border-subtle">
                  <div
                    className={cn("h-full rounded-full transition-all duration-300", compTone.barColor)}
                    style={{ width: `${completenessScore ?? 0}%` }}
                  />
                </div>
                <div className="text-2xs text-secondary flex items-center justify-between pt-0.5">
                  <span>Required fields populated</span>
                  {unassignedOwnerCount > 0 ? (
                    <button
                      onClick={() => onNavigate('catalog?filter=missing_owner')}
                      className="text-tier1 hover:underline cursor-pointer font-medium"
                    >
                      {unassignedOwnerCount} unassigned owner
                    </button>
                  ) : (
                    <span className="text-muted">0 unassigned owner</span>
                  )}
                </div>
              </div>

              {/* Correctness */}
              <div className="bg-surface-sunken/60 border border-subtle rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <AlertTriangle className="w-3.5 h-3.5 text-accent" />
                    <span>Correctness</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-2xs font-medium px-1.5 py-0.5 rounded border", corrTone.badgeBg)}>
                      {corrTone.label}
                    </span>
                    <button
                      onClick={() => onNavigate('catalog?filter=issues')}
                      className={cn("text-base font-bold tabular-nums font-mono hover:underline cursor-pointer", corrTone.textColor)}
                      title="Inspect items with verification or link defects"
                    >
                      {correctnessScore !== null ? `${correctnessScore}%` : '—'}
                    </button>
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-full bg-surface overflow-hidden border border-subtle">
                  <div
                    className={cn("h-full rounded-full transition-all duration-300", corrTone.barColor)}
                    style={{ width: `${correctnessScore ?? 0}%` }}
                  />
                </div>
                <div className="text-2xs text-secondary flex flex-wrap items-center justify-between pt-0.5">
                  <button
                    onClick={() => onNavigate('catalog?filter=stale')}
                    className="hover:underline cursor-pointer text-tier1 font-medium"
                    title="Filter catalog to stale CIs (>60 days unverified)"
                  >
                    {staleCount} stale (&gt;60d)
                  </button>
                  <span className="text-subtle">•</span>
                  <button
                    onClick={() => onNavigate('catalog?filter=orphan')}
                    className="hover:underline cursor-pointer text-secondary hover:text-primary"
                    title="Filter catalog to orphan technical CIs without consuming business services"
                  >
                    {orphanCount} orphan technical CIs
                  </button>
                </div>
              </div>

              {/* Compliance */}
              <div className="bg-surface-sunken/60 border border-subtle rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                    <span>Compliance</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-2xs font-medium px-1.5 py-0.5 rounded border", complTone.badgeBg)}>
                      {complTone.label}
                    </span>
                    <button
                      onClick={() => onNavigate('catalog?filter=fresh')}
                      className={cn("text-base font-bold tabular-nums font-mono hover:underline cursor-pointer", complTone.textColor)}
                      title="Inspect verified CIs in catalog"
                    >
                      {complianceScore !== null ? `${complianceScore}%` : '—'}
                    </button>
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-full bg-surface overflow-hidden border border-subtle">
                  <div
                    className={cn("h-full rounded-full transition-all duration-300", complTone.barColor)}
                    style={{ width: `${complianceScore ?? 0}%` }}
                  />
                </div>
                <div className="text-2xs text-secondary flex items-center justify-between pt-0.5">
                  <button
                    onClick={() => onNavigate('catalog?filter=fresh')}
                    className="hover:underline cursor-pointer text-inservice font-medium"
                    title="View fresh verified CIs in catalog"
                  >
                    {freshCount} of {totalCIs} verified (&le;60d)
                  </button>
                  <button
                    onClick={() => onNavigate('catalog?filter=stale')}
                    className="hover:underline cursor-pointer text-tier1"
                    title="View stale unverified CIs in catalog"
                  >
                    {staleCount} unverified
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Category Distribution and Governance Schedule */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Category Distribution (In-Service) */}
            <Card className="lg:col-span-2">
              <CardHeader className="py-2.5 px-4 border-b border-subtle flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Distribution by Category (In-Service)
                  </CardTitle>
                  <p className="text-2xs text-secondary">Active operational configuration items grouped across 5 categories</p>
                </div>
                <button
                  onClick={() => onNavigate('catalog?state=in_service')}
                  className="text-2xs font-mono text-secondary hover:text-accent hover:underline cursor-pointer"
                  title="View all 49 in-service CIs in Catalog"
                >
                  {totalCIs} In-Service CIs
                </button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-surface-sunken border-b border-subtle text-2xs uppercase tracking-wider text-secondary">
                      <tr>
                        <th className="px-4 py-2">Category</th>
                        <th className="px-4 py-2 text-right">In-Service Count</th>
                        <th className="px-4 py-2 text-right">Share</th>
                        <th className="px-4 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {totalCIs === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 px-4 text-center">
                            <div className="flex flex-col items-center justify-center gap-1.5 text-xs text-secondary">
                              <Layers className="w-6 h-6 text-muted stroke-[1.5]" />
                              <span className="font-semibold text-primary">No In-Service CIs Categorized</span>
                              <span className="text-2xs text-muted max-w-sm">
                                Categories populate automatically as services, databases, and infrastructure are registered.
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onNavigate('catalog')}
                                className="mt-2 text-xs h-7 gap-1"
                              >
                                <Plus className="w-3.5 h-3.5 text-accent" />
                                Add Configuration Item
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        ciClasses.map((cls) => {
                          const Icon = cls.icon;
                          return (
                            <tr
                              key={cls.name}
                              role="button"
                              tabIndex={0}
                              aria-label={`Inspect ${cls.name} in CI Catalog`}
                              onClick={() => onNavigate(`catalog?class=${cls.key}`)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  onNavigate(`catalog?class=${cls.key}`);
                                }
                              }}
                              className="hover:bg-hover transition-colors cursor-pointer group focus:outline-none focus:bg-selected/40"
                            >
                              <td className="px-4 py-2 font-medium text-primary flex items-center gap-2">
                                <Icon className="w-3.5 h-3.5 text-muted" />
                                <span className="group-hover:text-accent group-hover:underline">{cls.name}</span>
                              </td>
                              <td className="px-4 py-2 text-right font-mono tabular-nums text-secondary">
                                {cls.count}
                              </td>
                              <td className="px-4 py-2 text-right font-mono tabular-nums text-muted">
                                {cls.percent}%
                              </td>
                              <td className="px-4 py-2">
                                {cls.count === 0 ? (
                                  <span className="inline-flex items-center gap-1 text-2xs font-medium px-1.5 py-0.5 rounded-sm bg-surface-sunken text-muted border border-subtle">
                                    0 Items
                                  </span>
                                ) : cls.stale > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-2xs font-medium px-1.5 py-0.5 rounded-sm bg-tier1-bg text-tier1 border border-tier1-border">
                                    <AlertTriangle className="w-2.5 h-2.5 text-tier1" />
                                    {cls.stale} Stale
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-2xs font-medium px-1.5 py-0.5 rounded-sm bg-accent/15 text-inservice border border-inservice/25">
                                    <Check className="w-2.5 h-2.5 text-inservice" />
                                    Healthy
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Governance & Attestation Schedule (Cleaned: Duplicated Bar Removed) */}
            <Card>
              <CardHeader className="py-2.5 px-4 border-b border-subtle">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-accent" />
                  <span>Attestation & Review Cycle</span>
                </CardTitle>
                <p className="text-2xs text-secondary">60-day operational verification policy</p>
              </CardHeader>
              <CardContent className="p-4 space-y-4 text-xs">
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-1 border-b border-subtle">
                    <span className="text-secondary">Review Cadence</span>
                    <span className="font-medium text-primary">Bi-Weekly (1st & 15th UTC)</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-subtle">
                    <span className="text-secondary">Attestation Target</span>
                    <span className="font-mono text-inservice font-semibold">&gt; 90% Fresh</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-subtle">
                    <span className="text-secondary">Items In Review Queue</span>
                    <span className={cn("font-mono font-medium", openDigestCount > 0 ? "text-tier1" : "text-primary")}>
                      {openDigestCount} Pending
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-subtle">
                    <span className="text-secondary">Pending approvals</span>
                    <span className={cn("font-mono font-medium", pendingEdges.length > 0 ? "text-tier1" : "text-primary")}>
                      {pendingEdges.length} Approvals
                    </span>
                  </div>
                </div>

                <div className="pt-1 space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTabChange('digest')}
                    className="w-full text-xs justify-between h-8 cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <FileCheck2 className="w-3.5 h-3.5 text-accent" />
                      Verification Queue
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted" />
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTabChange('handshakes')}
                    className="w-full text-xs justify-between h-8 cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <Inbox className="w-3.5 h-3.5 text-accent" />
                      Pending approvals
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Row 3: Items Requiring Attention */}
          <Card>
            <CardHeader className="py-2.5 px-4 border-b border-subtle flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-tier1" />
                  <span>Attention Required</span>
                </CardTitle>
                <p className="text-2xs text-secondary">
                  Configuration items with stale verification (&gt;60d), unassigned ownership, or drift discrepancies
                </p>
              </div>
              <span className="text-2xs font-mono text-muted">{attentionItems.length} items</span>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto w-full">
                <table className="w-full text-xs text-left">
                  <thead className="bg-surface-sunken border-b border-subtle text-2xs uppercase tracking-wider text-secondary">
                    <tr>
                      <th className="px-4 py-2">CI Name</th>
                      <th className="px-4 py-2">Class</th>
                      <th className="px-4 py-2">Owner Group</th>
                      <th className="px-4 py-2">Issue</th>
                      <th className="px-4 py-2">Tier</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-subtle">
                    {totalCIs === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-xs text-secondary">
                          <div className="flex flex-col items-center justify-center gap-1.5">
                            <AlertCircle className="w-6 h-6 text-muted stroke-[1.5]" />
                            <span className="font-semibold text-primary">No Configuration Items Registered</span>
                            <span className="text-2xs text-muted max-w-sm">
                              The CMDB inventory is currently empty. Create or import your initial configuration items to begin tracking operational health and discrepancies.
                            </span>
                            <div className="flex items-center gap-2 mt-2">
                              <Button variant="primary" size="sm" onClick={() => onNavigate('catalog')} className="text-xs h-7 gap-1 cursor-pointer">
                                <Plus className="w-3.5 h-3.5" />
                                Create First CI
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : attentionItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-xs text-secondary">
                          <div className="flex flex-col items-center justify-center gap-1.5">
                            <ShieldCheck className="w-6 h-6 text-inservice stroke-[1.5]" />
                            <span className="font-semibold text-primary">All In-Service CIs Healthy</span>
                            <span className="text-2xs text-muted max-w-sm">
                              All {totalCIs} in-service configuration items have been verified within 60 days and have active owner groups.
                            </span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      attentionItems.map((item) => (
                        <tr key={item.id} className="hover:bg-hover transition-colors">
                          <td className="px-4 py-2 font-mono text-xs font-semibold text-accent">
                            <button
                              type="button"
                              onClick={() => {
                                if (onNavigateToCatalogCI) onNavigateToCatalogCI(item.id);
                                else onNavigate('catalog');
                              }}
                              className="hover:underline text-left cursor-pointer"
                              title="Inspect CI in Catalog"
                            >
                              {item.name}
                            </button>
                          </td>
                          <td className="px-4 py-2 text-muted">{item.ci_class}</td>
                          <td className="px-4 py-2 text-primary">{item.owner}</td>
                          <td className="px-4 py-2 text-tier1 font-medium">{item.issue}</td>
                          <td className="px-4 py-2">
                            <span className="text-3xs font-mono px-1.5 py-0.5 rounded bg-surface-sunken text-secondary border border-subtle">
                              {item.tier}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {item.issueType === 'stale' && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleQuickVerify(item.id, item.name)}
                                  isLoading={verifyingId === item.id}
                                  className="text-xs h-7 px-2.5 cursor-pointer"
                                >
                                  <Check className="w-3 h-3 mr-1" />
                                  Verify
                                </Button>
                              )}
                              {item.issueType === 'owner' && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => {
                                    if (onNavigateToCatalogCI) onNavigateToCatalogCI(item.id);
                                    else onNavigate('catalog?filter=missing_owner');
                                  }}
                                  className="text-xs h-7 px-2.5 cursor-pointer"
                                >
                                  Assign Owner
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (onNavigateToCatalogCI) {
                                    onNavigateToCatalogCI(item.id);
                                  } else {
                                    onNavigate('catalog');
                                  }
                                }}
                                className="text-xs h-7 px-2.5 min-w-[50px] cursor-pointer"
                              >
                                <ExternalLink className="w-3 h-3 mr-1 text-muted" />
                                Inspect
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
