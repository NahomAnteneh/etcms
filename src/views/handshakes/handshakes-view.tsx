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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-obsidian-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            Cross-Boundary Handshake Inbox
            <span className="text-2xs font-mono uppercase bg-blue-950 text-blue-400 border border-blue-800 px-2 py-0.5 rounded">
              {edges.length} Pending
            </span>
          </h1>
          <p className="text-xs text-obsidian-400 mt-1">
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
          <div className="p-8 text-center text-xs text-obsidian-400 bg-obsidian-850/40 border border-obsidian-750 rounded-lg">
            Loading pending handshakes...
          </div>
        ) : edges.length === 0 ? (
          <div className="p-12 text-center bg-obsidian-850/40 border border-obsidian-750 rounded-lg space-y-2">
            <Inbox className="w-10 h-10 text-obsidian-500 mx-auto" />
            <h3 className="text-sm font-bold text-white">No Pending Cross-Boundary Handshakes</h3>
            <p className="text-xs text-obsidian-400 max-w-md mx-auto">
              When other teams register services that declare dependencies on your infrastructure (e.g. database, host, cluster), they will appear here for review.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {edges.map((edge) => (
              <Card key={edge.id} className="bg-obsidian-850/80 hover:border-obsidian-600 transition-colors">
                <CardContent className="p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                  {/* Visual Edge Connection */}
                  <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    {/* Dependent (Consumer) */}
                    <div className="p-3 bg-obsidian-950/80 border border-obsidian-750 rounded-lg flex-1 min-w-48">
                      <div className="text-3xs font-mono uppercase text-obsidian-400 flex items-center gap-1.5 mb-1">
                        <Layers className="w-3 h-3 text-blue-400" />
                        Dependent (Consumer)
                      </div>
                      <div className="font-semibold text-xs text-white truncate">
                        {edge.source_ci.name}
                      </div>
                      <div className="text-3xs font-mono text-obsidian-400 uppercase">
                        {edge.source_ci.ci_class} • {edge.source_ci.environment}
                      </div>
                    </div>

                    {/* Edge Type Arrow */}
                    <div className="flex flex-col items-center justify-center px-2 py-1 bg-obsidian-900 rounded border border-obsidian-800 shrink-0">
                      <span className="text-3xs font-mono uppercase text-blue-400 font-semibold mb-0.5">
                        {edge.edge_type.replace('_', ' ')}
                      </span>
                      <ArrowRight className="w-4 h-4 text-obsidian-400" />
                      <HandshakeBadge status={edge.handshake_status} className="mt-1" />
                    </div>

                    {/* Dependency (Provider) */}
                    <div className="p-3 bg-obsidian-950/80 border border-obsidian-750 rounded-lg flex-1 min-w-48">
                      <div className="text-3xs font-mono uppercase text-obsidian-400 flex items-center gap-1.5 mb-1">
                        <Database className="w-3 h-3 text-emerald-400" />
                        Dependency (Provider)
                      </div>
                      <div className="font-semibold text-xs text-white truncate">
                        {edge.target_ci.name}
                      </div>
                      <div className="text-3xs font-mono text-obsidian-400 uppercase">
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
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-300" />
                          Confirm
                        </Button>

                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setFlaggingEdge(edge)}
                        >
                          <AlertOctagon className="w-3.5 h-3.5 mr-1 text-amber-400" />
                          Flag Mismatch
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-400 hover:text-red-300"
                          onClick={() => handleReject(edge.id)}
                          isLoading={rejectMutation.isPending}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" />
                          Reject
                        </Button>
                      </>
                    ) : (
                      <span className="text-2xs text-obsidian-500 font-mono">Read-Only</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in-0 duration-150">
          <div className="w-full max-w-md bg-obsidian-900 border border-amber-800/80 rounded-xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-amber-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-base font-bold text-white">Flag Handshake Mismatch</h3>
            </div>
            <p className="text-xs text-obsidian-300">
              Explain why this dependency relationship is incorrect (e.g. wrong database environment or deprecated VIP).
            </p>
            <textarea
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              rows={3}
              placeholder="Provide context for the consumer team..."
              className="w-full rounded border border-obsidian-700 bg-obsidian-950 p-2.5 text-xs text-white placeholder:text-obsidian-500 focus:outline-none focus:ring-1 focus:ring-amber-500 font-sans"
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
