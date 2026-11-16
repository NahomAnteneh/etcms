package postgres_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	"github.com/org/etcms-backend/internal/adapters/postgres/gen"
	"github.com/org/etcms-backend/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWithAuditTx(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	ctx := context.Background()
	store := postgres.NewStore(testPool)

	actorID := uuid.New()
	actor := domain.Actor{
		ID:    actorID,
		Email: "actor@example.com",
		Name:  "Test Actor",
		Role:  domain.RolePlatformAdmin,
	}

	t.Run("Sets etcms.actor_id session setting within transaction", func(t *testing.T) {
		var sessionActorID string

		err := store.WithAuditTx(ctx, actor, func(tx pgx.Tx, q *gen.Queries) error {
			err := tx.QueryRow(ctx, "SELECT current_setting('etcms.actor_id')").Scan(&sessionActorID)
			return err
		})

		require.NoError(t, err)
		assert.Equal(t, actorID.String(), sessionActorID)
	})

	t.Run("Commits modifications when fn returns nil error", func(t *testing.T) {
		groupUUID := uuid.New()
		err := store.WithAuditTx(ctx, actor, func(tx pgx.Tx, q *gen.Queries) error {
			_, execErr := tx.Exec(ctx, `
				INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
				VALUES ($1, 'Tx Commit Test', $2, 'Dept', 'Lead', 'lead@example.com')
			`, groupUUID, "tx-commit-"+groupUUID.String()[:8])
			return execErr
		})

		require.NoError(t, err)

		// Verify record exists outside transaction
		var count int
		err = testPool.QueryRow(ctx, "SELECT count(*) FROM owner_groups WHERE id = $1", groupUUID).Scan(&count)
		require.NoError(t, err)
		assert.Equal(t, 1, count)
	})

	t.Run("Rolls back modifications when fn returns error", func(t *testing.T) {
		groupUUID := uuid.New()
		expectedErr := errors.New("simulated transaction failure")

		err := store.WithAuditTx(ctx, actor, func(tx pgx.Tx, q *gen.Queries) error {
			_, execErr := tx.Exec(ctx, `
				INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
				VALUES ($1, 'Tx Rollback Test', $2, 'Dept', 'Lead', 'lead@example.com')
			`, groupUUID, "tx-rollback-"+groupUUID.String()[:8])
			if execErr != nil {
				return execErr
			}
			return expectedErr
		})

		require.ErrorIs(t, err, expectedErr)

		// Verify record does NOT exist
		var count int
		err = testPool.QueryRow(ctx, "SELECT count(*) FROM owner_groups WHERE id = $1", groupUUID).Scan(&count)
		require.NoError(t, err)
		assert.Equal(t, 0, count)
	})

	t.Run("Creates audit log inside WithAuditTx", func(t *testing.T) {
		auditUUID := uuid.New()
		entityUUID := uuid.New()

		// First seed user for FK constraint
		ownerGroupID, userID := seedOwnerGroupAndUser(t, testDB)

		txActor := domain.Actor{
			ID:    userID,
			Email: "auditor@example.com",
			Name:  "Auditor",
			Role:  domain.RolePlatformAdmin,
		}

		err := store.WithAuditTx(ctx, txActor, func(tx pgx.Tx, q *gen.Queries) error {
			_, execErr := q.CreateAuditLog(ctx, gen.CreateAuditLogParams{
				ID:                    auditUUID,
				EntityType:            "ci",
				EntityID:              entityUUID,
				AffectedOwnerGroupIds: []uuid.UUID{ownerGroupID},
				ActorID:               userID,
				Action:                gen.AuditActionEnumCreate,
				Diff:                  []byte(`{"status": "created"}`),
				CreatedAt:             time.Now().UTC(),
			})
			return execErr
		})

		require.NoError(t, err)

		// Verify audit log exists
		var entityType string
		err = testPool.QueryRow(ctx, "SELECT entity_type FROM audit_logs WHERE id = $1", auditUUID).Scan(&entityType)
		require.NoError(t, err)
		assert.Equal(t, "ci", entityType)
	})
}
