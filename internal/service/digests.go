package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	"github.com/org/etcms-backend/internal/domain"
)

// DigestService manages bi-weekly owner digest reviews.
type DigestService struct {
	store *postgres.Store
}

// NewDigestService creates a new DigestService instance.
func NewDigestService(store *postgres.Store) *DigestService {
	return &DigestService{store: store}
}

// GetActiveDigest retrieves the current active digest cycle and queued items for an owner group.
func (s *DigestService) GetActiveDigest(ctx context.Context, actor *domain.Actor, requestedOwnerGroupID *uuid.UUID) (*gen.ActiveDigestResponse, error) {
	var targetGroupID uuid.UUID
	if requestedOwnerGroupID != nil && *requestedOwnerGroupID != uuid.Nil {
		targetGroupID = *requestedOwnerGroupID
	} else if actor.PrimaryOwnerGroupID != nil && *actor.PrimaryOwnerGroupID != uuid.Nil {
		targetGroupID = *actor.PrimaryOwnerGroupID
	} else if len(actor.OwnerGroupIDs) > 0 {
		targetGroupID = actor.OwnerGroupIDs[0]
	} else {
		return nil, fmt.Errorf("%w: user has no primary owner group", domain.ErrNotFound)
	}

	if !actor.BelongsToOwnerGroup(targetGroupID) {
		return nil, fmt.Errorf("%w: user does not belong to owner group %s", domain.ErrForbidden, targetGroupID)
	}

	og, err := s.store.Queries().GetOwnerGroupByID(ctx, targetGroupID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: owner group not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to fetch owner group: %w", err)
	}

	cycle, err := s.store.Queries().GetActiveDigestCycleByOwnerGroup(ctx, targetGroupID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &gen.ActiveDigestResponse{
				OwnerGroupId:   targetGroupID,
				OwnerGroupName: og.Name,
				Items:          []gen.DigestItem{},
			}, nil
		}
		return nil, fmt.Errorf("failed to fetch active digest cycle: %w", err)
	}

	rows, err := s.store.Queries().GetDigestItemsByCycle(ctx, cycle.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch digest items: %w", err)
	}

	items := make([]gen.DigestItem, 0, len(rows))
	for _, r := range rows {
		var actionedAt *time.Time
		if r.ActionedAt.Valid {
			actionedAt = &r.ActionedAt.Time
		}
		var actionType *string
		if r.ActionType.Valid {
			actionType = &r.ActionType.String
		}
		items = append(items, gen.DigestItem{
			Id:              r.ID,
			CiId:            r.CiID,
			Name:            r.CiName,
			CiClass:         string(r.CiClass),
			Environment:     gen.DigestItemEnvironment(r.Environment),
			CriticalityTier: gen.DigestItemCriticalityTier(r.CriticalityTier),
			TriggerReason:   r.TriggerReason,
			Status:          gen.DigestItemStatus(r.Status),
			ActionedAt:      actionedAt,
			ActionType:      actionType,
			CreatedAt:       r.CreatedAt,
		})
	}

	status := string(cycle.Status)
	return &gen.ActiveDigestResponse{
		CycleId:        &cycle.ID,
		OwnerGroupId:   targetGroupID,
		OwnerGroupName: og.Name,
		WindowStart:    &cycle.WindowStart,
		WindowEnd:      &cycle.WindowEnd,
		Status:         &status,
		Items:          items,
	}, nil
}
