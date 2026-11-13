package http_test

import (
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

func TestHybridSearchAndCIDetailAggregation(t *testing.T) {
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	now := time.Now().UTC()
	staleTime := now.Add(-75 * 24 * time.Hour) // >60 days old

	// 1. Seed Owner Groups & Users
	group1ID := uuid.New()
	group2ID := uuid.New()
	lead1ID := uuid.New()
	adminID := uuid.New()

	ctx := t.Context()
	_, err = testPool.Exec(ctx, `
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES
			($1, 'Core Platform', 'core-platform', 'Infrastructure', 'Platform Lead', 'plat-lead@example.com'),
			($2, 'Payments Team', 'payments-team', 'FinTech', 'Pay Lead', 'pay-lead@example.com')
	`, group1ID, group2ID)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES
			($1, 'plat-lead@example.com', 'Platform Lead', 'team_lead', $2),
			($3, 'admin@example.com', 'Admin User', 'platform_admin', $2)
	`, lead1ID, group1ID, adminID)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO user_owner_groups (user_id, owner_group_id)
		VALUES
			($1, $2),
			($3, $2),
			($3, $4)
	`, lead1ID, group1ID, adminID, group2ID)
	require.NoError(t, err)

	// 2. Seed Graph Hierarchy for Detail Aggregations:
	// dbCI (tier_0, group1) <-[reads_from]- apiCI (tier_1, group2) <-[depends_on]- webCI (tier_2, group2)
	dbCIID := uuid.New()
	apiCIID := uuid.New()
	webCIID := uuid.New()
	staleCIID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, itam_external_ref, class_metadata, created_at, updated_at)
		VALUES
			($1, 'aurora-pg-cluster', 'database', 'prod', 'in_service', 'tier_0', $4, 'Bob Infra', 'aurora.internal:5432', $8, NULL, '{"engine":"postgres"}', $8, $8),
			($2, 'payment-gateway-api', 'application', 'prod', 'in_service', 'tier_1', $5, 'Alice Pay', 'https://pay.internal/api', $8, NULL, '{"framework":"go"}', $8, $8),
			($3, 'checkout-web-frontend', 'application', 'prod', 'in_service', 'tier_2', $5, 'Alice Pay', 'https://checkout.internal', $8, NULL, '{"framework":"react"}', $8, $8),
			($6, 'legacy-stale-service', 'application', 'prod', 'in_service', 'tier_3', $4, 'Old Eng', 'stale.internal', $7, NULL, '{}', $7, $7)
	`, dbCIID, apiCIID, webCIID, group1ID, group2ID, staleCIID, staleTime, now)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at, created_at, updated_at)
		VALUES
			(gen_random_uuid(), $1, $2, 'reads_from', 'confirmed', $3, $3, $4, $4, $4),
			(gen_random_uuid(), $5, $1, 'depends_on', 'confirmed', $3, $3, $4, $4, $4),
			(gen_random_uuid(), $6, $2, 'connects_to', 'pending_confirmation', $3, NULL, NULL, $4, $4)
	`, apiCIID, dbCIID, adminID, now, webCIID, staleCIID)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_flags (id, ci_id, flagged_by, reason, status, created_at)
		VALUES
			(gen_random_uuid(), $1, $2, 'Stale endpoint needs port verification', 'open', $3)
	`, dbCIID, adminID, now)
	require.NoError(t, err)

	// =========================================================================
	// Part 1: GET /api/v1/cis/search
	// =========================================================================

	t.Run("GET /api/v1/cis/search - 401 Unauthorized without credentials", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/cis/search?q=payment", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("GET /api/v1/cis/search - Prefix search when length(q) < 3", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/cis/search?q=pa", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.CISearchResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, resp.Total, 1)

		found := false
		for _, item := range resp.Items {
			if item.Ci.Name == "payment-gateway-api" {
				found = true
				assert.Equal(t, float32(1.0), item.Score)
				// Pinned ownership check
				assert.Equal(t, group2ID, item.Ownership.OwnerGroupId)
				assert.Equal(t, "Payments Team", item.Ownership.OwnerGroupName)
				assert.Equal(t, "FinTech", item.Ownership.DepartmentName)
				assert.Equal(t, "Alice Pay", item.Ownership.TechnicalContact)
			}
		}
		assert.True(t, found, "expected prefix search to match 'payment-gateway-api'")
	})

	t.Run("GET /api/v1/cis/search - Trigram similarity search when length(q) >= 3", func(t *testing.T) {
		// Fuzzy query: "aurra" (typo for "aurora")
		req := httptest.NewRequest(http.MethodGet, "/api/v1/cis/search?q=aurra", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.CISearchResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, resp.Total, 1)

		found := false
		for _, item := range resp.Items {
			if item.Ci.Name == "aurora-pg-cluster" {
				found = true
				assert.Greater(t, item.Score, float32(0.1))
				assert.Equal(t, "Core Platform", item.Ownership.OwnerGroupName)
				assert.Equal(t, "Infrastructure", item.Ownership.DepartmentName)
			}
		}
		assert.True(t, found, "expected trigram search to match fuzzy 'aurra' to 'aurora-pg-cluster'")
	})

	t.Run("GET /api/v1/cis/search - Filters by ci_class and environment", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/cis/search?ci_class=database&environment=prod", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.CISearchResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		for _, item := range resp.Items {
			assert.Equal(t, gen.CIEnvelopeCiClass("database"), item.Ci.CiClass)
			assert.Equal(t, gen.CIEnvelopeEnvironment("prod"), item.Ci.Environment)
		}
	})

	t.Run("GET /api/v1/cis/search - 400 Bad Request on invalid cursor", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/cis/search?cursor=invalid-not-base64", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("GET /api/v1/cis/search - Keyset deterministic cursor pagination", func(t *testing.T) {
		// Page 1: limit=2
		req1 := httptest.NewRequest(http.MethodGet, "/api/v1/cis/search?limit=2", nil)
		req1.Header.Set("X-Dev-User-ID", adminID.String())
		rec1 := httptest.NewRecorder()
		router.ServeHTTP(rec1, req1)

		assert.Equal(t, http.StatusOK, rec1.Code)
		var page1 gen.CISearchResponse
		err := json.Unmarshal(rec1.Body.Bytes(), &page1)
		require.NoError(t, err)
		assert.Equal(t, 2, len(page1.Items))
		require.NotNil(t, page1.NextCursor)
		assert.NotEmpty(t, *page1.NextCursor)

		// Page 2: with cursor
		req2 := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/search?limit=2&cursor=%s", *page1.NextCursor), nil)
		req2.Header.Set("X-Dev-User-ID", adminID.String())
		rec2 := httptest.NewRecorder()
		router.ServeHTTP(rec2, req2)

		assert.Equal(t, http.StatusOK, rec2.Code)
		var page2 gen.CISearchResponse
		err = json.Unmarshal(rec2.Body.Bytes(), &page2)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, len(page2.Items), 1)

		// Assert zero overlap between page 1 and page 2
		seen := make(map[uuid.UUID]bool)
		for _, item := range page1.Items {
			seen[*item.Ci.CiId] = true
		}
		for _, item := range page2.Items {
			assert.False(t, seen[*item.Ci.CiId], "duplicate CI ID detected across cursor pagination pages")
		}
	})

	// =========================================================================
	// Part 2: GET /api/v1/cis/{id}
	// =========================================================================

	t.Run("GET /api/v1/cis/{id} - 404 Not Found for non-existent CI", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s", uuid.New().String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("GET /api/v1/cis/{id} - Returns aggregated detail, summaries, and verification status", func(t *testing.T) {
		// Detail for dbCI (aurora-pg-cluster):
		// Upstream dependents: payment-gateway-api (tier_1), checkout-web-frontend (tier_2), legacy-stale-service (tier_3)
		// Highest criticality tier upstream: tier_1
		// Pending edge count: 1 (legacy-stale-service connects_to aurora-pg-cluster)
		// Open flags: 1
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s", dbCIID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var detail gen.CIDetailResponse
		err := json.Unmarshal(rec.Body.Bytes(), &detail)
		require.NoError(t, err)

		// 1. CI Envelope & Pinned Ownership
		assert.Equal(t, dbCIID, *detail.Ci.CiId)
		assert.Equal(t, "aurora-pg-cluster", detail.Ci.Name)
		assert.Equal(t, group1ID, detail.Ownership.OwnerGroupId)
		assert.Equal(t, "Core Platform", detail.Ownership.OwnerGroupName)
		assert.Equal(t, "Infrastructure", detail.Ownership.DepartmentName)
		assert.Equal(t, "Bob Infra", detail.Ownership.TechnicalContact)

		// 2. Verification status
		assert.False(t, detail.VerificationStatus.IsStale)
		assert.Equal(t, 1, detail.VerificationStatus.PendingEdgeCount)
		assert.Equal(t, 1, detail.VerificationStatus.OpenFlagCount)

		// 3. Upward Summary
		assert.Equal(t, 2, detail.UpwardSummary.DirectDependentCount) // payment-gateway-api and legacy-stale-service
		assert.Equal(t, 3, detail.UpwardSummary.TotalUpstreamCount)    // + checkout-web-frontend
		require.NotNil(t, detail.UpwardSummary.HighestCriticalityTier)
		assert.Equal(t, gen.CIUpwardSummaryHighestCriticalityTier("tier_1"), *detail.UpwardSummary.HighestCriticalityTier)

		// 4. Downward Summary
		assert.Equal(t, 0, detail.DownwardSummary.DirectDependencyCount)
		assert.Equal(t, 0, detail.DownwardSummary.TotalDownstreamCount)
	})

	t.Run("GET /api/v1/cis/{id} - Accurately flags stale CI (>60 days unverified)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s", staleCIID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var detail gen.CIDetailResponse
		err := json.Unmarshal(rec.Body.Bytes(), &detail)
		require.NoError(t, err)

		assert.True(t, detail.VerificationStatus.IsStale, "expected CI unverified for 75 days to have is_stale: true")
	})

	// =========================================================================
	// Part 3: Scale & Latency Verification on 1,000 Seeded CIs (<100ms)
	// =========================================================================

	t.Run("GET /api/v1/cis/search - Latency <100ms on 1,000 Seeded CIs", func(t *testing.T) {
		// Bulk insert 1,000 CIs
		_, err := testPool.Exec(ctx, `
			INSERT INTO cis (
				ci_id, name, ci_class, environment, lifecycle_state, criticality_tier,
				owner_group_id, technical_contact, primary_endpoint, last_verified_at,
				itam_external_ref, class_metadata, created_at, updated_at
			)
			SELECT
				gen_random_uuid(),
				'perf-microservice-' || i,
				'application',
				'prod',
				'in_service',
				'tier_2',
				$1,
				'Perf Tester',
				'https://perf-' || i || '.internal.domain',
				now(),
				NULL,
				'{}'::jsonb,
				now(),
				now()
			FROM generate_series(1, 1000) AS i;
		`, group1ID)
		require.NoError(t, err)

		// Execute search and assert latency < 100ms
		req := httptest.NewRequest(http.MethodGet, "/api/v1/cis/search?q=perf-microservice-750", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		start := time.Now()
		router.ServeHTTP(rec, req)
		elapsed := time.Since(start)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Less(t, elapsed, 100*time.Millisecond, "expected search latency to be under 100ms, took %v", elapsed)

		var resp gen.CISearchResponse
		err = json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, resp.Total, 1)
		assert.Equal(t, "perf-microservice-750", resp.Items[0].Ci.Name)
	})
}
