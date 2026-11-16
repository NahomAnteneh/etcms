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
	"github.com/org/etcms-backend/internal/adapters/http/middleware"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	"github.com/org/etcms-backend/internal/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOwnerGroupsAndCIClassesAdminAPI(t *testing.T) {
	store := postgres.NewStore(testPool)
	adminID := uuid.New()
	_, err := testDB.Exec(`
		INSERT INTO users (id, email, name, role, created_at)
		VALUES ($1, $2, 'Admin Test User', 'platform_admin', now())
	`, adminID, fmt.Sprintf("admin-%s@enterprise.com", uuid.New().String()[:8]))
	require.NoError(t, err)

	viewerID := uuid.New()
	_, err = testDB.Exec(`
		INSERT INTO users (id, email, name, role, created_at)
		VALUES ($1, $2, 'Viewer Test User', 'viewer', now())
	`, viewerID, fmt.Sprintf("viewer-%s@enterprise.com", uuid.New().String()[:8]))
	require.NoError(t, err)

	cfg := middleware.AuthConfig{
		AppEnv:             "test",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	var createdGroupID string

	t.Run("POST /api/v1/owner-groups - 403 Forbidden for viewer", func(t *testing.T) {
		body, _ := json.Marshal(service.CreateOwnerGroupRequestDTO{
			Name:           "Security Operations",
			DepartmentName: "Infosec",
			TeamLeadName:   "Alice Sec",
			TeamLeadEmail:  "alice.sec@enterprise.com",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/owner-groups", bytes.NewReader(body))
		req.Header.Set("X-Dev-User-ID", viewerID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("POST /api/v1/owner-groups - 201 Created for platform_admin", func(t *testing.T) {
		body, _ := json.Marshal(service.CreateOwnerGroupRequestDTO{
			Name:           "Security Operations",
			DepartmentName: "Infosec",
			TeamLeadName:   "Alice Sec",
			TeamLeadEmail:  "alice.sec@enterprise.com",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/owner-groups", bytes.NewReader(body))
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusCreated, rec.Code)

		var group service.OwnerGroupDTO
		err := json.Unmarshal(rec.Body.Bytes(), &group)
		require.NoError(t, err)
		assert.Equal(t, "Security Operations", group.Name)
		assert.Equal(t, "security-operations", group.Slug)
		assert.Equal(t, "Infosec", group.DepartmentName)
		assert.NotEmpty(t, group.ID)
		createdGroupID = group.ID.String()
	})

	t.Run("PUT /api/v1/owner-groups/{id} - 200 OK updates group", func(t *testing.T) {
		body, _ := json.Marshal(service.UpdateOwnerGroupRequestDTO{
			Name:           "Security Operations & Threat",
			DepartmentName: "Infosec & Cyber",
			TeamLeadName:   "Alice Sec-Lead",
			TeamLeadEmail:  "alice.threat@enterprise.com",
		})
		req := httptest.NewRequest(http.MethodPut, "/api/v1/owner-groups/"+createdGroupID, bytes.NewReader(body))
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)

		var group service.OwnerGroupDTO
		err := json.Unmarshal(rec.Body.Bytes(), &group)
		require.NoError(t, err)
		assert.Equal(t, "Security Operations & Threat", group.Name)
	})

	t.Run("DELETE /api/v1/owner-groups/{id} - 204 No Content deletes unlinked group", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/owner-groups/"+createdGroupID, nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNoContent, rec.Code)
	})

	t.Run("GET /api/v1/admin/ci-classes - 200 OK returns system classes", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/ci-classes", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)

		var classes []service.CIClassDTO
		err := json.Unmarshal(rec.Body.Bytes(), &classes)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, len(classes), 6)
	})

	t.Run("POST /api/v1/admin/ci-classes - 201 Created registers custom class", func(t *testing.T) {
		body, _ := json.Marshal(service.CreateCIClassRequestDTO{
			ID:          "message_queue",
			Label:       "Message Queue",
			Category:    "Infrastructure",
			Description: "Kafka topic or RabbitMQ exchange",
			Icon:        "Radio",
			Attributes:  []string{"engine", "partition_count"},
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ci-classes", bytes.NewReader(body))
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusCreated, rec.Code)

		var cls service.CIClassDTO
		err := json.Unmarshal(rec.Body.Bytes(), &cls)
		require.NoError(t, err)
		assert.Equal(t, "message_queue", cls.ID)
		assert.Equal(t, "Message Queue", cls.Label)
		assert.False(t, cls.IsSystem)
	})

	t.Run("PUT /api/v1/admin/ci-classes/{id} - 200 OK updates custom class", func(t *testing.T) {
		body, _ := json.Marshal(service.UpdateCIClassRequestDTO{
			Label:       "Streaming Queue",
			Category:    "Infrastructure",
			Description: "Distributed streaming event bus",
			Icon:        "Workflow",
			Attributes:  []string{"engine", "partitions", "retention_hours"},
		})
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/ci-classes/message_queue", bytes.NewReader(body))
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)

		var cls service.CIClassDTO
		err := json.Unmarshal(rec.Body.Bytes(), &cls)
		require.NoError(t, err)
		assert.Equal(t, "Streaming Queue", cls.Label)
	})

	t.Run("DELETE /api/v1/admin/ci-classes/{id} - 204 No Content deletes custom class", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/ci-classes/message_queue", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusNoContent, rec.Code)
	})
}
