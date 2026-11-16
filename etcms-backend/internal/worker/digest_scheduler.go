package worker

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	sqlcgen "github.com/org/etcms-backend/internal/adapters/postgres/gen"
	"github.com/org/etcms-backend/internal/service"
)

// CalculateCurrentWindow calculates the fixed calendar window (1st and 15th of each month at 00:00 UTC)
// and the start timestamp of the immediately preceding window.
func CalculateCurrentWindow(t time.Time) (windowStart, windowEnd, prevWindowStart time.Time) {
	utc := t.UTC()
	year, month, day := utc.Year(), utc.Month(), utc.Day()
	if day >= 15 {
		windowStart = time.Date(year, month, 15, 0, 0, 0, 0, time.UTC)
		windowEnd = time.Date(year, month+1, 1, 0, 0, 0, 0, time.UTC)
		prevWindowStart = time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
	} else {
		windowStart = time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
		windowEnd = time.Date(year, month, 15, 0, 0, 0, 0, time.UTC)
		prevWindowStart = time.Date(year, month-1, 15, 0, 0, 0, 0, time.UTC)
	}
	return windowStart, windowEnd, prevWindowStart
}

// DigestScheduler orchestrates the bi-weekly owner audit digest generation and notifications.
type DigestScheduler struct {
	store    *postgres.Store
	notifier service.Notifier
}

// NewDigestScheduler constructs a new DigestScheduler instance.
func NewDigestScheduler(store *postgres.Store, notifier service.Notifier) *DigestScheduler {
	if notifier == nil {
		notifier = &service.NoopNotifier{}
	}
	return &DigestScheduler{
		store:    store,
		notifier: notifier,
	}
}

// RunOnce executes a single pass of digest cycle evaluation for all owner groups at the given timestamp.
func (s *DigestScheduler) RunOnce(ctx context.Context, asOf time.Time) error {
	groups, err := s.store.Queries().ListAllOwnerGroups(ctx)
	if err != nil {
		return fmt.Errorf("failed to list owner groups: %w", err)
	}

	for _, g := range groups {
		if _, _, err := s.ProcessGroup(ctx, g, asOf); err != nil {
			return fmt.Errorf("failed to process digest for group %s (%s): %w", g.Name, g.ID, err)
		}
	}
	return nil
}

// ProcessGroup executes digest generation for a single owner group with idempotency and distributed safety.
func (s *DigestScheduler) ProcessGroup(ctx context.Context, group sqlcgen.OwnerGroup, asOf time.Time) (*sqlcgen.DigestCycle, []sqlcgen.GetDigestItemsByCycleRow, error) {
	windowStart, windowEnd, prevWindowStart := CalculateCurrentWindow(asOf)
	staleThreshold := asOf.Add(-60 * 24 * time.Hour)

	// 1. Transition previous open cycles for this group to 'closed' and un-actioned items to 'expired'
	closedCycleIDs, err := s.store.Queries().ClosePreviousOpenCycles(ctx, sqlcgen.ClosePreviousOpenCyclesParams{
		OwnerGroupID:       group.ID,
		ClosedAt:           pgtype.Timestamptz{Time: asOf, Valid: true},
		CurrentWindowStart: windowStart,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("failed to close previous cycles: %w", err)
	}
	if len(closedCycleIDs) > 0 {
		if err := s.store.Queries().ExpireUnActionedItemsForCycles(ctx, closedCycleIDs); err != nil {
			return nil, nil, fmt.Errorf("failed to expire un-actioned items: %w", err)
		}
	}

	// 2. Insert or retrieve current digest cycle (idempotent ON CONFLICT)
	var cycle sqlcgen.DigestCycle
	createdCycle, err := s.store.Queries().CreateDigestCycle(ctx, sqlcgen.CreateDigestCycleParams{
		ID:           uuid.New(),
		OwnerGroupID: group.ID,
		WindowStart:  windowStart,
		WindowEnd:    windowEnd,
		CreatedAt:    asOf,
	})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, fmt.Errorf("failed to insert digest cycle: %w", err)
		}
	}

	if createdCycle.ID != uuid.Nil {
		cycle = createdCycle
	} else {
		// Cycle already exists from a concurrent worker or previous run; fetch existing
		existingCycle, err := s.store.Queries().GetDigestCycleByGroupAndWindow(ctx, sqlcgen.GetDigestCycleByGroupAndWindowParams{
			OwnerGroupID: group.ID,
			WindowStart:  windowStart,
		})
		if err != nil {
			return nil, nil, fmt.Errorf("failed to fetch existing cycle: %w", err)
		}
		cycle = existingCycle
	}

	// 3. Select candidate CIs matching triggers:
	//    1) lifecycle_state = 'in_service' AND last_verified_at < now() - interval '60 days'
	//    2) created_at or updated_at >= prevWindowStart
	//    3) target of an edge with handshake_status = 'pending_confirmation'
	//    4) has an active 'open' record in ci_flags
	candidates, err := s.store.Queries().GetCandidateCIsForDigest(ctx, sqlcgen.GetCandidateCIsForDigestParams{
		OwnerGroupID:   group.ID,
		StaleThreshold: staleThreshold,
		SinceTime:      prevWindowStart,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("failed to query candidate CIs: %w", err)
	}

	// 4. Insert items into digest_items (idempotent ON CONFLICT (cycle_id, ci_id) DO NOTHING)
	for _, cand := range candidates {
		reason := determineTriggerReason(cand, staleThreshold)
		_, err := s.store.Queries().InsertDigestItem(ctx, sqlcgen.InsertDigestItemParams{
			ID:            uuid.New(),
			CycleID:       cycle.ID,
			CiID:          cand.CiID,
			TriggerReason: reason,
			CreatedAt:     asOf,
		})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, fmt.Errorf("failed to insert digest item for CI %s: %w", cand.CiID, err)
		}
	}

	// 5. Query all items in this cycle
	items, err := s.store.Queries().GetDigestItemsByCycle(ctx, cycle.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get digest items: %w", err)
	}

	// 6. Pluggable Webhook Notification Dispatch
	if len(items) > 0 {
		triggerCounts := make(map[string]int)
		summaryItems := make([]service.DigestSummaryItem, 0, len(items))
		for _, it := range items {
			triggerCounts[it.TriggerReason]++
			summaryItems = append(summaryItems, service.DigestSummaryItem{
				CIID:          it.CiID,
				CIName:        it.CiName,
				TriggerReason: it.TriggerReason,
			})
		}

		payload := service.DigestNotificationPayload{
			CycleID:        cycle.ID,
			OwnerGroupID:   group.ID,
			OwnerGroupName: group.Name,
			TeamLeadEmail:  group.TeamLeadEmail,
			WindowStart:    cycle.WindowStart,
			WindowEnd:      cycle.WindowEnd,
			TotalItems:     len(items),
			TriggerCounts:  triggerCounts,
			Items:          summaryItems,
		}

		_ = s.notifier.NotifyDigestCycle(ctx, payload)
	}

	return &cycle, items, nil
}

// determineTriggerReason determines the primary trigger reason for a candidate CI.
// Priority: open_flag > pending_edge > stale_verification > recent_change.
func determineTriggerReason(cand sqlcgen.GetCandidateCIsForDigestRow, staleThreshold time.Time) string {
	if cand.OpenFlagCount > 0 {
		return "open_flag"
	}
	if cand.PendingEdgeCount > 0 {
		return "pending_edge"
	}
	if cand.LifecycleState == sqlcgen.LifecycleStateEnumInService && cand.LastVerifiedAt.Before(staleThreshold) {
		return "stale_verification"
	}
	return "recent_change"
}
