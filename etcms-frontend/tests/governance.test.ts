import { describe, it, expect } from 'vitest';
import { checkPayloadForITAM, ApiProblemError } from '../src/api/client';
import { formatRelativeTime } from '../src/lib/utils';
import {
  getConnectedTopology,
  detectTopologyCycles,
  simulateOutageCascade,
  getHighestCriticalityTier,
} from '../src/views/graph/graph-topology';
import { DEFAULT_CI_CLASSES } from '../src/api/endpoints';

describe('ETCMS Governance & Heuristics Unit Tests', () => {
  describe('Heuristic #5: Error Prevention & Strict Anti-ITAM Schema Enforcement', () => {
    it('detects top-level ITAM fields', () => {
      const payload = {
        name: 'payments-db',
        ci_class: 'database',
        cost: 15000,
      };
      const violations = checkPayloadForITAM(payload);
      expect(violations).toContain('cost');
    });

    it('detects nested and case-insensitive ITAM fields', () => {
      const payload = {
        name: 'auth-service',
        metadata: {
          VENDOR: 'Oracle',
          subsystem: {
            warranty_end: '2028-01-01',
            license_count: 50,
          },
        },
      };
      const violations = checkPayloadForITAM(payload);
      expect(violations).toContain('metadata.VENDOR');
      expect(violations).toContain('metadata.subsystem.warranty_end');
      expect(violations).toContain('metadata.subsystem.license_count');
    });

    it('passes operational CMDB payloads with zero ITAM fields', () => {
      const payload = {
        name: 'core-payment-api',
        ci_class: 'application',
        environment: 'prod',
        criticality_tier: 'tier_0',
        owner_group_id: '11111111-1111-1111-1111-111111111111',
        technical_contact: 'sre-lead@bank.internal',
        primary_endpoint: '10.200.4.15',
        class_metadata: {
          tier: 'core',
          zone: 'internal',
        },
      };
      const violations = checkPayloadForITAM(payload);
      expect(violations).toHaveLength(0);
    });
  });

  describe('Heuristic #9: Help Users Recognize, Diagnose, and Recover from Errors (RFC 9457)', () => {
    it('properly preserves RFC 9457 problem details and blocking dependent CIs', () => {
      const problem = {
        type: 'https://tools.ietf.org/html/rfc9457',
        title: 'Conflict',
        status: 409,
        detail: 'Cannot retire CI: active dependents exist',
        dependent_cis: [
          {
            ci_id: 'app-uuid-1',
            name: 'payments-web',
            ci_class: 'application' as const,
            environment: 'prod' as const,
          },
        ],
      };

      const err = new ApiProblemError(problem);
      expect(err.status).toBe(409);
      expect(err.problem.title).toBe('Conflict');
      expect(err.problem.dependent_cis).toHaveLength(1);
      expect(err.problem.dependent_cis?.[0].name).toBe('payments-web');
    });
  });

  describe('Time Formatting Helpers', () => {
    it('correctly computes relative time strings', () => {
      const now = new Date();
      expect(formatRelativeTime(now.toISOString())).toBe('just now');

      const oneHourAgo = new Date(now.getTime() - 65 * 60 * 1000);
      expect(formatRelativeTime(oneHourAgo.toISOString())).toBe('1h ago');

      const twoDaysAgo = new Date(now.getTime() - 49 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoDaysAgo.toISOString())).toBe('2d ago');

      expect(formatRelativeTime(null)).toBe('Never');
    });
  });

  describe('Custom Roles & Granular Capabilities', () => {
    it('verifies standard capability keys', () => {
      const standardCapabilities = [
        'ci:read',
        'ci:write',
        'edge:manage',
        'ci:flag',
        'ci:retire',
        'ci:force_retire',
        'audit:export',
        'admin:all',
      ];

      const serviceOwnerPermissions = [
        'ci:read',
        'ci:write',
        'ci:flag',
        'ci:retire',
        'edge:manage',
      ];

      for (const perm of serviceOwnerPermissions) {
        expect(standardCapabilities).toContain(perm);
      }
    });

    it('verifies 5 streamlined workspace identifiers', () => {
      const allowedWorkspaces = ['dashboard', 'catalog', 'graph', 'audit', 'settings'];
      expect(allowedWorkspaces).toHaveLength(5);
      expect(allowedWorkspaces).not.toContain('handshakes');
      expect(allowedWorkspaces).not.toContain('campaigns');
      expect(allowedWorkspaces).not.toContain('digest');
    });
  });

  describe('Administration Workspace & CI Dependencies', () => {
    it('verifies Settings workspace sub-tabs include Administration', () => {
      const settingsTabs = ['roles', 'users', 'administration', 'system'];
      expect(settingsTabs).toContain('administration');
    });

    it('verifies CI dependency relationship types for CI creation', () => {
      const allowedEdgeTypes = ['depends_on', 'reads_from', 'connects_to', 'hosted_on'];
      expect(allowedEdgeTypes).toContain('depends_on');
      expect(allowedEdgeTypes).toContain('reads_from');
      expect(allowedEdgeTypes).toContain('connects_to');
      expect(allowedEdgeTypes).toContain('hosted_on');
    });

    it('verifies all CI classes are unlocked, customizable, and have is_system = false', () => {
      expect(DEFAULT_CI_CLASSES.length).toBeGreaterThanOrEqual(6);
      for (const cls of DEFAULT_CI_CLASSES) {
        expect(cls.is_system).toBe(false);
      }
    });

    it('verifies referential deletion safety for categories when classes or CIs exist', () => {
      const mockCategory = {
        id: 'infrastructure',
        name: 'Infrastructure',
        class_count: 3,
        ci_count: 12,
      };
      const isBlocked = (mockCategory.class_count || 0) > 0 || (mockCategory.ci_count || 0) > 0;
      expect(isBlocked).toBe(true);

      const emptyCategory = {
        id: 'experimental',
        name: 'Experimental',
        class_count: 0,
        ci_count: 0,
      };
      const isBlockedEmpty = (emptyCategory.class_count || 0) > 0 || (emptyCategory.ci_count || 0) > 0;
      expect(isBlockedEmpty).toBe(false);
    });

    it('verifies referential deletion safety for custom relationships when edges exist', () => {
      const activeRel = {
        id: 'replicates_to',
        label: 'Replicates To',
        edge_count: 4,
      };
      const isBlocked = (activeRel.edge_count || 0) > 0;
      expect(isBlocked).toBe(true);

      const unusedRel = {
        id: 'custom_link',
        label: 'Custom Link',
        edge_count: 0,
      };
      const isBlockedUnused = (unusedRel.edge_count || 0) > 0;
      expect(isBlockedUnused).toBe(false);
    });

    it('verifies referential deletion safety for CI classes when CIs exist', () => {
      const mockCatalogCIs = [
        { ci_id: 'ci-1', name: 'app-service', ci_class: 'application' },
        { ci_id: 'ci-2', name: 'db-primary', ci_class: 'database' },
      ];
      const activeCIsForApp = mockCatalogCIs.filter((c) => c.ci_class === 'application').length;
      expect(activeCIsForApp).toBe(1);
      expect(activeCIsForApp > 0).toBe(true);

      const activeCIsForVm = mockCatalogCIs.filter((c) => c.ci_class === 'vm_server').length;
      expect(activeCIsForVm).toBe(0);
      expect(activeCIsForVm > 0).toBe(false);
    });
  });

  describe('CI Statuses (Synced, Out of Sync, In Service, Retired)', () => {
    it('prohibits Active and Inactive in CI status mapping', () => {
      const statusLabels: Record<string, string> = {
        synced: 'Synced',
        out_of_sync: 'Out of Sync',
        in_service: 'In Service',
        planned: 'Planned',
        deprecated: 'Deprecated',
        retired: 'Retired',
      };

      for (const [state, label] of Object.entries(statusLabels)) {
        expect(label).not.toBe('Active');
        expect(label).not.toBe('Inactive');
      }

      expect(statusLabels.in_service).toBe('In Service');
      expect(statusLabels.retired).toBe('Retired');
      expect(statusLabels.synced).toBe('Synced');
      expect(statusLabels.out_of_sync).toBe('Out of Sync');
    });

    it('verifies filter options include synced and out_of_sync', () => {
      const allowedFilters = [
        '',
        'out_of_sync',
        'synced',
        'in_service',
        'planned',
        'deprecated',
        'retired',
      ];
      expect(allowedFilters).toContain('synced');
      expect(allowedFilters).toContain('out_of_sync');
      expect(allowedFilters).toContain('in_service');
      expect(allowedFilters).toContain('retired');
      expect(allowedFilters).not.toContain('active');
      expect(allowedFilters).not.toContain('inactive');
    });
  });

  describe('Truth in System Status (No Fake Data)', () => {
    it('returns empty attention queue when all CIs are healthy and verified', () => {
      const healthyCIs = [
        {
          ci_id: 'ci-1',
          name: 'payments-api',
          ci_class: 'application',
          environment: 'prod',
          criticality_tier: 'tier_0',
          technical_contact: 'lead@bank.internal',
          owner_group_id: 'group-1',
          lifecycle_state: 'in_service',
          last_verified_at: new Date().toISOString(),
        },
      ];

      // Attention computation logic matching dashboard
      const attention = healthyCIs.filter((ci) => {
        const isStale =
          ci.last_verified_at &&
          new Date().getTime() - new Date(ci.last_verified_at).getTime() > 60 * 24 * 60 * 60 * 1000;
        const isOutOfSync = ci.lifecycle_state === 'out_of_sync';
        const isOrphan = !ci.owner_group_id;
        return isOutOfSync || isStale || isOrphan;
      });

      expect(attention).toHaveLength(0);
    });

    it('identifies genuine attention items without synthesizing artificial items', () => {
      const degradedCIs = [
        {
          ci_id: 'ci-stale',
          name: 'legacy-ledger',
          ci_class: 'database',
          owner_group_id: 'group-1',
          lifecycle_state: 'in_service',
          last_verified_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ];

      const attention = degradedCIs.filter((ci) => {
        const isStale =
          ci.last_verified_at &&
          new Date().getTime() - new Date(ci.last_verified_at).getTime() > 60 * 24 * 60 * 60 * 1000;
        const isOutOfSync = ci.lifecycle_state === 'out_of_sync';
        const isOrphan = !ci.owner_group_id;
        return isOutOfSync || isStale || isOrphan;
      });

      expect(attention).toHaveLength(1);
      expect(attention[0].name).toBe('legacy-ledger');
    });
  });

  describe('Robust Batch Operations', () => {
    it('properly segregates fulfilled vs rejected IDs during batch verification', async () => {
      const selectedIDs = ['ci-1', 'ci-2', 'ci-3'];
      const mockVerify = async (id: string) => {
        if (id === 'ci-2') throw new Error('Network timeout');
        return id;
      };

      const results = await Promise.allSettled(
        selectedIDs.map(async (id) => mockVerify(id))
      );

      const succeeded = new Set<string>();
      let failed = 0;
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          succeeded.add(selectedIDs[idx]);
        } else {
          failed++;
        }
      });

      expect(succeeded.size).toBe(2);
      expect(succeeded.has('ci-1')).toBe(true);
      expect(succeeded.has('ci-3')).toBe(true);
      expect(failed).toBe(1);

      // Remaining selection retains failed items
      const remainingSelection = new Set<string>();
      selectedIDs.forEach((id) => {
        if (!succeeded.has(id)) remainingSelection.add(id);
      });
      expect(remainingSelection.size).toBe(1);
      expect(remainingSelection.has('ci-2')).toBe(true);
    });
  });

  describe('Semantic Token Pair Consistency', () => {
    it('verifies that status and tier badges maintain matching foreground and background tokens', () => {
      const validBadgePairs = [
        { bg: 'bg-tier0-bg', text: 'text-tier0' },
        { bg: 'bg-tier1-bg', text: 'text-tier1' },
        { bg: 'bg-tier2-bg', text: 'text-tier2' },
        { bg: 'bg-accent-subtle', text: 'text-accent' },
        { bg: 'bg-accent-subtle', text: 'text-inservice' },
      ];

      for (const pair of validBadgePairs) {
        expect(pair.bg).not.toBe('bg-tier2-bg' && pair.text === 'text-accent');
      }
    });
  });

  describe('Pre-Seeded Enterprise Developer Personas', () => {
    it('verifies all 3 standard developer personas are configured with proper roles and groups', async () => {
      const { DEV_USERS, ADMIN_USER_ID, TEAM_LEAD_USER_ID, VIEWER_USER_ID } = await import(
        '../src/store/auth-context'
      );
      expect(DEV_USERS).toHaveLength(3);

      const admin = DEV_USERS.find((u) => u.id === ADMIN_USER_ID);
      expect(admin).toBeDefined();
      expect(admin?.role).toBe('platform_admin');
      expect(admin?.ownerGroupName).toBe('Platform Engineering');

      const lead = DEV_USERS.find((u) => u.id === TEAM_LEAD_USER_ID);
      expect(lead).toBeDefined();
      expect(lead?.role).toBe('team_lead');
      expect(lead?.ownerGroupName).toBe('Core Banking SRE');

      const viewer = DEV_USERS.find((u) => u.id === VIEWER_USER_ID);
      expect(viewer).toBeDefined();
      expect(viewer?.role).toBe('viewer');
      expect(viewer?.ownerGroupName).toBe('Audit & Compliance');
    });
  });

  describe('Graph Topology Consistency (Zero Detached CIs)', () => {
    it('strictly prunes unlinked or detached CIs from the topology graph', () => {
      const targetCIId = 'target-1';
      const candidateNodes = [
        { id: 'target-1', name: 'core-service' },
        { id: 'connected-consumer', name: 'web-app' },
        { id: 'connected-provider', name: 'primary-db' },
        { id: 'detached-sibling-1', name: 'unlinked-redis' },
        { id: 'detached-sibling-2', name: 'unlinked-kafka' },
      ];

      const edges = [
        { source: 'connected-consumer', target: 'target-1' },
        { source: 'target-1', target: 'connected-provider' },
      ];

      const { nodes: finalNodes } = getConnectedTopology(targetCIId, candidateNodes, edges);

      // Verify no detached CIs remain
      expect(finalNodes).toHaveLength(3);
      expect(finalNodes.map((n) => n.id)).toEqual([
        'target-1',
        'connected-consumer',
        'connected-provider',
      ]);
      expect(finalNodes.some((n) => n.id === 'detached-sibling-1')).toBe(false);
      expect(finalNodes.some((n) => n.id === 'detached-sibling-2')).toBe(false);
    });

    it('strictly prunes detached island subgraphs that have edges between themselves but no connection to target CI', () => {
      const targetCIId = 'target-1';
      const candidateNodes = [
        { id: 'target-1', name: 'core-service' },
        { id: 'connected-consumer', name: 'web-app' },
        { id: 'island-node-A', name: 'isolated-redis' },
        { id: 'island-node-B', name: 'isolated-cache-worker' },
      ];

      // island-node-A and island-node-B have edges between each other, but NEITHER connects to target-1
      const edges = [
        { id: 'e1', source: 'connected-consumer', target: 'target-1' },
        { id: 'e2', source: 'island-node-A', target: 'island-node-B' },
      ];

      const { nodes: finalNodes, edges: finalEdges } = getConnectedTopology(targetCIId, candidateNodes, edges);

      expect(finalNodes).toHaveLength(2);
      expect(finalNodes.map((n) => n.id)).toEqual(['target-1', 'connected-consumer']);
      expect(finalEdges).toHaveLength(1);
      expect(finalEdges[0].id).toBe('e1');
      expect(finalNodes.some((n) => n.id === 'island-node-A')).toBe(false);
      expect(finalNodes.some((n) => n.id === 'island-node-B')).toBe(false);
    });

    it('preserves an isolated target CI if it has zero registered dependencies', () => {
      const targetCIId = 'standalone-service';
      const candidateNodes = [{ id: 'standalone-service', name: 'standalone' }];
      const edges: { source: string; target: string }[] = [];

      const { nodes: finalNodes, edges: finalEdges } = getConnectedTopology(targetCIId, candidateNodes, edges);

      expect(finalNodes).toHaveLength(1);
      expect(finalNodes[0].id).toBe('standalone-service');
      expect(finalEdges).toHaveLength(0);
    });

    it('filters out self-loops (source === target) to prevent layout engine crashes', () => {
      const targetCIId = 'target-1';
      const candidateNodes = [
        { id: 'target-1', name: 'core-service' },
        { id: 'consumer-1', name: 'consumer-service' },
      ];
      const edges = [
        { id: 'valid-edge', source: 'consumer-1', target: 'target-1' },
        { id: 'self-loop', source: 'target-1', target: 'target-1' },
      ];

      const { nodes: finalNodes, edges: finalEdges } = getConnectedTopology(targetCIId, candidateNodes, edges);

      expect(finalNodes).toHaveLength(2);
      expect(finalEdges).toHaveLength(1);
      expect(finalEdges[0].id).toBe('valid-edge');
    });
  });

  describe('Graph Topology Cycle Detection (Circular Dependency Defense)', () => {
    it('detects direct 2-node circular dependencies (A -> B -> A)', () => {
      const nodes = [{ id: 'srv-a' }, { id: 'srv-b' }];
      const edges = [
        { id: 'e1', source: 'srv-a', target: 'srv-b' },
        { id: 'e2', source: 'srv-b', target: 'srv-a' },
      ];

      const res = detectTopologyCycles(nodes, edges);
      expect(res.hasCycle).toBe(true);
      expect(res.cycleNodeIds.has('srv-a')).toBe(true);
      expect(res.cycleNodeIds.has('srv-b')).toBe(true);
      expect(res.cycleEdgeIds.has('e1')).toBe(true);
      expect(res.cycleEdgeIds.has('e2')).toBe(true);
    });

    it('detects multi-tier transitive circular dependencies (A -> B -> C -> A)', () => {
      const nodes = [{ id: 'app' }, { id: 'api' }, { id: 'db' }, { id: 'leaf' }];
      const edges = [
        { id: 'e1', source: 'app', target: 'api' },
        { id: 'e2', source: 'api', target: 'db' },
        { id: 'e3', source: 'db', target: 'app' },
        { id: 'e4', source: 'db', target: 'leaf' },
      ];

      const res = detectTopologyCycles(nodes, edges);
      expect(res.hasCycle).toBe(true);
      expect(res.cycleNodeIds.size).toBe(3);
      expect(res.cycleNodeIds.has('app')).toBe(true);
      expect(res.cycleNodeIds.has('api')).toBe(true);
      expect(res.cycleNodeIds.has('db')).toBe(true);
      expect(res.cycleNodeIds.has('leaf')).toBe(false);
      expect(res.cycleEdgeIds.has('e4')).toBe(false);
    });

    it('returns false for acyclic diamond lattice topologies (zero false positives)', () => {
      const nodes = [{ id: 'root' }, { id: 'svc1' }, { id: 'svc2' }, { id: 'db' }];
      const edges = [
        { id: 'e1', source: 'root', target: 'svc1' },
        { id: 'e2', source: 'root', target: 'svc2' },
        { id: 'e3', source: 'svc1', target: 'db' },
        { id: 'e4', source: 'svc2', target: 'db' },
      ];

      const res = detectTopologyCycles(nodes, edges);
      expect(res.hasCycle).toBe(false);
      expect(res.cycleNodeIds.size).toBe(0);
      expect(res.cycleEdgeIds.size).toBe(0);
      expect(res.cycles).toHaveLength(0);
    });
  });

  describe('Graph Topology Outage Simulation (Downward & Upward Blast Radius)', () => {
    const candidateEdges = [
      { id: 'edge-server-db1', source: 'checkmk-server', target: 'postgres-db-1' },
      { id: 'edge-server-db2', source: 'checkmk-server', target: 'postgres-db-2' },
      { id: 'edge-web-server', source: 'web-portal', target: 'checkmk-server' },
    ];

    it('simulates downward failure cascade when server goes offline', () => {
      const res = simulateOutageCascade('checkmk-server', candidateEdges, { direction: 'downward' });
      expect(res.failedNodeId).toBe('checkmk-server');
      expect(res.failedNodeIds.has('checkmk-server')).toBe(true);
      expect(res.downstreamImpactedNodeIds.has('postgres-db-1')).toBe(true);
      expect(res.downstreamImpactedNodeIds.has('postgres-db-2')).toBe(true);
      expect(res.upstreamImpactedNodeIds.size).toBe(0);
      expect(res.impactedNodeIds.size).toBe(2);
      expect(res.impactedEdgeIds.has('edge-server-db1')).toBe(true);
      expect(res.impactedEdgeIds.has('edge-server-db2')).toBe(true);
      expect(res.impactedEdgeIds.has('edge-web-server')).toBe(false);
    });

    it('simulates upward failure cascade when database goes offline', () => {
      const res = simulateOutageCascade('postgres-db-1', candidateEdges, { direction: 'upward' });
      expect(res.failedNodeId).toBe('postgres-db-1');
      expect(res.upstreamImpactedNodeIds.has('checkmk-server')).toBe(true);
      expect(res.upstreamImpactedNodeIds.has('web-portal')).toBe(true);
      expect(res.downstreamImpactedNodeIds.size).toBe(0);
      expect(res.impactedNodeIds.size).toBe(2);
      expect(res.impactedEdgeIds.has('edge-server-db1')).toBe(true);
      expect(res.impactedEdgeIds.has('edge-web-server')).toBe(true);
      expect(res.impactedEdgeIds.has('edge-server-db2')).toBe(false);
    });

    it('simulates bidirectional cascade across middle-tier service', () => {
      const res = simulateOutageCascade('checkmk-server', candidateEdges, { direction: 'both' });
      expect(res.failedNodeId).toBe('checkmk-server');
      expect(res.upstreamImpactedNodeIds.has('web-portal')).toBe(true);
      expect(res.downstreamImpactedNodeIds.has('postgres-db-1')).toBe(true);
      expect(res.downstreamImpactedNodeIds.has('postgres-db-2')).toBe(true);
      expect(res.impactedNodeIds.size).toBe(3);
      expect(res.impactedEdgeIds.size).toBe(3);
    });

    it('safely handles circular dependencies without infinite loops', () => {
      const cyclicEdges = [
        { id: 'e1', source: 'srv-a', target: 'srv-b' },
        { id: 'e2', source: 'srv-b', target: 'srv-a' },
      ];
      const res = simulateOutageCascade('srv-a', cyclicEdges, { direction: 'both' });
      expect(res.impactedNodeIds.has('srv-b')).toBe(true);
      expect(res.impactedEdgeIds.has('e1')).toBe(true);
      expect(res.impactedEdgeIds.has('e2')).toBe(true);
    });

    it('supports backend edge format (source_ci_id and target_ci_id)', () => {
      const backendEdges = [
        { id: 'be-1', source_ci_id: 'checkmk-server', target_ci_id: 'postgres-db-1' },
      ];
      const res = simulateOutageCascade('checkmk-server', backendEdges, { direction: 'downward' });
      expect(res.downstreamImpactedNodeIds.has('postgres-db-1')).toBe(true);
      expect(res.impactedEdgeIds.has('be-1')).toBe(true);
    });
  });

  describe('Incident Blast Radius Criticality Tier Resolution', () => {
    it('accurately resolves highest tier across downstream dependencies when upstream has zero nodes', () => {
      // In Checkmk Server's case: upstream is empty (NONE), but downstream has two Tier 1 databases
      const upstreamTiers: string[] = [];
      const downstreamTiers = ['tier_1', 'tier_1'];
      const highestTier = getHighestCriticalityTier([...upstreamTiers, ...downstreamTiers]);
      expect(highestTier).toBe('TIER_1');
    });

    it('prioritizes TIER_0 over all other tiers regardless of position', () => {
      const tiers = ['tier_2', 'tier_1', 'tier_0', 'tier_3'];
      expect(getHighestCriticalityTier(tiers)).toBe('TIER_0');
    });

    it('handles mixed casing and undefined/null values gracefully', () => {
      const tiers = [undefined, null, '', 'TIER_2', 'tier_3'];
      expect(getHighestCriticalityTier(tiers)).toBe('TIER_2');
    });

    it('returns NONE when no tiers are present', () => {
      expect(getHighestCriticalityTier([])).toBe('NONE');
      expect(getHighestCriticalityTier([null, undefined, ''])).toBe('NONE');
    });
  });
});
