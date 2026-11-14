import { useState } from 'react';
import {
  CheckCircle,
  Clock,
  Flag,
  Trash2,
  Calendar,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { useOwnerDigest, useVerifyCI, useRetireCI } from '../../api/endpoints';
import { CriticalityChip } from '../../components/governance/criticality-chip';
import { RFC9457Alert } from '../../components/governance/rfc9457-alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { formatDateTime } from '../../lib/utils';
import { ApiProblemError } from '../../api/client';
import { useAuth } from '../../store/auth-context';

interface DigestViewProps {
  onNavigateToCatalog?: () => void;
}

export function DigestView({ onNavigateToCatalog: _ }: DigestViewProps) {
  const { activeRole, activeOwnerGroup } = useAuth();
  const { data: digest, isLoading, refetch } = useOwnerDigest();
  const verifyMutation = useVerifyCI();
  const retireMutation = useRetireCI();

  const [activeProblem, setActiveProblem] = useState<ApiProblemError['problem'] | null>(null);
  const [retiringItem, setRetiringItem] = useState<{ id: string; name: string } | null>(null);

  const items = digest?.items || [];
  const openItems = items.filter((i) => i.status === 'open');
  const actionedItems = items.filter((i) => i.status === 'actioned');

  const handleVerify = async (ciId: string) => {
    setActiveProblem(null);
    try {
      await verifyMutation.mutateAsync(ciId);
      refetch();
    } catch (err) {
      if (err instanceof ApiProblemError) setActiveProblem(err.problem);
    }
  };

  const handleRetire = async () => {
    if (!retiringItem) return;
    setActiveProblem(null);
    try {
      await retireMutation.mutateAsync({ id: retiringItem.id, force: false });
      setRetiringItem(null);
      refetch();
    } catch (err) {
      if (err instanceof ApiProblemError) setActiveProblem(err.problem);
    }
  };

  const getReasonBadge = (reason: string) => {
    switch (reason) {
      case 'open_flag':
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-mono uppercase bg-red-950/60 text-red-400 border border-red-800/60 px-2 py-0.5 rounded font-semibold">
            <Flag className="w-3 h-3" /> Priority 1: Open Flag
          </span>
        );
      case 'pending_edge':
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-mono uppercase bg-indigo-950/60 text-indigo-400 border border-indigo-800/60 px-2 py-0.5 rounded font-semibold">
            <Layers className="w-3 h-3" /> Priority 2: Pending Handshake
          </span>
        );
      case 'stale_verification':
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-mono uppercase bg-amber-950/60 text-amber-400 border border-amber-800/60 px-2 py-0.5 rounded font-semibold">
            <Clock className="w-3 h-3" /> Priority 3: Stale (&gt;60d)
          </span>
        );
      case 'recent_change':
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-mono uppercase bg-blue-950/60 text-blue-400 border border-blue-800/60 px-2 py-0.5 rounded font-semibold">
            Priority 4: Recent Change
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-mono uppercase bg-obsidian-800 text-obsidian-400 border border-obsidian-700 px-2 py-0.5 rounded font-semibold">
            {reason}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-7xl w-full mx-auto animate-in fade-in-50 duration-150">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-obsidian-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            Owner Verification Queue
            <span className="text-2xs font-mono uppercase bg-blue-950 text-blue-400 border border-blue-800 px-2 py-0.5 rounded">
              {activeOwnerGroup?.name || 'My Owner Group'}
            </span>
          </h1>
          <p className="text-xs text-obsidian-400 mt-1">
            Bi-weekly calendar review (1st & 15th UTC). Verify operational integrity to prevent configuration decay.
          </p>
        </div>

        {digest && (
          <div className="flex items-center gap-2 text-2xs font-mono text-obsidian-300 bg-obsidian-950/80 px-3 py-1.5 rounded border border-obsidian-800">
            <Calendar className="w-3.5 h-3.5 text-blue-400" />
            <span>
              Window: {formatDateTime(digest.window_start)} &rarr; {formatDateTime(digest.window_end)}
            </span>
          </div>
        )}
      </div>

      {/* RFC 9457 Error Alert */}
      {activeProblem && (
        <RFC9457Alert problem={activeProblem} onDismiss={() => setActiveProblem(null)} />
      )}

      {/* Action Progress Bar */}
      <div className="bg-obsidian-850/80 border border-obsidian-750 p-4 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-white">
            Review Items Completed: {actionedItems.length} of {items.length}
          </div>
          <p className="text-xs text-obsidian-400 mt-0.5">
            {openItems.length === 0
              ? 'All review items in this 14-day cycle are verified and up to date!'
              : `${openItems.length} items require team lead verification or safe retirement.`}
          </p>
        </div>

        <div className="w-full sm:w-64 bg-obsidian-950 rounded-full h-3 border border-obsidian-750 overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-600 to-emerald-500 h-full transition-all duration-300"
            style={{ width: `${items.length > 0 ? (actionedItems.length / items.length) * 100 : 100}%` }}
          />
        </div>
      </div>

      {/* Items List */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-obsidian-400 uppercase tracking-wider font-mono">
          Pending Review Items ({openItems.length})
        </h2>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-obsidian-400 bg-obsidian-850/40 border border-obsidian-750 rounded-lg">
            Loading review queue...
          </div>
        ) : openItems.length === 0 ? (
          <div className="p-10 text-center bg-obsidian-850/40 border border-obsidian-750 rounded-lg space-y-2">
            <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
            <h3 className="text-sm font-bold text-white">Queue is Clear!</h3>
            <p className="text-xs text-obsidian-400 max-w-md mx-auto">
              Your owner group has zero open flags, zero pending handshakes, and all configuration items have been verified within the last 60 days.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {openItems.map((item) => (
              <Card
                key={item.id}
                className="hover:border-obsidian-600 transition-colors bg-obsidian-850/80"
              >
                <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {getReasonBadge(item.trigger_reason)}
                      <span className="text-3xs font-mono uppercase bg-obsidian-800 text-obsidian-400 px-1.5 py-0.5 rounded border border-obsidian-700">
                        {item.ci_class}
                      </span>
                      <CriticalityChip tier={item.criticality_tier} />
                    </div>

                    <div className="font-semibold text-sm text-white">{item.name}</div>

                    <div className="text-xs text-obsidian-300 flex items-center gap-4">
                      <span>
                        Environment: <span className="font-mono uppercase text-obsidian-200">{item.environment}</span>
                      </span>
                      <span>
                        Trigger: <span className="text-obsidian-200">{item.trigger_reason}</span>
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {activeRole !== 'viewer' ? (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleVerify(item.ci_id)}
                          isLoading={verifyMutation.isPending}
                        >
                          <CheckCircle className="w-3.5 h-3.5 mr-1 text-emerald-300" />
                          Verify Status
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-400 hover:text-red-300 hover:bg-red-950/40"
                          onClick={() => setRetiringItem({ id: item.ci_id, name: item.name })}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          Retire CI
                        </Button>
                      </>
                    ) : (
                      <span className="text-2xs text-obsidian-500 font-mono">Read-Only Viewer</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Safe Retire Modal */}
      {retiringItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in-0 duration-150">
          <div className="w-full max-w-md bg-obsidian-900 border border-red-800/80 rounded-xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <div>
                <h3 className="text-base font-bold text-white">Retire {retiringItem.name}</h3>
                <p className="text-xs text-obsidian-400">Pre-flight active dependency check</p>
              </div>
            </div>
            <p className="text-xs text-obsidian-300 leading-relaxed bg-obsidian-950 p-3 rounded border border-obsidian-800">
              If other active applications depend on this CI, retirement will be prevented with an RFC 9457 Conflict response.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setRetiringItem(null)}>
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
    </div>
  );
}
