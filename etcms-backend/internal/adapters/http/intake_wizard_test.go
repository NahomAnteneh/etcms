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

func seedIntakeWizardTestPrerequisites(t *testing.T) (adminID uuid.UUID, groupID uuid.UUID, rawToken string, campaignID uuid.UUID, sharedDBID uuid.UUID) {
	adminID = uuid.New()
	groupID = uuid.New()
	campaignID = uuid.New()
	sharedDBID = uuid.New()

	slug := fmt.Sprintf("payments-team-%s", uuid.New().String()[:8])

	// Create owner group
	_, err := testDB.Exec(`
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES ($1, 'Payments Engineering', $2, 'FinTech', 'Sarah Pay', 'sarah.pay@example.com')
	`, groupID, slug)
	require.NoError(t, err)

	// Create admin user
	_, err = testDB.Exec(`
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES ($1, $2, 'Admin Platform', 'platform_admin', $3)
	`, adminID, fmt.Sprintf("admin-%s@example.com", adminID.String()[:8]), groupID)
	require.NoError(t, err)

	// Create active campaign
	deadline := time.Now().UTC().Add(7 * 24 * time.Hour)
	_, err = testDB.Exec(`
		INSERT INTO intake_campaigns (id, title, status, deadline, created_by)
		VALUES ($1, 'Q2 Payments Baseline Campaign', 'active', $2, $3)
	`, campaignID, deadline, adminID)
	require.NoError(t, err)

	// Generate token and invitation
	rawToken = "tok_" + strings.Repeat("a", 60)
	invID := uuid.New()

	h := sha256.Sum256([]byte(rawToken))
	tokenHash := hex.EncodeToString(h[:])

	_, err = testDB.Exec(`
		INSERT INTO intake_invitations (id, campaign_id, owner_group_id, token_hash, team_lead_email, status, expires_at)
		VALUES ($1, $2, $3, $4, 'sarah.pay@example.com', 'sent', $5)
	`, invID, campaignID, groupID, tokenHash, deadline)
	require.NoError(t, err)

	// Create initial draft submission with lock_version = 1
	subID := uuid.New()
	_, err = testDB.Exec(`
		INSERT INTO intake_submissions (id, invitation_id, owner_group_id, status, payload, lock_version)
		VALUES ($1, $2, $3, 'draft', '{}', 1)
	`, subID, invID, groupID)
	require.NoError(t, err)

	// Seed an existing active CI for this group (to test existing_cis retrieval)
	ciID := uuid.New()
	_, err = testDB.Exec(`
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, class_metadata)
		VALUES ($1, 'payment-gateway-svc', 'application', 'prod', 'in_service', 'tier_1', $2, 'Sarah Pay', 'https://pay.internal.net', '{"runtime": "go", "framework": "chi"}')
	`, ciID, groupID)
	require.NoError(t, err)

	// Seed a retired CI for this group (should NOT appear in existing_cis)
	retiredCIID := uuid.New()
	_, err = testDB.Exec(`
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact)
		VALUES ($1, 'legacy-payment-worker', 'application', 'prod', 'retired', 'tier_3', $2, 'Sarah Pay')
	`, retiredCIID, groupID)
	require.NoError(t, err)

	// Seed a shared infrastructure database owned by Data Platform (for search-first dependency picker test)
	dbOwnerGroupID := uuid.New()
	dbSlug := fmt.Sprintf("dba-team-%s", uuid.New().String()[:8])
	_, err = testDB.Exec(`
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES ($1, 'Database Infrastructure', $2, 'Infrastructure', 'Dave DBA', 'dave.dba@example.com')
	`, dbOwnerGroupID, dbSlug)
	require.NoError(t, err)

	_, err = testDB.Exec(`
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, class_metadata)
		VALUES ($1, 'orders-postgres-cluster', 'database', 'prod', 'in_service', 'tier_0', $2, 'Dave DBA', 'orders-db.internal.net:5432', '{"engine": "postgres", "version": "16"}')
	`, sharedDBID, dbOwnerGroupID)
	require.NoError(t, err)

	return adminID, groupID, rawToken, campaignID, sharedDBID
}

func TestIntakeWizardGuidedFlow(t *testing.T) {
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	_, groupID, rawToken, campaignID, sharedDBID := seedIntakeWizardTestPrerequisites(t)

	t.Run("GET /api/v1/intake/{token} returns pre-populated context and existing active CIs", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/intake/"+rawToken, nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "\"1\"", rec.Header().Get("ETag"))

		var contextResp gen.IntakeContextResponse
		err := json.Unmarshal(rec.Body.Bytes(), &contextResp)
		require.NoError(t, err)

		assert.Equal(t, campaignID, contextResp.CampaignId)
		assert.Equal(t, groupID, contextResp.OwnerGroupId)
		assert.Equal(t, "FinTech", contextResp.DepartmentName)
		assert.Equal(t, "Payments Engineering", contextResp.OwnerGroupName)
		assert.Equal(t, "Sarah Pay", contextResp.TeamLeadName)
		assert.Equal(t, gen.Opened, contextResp.Status)
		assert.Equal(t, 1, contextResp.LockVersion)

		// Assert existing_cis includes the active payment gateway and NOT the retired worker
		require.Len(t, contextResp.ExistingCis, 1)
		ci := contextResp.ExistingCis[0]
		assert.Equal(t, "payment-gateway-svc", ci.Name)
		assert.Equal(t, "application", ci.CiClass)
		assert.Equal(t, gen.CIEnvelopeLifecycleStateInService, ci.LifecycleState)
		assert.Equal(t, "chi", ci.ClassMetadata["framework"])
		require.NotNil(t, ci.Ownership)
		assert.Equal(t, "Payments Engineering", ci.Ownership.OwnerGroupName)
	})

	t.Run("PATCH /api/v1/intake/{token} saves draft with If-Match header and returns new ETag", func(t *testing.T) {
		draftPayload := map[string]interface{}{
			"services": []interface{}{
				map[string]interface{}{
					"name":              "checkout-api",
					"ci_class":          "application",
					"environment":       "prod",
					"criticality_tier":  "tier_1",
					"technical_contact": "Sarah Pay",
					"primary_endpoint":  "https://checkout.internal.net",
					"class_metadata": map[string]interface{}{
						"runtime": "go",
					},
				},
			},
			"dependencies": []interface{}{
				map[string]interface{}{
					"target_ci_id": sharedDBID.String(),
					"edge_type":    "reads_from",
				},
			},
		}

		bodyBytes, err := json.Marshal(gen.SaveDraftRequest{
			Payload: draftPayload,
		})
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodPatch, "/api/v1/intake/"+rawToken, bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("If-Match", "\"1\"")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "\"2\"", rec.Header().Get("ETag"))

		var saveResp gen.SaveDraftResponse
		err = json.Unmarshal(rec.Body.Bytes(), &saveResp)
		require.NoError(t, err)

		assert.Equal(t, 2, saveResp.LockVersion)
		require.NotNil(t, saveResp.Payload)
		assert.Contains(t, saveResp.Payload, "services")

		// Verify re-fetching GET /api/v1/intake/{token} returns the updated draft and lock_version 2
		getReq := httptest.NewRequest(http.MethodGet, "/api/v1/intake/"+rawToken, nil)
		getRec := httptest.NewRecorder()
		router.ServeHTTP(getRec, getReq)

		require.Equal(t, http.StatusOK, getRec.Code)
		assert.Equal(t, "\"2\"", getRec.Header().Get("ETag"))

		var refreshedContext gen.IntakeContextResponse
		err = json.Unmarshal(getRec.Body.Bytes(), &refreshedContext)
		require.NoError(t, err)
		assert.Equal(t, 2, refreshedContext.LockVersion)
		require.NotNil(t, refreshedContext.DraftPayload)
		assert.Contains(t, *refreshedContext.DraftPayload, "services")
	})

	t.Run("Optimistic concurrency conflict returns 412 Precondition Failed when If-Match version is stale", func(t *testing.T) {
		staleDraft := map[string]interface{}{
			"notes": "trying to overwrite with stale version",
		}
		bodyBytes, err := json.Marshal(gen.SaveDraftRequest{
			Payload: staleDraft,
		})
		require.NoError(t, err)

		// Client sends old If-Match: "1" while DB lock_version is already 2
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/intake/"+rawToken, bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("If-Match", "\"1\"")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusPreconditionFailed, rec.Code)
		assert.Contains(t, rec.Body.String(), "Lock version conflict")
	})

	t.Run("Subsequent PATCH with current If-Match: 2 succeeds and increments lock_version to 3", func(t *testing.T) {
		draft := map[string]interface{}{
			"updated_step": "step_c_dependencies",
		}
		bodyBytes, err := json.Marshal(gen.SaveDraftRequest{
			Payload: draft,
		})
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodPatch, "/api/v1/intake/"+rawToken, bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("If-Match", "\"2\"")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "\"3\"", rec.Header().Get("ETag"))

		var saveResp gen.SaveDraftResponse
		err = json.Unmarshal(rec.Body.Bytes(), &saveResp)
		require.NoError(t, err)
		assert.Equal(t, 3, saveResp.LockVersion)
	})

	t.Run("Anti-ITAM enforcement rejects payload containing purchase_cost with 422 Unprocessable Entity", func(t *testing.T) {
		prohibitedDraft := map[string]interface{}{
			"services": []interface{}{
				map[string]interface{}{
					"name":          "illegal-itam-app",
					"purchase_cost": 50000,
				},
			},
		}
		bodyBytes, err := json.Marshal(gen.SaveDraftRequest{
			Payload: prohibitedDraft,
		})
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodPatch, "/api/v1/intake/"+rawToken, bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("If-Match", "\"3\"")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
		assert.Contains(t, rec.Body.String(), "Anti-ITAM")
		assert.Contains(t, rec.Body.String(), "purchase_cost")
	})

	t.Run("Middleware enforces 2MB maximum payload size limit with 413 Payload Too Large", func(t *testing.T) {
		// Create a > 2MB JSON body (2.1 MB)
		largeString := strings.Repeat("x", 2100000)
		largeBody := fmt.Sprintf(`{"payload":{"data":"%s"}}`, largeString)

		req := httptest.NewRequest(http.MethodPatch, "/api/v1/intake/"+rawToken, strings.NewReader(largeBody))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("If-Match", "\"3\"")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
		assert.Contains(t, rec.Body.String(), "Payload Too Large")
	})

	t.Run("Catalog search allows team lead to search existing infrastructure CIs via X-Intake-Token", func(t *testing.T) {
		// Team lead uses X-Intake-Token to search for the shared database
		req := httptest.NewRequest(http.MethodGet, "/api/v1/cis/search?q=postgres", nil)
		req.Header.Set("X-Intake-Token", rawToken)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)

		var searchResp gen.CISearchResponse
		err := json.Unmarshal(rec.Body.Bytes(), &searchResp)
		require.NoError(t, err)

		require.NotEmpty(t, searchResp.Items)
		found := false
		for _, item := range searchResp.Items {
			if item.Ci.Name == "orders-postgres-cluster" {
				found = true
				assert.Equal(t, "database", item.Ci.CiClass)
				assert.Equal(t, sharedDBID, *item.Ci.CiId)
				require.NotNil(t, item.Ci.Ownership)
				assert.Equal(t, "Database Infrastructure", item.Ci.Ownership.OwnerGroupName)
				assert.Equal(t, "Dave DBA", item.Ci.Ownership.TeamLeadName)
				assert.Greater(t, item.Score, float32(0))
			}
		}
		assert.True(t, found, "Expected to find orders-postgres-cluster in catalog search")
	})

	t.Run("Catalog search without any authentication credentials returns 401 Unauthorized", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/cis/search?q=postgres", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("PATCH on expired token returns 401 Unauthorized", func(t *testing.T) {
		expiredToken := "tok_expired_" + strings.Repeat("e", 50)
		expHash := hex.EncodeToString(sha256HashBytes([]byte(expiredToken)))

		expGroupID := uuid.New()
		expSlug := fmt.Sprintf("exp-team-%s", uuid.New().String()[:8])
		_, err := testDB.Exec(`
			INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
			VALUES ($1, 'Expired Team', $2, 'FinTech', 'Sarah Pay', 'sarah.pay@example.com')
		`, expGroupID, expSlug)
		require.NoError(t, err)

		// Seed expired invitation
		expInvID := uuid.New()
		_, err = testDB.Exec(`
			INSERT INTO intake_invitations (id, campaign_id, owner_group_id, token_hash, team_lead_email, status, expires_at)
			VALUES ($1, $2, $3, $4, 'sarah.pay@example.com', 'expired', now() - interval '1 hour')
		`, expInvID, campaignID, expGroupID, expHash)
		require.NoError(t, err)

		_, err = testDB.Exec(`
			INSERT INTO intake_submissions (id, invitation_id, owner_group_id, status, payload, lock_version)
			VALUES ($1, $2, $3, 'draft', '{}', 1)
		`, uuid.New(), expInvID, expGroupID)
		require.NoError(t, err)

		bodyBytes, _ := json.Marshal(gen.SaveDraftRequest{
			Payload: map[string]interface{}{"foo": "bar"},
		})
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/intake/"+expiredToken, bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("If-Match", "\"1\"")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("PATCH on non-existent token returns 404 Not Found", func(t *testing.T) {
		bodyBytes, _ := json.Marshal(gen.SaveDraftRequest{
			Payload: map[string]interface{}{"foo": "bar"},
		})
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/intake/non_existent_token_9999", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("If-Match", "\"1\"")
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusNotFound, rec.Code)
	})
}

func sha256HashBytes(b []byte) []byte {
	h := sha256.Sum256(b)
	return h[:]
}
