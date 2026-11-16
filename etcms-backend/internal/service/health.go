package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	sqlcgen "github.com/org/etcms-backend/internal/adapters/postgres/gen"
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

	var freshnessRate float32 = 0.0
	if freshness.TotalInService > 0 {
		freshnessRate = float32(freshness.FreshCount) / float32(freshness.TotalInService) * 100.0
	}

	var completionRate float32 = 0.0
	if digest.TotalClosedItems > 0 {
		completionRate = float32(digest.ActionedClosedItems) / float32(digest.TotalClosedItems) * 100.0
	}

	var groupsList *[]gen.OwnerGroupHealthMetrics
	// If global query, compute per-group breakdowns using batch-aggregated queries (eliminating N+1 loop)
	if ownerGroupID == nil || *ownerGroupID == uuid.Nil {
		allGroups, gErr := s.store.Queries().ListAllOwnerGroups(ctx)
		if gErr != nil {
			return nil, fmt.Errorf("failed to list owner groups for breakdown: %w", gErr)
		}

		freshnessRows, err := s.store.Queries().GetHealthFreshnessAllGroups(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to batch query freshness metrics: %w", err)
		}
		freshnessMap := make(map[uuid.UUID]sqlcgen.GetHealthFreshnessAllGroupsRow, len(freshnessRows))
		for _, r := range freshnessRows {
			freshnessMap[r.OwnerGroupID] = r
		}

		orphanRows, err := s.store.Queries().GetHealthOrphansAllGroups(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to batch query orphan metrics: %w", err)
		}
		orphanMap := make(map[uuid.UUID]int32, len(orphanRows))
		for _, r := range orphanRows {
			orphanMap[r.OwnerGroupID] = r.OrphanCount
		}

		pendingRows, err := s.store.Queries().GetHealthPendingEdgesAllGroups(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to batch query pending edge metrics: %w", err)
		}
		pendingMap := make(map[uuid.UUID]sqlcgen.GetHealthPendingEdgesAllGroupsRow, len(pendingRows))
		for _, r := range pendingRows {
			pendingMap[r.OwnerGroupID] = r
		}

		digestRows, err := s.store.Queries().GetHealthDigestCompletionAllGroups(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to batch query digest completion metrics: %w", err)
		}
		digestMap := make(map[uuid.UUID]sqlcgen.GetHealthDigestCompletionAllGroupsRow, len(digestRows))
		for _, r := range digestRows {
			digestMap[r.OwnerGroupID] = r
		}

		groupMetrics := make([]gen.OwnerGroupHealthMetrics, 0, len(allGroups))
		for _, g := range allGroups {
			fRow := freshnessMap[g.ID]
			orphansCount := orphanMap[g.ID]
			pRow := pendingMap[g.ID]
			dRow := digestMap[g.ID]

			var gFreshRate float32 = 0.0
			if fRow.TotalInService > 0 {
				gFreshRate = float32(fRow.FreshCount) / float32(fRow.TotalInService) * 100.0
			}

			var gCompRate float32 = 0.0
			if dRow.TotalClosedItems > 0 {
				gCompRate = float32(dRow.ActionedClosedItems) / float32(dRow.TotalClosedItems) * 100.0
			}

			groupMetrics = append(groupMetrics, gen.OwnerGroupHealthMetrics{
				OwnerGroupId:              g.ID,
				OwnerGroupName:            g.Name,
				FreshnessRate:             gFreshRate,
				TotalInServiceCis:         int(fRow.TotalInService),
				FreshCisCount:             int(fRow.FreshCount),
				StaleCisCount:             int(fRow.StaleCount),
				OrphanCiCount:             int(orphansCount),
				PendingEdgesCount:         int(pRow.PendingEdgesCount),
				OldestPendingAgeDays:      float32(pRow.OldestPendingAgeDays),
				DigestCompletionRate:      gCompRate,
				TotalClosedDigestItems:    int(dRow.TotalClosedItems),
				ActionedClosedDigestItems: int(dRow.ActionedClosedItems),
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
