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
          <span className="inline-flex items-center gap-1 text-2xs font-mono uppercase bg-tier0-bg text-tier0 border border-tier0-border px-2 py-0.5 rounded-sm font-semibold">
            <Flag className="w-3 h-3 stroke-[1.5]" /> Priority 1: Open Flag
          </span>
        );
      case 'pending_edge':
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-mono uppercase bg-tier2-bg text-accent border border-tier2-border px-2 py-0.5 rounded-sm font-semibold">
            <Layers className="w-3 h-3 stroke-[1.5]" /> Priority 2: Pending Handshake
          </span>
        );
      case 'stale_verification':
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-mono uppercase bg-tier1-bg text-tier1 border border-tier1-border px-2 py-0.5 rounded-sm font-semibold">
            <Clock className="w-3 h-3 stroke-[1.5]" /> Priority 3: Stale (&gt;60d)
          </span>
        );
      case 'recent_change':
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-mono uppercase bg-surface-sunken text-secondary border border-subtle px-2 py-0.5 rounded-sm font-semibold">
            Priority 4: Recent Change
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-mono uppercase bg-surface-sunken text-muted border border-subtle px-2 py-0.5 rounded-sm font-semibold">
            {reason}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-7xl w-full mx-auto animate-in fade-in-50 duration-150">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-primary flex items-center gap-2">
            Owner Verification Queue
            <span className="text-2xs font-mono uppercase bg-tier2-bg text-accent border border-tier2-border px-2 py-0.5 rounded-sm">
              {activeOwnerGroup?.name || 'My Owner Group'}
            </span>
          </h1>
          <p className="text-xs text-secondary mt-1">
            Bi-weekly calendar review (1st & 15th UTC). Verify operational integrity to prevent configuration decay.
          </p>
        </div>

        {digest && (
          <div className="flex items-center gap-2 text-2xs font-mono text-secondary bg-surface-sunken px-3 py-1.5 rounded-sm border border-subtle">
            <Calendar className="w-3.5 h-3.5 text-accent stroke-[1.5]" />
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
      <div className="bg-surface border border-hairline p-4 rounded-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-primary">
            Review Items Completed: {actionedItems.length} of {items.length}
          </div>
          <p className="text-xs text-secondary mt-0.5">
            {openItems.length === 0
              ? 'All review items in this 14-day cycle are verified and up to date!'
              : `${openItems.length} items require team lead verification or safe retirement.`}
          </p>
        </div>

        <div className="w-full sm:w-64 bg-surface-sunken rounded-full h-2.5 border border-subtle overflow-hidden">
          <div
            className="bg-accent h-full transition-all duration-300"
            style={{ width: `${items.length > 0 ? (actionedItems.length / items.length) * 100 : 100}%` }}
          />
        </div>
      </div>

      {/* Items List */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-muted uppercase tracking-wider font-mono">
          Pending Review Items ({openItems.length})
        </h2>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-muted bg-surface border border-subtle rounded-md">
            Loading review queue...
          </div>
        ) : openItems.length === 0 ? (
          <div className="p-10 text-center bg-surface border border-subtle rounded-md space-y-2">
            <CheckCircle className="w-8 h-8 text-inservice mx-auto stroke-[1.5]" />
            <h3 className="text-sm font-semibold text-primary">Queue is Clear!</h3>
            <p className="text-xs text-secondary max-w-md mx-auto">
              Your owner group has zero open flags, zero pending handshakes, and all configuration items have been verified within the last 60 days.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {openItems.map((item) => (
              <Card
                key={item.id}
                className="hover:border-control transition-colors"
              >
                <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {getReasonBadge(item.trigger_reason)}
                      <span className="text-3xs font-mono uppercase bg-surface-sunken text-secondary px-1.5 py-0.5 rounded-sm border border-subtle">
                        {item.ci_class}
                      </span>
                      <CriticalityChip tier={item.criticality_tier} />
                    </div>

                    <div className="font-semibold text-sm text-primary">{item.name}</div>

                    <div className="text-xs text-secondary flex items-center gap-4">
                      <span>
                        Environment: <span className="font-mono uppercase text-primary">{item.environment}</span>
                      </span>
                      <span>
                        Trigger: <span className="text-primary">{item.trigger_reason}</span>
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
                          <CheckCircle className="w-3.5 h-3.5 mr-1 stroke-[1.5]" />
                          Verify Status
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-tier0 hover:bg-tier0-bg"
                          onClick={() => setRetiringItem({ id: item.ci_id, name: item.name })}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1 stroke-[1.5]" />
                          Retire CI
                        </Button>
                      </>
                    ) : (
                      <span className="text-2xs text-muted font-mono">Read-Only Viewer</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(17,24,39,0.40)] p-4 animate-in fade-in-0 duration-150">
          <div className="w-full max-w-md bg-surface border border-tier0-border rounded-lg p-5 space-y-4 shadow-[0_4px_12px_rgba(16,24,40,0.10)]">
            <div className="flex items-center gap-3 text-tier0">
              <AlertTriangle className="w-6 h-6 shrink-0 stroke-[1.5]" />
              <div>
                <h3 className="text-base font-semibold text-primary">Retire {retiringItem.name}</h3>
                <p className="text-xs text-secondary">Pre-flight active dependency check</p>
              </div>
            </div>
            <p className="text-xs text-secondary leading-relaxed bg-surface-sunken p-3 rounded-md border border-subtle">
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
