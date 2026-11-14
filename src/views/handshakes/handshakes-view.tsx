import { useState } from 'react';
import {
  Inbox,
  CheckCircle2,
  AlertOctagon,
  XCircle,
  ArrowRight,
  Layers,
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
import { HandshakeBadge } from '../../components/governance/handshake-badge';
import { RFC9457Alert } from '../../components/governance/rfc9457-alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { ApiProblemError } from '../../api/client';
import { useAuth } from '../../store/auth-context';

export function HandshakesView() {
  const { activeRole } = useAuth();
  const { data: pendingEdges, isLoading, refetch } = usePendingEdges();

  const confirmMutation = useConfirmEdge();
  const flagMismatchMutation = useFlagMismatchEdge();
  const rejectMutation = useRejectEdge();

  const [activeProblem, setActiveProblem] = useState<ApiProblemError['problem'] | null>(null);
  const [flaggingEdge, setFlaggingEdge] = useState<PendingEdge | null>(null);
  const [flagReason, setFlagReason] = useState('');

  const edges: PendingEdge[] = pendingEdges || [];

  const handleConfirm = async (edgeId: string) => {
    setActiveProblem(null);
    try {
      await confirmMutation.mutateAsync(edgeId);
      refetch();
    } catch (err) {
      if (err instanceof ApiProblemError) setActiveProblem(err.problem);
    }
  };

  const handleFlagMismatch = async () => {
    if (!flaggingEdge || !flagReason.trim()) return;
    setActiveProblem(null);
    try {
      await flagMismatchMutation.mutateAsync({ edgeId: flaggingEdge.id, reason: flagReason });
      setFlaggingEdge(null);
      setFlagReason('');
      refetch();
    } catch (err) {
      if (err instanceof ApiProblemError) setActiveProblem(err.problem);
    }
  };

  const handleReject = async (edgeId: string) => {
    setActiveProblem(null);
    try {
      await rejectMutation.mutateAsync(edgeId);
      refetch();
    } catch (err) {
      if (err instanceof ApiProblemError) setActiveProblem(err.problem);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl w-full mx-auto animate-in fade-in-50 duration-150">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-primary flex items-center gap-2">
            Cross-Boundary Handshake Inbox
            <span className="text-2xs font-mono uppercase bg-tier2-bg text-accent border border-tier2-border px-2 py-0.5 rounded-sm">
              {edges.length} Pending
            </span>
          </h1>
          <p className="text-xs text-secondary mt-1">
            Incoming dependencies created during decentralized service intake campaigns. Confirm or dispute relationships.
          </p>
        </div>
      </div>

      {/* RFC 9457 Error Alert */}
      {activeProblem && (
        <RFC9457Alert problem={activeProblem} onDismiss={() => setActiveProblem(null)} />
      )}

      {/* Handshakes List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-muted bg-surface border border-subtle rounded-md">
            Loading pending handshakes...
          </div>
        ) : edges.length === 0 ? (
          <div className="p-12 text-center bg-surface border border-subtle rounded-md space-y-2">
            <Inbox className="w-10 h-10 text-muted mx-auto stroke-[1.5]" />
            <h3 className="text-sm font-semibold text-primary">No Pending Cross-Boundary Handshakes</h3>
            <p className="text-xs text-secondary max-w-md mx-auto">
              When other teams register services that declare dependencies on your infrastructure (e.g. database, host, cluster), they will appear here for review.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {edges.map((edge) => (
              <Card key={edge.id} className="hover:border-control transition-colors">
                <CardContent className="p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                  {/* Visual Edge Connection */}
                  <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    {/* Dependent (Consumer) */}
                    <div className="p-3 bg-surface-sunken border border-subtle rounded-md flex-1 min-w-48">
                      <div className="text-3xs font-mono uppercase text-muted flex items-center gap-1.5 mb-1">
                        <Layers className="w-3 h-3 text-accent stroke-[1.5]" />
                        Dependent (Consumer)
                      </div>
                      <div className="font-semibold text-xs text-primary truncate">
                        {edge.source_ci.name}
                      </div>
                      <div className="text-3xs font-mono text-secondary uppercase">
                        {edge.source_ci.ci_class} • {edge.source_ci.environment}
                      </div>
                    </div>

                    {/* Edge Type Arrow */}
                    <div className="flex flex-col items-center justify-center px-2 py-1 bg-surface-sunken rounded-md border border-subtle shrink-0">
                      <span className="text-3xs font-mono uppercase text-accent font-semibold mb-0.5">
                        {edge.edge_type.replace('_', ' ')}
                      </span>
                      <ArrowRight className="w-4 h-4 text-muted stroke-[1.5]" />
                      <HandshakeBadge status={edge.handshake_status} className="mt-1" />
                    </div>

                    {/* Dependency (Provider) */}
                    <div className="p-3 bg-surface-sunken border border-subtle rounded-md flex-1 min-w-48">
                      <div className="text-3xs font-mono uppercase text-muted flex items-center gap-1.5 mb-1">
                        <Database className="w-3 h-3 text-inservice stroke-[1.5]" />
                        Dependency (Provider)
                      </div>
                      <div className="font-semibold text-xs text-primary truncate">
                        {edge.target_ci.name}
                      </div>
                      <div className="text-3xs font-mono text-secondary uppercase">
                        {edge.target_ci.ci_class} • {edge.target_ci.environment}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 lg:pt-0">
                    {activeRole !== 'viewer' ? (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleConfirm(edge.id)}
                          isLoading={confirmMutation.isPending}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1 stroke-[1.5]" />
                          Confirm
                        </Button>

                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setFlaggingEdge(edge)}
                        >
                          <AlertOctagon className="w-3.5 h-3.5 mr-1 text-deprecated stroke-[1.5]" />
                          Flag Mismatch
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-tier0 hover:bg-tier0-bg"
                          onClick={() => handleReject(edge.id)}
                          isLoading={rejectMutation.isPending}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1 stroke-[1.5]" />
                          Reject
                        </Button>
                      </>
                    ) : (
                      <span className="text-2xs text-muted font-mono">Read-Only</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Flag Mismatch Modal */}
      {flaggingEdge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(17,24,39,0.40)] p-4 animate-in fade-in-0 duration-150">
          <div className="w-full max-w-md bg-surface border border-hairline rounded-lg p-5 space-y-4 shadow-[0_4px_12px_rgba(16,24,40,0.10)]">
            <div className="flex items-center gap-2.5 text-deprecated">
              <AlertTriangle className="w-5 h-5 shrink-0 stroke-[1.5]" />
              <h3 className="text-base font-semibold text-primary">Flag Handshake Mismatch</h3>
            </div>
            <p className="text-xs text-secondary">
              Explain why this dependency relationship is incorrect (e.g. wrong database environment or deprecated VIP).
            </p>
            <textarea
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              rows={3}
              placeholder="Provide context for the consumer team..."
              className="w-full rounded-md border border-control bg-surface p-2.5 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent font-sans"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
