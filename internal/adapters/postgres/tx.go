package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/org/etcms-backend/internal/adapters/postgres/gen"
	"github.com/org/etcms-backend/internal/domain"
)

// Store provides access to PostgreSQL storage and transactional execution.
type Store struct {
	pool    *pgxpool.Pool
	queries *gen.Queries
}

// NewStore initializes a new Store instance.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{
		pool:    pool,
		queries: gen.New(pool),
	}
}

// Pool returns the underlying pgxpool.Pool.
func (s *Store) Pool() *pgxpool.Pool {
	return s.pool
}

// Queries returns the type-safe sqlc query interface.
func (s *Store) Queries() *gen.Queries {
	return s.queries
}

// WithAuditTx executes fn inside a PostgreSQL transaction, configuring
// session variable `etcms.actor_id` for audit traceability. If fn returns an
// error, the transaction is rolled back; otherwise it is committed.
func (s *Store) WithAuditTx(ctx context.Context, actor domain.Actor, fn func(tx pgx.Tx, q *gen.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	// Configure session setting for current transaction (is_local = true)
	_, err = tx.Exec(ctx, "SELECT set_config('etcms.actor_id', $1, true)", actor.ID.String())
	if err != nil {
		return fmt.Errorf("failed to set etcms.actor_id session config: %w", err)
	}

	qtx := s.queries.WithTx(tx)
	if err := fn(tx, qtx); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}
