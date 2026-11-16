package http_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	adapterhttp "github.com/org/etcms-backend/internal/adapters/http"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/http/middleware"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpwardImpactTraversal(t *testing.T) {
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
			($1, 'Infrastructure Core', 'infra-core', 'Core Systems', 'Infra Lead', 'infra@example.com'),
			($2, 'Retail Banking App', 'retail-banking', 'Retail Dept', 'App Lead', 'retail@example.com')
	`, infraGroupID, appGroupID)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES
			($1, 'admin-graph@example.com', 'Graph Admin', 'platform_admin', $2)
	`, adminID, infraGroupID)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO user_owner_groups (user_id, owner_group_id)
		VALUES
			($1, $2),
			($1, $3)
	`, adminID, infraGroupID, appGroupID)
	require.NoError(t, err)

	// 2. Multi-tier Topology:
	// Host (tier_2) -> VM Cluster (tier_2) -> Database (tier_0)
	// Database <-[reads_from]- PaymentApp (tier_1) <-[depends_on]- WebBankingApp (tier_1) <-[depends_on]- RetailService (tier_0, business_service)
	// PaymentApp also reads from RedisCache (sibling dependency)
	// Database <-[reads_from]- OldDecommissionedApp (retired)
	hostID := uuid.New()
	clusterID := uuid.New()
	dbID := uuid.New()
	redisID := uuid.New()
	payAppID := uuid.New()
	webAppID := uuid.New()
	retailServiceID := uuid.New()
	retiredAppID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, itam_external_ref, class_metadata, created_at, updated_at)
		VALUES
			($1, 'blade-server-01', 'physical_host', 'prod', 'in_service', 'tier_2', $9, 'Infra Eng', '10.0.0.10', $11, NULL, '{}', $11, $11),
			($2, 'k8s-prod-cluster', 'vm_cluster', 'prod', 'in_service', 'tier_2', $9, 'Infra Eng', 'k8s.internal', $11, NULL, '{}', $11, $11),
			($3, 'aurora-master-db', 'database', 'prod', 'in_service', 'tier_0', $9, 'DBA Lead', 'pg.aurora.internal', $11, NULL, '{}', $11, $11),
			($4, 'redis-session-cache', 'database', 'prod', 'in_service', 'tier_2', $9, 'DBA Lead', 'redis.internal', $11, NULL, '{}', $11, $11),
			($5, 'payment-processor-svc', 'application', 'prod', 'in_service', 'tier_1', $10, 'Pay Lead', 'https://pay.svc', $11, NULL, '{}', $11, $11),
			($6, 'retail-web-portal', 'application', 'prod', 'in_service', 'tier_1', $10, 'Web Lead', 'https://retail.bank', $11, NULL, '{}', $11, $11),
			($7, 'retail-banking-offering', 'business_service', 'prod', 'in_service', 'tier_0', $10, 'Product Owner', NULL, $11, NULL, '{}', $11, $11),
			($8, 'legacy-batch-sync', 'application', 'prod', 'retired', 'tier_3', $10, 'Ex-Eng', 'batch.internal', $11, NULL, '{}', $11, $11)
	`, hostID, clusterID, dbID, redisID, payAppID, webAppID, retailServiceID, retiredAppID, infraGroupID, appGroupID, now)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at, created_at, updated_at)
		VALUES
			-- Compute hosting
			(gen_random_uuid(), $2, $1, 'hosted_on', 'confirmed', $9, $9, $10, $10, $10),
			(gen_random_uuid(), $3, $2, 'hosted_on', 'confirmed', $9, $9, $10, $10, $10),
			(gen_random_uuid(), $4, $2, 'hosted_on', 'confirmed', $9, $9, $10, $10, $10),
			-- Upstream consumption from Database
			(gen_random_uuid(), $5, $3, 'reads_from', 'confirmed', $9, $9, $10, $10, $10),
			-- Upstream consumption from Sibling Redis
			(gen_random_uuid(), $5, $4, 'reads_from', 'confirmed', $9, $9, $10, $10, $10),
			-- Application chain
			(gen_random_uuid(), $6, $5, 'connects_to', 'confirmed', $9, $9, $10, $10, $10),
			-- Business service dependency
			(gen_random_uuid(), $7, $6, 'depends_on', 'confirmed', $9, $9, $10, $10, $10),
			-- Retired app consumption
			(gen_random_uuid(), $8, $3, 'reads_from', 'confirmed', $9, $9, $10, $10, $10)
	`, hostID, clusterID, dbID, redisID, payAppID, webAppID, retailServiceID, retiredAppID, adminID, now)
	require.NoError(t, err)

	// 3. Deliberate Cyclic Subgraph for Cycle Termination Verification:
	// cyclicDB (tier_2) <-[reads_from]- cycleA <-[connects_to]- cycleB <-[connects_to]- cycleC <-[connects_to]- cycleA
	cyclicDBID := uuid.New()
	cycleAID := uuid.New()
	cycleBID := uuid.New()
	cycleCID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, itam_external_ref, class_metadata, created_at, updated_at)
		VALUES
			($1, 'cyclic-target-db', 'database', 'prod', 'in_service', 'tier_2', $5, 'DBA', 'cyclic.db', $6, NULL, '{}', $6, $6),
			($2, 'cyclic-node-a', 'application', 'prod', 'in_service', 'tier_1', $5, 'Dev A', 'a.internal', $6, NULL, '{}', $6, $6),
			($3, 'cyclic-node-b', 'application', 'prod', 'in_service', 'tier_2', $5, 'Dev B', 'b.internal', $6, NULL, '{}', $6, $6),
			($4, 'cyclic-node-c', 'application', 'prod', 'in_service', 'tier_3', $5, 'Dev C', 'c.internal', $6, NULL, '{}', $6, $6)
	`, cyclicDBID, cycleAID, cycleBID, cycleCID, appGroupID, now)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at, created_at, updated_at)
		VALUES
			(gen_random_uuid(), $2, $1, 'reads_from', 'confirmed', $5, $5, $6, $6, $6),
			(gen_random_uuid(), $3, $2, 'connects_to', 'confirmed', $5, $5, $6, $6, $6),
			(gen_random_uuid(), $4, $3, 'connects_to', 'confirmed', $5, $5, $6, $6, $6),
			-- Cycle closing edge: cycleA depends on cycleC
			(gen_random_uuid(), $2, $4, 'connects_to', 'confirmed', $5, $5, $6, $6, $6)
	`, cyclicDBID, cycleAID, cycleBID, cycleCID, adminID, now)
	require.NoError(t, err)

	// =========================================================================
	// Tests
	// =========================================================================

	t.Run("GET /api/v1/cis/{id}/impact-upward - 401 Unauthorized without auth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/impact-upward", dbID.String()), nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("GET /api/v1/cis/{id}/impact-upward - 404 Not Found for non-existent CI", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/impact-upward", uuid.New().String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("GET /api/v1/cis/{id}/impact-upward - Multi-tier upward impact traversal from Database", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/impact-upward", dbID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.UpwardImpactResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		// 1. Verify Start CI ID
		assert.Equal(t, dbID, resp.CiId)

		// 2. Highest Criticality Tier: tier_0 (from retail-banking-offering)
		require.NotNil(t, resp.HighestCriticalityTier)
		assert.Equal(t, gen.UpwardImpactResponseHighestCriticalityTier("tier_0"), *resp.HighestCriticalityTier)

		// 3. Impacted Applications (PaymentApp, WebBankingApp)
		appNames := make([]string, 0, len(resp.ImpactedApplications))
		for _, app := range resp.ImpactedApplications {
			appNames = append(appNames, app.Name)
			// Pinned ownership check
			assert.NotEmpty(t, app.Ownership.OwnerGroupName)
			assert.NotEmpty(t, app.Ownership.DepartmentName)
		}
		assert.Contains(t, appNames, "payment-processor-svc")
		assert.Contains(t, appNames, "retail-web-portal")
		assert.NotContains(t, appNames, "legacy-batch-sync", "retired app must be excluded by default")

		// 4. Impacted Business Services (Retail Banking Offering)
		require.Len(t, resp.ImpactedBusinessServices, 1)
		assert.Equal(t, "retail-banking-offering", resp.ImpactedBusinessServices[0].Name)

		// 5. Shared Sibling Dependencies: redis-session-cache supporting payment-processor-svc
		siblingNames := make([]string, 0, len(resp.SharedSiblingDependencies))
		for _, sib := range resp.SharedSiblingDependencies {
			siblingNames = append(siblingNames, sib.Name)
		}
		assert.Contains(t, siblingNames, "redis-session-cache")
		assert.NotContains(t, siblingNames, "aurora-master-db", "start CI should not be in sibling list")

		// 6. Edges annotated with handshake status
		assert.GreaterOrEqual(t, len(resp.Edges), 3)
		for _, edge := range resp.Edges {
			assert.Equal(t, gen.GraphEdgeHandshakeStatus("confirmed"), edge.HandshakeStatus)
		}
	})

	t.Run("GET /api/v1/cis/{id}/impact-upward - include_retired=true includes retired upstream CIs", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/impact-upward?include_retired=true", dbID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.UpwardImpactResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		foundRetired := false
		for _, app := range resp.ImpactedApplications {
			if app.Name == "legacy-batch-sync" {
				foundRetired = true
				assert.Equal(t, gen.CIEnvelopeLifecycleState("retired"), app.LifecycleState)
			}
		}
		assert.True(t, foundRetired, "expected legacy-batch-sync to be included when include_retired=true")
	})

	t.Run("GET /api/v1/cis/{id}/impact-upward - includes synced and out_of_sync CIs by default", func(t *testing.T) {
		syncedCIID := uuid.New()
		outOfSyncCIID := uuid.New()
		t.Cleanup(func() {
			_, _ = testPool.Exec(context.Background(), "DELETE FROM ci_edges WHERE source_ci_id IN ($1, $2) OR target_ci_id IN ($1, $2)", syncedCIID, outOfSyncCIID)
			_, _ = testPool.Exec(context.Background(), "DELETE FROM cis WHERE ci_id IN ($1, $2)", syncedCIID, outOfSyncCIID)
		})

		_, err := testPool.Exec(ctx, `
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, class_metadata, created_at, updated_at)
			VALUES
				($1, 'synced-consumer-app', 'application', 'prod', 'synced', 'tier_1', $3, 'Sync Lead', 'https://sync.internal', now(), '{}', now(), now()),
				($2, 'out-of-sync-worker', 'application', 'prod', 'out_of_sync', 'tier_2', $3, 'Worker Lead', 'https://worker.internal', now(), '{}', now(), now())
		`, syncedCIID, outOfSyncCIID, appGroupID)
		require.NoError(t, err)

		_, err = testPool.Exec(ctx, `
			INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at, created_at, updated_at)
			VALUES
				(gen_random_uuid(), $1, $3, 'reads_from', 'confirmed', $4, $4, now(), now(), now()),
				(gen_random_uuid(), $2, $1, 'connects_to', 'confirmed', $4, $4, now(), now(), now())
		`, syncedCIID, outOfSyncCIID, dbID, adminID)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/impact-upward", dbID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.UpwardImpactResponse
		err = json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		require.NotNil(t, resp.Nodes)
		nodeNames := make([]string, 0, len(*resp.Nodes))
		for _, n := range *resp.Nodes {
			nodeNames = append(nodeNames, n.Name)
		}
		assert.Contains(t, nodeNames, "synced-consumer-app", "expected synced CI to be included in upward traversal")
		assert.Contains(t, nodeNames, "out-of-sync-worker", "expected out_of_sync CI to be included in upward traversal")
	})

	t.Run("GET /api/v1/cis/{id}/impact-upward - Upward traversal from Physical Host reaches full stack", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/impact-upward", hostID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.UpwardImpactResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		// Reaches VM cluster, both DBs, both apps, and business service
		require.NotNil(t, resp.Nodes)
		nodeNames := make([]string, 0, len(*resp.Nodes))
		for _, n := range *resp.Nodes {
			nodeNames = append(nodeNames, n.Name)
		}
		assert.Contains(t, nodeNames, "k8s-prod-cluster")
		assert.Contains(t, nodeNames, "aurora-master-db")
		assert.Contains(t, nodeNames, "redis-session-cache")
		assert.Contains(t, nodeNames, "payment-processor-svc")
		assert.Contains(t, nodeNames, "retail-web-portal")
		assert.Contains(t, nodeNames, "retail-banking-offering")
	})

	t.Run("GET /api/v1/cis/{id}/impact-upward - Cycle termination and deduplication", func(t *testing.T) {
		start := time.Now()
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/impact-upward", cyclicDBID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		elapsed := time.Since(start)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Less(t, elapsed, 500*time.Millisecond, "cyclic traversal must terminate in <500ms, took %v", elapsed)

		var resp gen.UpwardImpactResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		// Reached all 3 cyclic nodes exactly once without infinite loop
		require.Len(t, resp.ImpactedApplications, 3)
		appNames := make([]string, 0, len(resp.ImpactedApplications))
		for _, app := range resp.ImpactedApplications {
			appNames = append(appNames, app.Name)
		}
		assert.Contains(t, appNames, "cyclic-node-a")
		assert.Contains(t, appNames, "cyclic-node-b")
		assert.Contains(t, appNames, "cyclic-node-c")

		// Highest criticality tier among A (tier_1), B (tier_2), C (tier_3) is tier_1
		require.NotNil(t, resp.HighestCriticalityTier)
		assert.Equal(t, gen.UpwardImpactResponseHighestCriticalityTier("tier_1"), *resp.HighestCriticalityTier)
	})
}
