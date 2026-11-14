import { useState, useMemo } from 'react';
import {
  Search,
  CheckCircle,
  Trash2,
  Eye,
  Server,
  Database,
  Layers,
  Cpu,
  Shield,
  Clock,
  X,
  Network,
  AlertTriangle,
  Flag,
} from 'lucide-react';
import { useCICatalog, useVerifyCI, useRetireCI, useCreateCIFlag, type CIEnvelope } from '../../api/endpoints';
import { CriticalityChip } from '../../components/governance/criticality-chip';
import { LifecycleBadge } from '../../components/governance/lifecycle-badge';
import { RFC9457Alert } from '../../components/governance/rfc9457-alert';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { formatRelativeTime } from '../../lib/utils';
import { ApiProblemError } from '../../api/client';
import { useAuth } from '../../store/auth-context';

interface CatalogViewProps {
  onNavigateToGraph?: (ciId: string) => void;
}

export function CatalogView({ onNavigateToGraph }: CatalogViewProps) {
  const { activeRole } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedEnv, setSelectedEnv] = useState<string>('');
  const [selectedTier, setSelectedTier] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');

  const [inspectingCI, setInspectingCI] = useState<CIEnvelope | null>(null);
  const [retiringCI, setRetiringCI] = useState<CIEnvelope | null>(null);
  const [forceRetire, setForceRetire] = useState(false);
  const [flaggingCI, setFlaggingCI] = useState<CIEnvelope | null>(null);
  const [flagReason, setFlagReason] = useState('');

  const [activeProblem, setActiveProblem] = useState<ApiProblemError['problem'] | null>(null);

  const { data: catalogData, isLoading, refetch } = useCICatalog({
    ci_class: selectedClass || undefined,
    environment: selectedEnv || undefined,
    criticality_tier: selectedTier || undefined,
    lifecycle_state: selectedState || undefined,
  });

  const verifyMutation = useVerifyCI();
  const retireMutation = useRetireCI();
  const flagMutation = useCreateCIFlag();

  const filteredItems = useMemo(() => {
    const items = catalogData?.items || [];
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (ci) =>
        ci.name.toLowerCase().includes(q) ||
        ci.technical_contact.toLowerCase().includes(q) ||
        (ci.primary_endpoint && ci.primary_endpoint.toLowerCase().includes(q)) ||
        (ci.ownership?.owner_group_name && ci.ownership.owner_group_name.toLowerCase().includes(q))
    );
  }, [catalogData?.items, searchQuery]);

  const handleVerify = async (ci: CIEnvelope) => {
    if (!ci.ci_id) return;
    setActiveProblem(null);
    try {
      await verifyMutation.mutateAsync(ci.ci_id);
      if (inspectingCI?.ci_id === ci.ci_id) {
        setInspectingCI((prev) => (prev ? { ...prev, last_verified_at: new Date().toISOString() } : null));
      }
    } catch (err) {
      if (err instanceof ApiProblemError) setActiveProblem(err.problem);
    }
  };

  const handleRetire = async () => {
    if (!retiringCI || !retiringCI.ci_id) return;
    setActiveProblem(null);
    try {
      await retireMutation.mutateAsync({ id: retiringCI.ci_id, force: forceRetire });
      setRetiringCI(null);
      setForceRetire(false);
      if (inspectingCI?.ci_id === retiringCI.ci_id) setInspectingCI(null);
    } catch (err) {
      if (err instanceof ApiProblemError) {
        setActiveProblem(err.problem);
      }
    }
  };

  const handleFlagSubmit = async () => {
    if (!flaggingCI || !flaggingCI.ci_id || !flagReason.trim()) return;
    try {
      await flagMutation.mutateAsync({ ciId: flaggingCI.ci_id, reason: flagReason });
      setFlaggingCI(null);
      setFlagReason('');
      refetch();
    } catch (err) {
      if (err instanceof ApiProblemError) setActiveProblem(err.problem);
    }
  };

  const getClassIcon = (ciClass: string) => {
    switch (ciClass) {
      case 'database':
        return Database;
      case 'application':
        return Layers;
      case 'vm_cluster':
        return Cpu;
      case 'physical_host':
        return Server;
      case 'network_firewall':
        return Shield;
      default:
        return Server;
    }
  };

  return (
    <div className="space-y-4 max-w-7xl w-full mx-auto animate-in fade-in-50 duration-150">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b border-obsidian-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Configuration Item (CI) Catalog</h1>
          <p className="text-xs text-obsidian-400 mt-0.5">
            Decentralized inventory governed by modern ownership teams and immutable audit trails.
          </p>
        </div>
        <div className="text-xs font-mono text-obsidian-400 bg-obsidian-950/60 px-3 py-1.5 rounded border border-obsidian-800">
          Total Filtered: <span className="font-semibold text-white">{filteredItems.length}</span> CIs
        </div>
      </div>

      {/* RFC 9457 Problem Alert */}
      {activeProblem && (
        <RFC9457Alert
          problem={activeProblem}
          onDismiss={() => setActiveProblem(null)}
          onNavigateToCI={(id) => {
            const found = catalogData?.items.find((item) => item.ci_id === id);
            if (found) setInspectingCI(found);
          }}
        />
      )}

      {/* Filter Bar */}
      <div className="bg-obsidian-850/80 border border-obsidian-750 p-3 rounded-lg flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-56">
          <Search className="w-3.5 h-3.5 text-obsidian-400 absolute left-3 top-2.5" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, primary endpoint, contact, or team..."
            className="pl-8"
          />
        </div>

        {/* CI Class Filter */}
        <select
          value={selectedClass}
          onChange={(e) => setSelectedClass(e.target.value)}
          className="h-8 rounded border border-obsidian-700 bg-obsidian-950/60 px-2.5 text-xs text-obsidian-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All CI Classes</option>
          <option value="business_service">Business Service</option>
          <option value="application">Application</option>
          <option value="database">Database</option>
          <option value="vm_cluster">VM Cluster</option>
          <option value="physical_host">Physical Host</option>
          <option value="network_firewall">Network Firewall</option>
        </select>

        {/* Environment Filter */}
        <select
          value={selectedEnv}
          onChange={(e) => setSelectedEnv(e.target.value)}
          className="h-8 rounded border border-obsidian-700 bg-obsidian-950/60 px-2.5 text-xs text-obsidian-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Environments</option>
          <option value="prod">Production</option>
          <option value="dr">Disaster Recovery</option>
          <option value="staging">Staging</option>
        </select>

        {/* Criticality Filter */}
        <select
          value={selectedTier}
          onChange={(e) => setSelectedTier(e.target.value)}
          className="h-8 rounded border border-obsidian-700 bg-obsidian-950/60 px-2.5 text-xs text-obsidian-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Criticalities</option>
          <option value="tier_0">Tier 0 (Critical)</option>
          <option value="tier_1">Tier 1 (High)</option>
          <option value="tier_2">Tier 2 (Standard)</option>
          <option value="tier_3">Tier 3 (Low)</option>
        </select>

        {/* Lifecycle State Filter */}
        <select
          value={selectedState}
          onChange={(e) => setSelectedState(e.target.value)}
          className="h-8 rounded border border-obsidian-700 bg-obsidian-950/60 px-2.5 text-xs text-obsidian-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Lifecycles</option>
          <option value="in_service">In Service</option>
          <option value="planned">Planned</option>
          <option value="deprecated">Deprecated</option>
          <option value="retired">Retired</option>
        </select>

        {(selectedClass || selectedEnv || selectedTier || selectedState || searchQuery) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedClass('');
              setSelectedEnv('');
              setSelectedTier('');
              setSelectedState('');
              setSearchQuery('');
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* High-Density Data Table */}
      <div className="bg-obsidian-850/60 border border-obsidian-750 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-obsidian-900/90 border-b border-obsidian-750 text-obsidian-400 font-mono text-3xs uppercase tracking-wider">
                <th className="py-2.5 px-4 font-semibold">CI Name & Class</th>
                <th className="py-2.5 px-3 font-semibold">Tier</th>
                <th className="py-2.5 px-3 font-semibold">Environment</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 font-semibold">Owner Group & Contact</th>
                <th className="py-2.5 px-3 font-semibold">Endpoint</th>
                <th className="py-2.5 px-3 font-semibold">Last Verified</th>
                <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-obsidian-800">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-obsidian-400 text-xs">
                    Loading configuration catalog...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center">
                    <p className="text-xs text-obsidian-400">No configuration items match your filter criteria.</p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((ci) => {
                  const Icon = getClassIcon(ci.ci_class);
                  const isVerifiedStale =
                    ci.last_verified_at &&
                    new Date().getTime() - new Date(ci.last_verified_at).getTime() > 60 * 24 * 60 * 60 * 1000;

                  return (
                    <tr
                      key={ci.ci_id || ci.name}
                      className="hover:bg-obsidian-800/50 transition-colors group cursor-pointer"
                      onClick={() => setInspectingCI(ci)}
                    >
                      {/* Name & Class */}
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded bg-obsidian-900 border border-obsidian-750 text-obsidian-300">
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className="font-semibold text-obsidian-100 group-hover:text-blue-400 transition-colors">
                              {ci.name}
                            </div>
                            <div className="text-3xs font-mono text-obsidian-400 uppercase">
                              {ci.ci_class.replace('_', ' ')}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Tier */}
                      <td className="py-2.5 px-3">
                        <CriticalityChip tier={ci.criticality_tier} />
                      </td>

                      {/* Env */}
                      <td className="py-2.5 px-3 font-mono text-2xs uppercase text-obsidian-300">
                        {ci.environment}
                      </td>

                      {/* Lifecycle */}
                      <td className="py-2.5 px-3">
                        <LifecycleBadge state={ci.lifecycle_state} />
                      </td>

                      {/* Owner & Contact */}
                      <td className="py-2.5 px-3">
                        <div className="text-obsidian-200 font-medium truncate max-w-44">
                          {ci.ownership?.owner_group_name || 'Unassigned'}
                        </div>
                        <div className="text-3xs text-obsidian-400 truncate max-w-44">
                          {ci.technical_contact}
                        </div>
                      </td>

                      {/* Endpoint */}
                      <td className="py-2.5 px-3 font-mono text-2xs text-obsidian-300">
                        {ci.primary_endpoint || <span className="text-obsidian-500">—</span>}
                      </td>

                      {/* Verified At */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          {isVerifiedStale && <Clock className="w-3 h-3 text-amber-400" />}
                          <span
                            className={
                              isVerifiedStale ? 'text-amber-400 font-medium' : 'text-obsidian-300'
                            }
                          >
                            {formatRelativeTime(ci.last_verified_at)}
                          </span>
                        </div>
                      </td>

                      {/* Action Buttons */}
                      <td
                        className="py-2.5 px-4 text-right space-x-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Inspect Details"
                          onClick={() => setInspectingCI(ci)}
                        >
                          <Eye className="w-3.5 h-3.5 text-obsidian-400 hover:text-white" />
                        </Button>

                        {activeRole !== 'viewer' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Verify CI (Sets last_verified_at = now)"
                            onClick={() => handleVerify(ci)}
                            isLoading={verifyMutation.isPending}
                          >
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-400 hover:text-emerald-300" />
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="icon"
                          title="Report Dispute / Flag"
                          onClick={() => setFlaggingCI(ci)}
                        >
                          <Flag className="w-3.5 h-3.5 text-amber-400 hover:text-amber-300" />
                        </Button>

                        {activeRole !== 'viewer' && ci.lifecycle_state !== 'retired' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Retire CI (Checks for active dependents)"
                            onClick={() => setRetiringCI(ci)}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-300" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-Over CI Detail Inspector Drawer */}
      {inspectingCI && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-2xs animate-in fade-in-0 duration-150">
          <div className="fixed inset-0" onClick={() => setInspectingCI(null)} />
          <div className="relative w-full max-w-md bg-obsidian-900 border-l border-obsidian-700 h-full p-6 overflow-y-auto space-y-6 shadow-2xl z-10">
            {/* Drawer Header */}
            <div className="flex items-start justify-between pb-4 border-b border-obsidian-800">
              <div className="space-y-1">
                <span className="text-3xs font-mono uppercase bg-obsidian-800 text-obsidian-400 px-1.5 py-0.5 rounded border border-obsidian-700">
                  {inspectingCI.ci_class}
                </span>
                <h2 className="text-lg font-bold text-white">{inspectingCI.name}</h2>
                <div className="text-2xs font-mono text-obsidian-400">{inspectingCI.ci_id}</div>
              </div>
              <button
                onClick={() => setInspectingCI(null)}
                className="text-obsidian-400 hover:text-white p-1 rounded hover:bg-obsidian-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Core 10-Field Governance Envelope */}
            <div className="space-y-3">
              <span className="text-2xs font-mono font-semibold uppercase text-obsidian-400 tracking-wider">
                10-Field Governance Envelope
              </span>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 bg-obsidian-950/60 border border-obsidian-800 rounded">
                  <span className="text-3xs text-obsidian-400 block mb-1">Criticality Tier</span>
                  <CriticalityChip tier={inspectingCI.criticality_tier} />
                </div>

                <div className="p-2.5 bg-obsidian-950/60 border border-obsidian-800 rounded">
                  <span className="text-3xs text-obsidian-400 block mb-1">Lifecycle State</span>
                  <LifecycleBadge state={inspectingCI.lifecycle_state} />
                </div>

                <div className="p-2.5 bg-obsidian-950/60 border border-obsidian-800 rounded">
                  <span className="text-3xs text-obsidian-400 block mb-1">Environment</span>
                  <span className="font-mono uppercase font-semibold text-obsidian-200">
                    {inspectingCI.environment}
                  </span>
                </div>

                <div className="p-2.5 bg-obsidian-950/60 border border-obsidian-800 rounded">
                  <span className="text-3xs text-obsidian-400 block mb-1">Primary Endpoint</span>
                  <span className="font-mono text-2xs text-obsidian-200 truncate block">
                    {inspectingCI.primary_endpoint || 'None'}
                  </span>
                </div>
              </div>

              {/* Ownership Card */}
              {inspectingCI.ownership && (
                <div className="p-3 bg-obsidian-950/60 border border-obsidian-800 rounded text-xs space-y-1.5">
                  <span className="text-3xs font-mono uppercase text-obsidian-400 block">
                    Ownership & Technical Contact
                  </span>
                  <div className="font-semibold text-white">{inspectingCI.ownership.owner_group_name}</div>
                  <div className="text-obsidian-400 text-2xs">
                    Department: <span className="text-obsidian-200">{inspectingCI.ownership.department_name}</span>
                  </div>
                  <div className="text-obsidian-400 text-2xs">
                    Technical Contact: <span className="text-obsidian-200">{inspectingCI.technical_contact}</span>
                  </div>
                  <div className="text-obsidian-400 text-2xs">
                    Team Lead: <span className="text-obsidian-200">{inspectingCI.ownership.team_lead_name}</span>
                  </div>
                </div>
              )}

              {/* Class Metadata (Constraint: <= 2 keys) */}
              <div className="p-3 bg-obsidian-950/60 border border-obsidian-800 rounded text-xs space-y-1.5">
                <span className="text-3xs font-mono uppercase text-obsidian-400 block">
                  Class Metadata (max 2 keys)
                </span>
                {inspectingCI.class_metadata && Object.keys(inspectingCI.class_metadata).length > 0 ? (
                  <div className="space-y-1 font-mono text-2xs">
                    {Object.entries(inspectingCI.class_metadata).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-obsidian-300">
                        <span className="text-obsidian-400">{k}:</span>
                        <span>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-obsidian-500 text-2xs">No additional metadata registered.</div>
                )}
              </div>
            </div>

            {/* Quick Traversal Jump Actions */}
            <div className="pt-2 border-t border-obsidian-800 space-y-2">
              <Button
                variant="primary"
                className="w-full justify-center"
                onClick={() => {
                  if (onNavigateToGraph && inspectingCI.ci_id) onNavigateToGraph(inspectingCI.ci_id);
                  setInspectingCI(null);
                }}
              >
                <Network className="w-4 h-4 mr-2" />
                Inspect Graph & Blast Radius
              </Button>

              {activeRole !== 'viewer' && (
                <Button
                  variant="secondary"
                  className="w-full justify-center"
                  onClick={() => handleVerify(inspectingCI)}
                  isLoading={verifyMutation.isPending}
                >
                  <CheckCircle className="w-4 h-4 mr-2 text-emerald-400" />
                  Verify Operational Status Now
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Safe Retirement Modal with Active Dependent Check */}
      {retiringCI && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in-0 duration-150">
          <div className="w-full max-w-md bg-obsidian-900 border border-red-800/80 rounded-xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <div>
                <h3 className="text-base font-bold text-white">Retire Configuration Item</h3>
                <p className="text-xs text-obsidian-400">
                  Are you sure you want to retire <span className="font-semibold text-white">{retiringCI.name}</span>?
                </p>
              </div>
            </div>

            <p className="text-xs text-obsidian-300 leading-relaxed bg-obsidian-950 p-3 rounded border border-obsidian-800">
              Retiring an active service or infrastructure provider requires that no active upstream services depend on it. If dependent applications are found, standard retirement will be aborted with <code className="text-amber-400 font-mono text-2xs">HTTP 409 Conflict</code>.
            </p>

            {/* Force checkbox for platform admin only */}
            {activeRole === 'platform_admin' && (
              <label className="flex items-center gap-2 text-xs text-red-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={forceRetire}
                  onChange={(e) => setForceRetire(e.target.checked)}
                  className="rounded border-obsidian-700 bg-obsidian-950 text-red-500 focus:ring-red-500"
                />
                <span>Force Retire (Bypasses active dependent lock — Admin Only)</span>
              </label>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setRetiringCI(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRetire}
                isLoading={retireMutation.isPending}
              >
                Confirm Retirement
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Report Dispute Flag Modal */}
      {flaggingCI && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in-0 duration-150">
          <div className="w-full max-w-md bg-obsidian-900 border border-obsidian-750 rounded-xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-amber-400">
              <Flag className="w-5 h-5 shrink-0" />
              <h3 className="text-base font-bold text-white">Report Data-Quality Dispute</h3>
            </div>
            <p className="text-xs text-obsidian-400">
              Flagging <span className="font-semibold text-white">{flaggingCI.name}</span> notifies the owner group ({flaggingCI.ownership?.owner_group_name}) to verify or correct operational metadata.
            </p>

            <div>
              <label className="block text-2xs font-mono uppercase text-obsidian-400 mb-1">
                Reason for Dispute / Correction
              </label>
              <textarea
                value={flagReason}
                onChange={(e) => setFlagReason(e.target.value)}
                rows={3}
                placeholder="e.g. Primary endpoint 10.0.1.5 has been decommissioned; cluster now runs in AWS eu-west-1..."
                className="w-full rounded border border-obsidian-700 bg-obsidian-950 p-2.5 text-xs text-obsidian-100 placeholder:text-obsidian-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-sans"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setFlaggingCI(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleFlagSubmit}
                isLoading={flagMutation.isPending}
                disabled={!flagReason.trim()}
              >
                Submit Flag
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
