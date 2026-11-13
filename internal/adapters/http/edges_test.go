package http_test

import (
	"bytes"
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

type edgeTestFixtures struct {
	adminID        uuid.UUID
	sourceTLID     uuid.UUID
	targetTLID     uuid.UUID
	targetViewerID uuid.UUID
	unrelatedTLID  uuid.UUID

	sourceGroupID    uuid.UUID
	targetGroupID    uuid.UUID
	unrelatedGroupID uuid.UUID

	sourceCIID uuid.UUID
	targetCIID uuid.UUID

	pendingEdgeID  uuid.UUID
	pendingEdge2ID uuid.UUID
	unrelatedEdgeID uuid.UUID
}

func seedEdgeTestFixtures(t *testing.T) edgeTestFixtures {
	f := edgeTestFixtures{
		adminID:          uuid.New(),
		sourceTLID:       uuid.New(),
		targetTLID:       uuid.New(),
		targetViewerID:   uuid.New(),
		unrelatedTLID:    uuid.New(),
		sourceGroupID:    uuid.New(),
		targetGroupID:    uuid.New(),
		unrelatedGroupID: uuid.New(),
		sourceCIID:       uuid.New(),
		targetCIID:       uuid.New(),
		pendingEdgeID:    uuid.New(),
		pendingEdge2ID:   uuid.New(),
		unrelatedEdgeID:  uuid.New(),
	}

	slugSrc := fmt.Sprintf("fintech-checkout-%s", uuid.New().String()[:8])
	slugTgt := fmt.Sprintf("infra-db-sre-%s", uuid.New().String()[:8])
	slugUnrel := fmt.Sprintf("growth-mktg-%s", uuid.New().String()[:8])

	// 1. Owner Groups
	_, err := testDB.Exec(`
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES
			($1, 'FinTech Checkout', $2, 'Payments', 'Carlos Source', 'carlos.source@example.com'),
			($3, 'Database SRE', $4, 'Infrastructure', 'Diana Target', 'diana.target@example.com'),
			($5, 'Growth Marketing', $6, 'Growth', 'Gary Unrelated', 'gary.unrelated@example.com')
	`, f.sourceGroupID, slugSrc, f.targetGroupID, slugTgt, f.unrelatedGroupID, slugUnrel)
	require.NoError(t, err)

	// 2. Users
	_, err = testDB.Exec(`
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES
			($1, $2, 'Admin Platform', 'platform_admin', $3),
			($4, $5, 'Carlos Source', 'team_lead', $6),
			($7, $8, 'Diana Target', 'team_lead', $9),
			($10, $11, 'Tom Viewer', 'viewer', $12),
			($13, $14, 'Gary Unrelated', 'team_lead', $15)
	`,
		f.adminID, fmt.Sprintf("admin-%s@example.com", f.adminID.String()[:8]), f.sourceGroupID,
		f.sourceTLID, fmt.Sprintf("source-tl-%s@example.com", f.sourceTLID.String()[:8]), f.sourceGroupID,
		f.targetTLID, fmt.Sprintf("target-tl-%s@example.com", f.targetTLID.String()[:8]), f.targetGroupID,
		f.targetViewerID, fmt.Sprintf("target-v-%s@example.com", f.targetViewerID.String()[:8]), f.targetGroupID,
		f.unrelatedTLID, fmt.Sprintf("unrel-tl-%s@example.com", f.unrelatedTLID.String()[:8]), f.unrelatedGroupID,
	)
	require.NoError(t, err)

	// Map user_owner_groups for multi-group RBAC resolution
	_, err = testDB.Exec(`
		INSERT INTO user_owner_groups (user_id, owner_group_id)
		VALUES
			($1, $2),
			($3, $4),
			($5, $6),
			($7, $8),
			($9, $10)
	`,
		f.adminID, f.sourceGroupID,
		f.sourceTLID, f.sourceGroupID,
		f.targetTLID, f.targetGroupID,
		f.targetViewerID, f.targetGroupID,
		f.unrelatedTLID, f.unrelatedGroupID,
	)
	require.NoError(t, err)

	// 3. CIs
	now := time.Now().UTC()
	srcCIName := fmt.Sprintf("checkout-api-%s", uuid.New().String()[:8])
	tgtCIName := fmt.Sprintf("aurora-pg-%s", uuid.New().String()[:8])
	unrelCIName := fmt.Sprintf("mktg-web-%s", uuid.New().String()[:8])
	unrelCIID := uuid.New()

	_, err = testDB.Exec(`
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, class_metadata, created_at, updated_at)
		VALUES
			($1, $2, 'application', 'prod', 'in_service', 'tier_1', $3, 'Carlos Source', 'https://checkout.internal', $4, '{}', $4, $4),
			($5, $6, 'database', 'prod', 'in_service', 'tier_0', $7, 'Diana Target', 'pg-primary.db.internal', $4, '{}', $4, $4),
			($8, $9, 'application', 'prod', 'in_service', 'tier_2', $10, 'Gary Unrelated', 'https://growth.internal', $4, '{}', $4, $4)
	`,
		f.sourceCIID, srcCIName, f.sourceGroupID, now,
		f.targetCIID, tgtCIName, f.targetGroupID,
		unrelCIID, unrelCIName, f.unrelatedGroupID,
	)
	require.NoError(t, err)

	// 4. Edges
	// Pending edge 1: sourceCI -> targetCI (cross-boundary, pending_confirmation)
	// Pending edge 2: unrelCI -> targetCI (cross-boundary, pending_confirmation)
	// Unrelated edge: sourceCI -> unrelCI (cross-boundary, pending_confirmation)
	_, err = testDB.Exec(`
		INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, created_at, updated_at)
		VALUES
			($1, $2, $3, 'reads_from', 'pending_confirmation', $4, $5, $5),
			($6, $7, $3, 'connects_to', 'pending_confirmation', $8, $5, $5),
			($9, $2, $7, 'connects_to', 'pending_confirmation', $4, $5, $5)
	`,
		f.pendingEdgeID, f.sourceCIID, f.targetCIID, f.sourceTLID, now,
		f.pendingEdge2ID, unrelCIID, f.unrelatedTLID,
		f.unrelatedEdgeID,
	)
	require.NoError(t, err)

	return f
}

func TestCrossBoundaryEdgeHandshakeService(t *testing.T) {
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	f := seedEdgeTestFixtures(t)

	t.Run("GET /api/v1/owner-groups/pending-edges requires authentication (401)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/owner-groups/pending-edges", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("Target team lead retrieves pending edges queue filtered to their group", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/owner-groups/pending-edges", nil)
		req.Header.Set("X-Dev-User-ID", f.targetTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)

		var resp gen.PendingEdgesResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		assert.GreaterOrEqual(t, resp.Total, 2)
		// Verify that all returned edges target Diana's group
		for _, e := range resp.Items {
			assert.Equal(t, f.targetGroupID, e.TargetCi.OwnerGroupId)
			assert.Equal(t, "pending_confirmation", string(e.HandshakeStatus))
			assert.NotEmpty(t, e.SourceCi.Name)
			assert.NotEmpty(t, e.SourceCi.OwnerGroupName)
			assert.NotEmpty(t, e.TargetCi.Name)
			assert.NotEmpty(t, e.TargetCi.DepartmentName)
		}
	})

	t.Run("Target team lead querying with other owner_group_id receives 403 Forbidden", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/owner-groups/pending-edges?owner_group_id="+f.unrelatedGroupID.String(), nil)
		req.Header.Set("X-Dev-User-ID", f.targetTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("Platform admin retrieves all pending edges across all teams", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/owner-groups/pending-edges", nil)
		req.Header.Set("X-Dev-User-ID", f.adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)

		var resp gen.PendingEdgesResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		assert.GreaterOrEqual(t, resp.Total, 3)
	})

	t.Run("POST /api/v1/edges/{id}/confirm - RBAC non-member receives 403 Forbidden", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges/"+f.pendingEdgeID.String()+"/confirm", nil)
		req.Header.Set("X-Dev-User-ID", f.unrelatedTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("POST /api/v1/edges/{id}/confirm - RBAC viewer in target group receives 403 Forbidden", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges/"+f.pendingEdgeID.String()+"/confirm", nil)
		req.Header.Set("X-Dev-User-ID", f.targetViewerID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("POST /api/v1/edges/{id}/confirm - Non-existent edge returns 404 Not Found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges/"+uuid.New().String()+"/confirm", nil)
		req.Header.Set("X-Dev-User-ID", f.targetTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("POST /api/v1/edges/{id}/confirm - Target team lead successfully confirms edge and writes audit log", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges/"+f.pendingEdgeID.String()+"/confirm", nil)
		req.Header.Set("X-Dev-User-ID", f.targetTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)

		var edgeResp gen.EdgeResponse
		err := json.Unmarshal(rec.Body.Bytes(), &edgeResp)
		require.NoError(t, err)

		assert.Equal(t, f.pendingEdgeID, edgeResp.Id)
		assert.Equal(t, "confirmed", string(edgeResp.HandshakeStatus))
		require.NotNil(t, edgeResp.ConfirmedBy)
		assert.Equal(t, f.targetTLID, *edgeResp.ConfirmedBy)
		assert.NotNil(t, edgeResp.ConfirmedAt)

		// 1. Verify in database
		var dbStatus string
		var dbConfirmedBy uuid.UUID
		err = testDB.QueryRow(`SELECT handshake_status, confirmed_by FROM ci_edges WHERE id = $1`, f.pendingEdgeID).Scan(&dbStatus, &dbConfirmedBy)
		require.NoError(t, err)
		assert.Equal(t, "confirmed", dbStatus)
		assert.Equal(t, f.targetTLID, dbConfirmedBy)

		// 2. Verify append-only audit log contains both source and target owner group IDs
		var affectedGroups []uuid.UUID
		var action string
		var actorID uuid.UUID
		err = testDB.QueryRow(`
			SELECT affected_owner_group_ids, action, actor_id
			FROM audit_logs
			WHERE entity_type = 'ci_edge' AND entity_id = $1
			ORDER BY created_at DESC LIMIT 1
		`, f.pendingEdgeID).Scan(&affectedGroups, &action, &actorID)
		require.NoError(t, err)

		assert.Equal(t, "update", action)
		assert.Equal(t, f.targetTLID, actorID)
		assert.Contains(t, affectedGroups, f.sourceGroupID, "Audit log must contain source owner group ID")
		assert.Contains(t, affectedGroups, f.targetGroupID, "Audit log must contain target owner group ID")
	})

	t.Run("POST /api/v1/edges/{id}/confirm - Confirming an already confirmed edge returns 409 Conflict", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges/"+f.pendingEdgeID.String()+"/confirm", nil)
		req.Header.Set("X-Dev-User-ID", f.targetTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusConflict, rec.Code)
	})

	t.Run("POST /api/v1/edges/{id}/flag-mismatch - Target team lead flags edge mismatch with reason", func(t *testing.T) {
		bodyBytes, _ := json.Marshal(map[string]interface{}{
			"reason": "Database partition does not host this service's tables",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges/"+f.pendingEdge2ID.String()+"/flag-mismatch", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.targetTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)

		var edgeResp gen.EdgeResponse
		err := json.Unmarshal(rec.Body.Bytes(), &edgeResp)
		require.NoError(t, err)

		assert.Equal(t, f.pendingEdge2ID, edgeResp.Id)
		assert.Equal(t, "flagged_mismatch", string(edgeResp.HandshakeStatus))

		// Verify audit log has reason
		var diffJSON []byte
		err = testDB.QueryRow(`
			SELECT diff FROM audit_logs
			WHERE entity_type = 'ci_edge' AND entity_id = $1 AND action = 'update'
			ORDER BY created_at DESC LIMIT 1
		`, f.pendingEdge2ID).Scan(&diffJSON)
		require.NoError(t, err)
		assert.Contains(t, string(diffJSON), "Database partition does not host this service's tables")
	})

	t.Run("POST /api/v1/edges/{id}/confirm - Edge flagged with mismatch can subsequently be confirmed after reconciliation", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges/"+f.pendingEdge2ID.String()+"/confirm", nil)
		req.Header.Set("X-Dev-User-ID", f.targetTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)

		var edgeResp gen.EdgeResponse
		err := json.Unmarshal(rec.Body.Bytes(), &edgeResp)
		require.NoError(t, err)
		assert.Equal(t, "confirmed", string(edgeResp.HandshakeStatus))
	})

	t.Run("POST /api/v1/edges/{id}/reject - Target team lead rejects cross-boundary edge with reason", func(t *testing.T) {
		bodyBytes, _ := json.Marshal(map[string]interface{}{
			"reason": "Unauthorized dependency connection request",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges/"+f.unrelatedEdgeID.String()+"/reject", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.unrelatedTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)

		var edgeResp gen.EdgeResponse
		err := json.Unmarshal(rec.Body.Bytes(), &edgeResp)
		require.NoError(t, err)

		assert.Equal(t, f.unrelatedEdgeID, edgeResp.Id)
		assert.Equal(t, "rejected", string(edgeResp.HandshakeStatus))

		// Database status check
		var dbStatus string
		err = testDB.QueryRow(`SELECT handshake_status FROM ci_edges WHERE id = $1`, f.unrelatedEdgeID).Scan(&dbStatus)
		require.NoError(t, err)
		assert.Equal(t, "rejected", dbStatus)
	})

	t.Run("POST /api/v1/edges/{id}/confirm - Attempting to confirm a rejected edge returns 409 Conflict", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges/"+f.unrelatedEdgeID.String()+"/confirm", nil)
		req.Header.Set("X-Dev-User-ID", f.unrelatedTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusConflict, rec.Code)
	})

	t.Run("POST /api/v1/edges/{id}/reject - Attempting to reject an already rejected edge returns 409 Conflict", func(t *testing.T) {
		bodyBytes, _ := json.Marshal(map[string]interface{}{
			"reason": "Duplicate rejection",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges/"+f.unrelatedEdgeID.String()+"/reject", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.unrelatedTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusConflict, rec.Code)
	})
}
