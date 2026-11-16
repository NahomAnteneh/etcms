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
	"github.com/org/etcms-backend/internal/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

func TestAuthAndDynamicCIClassFlow(t *testing.T) {
	store := postgres.NewStore(testPool)

	// Create a test user with a hashed password
	rawPassword := "EnterpriseSecure123!"
	hashed, err := bcrypt.GenerateFromPassword([]byte(rawPassword), bcrypt.DefaultCost)
	require.NoError(t, err)

	userEmail := fmt.Sprintf("auth-test-%s@enterprise.com", uuid.New().String()[:8])
	adminUserID := uuid.New()
	_, err = testDB.Exec(`
		INSERT INTO users (id, email, name, role, password_hash, status, created_at, updated_at)
		VALUES ($1, $2, 'Auth Test Admin', 'platform_admin', $3, 'active', now(), now())
	`, adminUserID, userEmail, string(hashed))
	require.NoError(t, err)

	cfg := middleware.AuthConfig{
		AppEnv:             "test",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	var sessionToken string
	var sessionID string

	t.Run("POST /api/v1/auth/login - 401 Invalid Credentials", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{
			"email":    userEmail,
			"password": "WrongPassword!",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("POST /api/v1/auth/login - 200 Success with Session Token", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{
			"email":    userEmail,
			"password": rawPassword,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)
		var resp gen.LoginResponse
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))

		assert.NotEmpty(t, resp.Token)
		assert.Equal(t, userEmail, string(resp.User.Email))
		assert.Equal(t, "platform_admin", string(resp.User.Role))
		sessionToken = resp.Token
	})

	t.Run("GET /api/v1/auth/sessions - 200 OK Lists Active Sessions", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/sessions", nil)
		req.Header.Set("Authorization", "Bearer "+sessionToken)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)
		var sessions []gen.UserSessionResponse
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &sessions))

		assert.NotEmpty(t, sessions)
		sessionID = sessions[0].Id.String()
	})

	t.Run("Create and Read CI Class with Rich Dynamic Form Fields (e.g. VM Server)", func(t *testing.T) {
		reqTrue := true
		// Define VM Server with 5 fields: server_name, ip_address, operating_system, memory_size, allocated_storage
		fields := []gen.CIFormField{
			{Name: "server_name", Label: "Server Name", Type: "text", Required: &reqTrue},
			{Name: "ip_address", Label: "IP Address", Type: "text", Required: &reqTrue},
			{Name: "operating_system", Label: "Operating System", Type: "select", Required: &reqTrue},
			{Name: "memory_size", Label: "Memory Size", Type: "text", Required: &reqTrue},
			{Name: "allocated_storage", Label: "Allocated Storage", Type: "text", Required: &reqTrue},
		}

		classID := fmt.Sprintf("custom_vm_%s", uuid.New().String()[:6])
		reqDTO := service.CreateCIClassRequestDTO{
			ID:          classID,
			Label:       "Custom VM Server",
			Category:    "Infrastructure",
			Description: "Custom compute instance with dynamic form definition",
			Icon:        "Server",
			Attributes:  []string{"server_name", "ip_address", "operating_system", "memory_size", "allocated_storage"},
			FormFields:  fields,
		}

		body, _ := json.Marshal(reqDTO)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ci-classes", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+sessionToken)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusCreated, rec.Code)
		var created gen.CIClassDefinition
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))
		assert.Equal(t, classID, created.Id)
		require.NotNil(t, created.FormFields)
		assert.Len(t, *created.FormFields, 5)

		// Create an owner group to own this CI
		ownerGroupID := uuid.New()
		_, err := testDB.Exec(`
			INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email, created_at)
			VALUES ($1, 'Cloud Ops', 'cloud-ops', 'Platform', 'Sarah Lead', 'sarah.lead@enterprise.com', now())
		`, ownerGroupID)
		require.NoError(t, err)

		// Create a CI of this class with 5 metadata fields (relaxing previous <=2 constraint)
		richMeta := map[string]string{
			"server_name":       "srv-prod-east-01",
			"ip_address":        "10.240.10.15",
			"operating_system":  "Ubuntu 22.04 LTS",
			"memory_size":       "64 GB",
			"allocated_storage": "1 TB NVMe",
		}
		techContact := "ops@enterprise.com"
		ciReq := gen.CreateCIRequest{
			Name:             "East Prod VM 01",
			CiClass:          classID,
			OwnerGroupId:     &ownerGroupID,
			Environment:      gen.CreateCIRequestEnvironmentProd,
			CriticalityTier:  gen.CreateCIRequestCriticalityTierTier2,
			TechnicalContact: &techContact,
			ClassMetadata:    &richMeta,
		}
		ciBody, _ := json.Marshal(ciReq)
		reqCI := httptest.NewRequest(http.MethodPost, "/api/v1/cis", bytes.NewReader(ciBody))
		reqCI.Header.Set("Content-Type", "application/json")
		reqCI.Header.Set("Authorization", "Bearer "+sessionToken)
		recCI := httptest.NewRecorder()
		router.ServeHTTP(recCI, reqCI)

		require.Equal(t, http.StatusCreated, recCI.Code)
		var env gen.CIEnvelope
		require.NoError(t, json.Unmarshal(recCI.Body.Bytes(), &env))
		assert.Equal(t, "East Prod VM 01", env.Name)
		assert.Equal(t, classID, env.CiClass)
		require.NotNil(t, env.ClassMetadata)
		assert.Len(t, env.ClassMetadata, 5)
		assert.Equal(t, "srv-prod-east-01", env.ClassMetadata["server_name"])
		assert.Equal(t, "10.240.10.15", env.ClassMetadata["ip_address"])
		assert.Equal(t, "Ubuntu 22.04 LTS", env.ClassMetadata["operating_system"])

		// Also verify creating a CI without specifying owner_group_id and technical_contact:
		// Backend defaults to creator's owner group and email.
		defaultReq := gen.CreateCIRequest{
			Name:            "Default Owner CI",
			CiClass:         classID,
			Environment:     gen.CreateCIRequestEnvironmentProd,
			CriticalityTier: gen.CreateCIRequestCriticalityTierTier3,
		}
		defaultBody, _ := json.Marshal(defaultReq)
		reqDefault := httptest.NewRequest(http.MethodPost, "/api/v1/cis", bytes.NewReader(defaultBody))
		reqDefault.Header.Set("Content-Type", "application/json")
		reqDefault.Header.Set("Authorization", "Bearer "+sessionToken)
		recDefault := httptest.NewRecorder()
		router.ServeHTTP(recDefault, reqDefault)

		require.Equal(t, http.StatusCreated, recDefault.Code, recDefault.Body.String())
		var defaultEnv gen.CIEnvelope
		require.NoError(t, json.Unmarshal(recDefault.Body.Bytes(), &defaultEnv))
		assert.Equal(t, "Default Owner CI", defaultEnv.Name)
		assert.NotEmpty(t, defaultEnv.Ownership.OwnerGroupId, "expected creator's owner group to be assigned by default")
		assert.Equal(t, userEmail, defaultEnv.Ownership.TechnicalContact, "expected creator's email to be technical contact by default")
	})

	t.Run("POST /api/v1/auth/logout - 200 OK Logs out", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
		req.Header.Set("Authorization", "Bearer "+sessionToken)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)

		// Subsequent authenticated request using the revoked token should fail with 401
		reqCheck := httptest.NewRequest(http.MethodGet, "/api/v1/auth/sessions", nil)
		reqCheck.Header.Set("Authorization", "Bearer "+sessionToken)
		recCheck := httptest.NewRecorder()
		router.ServeHTTP(recCheck, reqCheck)

		assert.Equal(t, http.StatusUnauthorized, recCheck.Code)
	})

	_ = sessionID
}
