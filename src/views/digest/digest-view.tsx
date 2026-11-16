import { useState, useEffect } from 'react';
import {
  CheckCircle,
  Clock,
  Flag,
  Trash2,
  Calendar,
  AlertTriangle,
  Layers,
  ExternalLink,
  Building2,
} from 'lucide-react';
import { useOwnerDigest, useVerifyCI, useRetireCI } from '../../api/endpoints';
import { CriticalityChip } from '../../components/governance/criticality-chip';
import { RFC9457Alert } from '../../components/governance/rfc9457-alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { formatDateTime } from '../../lib/utils';
import { ApiProblemError } from '../../api/client';
import { useAuth } from '../../store/auth-context';
import { useToast } from '../../components/ui/toast';

interface DigestViewProps {
  onNavigateToCatalog?: (ciId?: string) => void;
}

export function DigestView({ onNavigateToCatalog }: DigestViewProps) {
  const { activeRole, isAdmin, activeOwnerGroup, ownerGroups } = useAuth();
  const toast = useToast();
  const [selectedGroupId, setSelectedGroupId] = useState<string>(activeOwnerGroup?.id || '');

  // Keep in sync with activeOwnerGroup if it changes
  useEffect(() => {
    if (activeOwnerGroup?.id && !selectedGroupId) {
      setSelectedGroupId(activeOwnerGroup.id);
    }
  }, [activeOwnerGroup?.id, selectedGroupId]);

  const effectiveGroupId = selectedGroupId || activeOwnerGroup?.id;
  const currentGroup = ownerGroups.find((g) => g.id === effectiveGroupId) || activeOwnerGroup;

  const { data: digest, isLoading, isError, error, refetch } = useOwnerDigest(effectiveGroupId || undefined);
  const verifyMutation = useVerifyCI();
  const retireMutation = useRetireCI();

  const [activeProblem, setActiveProblem] = useState<ApiProblemError['problem'] | null>(null);
  const [retiringItem, setRetiringItem] = useState<{ id: string; name: string } | null>(null);
  const [retireProblem, setRetireProblem] = useState<ApiProblemError['problem'] | null>(null);
  const [isVerifyingAll, setIsVerifyingAll] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const items = digest?.items || [];
  const openItems = items.filter((i) => i.status === 'open');
  const actionedItems = items.filter((i) => i.status === 'actioned');

  const handleVerify = async (ciId: string, name?: string) => {
    setActiveProblem(null);
    setVerifyingId(ciId);
    try {
      await verifyMutation.mutateAsync(ciId);
      toast.success(`CI ${name || ciId} verified successfully`);
      refetch();
    } catch (err: any) {
      if (err instanceof ApiProblemError) {
        setActiveProblem(err.problem);
        toast.error(err.problem.detail || 'Verification failed');
      } else {
        toast.error(err.message || 'Verification failed');
      }
    } finally {
      setVerifyingId(null);
    }
  };

  const handleVerifyAll = async () => {
    if (openItems.length === 0) return;
    setIsVerifyingAll(true);
    setActiveProblem(null);
    try {
      const results = await Promise.allSettled(
        openItems.map((item) => verifyMutation.mutateAsync(item.ci_id))
      );
      let succeeded = 0;
      let failed = 0;
      let lastErrorProblem: ApiProblemError['problem'] | null = null;

      results.forEach((r) => {
        if (r.status === 'fulfilled') {
          succeeded++;
        } else {
          failed++;
          if (r.reason instanceof ApiProblemError) {
            lastErrorProblem = r.reason.problem;
          }
        }
      });

      if (lastErrorProblem) {
        setActiveProblem(lastErrorProblem);
      }

      if (failed === 0) {
        toast.success(`Successfully verified all ${succeeded} items`);
      } else if (succeeded > 0) {
        toast.warning(`Verified ${succeeded} items; ${failed} failed`);
      } else {
        toast.error(`Bulk verification failed for all ${failed} items`);
      }
      refetch();
    } catch (err: any) {
      if (err instanceof ApiProblemError) {
        setActiveProblem(err.problem);
        toast.error(err.problem.detail || 'Bulk verification failed');
      } else {
        toast.error(err.message || 'Bulk verification failed');
      }
    } finally {
      setIsVerifyingAll(false);
    }
  };

  const handleRetire = async (force: boolean = false) => {
    if (!retiringItem) return;
    setRetireProblem(null);
    try {
      await retireMutation.mutateAsync({ id: retiringItem.id, force });
      toast.info(`CI ${retiringItem.name} retired${force ? ' (forced override)' : ''}`);
      setRetiringItem(null);
      setRetireProblem(null);
      refetch();
    } catch (err: any) {
      if (err instanceof ApiProblemError) {
        setRetireProblem(err.problem);
      } else {
        toast.error(err.message || 'Retirement failed');
      }
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
          <span className="inline-flex items-center gap-1 text-2xs font-mono uppercase bg-tier2-bg text-tier2 border border-tier2-border px-2 py-0.5 rounded-sm font-semibold">
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
    <div className="space-y-6 w-full animate-in fade-in-50 duration-150">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-primary">
              Owner Verification Queue
            </h1>
            {isAdmin && ownerGroups.length > 0 ? (
              <select
                value={effectiveGroupId || ''}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="text-xs bg-surface border border-subtle rounded px-2 py-1 text-primary focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                title="Select owner group queue to view and attest"
              >
                <option value="">Select an Owner Group...</option>
                {ownerGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-2xs font-mono uppercase bg-tier2-bg text-tier2 border border-tier2-border px-2 py-0.5 rounded-sm">
                {currentGroup?.name || 'My Owner Group'}
              </span>
            )}
          </div>
          <p className="text-xs text-secondary mt-1">
            Bi-weekly calendar review (1st & 15th UTC). Verify operational integrity to prevent configuration decay.
          </p>
        </div>

        {digest && (
          <div className="flex items-center gap-2 text-2xs font-mono text-secondary bg-surface-sunken px-3 py-1.5 rounded-sm border border-subtle">
            <Calendar className="w-3.5 h-3.5 text-accent stroke-[1.5]" />
            <span>
              Window: {digest.window_start ? formatDateTime(digest.window_start) : 'Current Cycle'} &rarr;{' '}
              {digest.window_end ? formatDateTime(digest.window_end) : 'Bi-Weekly Review'}
            </span>
          </div>
        )}
      </div>

      {/* RFC 9457 Error Alert */}
      {activeProblem && (
        <RFC9457Alert
          problem={activeProblem}
          onDismiss={() => setActiveProblem(null)}
          onNavigateToCI={onNavigateToCatalog}
        />
      )}

      {/* Action Progress Bar */}
      <div className="bg-surface border border-hairline p-4 rounded-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-primary">
            Review Items Completed: {actionedItems.length} of {items.length}
          </div>
          <p className="text-xs text-secondary mt-0.5">
            {items.length === 0
              ? 'Zero review items pending in this 14-day attestation cycle.'
              : openItems.length === 0
              ? 'All review items in this 14-day cycle are verified and up to date!'
              : `${openItems.length} items require team lead verification or safe retirement.`}
          </p>
        </div>

        <div className="w-full sm:w-64 bg-surface-sunken rounded-full h-2.5 border border-subtle overflow-hidden">
          <div
            className="bg-accent h-full transition-all duration-300"
            style={{ width: `${items.length > 0 ? (actionedItems.length / items.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Items List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wider font-mono">
            Pending Review Items ({openItems.length})
          </h2>
          {activeRole !== 'viewer' && openItems.length > 1 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleVerifyAll}
              isLoading={isVerifyingAll}
            >
              <CheckCircle className="w-3.5 h-3.5 mr-1 text-inservice stroke-[1.5]" />
              Verify All ({openItems.length})
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-muted bg-surface border border-subtle rounded-md">
            Loading review queue...
          </div>
        ) : isError ? (
          <div className="p-8 text-center bg-surface border border-tier0-border rounded-md space-y-3">
            <AlertTriangle className="w-8 h-8 text-tier0 mx-auto stroke-[1.5]" />
            <h3 className="text-sm font-semibold text-primary">Failed to load verification queue</h3>
            <p className="text-xs text-secondary max-w-md mx-auto">
              {(error as any)?.message || 'An error occurred while communicating with the verification service.'}
            </p>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Retry Queue
            </Button>
          </div>
        ) : !effectiveGroupId ? (
          <div className="p-10 text-center bg-surface border border-subtle rounded-md space-y-2">
            <Building2 className="w-8 h-8 text-accent mx-auto stroke-[1.5]" />
            <h3 className="text-sm font-semibold text-primary">No Owner Group Selected</h3>
            <p className="text-xs text-secondary max-w-md mx-auto">
              Signed in as Platform Administrator (Global Scope). Please select an owner group from the dropdown in the header above to inspect its review queue.
            </p>
          </div>
        ) : openItems.length === 0 ? (
          <div className="p-10 text-center bg-surface border border-subtle rounded-md space-y-2">
            <CheckCircle className="w-8 h-8 text-inservice mx-auto stroke-[1.5]" />
            <h3 className="text-sm font-semibold text-primary">Queue is Clear for {currentGroup?.name || 'this Group'}</h3>
            <p className="text-xs text-secondary max-w-md mx-auto">
              {currentGroup?.name || 'This owner group'} has zero open flags, zero pending handshakes, and all configuration items have been verified within the last 60 days.
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

                    <button
                      type="button"
                      className="font-semibold text-sm text-primary hover:text-accent cursor-pointer transition-colors text-left inline-block focus:outline-none focus-visible:underline"
                      onClick={() => onNavigateToCatalog?.(item.ci_id)}
                      title="Inspect CI in Catalog"
                      aria-label={`Inspect ${item.name} in Catalog`}
                    >
                      {item.name}
                    </button>

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
                    {onNavigateToCatalog && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onNavigateToCatalog(item.ci_id)}
                        className="text-xs text-secondary hover:text-primary"
                        title="View details in CI Catalog"
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-1 stroke-[1.5]" />
                        Inspect
                      </Button>
                    )}

                    {activeRole !== 'viewer' ? (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleVerify(item.ci_id, item.name)}
                          isLoading={verifyingId === item.ci_id}
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
      <Dialog
        open={!!retiringItem}
        onOpenChange={(open) => {
          if (!open) {
            setRetiringItem(null);
            setRetireProblem(null);
          }
        }}
      >
        <DialogContent variant="modal" className="border-tier0-border">
          {retiringItem && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 text-tier0">
                  <AlertTriangle className="w-6 h-6 shrink-0 stroke-[1.5]" />
                  <div>
                    <DialogTitle className="text-base font-semibold text-primary">
                      Retire {retiringItem.name}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-secondary mt-1">
                      Pre-flight active dependency check
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              {/* In-Modal Error Alert with Dependent CIs */}
              {retireProblem && (
                <RFC9457Alert
                  problem={retireProblem}
                  onDismiss={() => setRetireProblem(null)}
                  onNavigateToCI={onNavigateToCatalog}
                />
              )}

              <p className="text-xs text-secondary leading-relaxed bg-surface-sunken p-3 rounded-md border border-subtle">
                If other active applications depend on this CI, retirement will be prevented with an RFC 9457 Conflict response listing blocking dependencies.
              </p>

              <DialogFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRetiringItem(null);
                    setRetireProblem(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRetire(false)}
                  isLoading={retireMutation.isPending}
                >
                  Confirm Retirement
                </Button>
                {retireProblem?.status === 409 && activeRole === 'platform_admin' && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRetire(true)}
                    isLoading={retireMutation.isPending}
                    className="border border-tier0-border bg-tier0 text-white hover:bg-tier0/90"
                    title="Force retirement bypassing dependent check (restricted to platform_admin)"
                  >
                    Force Retire (Admin Override)
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
