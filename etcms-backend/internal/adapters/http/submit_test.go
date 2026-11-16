package http_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
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

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func seedSubmitTestPrerequisites(t *testing.T) (adminID uuid.UUID, teamGroupID uuid.UUID, infraGroupID uuid.UUID, rawToken string, campaignID uuid.UUID, sharedDBID uuid.UUID) {
	adminID = uuid.New()
	teamGroupID = uuid.New()
	infraGroupID = uuid.New()
	campaignID = uuid.New()
	sharedDBID = uuid.New()

	teamSlug := fmt.Sprintf("order-eng-%s", uuid.New().String()[:8])
	infraSlug := fmt.Sprintf("infra-dba-%s", uuid.New().String()[:8])

	// 1. FinTech Team Owner Group (Source)
	_, err := testDB.Exec(`
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES ($1, 'Order Processing', $2, 'FinTech', 'Carlos Orders', 'carlos.orders@example.com')
	`, teamGroupID, teamSlug)
	require.NoError(t, err)

	// 2. Infra DBA Group (Target for cross-boundary edge)
	_, err = testDB.Exec(`
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES ($1, 'Database Reliability Engineering', $2, 'Platform Infrastructure', 'Dana DBA', 'dana.dba@example.com')
	`, infraGroupID, infraSlug)
	require.NoError(t, err)

	// 3. Admin User
	_, err = testDB.Exec(`
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES ($1, $2, 'Admin User', 'platform_admin', $3)
	`, adminID, fmt.Sprintf("admin-%s@example.com", adminID.String()[:8]), teamGroupID)
	require.NoError(t, err)

	// 4. Shared Database CI owned by Infra DRE
	_, err = testDB.Exec(`
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, class_metadata)
		VALUES ($1, 'main-postgres-cluster', 'database', 'prod', 'in_service', 'tier_0', $2, 'Dana DBA', 'pg.prod.internal:5432', '{"engine": "postgres"}')
	`, sharedDBID, infraGroupID)
	require.NoError(t, err)

	// 5. Intake Campaign
	deadline := time.Now().UTC().Add(7 * 24 * time.Hour)
	_, err = testDB.Exec(`
		INSERT INTO intake_campaigns (id, title, status, deadline, created_by)
		VALUES ($1, 'Annual FinTech Architecture Baseline', 'active', $2, $3)
	`, campaignID, deadline, adminID)
	require.NoError(t, err)

	// 6. Intake Invitation and Draft Submission
	rawToken = "tok_submit_" + strings.Repeat("s", 50)
	h := sha256.Sum256([]byte(rawToken))
	tokenHash := hex.EncodeToString(h[:])

	invID := uuid.New()
	_, err = testDB.Exec(`
		INSERT INTO intake_invitations (id, campaign_id, owner_group_id, token_hash, team_lead_email, status, expires_at)
		VALUES ($1, $2, $3, $4, 'carlos.orders@example.com', 'opened', $5)
	`, invID, campaignID, teamGroupID, tokenHash, deadline)
	require.NoError(t, err)

	_, err = testDB.Exec(`
		INSERT INTO intake_submissions (id, invitation_id, owner_group_id, status, payload, lock_version)
		VALUES ($1, $2, $3, 'draft', '{}', 1)
	`, uuid.New(), invID, teamGroupID)
	require.NoError(t, err)

	return adminID, teamGroupID, infraGroupID, rawToken, campaignID, sharedDBID
}

func TestAtomicBaselinePublisherEngine(t *testing.T) {
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	_, teamGroupID, _, rawToken, campaignID, sharedDBID := seedSubmitTestPrerequisites(t)

	// Helper to count CIs in database
	countCIs := func() int {
		var cnt int
		err := testDB.QueryRow(`SELECT count(*) FROM cis`).Scan(&cnt)
		require.NoError(t, err)
		return cnt
	}

	initialCICount := countCIs()

	t.Run("422 Validation Rejection on missing technical_contact and zero mutation rollback", func(t *testing.T) {
		invalidPayload := map[string]interface{}{
			"services": []interface{}{
				map[string]interface{}{
					"name":             "order-processing-api",
					"ci_class":         "application",
					"environment":      "prod",
					"criticality_tier": "tier_1",
					// missing technical_contact
					"primary_endpoint": "https://orders.internal.net",
				},
			},
		}

		bodyBytes, err := json.Marshal(gen.SubmitIntakeRequest{
			Payload: &invalidPayload,
		})
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/intake/"+rawToken+"/submit", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusUnprocessableEntity, rec.Code)

		var prob gen.ProblemDetails
		err = json.Unmarshal(rec.Body.Bytes(), &prob)
		require.NoError(t, err)

		require.NotNil(t, prob.NodeErrors)
		errorsForOrderAPI := (*prob.NodeErrors)["order-processing-api"]
		assert.NotEmpty(t, errorsForOrderAPI)
		assert.Contains(t, errorsForOrderAPI[0], "technical_contact is required")

		// Verify cis table has zero mutations
		assert.Equal(t, initialCICount, countCIs(), "cis table must remain untouched after validation failure")
	})

	t.Run("422 Validation Rejection on class_metadata > 2 keys", func(t *testing.T) {
		invalidMetadataPayload := map[string]interface{}{
			"services": []interface{}{
				map[string]interface{}{
					"name":              "order-worker",
					"ci_class":          "application",
					"environment":       "prod",
					"criticality_tier":  "tier_2",
					"technical_contact": "Carlos Orders",
					"class_metadata": map[string]interface{}{
						"key1": "val1",
						"key2": "val2",
						"key3": "val3", // 3 keys > 2
					},
				},
			},
		}

		bodyBytes, err := json.Marshal(gen.SubmitIntakeRequest{
			Payload: &invalidMetadataPayload,
		})
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/intake/"+rawToken+"/submit", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusUnprocessableEntity, rec.Code)

		var prob gen.ProblemDetails
		err = json.Unmarshal(rec.Body.Bytes(), &prob)
		require.NoError(t, err)

		require.NotNil(t, prob.NodeErrors)
		assert.NotEmpty(t, (*prob.NodeErrors)["order-worker"])
		assert.Contains(t, (*prob.NodeErrors)["order-worker"][0], "class_metadata exceeds maximum of 2 keys")

		// Verify zero rows added
		assert.Equal(t, initialCICount, countCIs())
	})

	t.Run("422 Validation Rejection on unapproved ITAM fields", func(t *testing.T) {
		itamPayload := map[string]interface{}{
			"services": []interface{}{
				map[string]interface{}{
					"name":              "order-service",
					"ci_class":          "application",
					"environment":       "prod",
					"criticality_tier":  "tier_1",
					"technical_contact": "Carlos Orders",
					"purchase_cost":     15000,
				},
			},
		}

		bodyBytes, err := json.Marshal(gen.SubmitIntakeRequest{
			Payload: &itamPayload,
		})
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/intake/"+rawToken+"/submit", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
		assert.Contains(t, rec.Body.String(), "Anti-ITAM")
		assert.Equal(t, initialCICount, countCIs())
	})

	t.Run("422 Validation Rejection when dependent target_ci_id does not exist in catalog", func(t *testing.T) {
		nonExistentTarget := uuid.New().String()
		invalidDepPayload := map[string]interface{}{
			"services": []interface{}{
				map[string]interface{}{
					"name":              "order-api",
					"ci_class":          "application",
					"environment":       "prod",
					"criticality_tier":  "tier_1",
					"technical_contact": "Carlos Orders",
				},
			},
			"dependencies": []interface{}{
				map[string]interface{}{
					"source_ci_name": "order-api",
					"target_ci_id":   nonExistentTarget,
					"edge_type":      "reads_from",
				},
			},
		}

		bodyBytes, err := json.Marshal(gen.SubmitIntakeRequest{
			Payload: &invalidDepPayload,
		})
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/intake/"+rawToken+"/submit", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
		assert.Contains(t, rec.Body.String(), "target_ci_id")
		assert.Contains(t, rec.Body.String(), "not found in catalog")
		assert.Equal(t, initialCICount, countCIs())
	})

	var publishedBaselineID uuid.UUID

	t.Run("Valid Intake Submission Atomically Publishes Baseline v1.0, CIs, Edges, and Audits", func(t *testing.T) {
		validPayload := map[string]interface{}{
			"services": []interface{}{
				map[string]interface{}{
					"name":              "order-api",
					"ci_class":          "application",
					"environment":       "prod",
					"criticality_tier":  "tier_1",
					"technical_contact": "Carlos Orders",
					"primary_endpoint":  "https://orders-api.internal.net",
					"class_metadata": map[string]interface{}{
						"runtime": "go",
						"version": "1.27",
					},
				},
				map[string]interface{}{
					"name":              "order-events-worker",
					"ci_class":          "application",
					"environment":       "prod",
					"criticality_tier":  "tier_2",
					"technical_contact": "Carlos Orders",
					"class_metadata": map[string]interface{}{
						"runtime": "go",
					},
				},
			},
			"dependencies": []interface{}{
				// 1. Cross-boundary edge: order-api -> main-postgres-cluster (owned by Infra DRE)
				map[string]interface{}{
					"source_ci_name": "order-api",
					"target_ci_id":   sharedDBID.String(),
					"edge_type":      "reads_from",
				},
				// 2. Intra-group edge: order-events-worker -> order-api (both owned by FinTech)
				map[string]interface{}{
					"source_ci_name": "order-events-worker",
					"target_ci_id":   "", // will resolve via source/target in test or name
					"edge_type":      "connects_to",
				},
			},
		}

		// Save draft first to test submitting the saved draft
		patchBytes, err := json.Marshal(gen.SaveDraftRequest{
			Payload: validPayload,
		})
		require.NoError(t, err)

		patchReq := httptest.NewRequest(http.MethodPatch, "/api/v1/intake/"+rawToken, bytes.NewReader(patchBytes))
		patchReq.Header.Set("Content-Type", "application/json")
		patchReq.Header.Set("If-Match", "\"1\"")
		patchRec := httptest.NewRecorder()
		router.ServeHTTP(patchRec, patchReq)
		require.Equal(t, http.StatusOK, patchRec.Code)

		// Provide target_ci_id for edge 1 (cross-boundary)
		submitPayload := map[string]interface{}{
			"services": validPayload["services"],
			"dependencies": []interface{}{
				map[string]interface{}{
					"source_ci_name": "order-api",
					"target_ci_id":   sharedDBID.String(),
					"edge_type":      "reads_from",
				},
			},
		}

		bodyBytes, err := json.Marshal(gen.SubmitIntakeRequest{
			Payload: &submitPayload,
		})
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/intake/"+rawToken+"/submit", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "idemp-key-order-fintech-001")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusCreated, rec.Code)

		var baselineResp gen.BaselineResponse
		err = json.Unmarshal(rec.Body.Bytes(), &baselineResp)
		require.NoError(t, err)

		publishedBaselineID = baselineResp.BaselineId
		assert.Equal(t, campaignID, baselineResp.CampaignId)
		assert.Equal(t, teamGroupID, baselineResp.OwnerGroupId)
		assert.Equal(t, "v1.0", baselineResp.VersionTag)
		assert.Equal(t, 2, baselineResp.CiCount)
		assert.Equal(t, 1, baselineResp.EdgeCount)
		assert.Equal(t, 1, baselineResp.PendingEdgeCount, "Cross-boundary edge must be pending_confirmation")

		// Verify database state
		// 1. CIs created with in_service lifecycle_state and last_verified_at stamped
		var ciState, primaryEP string
		var lastVerified time.Time
		err = testDB.QueryRow(`
			SELECT lifecycle_state, primary_endpoint, last_verified_at
			FROM cis WHERE name = 'order-api'
		`).Scan(&ciState, &primaryEP, &lastVerified)
		require.NoError(t, err)
		assert.Equal(t, "in_service", ciState)
		assert.Equal(t, "https://orders-api.internal.net", primaryEP)
		assert.WithinDuration(t, time.Now().UTC(), lastVerified, 5*time.Second)

		// 2. Cross-boundary edge has handshake_status = 'pending_confirmation'
		var handshakeStatus string
		var sourceCIID, targetCIID uuid.UUID
		err = testDB.QueryRow(`
			SELECT source_ci_id, target_ci_id, handshake_status
			FROM ci_edges WHERE target_ci_id = $1
		`, sharedDBID).Scan(&sourceCIID, &targetCIID, &handshakeStatus)
		require.NoError(t, err)
		assert.Equal(t, "pending_confirmation", handshakeStatus)
		assert.Equal(t, sharedDBID, targetCIID)

		// 3. Invitation is 'submitted' and Submission is 'approved'
		var invStatus, subStatus string
		err = testDB.QueryRow(`
			SELECT i.status, s.status
			FROM intake_invitations i
			JOIN intake_submissions s ON s.invitation_id = i.id
			WHERE i.token_hash = $1
		`, sha256Hex(rawToken)).Scan(&invStatus, &subStatus)
		require.NoError(t, err)
		assert.Equal(t, "submitted", invStatus)
		assert.Equal(t, "approved", subStatus)

		// 4. Baseline snapshot persisted in baselines table
		var versionTag string
		var snapshotJSON []byte
		err = testDB.QueryRow(`
			SELECT version_tag, snapshot FROM baselines WHERE id = $1
		`, publishedBaselineID).Scan(&versionTag, &snapshotJSON)
		require.NoError(t, err)
		assert.Equal(t, "v1.0", versionTag)
		assert.Contains(t, string(snapshotJSON), "order-api")

		// 5. Append-only audit logs created for CIs, Edges, and Baseline
		var auditCount int
		err = testDB.QueryRow(`
			SELECT count(*) FROM audit_logs WHERE affected_owner_group_ids @> ARRAY[$1::uuid]
		`, teamGroupID).Scan(&auditCount)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, auditCount, 4, "Expected audit entries for CIs, Edge, and Baseline")
	})

	t.Run("Idempotent re-submission returns HTTP 200 OK with existing baseline", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/intake/"+rawToken+"/submit", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "idemp-key-order-fintech-001")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)

		var baselineResp gen.BaselineResponse
		err := json.Unmarshal(rec.Body.Bytes(), &baselineResp)
		require.NoError(t, err)

		assert.Equal(t, publishedBaselineID, baselineResp.BaselineId)
		assert.Equal(t, "v1.0", baselineResp.VersionTag)
		assert.Equal(t, 2, baselineResp.CiCount)
	})

	t.Run("Submitting an expired token returns 401 Unauthorized", func(t *testing.T) {
		expToken := "tok_submit_expired_" + strings.Repeat("x", 40)
		expHash := hex.EncodeToString(sha256HashBytes([]byte(expToken)))

		expGroupID := uuid.New()
		expSlug := fmt.Sprintf("exp-submit-%s", uuid.New().String()[:8])
		_, err := testDB.Exec(`
			INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
			VALUES ($1, 'Expired Group', $2, 'FinTech', 'Carlos Orders', 'carlos.orders@example.com')
		`, expGroupID, expSlug)
		require.NoError(t, err)

		expInvID := uuid.New()
		_, err = testDB.Exec(`
			INSERT INTO intake_invitations (id, campaign_id, owner_group_id, token_hash, team_lead_email, status, expires_at)
			VALUES ($1, $2, $3, $4, 'carlos.orders@example.com', 'expired', now() - interval '2 hours')
		`, expInvID, campaignID, expGroupID, expHash)
		require.NoError(t, err)

		_, err = testDB.Exec(`
			INSERT INTO intake_submissions (id, invitation_id, owner_group_id, status, payload, lock_version)
			VALUES ($1, $2, $3, 'draft', '{}', 1)
		`, uuid.New(), expInvID, expGroupID)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/intake/"+expToken+"/submit", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("Submitting a non-existent token returns 404 Not Found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/intake/non_existent_submit_token/submit", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusNotFound, rec.Code)
	})
}
