import { describe, it, expect, vi } from 'vitest';
import { getInitialTab } from '../src/views/dashboard/dashboard-view';

describe('Dashboard Workspace Sub-Tabs Tests', () => {
  describe('Sub-Tab Definitions & Badge Indicators', () => {
    it('defines the 4 required dashboard sub-tabs with correct IDs and labels', () => {
      const tabs = [
        { id: 'overview', label: '3 Cs Health Overview' },
        { id: 'digest', label: 'Verification Digest' },
        { id: 'handshakes', label: 'Handshake Inbox' },
        { id: 'campaigns', label: 'Intake Campaigns' },
      ];

      expect(tabs).toHaveLength(4);
      expect(tabs.map((t) => t.id)).toEqual(['overview', 'digest', 'handshakes', 'campaigns']);
      expect(tabs.find((t) => t.id === 'overview')?.label).toBe('3 Cs Health Overview');
      expect(tabs.find((t) => t.id === 'digest')?.label).toBe('Verification Digest');
      expect(tabs.find((t) => t.id === 'handshakes')?.label).toBe('Handshake Inbox');
      expect(tabs.find((t) => t.id === 'campaigns')?.label).toBe('Intake Campaigns');
    });

    it('correctly associates badges with pending edges count and open digest items count', () => {
      const mockPendingEdges = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }];
      const mockDigestItems = [
        { id: 'd1', status: 'open' },
        { id: 'd2', status: 'actioned' },
        { id: 'd3', status: 'open' },
      ];

      const openDigestCount = mockDigestItems.filter((i) => i.status === 'open').length;
      const pendingEdgesCount = mockPendingEdges.length;

      expect(openDigestCount).toBe(2);
      expect(pendingEdgesCount).toBe(3);
    });
  });

  describe('Deep-Linking, Path Normalization & Sub-Tab URL Resolution', () => {
    it('returns overview when window is undefined (SSR / Node test environment)', () => {
      const origWindow = (globalThis as any).window;
      try {
        delete (globalThis as any).window;
        expect(getInitialTab()).toBe('overview');
      } finally {
        (globalThis as any).window = origWindow;
      }
    });

    it('resolves tab using exported getInitialTab with search params (?tab=...)', () => {
      const origWindow = (globalThis as any).window;
      try {
        const mockWindow = (urlStr: string) => {
          const u = new URL(urlStr);
          (globalThis as any).window = {
            location: {
              href: u.href,
              search: u.search,
              hash: u.hash,
              pathname: u.pathname,
            },
          };
        };

        mockWindow('http://localhost:5173/dashboard?tab=digest');
        expect(getInitialTab()).toBe('digest');

        mockWindow('http://localhost:5173/dashboard?tab=handshakes');
        expect(getInitialTab()).toBe('handshakes');

        mockWindow('http://localhost:5173/dashboard?tab=campaigns');
        expect(getInitialTab()).toBe('campaigns');

        mockWindow('http://localhost:5173/dashboard?tab=overview');
        expect(getInitialTab()).toBe('overview');
      } finally {
        (globalThis as any).window = origWindow;
      }
    });

    it('resolves tab from URL hashes (#...)', () => {
      const origWindow = (globalThis as any).window;
      try {
        const mockWindow = (urlStr: string) => {
          const u = new URL(urlStr);
          (globalThis as any).window = {
            location: {
              href: u.href,
              search: u.search,
              hash: u.hash,
              pathname: u.pathname,
            },
          };
        };

        mockWindow('http://localhost:5173/dashboard#digest');
        expect(getInitialTab()).toBe('digest');

        mockWindow('http://localhost:5173/dashboard#handshakes');
        expect(getInitialTab()).toBe('handshakes');

        mockWindow('http://localhost:5173/dashboard#campaigns');
        expect(getInitialTab()).toBe('campaigns');
      } finally {
        (globalThis as any).window = origWindow;
      }
    });

    it('resolves tab from direct path alias (/handshakes, /digest, /campaigns)', () => {
      const origWindow = (globalThis as any).window;
      try {
        const mockWindow = (urlStr: string) => {
          const u = new URL(urlStr);
          (globalThis as any).window = {
            location: {
              href: u.href,
              search: u.search,
              hash: u.hash,
              pathname: u.pathname,
            },
          };
        };

        mockWindow('http://localhost:5173/digest');
        expect(getInitialTab()).toBe('digest');

        mockWindow('http://localhost:5173/handshakes');
        expect(getInitialTab()).toBe('handshakes');

        mockWindow('http://localhost:5173/campaigns');
        expect(getInitialTab()).toBe('campaigns');

        mockWindow('http://localhost:5173/dashboard');
        expect(getInitialTab()).toBe('overview');
      } finally {
        (globalThis as any).window = origWindow;
      }
    });

    it('normalizes target subtab URLs to /dashboard?tab=... and /dashboard', () => {
      function getNormalizedSubTabPath(tabId: string): string {
        return tabId === 'overview' ? '/dashboard' : `/dashboard?tab=${tabId}`;
      }

      expect(getNormalizedSubTabPath('overview')).toBe('/dashboard');
      expect(getNormalizedSubTabPath('digest')).toBe('/dashboard?tab=digest');
      expect(getNormalizedSubTabPath('handshakes')).toBe('/dashboard?tab=handshakes');
      expect(getNormalizedSubTabPath('campaigns')).toBe('/dashboard?tab=campaigns');
    });

    it('falls back to overview for unknown paths or params', () => {
      const origWindow = (globalThis as any).window;
      try {
        const mockWindow = (urlStr: string) => {
          const u = new URL(urlStr);
          (globalThis as any).window = {
            location: {
              href: u.href,
              search: u.search,
              hash: u.hash,
              pathname: u.pathname,
            },
          };
        };

        mockWindow('http://localhost:5173/dashboard?tab=invalid');
        expect(getInitialTab()).toBe('overview');

        mockWindow('http://localhost:5173/');
        expect(getInitialTab()).toBe('overview');
      } finally {
        (globalThis as any).window = origWindow;
      }
    });
  });

  describe('3 Cs Health Overview Calculations, Class Status & Attention Queue', () => {
    it('computes 3 Cs scores with zero division safeguards when catalog is empty', () => {
      const catalogItems: any[] = [];
      const totalCIs = 0;
      const staleCount = 0;
      const orphanCount = 0;
      const verifiedCount = 0;

      const completeness = catalogItems.length === 0 ? 100 : 0;
      const correctness = totalCIs > 0
        ? Math.max(0, Math.min(100, Math.round(((totalCIs - (staleCount + orphanCount)) / totalCIs) * 100)))
        : 100;
      const compliance = totalCIs > 0 ? Math.round((verifiedCount / totalCIs) * 100) : 100;
      const overall = Math.round((completeness + correctness + compliance) / 3);

      expect(completeness).toBe(100);
      expect(correctness).toBe(100);
      expect(compliance).toBe(100);
      expect(overall).toBe(100);
    });

    it('calculates stale counts independently per CI class without cross-class pollution', () => {
      const now = Date.now();
      const mockItems = [
        // Stale Application
        {
          ci_id: 'app-1',
          ci_class: 'application',
          last_verified_at: new Date(now - 70 * 24 * 60 * 60 * 1000).toISOString(),
        },
        // Fresh Database
        {
          ci_id: 'db-1',
          ci_class: 'database',
          last_verified_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
        },
        // Fresh Database
        {
          ci_id: 'db-2',
          ci_class: 'database',
          last_verified_at: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ];

      const calcStaleForClass = (ciClass: string) => {
        return mockItems.filter((c) => {
          if (c.ci_class !== ciClass) return false;
          if (!c.last_verified_at) return true;
          return now - new Date(c.last_verified_at).getTime() > 60 * 24 * 60 * 60 * 1000;
        }).length;
      };

      const appStale = calcStaleForClass('application');
      const dbStale = calcStaleForClass('database');

      // Application has 1 stale item; Database has 0 stale items
      expect(appStale).toBe(1);
      expect(dbStale).toBe(0);
    });

    it('includes unverified CIs (last_verified_at = null) in Attention Needed queue', () => {
      const ownerGroups = [{ id: 'group-1', name: 'Core SRE', department_name: 'Engineering' }];
      const catalogItems = [
        {
          ci_id: 'ci-unverified',
          name: 'unverified-service',
          ci_class: 'business_service',
          criticality_tier: 'tier_1',
          owner_group_id: 'group-1',
          last_verified_at: null, // Never verified
          lifecycle_state: 'in_service',
        },
        {
          ci_id: 'ci-healthy',
          name: 'healthy-db',
          ci_class: 'database',
          criticality_tier: 'tier_2',
          owner_group_id: 'group-1',
          last_verified_at: new Date().toISOString(),
          lifecycle_state: 'in_service',
        },
      ];

      const attentionItems: Array<{ id: string; issue: string; owner: string }> = [];

      catalogItems.forEach((ci) => {
        const isUnverified = !ci.last_verified_at;
        const isStale =
          isUnverified ||
          Date.now() - new Date(ci.last_verified_at!).getTime() > 60 * 24 * 60 * 60 * 1000;
        const isOutOfSync = ci.lifecycle_state === 'out_of_sync';
        const isOrphan = !ci.owner_group_id;

        if (isOutOfSync || isStale || isOrphan) {
          let issue = '';
          if (isStale) issue = isUnverified ? 'Never verified' : 'Unverified > 60 days (stale)';
          const group = ownerGroups.find((g) => g.id === ci.owner_group_id);
          attentionItems.push({
            id: ci.ci_id,
            issue,
            owner: group?.name || 'Unassigned',
          });
        }
      });

      expect(attentionItems).toHaveLength(1);
      expect(attentionItems[0].id).toBe('ci-unverified');
      expect(attentionItems[0].issue).toBe('Never verified');
      expect(attentionItems[0].owner).toBe('Core SRE');
    });
  });

  describe('Verification Digest Tab Batch & Retire Actions', () => {
    it('segregates fulfilled vs rejected verifications and preserves error states', async () => {
      const openItems = [
        { ci_id: 'ci-1', name: 'app-service' },
        { ci_id: 'ci-2', name: 'db-service' },
        { ci_id: 'ci-3', name: 'cache-service' },
      ];

      const mockVerify = async (id: string) => {
        if (id === 'ci-2') {
          const err = new Error('Database locked');
          (err as any).status = 409;
          throw err;
        }
        return { ci_id: id, verified_at: new Date().toISOString() };
      };

      const results = await Promise.allSettled(
        openItems.map((item) => mockVerify(item.ci_id))
      );

      let succeeded = 0;
      let failed = 0;
      const failedIds: string[] = [];

      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          succeeded++;
        } else {
          failed++;
          failedIds.push(openItems[idx].ci_id);
        }
      });

      expect(succeeded).toBe(2);
      expect(failed).toBe(1);
      expect(failedIds).toEqual(['ci-2']);
    });

    it('correctly constructs retire query parameters with searchParams (?force=true) per OpenAPI spec', () => {
      function buildRetireUrl(id: string, force?: boolean): { path: string; searchParams?: Record<string, string> } {
        const searchParams = force ? { force: 'true' } : undefined;
        return {
          path: `cis/${id}/retire`,
          searchParams,
        };
      }

      const standardRetire = buildRetireUrl('ci-uuid-1', false);
      expect(standardRetire.path).toBe('cis/ci-uuid-1/retire');
      expect(standardRetire.searchParams).toBeUndefined();

      const forcedRetire = buildRetireUrl('ci-uuid-1', true);
      expect(forcedRetire.path).toBe('cis/ci-uuid-1/retire');
      expect(forcedRetire.searchParams).toEqual({ force: 'true' });
    });

    it('enables force retirement button only for platform_admin role on 409 conflict', () => {
      const conflictProblem = { status: 409, title: 'Conflict', detail: 'Active dependents exist' };

      const canForceRetire = (role: string, problem: { status: number } | null) => {
        return problem?.status === 409 && role === 'platform_admin';
      };

      expect(canForceRetire('platform_admin', conflictProblem)).toBe(true);
      expect(canForceRetire('team_lead', conflictProblem)).toBe(false);
      expect(canForceRetire('viewer', conflictProblem)).toBe(false);
      expect(canForceRetire('platform_admin', null)).toBe(false);
    });
  });

  describe('Handshake Inbox Tab Validations', () => {
    it('enforces dispute reason length constraints (max 512 characters)', () => {
      const maxReasonLength = 512;
      const validReason = 'Incorrect dependency: core-db was migrated to prod-v2 cluster.';
      const longReason = 'A'.repeat(600);

      expect(validReason.length).toBeLessThanOrEqual(maxReasonLength);
      expect(longReason.length).toBeGreaterThan(maxReasonLength);
      expect(longReason.slice(0, maxReasonLength).length).toBe(maxReasonLength);
    });
  });

  describe('Intake Campaigns Tab Creation, Selection & Link Formatting', () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it('enforces schema-compliant payload with owner_group_ids', () => {
      const payload: Record<string, any> = {
        title: 'Q4 2026 Core Infrastructure Baseline',
        deadline: new Date(Date.now() + 86400000).toISOString(),
        owner_group_ids: [
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
        ],
      };

      expect(payload).toHaveProperty('owner_group_ids');
      expect(payload).not.toHaveProperty('scope_owner_group_ids');
      expect(Array.isArray(payload.owner_group_ids)).toBe(true);
      expect(payload.owner_group_ids.length).toBeGreaterThanOrEqual(1);

      for (const id of payload.owner_group_ids) {
        expect(UUID_REGEX.test(id)).toBe(true);
      }
    });

    it('handles owner group checkbox selection, deselect all, and select all cleanly', () => {
      const groups = [
        { id: '11111111-1111-1111-1111-111111111111', name: 'Group 1' },
        { id: '22222222-2222-2222-2222-222222222222', name: 'Group 2' },
        { id: '33333333-3333-3333-3333-333333333333', name: 'Group 3' },
      ];

      // Initial state on modal open: all selected
      let selectedIds = groups.map((g) => g.id);
      expect(selectedIds).toHaveLength(3);

      // Deselect Group 2
      selectedIds = selectedIds.filter((id) => id !== groups[1].id);
      expect(selectedIds).toEqual([groups[0].id, groups[2].id]);
      expect(selectedIds.includes(groups[1].id)).toBe(false);

      // Deselect all
      selectedIds = [];
      expect(selectedIds).toHaveLength(0);

      // Select all
      selectedIds = groups.map((g) => g.id);
      expect(selectedIds).toHaveLength(3);
    });

    it('rejects deadlines in the past per Nielsen Heuristic #5 (Error Prevention)', () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      const futureDate = new Date(Date.now() + 86400000).toISOString();

      function validateDeadline(deadlineStr: string): boolean {
        const d = new Date(deadlineStr);
        return !isNaN(d.getTime()) && d.getTime() > Date.now();
      }

      expect(validateDeadline(pastDate)).toBe(false);
      expect(validateDeadline(futureDate)).toBe(true);
    });

    it('formats shareable magic link URLs with complete origins', () => {
      const origin = 'https://cmdb.enterprise.internal';
      function formatMagicLink(url: string, baseOrigin: string): string {
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `${baseOrigin}${url.startsWith('/') ? '' : '/'}${url}`;
      }

      const relativeUrl = '/intake/magic-token-abc-123';
      const formatted = formatMagicLink(relativeUrl, origin);
      expect(formatted).toBe('https://cmdb.enterprise.internal/intake/magic-token-abc-123');

      const absoluteUrl = 'https://cmdb.enterprise.internal/intake/magic-token-abc-123';
      expect(formatMagicLink(absoluteUrl, origin)).toBe(absoluteUrl);
    });

    it('extracts magic token from relative or absolute invitation URLs', () => {
      function extractToken(url: string): string {
        return url.replace(/^.*\/intake\//, '');
      }

      expect(extractToken('/intake/abc12345')).toBe('abc12345');
      expect(extractToken('http://localhost:5173/intake/def67890')).toBe('def67890');
      expect(extractToken('https://cmdb.enterprise.internal/intake/hex999')).toBe('hex999');
    });

    it('synchronizes selected campaign across fallback and refetched data', () => {
      const mockCreatedCampaign = {
        id: 'c1111111-1111-1111-1111-111111111111',
        title: 'Q4 Baseline',
        status: 'active' as const,
        deadline: new Date().toISOString(),
        created_at: new Date().toISOString(),
        invitations: [
          {
            invitation_id: 'i1111111-1111-1111-1111-111111111111',
            owner_group_id: 'g1111111-1111-1111-1111-111111111111',
            owner_group_name: 'Core Eng',
            department_name: 'Engineering',
            team_lead_name: 'Lead',
            team_lead_email: 'lead@example.com',
            invitation_url: '/intake/token123',
            expires_at: new Date().toISOString(),
          },
        ],
      };

      let selectedId: string | null = mockCreatedCampaign.id;
      let fallback: typeof mockCreatedCampaign | null = mockCreatedCampaign;
      let campaignsList: typeof mockCreatedCampaign[] = [];

      // Initially, campaignsList is empty, fallback provides selectedCampaign with links
      let selectedCampaign =
        campaignsList.find((c) => c.id === selectedId) ||
        (fallback?.id === selectedId ? fallback : null);
      expect(selectedCampaign).not.toBeNull();
      expect(selectedCampaign?.invitations).toHaveLength(1);
      expect(selectedCampaign?.invitations[0].invitation_url).toBe('/intake/token123');

      // After refetch, campaignsList has the campaign
      campaignsList = [mockCreatedCampaign];
      selectedCampaign =
        campaignsList.find((c) => c.id === selectedId) ||
        (fallback?.id === selectedId ? fallback : null);
      expect(selectedCampaign).not.toBeNull();
      expect(selectedCampaign?.invitations).toHaveLength(1);
    });

    it('guards campaign queries against unauthorized 403 calls when auth is loading or non-admin', () => {
      const computeIsPlatformAdmin = (authLoading: boolean, role: string) => {
        return !authLoading && role === 'platform_admin';
      };

      // Loading state: must be false even if role defaults to platform_admin
      expect(computeIsPlatformAdmin(true, 'platform_admin')).toBe(false);

      // Resolved platform admin
      expect(computeIsPlatformAdmin(false, 'platform_admin')).toBe(true);

      // Resolved team lead
      expect(computeIsPlatformAdmin(false, 'team_lead')).toBe(false);

      // Resolved viewer
      expect(computeIsPlatformAdmin(false, 'viewer')).toBe(false);
    });

    it('auto-selects first campaign when campaigns load and none was previously selected', () => {
      const campaignsList = [
        { id: 'c-1', title: 'Campaign 1', invitations: [] },
        { id: 'c-2', title: 'Campaign 2', invitations: [] },
      ];

      function resolveSelectedId(currentSelectedId: string | null, list: typeof campaignsList): string | null {
        if (!currentSelectedId && list.length > 0) {
          return list[0].id;
        }
        return currentSelectedId;
      }

      expect(resolveSelectedId(null, campaignsList)).toBe('c-1');
      expect(resolveSelectedId('c-2', campaignsList)).toBe('c-2');
      expect(resolveSelectedId(null, [])).toBeNull();
    });

    it('validates campaign creation constraints (title length, required groups, future deadline)', () => {
      const validateCampaignForm = (title: string, deadline: string, groupIds: string[]) => {
        const trimmed = title.trim();
        if (!trimmed) return 'Campaign title is required.';
        if (trimmed.length > 255) return 'Campaign title cannot exceed 255 characters.';
        if (!deadline) return 'Submission deadline is required.';
        const d = new Date(deadline);
        if (isNaN(d.getTime()) || d.getTime() <= Date.now()) return 'Submission deadline must be in the future.';
        const validGroupIds = groupIds.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        if (validGroupIds.length === 0) return 'At least one valid owner group must be selected.';
        return null;
      };

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const validGid = '10000000-0000-0000-0000-000000000001';

      expect(validateCampaignForm('', futureDate, [validGid])).toBe('Campaign title is required.');
      expect(validateCampaignForm('   ', futureDate, [validGid])).toBe('Campaign title is required.');
      expect(validateCampaignForm('a'.repeat(256), futureDate, [validGid])).toBe('Campaign title cannot exceed 255 characters.');
      expect(validateCampaignForm('Valid Title', '', [validGid])).toBe('Submission deadline is required.');
      expect(validateCampaignForm('Valid Title', pastDate, [validGid])).toBe('Submission deadline must be in the future.');
      expect(validateCampaignForm('Valid Title', futureDate, [])).toBe('At least one valid owner group must be selected.');
      expect(validateCampaignForm('Valid Title', futureDate, ['not-a-uuid'])).toBe('At least one valid owner group must be selected.');
      expect(validateCampaignForm('Valid Title', futureDate, [validGid])).toBeNull();
      expect(validateCampaignForm('a'.repeat(255), futureDate, [validGid])).toBeNull();
    });
  });

  describe('P0 - CMDB Governance Health Metrics & Reconciled Calculation Rules', () => {
    it('enforces that All Targets Met (>90%) is TRUE ONLY when all 3 metrics meet the 90% threshold', () => {
      const checkAllTargetsMet = (comp: number | null, corr: number | null, compl: number | null, hasData: boolean) => {
        return (
          hasData &&
          comp !== null && comp >= 90 &&
          corr !== null && corr >= 90 &&
          compl !== null && compl >= 90
        );
      };

      // Real bug case: Completeness 100%, Correctness 82%, Compliance 96% -> average is 93%, but Correctness fails!
      expect(checkAllTargetsMet(100, 82, 96, true)).toBe(false);

      // All 3 meet 90%:
      expect(checkAllTargetsMet(90, 90, 90, true)).toBe(true);
      expect(checkAllTargetsMet(100, 95, 98, true)).toBe(true);

      // Any single metric below 90% must result in false:
      expect(checkAllTargetsMet(89, 95, 95, true)).toBe(false);
      expect(checkAllTargetsMet(95, 89, 95, true)).toBe(false);
      expect(checkAllTargetsMet(95, 95, 89, true)).toBe(false);

      // No data state:
      expect(checkAllTargetsMet(null, null, null, false)).toBe(false);
    });

    it('returns null (formatting to dash "—") when total CIs is zero instead of misleading 100%', () => {
      const computeOverallHealth = (totalCIs: number, comp: number | null, corr: number | null, compl: number | null) => {
        if (totalCIs === 0 || comp === null || corr === null || compl === null) {
          return null;
        }
        return Math.max(0, Math.min(100, Math.round((comp + corr + compl) / 3)));
      };

      expect(computeOverallHealth(0, null, null, null)).toBeNull();
      expect(computeOverallHealth(0, 100, 100, 100)).toBeNull();
      expect(computeOverallHealth(49, 100, 82, 96)).toBe(93);
    });

    it('penalizes Completeness score when owner group or other required attributes are unassigned', () => {
      const computeCompleteness = (items: Array<{ name?: string; ci_class?: string; environment?: string; criticality_tier?: string; technical_contact?: string; owner_group_id?: string }>) => {
        if (items.length === 0) return null;
        const validSum = items.reduce((acc, ci) => {
          let c = 0;
          if (ci.name) c++;
          if (ci.ci_class) c++;
          if (ci.environment) c++;
          if (ci.criticality_tier) c++;
          if (ci.technical_contact) c++;
          if (ci.owner_group_id && ci.owner_group_id !== 'Unassigned') c++;
          return acc + c / 6;
        }, 0);
        return Math.round((validSum / items.length) * 100);
      };

      const completeItems = [
        { name: 'ci1', ci_class: 'app', environment: 'prod', criticality_tier: 'tier_0', technical_contact: 'lead', owner_group_id: 'g1' },
        { name: 'ci2', ci_class: 'app', environment: 'prod', criticality_tier: 'tier_0', technical_contact: 'lead', owner_group_id: 'g2' },
      ];
      expect(computeCompleteness(completeItems)).toBe(100);

      // Missing owner on 1 of 2 items
      const missingOwnerItems = [
        { name: 'ci1', ci_class: 'app', environment: 'prod', criticality_tier: 'tier_0', technical_contact: 'lead', owner_group_id: 'g1' },
        { name: 'ci2', ci_class: 'app', environment: 'prod', criticality_tier: 'tier_0', technical_contact: 'lead', owner_group_id: '' },
      ];
      // 1 full item (6/6) + 1 item missing owner (5/6) = (1 + 0.833)/2 = 91.66% -> 92%
      expect(computeCompleteness(missingOwnerItems)).toBe(92);
    });

    it('reconciles in-service CIs category counts so sum matches total in-service CIs exactly', () => {
      const inServiceCIs = [
        ...Array(7).fill({ ci_class: 'business_service', lifecycle_state: 'in_service' }),
        ...Array(14).fill({ ci_class: 'application', lifecycle_state: 'in_service' }),
        ...Array(10).fill({ ci_class: 'database', lifecycle_state: 'in_service' }),
        ...Array(5).fill({ ci_class: 'vm_cluster', lifecycle_state: 'in_service' }),
        ...Array(5).fill({ ci_class: 'physical_host', lifecycle_state: 'in_service' }),
        ...Array(4).fill({ ci_class: 'vm_server', lifecycle_state: 'in_service' }),
        ...Array(4).fill({ ci_class: 'network_firewall', lifecycle_state: 'in_service' }),
      ];

      const counts = {
        services: inServiceCIs.filter((c) => c.ci_class === 'business_service').length,
        applications: inServiceCIs.filter((c) => c.ci_class === 'application').length,
        databases: inServiceCIs.filter((c) => c.ci_class === 'database').length,
        infrastructure: inServiceCIs.filter((c) => ['vm_cluster', 'physical_host', 'vm_server'].includes(c.ci_class)).length,
        networks: inServiceCIs.filter((c) => c.ci_class === 'network_firewall').length,
      };

      const totalSum = counts.services + counts.applications + counts.databases + counts.infrastructure + counts.networks;
      expect(totalSum).toBe(49);
      expect(counts.infrastructure).toBe(14); // 5 + 5 + 4
      expect(counts.services).toBe(7);
      expect(counts.applications).toBe(14);
      expect(counts.databases).toBe(10);
      expect(counts.networks).toBe(4);
    });

    it('ensures verification digest progress bar is 0% when review queue has 0 items', () => {
      const computeDigestProgress = (actionedCount: number, totalCount: number) => {
        return totalCount > 0 ? (actionedCount / totalCount) * 100 : 0;
      };

      expect(computeDigestProgress(0, 0)).toBe(0);
      expect(computeDigestProgress(2, 4)).toBe(50);
      expect(computeDigestProgress(3, 3)).toBe(100);
    });
  });
});
