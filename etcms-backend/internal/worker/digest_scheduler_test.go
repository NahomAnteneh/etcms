package worker_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
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

	"github.com/org/etcms-backend/internal/adapters/postgres"
	"github.com/org/etcms-backend/internal/service"
	"github.com/org/etcms-backend/internal/worker"
)

var (
	testPool *pgxpool.Pool
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

	stdDB, err := sql.Open("pgx", connStr)
	if err != nil {
		testPool.Close()
		_ = pgContainer.Terminate(ctx)
		fmt.Fprintf(os.Stderr, "failed to open stdlib db for goose: %v\n", err)
		os.Exit(1)
	}

	migrationsDir, err := filepath.Abs("../../migrations")
	if err != nil {
		_ = stdDB.Close()
		testPool.Close()
		_ = pgContainer.Terminate(ctx)
		fmt.Fprintf(os.Stderr, "failed to resolve migrations dir: %v\n", err)
		os.Exit(1)
	}

	if err := goose.SetDialect("postgres"); err != nil {
		_ = stdDB.Close()
		testPool.Close()
		_ = pgContainer.Terminate(ctx)
		fmt.Fprintf(os.Stderr, "failed to set goose dialect: %v\n", err)
		os.Exit(1)
	}

	if err := goose.Up(stdDB, migrationsDir); err != nil {
		_ = stdDB.Close()
		testPool.Close()
		_ = pgContainer.Terminate(ctx)
		fmt.Fprintf(os.Stderr, "failed to run goose migrations: %v\n", err)
		os.Exit(1)
	}
	_ = stdDB.Close()

	code := m.Run()

	testPool.Close()
	_ = pgContainer.Terminate(ctx)

	os.Exit(code)
}

func TestCalculateCurrentWindow(t *testing.T) {
	tests := []struct {
		name            string
		input           time.Time
		expectedStart   time.Time
		expectedEnd     time.Time
		expectedPrevWin time.Time
	}{
		{
			name:            "First half of month: Nov 5",
			input:           time.Date(2026, time.November, 5, 14, 30, 0, 0, time.UTC),
			expectedStart:   time.Date(2026, time.November, 1, 0, 0, 0, 0, time.UTC),
			expectedEnd:     time.Date(2026, time.November, 15, 0, 0, 0, 0, time.UTC),
			expectedPrevWin: time.Date(2026, time.October, 15, 0, 0, 0, 0, time.UTC),
		},
		{
			name:            "Exact 1st of month: Nov 1",
			input:           time.Date(2026, time.November, 1, 0, 0, 0, 0, time.UTC),
			expectedStart:   time.Date(2026, time.November, 1, 0, 0, 0, 0, time.UTC),
			expectedEnd:     time.Date(2026, time.November, 15, 0, 0, 0, 0, time.UTC),
			expectedPrevWin: time.Date(2026, time.October, 15, 0, 0, 0, 0, time.UTC),
		},
		{
			name:            "Day before 15th: Nov 14",
			input:           time.Date(2026, time.November, 14, 23, 59, 59, 0, time.UTC),
			expectedStart:   time.Date(2026, time.November, 1, 0, 0, 0, 0, time.UTC),
			expectedEnd:     time.Date(2026, time.November, 15, 0, 0, 0, 0, time.UTC),
			expectedPrevWin: time.Date(2026, time.October, 15, 0, 0, 0, 0, time.UTC),
		},
		{
			name:            "Exact 15th of month: Nov 15",
			input:           time.Date(2026, time.November, 15, 0, 0, 0, 0, time.UTC),
			expectedStart:   time.Date(2026, time.November, 15, 0, 0, 0, 0, time.UTC),
			expectedEnd:     time.Date(2026, time.December, 1, 0, 0, 0, 0, time.UTC),
			expectedPrevWin: time.Date(2026, time.November, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			name:            "Last day of month: Nov 30",
			input:           time.Date(2026, time.November, 30, 18, 0, 0, 0, time.UTC),
			expectedStart:   time.Date(2026, time.November, 15, 0, 0, 0, 0, time.UTC),
			expectedEnd:     time.Date(2026, time.December, 1, 0, 0, 0, 0, time.UTC),
			expectedPrevWin: time.Date(2026, time.November, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			name:            "Year boundary: Jan 5, 2027",
			input:           time.Date(2027, time.January, 5, 10, 0, 0, 0, time.UTC),
			expectedStart:   time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC),
			expectedEnd:     time.Date(2027, time.January, 15, 0, 0, 0, 0, time.UTC),
			expectedPrevWin: time.Date(2026, time.December, 15, 0, 0, 0, 0, time.UTC),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			start, end, prevStart := worker.CalculateCurrentWindow(tc.input)
			assert.Equal(t, tc.expectedStart, start)
			assert.Equal(t, tc.expectedEnd, end)
			assert.Equal(t, tc.expectedPrevWin, prevStart)
		})
	}
}

func TestDigestSchedulerExecutionAndTriggers(t *testing.T) {
	ctx := t.Context()
	store := postgres.NewStore(testPool)

	// Webhook capture server
	var mu sync.Mutex
	var receivedPayloads []service.DigestNotificationPayload

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

		var payload service.DigestNotificationPayload
		err := json.NewDecoder(r.Body).Decode(&payload)
		if err == nil {
			mu.Lock()
			receivedPayloads = append(receivedPayloads, payload)
			mu.Unlock()
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	notifier := service.NewWebhookNotifier(ts.URL, ts.Client())
	scheduler := worker.NewDigestScheduler(store, notifier)

	now := time.Date(2026, time.November, 16, 10, 0, 0, 0, time.UTC)
	windowStart, windowEnd, _ := worker.CalculateCurrentWindow(now)

	// 1. Seed Owner Groups & Users
	targetGroupID := uuid.New()
	peerGroupID := uuid.New()
	adminID := uuid.New()

	_, err := testPool.Exec(ctx, `
		INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email)
		VALUES
			($1, 'Digest Target Team', 'digest-target-team', 'Engineering', 'Digest Lead', 'digest-lead@example.com'),
			($2, 'Digest Peer Team', 'digest-peer-team', 'Operations', 'Peer Lead', 'peer-lead@example.com')
	`, targetGroupID, peerGroupID)
	require.NoError(t, err)

	_, err = testPool.Exec(ctx, `
		INSERT INTO users (id, email, name, role, primary_owner_group_id)
		VALUES ($1, 'digest-admin@example.com', 'Digest Admin', 'platform_admin', $2)
	`, adminID, targetGroupID)
	require.NoError(t, err)

	// 2. Seed CIs matching the 4 triggers:
	// - CI 1 (stale): verified 70 days ago (>60 days), created 100 days ago
	// - CI 2 (recent_change): created/updated 2 days ago (>= prevWindowStart: Nov 1)
	// - CI 3 (pending_edge): target of an edge with handshake_status = 'pending_confirmation'
	// - CI 4 (open_flag): has an active 'open' record in ci_flags
	// - CI 5 (healthy/clean): verified 10 days ago, created 60 days ago, confirmed edge, no flags -> NOT in digest!
	// - CI 6 (retired): retired -> NOT in digest!
	ciStaleID := uuid.New()
	ciRecentID := uuid.New()
	ciPendingEdgeID := uuid.New()
	ciOpenFlagID := uuid.New()
	ciCleanID := uuid.New()
	ciRetiredID := uuid.New()
	peerSourceCIID := uuid.New()

	staleVerifiedAt := now.Add(-70 * 24 * time.Hour)
	cleanVerifiedAt := now.Add(-10 * 24 * time.Hour)
	recentTime := now.Add(-2 * 24 * time.Hour)
	oldTime := now.Add(-90 * 24 * time.Hour)

	_, err = testPool.Exec(ctx, `
		INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, itam_external_ref, class_metadata, created_at, updated_at)
		VALUES
			($1, 'ci-stale-verification', 'database', 'prod', 'in_service', 'tier_1', $7, 'Lead', 'db.stale', $9, NULL, '{}', $11, $11),
			($2, 'ci-recent-change', 'application', 'prod', 'in_service', 'tier_2', $7, 'Lead', 'app.recent', $10, NULL, '{}', $12, $12),
			($3, 'ci-pending-edge-target', 'database', 'prod', 'in_service', 'tier_2', $7, 'Lead', 'db.edge', $10, NULL, '{}', $11, $11),
			($4, 'ci-open-flag-target', 'application', 'prod', 'in_service', 'tier_2', $7, 'Lead', 'app.flag', $10, NULL, '{}', $11, $11),
			($5, 'ci-healthy-clean', 'application', 'prod', 'in_service', 'tier_3', $7, 'Lead', 'app.clean', $10, NULL, '{}', $11, $11),
			($6, 'ci-retired-ignored', 'application', 'prod', 'retired', 'tier_3', $7, 'Lead', 'app.ret', $9, NULL, '{}', $11, $11),
			-- Peer CI owned by peerGroupID
			($8, 'peer-source-app', 'application', 'prod', 'in_service', 'tier_1', $13, 'Peer Lead', 'app.peer', $10, NULL, '{}', $11, $11)
	`, ciStaleID, ciRecentID, ciPendingEdgeID, ciOpenFlagID, ciCleanID, ciRetiredID, targetGroupID, peerSourceCIID, staleVerifiedAt, cleanVerifiedAt, oldTime, recentTime, peerGroupID)
	require.NoError(t, err)

	// Create pending confirmation edge targeting ciPendingEdgeID
	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, created_at, updated_at)
		VALUES (gen_random_uuid(), $1, $2, 'connects_to', 'pending_confirmation', $3, $4, $4)
	`, peerSourceCIID, ciPendingEdgeID, adminID, oldTime)
	require.NoError(t, err)

	// Create open flag on ciOpenFlagID
	_, err = testPool.Exec(ctx, `
		INSERT INTO ci_flags (id, ci_id, flagged_by, reason, status, created_at)
		VALUES (gen_random_uuid(), $1, $2, 'Incorrect technical contact listed', 'open', $3)
	`, ciOpenFlagID, adminID, oldTime)
	require.NoError(t, err)

	// =========================================================================
	// Execution & Assertions
	// =========================================================================

	t.Run("RunOnce executes and populates digest cycle with exact trigger matches", func(t *testing.T) {
		err := scheduler.RunOnce(ctx, now)
		require.NoError(t, err)

		// Assert cycle was created
		var cycleID uuid.UUID
		var status string
		var actualWinStart, actualWinEnd time.Time
		err = testPool.QueryRow(ctx, `
			SELECT id, status, window_start, window_end
			FROM digest_cycles
			WHERE owner_group_id = $1 AND window_start = $2
		`, targetGroupID, windowStart).Scan(&cycleID, &status, &actualWinStart, &actualWinEnd)
		require.NoError(t, err)
		assert.Equal(t, "open", status)
		assert.True(t, windowStart.Equal(actualWinStart))
		assert.True(t, windowEnd.Equal(actualWinEnd))

		// Assert items in cycle
		rows, err := testPool.Query(ctx, `
			SELECT di.ci_id, di.trigger_reason, di.status, c.name
			FROM digest_items di
			JOIN cis c ON c.ci_id = di.ci_id
			WHERE di.cycle_id = $1
			ORDER BY c.name ASC
		`, cycleID)
		require.NoError(t, err)
		defer rows.Close()

		type item struct {
			ciID   uuid.UUID
			reason string
			status string
			name   string
		}
		var items []item
		for rows.Next() {
			var it item
			err := rows.Scan(&it.ciID, &it.reason, &it.status, &it.name)
			require.NoError(t, err)
			items = append(items, it)
		}

		// Exactly 4 items should be enqueued (clean and retired CIs must NOT be enqueued)
		require.Len(t, items, 4)

		itemMap := make(map[uuid.UUID]item)
		for _, it := range items {
			itemMap[it.ciID] = it
			assert.Equal(t, "open", it.status)
		}

		// Check trigger reasons
		assert.Contains(t, itemMap, ciOpenFlagID)
		assert.Equal(t, "open_flag", itemMap[ciOpenFlagID].reason)

		assert.Contains(t, itemMap, ciPendingEdgeID)
		assert.Equal(t, "pending_edge", itemMap[ciPendingEdgeID].reason)

		assert.Contains(t, itemMap, ciStaleID)
		assert.Equal(t, "stale_verification", itemMap[ciStaleID].reason)

		assert.Contains(t, itemMap, ciRecentID)
		assert.Equal(t, "recent_change", itemMap[ciRecentID].reason)

		assert.NotContains(t, itemMap, ciCleanID, "healthy CI must not be enqueued")
		assert.NotContains(t, itemMap, ciRetiredID, "retired CI must not be enqueued")

		// Assert Webhook Notification was dispatched
		mu.Lock()
		defer mu.Unlock()
		require.NotEmpty(t, receivedPayloads)
		var targetPayload *service.DigestNotificationPayload
		for _, p := range receivedPayloads {
			if p.OwnerGroupID == targetGroupID {
				targetPayload = &p
				break
			}
		}
		require.NotNil(t, targetPayload, "expected webhook notification for target group")
		assert.Equal(t, cycleID, targetPayload.CycleID)
		assert.Equal(t, 4, targetPayload.TotalItems)
		assert.Equal(t, "digest-lead@example.com", targetPayload.TeamLeadEmail)
		assert.Equal(t, 1, targetPayload.TriggerCounts["open_flag"])
		assert.Equal(t, 1, targetPayload.TriggerCounts["pending_edge"])
		assert.Equal(t, 1, targetPayload.TriggerCounts["stale_verification"])
		assert.Equal(t, 1, targetPayload.TriggerCounts["recent_change"])
	})

	t.Run("Idempotency: Re-running RunOnce on same window does not duplicate cycles or items", func(t *testing.T) {
		// Run again on the same time window
		err := scheduler.RunOnce(ctx, now)
		require.NoError(t, err)

		// Assert cycle count is still 1 for this window
		var cycleCount int
		err = testPool.QueryRow(ctx, `
			SELECT count(*) FROM digest_cycles
			WHERE owner_group_id = $1 AND window_start = $2
		`, targetGroupID, windowStart).Scan(&cycleCount)
		require.NoError(t, err)
		assert.Equal(t, 1, cycleCount)

		// Assert item count is still 4
		var itemCount int
		err = testPool.QueryRow(ctx, `
			SELECT count(*)
			FROM digest_items di
			JOIN digest_cycles dc ON dc.id = di.cycle_id
			WHERE dc.owner_group_id = $1 AND dc.window_start = $2
		`, targetGroupID, windowStart).Scan(&itemCount)
		require.NoError(t, err)
		assert.Equal(t, 4, itemCount)
	})

	t.Run("Cycle Transition: Advancing to next window closes previous cycle and expires un-actioned items", func(t *testing.T) {
		// Advance to next window: Dec 1, 2026
		nextWindowTime := time.Date(2026, time.December, 2, 9, 0, 0, 0, time.UTC)
		nextWindowStart, _, _ := worker.CalculateCurrentWindow(nextWindowTime)

		err := scheduler.RunOnce(ctx, nextWindowTime)
		require.NoError(t, err)

		// Assert previous cycle is now 'closed' with closed_at set
		var prevStatus string
		var closedAt sql.NullTime
		err = testPool.QueryRow(ctx, `
			SELECT status, closed_at FROM digest_cycles
			WHERE owner_group_id = $1 AND window_start = $2
		`, targetGroupID, windowStart).Scan(&prevStatus, &closedAt)
		require.NoError(t, err)
		assert.Equal(t, "closed", prevStatus)
		assert.True(t, closedAt.Valid)

		// Assert un-actioned items from previous cycle are marked 'expired'
		var expiredCount int
		err = testPool.QueryRow(ctx, `
			SELECT count(*) FROM digest_items di
			JOIN digest_cycles dc ON dc.id = di.cycle_id
			WHERE dc.owner_group_id = $1 AND dc.window_start = $2 AND di.status = 'expired'
		`, targetGroupID, windowStart).Scan(&expiredCount)
		require.NoError(t, err)
		assert.Equal(t, 4, expiredCount)

		// Assert new cycle is 'open'
		var newStatus string
		err = testPool.QueryRow(ctx, `
			SELECT status FROM digest_cycles
			WHERE owner_group_id = $1 AND window_start = $2
		`, targetGroupID, nextWindowStart).Scan(&newStatus)
		require.NoError(t, err)
		assert.Equal(t, "open", newStatus)
	})
}
