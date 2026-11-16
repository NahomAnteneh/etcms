import { useState, useMemo } from 'react';
import {
  Inbox,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Database,
  AlertTriangle,
} from 'lucide-react';
import {
  usePendingEdges,
  useConfirmEdge,
  useFlagMismatchEdge,
  useRejectEdge,
  type PendingEdge,
} from '../../api/endpoints';
import { RFC9457Alert } from '../../components/governance/rfc9457-alert';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { ApiProblemError } from '../../api/client';
import { useAuth } from '../../store/auth-context';
import { useToast } from '../../components/ui/toast';
import { cn } from '../../lib/utils';

interface HandshakesViewProps {
  onNavigateToCatalog?: (ciId: string) => void;
}

function getPendingAgeDays(createdAt: string | undefined): number {
  if (!createdAt) return 0;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
}

export function HandshakesView({ onNavigateToCatalog }: HandshakesViewProps) {
  const { activeRole, activeOwnerGroup } = useAuth();
  const toast = useToast();
  const { data: pendingEdges, isLoading, isError, error, refetch } = usePendingEdges(activeOwnerGroup?.id);

  const confirmMutation = useConfirmEdge();
  const flagMismatchMutation = useFlagMismatchEdge();
  const rejectMutation = useRejectEdge();

  const [activeProblem, setActiveProblem] = useState<ApiProblemError['problem'] | null>(null);
  const [flaggingEdge, setFlaggingEdge] = useState<PendingEdge | null>(null);
  const [flagReason, setFlagReason] = useState('');
  const [rejectingEdge, setRejectingEdge] = useState<PendingEdge | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Multi-select bulk state
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());
  const [isBatchConfirming, setIsBatchConfirming] = useState(false);

  const edges: PendingEdge[] = pendingEdges || [];

  // Group pending edges by Provider (target_ci)
  const groupedEdges = useMemo(() => {
    const groups: Record<string, { provider: PendingEdge['target_ci']; edges: PendingEdge[] }> = {};
    for (const edge of edges) {
      const key = edge.target_ci.ci_id || edge.target_ci.name;
      if (!groups[key]) {
        groups[key] = {
          provider: edge.target_ci,
          edges: [],
        };
      }
      groups[key].edges.push(edge);
    }
    return Object.values(groups);
  }, [edges]);

  const toggleSelectAll = () => {
    if (selectedEdgeIds.size === edges.length && edges.length > 0) {
      setSelectedEdgeIds(new Set());
    } else {
      setSelectedEdgeIds(new Set(edges.map((e) => e.id)));
    }
  };

  const toggleSelectEdge = (id: string) => {
    setSelectedEdgeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = async (edge: PendingEdge) => {
    setActiveProblem(null);
    try {
      await confirmMutation.mutateAsync(edge.id);
      toast.success(`Confirmed dependency from ${edge.source_ci.name} to ${edge.target_ci.name}`);
      setSelectedEdgeIds((prev) => {
        const next = new Set(prev);
        next.delete(edge.id);
        return next;
      });
      refetch();
    } catch (err: any) {
      if (err instanceof ApiProblemError) {
        setActiveProblem(err.problem);
        toast.error(err.problem.detail || err.problem.title || 'Failed to confirm approval');
      } else {
        toast.error(err.message || 'Failed to confirm approval');
      }
    }
  };

  const handleConfirmSelected = async () => {
    if (selectedEdgeIds.size === 0) return;
    setIsBatchConfirming(true);
    let successCount = 0;
    let failCount = 0;

    for (const id of selectedEdgeIds) {
      try {
        await confirmMutation.mutateAsync(id);
        successCount++;
      } catch {
        failCount++;
      }
    }

    setIsBatchConfirming(false);
    setSelectedEdgeIds(new Set());
    if (successCount > 0) {
      toast.success(`Confirmed ${successCount} approval(s) successfully`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} approval(s) failed`);
    }
    refetch();
  };

  const handleFlagMismatch = async () => {
    if (!flaggingEdge || !flagReason.trim()) return;
    setActiveProblem(null);
    try {
      await flagMismatchMutation.mutateAsync({ edgeId: flaggingEdge.id, reason: flagReason });
      toast.warning(`Dispute logged for ${flaggingEdge.source_ci.name} → ${flaggingEdge.target_ci.name}`);
      setFlaggingEdge(null);
      setFlagReason('');
      refetch();
    } catch (err: any) {
      if (err instanceof ApiProblemError) {
        setActiveProblem(err.problem);
        toast.error(err.problem.detail || err.problem.title || 'Failed to flag mismatch');
      } else {
        toast.error(err.message || 'Failed to flag mismatch');
      }
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingEdge || rejectMutation.isPending) return;
    setActiveProblem(null);
    try {
      await rejectMutation.mutateAsync({
        edgeId: rejectingEdge.id,
        reason: rejectReason.trim() || undefined,
      });
      toast.info(`Rejected dependency from ${rejectingEdge.source_ci.name} to ${rejectingEdge.target_ci.name}`);
      setRejectingEdge(null);
      setRejectReason('');
      refetch();
    } catch (err: any) {
      if (err instanceof ApiProblemError) {
        setActiveProblem(err.problem);
        toast.error(err.problem.detail || err.problem.title || 'Failed to reject approval');
      } else {
        toast.error(err.message || 'Failed to reject approval');
      }
    }
  };

  return (
    <div className="space-y-4 w-full animate-in fade-in-50 duration-150">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b border-subtle">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-primary flex items-center gap-2">
            Pending approvals
            <span className="text-2xs font-mono uppercase bg-surface-sunken text-secondary border border-subtle px-2 py-0.5 rounded font-semibold">
              {edges.length} Pending
            </span>
          </h1>
          <p className="text-xs text-secondary mt-0.5">
            Cross-boundary dependencies awaiting confirmation.
          </p>
        </div>
      </div>

      {/* RFC 9457 Error Alert */}
      {activeProblem && (
        <RFC9457Alert problem={activeProblem} onDismiss={() => setActiveProblem(null)} />
      )}

      {/* Bulk Action Bar */}
      {selectedEdgeIds.size > 0 && (
        <div className="bg-header-bg text-white px-4 py-2 rounded-md flex items-center justify-between shadow-snow-dropdown animate-in fade-in-50 duration-150">
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xs font-semibold px-2 py-0.5 rounded bg-accent/20 text-accent border border-accent/30">
              {selectedEdgeIds.size} selected
            </span>
            <span className="text-xs text-slate-300">Bulk approval actions</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmSelected}
              isLoading={isBatchConfirming}
              className="gap-1.5 h-7 text-xs cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Confirm selected</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedEdgeIds(new Set())}
              className="h-7 text-xs text-slate-300 hover:text-white hover:bg-header-surface cursor-pointer"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Compact Pending Approvals Table */}
      {isLoading ? (
        <div className="p-8 text-center text-xs text-muted bg-surface border border-subtle rounded-md">
          Loading pending approvals...
        </div>
      ) : isError ? (
        <div className="p-8 text-center bg-surface border border-tier0-border rounded-md space-y-3">
          <AlertTriangle className="w-8 h-8 text-tier0 mx-auto stroke-[1.5]" />
          <h3 className="text-sm font-semibold text-primary">Failed to load pending approvals</h3>
          <p className="text-xs text-secondary max-w-md mx-auto">
            {(error as any)?.message || 'An error occurred while fetching pending approvals.'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : edges.length === 0 ? (
        <div className="p-12 text-center bg-surface border border-subtle rounded-md space-y-2">
          <Inbox className="w-10 h-10 text-muted mx-auto stroke-[1.5]" />
          <h3 className="text-sm font-semibold text-primary">No pending approvals</h3>
          <p className="text-xs text-secondary max-w-md mx-auto">
            All cross-boundary dependencies are confirmed. New dependency requests from service intake will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-hairline rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface-sunken border-b border-subtle text-secondary font-mono text-2xs uppercase tracking-wider select-none h-9">
                  <th className="py-2 px-3 w-8 text-center">
                    <input
                      type="checkbox"
                      aria-label="Select all approvals"
                      checked={edges.length > 0 && selectedEdgeIds.size === edges.length}
                      onChange={toggleSelectAll}
                      className="rounded border-control text-accent focus:ring-accent cursor-pointer"
                    />
                  </th>
                  <th className="py-2 px-3 font-medium">Consumer</th>
                  <th className="py-2 px-3 font-medium text-center">Relationship</th>
                  <th className="py-2 px-3 font-medium">Provider</th>
                  <th className="py-2 px-3 font-medium">Age</th>
                  <th className="py-2 px-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {groupedEdges.map((group) => {
                  const providerKey = group.provider.ci_id || group.provider.name;

                  return (
                    <tr key={`group-wrapper-${providerKey}`} className="contents">
                      {/* Provider Group Header Row */}
                      <tr className="bg-surface-sunken/80 border-y border-subtle">
                        <td colSpan={6} className="py-1.5 px-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Database className="w-3.5 h-3.5 text-accent shrink-0" />
                              <span className="font-semibold text-xs text-primary">
                                Provider: {group.provider.name}
                              </span>
                              <span className="text-2xs font-mono text-muted uppercase">
                                ({group.provider.ci_class} • {group.provider.environment})
                              </span>
                              <span className="text-2xs text-secondary">
                                • Owner: {group.provider.owner_group_name}
                              </span>
                            </div>
                            <span className="text-3xs font-mono text-muted">
                              {group.edges.length} request{group.edges.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </td>
                      </tr>

                      {/* Request Rows for this Provider */}
                      {group.edges.map((edge) => {
                        const days = getPendingAgeDays(edge.created_at);
                        const isSelected = selectedEdgeIds.has(edge.id);

                        return (
                          <tr
                            key={edge.id}
                            className={cn(
                              'hover:bg-hover transition-colors h-11',
                              isSelected && 'bg-selected/30'
                            )}
                          >
                            {/* Checkbox */}
                            <td className="py-2 px-3 w-8 text-center">
                              <input
                                type="checkbox"
                                aria-label={`Select approval for ${edge.source_ci.name}`}
                                checked={isSelected}
                                onChange={() => toggleSelectEdge(edge.id)}
                                className="rounded border-control text-accent focus:ring-accent cursor-pointer"
                              />
                            </td>

                            {/* Consumer */}
                            <td className="py-2 px-3">
                              <div
                                className="font-semibold text-xs text-primary truncate hover:text-accent cursor-pointer transition-colors max-w-56"
                                onClick={() => onNavigateToCatalog?.(edge.source_ci.ci_id)}
                                title={`Inspect ${edge.source_ci.name} in catalog`}
                              >
                                {edge.source_ci.name}
                              </div>
                              <div className="text-2xs font-mono text-muted uppercase mt-0.5">
                                {edge.source_ci.ci_class} • {edge.source_ci.environment}
                              </div>
                              <div className="text-2xs text-secondary truncate max-w-56 mt-0.5">
                                {edge.source_ci.owner_group_name} ({edge.source_ci.technical_contact || '—'})
                              </div>
                            </td>

                            {/* Relationship */}
                            <td className="py-2 px-3 text-center">
                              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-surface-sunken border border-subtle rounded text-2xs font-mono uppercase text-accent font-semibold">
                                <span>{edge.edge_type.replace(/_/g, ' ')}</span>
                                <ArrowRight className="w-3 h-3 text-muted shrink-0" />
                              </div>
                            </td>

                            {/* Provider */}
                            <td className="py-2 px-3">
                              <div
                                className="font-semibold text-xs text-primary truncate hover:text-accent cursor-pointer transition-colors max-w-56"
                                onClick={() => onNavigateToCatalog?.(edge.target_ci.ci_id)}
                                title={`Inspect ${edge.target_ci.name} in catalog`}
                              >
                                {edge.target_ci.name}
                              </div>
                              <div className="text-2xs font-mono text-muted uppercase mt-0.5">
                                {edge.target_ci.ci_class} • {edge.target_ci.environment}
                              </div>
                              <div className="text-2xs text-secondary truncate max-w-56 mt-0.5">
                                {edge.target_ci.owner_group_name} ({edge.target_ci.technical_contact || '—'})
                              </div>
                            </td>

                            {/* Age */}
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span
                                className={cn(
                                  'text-xs font-mono',
                                  days > 30
                                    ? 'text-tier0 font-medium'
                                    : days > 14
                                    ? 'text-tier1 font-medium'
                                    : 'text-secondary'
                                )}
                              >
                                {days === 0 ? '< 1d' : `${days}d`} pending
                              </span>
                            </td>

                            {/* Actions */}
                            <td className="py-2 px-3 text-right">
                              {activeRole !== 'viewer' ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => handleConfirm(edge)}
                                    isLoading={
                                      confirmMutation.isPending &&
                                      (confirmMutation.variables as any) === edge.id
                                    }
                                    className="h-7 text-xs gap-1 cursor-pointer"
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Confirm</span>
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setFlaggingEdge(edge)}
                                    className="h-7 text-xs text-secondary hover:text-primary cursor-pointer"
                                  >
                                    <span>Flag mismatch</span>
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setRejectingEdge(edge)}
                                    className="h-7 text-xs text-tier0 hover:bg-tier0-bg/30 cursor-pointer"
                                  >
                                    <span>Reject</span>
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-2xs text-muted font-mono">Read-Only</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Flag Mismatch Modal */}
      <Dialog
        open={!!flaggingEdge}
        onOpenChange={(open) => {
          if (!open) {
            setFlaggingEdge(null);
            setFlagReason('');
          }
        }}
      >
        <DialogContent variant="modal">
          {flaggingEdge && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2.5 text-deprecated">
                  <AlertTriangle className="w-5 h-5 shrink-0 stroke-[1.5]" />
                  <DialogTitle className="text-base font-semibold text-primary">
                    Flag Handshake Mismatch
                  </DialogTitle>
                </div>
                <DialogDescription className="text-xs text-secondary mt-1">
                  Explain why this dependency relationship is incorrect (e.g. wrong database environment or deprecated endpoint).
                </DialogDescription>
              </DialogHeader>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="handshake-flag-reason" className="block text-2xs font-mono uppercase text-muted">
                    Dispute Reason & Guidance
                  </label>
                  <span className="text-3xs font-mono text-muted">{flagReason.length}/512</span>
                </div>
                <textarea
                  id="handshake-flag-reason"
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value.slice(0, 512))}
                  rows={3}
                  maxLength={512}
                  placeholder="Provide context for the consumer team..."
                  className="w-full rounded-md border border-control bg-surface p-2.5 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent font-sans"
                />
              </div>

              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setFlaggingEdge(null)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleFlagMismatch}
                  isLoading={flagMismatchMutation.isPending}
                  disabled={!flagReason.trim()}
                >
                  Submit Dispute
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Handshake Confirmation Dialog */}
      <Dialog
        open={!!rejectingEdge}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingEdge(null);
            setRejectReason('');
          }
        }}
      >
        <DialogContent variant="modal">
          {rejectingEdge && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2.5 text-tier0">
                  <XCircle className="w-5 h-5 shrink-0 stroke-[1.5]" />
                  <DialogTitle className="text-base font-semibold text-primary">
                    Reject Dependency Handshake
                  </DialogTitle>
                </div>
                <DialogDescription className="text-xs text-secondary mt-1">
                  Are you sure you want to reject the incoming dependency connection from{' '}
                  <span className="font-mono font-semibold text-primary">{rejectingEdge.source_ci.name}</span> to{' '}
                  <span className="font-mono font-semibold text-primary">{rejectingEdge.target_ci.name}</span>?
                  This action cannot be undone.
                </DialogDescription>
              </DialogHeader>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="handshake-reject-reason" className="block text-2xs font-mono uppercase text-muted">
                    Rejection Reason
                  </label>
                  <span className="text-3xs font-mono text-muted">{rejectReason.length}/512</span>
                </div>
                <textarea
                  id="handshake-reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value.slice(0, 512))}
                  rows={2}
                  maxLength={512}
                  placeholder="Provide context for why this dependency was rejected..."
                  className="w-full rounded-md border border-control bg-surface p-2.5 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-tier0 font-sans"
                />
              </div>

              <DialogFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRejectingEdge(null);
                    setRejectReason('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleConfirmReject}
                  isLoading={rejectMutation.isPending}
                >
                  Confirm Rejection
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
