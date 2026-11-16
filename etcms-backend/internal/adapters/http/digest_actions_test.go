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

func TestDigestActionsAndRetirement(t *testing.T) {
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	ctx := t.Context()
	now := time.Now().UTC().Truncate(time.Millisecond)
	staleVerifiedAt := now.Add(-70 * 24 * time.Hour) // 70 days ago (stale)

	// 1. Seed Owner Groups
	ownerGroup1ID := uuid.New()
	ownerGroup2ID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES
			($1, 'Digest Payments Team', 'digest-act-payments', 'Engineering', 'Pay Lead', 'paylead-digest@example.com'),
			($2, 'Digest Analytics Team', 'digest-act-analytics', 'Data', 'Data Lead', 'datalead-digest@example.com')
	`, ownerGroup1ID, ownerGroup2ID)
	require.NoError(t, err)

	// 2. Seed Users
	user1ID := uuid.New()
	user2ID := uuid.New()
	adminUserID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES
			($1, 'lead1-digest@example.com', 'Pay Lead', 'team_lead', $4),
			($2, 'lead2-digest@example.com', 'Data Lead', 'team_lead', $5),
			($3, 'admin-digest@example.com', 'Admin Lead', 'platform_admin', $4)
	`, user1ID, user2ID, adminUserID, ownerGroup1ID, ownerGroup2ID)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO user_owner_groups (user_id, owner_group_id)
		VALUES
			($1, $4),
			($2, $5),
			($3, $4)
	`, user1ID, user2ID, adminUserID, ownerGroup1ID, ownerGroup2ID)
	require.NoError(t, err)

	// 3. Seed CIs
	// CI Parent (Application) -> depends on CI Database
	ciParentID := uuid.New()
	ciDatabaseID := uuid.New()
	ciLeafID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO cis (
			ci_id, name, ci_class, environment, lifecycle_state, criticality_tier,
			owner_group_id, technical_contact, primary_endpoint, last_verified_at,
			itam_external_ref, class_metadata, created_at, updated_at
		) VALUES
			($1, 'digest-act-gateway-app', 'application', 'prod', 'in_service', 'tier_1',
			 $4, 'pay-app@example.com', 'https://gateway.internal', $5,
			 'ITAM-DA-01', '{"framework": "go"}'::jsonb, $5, $5),
			($2, 'digest-act-postgres-db', 'database', 'prod', 'in_service', 'tier_1',
			 $4, 'pay-db@example.com', 'postgres://db.internal:5432', $6,
			 'ITAM-DA-02', '{"engine": "postgres"}'::jsonb, $6, $6),
			($3, 'digest-act-worker-vm', 'vm_cluster', 'prod', 'in_service', 'tier_2',
			 $4, 'pay-vm@example.com', 'https://vm.internal', $5,
			 'ITAM-DA-03', '{"nodes": "3"}'::jsonb, $5, $5)
	`, ciParentID, ciDatabaseID, ciLeafID, ownerGroup1ID, now, staleVerifiedAt)
	require.NoError(t, err)

	// 4. Seed Edge: CI Parent depends on CI Database
	edgeID := uuid.New()
	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_edges (
			id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at
		) VALUES (
			$1, $2, $3, 'depends_on', 'confirmed', $4, $4, now()
		)
	`, edgeID, ciParentID, ciDatabaseID, user1ID)
	require.NoError(t, err)

	// 5. Seed Open Flag on CI Database
	flagID := uuid.New()
	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_flags (
			id, ci_id, flagged_by, reason, status, created_at
		) VALUES (
			$1, $2, $3, 'Database credentials rotation required immediately', 'open', now()
		)
	`, flagID, ciDatabaseID, user2ID)
	require.NoError(t, err)

	// 6. Seed Open Digest Cycle for Group 1 with items for Database and Leaf
	cycleID := uuid.New()
	windowStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	windowEnd := time.Date(now.Year(), now.Month(), 15, 0, 0, 0, 0, time.UTC)

	_, err = testPool.Exec(ctx, `
		INSERT INTO digest_cycles (id, owner_group_id, window_start, window_end, status, created_at)
		VALUES ($1, $2, $3, $4, 'open', now())
	`, cycleID, ownerGroup1ID, windowStart, windowEnd)
	require.NoError(t, err)

	digestItem1ID := uuid.New()
	digestItem2ID := uuid.New()
	_, err = testPool.Exec(ctx, `
		INSERT INTO digest_items (id, cycle_id, ci_id, trigger_reason, status, created_at)
		VALUES
			($1, $3, $4, 'open_flag', 'open', now()),
			($2, $3, $5, 'recent_change', 'open', now())
	`, digestItem1ID, digestItem2ID, cycleID, ciDatabaseID, ciLeafID)
	require.NoError(t, err)

	// =========================================================================
	// 1. GET /api/v1/owner-groups/me/digest
	// =========================================================================

	t.Run("GET /api/v1/owner-groups/me/digest - 401 Unauthorized without auth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/owner-groups/me/digest", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("GET /api/v1/owner-groups/me/digest - 403 Forbidden for querying foreign owner group", func(t *testing.T) {
		// user2 belongs to Group 2, attempts to query Group 1
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/owner-groups/me/digest?owner_group_id=%s", ownerGroup1ID.String()), nil)
		req.Header.Set("X-Dev-User-ID", user2ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("GET /api/v1/owner-groups/me/digest - 200 OK empty items when group has no active cycle", func(t *testing.T) {
		// user2 has primary owner group = Group 2, which has no cycle
		req := httptest.NewRequest(http.MethodGet, "/api/v1/owner-groups/me/digest", nil)
		req.Header.Set("X-Dev-User-ID", user2ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.ActiveDigestResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, ownerGroup2ID, resp.OwnerGroupId)
		assert.Equal(t, "Digest Analytics Team", resp.OwnerGroupName)
		assert.Empty(t, resp.Items)
		assert.Nil(t, resp.CycleId)
	})

	t.Run("GET /api/v1/owner-groups/me/digest - 200 OK returns active cycle and queued CIs for owner group", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/owner-groups/me/digest", nil)
		req.Header.Set("X-Dev-User-ID", user1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.ActiveDigestResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		require.NotNil(t, resp.CycleId)
		assert.Equal(t, cycleID, *resp.CycleId)
		assert.Equal(t, ownerGroup1ID, resp.OwnerGroupId)
		assert.Equal(t, "Digest Payments Team", resp.OwnerGroupName)
		assert.Len(t, resp.Items, 2)

		itemIDs := []uuid.UUID{resp.Items[0].CiId, resp.Items[1].CiId}
		assert.Contains(t, itemIDs, ciDatabaseID)
		assert.Contains(t, itemIDs, ciLeafID)
	})

	t.Run("GET /api/v1/owner-groups/me/digest - Platform Admin can query across owner boundaries", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/owner-groups/me/digest?owner_group_id=%s", ownerGroup1ID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminUserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.ActiveDigestResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, cycleID, *resp.CycleId)
		assert.Len(t, resp.Items, 2)
	})

	// =========================================================================
	// 2. POST /api/v1/cis/{id}/verify
	// =========================================================================

	t.Run("POST /api/v1/cis/{id}/verify - 401 Unauthorized without auth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/verify", ciDatabaseID.String()), nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("POST /api/v1/cis/{id}/verify - 404 Not Found for non-existent CI", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/verify", uuid.New().String()), nil)
		req.Header.Set("X-Dev-User-ID", user1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("POST /api/v1/cis/{id}/verify - 403 Forbidden for non-owner caller", func(t *testing.T) {
		// user2 belongs to Group 2, CI belongs to Group 1
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/verify", ciDatabaseID.String()), nil)
		req.Header.Set("X-Dev-User-ID", user2ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("POST /api/v1/cis/{id}/verify - 200 OK updates timestamp, resolves open flags, actions digest item, and audits", func(t *testing.T) {
		verifyStart := time.Now().UTC().Add(-1 * time.Second)
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/verify", ciDatabaseID.String()), nil)
		req.Header.Set("X-Dev-User-ID", user1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.CIEnvelope
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		require.NotNil(t, resp.LastVerifiedAt)
		assert.True(t, resp.LastVerifiedAt.After(verifyStart), "last_verified_at should be stamped to now")

		// 1. Verify open flags were resolved in database
		var flagStatus string
		var resolvedBy uuid.UUID
		err = testPool.QueryRow(ctx, `
			SELECT status, resolved_by FROM ci_flags WHERE id = $1
		`, flagID).Scan(&flagStatus, &resolvedBy)
		require.NoError(t, err)
		assert.Equal(t, "resolved", flagStatus)
		assert.Equal(t, user1ID, resolvedBy)

		// 2. Verify digest item was actioned
		var itemStatus string
		var actionType string
		err = testPool.QueryRow(ctx, `
			SELECT status, action_type FROM digest_items WHERE id = $1
		`, digestItem1ID).Scan(&itemStatus, &actionType)
		require.NoError(t, err)
		assert.Equal(t, "actioned", itemStatus)
		assert.Equal(t, "verify", actionType)

		// 3. Verify audit log entry
		var action string
		var actorID uuid.UUID
		err = testPool.QueryRow(ctx, `
			SELECT action, actor_id FROM audit_logs
			WHERE entity_id = $1 AND action = 'verify'
			ORDER BY created_at DESC LIMIT 1
		`, ciDatabaseID).Scan(&action, &actorID)
		require.NoError(t, err)
		assert.Equal(t, "verify", action)
		assert.Equal(t, user1ID, actorID)
	})

	// =========================================================================
	// 3. POST /api/v1/cis/{id}/retire
	// =========================================================================

	t.Run("POST /api/v1/cis/{id}/retire - 401 Unauthorized without auth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/retire", ciDatabaseID.String()), nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("POST /api/v1/cis/{id}/retire - 404 Not Found for non-existent CI", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/retire", uuid.New().String()), nil)
		req.Header.Set("X-Dev-User-ID", user1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("POST /api/v1/cis/{id}/retire - 403 Forbidden for non-owner caller", func(t *testing.T) {
		// user2 belongs to Group 2, CI belongs to Group 1
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/retire", ciDatabaseID.String()), nil)
		req.Header.Set("X-Dev-User-ID", user2ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("POST /api/v1/cis/{id}/retire - 409 Conflict when active upstream dependents exist", func(t *testing.T) {
		// ciDatabaseID has active upstream dependent ciParentID
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/retire", ciDatabaseID.String()), nil)
		req.Header.Set("X-Dev-User-ID", user1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusConflict, rec.Code)
		var prob gen.ProblemDetails
		err := json.Unmarshal(rec.Body.Bytes(), &prob)
		require.NoError(t, err)

		assert.Equal(t, 409, prob.Status)
		assert.Contains(t, prob.Detail, "active dependent CIs exist")
		require.NotNil(t, prob.DependentCis)
		assert.NotEmpty(t, *prob.DependentCis)
		assert.Equal(t, ciParentID, (*prob.DependentCis)[0].CiId)
		assert.Equal(t, "digest-act-gateway-app", (*prob.DependentCis)[0].Name)

		// Assert CI was NOT retired
		var state string
		err = testPool.QueryRow(ctx, "SELECT lifecycle_state FROM cis WHERE ci_id = $1", ciDatabaseID).Scan(&state)
		require.NoError(t, err)
		assert.Equal(t, "in_service", state)
	})

	t.Run("POST /api/v1/cis/{id}/retire - 403 Forbidden when non-admin attempts force=true", func(t *testing.T) {
		// user1 is a team_lead, not platform_admin
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/retire?force=true", ciDatabaseID.String()), nil)
		req.Header.Set("X-Dev-User-ID", user1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusForbidden, rec.Code)
		var prob gen.ProblemDetails
		err := json.Unmarshal(rec.Body.Bytes(), &prob)
		require.NoError(t, err)
		assert.Contains(t, prob.Detail, "platform_admin")
	})

	t.Run("POST /api/v1/cis/{id}/retire - Platform Admin can force retire CI with active dependents", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/retire?force=true", ciDatabaseID.String()), nil)
		req.Header.Set("X-Dev-User-ID", adminUserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.CIEnvelope
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, gen.CIEnvelopeLifecycleState("retired"), resp.LifecycleState)

		// Assert DB updated
		var state string
		err = testPool.QueryRow(ctx, "SELECT lifecycle_state FROM cis WHERE ci_id = $1", ciDatabaseID).Scan(&state)
		require.NoError(t, err)
		assert.Equal(t, "retired", state)

		// Assert audit log recorded with force=true
		var action string
		var diffBytes []byte
		err = testPool.QueryRow(ctx, `
			SELECT action, diff FROM audit_logs
			WHERE entity_id = $1 AND action = 'retire'
			ORDER BY created_at DESC LIMIT 1
		`, ciDatabaseID).Scan(&action, &diffBytes)
		require.NoError(t, err)
		assert.Equal(t, "retire", action)
		var diffMap map[string]interface{}
		err = json.Unmarshal(diffBytes, &diffMap)
		require.NoError(t, err)
		assert.Equal(t, true, diffMap["force"])
	})

	t.Run("POST /api/v1/cis/{id}/retire - Leaf CI retires cleanly without force", func(t *testing.T) {
		// ciLeafID has zero active upstream dependents
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/retire", ciLeafID.String()), nil)
		req.Header.Set("X-Dev-User-ID", user1ID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.CIEnvelope
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, gen.CIEnvelopeLifecycleState("retired"), resp.LifecycleState)

		// Assert digest item for ciLeafID was marked actioned
		var itemStatus string
		var actionType string
		err = testPool.QueryRow(ctx, `
			SELECT status, action_type FROM digest_items WHERE id = $1
		`, digestItem2ID).Scan(&itemStatus, &actionType)
		require.NoError(t, err)
		assert.Equal(t, "actioned", itemStatus)
		assert.Equal(t, "retire", actionType)

		// Assert audit log recorded
		var action string
		err = testPool.QueryRow(ctx, `
			SELECT action FROM audit_logs
			WHERE entity_id = $1 AND action = 'retire'
			ORDER BY created_at DESC LIMIT 1
		`, ciLeafID).Scan(&action)
		require.NoError(t, err)
		assert.Equal(t, "retire", action)
	})
}
