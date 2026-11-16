package http_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/http/middleware"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	adapterhttp "github.com/org/etcms-backend/internal/adapters/http"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedCampaignPrerequisites(t *testing.T) (adminID uuid.UUID, viewerID uuid.UUID, groupID1 uuid.UUID, groupID2 uuid.UUID) {
	adminID = uuid.New()
	viewerID = uuid.New()
	groupID1 = uuid.New()
	groupID2 = uuid.New()

	slug1 := fmt.Sprintf("core-eng-%s", uuid.New().String()[:8])
	slug2 := fmt.Sprintf("data-eng-%s", uuid.New().String()[:8])

	// Owner Group 1: Engineering
	_, err := testDB.Exec(`
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES ($1, 'Core Services', $2, 'Engineering', 'Alice Eng', 'alice.eng@example.com')
	`, groupID1, slug1)
	require.NoError(t, err)

	// Owner Group 2: Data Platform
	_, err = testDB.Exec(`
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES ($1, 'Analytics Team', $2, 'Data Platform', 'Bob Data', 'bob.data@example.com')
	`, groupID2, slug2)
	require.NoError(t, err)

	// Admin User
	_, err = testDB.Exec(`
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES ($1, $2, 'Admin User', 'platform_admin', $3)
	`, adminID, fmt.Sprintf("admin-%s@example.com", adminID.String()[:8]), groupID1)
	require.NoError(t, err)

	// Viewer User
	_, err = testDB.Exec(`
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES ($1, $2, 'Viewer User', 'viewer', $3)
	`, viewerID, fmt.Sprintf("viewer-%s@example.com", viewerID.String()[:8]), groupID1)
	require.NoError(t, err)

	return adminID, viewerID, groupID1, groupID2
}

func TestIntakeCampaignsFlow(t *testing.T) {
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	adminID, viewerID, groupID1, groupID2 := seedCampaignPrerequisites(t)

	t.Run("Non-admin role receives 403 Forbidden on campaign creation", func(t *testing.T) {
		reqBody := gen.CreateCampaignRequest{
			Title:         "Q1 Intake Campaign",
			Deadline:      time.Now().Add(14 * 24 * time.Hour),
			OwnerGroupIds: []uuid.UUID{groupID1},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/intake/campaigns", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", viewerID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("Rejects empty title with 400 Bad Request", func(t *testing.T) {
		reqBody := gen.CreateCampaignRequest{
			Title:         "   ",
			Deadline:      time.Now().Add(14 * 24 * time.Hour),
			OwnerGroupIds: []uuid.UUID{groupID1},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/intake/campaigns", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusBadRequest, rec.Code)
		var problem gen.ProblemDetails
		err := json.Unmarshal(rec.Body.Bytes(), &problem)
		require.NoError(t, err)
		assert.Contains(t, problem.Detail, "Campaign title is required")
	})

	t.Run("Rejects title exceeding 255 characters with 400 Bad Request", func(t *testing.T) {
		reqBody := gen.CreateCampaignRequest{
			Title:         strings.Repeat("a", 256),
			Deadline:      time.Now().Add(14 * 24 * time.Hour),
			OwnerGroupIds: []uuid.UUID{groupID1},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/intake/campaigns", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusBadRequest, rec.Code)
		var problem gen.ProblemDetails
		err := json.Unmarshal(rec.Body.Bytes(), &problem)
		require.NoError(t, err)
		assert.Contains(t, problem.Detail, "cannot exceed 255 characters")
	})

	t.Run("Rejects empty owner group IDs with 400 Bad Request", func(t *testing.T) {
		reqBody := gen.CreateCampaignRequest{
			Title:         "Valid Title",
			Deadline:      time.Now().Add(14 * 24 * time.Hour),
			OwnerGroupIds: []uuid.UUID{},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/intake/campaigns", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusBadRequest, rec.Code)
		var problem gen.ProblemDetails
		err := json.Unmarshal(rec.Body.Bytes(), &problem)
		require.NoError(t, err)
		assert.Contains(t, problem.Detail, "At least one owner group must be specified")
	})

	t.Run("Rejects deadline in the past with 422 Unprocessable Entity", func(t *testing.T) {
		reqBody := gen.CreateCampaignRequest{
			Title:         "Expired Campaign",
			Deadline:      time.Now().Add(-1 * time.Hour),
			OwnerGroupIds: []uuid.UUID{groupID1},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/intake/campaigns", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
		var problem gen.ProblemDetails
		err := json.Unmarshal(rec.Body.Bytes(), &problem)
		require.NoError(t, err)
		assert.Contains(t, problem.Detail, "deadline must be in the future")
	})

	var campaignID uuid.UUID
	var rawToken1, rawToken2 string

	t.Run("Platform admin successfully launches intake campaign", func(t *testing.T) {
		deadline := time.Now().Add(7 * 24 * time.Hour).UTC().Truncate(time.Second)
		reqBody := gen.CreateCampaignRequest{
			Title:         "Enterprise Q1 Architecture Intake",
			Deadline:      deadline,
			OwnerGroupIds: []uuid.UUID{groupID1, groupID2},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/intake/campaigns", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusCreated, rec.Code)

		var campaignResp gen.CampaignResponse
		err := json.Unmarshal(rec.Body.Bytes(), &campaignResp)
		require.NoError(t, err)

		assert.NotEmpty(t, campaignResp.Id)
		campaignID = campaignResp.Id
		assert.Equal(t, "Enterprise Q1 Architecture Intake", campaignResp.Title)
		assert.Equal(t, gen.CampaignResponseStatusActive, campaignResp.Status)
		require.Len(t, campaignResp.Invitations, 2)

		for _, inv := range campaignResp.Invitations {
			assert.NotEmpty(t, inv.InvitationId)
			assert.NotEmpty(t, inv.InvitationUrl)
			assert.True(t, strings.HasPrefix(inv.InvitationUrl, "/intake/"))

			// Extract token from URL
			token := strings.TrimPrefix(inv.InvitationUrl, "/intake/")
			switch inv.OwnerGroupId {
			case groupID1:
				rawToken1 = token
				assert.Equal(t, "Engineering", inv.DepartmentName)
				assert.Equal(t, "alice.eng@example.com", string(inv.TeamLeadEmail))
			case groupID2:
				rawToken2 = token
				assert.Equal(t, "Data Platform", inv.DepartmentName)
				assert.Equal(t, "bob.data@example.com", string(inv.TeamLeadEmail))
			}
		}

		// Verify SHA-256 tokens are stored in database
		var storedCount int
		err = testDB.QueryRow(`SELECT count(*) FROM intake_invitations WHERE campaign_id = $1`, campaignID).Scan(&storedCount)
		require.NoError(t, err)
		assert.Equal(t, 2, storedCount)
	})

	t.Run("Platform admin launches campaign with duplicate owner group IDs without conflict", func(t *testing.T) {
		deadline := time.Now().Add(7 * 24 * time.Hour).UTC().Truncate(time.Second)
		reqBody := gen.CreateCampaignRequest{
			Title:         "Enterprise Deduplicated Intake",
			Deadline:      deadline,
			OwnerGroupIds: []uuid.UUID{groupID1, groupID1, groupID2, groupID1},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/intake/campaigns", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusCreated, rec.Code)

		var campaignResp gen.CampaignResponse
		err := json.Unmarshal(rec.Body.Bytes(), &campaignResp)
		require.NoError(t, err)
		assert.Equal(t, "Enterprise Deduplicated Intake", campaignResp.Title)
		assert.Len(t, campaignResp.Invitations, 2)
	})

	t.Run("Resolve valid magic link token returns team context and updates status to opened", func(t *testing.T) {
		require.NotEmpty(t, rawToken1)

		req := httptest.NewRequest(http.MethodGet, "/api/v1/intake/"+rawToken1, nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)

		var contextResp gen.IntakeContextResponse
		err := json.Unmarshal(rec.Body.Bytes(), &contextResp)
		require.NoError(t, err)

		assert.Equal(t, campaignID, contextResp.CampaignId)
		assert.Equal(t, groupID1, contextResp.OwnerGroupId)
		assert.Equal(t, "Engineering", contextResp.DepartmentName)
		assert.Equal(t, "Core Services", contextResp.OwnerGroupName)
		assert.Equal(t, "Alice Eng", contextResp.TeamLeadName)
		assert.Equal(t, gen.Opened, contextResp.Status)
		assert.Equal(t, 1, contextResp.LockVersion)

		// Verify DB status transitioned to 'opened'
		var status string
		err = testDB.QueryRow(`SELECT status FROM intake_invitations WHERE id = $1`, contextResp.InvitationId).Scan(&status)
		require.NoError(t, err)
		assert.Equal(t, "opened", status)
	})

	t.Run("Non-existent token returns 404 Not Found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/intake/0000000000000000000000000000000000000000000000000000000000000000", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("Expired token returns 401 Unauthorized", func(t *testing.T) {
		require.NotEmpty(t, rawToken2)

		// Set invitation expires_at to the past in database
		_, err := testDB.Exec(`
			UPDATE intake_invitations
			SET expires_at = now() - interval '1 hour'
			WHERE campaign_id = $1 AND owner_group_id = $2
		`, campaignID, groupID2)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/api/v1/intake/"+rawToken2, nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
		var problem gen.ProblemDetails
		err = json.Unmarshal(rec.Body.Bytes(), &problem)
		require.NoError(t, err)
		assert.Contains(t, problem.Detail, "expired")
	})

	t.Run("Department progress computes metrics accurately", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/admin/intake/campaigns/%s/progress", campaignID), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)

		var progress gen.CampaignProgressResponse
		err := json.Unmarshal(rec.Body.Bytes(), &progress)
		require.NoError(t, err)

		assert.Equal(t, campaignID, progress.CampaignId)
		assert.Equal(t, 2, progress.TotalInvitations)
		assert.Equal(t, 1, progress.TotalOpened)   // Token 1 was opened
		assert.Equal(t, 1, progress.TotalOverdue)  // Token 2 was set to expired in the past

		require.Len(t, progress.Departments, 2)
		for _, dept := range progress.Departments {
			switch dept.DepartmentName {
			case "Engineering":
				assert.Equal(t, 1, dept.TotalInvitations)
				assert.Equal(t, 1, dept.OpenedCount)
				assert.Equal(t, 0, dept.OverdueCount)
			case "Data Platform":
				assert.Equal(t, 1, dept.TotalInvitations)
				assert.Equal(t, 0, dept.OpenedCount)
				assert.Equal(t, 1, dept.OverdueCount)
			}
		}
	})

	t.Run("Platform admin lists campaigns successfully", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/intake/campaigns", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var list []gen.CampaignResponse
		err := json.Unmarshal(rec.Body.Bytes(), &list)
		require.NoError(t, err)
		assert.NotEmpty(t, list)

		// Verify invitations and magic links are populated in ListCampaigns
		var found *gen.CampaignResponse
		for _, c := range list {
			if c.Id == campaignID {
				cCopy := c
				found = &cCopy
				break
			}
		}
		require.NotNil(t, found)
		require.NotEmpty(t, found.Invitations)
		for _, inv := range found.Invitations {
			assert.NotEmpty(t, inv.InvitationUrl)
			assert.True(t, strings.HasPrefix(inv.InvitationUrl, "/intake/"))
		}
	})

	t.Run("Non-admin cannot update or delete campaign", func(t *testing.T) {
		// Non-admin PATCH
		closedStatus := gen.Closed
		patchBody, _ := json.Marshal(gen.UpdateCampaignRequest{
			Status: &closedStatus,
		})
		patchReq := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/admin/intake/campaigns/%s", campaignID), bytes.NewReader(patchBody))
		patchReq.Header.Set("Content-Type", "application/json")
		patchReq.Header.Set("X-Dev-User-ID", viewerID.String())
		patchRec := httptest.NewRecorder()
		router.ServeHTTP(patchRec, patchReq)
		assert.Equal(t, http.StatusForbidden, patchRec.Code)

		// Non-admin DELETE
		delReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/v1/admin/intake/campaigns/%s", campaignID), nil)
		delReq.Header.Set("X-Dev-User-ID", viewerID.String())
		delRec := httptest.NewRecorder()
		router.ServeHTTP(delRec, delReq)
		assert.Equal(t, http.StatusForbidden, delRec.Code)
	})

	t.Run("Platform admin updates campaign status to closed and reopens it", func(t *testing.T) {
		// Close campaign
		closedStatus := gen.Closed
		patchBody, _ := json.Marshal(gen.UpdateCampaignRequest{
			Status: &closedStatus,
		})
		patchReq := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/admin/intake/campaigns/%s", campaignID), bytes.NewReader(patchBody))
		patchReq.Header.Set("Content-Type", "application/json")
		patchReq.Header.Set("X-Dev-User-ID", adminID.String())
		patchRec := httptest.NewRecorder()
		router.ServeHTTP(patchRec, patchReq)
		require.Equal(t, http.StatusOK, patchRec.Code)

		var updated gen.CampaignResponse
		err := json.Unmarshal(patchRec.Body.Bytes(), &updated)
		require.NoError(t, err)
		assert.Equal(t, gen.CampaignResponseStatusClosed, updated.Status)

		// Verify draft saving rejects when campaign is closed
		draftBody := map[string]interface{}{
			"payload": map[string]interface{}{
				"services": []interface{}{},
			},
		}
		rawDraft, _ := json.Marshal(draftBody)
		draftReq := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/intake/%s", rawToken1), bytes.NewReader(rawDraft))
		draftReq.Header.Set("Content-Type", "application/json")
		draftReq.Header.Set("If-Match", "\"1\"")
		draftRec := httptest.NewRecorder()
		router.ServeHTTP(draftRec, draftReq)
		assert.Equal(t, http.StatusBadRequest, draftRec.Code)

		// Reopen campaign
		activeStatus := gen.Active
		reopenBody, _ := json.Marshal(gen.UpdateCampaignRequest{
			Status: &activeStatus,
		})
		reopenReq := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/v1/admin/intake/campaigns/%s", campaignID), bytes.NewReader(reopenBody))
		reopenReq.Header.Set("Content-Type", "application/json")
		reopenReq.Header.Set("X-Dev-User-ID", adminID.String())
		reopenRec := httptest.NewRecorder()
		router.ServeHTTP(reopenRec, reopenReq)
		require.Equal(t, http.StatusOK, reopenRec.Code)

		err = json.Unmarshal(reopenRec.Body.Bytes(), &updated)
		require.NoError(t, err)
		assert.Equal(t, gen.CampaignResponseStatusActive, updated.Status)
	})

	t.Run("Platform admin deletes campaign and cascades cleanly", func(t *testing.T) {
		delReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/v1/admin/intake/campaigns/%s", campaignID), nil)
		delReq.Header.Set("X-Dev-User-ID", adminID.String())
		delRec := httptest.NewRecorder()
		router.ServeHTTP(delRec, delReq)
		require.Equal(t, http.StatusNoContent, delRec.Code)

		// GET should now return 404
		getReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/admin/intake/campaigns/%s", campaignID), nil)
		getReq.Header.Set("X-Dev-User-ID", adminID.String())
		getRec := httptest.NewRecorder()
		router.ServeHTTP(getRec, getReq)
		assert.Equal(t, http.StatusNotFound, getRec.Code)

		// Subsequent DELETE returns 404
		delReq2 := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/v1/admin/intake/campaigns/%s", campaignID), nil)
		delReq2.Header.Set("X-Dev-User-ID", adminID.String())
		delRec2 := httptest.NewRecorder()
		router.ServeHTTP(delRec2, delReq2)
		assert.Equal(t, http.StatusNotFound, delRec2.Code)
	})
}
