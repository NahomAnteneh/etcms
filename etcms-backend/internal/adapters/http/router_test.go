package http_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	goose "github.com/pressly/goose/v3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	testcontainers "github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	adapterhttp "github.com/org/etcms-backend/internal/adapters/http"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/http/middleware"
	"github.com/org/etcms-backend/internal/adapters/postgres"
)

var (
	testPool *pgxpool.Pool
	testDB   *sql.DB
)

func TestMain(m *testing.M) {
	ctx := context.Background()

	pgContainer, err := tcpostgres.Run(ctx,
		"postgres:16-alpine",
		tcpostgres.WithDatabase("etcms"),
		tcpostgres.WithUsername("etcms"),
		tcpostgres.WithPassword("etcms_password"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to start postgres container: %v\n", err)
		os.Exit(1)
	}

	connStr, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		_ = pgContainer.Terminate(ctx)
		fmt.Fprintf(os.Stderr, "failed to get connection string: %v\n", err)
		os.Exit(1)
	}

	testPool, err = pgxpool.New(ctx, connStr)
	if err != nil {
		_ = pgContainer.Terminate(ctx)
		fmt.Fprintf(os.Stderr, "failed to create pgxpool: %v\n", err)
		os.Exit(1)
	}

	testDB, err = sql.Open("pgx", connStr)
	if err != nil {
		testPool.Close()
		_ = pgContainer.Terminate(ctx)
		fmt.Fprintf(os.Stderr, "failed to open db: %v\n", err)
		os.Exit(1)
	}

	if err := goose.SetDialect("postgres"); err != nil {
		testPool.Close()
		_ = testDB.Close()
		_ = pgContainer.Terminate(ctx)
		fmt.Fprintf(os.Stderr, "failed to set dialect: %v\n", err)
		os.Exit(1)
	}

	migDir := filepath.Join("..", "..", "..", "migrations")
	if _, err := os.Stat(migDir); os.IsNotExist(err) {
		migDir = filepath.Join("..", "..", "migrations")
		if _, err := os.Stat(migDir); os.IsNotExist(err) {
			migDir = "migrations"
		}
	}
	if err := goose.Up(testDB, migDir); err != nil {
		testPool.Close()
		_ = testDB.Close()
		_ = pgContainer.Terminate(ctx)
		fmt.Fprintf(os.Stderr, "failed to run migrations: %v\n", err)
		os.Exit(1)
	}

	code := m.Run()

	testPool.Close()
	_ = testDB.Close()
	_ = pgContainer.Terminate(ctx)

	os.Exit(code)
}

func seedUserAndOwnerGroup(t *testing.T) (uuid.UUID, uuid.UUID) {
	ownerGroupID := uuid.New()
	userID := uuid.New()
	slug := fmt.Sprintf("group-%s", uuid.New().String()[:8])
	email := fmt.Sprintf("user-%s@example.com", uuid.New().String()[:8])

	_, err := testDB.Exec(`
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES ($1, 'Infrastructure', $2, 'Ops', 'Jane Doe', 'jane@example.com')
	`, ownerGroupID, slug)
	require.NoError(t, err)

	_, err = testDB.Exec(`
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES ($1, $2, 'Jane User', 'team_lead', $3)
	`, userID, email, ownerGroupID)
	require.NoError(t, err)

	_, err = testDB.Exec(`
		INSERT INTO user_owner_groups (user_id, owner_group_id)
		VALUES ($1, $2)
	`, userID, ownerGroupID)
	require.NoError(t, err)

	return ownerGroupID, userID
}

func TestEnvironmentGuard(t *testing.T) {
	store := postgres.NewStore(testPool)

	t.Run("Refuses boot if APP_ENV=production and ALLOW_DEV_AUTH_HEADER=true", func(t *testing.T) {
		cfg := middleware.AuthConfig{
			AppEnv:             "production",
			AllowDevAuthHeader: true,
		}
		_, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "security violation: ALLOW_DEV_AUTH_HEADER=true is strictly prohibited")
	})

	t.Run("Refuses boot if APP_ENV=staging and ALLOW_DEV_AUTH_HEADER=true", func(t *testing.T) {
		cfg := middleware.AuthConfig{
			AppEnv:             "staging",
			AllowDevAuthHeader: true,
		}
		_, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "security violation")
	})

	t.Run("Allows boot if APP_ENV=development and ALLOW_DEV_AUTH_HEADER=true", func(t *testing.T) {
		cfg := middleware.AuthConfig{
			AppEnv:             "development",
			AllowDevAuthHeader: true,
		}
		router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
		require.NoError(t, err)
		assert.NotNil(t, router)
	})
}

func TestHealthAndReadinessEndpoints(t *testing.T) {
	store := postgres.NewStore(testPool)
	cfg := middleware.AuthConfig{
		AppEnv:             "development",
		AllowDevAuthHeader: true,
	}
	router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
	require.NoError(t, err)

	t.Run("GET /api/v1/healthz returns 200 OK", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.HealthResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, gen.Ok, resp.Status)
		assert.Equal(t, "3.0.0", resp.Version)
	})

	t.Run("GET /api/v1/readyz returns 200 Ready", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/readyz", nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.ReadyResponse
		err := json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, gen.Ready, resp.Status)
		assert.Equal(t, gen.Connected, resp.Database)
	})
}

func TestUserAndOwnerGroupEndpoints(t *testing.T) {
	store := postgres.NewStore(testPool)
	ownerGroupID, userID := seedUserAndOwnerGroup(t)

	t.Run("Production ignores X-Dev-User-ID and returns 401", func(t *testing.T) {
		cfg := middleware.AuthConfig{
			AppEnv:             "production",
			AllowDevAuthHeader: false,
		}
		router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
		req.Header.Set("X-Dev-User-ID", userID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("Development accepts X-Dev-User-ID and returns user profile", func(t *testing.T) {
		cfg := middleware.AuthConfig{
			AppEnv:             "development",
			AllowDevAuthHeader: true,
		}
		router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
		req.Header.Set("X-Dev-User-ID", userID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var resp gen.User
		err = json.Unmarshal(rec.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, userID.String(), resp.Id.String())
		assert.Equal(t, gen.TeamLead, resp.Role)
	})

	t.Run("Development accepts X-Dev-User-ID on /api/v1/owner-groups", func(t *testing.T) {
		cfg := middleware.AuthConfig{
			AppEnv:             "development",
			AllowDevAuthHeader: true,
		}
		router, err := adapterhttp.NewRouter(store, cfg, "3.0.0")
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/api/v1/owner-groups", nil)
		req.Header.Set("X-Dev-User-ID", userID.String())
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		var groups []gen.OwnerGroup
		err = json.Unmarshal(rec.Body.Bytes(), &groups)
		require.NoError(t, err)
		assert.NotEmpty(t, groups)

		found := false
		for _, g := range groups {
			if g.Id.String() == ownerGroupID.String() {
				found = true
				break
			}
		}
		assert.True(t, found, "seeded owner group should be in the list")
	})
}
