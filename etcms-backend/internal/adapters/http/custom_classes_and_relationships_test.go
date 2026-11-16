package http_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	adapterhttp "github.com/org/etcms-backend/internal/adapters/http"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/http/middleware"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCustomRelationshipsAndCategories(t *testing.T) {
	store := postgres.NewStore(testPool)
	adminID := uuid.New()
	_, err := testDB.Exec(`
		INSERT INTO users (id, email, name, role, created_at)
		VALUES ($1, $2, 'Admin Test User', 'platform_admin', now())
	`, adminID, fmt.Sprintf("admin-%s@enterprise.com", uuid.New().String()[:8]))
	require.NoError(t, err)

	ownerGroupID := uuid.New()
	_, err = testDB.Exec(`
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email, created_at)
		VALUES ($1, 'Core Infra', 'core-infra', 'Engineering', 'Lead', 'lead@test.com', now())
	`, ownerGroupID)
	require.NoError(t, err)

	cfg := middleware.AuthConfig{
		AppEnv:             "test",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	t.Run("Categories: Full CRUD and 409 Deletion Protection", func(t *testing.T) {
		// 1. Create a category
		createCatBody := map[string]interface{}{
			"id":          "cloud_services",
			"name":        "Cloud Services",
			"description": "Public and private cloud platform components",
			"icon":        "Cloud",
			"color":       "sky",
		}
		bodyBytes, _ := json.Marshal(createCatBody)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/categories", bytes.NewReader(bodyBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusCreated, rec.Code)

		var createdCat gen.CategoryDefinition
		err = json.Unmarshal(rec.Body.Bytes(), &createdCat)
		require.NoError(t, err)
		assert.Equal(t, "cloud_services", createdCat.Id)
		assert.Equal(t, "Cloud Services", createdCat.Name)

		// 2. Create a CI class in this category
		classID := "s3_bucket_" + uuid.New().String()[:6]
		createClassBody := map[string]interface{}{
			"id":          classID,
			"label":       "S3 Object Bucket",
			"category":    "Cloud Services",
			"description": "Scalable object storage bucket",
			"icon":        "HardDrive",
			"attributes":  []string{"bucket_name", "region"},
			"form_fields": []map[string]interface{}{
				{"name": "bucket_name", "label": "Bucket Name", "type": "text", "required": true},
			},
		}
		cBytes, _ := json.Marshal(createClassBody)
		req = httptest.NewRequest(http.MethodPost, "/api/v1/admin/ci-classes", bytes.NewReader(cBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusCreated, rec.Code)

		// 3. Attempting to delete category while class belongs to it must return 409 Conflict
		req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/categories/cloud_services", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusConflict, rec.Code)

		// 4. Delete the class (since it has 0 CIs, deletion must succeed)
		req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/ci-classes/"+classID, nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNoContent, rec.Code)

		// 5. Now delete the category -> should succeed with 204 No Content
		req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/categories/cloud_services", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNoContent, rec.Code)
	})

	t.Run("CI Class Deletion Protection when active CIs exist", func(t *testing.T) {
		classID := "custom_vm_" + uuid.New().String()[:6]
		createClassBody := map[string]interface{}{
			"id":          classID,
			"label":       "Custom VM",
			"category":    "Infrastructure",
			"description": "VM instance",
			"icon":        "Server",
			"attributes":  []string{"server_name"},
		}
		cBytes, _ := json.Marshal(createClassBody)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ci-classes", bytes.NewReader(cBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusCreated, rec.Code)

		// Insert a CI of this class
		ciID := uuid.New()
		_, err = testDB.Exec(`
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, created_at, updated_at)
			VALUES ($1, $2, $3, 'prod', 'synced', 'tier_1', $4, 'contact@test.com', now(), now())
		`, ciID, "vm-srv-"+uuid.New().String()[:6], classID, ownerGroupID)
		require.NoError(t, err)

		// Deleting classID must now fail with 409 Conflict
		req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/ci-classes/"+classID, nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusConflict, rec.Code)

		// Delete the CI
		_, err = testDB.Exec(`DELETE FROM cis WHERE ci_id = $1`, ciID)
		require.NoError(t, err)

		// Now deletion of CI class must succeed with 204 No Content
		req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/ci-classes/"+classID, nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNoContent, rec.Code)
	})

	t.Run("Relationships: Full CRUD and 409 Deletion Protection when active edges exist", func(t *testing.T) {
		// 1. Create a custom relationship type
		relID := "replicates_to_" + uuid.New().String()[:6]
		createRelBody := map[string]interface{}{
			"id":            relID,
			"label":         "Replicates To",
			"reverse_label": "Replicated From",
			"description":   "Asynchronous block or database replication",
			"color":         "emerald",
		}
		rBytes, _ := json.Marshal(createRelBody)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/relationship-types", bytes.NewReader(rBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusCreated, rec.Code)

		// 2. Create two CIs
		ci1 := uuid.New()
		ci2 := uuid.New()
		_, err = testDB.Exec(`
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, created_at, updated_at)
			VALUES 
				($1, $3, 'database', 'prod', 'synced', 'tier_1', $5, 'admin@test.com', now(), now()),
				($2, $4, 'database', 'prod', 'synced', 'tier_1', $5, 'admin@test.com', now(), now())
		`, ci1, ci2, "db-primary-"+uuid.New().String()[:6], "db-replica-"+uuid.New().String()[:6], ownerGroupID)
		require.NoError(t, err)

		// 3. Create an edge using this custom relationship type
		createEdgeBody := map[string]interface{}{
			"source_ci_id": ci1.String(),
			"target_ci_id": ci2.String(),
			"edge_type":    relID,
		}
		eBytes, _ := json.Marshal(createEdgeBody)
		req = httptest.NewRequest(http.MethodPost, "/api/v1/edges", bytes.NewReader(eBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusCreated, rec.Code)

		var edgeResp gen.EdgeResponse
		err = json.Unmarshal(rec.Body.Bytes(), &edgeResp)
		require.NoError(t, err)
		assert.Equal(t, relID, edgeResp.EdgeType)

		// 4. Attempting to delete relationship type while edge exists must return 409 Conflict
		req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/relationship-types/"+relID, nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusConflict, rec.Code)

		// 5. Delete the edge
		req = httptest.NewRequest(http.MethodDelete, "/api/v1/edges/"+edgeResp.Id.String(), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNoContent, rec.Code)

		// 6. Delete relationship type must now succeed
		req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/relationship-types/"+relID, nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNoContent, rec.Code)
	})
}
