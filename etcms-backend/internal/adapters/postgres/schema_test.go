package postgres_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	goose "github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
	testcontainers "github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

var (
	testDB      *sql.DB
	testPool    *pgxpool.Pool
	testConnStr string
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
	testConnStr = connStr

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

	// Apply goose migrations
	if err := goose.SetDialect("postgres"); err != nil {
		_ = testDB.Close()
		_ = pgContainer.Terminate(ctx)
		fmt.Fprintf(os.Stderr, "failed to set goose dialect: %v\n", err)
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
		_ = testDB.Close()
		_ = pgContainer.Terminate(ctx)
		fmt.Fprintf(os.Stderr, "failed to apply migrations: %v\n", err)
		os.Exit(1)
	}

	code := m.Run()

	testPool.Close()
	_ = testDB.Close()
	_ = pgContainer.Terminate(ctx)

	os.Exit(code)
}

func seedOwnerGroupAndUser(t *testing.T, db *sql.DB) (uuid.UUID, uuid.UUID) {
	ownerGroupID := uuid.New()
	userID := uuid.New()
	slug := fmt.Sprintf("core-platform-%s", uuid.New().String()[:8])
	email := fmt.Sprintf("admin-%s@example.com", uuid.New().String()[:8])

	_, err := db.Exec(`
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES ($1, 'Core Platform', $2, 'Engineering', 'Alice Engineer', 'alice@example.com')
	`, ownerGroupID, slug)
	require.NoError(t, err)

	_, err = db.Exec(`
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES ($1, $2, 'Admin User', 'platform_admin', $3)
	`, userID, email, ownerGroupID)
	require.NoError(t, err)

	_, err = db.Exec(`
		INSERT INTO user_owner_groups (user_id, owner_group_id)
		VALUES ($1, $2)
	`, userID, ownerGroupID)
	require.NoError(t, err)

	return ownerGroupID, userID
}

func TestAuditLogsMutationPrevention(t *testing.T) {
	_, userID := seedOwnerGroupAndUser(t, testDB)

	auditID := uuid.New()
	entityID := uuid.New()

	// Insert an initial audit log record
	_, err := testDB.Exec(`
		INSERT INTO audit_logs (id, entity_type, entity_id, actor_id, action, diff)
		VALUES ($1, 'ci', $2, $3, 'create', '{"name": "test-ci"}'::jsonb)
	`, auditID, entityID, userID)
	require.NoError(t, err)

	// Test 1: Attempting UPDATE on audit_logs must raise a PostgreSQL exception
	t.Run("Prevent UPDATE on audit_logs", func(t *testing.T) {
		_, err := testDB.Exec(`
			UPDATE audit_logs SET entity_type = 'tampered' WHERE id = $1
		`, auditID)
		require.Error(t, err)
		require.Contains(t, err.Error(), "audit_logs is append-only: UPDATE is strictly prohibited")
	})

	// Test 2: Attempting DELETE on audit_logs must raise a PostgreSQL exception
	t.Run("Prevent DELETE on audit_logs", func(t *testing.T) {
		_, err := testDB.Exec(`
			DELETE FROM audit_logs WHERE id = $1
		`, auditID)
		require.Error(t, err)
		require.Contains(t, err.Error(), "audit_logs is append-only: DELETE is strictly prohibited")
	})

	// Test 3: Attempting TRUNCATE on audit_logs must raise a PostgreSQL exception
	t.Run("Prevent TRUNCATE on audit_logs", func(t *testing.T) {
		_, err := testDB.Exec(`TRUNCATE TABLE audit_logs`)
		require.Error(t, err)
		require.Contains(t, err.Error(), "audit_logs is append-only: TRUNCATE is strictly prohibited")
	})
}

func TestCISClassMetadataConstraint(t *testing.T) {
	ownerGroupID, _ := seedOwnerGroupAndUser(t, testDB)

	t.Run("Valid with 0 keys in class_metadata", func(t *testing.T) {
		ciID := uuid.New()
		_, err := testDB.Exec(`
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, class_metadata)
			VALUES ($1, 'ci-zero-keys', 'application', 'prod', 'in_service', 'tier_1', $2, 'Alice Eng', '{}'::jsonb)
		`, ciID, ownerGroupID)
		require.NoError(t, err)
	})

	t.Run("Valid with 2 keys in class_metadata", func(t *testing.T) {
		ciID := uuid.New()
		_, err := testDB.Exec(`
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, class_metadata)
			VALUES ($1, 'ci-two-keys', 'application', 'prod', 'in_service', 'tier_1', $2, 'Alice Eng', '{"cluster_region": "us-east-1", "runtime_tier": "gold"}'::jsonb)
		`, ciID, ownerGroupID)
		require.NoError(t, err)
	})

	t.Run("Valid with >2 keys in class_metadata (dynamic forms)", func(t *testing.T) {
		ciID := uuid.New()
		_, err := testDB.Exec(`
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, class_metadata)
			VALUES ($1, 'ci-three-keys', 'application', 'prod', 'in_service', 'tier_1', $2, 'Alice Eng', '{"k1": "v1", "k2": "v2", "k3": "v3"}'::jsonb)
		`, ciID, ownerGroupID)
		require.NoError(t, err)
	})

	t.Run("Invalid with non-object JSON array in class_metadata", func(t *testing.T) {
		ciID := uuid.New()
		_, err := testDB.Exec(`
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, class_metadata)
			VALUES ($1, 'ci-array-meta', 'application', 'prod', 'in_service', 'tier_1', $2, 'Alice Eng', '["item1", "item2"]'::jsonb)
		`, ciID, ownerGroupID)
		require.Error(t, err)
		require.Contains(t, err.Error(), "chk_cis_class_metadata")
	})

	t.Run("Invalid with non-object JSON string in class_metadata", func(t *testing.T) {
		ciID := uuid.New()
		_, err := testDB.Exec(`
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, class_metadata)
			VALUES ($1, 'ci-str-meta', 'application', 'prod', 'in_service', 'tier_1', $2, 'Alice Eng', '"not_an_object"'::jsonb)
		`, ciID, ownerGroupID)
		require.Error(t, err)
		require.Contains(t, err.Error(), "chk_cis_class_metadata")
	})
}

func TestActiveCINameUniqueness(t *testing.T) {
	ownerGroupID, _ := seedOwnerGroupAndUser(t, testDB)

	baseName := fmt.Sprintf("Payments-API-%s", uuid.New().String()[:6])

	ciID1 := uuid.New()
	_, err := testDB.Exec(`
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact)
		VALUES ($1, $2, 'application', 'prod', 'in_service', 'tier_0', $3, 'Alice Eng')
	`, ciID1, baseName, ownerGroupID)
	require.NoError(t, err)

	t.Run("Duplicate active CI name with different case fails", func(t *testing.T) {
		ciID2 := uuid.New()
		_, err := testDB.Exec(`
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact)
			VALUES ($1, lower($2), 'application', 'prod', 'in_service', 'tier_1', $3, 'Bob Eng')
		`, ciID2, baseName, ownerGroupID)
		require.Error(t, err)
		require.Contains(t, err.Error(), "uq_cis_active_name")
	})

	t.Run("Same name but different environment succeeds", func(t *testing.T) {
		ciID3 := uuid.New()
		_, err := testDB.Exec(`
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact)
			VALUES ($1, lower($2), 'application', 'dr', 'in_service', 'tier_1', $3, 'Bob Eng')
		`, ciID3, baseName, ownerGroupID)
		require.NoError(t, err)
	})

	t.Run("Same name but different ci_class succeeds", func(t *testing.T) {
		ciID4 := uuid.New()
		_, err := testDB.Exec(`
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact)
			VALUES ($1, lower($2), 'database', 'prod', 'in_service', 'tier_1', $3, 'Bob Eng')
		`, ciID4, baseName, ownerGroupID)
		require.NoError(t, err)
	})

	t.Run("Duplicate name where existing is retired succeeds", func(t *testing.T) {
		// Retire the first CI
		_, err := testDB.Exec(`UPDATE cis SET lifecycle_state = 'retired' WHERE ci_id = $1`, ciID1)
		require.NoError(t, err)

		// Now creating active CI with same name in same env/class must succeed
		ciID5 := uuid.New()
		_, err = testDB.Exec(`
			INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact)
			VALUES ($1, lower($2), 'application', 'prod', 'in_service', 'tier_1', $3, 'Carol Eng')
		`, ciID5, baseName, ownerGroupID)
		require.NoError(t, err)
	})
}

func TestCIEdgesConstraints(t *testing.T) {
	ownerGroupID, userID := seedOwnerGroupAndUser(t, testDB)

	ciID1 := uuid.New()
	ciID2 := uuid.New()

	_, err := testDB.Exec(`
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact)
		VALUES ($1, 'app-service-' || $3, 'application', 'prod', 'in_service', 'tier_1', $2, 'Alice Eng')
	`, ciID1, ownerGroupID, uuid.New().String()[:8])
	require.NoError(t, err)

	_, err = testDB.Exec(`
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact)
		VALUES ($1, 'app-db-' || $3, 'database', 'prod', 'in_service', 'tier_1', $2, 'Alice Eng')
	`, ciID2, ownerGroupID, uuid.New().String()[:8])
	require.NoError(t, err)

	t.Run("Self-referencing edge fails check constraint", func(t *testing.T) {
		edgeID := uuid.New()
		_, err := testDB.Exec(`
			INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, created_by)
			VALUES ($1, $2, $2, 'reads_from', $3)
		`, edgeID, ciID1, userID)
		require.Error(t, err)
		require.Contains(t, err.Error(), "chk_ci_edges_no_self_ref")
	})

	t.Run("Valid edge succeeds", func(t *testing.T) {
		edgeID := uuid.New()
		_, err := testDB.Exec(`
			INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, created_by)
			VALUES ($1, $2, $3, 'reads_from', $4)
		`, edgeID, ciID1, ciID2, userID)
		require.NoError(t, err)
	})
}
