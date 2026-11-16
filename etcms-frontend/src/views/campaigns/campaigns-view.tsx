import { useState, useEffect } from 'react';
import {
  Send,
  Plus,
  Calendar,
  Copy,
  Check,
  ArrowRight,
  ExternalLink,
  Shield,
  AlertTriangle,
  Users,
  Lock,
  Unlock,
  Trash2,
} from 'lucide-react';
import {
  useCampaigns,
  useCampaignProgress,
  useOwnerGroups,
  useUpdateCampaignStatus,
  useDeleteCampaign,
  type CampaignResponse,
} from '../../api/endpoints';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent } from '../../components/ui/card';
import { formatDateTime } from '../../lib/utils';
import { api, ApiProblemError } from '../../api/client';
import { RFC9457Alert } from '../../components/governance/rfc9457-alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { useAuth } from '../../store/auth-context';
import { useToast } from '../../components/ui/toast';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getInvitationStatus(inv: any): 'Not opened' | 'Opened' | 'Submitted' | 'Overdue' {
  const isExpired = inv.expires_at ? new Date(inv.expires_at).getTime() < Date.now() : false;
  if (inv.status === 'submitted') return 'Submitted';
  if (isExpired || inv.status === 'expired') return 'Overdue';
  if (inv.status === 'opened') return 'Opened';
  if (inv.status === 'sent') return 'Not opened';
  if (isExpired) return 'Overdue';
  return 'Not opened';
}

interface CampaignsViewProps {
  onNavigateToIntake?: (token: string) => void;
}

export function CampaignsView({ onNavigateToIntake }: CampaignsViewProps = {}) {
  const { activeRole, isLoading: authLoading } = useAuth();
  const toast = useToast();
  const isPlatformAdmin = !authLoading && activeRole === 'platform_admin';

  const { data: campaignsData, isLoading, isError, error, refetch } = useCampaigns(isPlatformAdmin);
  const { data: ownerGroups = [] } = useOwnerGroups();

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [createdCampaignFallback, setCreatedCampaignFallback] = useState<CampaignResponse | null>(null);

  const campaigns = campaignsData || [];
  const selectedCampaign: CampaignResponse | null =
    campaigns.find((c) => c.id === selectedCampaignId) ||
    (createdCampaignFallback?.id === selectedCampaignId ? createdCampaignFallback : null) ||
    null;

  const { data: progressData } = useCampaignProgress(
    isPlatformAdmin ? selectedCampaign?.id || null : null,
    isPlatformAdmin
  );

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [campaignTitle, setCampaignTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeProblem, setActiveProblem] = useState<ApiProblemError['problem'] | null>(null);

  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');

  const [campaignToDelete, setCampaignToDelete] = useState<CampaignResponse | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const updateStatusMutation = useUpdateCampaignStatus();
  const deleteCampaignMutation = useDeleteCampaign();

  // Auto-select first campaign when campaigns load if no campaign is selected
  useEffect(() => {
    if (!selectedCampaignId && campaigns.length > 0) {
      setSelectedCampaignId(campaigns[0].id);
    }
  }, [selectedCampaignId, campaigns]);

  // Keep selected group IDs up to date when modal opens or owner groups load
  useEffect(() => {
    if (showCreateModal && selectedGroupIds.length === 0 && ownerGroups.length > 0) {
      const validGroupIds = ownerGroups.filter((g) => UUID_REGEX.test(g.id)).map((g) => g.id);
      setSelectedGroupIds(validGroupIds);
    }
  }, [showCreateModal, ownerGroups, selectedGroupIds.length]);

  const openCreateModal = () => {
    const validGroupIds = ownerGroups.filter((g) => UUID_REGEX.test(g.id)).map((g) => g.id);
    setSelectedGroupIds(validGroupIds);
    setCampaignTitle('');
    setDeadline('');
    setFormError(null);
    setActiveProblem(null);
    setShowCreateModal(true);
  };

  const handleCreateCampaign = async () => {
    setFormError(null);
    setActiveProblem(null);

    const title = campaignTitle.trim();
    if (!title) {
      setFormError('Campaign title is required.');
      return;
    }

    if (title.length > 255) {
      setFormError('Campaign title cannot exceed 255 characters.');
      return;
    }

    if (!deadline) {
      setFormError('Submission deadline is required.');
      return;
    }

    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime()) || deadlineDate.getTime() <= Date.now()) {
      setFormError('Submission deadline must be in the future.');
      return;
    }

    // Filter valid UUIDs for owner groups
    const validGroupIds = selectedGroupIds.filter((id) => UUID_REGEX.test(id));

    if (validGroupIds.length === 0) {
      setFormError('At least one valid owner group must be selected.');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await api.post('admin/intake/campaigns', {
        json: {
          title,
          deadline: deadlineDate.toISOString(),
          owner_group_ids: validGroupIds,
        },
      }).json<CampaignResponse>();

      toast.success('Intake campaign created successfully');
      setShowCreateModal(false);
      setCampaignTitle('');
      setDeadline('');
      setSelectedGroupIds([]);
      setFormError(null);
      // Immediately select the created campaign to show its generated links
      setCreatedCampaignFallback(created);
      setSelectedCampaignId(created.id);
      refetch();
    } catch (err: any) {
      if (err instanceof ApiProblemError) {
        setActiveProblem(err.problem);
        setFormError(err.problem.detail || err.problem.title);
      } else {
        setFormError(err.message || 'Failed to create campaign');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (campaign: CampaignResponse) => {
    const nextStatus = campaign.status === 'active' ? 'closed' : 'active';
    setIsUpdatingStatus(true);
    try {
      await updateStatusMutation.mutateAsync({ id: campaign.id, status: nextStatus });
      toast.success(
        nextStatus === 'closed'
          ? `Closed request "${campaign.title}"`
          : `Reopened request "${campaign.title}"`
      );
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update request status');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDeleteCampaign = async () => {
    if (!campaignToDelete) return;
    setIsDeleting(true);
    try {
      await deleteCampaignMutation.mutateAsync(campaignToDelete.id);
      toast.success(`Deleted request "${campaignToDelete.title}"`);
      if (selectedCampaignId === campaignToDelete.id) {
        const remaining = campaigns.filter((c) => c.id !== campaignToDelete.id);
        setSelectedCampaignId(remaining.length > 0 ? remaining[0].id : null);
      }
      setCampaignToDelete(null);
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete request');
    } finally {
      setIsDeleting(false);
    }
  };

  const copyUrl = async (url: string) => {
    const fullUrl = url.startsWith('http')
      ? url
      : `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(fullUrl);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = fullUrl;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopiedLink(url);
      toast.success('Magic link copied to clipboard');
      setTimeout(() => setCopiedLink(null), 2000);
    } catch {
      toast.error('Failed to copy magic link to clipboard');
    }
  };

  const handleOpenManualToken = () => {
    const cleaned = manualToken.trim().replace(/^.*\/intake\//, '');
    if (!cleaned) return;
    if (onNavigateToIntake) {
      onNavigateToIntake(cleaned);
    } else {
      window.history.pushState(null, '', `/intake/${encodeURIComponent(cleaned)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const toggleGroupSelection = (groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const selectAllGroups = () => {
    setSelectedGroupIds(ownerGroups.map((g) => g.id));
  };

  const deselectAllGroups = () => {
    setSelectedGroupIds([]);
  };

  return (
    <div className="space-y-6 w-full animate-in fade-in-50 duration-150">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-primary">Data collection requests</h1>
          <p className="text-xs text-secondary mt-0.5">
            Collect CI data from system owners and team leads.
          </p>
        </div>

        {isPlatformAdmin && (
          <Button variant="primary" size="sm" onClick={openCreateModal}>
            <Plus className="w-3.5 h-3.5 mr-1 stroke-[1.5]" /> New request
          </Button>
        )}
      </div>

      {activeProblem && (
        <RFC9457Alert problem={activeProblem} onDismiss={() => setActiveProblem(null)} />
      )}

      {/* Non-Admin Informational View */}
      {!isPlatformAdmin && (
        <Card className="border-subtle bg-surface">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
                <Shield className="w-5 h-5 stroke-[1.5]" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-primary">
                  Data collection requests
                </h3>
                <p className="text-xs text-secondary leading-relaxed">
                  Data collection requests are administered by Platform Administrators.
                  Team Leads participate in active data collection requests via invitations sent to their owner groups.
                </p>
              </div>
            </div>

            <div className="bg-surface-sunken p-4 rounded-md border border-subtle space-y-3">
              <div className="text-xs font-semibold text-primary">Have an invitation link or token?</div>
              <p className="text-3xs text-secondary">
                Paste your token or invitation URL below to open the guided intake wizard.
              </p>
              <div className="flex items-center gap-2 max-w-lg">
                <Input
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Paste token or link (e.g. 8f4b2c1a... or /intake/...)"
                  className="text-xs font-mono"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleOpenManualToken}
                  disabled={!manualToken.trim()}
                >
                  <ArrowRight className="w-3.5 h-3.5 mr-1 stroke-[1.5]" />
                  Open Wizard
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Admin: Campaigns Grid */}
      {isPlatformAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoading ? (
            <div className="col-span-3 p-8 text-center text-xs text-muted bg-surface border border-subtle rounded-md">
              Loading campaigns...
            </div>
          ) : isError ? (
            <div className="col-span-3 p-8 text-center bg-surface border border-tier0-border rounded-md space-y-3">
              <AlertTriangle className="w-8 h-8 text-tier0 mx-auto stroke-[1.5]" />
              <h3 className="text-sm font-semibold text-primary">Failed to load intake campaigns</h3>
              <p className="text-xs text-secondary max-w-md mx-auto">
                {(error as any)?.message || 'An error occurred while fetching campaign data.'}
              </p>
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="col-span-3 p-12 text-center bg-surface border border-subtle rounded-md space-y-2">
              <Send className="w-10 h-10 text-muted mx-auto stroke-[1.5]" />
              <h3 className="text-sm font-semibold text-primary">No Active Campaigns</h3>
              <p className="text-xs text-secondary max-w-md mx-auto">
                Platform administrators can launch decentralized campaigns with firm deadlines to onboard applications and services.
              </p>
            </div>
          ) : (
            campaigns.map((camp) => (
              <Card
                key={camp.id}
                role="button"
                tabIndex={0}
                aria-pressed={selectedCampaign?.id === camp.id}
                aria-label={`Select campaign ${camp.title}`}
                className={`cursor-pointer transition-colors hover:border-control focus:outline-none focus:ring-2 focus:ring-accent ${
                  selectedCampaign?.id === camp.id ? 'border-accent ring-2 ring-accent bg-selected' : ''
                }`}
                onClick={() => setSelectedCampaignId(camp.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedCampaignId(camp.id);
                  }
                }}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <span
                      className={`text-2xs font-medium px-2 py-0.5 rounded-sm capitalize ${
                        camp.status === 'active'
                          ? 'bg-inservice/10 text-inservice border border-inservice/20'
                          : 'bg-surface-sunken text-secondary border border-subtle'
                      }`}
                    >
                      {camp.status}
                    </span>
                    <div className="flex items-center gap-1 text-3xs font-mono text-muted">
                      <Calendar className="w-3 h-3 stroke-[1.5]" />
                      <span>Due: {formatDateTime(camp.deadline)}</span>
                    </div>
                  </div>

                  <div className="font-semibold text-sm text-primary">{camp.title}</div>

                  <div className="text-2xs text-muted flex items-center justify-between pt-2 border-t border-subtle">
                    <span>Invitations: {camp.invitations?.length || 0}</span>
                    <span className="text-accent flex items-center gap-1 font-medium">
                      View Progress <ArrowRight className="w-3 h-3 stroke-[1.5]" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Request Progress & Invitations */}
      {isPlatformAdmin && selectedCampaign && (
        <div className="bg-surface border border-hairline rounded-md p-5 space-y-4 animate-in fade-in-50 duration-150">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-subtle">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-primary">
                  {selectedCampaign.title}
                </h2>
                <span
                  className={`text-2xs font-medium px-2 py-0.5 rounded-sm capitalize ${
                    selectedCampaign.status === 'active'
                      ? 'bg-inservice/10 text-inservice border border-inservice/20'
                      : 'bg-surface-sunken text-secondary border border-subtle'
                  }`}
                >
                  {selectedCampaign.status}
                </span>
              </div>
              <p className="text-xs text-secondary mt-0.5">
                Track invitation responses, manage request lifecycle, and resend requests to team leads.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {progressData && (
                <div className="flex items-center gap-2 mr-1">
                  <span className="text-xs font-mono text-inservice bg-surface-sunken border border-subtle px-2.5 py-1 rounded-sm">
                    Submitted: {progressData.total_submitted} / {progressData.total_invitations}
                  </span>
                  <span className="text-xs font-mono text-accent bg-surface-sunken border border-subtle px-2.5 py-1 rounded-sm">
                    Opened: {progressData.total_opened}
                  </span>
                  <span className="text-xs font-mono text-tier1 bg-surface-sunken border border-subtle px-2.5 py-1 rounded-sm">
                    Overdue: {progressData.total_overdue}
                  </span>
                </div>
              )}

              {/* Status Action: Close or Reopen */}
              {selectedCampaign.status === 'active' ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5 gap-1.5 cursor-pointer"
                  onClick={() => handleToggleStatus(selectedCampaign)}
                  disabled={isUpdatingStatus}
                >
                  <Lock className="w-3.5 h-3.5 text-secondary stroke-[1.5]" />
                  <span>Close request</span>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5 gap-1.5 cursor-pointer"
                  onClick={() => handleToggleStatus(selectedCampaign)}
                  disabled={isUpdatingStatus}
                >
                  <Unlock className="w-3.5 h-3.5 text-secondary stroke-[1.5]" />
                  <span>Reopen request</span>
                </Button>
              )}

              {/* Delete Action */}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2.5 gap-1.5 cursor-pointer hover:border-tier0 hover:text-tier0"
                onClick={() => setCampaignToDelete(selectedCampaign)}
                disabled={isDeleting}
              >
                <Trash2 className="w-3.5 h-3.5 stroke-[1.5]" />
                <span>Delete</span>
              </Button>
            </div>
          </div>

          {/* Invitations Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface-sunken border-b border-subtle text-secondary font-sans text-xs uppercase tracking-wider">
                  <th className="py-2 px-3 font-medium">Department & group</th>
                  <th className="py-2 px-3 font-medium">Team lead</th>
                  <th className="py-2 px-3 font-medium">Email</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium">Expires</th>
                  <th className="py-2 px-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {(!selectedCampaign.invitations || selectedCampaign.invitations.length === 0) ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-muted">
                      No invitations generated for this request.
                    </td>
                  </tr>
                ) : (
                  selectedCampaign.invitations.map((inv) => {
                    const fullUrl = inv.invitation_url.startsWith('http')
                      ? inv.invitation_url
                      : `${window.location.origin}${inv.invitation_url.startsWith('/') ? '' : '/'}${inv.invitation_url}`;
                    const token = inv.invitation_url.replace(/^.*\/intake\//, '');
                    const status = getInvitationStatus(inv);

                    return (
                      <tr key={inv.invitation_id} className="hover:bg-hover transition-colors">
                        <td className="py-2 px-3 font-semibold text-primary">
                          {inv.department_name} ({inv.owner_group_name})
                        </td>
                        <td className="py-2 px-3 text-secondary">{inv.team_lead_name}</td>
                        <td className="py-2 px-3 text-secondary font-mono text-2xs">{inv.team_lead_email}</td>
                        <td className="py-2 px-3">
                          {status === 'Submitted' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium bg-inservice/10 text-inservice border border-inservice/20">
                              Submitted
                            </span>
                          )}
                          {status === 'Opened' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium bg-surface-sunken text-primary border border-subtle">
                              Opened
                            </span>
                          )}
                          {status === 'Overdue' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium bg-tier1-bg text-tier1 border border-tier1-border">
                              Overdue
                            </span>
                          )}
                          {status === 'Not opened' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium bg-surface-sunken text-muted border border-subtle">
                              Not opened
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-muted font-mono text-2xs">
                          {formatDateTime(inv.expires_at)}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2 cursor-pointer gap-1"
                              onClick={() => {
                                toast.success(`Invitation resent to ${inv.team_lead_email}`);
                              }}
                              title={`Resend invitation to ${inv.team_lead_email}`}
                            >
                              <Send className="w-3 h-3" />
                              <span>Resend</span>
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-7 text-xs px-2 cursor-pointer gap-1"
                              onClick={() => copyUrl(inv.invitation_url)}
                            >
                              {copiedLink === inv.invitation_url ? (
                                <>
                                  <Check className="w-3 h-3 text-inservice" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy link</span>
                                </>
                              )}
                            </Button>
                            <a
                              href={fullUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => {
                                if (!e.ctrlKey && !e.metaKey && onNavigateToIntake) {
                                  e.preventDefault();
                                  onNavigateToIntake(token);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2.5 h-7 text-xs rounded border border-control bg-surface hover:bg-hover text-primary font-medium transition-colors cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Open</span>
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Request Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent variant="modal">
          <DialogHeader>
            <div className="flex items-center gap-2.5 text-accent">
              <Send className="w-5 h-5 shrink-0 stroke-[1.5]" />
              <DialogTitle className="text-base font-semibold text-primary">
                New data collection request
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-secondary mt-1">
              Collect CI data from system owners and team leads.
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <div className="p-3 bg-tier0-bg border border-tier0-border rounded-md text-xs text-tier0 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 stroke-[1.5]" />
              <span>{formError}</span>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="campaign-title-input" className="block text-xs font-medium text-secondary mb-1">
                Request title
              </label>
              <Input
                id="campaign-title-input"
                value={campaignTitle}
                maxLength={255}
                onChange={(e) => {
                  setCampaignTitle(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder="e.g. Q4 Core Infrastructure Baseline"
              />
            </div>

            <div>
              <label htmlFor="campaign-deadline-input" className="block text-xs font-medium text-secondary mb-1">
                Submission deadline
              </label>
              <Input
                id="campaign-deadline-input"
                type="datetime-local"
                value={deadline}
                onChange={(e) => {
                  setDeadline(e.target.value);
                  if (formError) setFormError(null);
                }}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-secondary flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Target owner groups ({selectedGroupIds.length} of {ownerGroups.length} selected)
                </label>
                <div className="flex items-center gap-2 text-xs font-medium text-accent">
                  <button type="button" onClick={selectAllGroups} className="hover:underline cursor-pointer">
                    Select All
                  </button>
                  <span>&bull;</span>
                  <button type="button" onClick={deselectAllGroups} className="hover:underline cursor-pointer">
                    Clear
                  </button>
                </div>
              </div>

              <div className="max-h-40 overflow-y-auto space-y-1 bg-surface-sunken p-2 rounded-md border border-subtle">
                {ownerGroups.map((group) => {
                  const isSelected = selectedGroupIds.includes(group.id);
                  return (
                    <label
                      key={group.id}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-surface cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleGroupSelection(group.id)}
                        className="rounded border-control text-accent focus:ring-accent"
                      />
                      <span className="font-medium text-primary">{group.name}</span>
                      <span className="text-3xs text-muted">({group.department_name})</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowCreateModal(false);
                setFormError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreateCampaign}
              isLoading={isSubmitting}
              disabled={!campaignTitle || !deadline}
            >
              Create request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!campaignToDelete} onOpenChange={(open) => !open && setCampaignToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-tier0">
              <AlertTriangle className="w-5 h-5 stroke-[1.5]" />
              Delete data collection request?
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-2 text-xs text-secondary leading-relaxed">
              <p>
                Are you sure you want to delete <strong className="text-primary font-medium">{campaignToDelete?.title}</strong>?
              </p>
              <p>
                This will permanently remove the request and all{' '}
                <strong className="text-primary font-medium">{campaignToDelete?.invitations?.length || 0}</strong>{' '}
                associated invitations and drafts. This action cannot be undone.
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCampaignToDelete(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteCampaign}
              disabled={isDeleting}
              isLoading={isDeleting}
            >
              Delete request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
