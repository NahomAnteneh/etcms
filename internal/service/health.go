package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/postgres"
)

// HealthService computes CMDB governance health metrics.
type HealthService struct {
	store *postgres.Store
}

// NewHealthService creates a new HealthService instance.
func NewHealthService(store *postgres.Store) *HealthService {
	return &HealthService{store: store}
}

// GetHealthMetrics computes Freshness Rate, Orphan CIs, Pending Edges, and Digest Completion Rate.
func (s *HealthService) GetHealthMetrics(ctx context.Context, ownerGroupID *uuid.UUID) (*gen.HealthMetricsResponse, error) {
	var groupFilter uuid.UUID
	if ownerGroupID != nil {
		groupFilter = *ownerGroupID
	}

	freshness, err := s.store.Queries().GetHealthFreshness(ctx, groupFilter)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate freshness: %w", err)
	}

	orphans, err := s.store.Queries().GetHealthOrphans(ctx, groupFilter)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate orphan CIs: %w", err)
	}

	pending, err := s.store.Queries().GetHealthPendingEdges(ctx, groupFilter)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate pending edges: %w", err)
	}

	digest, err := s.store.Queries().GetHealthDigestCompletion(ctx, groupFilter)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate digest completion: %w", err)
	}

	var freshnessRate float32 = 100.0
	if freshness.TotalInService > 0 {
		freshnessRate = float32(freshness.FreshCount) / float32(freshness.TotalInService) * 100.0
	}

	var completionRate float32 = 100.0
	if digest.TotalClosedItems > 0 {
		completionRate = float32(digest.ActionedClosedItems) / float32(digest.TotalClosedItems) * 100.0
	}

	var groupsList *[]gen.OwnerGroupHealthMetrics
	// If global query, also compute per-group breakdowns
	if ownerGroupID == nil || *ownerGroupID == uuid.Nil {
		allGroups, gErr := s.store.Queries().ListAllOwnerGroups(ctx)
		if gErr != nil {
			return nil, fmt.Errorf("failed to list owner groups for breakdown: %w", gErr)
		}

		groupMetrics := make([]gen.OwnerGroupHealthMetrics, 0, len(allGroups))
		for _, g := range allGroups {
			gFreshness, err := s.store.Queries().GetHealthFreshness(ctx, g.ID)
			if err != nil {
				return nil, fmt.Errorf("failed to calculate freshness for group %s: %w", g.Name, err)
			}
			gOrphans, err := s.store.Queries().GetHealthOrphans(ctx, g.ID)
			if err != nil {
				return nil, fmt.Errorf("failed to calculate orphans for group %s: %w", g.Name, err)
			}
			gPending, err := s.store.Queries().GetHealthPendingEdges(ctx, g.ID)
			if err != nil {
				return nil, fmt.Errorf("failed to calculate pending edges for group %s: %w", g.Name, err)
			}
			gDigest, err := s.store.Queries().GetHealthDigestCompletion(ctx, g.ID)
			if err != nil {
				return nil, fmt.Errorf("failed to calculate digest completion for group %s: %w", g.Name, err)
			}

			var gFreshRate float32 = 100.0
			if gFreshness.TotalInService > 0 {
				gFreshRate = float32(gFreshness.FreshCount) / float32(gFreshness.TotalInService) * 100.0
			}

			var gCompRate float32 = 100.0
			if gDigest.TotalClosedItems > 0 {
				gCompRate = float32(gDigest.ActionedClosedItems) / float32(gDigest.TotalClosedItems) * 100.0
			}

			groupMetrics = append(groupMetrics, gen.OwnerGroupHealthMetrics{
				OwnerGroupId:              g.ID,
				OwnerGroupName:            g.Name,
				FreshnessRate:             gFreshRate,
				TotalInServiceCis:         int(gFreshness.TotalInService),
				FreshCisCount:             int(gFreshness.FreshCount),
				StaleCisCount:             int(gFreshness.StaleCount),
				OrphanCiCount:             int(gOrphans),
				PendingEdgesCount:         int(gPending.PendingEdgesCount),
				OldestPendingAgeDays:      float32(gPending.OldestPendingAgeDays),
				DigestCompletionRate:      gCompRate,
				TotalClosedDigestItems:    int(gDigest.TotalClosedItems),
				ActionedClosedDigestItems: int(gDigest.ActionedClosedItems),
			})
		}
		groupsList = &groupMetrics
	}

	return &gen.HealthMetricsResponse{
		FreshnessRate:             freshnessRate,
		TotalInServiceCis:         int(freshness.TotalInService),
		FreshCisCount:             int(freshness.FreshCount),
		StaleCisCount:             int(freshness.StaleCount),
		OrphanCiCount:             int(orphans),
		PendingEdgesCount:         int(pending.PendingEdgesCount),
		OldestPendingAgeDays:      float32(pending.OldestPendingAgeDays),
		DigestCompletionRate:      completionRate,
		TotalClosedDigestItems:    int(digest.TotalClosedItems),
		ActionedClosedDigestItems: int(digest.ActionedClosedItems),
		Groups:                    groupsList,
		GeneratedAt:               time.Now().UTC(),
	}, nil
}
