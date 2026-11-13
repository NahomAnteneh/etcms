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

type lifecycleTestFixtures struct {
	adminID        uuid.UUID
	teamLeadAID    uuid.UUID
	viewerAID      uuid.UUID
	teamLeadBID    uuid.UUID
	unrelatedTLID  uuid.UUID

	groupAID       uuid.UUID
	groupBID       uuid.UUID
	unrelatedGID   uuid.UUID

	ciA1ID         uuid.UUID
	ciA2ID         uuid.UUID
	ciB1ID         uuid.UUID
	ciRetiredID    uuid.UUID
}

func seedLifecycleTestFixtures(t *testing.T) lifecycleTestFixtures {
	f := lifecycleTestFixtures{
		adminID:       uuid.New(),
		teamLeadAID:   uuid.New(),
		viewerAID:     uuid.New(),
		teamLeadBID:   uuid.New(),
		unrelatedTLID: uuid.New(),
		groupAID:      uuid.New(),
		groupBID:      uuid.New(),
		unrelatedGID:  uuid.New(),
		ciA1ID:        uuid.New(),
		ciA2ID:        uuid.New(),
		ciB1ID:        uuid.New(),
		ciRetiredID:   uuid.New(),
	}

	slugA := fmt.Sprintf("payments-core-%s", uuid.New().String()[:8])
	slugB := fmt.Sprintf("database-infra-%s", uuid.New().String()[:8])
	slugUnrel := fmt.Sprintf("hr-ops-%s", uuid.New().String()[:8])

	// 1. Owner Groups
	_, err := testDB.Exec(`
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES
			($1, 'Payments Core', $2, 'FinTech', 'Alice Lead', 'alice.lead@example.com'),
			($3, 'Database Infra', $4, 'Infrastructure', 'Bob Infra', 'bob.infra@example.com'),
			($5, 'HR Operations', $6, 'Human Resources', 'Helen HR', 'helen.hr@example.com')
	`, f.groupAID, slugA, f.groupBID, slugB, f.unrelatedGID, slugUnrel)
	require.NoError(t, err)

	// 2. Users
	_, err = testDB.Exec(`
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES
			($1, $2, 'Platform Admin', 'platform_admin', $3),
			($4, $5, 'Alice Lead', 'team_lead', $6),
			($7, $8, 'Alan Viewer', 'viewer', $9),
			($10, $11, 'Bob Infra', 'team_lead', $12),
			($13, $14, 'Helen HR', 'team_lead', $15)
	`,
		f.adminID, fmt.Sprintf("admin-%s@example.com", f.adminID.String()[:8]), f.groupAID,
		f.teamLeadAID, fmt.Sprintf("alice-%s@example.com", f.teamLeadAID.String()[:8]), f.groupAID,
		f.viewerAID, fmt.Sprintf("alan-%s@example.com", f.viewerAID.String()[:8]), f.groupAID,
		f.teamLeadBID, fmt.Sprintf("bob-%s@example.com", f.teamLeadBID.String()[:8]), f.groupBID,
		f.unrelatedTLID, fmt.Sprintf("helen-%s@example.com", f.unrelatedTLID.String()[:8]), f.unrelatedGID,
	)
	require.NoError(t, err)

	// 3. User Owner Groups mappings
	_, err = testDB.Exec(`
		INSERT INTO user_owner_groups (user_id, owner_group_id)
		VALUES
			($1, $2),
			($3, $4),
			($5, $6),
			($7, $8),
			($9, $10)
	`,
		f.adminID, f.groupAID,
		f.teamLeadAID, f.groupAID,
		f.viewerAID, f.groupAID,
		f.teamLeadBID, f.groupBID,
		f.unrelatedTLID, f.unrelatedGID,
	)
	require.NoError(t, err)

	// 4. Initial CIs
	now := time.Now().UTC()
	_, err = testDB.Exec(`
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, class_metadata, created_at, updated_at)
		VALUES
			($1, $2, 'application', 'prod', 'in_service', 'tier_1', $3, 'Alice Lead', 'https://pay.internal', $4, '{}', $4, $4),
			($5, $6, 'application', 'prod', 'in_service', 'tier_1', $7, 'Alice Lead', 'https://worker.internal', $4, '{}', $4, $4),
			($8, $9, 'database', 'prod', 'in_service', 'tier_0', $10, 'Bob Infra', 'pg-primary.internal', $4, '{}', $4, $4),
			($11, $12, 'database', 'prod', 'retired', 'tier_3', $10, 'Bob Infra', 'pg-old.internal', $4, '{}', $4, $4)
	`,
		f.ciA1ID, fmt.Sprintf("pay-api-%s", uuid.New().String()[:8]), f.groupAID, now,
		f.ciA2ID, fmt.Sprintf("pay-worker-%s", uuid.New().String()[:8]), f.groupAID,
		f.ciB1ID, fmt.Sprintf("db-cluster-%s", uuid.New().String()[:8]), f.groupBID,
		f.ciRetiredID, fmt.Sprintf("db-retired-%s", uuid.New().String()[:8]),
	)
	require.NoError(t, err)

	return f
}

func TestPostBaselineSingleCIAndEdgeLifecycle(t *testing.T) {
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	f := seedLifecycleTestFixtures(t)

	t.Run("POST /api/v1/cis - 401 Unauthorized without credentials", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/cis", bytes.NewReader([]byte("{}")))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("POST /api/v1/cis - 403 Forbidden when caller does not belong to owner_group_id", func(t *testing.T) {
		body := map[string]interface{}{
			"name":             "fraud-detector-svc",
			"ci_class":         "application",
			"environment":      "prod",
			"criticality_tier": "tier_1",
			"owner_group_id":   f.groupAID.String(),
			"technical_contact": "Alice Lead",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/cis", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.unrelatedTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("POST /api/v1/cis - 403 Forbidden when caller has role viewer in owner group", func(t *testing.T) {
		body := map[string]interface{}{
			"name":             "fraud-detector-svc",
			"ci_class":         "application",
			"environment":      "prod",
			"criticality_tier": "tier_1",
			"owner_group_id":   f.groupAID.String(),
			"technical_contact": "Alice Lead",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/cis", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.viewerAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("POST /api/v1/cis - 422 Unprocessable Entity on unapproved ITAM fields via schema validation", func(t *testing.T) {
		body := map[string]interface{}{
			"name":             "fraud-detector-svc",
			"ci_class":         "application",
			"environment":      "prod",
			"criticality_tier": "tier_1",
			"owner_group_id":   f.groupAID.String(),
			"technical_contact": "Alice Lead",
			"purchase_cost":    120000,
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/cis", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	})

	t.Run("POST /api/v1/cis - 422 Unprocessable Entity when class_metadata exceeds 2 keys", func(t *testing.T) {
		body := map[string]interface{}{
			"name":             "fraud-detector-svc-meta",
			"ci_class":         "application",
			"environment":      "prod",
			"criticality_tier": "tier_1",
			"owner_group_id":   f.groupAID.String(),
			"technical_contact": "Alice Lead",
			"class_metadata": map[string]string{
				"k1": "v1",
				"k2": "v2",
				"k3": "v3",
			},
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/cis", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Contains(t, []int{http.StatusBadRequest, http.StatusUnprocessableEntity}, rec.Code)
	})

	var createdCIID uuid.UUID
	newCIName := fmt.Sprintf("fraud-detector-%s", uuid.New().String()[:8])

	t.Run("POST /api/v1/cis - Team lead successfully creates CI with in_service state and audit entry", func(t *testing.T) {
		body := map[string]interface{}{
			"name":             newCIName,
			"ci_class":         "application",
			"environment":      "prod",
			"criticality_tier": "tier_1",
			"owner_group_id":   f.groupAID.String(),
			"technical_contact": "Alice Lead",
			"primary_endpoint": "https://fraud.internal",
			"class_metadata": map[string]string{
				"runtime":   "go",
				"framework": "chi",
			},
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/cis", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusCreated, rec.Code)

		var envelope gen.CIEnvelope
		err := json.Unmarshal(rec.Body.Bytes(), &envelope)
		require.NoError(t, err)

		require.NotNil(t, envelope.CiId)
		createdCIID = *envelope.CiId
		assert.Equal(t, newCIName, envelope.Name)
		assert.Equal(t, "in_service", string(envelope.LifecycleState))
		assert.NotNil(t, envelope.LastVerifiedAt)
		require.NotNil(t, envelope.Ownership)
		assert.Equal(t, f.groupAID, envelope.Ownership.OwnerGroupId)
		assert.Equal(t, "Payments Core", envelope.Ownership.OwnerGroupName)
		assert.Equal(t, "FinTech", envelope.Ownership.DepartmentName)

		// 1. Verify in database
		var dbState string
		var dbVerifiedAt time.Time
		err = testDB.QueryRow(`SELECT lifecycle_state, last_verified_at FROM cis WHERE ci_id = $1`, createdCIID).Scan(&dbState, &dbVerifiedAt)
		require.NoError(t, err)
		assert.Equal(t, "in_service", dbState)
		assert.False(t, dbVerifiedAt.IsZero())

		// 2. Verify audit entry
		var action string
		var affectedGroups []uuid.UUID
		err = testDB.QueryRow(`
			SELECT action, affected_owner_group_ids FROM audit_logs
			WHERE entity_type = 'ci' AND entity_id = $1
		`, createdCIID).Scan(&action, &affectedGroups)
		require.NoError(t, err)
		assert.Equal(t, "create", action)
		assert.Contains(t, affectedGroups, f.groupAID)
	})

	t.Run("POST /api/v1/cis - 409 Conflict when creating duplicate active CI name in same env/class", func(t *testing.T) {
		body := map[string]interface{}{
			"name":             newCIName, // same name as just created
			"ci_class":         "application",
			"environment":      "prod",
			"criticality_tier": "tier_2",
			"owner_group_id":   f.groupAID.String(),
			"technical_contact": "Alice Lead",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/cis", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusConflict, rec.Code)
	})

	// === POST /api/v1/edges ===

	t.Run("POST /api/v1/edges - 400 Bad Request on self-loop dependency", func(t *testing.T) {
		body := map[string]interface{}{
			"source_ci_id": createdCIID.String(),
			"target_ci_id": createdCIID.String(),
			"edge_type":    "depends_on",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("POST /api/v1/edges - 404 Not Found if source CI does not exist", func(t *testing.T) {
		body := map[string]interface{}{
			"source_ci_id": uuid.New().String(),
			"target_ci_id": f.ciB1ID.String(),
			"edge_type":    "reads_from",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("POST /api/v1/edges - 404 Not Found if target CI does not exist", func(t *testing.T) {
		body := map[string]interface{}{
			"source_ci_id": createdCIID.String(),
			"target_ci_id": uuid.New().String(),
			"edge_type":    "reads_from",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("POST /api/v1/edges - 409 Conflict if target CI is retired", func(t *testing.T) {
		body := map[string]interface{}{
			"source_ci_id": createdCIID.String(),
			"target_ci_id": f.ciRetiredID.String(),
			"edge_type":    "reads_from",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusConflict, rec.Code)
	})

	t.Run("POST /api/v1/edges - 403 Forbidden if caller does not belong to source CI owner group", func(t *testing.T) {
		body := map[string]interface{}{
			"source_ci_id": createdCIID.String(), // owned by Group A
			"target_ci_id": f.ciB1ID.String(),
			"edge_type":    "reads_from",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.unrelatedTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	var intraEdgeID uuid.UUID

	t.Run("POST /api/v1/edges - Intra-group edge created as auto-confirmed", func(t *testing.T) {
		body := map[string]interface{}{
			"source_ci_id": createdCIID.String(), // Group A
			"target_ci_id": f.ciA2ID.String(),     // Group A
			"edge_type":    "connects_to",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusCreated, rec.Code)

		var edgeResp gen.EdgeResponse
		err := json.Unmarshal(rec.Body.Bytes(), &edgeResp)
		require.NoError(t, err)

		intraEdgeID = edgeResp.Id
		assert.Equal(t, "confirmed", string(edgeResp.HandshakeStatus))
		require.NotNil(t, edgeResp.ConfirmedBy)
		assert.Equal(t, f.teamLeadAID, *edgeResp.ConfirmedBy)
		assert.NotNil(t, edgeResp.ConfirmedAt)
	})

	var crossEdgeID uuid.UUID

	t.Run("POST /api/v1/edges - Cross-boundary edge created with pending_confirmation status", func(t *testing.T) {
		body := map[string]interface{}{
			"source_ci_id": createdCIID.String(), // Group A
			"target_ci_id": f.ciB1ID.String(),     // Group B
			"edge_type":    "reads_from",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusCreated, rec.Code)

		var edgeResp gen.EdgeResponse
		err := json.Unmarshal(rec.Body.Bytes(), &edgeResp)
		require.NoError(t, err)

		crossEdgeID = edgeResp.Id
		assert.Equal(t, "pending_confirmation", string(edgeResp.HandshakeStatus))
		assert.Nil(t, edgeResp.ConfirmedBy)
		assert.Nil(t, edgeResp.ConfirmedAt)

		// Audit verification: contains both groups
		var affected []uuid.UUID
		err = testDB.QueryRow(`SELECT affected_owner_group_ids FROM audit_logs WHERE entity_type = 'ci_edge' AND entity_id = $1`, crossEdgeID).Scan(&affected)
		require.NoError(t, err)
		assert.Contains(t, affected, f.groupAID)
		assert.Contains(t, affected, f.groupBID)
	})

	t.Run("POST /api/v1/edges - 409 Conflict when creating duplicate edge between source, target, and type", func(t *testing.T) {
		body := map[string]interface{}{
			"source_ci_id": createdCIID.String(),
			"target_ci_id": f.ciB1ID.String(),
			"edge_type":    "reads_from",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusConflict, rec.Code)
	})

	// === DELETE /api/v1/edges/{id} ===

	t.Run("DELETE /api/v1/edges/{id} - 403 Forbidden when caller belongs to neither source nor target group", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/edges/"+crossEdgeID.String(), nil)
		req.Header.Set("X-Dev-User-ID", f.unrelatedTLID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("DELETE /api/v1/edges/{id} - 403 Forbidden when caller is a viewer in source group", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/edges/"+crossEdgeID.String(), nil)
		req.Header.Set("X-Dev-User-ID", f.viewerAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("DELETE /api/v1/edges/{id} - 404 Not Found for non-existent edge", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/edges/"+uuid.New().String(), nil)
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("DELETE /api/v1/edges/{id} - Source team lead soft-disconnects edge and writes disconnect audit log", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/edges/"+crossEdgeID.String(), nil)
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusNoContent, rec.Code)

		// 1. Verify removed from ci_edges
		var count int
		err := testDB.QueryRow(`SELECT count(*) FROM ci_edges WHERE id = $1`, crossEdgeID).Scan(&count)
		require.NoError(t, err)
		assert.Equal(t, 0, count)

		// 2. Verify audit log entry with action = 'disconnect'
		var action string
		var affected []uuid.UUID
		err = testDB.QueryRow(`
			SELECT action, affected_owner_group_ids FROM audit_logs
			WHERE entity_type = 'ci_edge' AND entity_id = $1 AND action = 'disconnect'
		`, crossEdgeID).Scan(&action, &affected)
		require.NoError(t, err)
		assert.Equal(t, "disconnect", action)
		assert.Contains(t, affected, f.groupAID)
		assert.Contains(t, affected, f.groupBID)
	})

	t.Run("DELETE /api/v1/edges/{id} - Target team lead can also disconnect an edge", func(t *testing.T) {
		// intraEdgeID was between A1 and A2, let's create an edge where Bob is target
		body := map[string]interface{}{
			"source_ci_id": f.ciA1ID.String(),
			"target_ci_id": f.ciB1ID.String(),
			"edge_type":    "depends_on",
		}
		bodyBytes, _ := json.Marshal(body)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/edges", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", f.teamLeadAID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusCreated, rec.Code)

		var edgeResp gen.EdgeResponse
		_ = json.Unmarshal(rec.Body.Bytes(), &edgeResp)

		// Bob (target team lead) disconnects it
		delReq := httptest.NewRequest(http.MethodDelete, "/api/v1/edges/"+edgeResp.Id.String(), nil)
		delReq.Header.Set("X-Dev-User-ID", f.teamLeadBID.String())
		delRec := httptest.NewRecorder()
		router.ServeHTTP(delRec, delReq)
		require.Equal(t, http.StatusNoContent, delRec.Code)
	})

	_ = intraEdgeID
}
