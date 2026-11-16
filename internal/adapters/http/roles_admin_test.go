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

func TestCustomRolesAndAdminAPI(t *testing.T) {
	store := postgres.NewStore(testPool)
	adminID := uuid.New()
	_, err := testDB.Exec(`
		INSERT INTO users (id, email, name, role, created_at)
		VALUES ($1, $2, 'Admin Test User', 'platform_admin', now())
	`, adminID, fmt.Sprintf("admin-%s@enterprise.com", uuid.New().String()[:8]))
	require.NoError(t, err)

	systemRoleID := uuid.MustParse("c0000000-0000-0000-0000-000000000001")
	_, err = testDB.Exec(`
		INSERT INTO custom_roles (id, name, description, permissions, is_system, created_at, updated_at)
		VALUES ($1, 'Platform Administrator', 'Full admin', ARRAY['admin:all'], true, now(), now())
		ON CONFLICT (id) DO NOTHING
	`, systemRoleID)
	require.NoError(t, err)

	cfg := middleware.AuthConfig{
		AppEnv:             "test",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	t.Run("ListCustomRoles returns seeded starter roles", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/roles", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)

		var roles []gen.CustomRole
		err := json.Unmarshal(rec.Body.Bytes(), &roles)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, len(roles), 1)

		// First role should be Platform Administrator
		assert.Equal(t, "Platform Administrator", roles[0].Name)
		assert.True(t, roles[0].IsSystem)
	})

	t.Run("CreateCustomRole and DeleteCustomRole lifecycle", func(t *testing.T) {
		// 1. Create role
		desc := "Special role for network security engineers"
		createReq := gen.CreateCustomRoleRequest{
			Name:        "NetSec Engineer " + uuid.New().String()[:8],
			Description: &desc,
			Permissions: []string{"ci:read", "ci:write", "edge:manage"},
		}
		body, _ := json.Marshal(createReq)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/roles", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusCreated, rec.Code)

		var created gen.CustomRole
		err := json.Unmarshal(rec.Body.Bytes(), &created)
		require.NoError(t, err)
		assert.Equal(t, createReq.Name, created.Name)
		assert.False(t, created.IsSystem)
		assert.ElementsMatch(t, createReq.Permissions, created.Permissions)

		// 2. Delete role
		delReq := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/roles/"+created.Id.String(), nil)
		delReq.Header.Set("X-Dev-User-ID", adminID.String())
		delRec := httptest.NewRecorder()

		router.ServeHTTP(delRec, delReq)
		assert.Equal(t, http.StatusNoContent, delRec.Code)
	})

	t.Run("Cannot delete system protected role", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/roles/"+systemRoleID.String(), nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("ListAdminUsers returns admin user", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil)
		req.Header.Set("X-Dev-User-ID", adminID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)

		var users []gen.AdminUserResponse
		err := json.Unmarshal(rec.Body.Bytes(), &users)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, len(users), 1)

		foundAdmin := false
		for _, u := range users {
			if u.Id == adminID {
				foundAdmin = true
				assert.Equal(t, "platform_admin", u.Role)
			}
		}
		assert.True(t, foundAdmin)
	})
}
