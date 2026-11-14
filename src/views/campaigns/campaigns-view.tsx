import { useState } from 'react';
import {
  Send,
  Plus,
  Calendar,
  Copy,
  Check,
  ArrowRight,
} from 'lucide-react';
import { useCampaigns, useCampaignProgress, useOwnerGroups, type CampaignResponse } from '../../api/endpoints';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent } from '../../components/ui/card';
import { formatDateTime } from '../../lib/utils';
import { api, ApiProblemError } from '../../api/client';
import { RFC9457Alert } from '../../components/governance/rfc9457-alert';
import { useAuth } from '../../store/auth-context';

export function CampaignsView() {
  const { activeRole } = useAuth();
  const { data: campaignsData, isLoading, refetch } = useCampaigns();
  const { data: ownerGroups = [] } = useOwnerGroups();

  const [selectedCampaign, setSelectedCampaign] = useState<CampaignResponse | null>(null);
  const { data: progressData } = useCampaignProgress(selectedCampaign?.id || null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [campaignTitle, setCampaignTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeProblem, setActiveProblem] = useState<ApiProblemError['problem'] | null>(null);

  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const campaigns = campaignsData || [];

  const handleCreateCampaign = async () => {
    if (!campaignTitle || !deadline) return;
    setIsSubmitting(true);
    setActiveProblem(null);
    try {
      await api.post('admin/intake/campaigns', {
        json: {
          title: campaignTitle,
          deadline: new Date(deadline).toISOString(),
          scope_owner_group_ids: selectedGroupIds.length > 0 ? selectedGroupIds : ownerGroups.map((g) => g.id),
        },
      });
      setShowCreateModal(false);
      setCampaignTitle('');
      setDeadline('');
      setSelectedGroupIds([]);
      refetch();
    } catch (err) {
      if (err instanceof ApiProblemError) setActiveProblem(err.problem);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(url);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  return (
    <div className="space-y-6 max-w-7xl w-full mx-auto animate-in fade-in-50 duration-150">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-primary">Decentralized Intake Campaigns</h1>
          <p className="text-xs text-secondary mt-1">
            Distribute cryptographic magic links to Department Team Leads to register services without manual account provisioning.
          </p>
        </div>

        {activeRole === 'platform_admin' && (
          <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-3.5 h-3.5 mr-1 stroke-[1.5]" /> Launch New Campaign
          </Button>
        )}
      </div>

      {activeProblem && (
        <RFC9457Alert problem={activeProblem} onDismiss={() => setActiveProblem(null)} />
      )}

      {/* Campaigns Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-3 p-8 text-center text-xs text-muted bg-surface border border-subtle rounded-md">
            Loading campaigns...
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
              className={`cursor-pointer transition-colors hover:border-control ${
                selectedCampaign?.id === camp.id ? 'border-accent ring-2 ring-accent bg-selected' : ''
              }`}
              onClick={() => setSelectedCampaign(camp)}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <span className="text-2xs font-mono uppercase bg-tier2-bg text-accent border border-tier2-border px-2 py-0.5 rounded-sm font-semibold">
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

      {/* Campaign Progress & Magic Link Invitations Drawer */}
      {selectedCampaign && (
        <div className="bg-surface border border-hairline rounded-md p-5 space-y-4 animate-in fade-in-50 duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-subtle">
            <div>
              <h2 className="text-base font-semibold text-primary">
                {selectedCampaign.title} — Progress & Magic Links
              </h2>
              <p className="text-xs text-secondary">
                Single-use tokens for Department Team Leads. Share via Slack, Email, or direct link.
              </p>
            </div>
            {progressData && (
              <div className="text-xs font-mono text-inservice bg-surface-sunken border border-subtle px-2.5 py-1 rounded-sm">
                Submitted: {progressData.total_submitted} / {progressData.total_invitations} Teams
              </div>
            )}
          </div>

          {/* Invitations Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface-sunken border-b border-subtle text-secondary font-mono text-2xs uppercase tracking-wider">
                  <th className="py-2.5 px-3 font-medium">Department & Group</th>
                  <th className="py-2.5 px-3 font-medium">Team Lead Name</th>
                  <th className="py-2.5 px-3 font-medium">Team Lead Email</th>
                  <th className="py-2.5 px-3 font-medium">Expires At</th>
                  <th className="py-2.5 px-3 font-medium text-right">Magic Link Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {selectedCampaign.invitations?.map((inv) => (
                  <tr key={inv.invitation_id} className="hover:bg-hover transition-colors">
                    <td className="py-2.5 px-3 font-semibold text-primary">
                      {inv.department_name} ({inv.owner_group_name})
                    </td>
                    <td className="py-2.5 px-3 text-secondary">{inv.team_lead_name}</td>
                    <td className="py-2.5 px-3 text-secondary font-mono text-2xs">{inv.team_lead_email}</td>
                    <td className="py-2.5 px-3 text-muted font-mono text-3xs">
                      {formatDateTime(inv.expires_at)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => copyUrl(inv.invitation_url)}
                      >
                        {copiedLink === inv.invitation_url ? (
                          <>
                            <Check className="w-3 h-3 mr-1 text-inservice stroke-[1.5]" /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 mr-1 stroke-[1.5]" /> Copy Magic Link
                          </>
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Campaign Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(17,24,39,0.40)] p-4 animate-in fade-in-0 duration-150">
          <div className="w-full max-w-md bg-surface border border-hairline rounded-lg p-5 space-y-4 shadow-[0_4px_12px_rgba(16,24,40,0.10)]">
            <div className="flex items-center gap-2.5 text-accent">
              <Send className="w-5 h-5 shrink-0 stroke-[1.5]" />
              <h3 className="text-base font-semibold text-primary">Launch Decentralized Intake Campaign</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-2xs font-mono uppercase text-muted mb-1">
                  Campaign Title
                </label>
                <Input
                  value={campaignTitle}
                  onChange={(e) => setCampaignTitle(e.target.value)}
                  placeholder="e.g. Q4 2026 Core Infrastructure Baseline"
                />
              </div>

              <div>
                <label className="block text-2xs font-mono uppercase text-muted mb-1">
                  Submission Deadline
                </label>
                <Input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreateCampaign}
                isLoading={isSubmitting}
                disabled={!campaignTitle || !deadline}
              >
                Launch Campaign
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
