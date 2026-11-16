package http_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	adapterhttp "github.com/org/etcms-backend/internal/adapters/http"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/http/middleware"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDownwardDependenciesTraversal(t *testing.T) {
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	ctx := t.Context()
	now := time.Now().UTC()

	// 1. Seed Owner Groups & Users
	infraGroupID := uuid.New()
	appGroupID := uuid.New()
	adminID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES
			($1, 'Infrastructure Core Downward', 'infra-core-downward', 'Core Systems', 'Infra Lead', 'infra-down@example.com'),
			($2, 'Retail Banking App Downward', 'retail-banking-downward', 'Retail Dept', 'App Lead', 'retail-down@example.com')
	`, infraGroupID, appGroupID)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES
			($1, 'admin-downward@example.com', 'Downward Admin', 'platform_admin', $2)
	`, adminID, infraGroupID)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO user_owner_groups (user_id, owner_group_id)
		VALUES
			($1, $2),
			($1, $3)
	`, adminID, infraGroupID, appGroupID)
	require.NoError(t, err)

	// 2. Topology for Downward Traversal:
	// RetailService (business_service)
	//   -> depends_on -> WebApp (application)
	//     -> connects_to -> PayApp (application)
	//       -> reads_from -> DB (database)
	//       -> reads_from -> Cache (database)
	//         DB -> hosted_on -> K8sCluster (vm_cluster)
	//         Cache -> hosted_on -> K8sCluster (vm_cluster)  <-- K8sCluster has 2 distinct parents (DB and Cache)! Shared dependency!
	//           K8sCluster -> hosted_on -> BareMetalHost (physical_host)
	//       -> connects_to -> RetiredService (application, retired)
	retailServiceID := uuid.New()
	webAppID := uuid.New()
	payAppID := uuid.New()
	dbID := uuid.New()
	cacheID := uuid.New()
	k8sClusterID := uuid.New()
	bareMetalID := uuid.New()
	retiredServiceID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, itam_external_ref, class_metadata, created_at, updated_at)
		VALUES
			($1, 'down-retail-service', 'business_service', 'prod', 'in_service', 'tier_0', $9, 'Retail Owner', NULL, $11, NULL, '{}', $11, $11),
			($2, 'down-web-portal', 'application', 'prod', 'in_service', 'tier_1', $10, 'Web Lead', 'https://web.down', $11, NULL, '{}', $11, $11),
			($3, 'down-payment-svc', 'application', 'prod', 'in_service', 'tier_1', $10, 'Pay Lead', 'https://pay.down', $11, NULL, '{}', $11, $11),
			($4, 'down-master-db', 'database', 'prod', 'in_service', 'tier_0', $9, 'DBA', 'pg.down.internal', $11, NULL, '{}', $11, $11),
			($5, 'down-redis-cache', 'database', 'prod', 'in_service', 'tier_2', $9, 'DBA', 'redis.down.internal', $11, NULL, '{}', $11, $11),
			($6, 'down-k8s-cluster', 'vm_cluster', 'prod', 'in_service', 'tier_2', $9, 'Infra Lead', 'k8s.down.internal', $11, NULL, '{}', $11, $11),
			($7, 'down-baremetal-host', 'physical_host', 'prod', 'in_service', 'tier_2', $9, 'Infra Lead', '10.20.0.1', $11, NULL, '{}', $11, $11),
			($8, 'down-retired-audit', 'application', 'prod', 'retired', 'tier_3', $10, 'Audit Lead', 'audit.down.internal', $11, NULL, '{}', $11, $11)
	`, retailServiceID, webAppID, payAppID, dbID, cacheID, k8sClusterID, bareMetalID, retiredServiceID, infraGroupID, appGroupID, now)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at, created_at, updated_at)
		VALUES
			(gen_random_uuid(), $1, $2, 'depends_on', 'confirmed', $9, $9, $10, $10, $10),
			(gen_random_uuid(), $2, $3, 'connects_to', 'confirmed', $9, $9, $10, $10, $10),
			(gen_random_uuid(), $3, $4, 'reads_from', 'confirmed', $9, $9, $10, $10, $10),
			(gen_random_uuid(), $3, $5, 'reads_from', 'confirmed', $9, $9, $10, $10, $10),
			(gen_random_uuid(), $4, $6, 'hosted_on', 'confirmed', $9, $9, $10, $10, $10),
			(gen_random_uuid(), $5, $6, 'hosted_on', 'confirmed', $9, $9, $10, $10, $10),
			(gen_random_uuid(), $6, $7, 'hosted_on', 'confirmed', $9, $9, $10, $10, $10),
			(gen_random_uuid(), $3, $8, 'connects_to', 'confirmed', $9, $9, $10, $10, $10)
	`, retailServiceID, webAppID, payAppID, dbID, cacheID, k8sClusterID, bareMetalID, retiredServiceID, adminID, now)
	require.NoError(t, err)

	// 3. Deliberate Cyclic Subgraph for Downward Traversal:
	// cycleSource -> cycleA -> cycleB -> cycleC -> cycleA
	cyclicSourceID := uuid.New()
	cycleAID := uuid.New()
	cycleBID := uuid.New()
	cycleCID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, itam_external_ref, class_metadata, created_at, updated_at)
		VALUES
			($1, 'cycle-down-source', 'application', 'prod', 'in_service', 'tier_1', $5, 'Dev', 'src.cycle', $6, NULL, '{}', $6, $6),
			($2, 'cycle-down-node-a', 'application', 'prod', 'in_service', 'tier_1', $5, 'Dev A', 'a.cycle', $6, NULL, '{}', $6, $6),
			($3, 'cycle-down-node-b', 'application', 'prod', 'in_service', 'tier_2', $5, 'Dev B', 'b.cycle', $6, NULL, '{}', $6, $6),
			($4, 'cycle-down-node-c', 'application', 'prod', 'in_service', 'tier_3', $5, 'Dev C', 'c.cycle', $6, NULL, '{}', $6, $6)
	`, cyclicSourceID, cycleAID, cycleBID, cycleCID, appGroupID, now)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at, created_at, updated_at)
		VALUES
			(gen_random_uuid(), $1, $2, 'connects_to', 'confirmed', $5, $5, $6, $6, $6),
			(gen_random_uuid(), $2, $3, 'connects_to', 'confirmed', $5, $5, $6, $6, $6),
			(gen_random_uuid(), $3, $4, 'connects_to', 'confirmed', $5, $5, $6, $6, $6),
			(gen_random_uuid(), $4, $2, 'connects_to', 'confirmed', $5, $5, $6, $6, $6)
	`, cyclicSourceID, cycleAID, cycleBID, cycleCID, adminID, now)
	require.NoError(t, err)

	// =========================================================================
	// Tests
	// =========================================================================

	t.Run("GET /api/v1/cis/{id}/dependencies-downward - 401 Unauthorized without auth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/dependencies-downward", retailServiceID.String()), nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("GET /api/v1/cis/{id}/dependencies-downward - 404 Not Found for non-existent CI", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/dependencies-downward", uuid.New().String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("GET /api/v1/cis/{id}/dependencies-downward - Multi-tier downward traversal and shared dependency math", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/dependencies-downward", retailServiceID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.DownwardDependenciesResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		// 1. Verify Start CI ID and count
		assert.Equal(t, retailServiceID, resp.CiId)
		assert.Equal(t, 6, resp.TotalDependencies) // web, pay, db, cache, cluster, baremetal (retired excluded)
		assert.Len(t, resp.Nodes, 6)

		// 2. Verify Visited Nodes & Depths
		nodeMap := make(map[string]gen.DownwardDependencyNode)
		for _, n := range resp.Nodes {
			nodeMap[n.Ci.Name] = n
			assert.NotEmpty(t, n.Ci.Ownership.OwnerGroupName)
			assert.NotEmpty(t, n.Ci.Ownership.DepartmentName)
		}

		assert.Contains(t, nodeMap, "down-web-portal")
		assert.Equal(t, 1, nodeMap["down-web-portal"].Depth)
		assert.Equal(t, 1, nodeMap["down-web-portal"].SubgraphInDegree)
		assert.False(t, nodeMap["down-web-portal"].IsSharedDependency)

		assert.Contains(t, nodeMap, "down-payment-svc")
		assert.Equal(t, 2, nodeMap["down-payment-svc"].Depth)
		assert.Equal(t, 1, nodeMap["down-payment-svc"].SubgraphInDegree)
		assert.False(t, nodeMap["down-payment-svc"].IsSharedDependency)

		assert.Contains(t, nodeMap, "down-master-db")
		assert.Equal(t, 3, nodeMap["down-master-db"].Depth)
		assert.Equal(t, 1, nodeMap["down-master-db"].SubgraphInDegree)
		assert.False(t, nodeMap["down-master-db"].IsSharedDependency)

		assert.Contains(t, nodeMap, "down-redis-cache")
		assert.Equal(t, 3, nodeMap["down-redis-cache"].Depth)
		assert.Equal(t, 1, nodeMap["down-redis-cache"].SubgraphInDegree)
		assert.False(t, nodeMap["down-redis-cache"].IsSharedDependency)

		// 3. Shared Dependency: down-k8s-cluster has 2 parents (down-master-db, down-redis-cache)
		assert.Contains(t, nodeMap, "down-k8s-cluster")
		assert.Equal(t, 4, nodeMap["down-k8s-cluster"].Depth)
		assert.Equal(t, 2, nodeMap["down-k8s-cluster"].SubgraphInDegree)
		assert.True(t, nodeMap["down-k8s-cluster"].IsSharedDependency)

		assert.Contains(t, nodeMap, "down-baremetal-host")
		assert.Equal(t, 5, nodeMap["down-baremetal-host"].Depth)
		assert.Equal(t, 1, nodeMap["down-baremetal-host"].SubgraphInDegree)
		assert.False(t, nodeMap["down-baremetal-host"].IsSharedDependency)

		// 4. Verify SharedDependencies list
		require.NotNil(t, resp.SharedDependencies)
		require.Len(t, *resp.SharedDependencies, 1)
		assert.Equal(t, "down-k8s-cluster", (*resp.SharedDependencies)[0].Ci.Name)

		// 5. Verify Retired node excluded by default
		assert.NotContains(t, nodeMap, "down-retired-audit")

		// 6. Connecting Edges in Subgraph
		assert.GreaterOrEqual(t, len(resp.Edges), 6)
	})

	t.Run("GET /api/v1/cis/{id}/dependencies-downward - include_retired=true includes retired dependencies", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/dependencies-downward?include_retired=true", retailServiceID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.DownwardDependenciesResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		foundRetired := false
		for _, n := range resp.Nodes {
			if n.Ci.Name == "down-retired-audit" {
				foundRetired = true
				assert.Equal(t, gen.CIEnvelopeLifecycleState("retired"), n.Ci.LifecycleState)
			}
		}
		assert.True(t, foundRetired, "expected down-retired-audit to be present when include_retired=true")
	})

	t.Run("GET /api/v1/cis/{id}/dependencies-downward - includes synced and out_of_sync dependencies by default", func(t *testing.T) {
		syncedDepID := uuid.New()
		outOfSyncDepID := uuid.New()
		t.Cleanup(func() {
			_, _ = testPool.Exec(context.Background(), "DELETE FROM ci_edges WHERE source_ci_id IN ($1, $2) OR target_ci_id IN ($1, $2)", syncedDepID, outOfSyncDepID)
			_, _ = testPool.Exec(context.Background(), "DELETE FROM cis WHERE ci_id IN ($1, $2)", syncedDepID, outOfSyncDepID)
		})

		_, err := testPool.Exec(ctx, `
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, class_metadata, created_at, updated_at)
			VALUES
				($1, 'down-synced-dep', 'database', 'prod', 'synced', 'tier_1', $3, 'Sync DBA', 'pg.synced.internal', now(), '{}', now(), now()),
				($2, 'down-out-of-sync-dep', 'database', 'prod', 'out_of_sync', 'tier_2', $3, 'Worker DBA', 'redis.sync.internal', now(), '{}', now(), now())
		`, syncedDepID, outOfSyncDepID, infraGroupID)
		require.NoError(t, err)

		_, err = testPool.Exec(ctx, `
			INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at, created_at, updated_at)
			VALUES
				(gen_random_uuid(), $1, $2, 'reads_from', 'confirmed', $4, $4, now(), now(), now()),
				(gen_random_uuid(), $2, $3, 'connects_to', 'confirmed', $4, $4, now(), now(), now())
		`, payAppID, syncedDepID, outOfSyncDepID, adminID)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/dependencies-downward", retailServiceID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.DownwardDependenciesResponse
		err = json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		nodeNames := make([]string, 0, len(resp.Nodes))
		for _, n := range resp.Nodes {
			nodeNames = append(nodeNames, n.Ci.Name)
		}
		assert.Contains(t, nodeNames, "down-synced-dep", "expected down-synced-dep to be included in downward traversal")
		assert.Contains(t, nodeNames, "down-out-of-sync-dep", "expected down-out-of-sync-dep to be included in downward traversal")
	})

	t.Run("GET /api/v1/cis/{id}/dependencies-downward - Cyclic graph termination", func(t *testing.T) {
		start := time.Now()
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/dependencies-downward", cyclicSourceID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		elapsed := time.Since(start)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Less(t, elapsed, 500*time.Millisecond, "cyclic downward traversal must terminate in <500ms, took %v", elapsed)

		var resp gen.DownwardDependenciesResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		// Reached cycle-down-node-a, b, c
		assert.Equal(t, 3, resp.TotalDependencies)
		assert.Len(t, resp.Nodes, 3)

		// In the cyclic graph: cycle-down-node-a has 2 parents: cyclicSourceID AND cycle-down-node-c!
		for _, n := range resp.Nodes {
			if n.Ci.Name == "cycle-down-node-a" {
				assert.Equal(t, 2, n.SubgraphInDegree)
				assert.True(t, n.IsSharedDependency)
			}
		}
	})
}

// =========================================================================
// Benchmark Gate: 1,000-CI / 2,500-Edge Graph with 10-layer Diamond Lattice
// =========================================================================

func seedDiamondLattice1000CIs2500Edges(ctx context.Context, pool *pgxpool.Pool) (rootCIID, bottomCIID, adminID uuid.UUID, err error) {
	now := time.Now().UTC()
	benchGroupID := uuid.New()
	adminID = uuid.New()

	_, err = pool.Exec(ctx, `
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES ($1, 'Diamond Bench Group', 'diamond-bench', 'Perf Dept', 'Bench Lead', 'bench@example.com')
	`, benchGroupID)
	if err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, fmt.Errorf("failed to insert bench group: %w", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES ($1, 'bench-admin@example.com', 'Bench Admin', 'platform_admin', $2)
	`, adminID, benchGroupID)
	if err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, fmt.Errorf("failed to insert bench user: %w", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO user_owner_groups (user_id, owner_group_id)
		VALUES ($1, $2)
	`, adminID, benchGroupID)
	if err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, fmt.Errorf("failed to insert user_owner_group: %w", err)
	}

	// 1. Build 10-Layer Diamond Lattice:
	// Layer 0: 1 node (root)
	// Layers 1..9: 10 nodes each = 90 nodes
	// Layer 10: 1 node (bottom)
	// Total diamond nodes = 92 nodes
	layers := make([][]uuid.UUID, 11)
	rootCIID = uuid.New()
	layers[0] = []uuid.UUID{rootCIID}

	for l := 1; l <= 9; l++ {
		layers[l] = make([]uuid.UUID, 10)
		for k := 0; k < 10; k++ {
			layers[l][k] = uuid.New()
		}
	}
	bottomCIID = uuid.New()
	layers[10] = []uuid.UUID{bottomCIID}

	// 2. Extra CIs: 1,000 - 92 = 908 CIs
	extraCIs := make([]uuid.UUID, 908)
	for i := 0; i < 908; i++ {
		extraCIs[i] = uuid.New()
	}

	// Bulk insert all 1,000 CIs in chunks or single batch
	// Total 1,000 CIs
	ciIDs := make([]uuid.UUID, 0, 1000)
	ciNames := make([]string, 0, 1000)
	ciClasses := make([]string, 0, 1000)

	// Layer 0: root application
	ciIDs = append(ciIDs, rootCIID)
	ciNames = append(ciNames, "diamond-l0-root")
	ciClasses = append(ciClasses, "application")

	for l := 1; l <= 9; l++ {
		for k := 0; k < 10; k++ {
			ciIDs = append(ciIDs, layers[l][k])
			ciNames = append(ciNames, fmt.Sprintf("diamond-l%d-node-%d", l, k))
			ciClasses = append(ciClasses, "application")
		}
	}

	// Layer 10: bottom database
	ciIDs = append(ciIDs, bottomCIID)
	ciNames = append(ciNames, "diamond-l10-bottom")
	ciClasses = append(ciClasses, "database")

	// Extra 908 CIs
	for i := 0; i < 908; i++ {
		ciIDs = append(ciIDs, extraCIs[i])
		ciNames = append(ciNames, fmt.Sprintf("extra-ci-%d", i+1))
		ciClasses = append(ciClasses, "database")
	}

	// Insert all 1,000 CIs
	_, err = pool.Exec(ctx, `
		INSERT INTO cis (
			ci_id, name, ci_class, environment, lifecycle_state, criticality_tier,
			owner_group_id, technical_contact, primary_endpoint, last_verified_at,
			itam_external_ref, class_metadata, created_at, updated_at
		)
		SELECT
			t.ci_id,
			t.name,
			t.ci_class::ci_class_enum,
			'prod',
			'in_service',
			'tier_1',
			$1,
			'Bench Lead',
			'https://bench.internal',
			$2,
			NULL,
			'{}'::jsonb,
			$2,
			$2
		FROM unnest($3::uuid[], $4::text[], $5::text[]) AS t(ci_id, name, ci_class)
	`, benchGroupID, now, ciIDs, ciNames, ciClasses)
	if err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, fmt.Errorf("failed to bulk insert 1,000 CIs: %w", err)
	}

	// 3. Build 2,500 Edges:
	// A. Diamond lattice edges:
	//    - Layer 0 -> Layer 1 (10 edges)
	//    - Layer l -> Layer l+1 for l in 1..8 (8 * 10 * 10 = 800 edges)
	//    - Layer 9 -> Layer 10 (10 edges)
	//    Total diamond edges = 820 edges
	// B. Deliberate cycle edges: 10 edges
	// C. Extra edges: 1,670 edges
	//    Total edges = 820 + 10 + 1670 = 2,500 edges
	sourceIDs := make([]uuid.UUID, 0, 2500)
	targetIDs := make([]uuid.UUID, 0, 2500)

	// A. Diamond edges
	for k := 0; k < 10; k++ {
		sourceIDs = append(sourceIDs, layers[0][0])
		targetIDs = append(targetIDs, layers[1][k])
	}
	for l := 1; l <= 8; l++ {
		for srcIdx := 0; srcIdx < 10; srcIdx++ {
			for tgtIdx := 0; tgtIdx < 10; tgtIdx++ {
				sourceIDs = append(sourceIDs, layers[l][srcIdx])
				targetIDs = append(targetIDs, layers[l+1][tgtIdx])
			}
		}
	}
	for k := 0; k < 10; k++ {
		sourceIDs = append(sourceIDs, layers[9][k])
		targetIDs = append(targetIDs, layers[10][0])
	}

	// B. Cycle edges (10 edges backward)
	cycleEdges := [][2]int{
		{5, 3}, {5, 2}, {7, 4}, {7, 3}, {9, 2},
		{9, 1}, {4, 1}, {6, 2}, {8, 3}, {10, 5},
	}
	for _, ce := range cycleEdges {
		srcLayer := ce[0]
		tgtLayer := ce[1]
		sourceIDs = append(sourceIDs, layers[srcLayer][0])
		targetIDs = append(targetIDs, layers[tgtLayer][0])
	}

	// C. Extra edges: exactly 1,670 edges
	// Chain 1: 907 edges among extra CIs (i -> i+1)
	for i := 0; i < 907; i++ {
		sourceIDs = append(sourceIDs, extraCIs[i])
		targetIDs = append(targetIDs, extraCIs[i+1])
	}
	// Chain 2: 763 edges among extra CIs (i -> i+2)
	for i := 0; i < 763; i++ {
		sourceIDs = append(sourceIDs, extraCIs[i])
		targetIDs = append(targetIDs, extraCIs[i+2])
	}

	if len(sourceIDs) != 2500 {
		return uuid.Nil, uuid.Nil, uuid.Nil, fmt.Errorf("expected exactly 2,500 edges, got %d", len(sourceIDs))
	}

	// Bulk insert all 2,500 edges
	_, err = pool.Exec(ctx, `
		INSERT INTO ci_edges (
			id, source_ci_id, target_ci_id, edge_type, handshake_status,
			created_by, confirmed_by, confirmed_at, created_at, updated_at
		)
		SELECT
			gen_random_uuid(),
			t.src,
			t.tgt,
			'connects_to',
			'confirmed',
			$1,
			$1,
			$2,
			$2,
			$2
		FROM unnest($3::uuid[], $4::uuid[]) AS t(src, tgt)
	`, adminID, now, sourceIDs, targetIDs)
	if err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, fmt.Errorf("failed to bulk insert 2,500 edges: %w", err)
	}

	// Update PostgreSQL query planner statistics
	_, _ = pool.Exec(ctx, `ANALYZE cis; ANALYZE ci_edges; ANALYZE owner_groups;`)

	return rootCIID, bottomCIID, adminID, nil

}

func TestDiamondLatticeScaleAndLatency(t *testing.T) {
	ctx := t.Context()
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	// Seed 1,000 CIs and 2,500 edges with 10-layer diamond lattice + cycle edges
	seedStart := time.Now()
	rootCIID, bottomCIID, adminID, err := seedDiamondLattice1000CIs2500Edges(ctx, testPool)
	require.NoError(t, err)
	t.Logf("Seeded 1,000 CIs and 2,500 edges in %v", time.Since(seedStart))

	// Warmup runs
	warmupDown := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/dependencies-downward", rootCIID.String()), nil)
	warmupDown.Header.Set("X-Dev-User-ID", adminID.String())
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, warmupDown)
	require.Equal(t, http.StatusOK, rec.Code)

	warmupUp := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/impact-upward", bottomCIID.String()), nil)
	warmupUp.Header.Set("X-Dev-User-ID", adminID.String())
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, warmupUp)
	require.Equal(t, http.StatusOK, rec.Code)

	// Benchmark Gate: 20 iterations for Downward Traversal
	const iterations = 20
	downwardLatencies := make([]time.Duration, iterations)
	for i := 0; i < iterations; i++ {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/dependencies-downward", rootCIID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		start := time.Now()
		router.ServeHTTP(rec, req)
		downwardLatencies[i] = time.Since(start)

		require.Equal(t, http.StatusOK, rec.Code)
	}

	// Benchmark Gate: 20 iterations for Upward Traversal
	upwardLatencies := make([]time.Duration, iterations)
	for i := 0; i < iterations; i++ {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/impact-upward", bottomCIID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		start := time.Now()
		router.ServeHTTP(rec, req)
		upwardLatencies[i] = time.Since(start)

		require.Equal(t, http.StatusOK, rec.Code)
	}

	// Compute p95 latency
	sort.Slice(downwardLatencies, func(i, j int) bool { return downwardLatencies[i] < downwardLatencies[j] })
	sort.Slice(upwardLatencies, func(i, j int) bool { return upwardLatencies[i] < upwardLatencies[j] })

	p95Idx := int(float64(iterations)*0.95) - 1
	if p95Idx < 0 {
		p95Idx = 0
	}
	downwardP95 := downwardLatencies[p95Idx]
	upwardP95 := upwardLatencies[p95Idx]

	t.Logf("Diamond Lattice Traversal Results (1,000 CIs / 2,500 Edges):")
	t.Logf("  Downward Traversal p95: %v (min: %v, max: %v)", downwardP95, downwardLatencies[0], downwardLatencies[iterations-1])
	t.Logf("  Upward Traversal p95:   %v (min: %v, max: %v)", upwardP95, upwardLatencies[0], upwardLatencies[iterations-1])

	// Assert Benchmark Gate: p95 latency < 500ms
	assert.Less(t, downwardP95, 500*time.Millisecond, "downward traversal p95 latency must be <500ms")
	assert.Less(t, upwardP95, 500*time.Millisecond, "upward traversal p95 latency must be <500ms")
}

func BenchmarkDiamondLatticeTraversal(b *testing.B) {
	ctx := context.Background()
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	if err != nil {
		b.Fatalf("failed to create router: %v", err)
	}

	rootCIID, bottomCIID, adminID, err := seedDiamondLattice1000CIs2500Edges(ctx, testPool)
	if err != nil {
		b.Fatalf("failed to seed diamond lattice: %v", err)
	}

	b.Run("DownwardTraversal", func(b *testing.B) {
		reqURL := fmt.Sprintf("/api/v1/cis/%s/dependencies-downward", rootCIID.String())
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			req := httptest.NewRequest(http.MethodGet, reqURL, nil)
			req.Header.Set("X-Dev-User-ID", adminID.String())
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				b.Fatalf("expected status 200, got %d", rec.Code)
			}
		}
	})

	b.Run("UpwardTraversal", func(b *testing.B) {
		reqURL := fmt.Sprintf("/api/v1/cis/%s/impact-upward", bottomCIID.String())
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			req := httptest.NewRequest(http.MethodGet, reqURL, nil)
			req.Header.Set("X-Dev-User-ID", adminID.String())
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				b.Fatalf("expected status 200, got %d", rec.Code)
			}
		}
	})
}
