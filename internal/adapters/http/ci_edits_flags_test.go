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

func TestCIEditsVolatileStampingAndFlags(t *testing.T) {
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	ctx := t.Context()
	now := time.Now().UTC().Truncate(time.Millisecond)
	initialVerifiedAt := now.Add(-30 * 24 * time.Hour) // 30 days ago

	// 1. Seed Owner Groups
	ownerGroup1ID := uuid.New()
	ownerGroup2ID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES
			($1, 'Payments Team Edit', 'ci-edits-payments', 'Engineering', 'Pay Lead', 'paylead-edit@example.com'),
			($2, 'Security Team Edit', 'ci-edits-security', 'InfoSec', 'Sec Lead', 'seclead-edit@example.com')
	`, ownerGroup1ID, ownerGroup2ID)
	require.NoError(t, err)

	// 2. Seed Users:
	// - owner1User: member of ownerGroup1ID
	// - owner2User: member of ownerGroup2ID
	// - platformAdminUser: role platform_admin
	// - viewerUser: role viewer
	owner1UserID := uuid.New()
	owner2UserID := uuid.New()
	platformAdminUserID := uuid.New()
	viewerUserID := uuid.New()

	_, err = testPool.Exec(ctx, `
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES
			($1, 'owner1@example.com', 'Owner One', 'team_lead', $5),
			($2, 'owner2@example.com', 'Owner Two', 'team_lead', $6),
			($3, 'admin-edit@example.com', 'Admin User', 'platform_admin', $5),
			($4, 'viewer@example.com', 'Viewer User', 'viewer', $6)
	`, owner1UserID, owner2UserID, platformAdminUserID, viewerUserID, ownerGroup1ID, ownerGroup2ID)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO user_owner_groups (user_id, owner_group_id)
		VALUES
			($1, $5),
			($2, $6),
			($3, $5),
			($4, $6)
	`, owner1UserID, owner2UserID, platformAdminUserID, viewerUserID, ownerGroup1ID, ownerGroup2ID)
	require.NoError(t, err)

	// 3. Seed Target CI owned by ownerGroup1ID
	ciID := uuid.New()
	_, err = testPool.Exec(ctx, `
		INSERT INTO cis (
			ci_id, name, ci_class, environment, lifecycle_state, criticality_tier,
			owner_group_id, technical_contact, primary_endpoint, last_verified_at,
			itam_external_ref, class_metadata, created_at, updated_at
		) VALUES (
			$1, 'ci-edits-gateway-api', 'application', 'prod', 'in_service', 'tier_1',
			$2, 'pay-tech@example.com', 'https://api.payments.internal', $3,
			'ITAM-1001', '{"tier": "gold"}'::jsonb, $3, $3
		)
	`, ciID, ownerGroup1ID, initialVerifiedAt)
	require.NoError(t, err)

	// =========================================================================
	// PATCH /api/v1/cis/{id} - Authentication & Authorization Gates
	// =========================================================================

	t.Run("PATCH /api/v1/cis/{id} - 401 Unauthorized without authentication", func(t *testing.T) {
		body := map[string]interface{}{"technical_contact": "new@example.com"}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/cis/%s", ciID.String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("PATCH /api/v1/cis/{id} - 404 Not Found for non-existent CI", func(t *testing.T) {
		body := map[string]interface{}{"technical_contact": "new@example.com"}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/cis/%s", uuid.New().String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", owner1UserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("PATCH /api/v1/cis/{id} - 403 Forbidden for non-owner member", func(t *testing.T) {
		// owner2User belongs to ownerGroup2ID, whereas CI belongs to ownerGroup1ID
		body := map[string]interface{}{"technical_contact": "hacker@example.com"}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/cis/%s", ciID.String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", owner2UserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	// =========================================================================
	// PATCH /api/v1/cis/{id} - Validation & Governance Constraints
	// =========================================================================

	t.Run("PATCH /api/v1/cis/{id} - 422 Disallow retiring CI via PATCH", func(t *testing.T) {
		body := map[string]interface{}{"lifecycle_state": "retired"}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/cis/%s", ciID.String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", owner1UserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	})

	t.Run("PATCH /api/v1/cis/{id} - 422 Reject unapproved ITAM fields", func(t *testing.T) {
		prohibitedFields := []string{"cost", "purchase_cost", "license_count", "warranty_end", "vendor"}
		for _, field := range prohibitedFields {
			body := map[string]interface{}{
				"technical_contact": "valid@example.com",
				field:               "unapproved-itam-value",
			}
			bodyBytes, _ := json.Marshal(body)
			req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/cis/%s", ciID.String()), bytes.NewReader(bodyBytes))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Dev-User-ID", owner1UserID.String())
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, "expected field %s to be rejected with 422", field)
		}
	})

	t.Run("PATCH /api/v1/cis/{id} - 422 Reject class_metadata containing Anti-ITAM fields", func(t *testing.T) {
		body := map[string]interface{}{
			"class_metadata": map[string]string{
				"cost": "$5000",
			},
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/cis/%s", ciID.String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", owner1UserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	})

	// =========================================================================
	// PATCH /api/v1/cis/{id} - Cosmetic vs. Volatile Verification Stamping
	// =========================================================================

	t.Run("PATCH /api/v1/cis/{id} - Cosmetic update leaves last_verified_at unchanged", func(t *testing.T) {
		cosmeticBody := map[string]interface{}{
			"class_metadata": map[string]string{
				"tier":   "platinum",
				"region": "us-east-1",
			},
		}
		bodyBytes, _ := json.Marshal(cosmeticBody)
		req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/cis/%s", ciID.String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", owner1UserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.CIEnvelope
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		// Assert updated metadata
		assert.Equal(t, "platinum", resp.ClassMetadata["tier"])
		assert.Equal(t, "us-east-1", resp.ClassMetadata["region"])

		// Assert last_verified_at did NOT change
		require.NotNil(t, resp.LastVerifiedAt)
		assert.WithinDuration(t, initialVerifiedAt, *resp.LastVerifiedAt, time.Second, "cosmetic edit must not update last_verified_at")

		// Assert updated_at was updated to now
		require.NotNil(t, resp.UpdatedAt)
		assert.True(t, resp.UpdatedAt.After(initialVerifiedAt), "updated_at must advance")

		// Check Audit Log
		var action string
		var diffBytes []byte
		err = testPool.QueryRow(ctx, `
			SELECT action, diff FROM audit_logs
			WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1
		`, ciID).Scan(&action, &diffBytes)
		require.NoError(t, err)
		assert.Equal(t, "update", action)
		assert.Contains(t, string(diffBytes), "platinum")
	})

	t.Run("PATCH /api/v1/cis/{id} - Volatile update (primary_endpoint) updates last_verified_at to now", func(t *testing.T) {
		volatileBody := map[string]interface{}{
			"primary_endpoint": "https://api-v2.payments.internal",
		}
		bodyBytes, _ := json.Marshal(volatileBody)
		req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/cis/%s", ciID.String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", owner1UserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.CIEnvelope
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		// Assert endpoint updated
		require.NotNil(t, resp.PrimaryEndpoint)
		assert.Equal(t, "https://api-v2.payments.internal", *resp.PrimaryEndpoint)

		// Assert last_verified_at was updated to now!
		require.NotNil(t, resp.LastVerifiedAt)
		assert.WithinDuration(t, time.Now().UTC(), *resp.LastVerifiedAt, 5*time.Second, "volatile edit must update last_verified_at to now()")
		assert.True(t, resp.LastVerifiedAt.After(initialVerifiedAt))

		// Check Audit Log diff contains old_values and new_values
		var diffBytes []byte
		err = testPool.QueryRow(ctx, `
			SELECT diff FROM audit_logs
			WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1
		`, ciID).Scan(&diffBytes)
		require.NoError(t, err)
		assert.Contains(t, string(diffBytes), "https://api.payments.internal")
		assert.Contains(t, string(diffBytes), "https://api-v2.payments.internal")
	})

	t.Run("PATCH /api/v1/cis/{id} - Platform Admin can update CI across owner boundaries", func(t *testing.T) {
		body := map[string]interface{}{
			"criticality_tier": "tier_0",
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/cis/%s", ciID.String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", platformAdminUserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.CIEnvelope
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, gen.CIEnvelopeCriticalityTier("tier_0"), resp.CriticalityTier)
	})

	t.Run("PATCH /api/v1/cis/{id} - Platform Admin can toggle lifecycle_state to out_of_sync and synced", func(t *testing.T) {
		// 1. Mark out_of_sync
		body := map[string]interface{}{
			"lifecycle_state": "out_of_sync",
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/cis/%s", ciID.String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", platformAdminUserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.CIEnvelope
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, gen.CIEnvelopeLifecycleState("out_of_sync"), resp.LifecycleState)

		// 2. Mark synced
		body2 := map[string]interface{}{
			"lifecycle_state": "synced",
		}
		bodyBytes2, _ := json.Marshal(body2)
		req2 := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/cis/%s", ciID.String()), bytes.NewReader(bodyBytes2))
		req2.Header.Set("Content-Type", "application/json")
		req2.Header.Set("X-Dev-User-ID", platformAdminUserID.String())
		rec2 := httptest.NewRecorder()
		router.ServeHTTP(rec2, req2)

		assert.Equal(t, http.StatusOK, rec2.Code)
		var resp2 gen.CIEnvelope
		err = json.Unmarshal(rec2.Body.Bytes(), &resp2)
		require.NoError(t, err)
		assert.Equal(t, gen.CIEnvelopeLifecycleState("synced"), resp2.LifecycleState)
	})

	// =========================================================================
	// POST /api/v1/cis/{id}/flags - Reporting Data-Quality Flags
	// =========================================================================

	t.Run("POST /api/v1/cis/{id}/flags - 401 Unauthorized without authentication", func(t *testing.T) {
		body := map[string]interface{}{"reason": "Endpoint returning 502 Bad Gateway"}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/flags", ciID.String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("POST /api/v1/cis/{id}/flags - 404 Not Found for non-existent CI", func(t *testing.T) {
		body := map[string]interface{}{"reason": "Missing documentation and contacts"}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/flags", uuid.New().String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", viewerUserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("POST /api/v1/cis/{id}/flags - 422 Reason must be at least 5 characters", func(t *testing.T) {
		body := map[string]interface{}{"reason": "bad"}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/flags", ciID.String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", viewerUserID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	})

	t.Run("POST /api/v1/cis/{id}/flags - Non-owner (any authenticated user) successfully reports data flag", func(t *testing.T) {
		flagType := "stale_endpoint"
		body := map[string]interface{}{
			"reason":    "Endpoint is returning DNS NXDOMAIN after migration",
			"flag_type": flagType,
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/cis/%s/flags", ciID.String()), bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", owner2UserID.String()) // Non-owner user reporting
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusCreated, rec.Code)
		var resp gen.CIFlagResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)

		assert.Equal(t, ciID, resp.CiId)
		assert.Equal(t, owner2UserID, resp.FlaggedBy)
		assert.Equal(t, "Endpoint is returning DNS NXDOMAIN after migration", resp.Reason)
		assert.Equal(t, gen.CIFlagResponseStatus("open"), resp.Status)
		assert.Nil(t, resp.ResolvedAt)
		assert.Nil(t, resp.ResolvedBy)

		// Assert Flag is logged to audit_logs
		var action string
		var actorID uuid.UUID
		err = testPool.QueryRow(ctx, `
			SELECT action, actor_id FROM audit_logs
			WHERE entity_id = $1 AND action = 'flag'
			ORDER BY created_at DESC LIMIT 1
		`, ciID).Scan(&action, &actorID)
		require.NoError(t, err)
		assert.Equal(t, "flag", action)
		assert.Equal(t, owner2UserID, actorID)

		// Assert GET /api/v1/cis/{id} reflects open_flag_count = 1
		detailReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/cis/%s", ciID.String()), nil)
		detailReq.Header.Set("X-Dev-User-ID", owner1UserID.String())
		detailRec := httptest.NewRecorder()
		router.ServeHTTP(detailRec, detailReq)
		assert.Equal(t, http.StatusOK, detailRec.Code)

		var detailResp gen.CIDetailResponse
		err = json.Unmarshal(detailRec.Body.Bytes(), &detailResp)
		require.NoError(t, err)
		assert.Equal(t, 1, detailResp.VerificationStatus.OpenFlagCount)
	})
}
