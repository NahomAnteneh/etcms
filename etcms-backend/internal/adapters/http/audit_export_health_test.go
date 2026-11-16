package http_test

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestAuditExportAndHealthMetrics(t *testing.T) {
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	ctx := t.Context()
	now := time.Now().UTC().Truncate(time.Millisecond)
	staleVerifiedAt := now.Add(-75 * 24 * time.Hour) // 75 days ago (stale)
	freshVerifiedAt := now.Add(-10 * 24 * time.Hour) // 10 days ago (fresh)

	// 1. Seed Owner Groups
	group1ID := uuid.New()
	group2ID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES
			($1, 'Audit Core Team', 'audit-core-team', 'Platform', 'Core Lead', 'corelead-audit@example.com'),
			($2, 'Audit Mobile Team', 'audit-mobile-team', 'Mobile', 'Mobile Lead', 'moblead-audit@example.com')
	`, group1ID, group2ID)
	require.NoError(t, err)

	// 2. Seed Users
	teamLead1ID := uuid.New()
	teamLead2ID := uuid.New()
	adminUserID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES
			($1, 'lead1-audit@example.com', 'Core Lead', 'team_lead', $4),
			($2, 'lead2-audit@example.com', 'Mobile Lead', 'team_lead', $5),
			($3, 'admin-audit@example.com', 'Audit Admin', 'platform_admin', $4)
	`, teamLead1ID, teamLead2ID, adminUserID, group1ID, group2ID)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO user_owner_groups (user_id, owner_group_id)
		VALUES
			($1, $4),
			($2, $5),
			($3, $4)
	`, teamLead1ID, teamLead2ID, adminUserID, group1ID, group2ID)
	require.NoError(t, err)

	// 3. Seed CIs
	// appCI (fresh, in_service) -> dbCI (fresh, in_service, linked to appCI, NOT orphan)
	// orphanDbCI (stale, in_service, NO upstream links -> ORPHAN)
	appCIID := uuid.New()
	dbCIID := uuid.New()
	orphanDbCIID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO cis (
			ci_id, name, ci_class, environment, lifecycle_state, criticality_tier,
			owner_group_id, technical_contact, primary_endpoint, last_verified_at,
			itam_external_ref, class_metadata, created_at, updated_at
		) VALUES
			($1, 'audit-api-gateway', 'application', 'prod', 'in_service', 'tier_1',
			 $4, 'core-tech@example.com', 'https://gw.audit.internal', $5,
			 'ITAM-AUD-01', '{"tier": "gold"}'::jsonb, $5, $5),
			($2, 'audit-customer-db', 'database', 'prod', 'in_service', 'tier_1',
			 $4, 'core-db@example.com', 'postgres://db.audit.internal:5432', $5,
			 'ITAM-AUD-02', '{"engine": "pg"}'::jsonb, $5, $5),
			($3, 'audit-orphan-db', 'database', 'prod', 'in_service', 'tier_2',
			 $4, 'orphan-db@example.com', 'postgres://orphan.internal:5432', $6,
			 'ITAM-AUD-03', '{"engine": "pg"}'::jsonb, $6, $6)
	`, appCIID, dbCIID, orphanDbCIID, group1ID, freshVerifiedAt, staleVerifiedAt)
	require.NoError(t, err)

	// Link appCI -> dbCI
	edge1ID := uuid.New()
	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_edges (
			id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at, created_at
		) VALUES (
			$1, $2, $3, 'connects_to', 'confirmed', $4, $4, now(), now() - interval '2 days'
		)
	`, edge1ID, appCIID, dbCIID, teamLead1ID)
	require.NoError(t, err)

	// Seed 1 Pending edge targeting dbCI (pending confirmation for 5 days)
	pendingEdgeID := uuid.New()
	fiveDaysAgo := now.Add(-5 * 24 * time.Hour)
	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_edges (
			id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, created_at
		) VALUES (
			$1, $2, $3, 'reads_from', 'pending_confirmation', $4, $5
		)
	`, pendingEdgeID, appCIID, dbCIID, teamLead1ID, fiveDaysAgo)
	require.NoError(t, err)

	// Seed Closed Digest Cycle for Group 1 with 2 items: 1 actioned, 1 expired
	closedCycleID := uuid.New()
	cycleStart := now.Add(-30 * 24 * time.Hour)
	cycleEnd := now.Add(-15 * 24 * time.Hour)
	_, err = testPool.Exec(ctx, `
		INSERT INTO digest_cycles (id, owner_group_id, window_start, window_end, status, created_at, closed_at)
		VALUES ($1, $2, $3, $4, 'closed', $3, $4)
	`, closedCycleID, group1ID, cycleStart, cycleEnd)
	require.NoError(t, err)

	closedItem1ID := uuid.New()
	closedItem2ID := uuid.New()
	_, err = testPool.Exec(ctx, `
		INSERT INTO digest_items (id, cycle_id, ci_id, trigger_reason, status, actioned_at, action_type, created_at)
		VALUES
			($1, $3, $4, 'stale_verification', 'actioned', $6, 'verify', $5),
			($2, $3, $7, 'recent_change', 'expired', NULL, NULL, $5)
	`, closedItem1ID, closedItem2ID, closedCycleID, dbCIID, cycleStart, cycleEnd, orphanDbCIID)
	require.NoError(t, err)

	// Seed attacker user with formula injection name
	attackerID := uuid.New()
	_, err = testPool.Exec(ctx, `
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES ($1, 'attacker-audit@example.com', '=cmd|'' /C calc''!A0', 'team_lead', $2)
	`, attackerID, group1ID)
	require.NoError(t, err)

	// Seed Audit Logs for appCI:
	// 1. action: create by teamLead1
	// 2. action: update by attacker (with formula injection name)
	auditLog1ID := uuid.New()
	auditLog2ID := uuid.New()
	_, err = testPool.Exec(ctx, `
		INSERT INTO audit_logs (id, entity_type, entity_id, affected_owner_group_ids, actor_id, action, diff, created_at)
		VALUES
			($1, 'ci', $3, ARRAY[$4]::uuid[], $5, 'create', '{"name": "audit-api-gateway"}'::jsonb, $6),
			($2, 'ci', $3, ARRAY[$4]::uuid[], $7, 'update', '{"endpoint": "https://new.internal"}'::jsonb, $8)
	`, auditLog1ID, auditLog2ID, appCIID, group1ID, teamLead1ID, now.Add(-2*time.Hour), attackerID, now.Add(-1*time.Hour))
	require.NoError(t, err)

	// =========================================================================
	// 1. GET /api/v1/cis/{id}/audit-logs - Keyset Cursor Pagination & Auth
	// =========================================================================

	t.Run("GET /api/v1/cis/{id}/audit-logs - 401 Unauthorized without auth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/audit-logs", appCIID.String()), nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("GET /api/v1/cis/{id}/audit-logs - 404 Not Found for non-existent CI", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/audit-logs", uuid.New().String()), nil)
		req.Header.Set("X-Dev-User-ID", teamLead1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("GET /api/v1/cis/{id}/audit-logs - 200 OK returns timeline and verifies keyset pagination", func(t *testing.T) {
		// Fetch with limit=1 to get first page and cursor
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/audit-logs?limit=1", appCIID.String()), nil)
		req.Header.Set("X-Dev-User-ID", teamLead1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var page1 gen.CIAuditLogsResponse
		err := json.Unmarshal(rec.Body.Bytes(), &page1)
		require.NoError(t, err)

		assert.Equal(t, 2, page1.Total)
		require.Len(t, page1.Items, 1)
		assert.Equal(t, auditLog2ID, page1.Items[0].Id)
		assert.Equal(t, "update", page1.Items[0].Action)
		assert.Equal(t, "=cmd|' /C calc'!A0", page1.Items[0].ActorName)
		require.NotNil(t, page1.NextCursor)

		// Fetch page 2 using cursor
		req2 := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s/audit-logs?limit=1&cursor=%s", appCIID.String(), *page1.NextCursor), nil)
		req2.Header.Set("X-Dev-User-ID", teamLead1ID.String())
		rec2 := httptest.NewRecorder()
		router.ServeHTTP(rec2, req2)

		assert.Equal(t, http.StatusOK, rec2.Code)
		var page2 gen.CIAuditLogsResponse
		err = json.Unmarshal(rec2.Body.Bytes(), &page2)
		require.NoError(t, err)

		require.Len(t, page2.Items, 1)
		assert.Equal(t, auditLog1ID, page2.Items[0].Id)
		assert.Equal(t, "create", page2.Items[0].Action)
		assert.Nil(t, page2.NextCursor)
	})

	// =========================================================================
	// 2. GET /api/v1/audit-logs/export - RBAC, Streaming, Formula Sanitization
	// =========================================================================

	t.Run("GET /api/v1/audit-logs/export - 401 Unauthorized without auth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/audit-logs/export", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("GET /api/v1/audit-logs/export - 403 Forbidden when non-admin attempts global export", func(t *testing.T) {
		// teamLead1 attempts global export (no owner_group_id provided)
		req := httptest.NewRequest(http.MethodGet, "/api/v1/audit-logs/export", nil)
		req.Header.Set("X-Dev-User-ID", teamLead1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("GET /api/v1/audit-logs/export - 403 Forbidden when non-admin attempts foreign group export", func(t *testing.T) {
		// teamLead2 (Group 2) attempts export of Group 1
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/audit-logs/export?owner_group_id=%s", group1ID.String()), nil)
		req.Header.Set("X-Dev-User-ID", teamLead2ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("GET /api/v1/audit-logs/export - 200 OK CSV streaming with formula injection sanitization", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/audit-logs/export?owner_group_id=%s&format=csv", group1ID.String()), nil)
		req.Header.Set("X-Dev-User-ID", teamLead1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "text/csv", rec.Header().Get("Content-Type"))
		assert.Contains(t, rec.Header().Get("Content-Disposition"), "audit-logs.csv")

		csvReader := csv.NewReader(rec.Body)
		records, err := csvReader.ReadAll()
		require.NoError(t, err)

		require.GreaterOrEqual(t, len(records), 3) // Header + at least 2 rows
		header := records[0]
		assert.Equal(t, "id", header[0])
		assert.Equal(t, "created_at", header[1])
		assert.Equal(t, "action", header[2])

		// Assert formula injection sanitization:
		// Any field starting with =, +, -, @, \t, or \r is prefixed with a single quote '
		csvBody := rec.Body.String()
		_ = csvBody
		foundSanitized := false
		for _, row := range records[1:] {
			for _, cell := range row {
				// The update_ci diff contained `{"endpoint": "=cmd...`
				if strings.Contains(cell, "=cmd") {
					// Verify that the cell starts with a single quote or has single quote prefixing formula
					assert.True(t, strings.HasPrefix(cell, "'"), "Cell containing formula should be prefixed with single quote: %s", cell)
					foundSanitized = true
				}
			}
		}
		assert.True(t, foundSanitized, "Expected to find sanitized formula cell in exported CSV")
	})

	t.Run("GET /api/v1/audit-logs/export - 200 OK NDJSON streaming for Platform Admin", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/audit-logs/export?format=ndjson", nil)
		req.Header.Set("X-Dev-User-ID", adminUserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "application/x-ndjson", rec.Header().Get("Content-Type"))

		scanner := bufio.NewScanner(rec.Body)
		lineCount := 0
		for scanner.Scan() {
			line := scanner.Text()
			if strings.TrimSpace(line) == "" {
				continue
			}
			lineCount++
			var entry map[string]interface{}
			err := json.Unmarshal([]byte(line), &entry)
			require.NoError(t, err, "Each line in NDJSON stream must be valid JSON")
			assert.NotEmpty(t, entry["id"])
			assert.NotEmpty(t, entry["action"])
			assert.NotEmpty(t, entry["actor_email"])
		}
		require.NoError(t, scanner.Err())
		assert.GreaterOrEqual(t, lineCount, 2)
	})

	// =========================================================================
	// 3. POST /api/v1/admin/digests/trigger - Manual Scheduler Execution
	// =========================================================================

	t.Run("POST /api/v1/admin/digests/trigger - 401 Unauthorized without auth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/digests/trigger", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("POST /api/v1/admin/digests/trigger - 403 Forbidden for non-admin", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/digests/trigger", nil)
		req.Header.Set("X-Dev-User-ID", teamLead1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("POST /api/v1/admin/digests/trigger - 200 OK Platform Admin triggers scheduler", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/digests/trigger", nil)
		req.Header.Set("X-Dev-User-ID", adminUserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.DigestTriggerResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, "completed", resp.Status)
		assert.GreaterOrEqual(t, resp.CyclesProcessed, 2)
	})

	// =========================================================================
	// 4. GET /api/v1/health/metrics - Governance Health Metrics Calculations
	// =========================================================================

	t.Run("GET /api/v1/health/metrics - 401 Unauthorized without auth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/health/metrics", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("GET /api/v1/health/metrics - 404 Not Found for invalid owner group", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/health/metrics?owner_group_id=%s", uuid.New().String()), nil)
		req.Header.Set("X-Dev-User-ID", teamLead1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("GET /api/v1/health/metrics - 200 OK computes Freshness, Orphans, Pending Edges, and Digest Completion", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/health/metrics?owner_group_id=%s", group1ID.String()), nil)
		req.Header.Set("X-Dev-User-ID", teamLead1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var metrics gen.HealthMetricsResponse
		err := json.Unmarshal(rec.Body.Bytes(), &metrics)
		require.NoError(t, err)

		// 1. Freshness Rate Verification:
		// Group 1 has 3 CIs:
		// - appCI (fresh)
		// - dbCI (fresh)
		// - orphanDbCI (stale, 75 days ago)
		// Total in_service = 3, Fresh = 2, Stale = 1.
		// Freshness Rate = (2 / 3) * 100 = 66.666...%
		assert.Equal(t, 3, metrics.TotalInServiceCis)
		assert.Equal(t, 2, metrics.FreshCisCount)
		assert.Equal(t, 1, metrics.StaleCisCount)
		assert.InDelta(t, 66.67, float64(metrics.FreshnessRate), 0.5)

		// 2. Orphan CI Count:
		// Technical CIs in Group 1: dbCI (linked to appCI) and orphanDbCI (no upward paths).
		// dbCI reaches appCI (application), so NOT orphan.
		// orphanDbCI has no paths reaching an application/business_service -> ORPHAN!
		assert.Equal(t, 1, metrics.OrphanCiCount)

		// 3. Pending Edges:
		// 1 pending edge targeting orphanDbCI, age approx 5 days
		assert.Equal(t, 1, metrics.PendingEdgesCount)
		assert.InDelta(t, 5.0, float64(metrics.OldestPendingAgeDays), 0.5)

		// 4. Digest Completion Rate:
		// Closed cycle has 2 items: 1 actioned, 1 expired.
		// Total closed items = 2, Actioned = 1.
		// Completion Rate = (1 / 2) * 100 = 50.0%
		assert.Equal(t, 2, metrics.TotalClosedDigestItems)
		assert.Equal(t, 1, metrics.ActionedClosedDigestItems)
		assert.InDelta(t, 50.0, float64(metrics.DigestCompletionRate), 0.1)
	})

	t.Run("GET /api/v1/health/metrics - Global query computes overall metrics and per-group breakdowns", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/health/metrics", nil)
		req.Header.Set("X-Dev-User-ID", adminUserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var metrics gen.HealthMetricsResponse
		err := json.Unmarshal(rec.Body.Bytes(), &metrics)
		require.NoError(t, err)

		require.NotNil(t, metrics.Groups)
		assert.GreaterOrEqual(t, len(*metrics.Groups), 2)

		var foundGroup1 bool
		for _, g := range *metrics.Groups {
			if g.OwnerGroupId == group1ID {
				foundGroup1 = true
				assert.Equal(t, "Audit Core Team", g.OwnerGroupName)
				assert.Equal(t, 3, g.TotalInServiceCis)
				assert.Equal(t, 1, g.OrphanCiCount)
			}
		}
		assert.True(t, foundGroup1, "Expected to find Group 1 in breakdown list")
	})
}
