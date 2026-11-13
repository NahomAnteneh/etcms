package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	sqlcgen "github.com/org/etcms-backend/internal/adapters/postgres/gen"
	"github.com/org/etcms-backend/internal/domain"
)

// EdgeService orchestrates cross-boundary edge queries and handshake workflows.
type EdgeService struct {
	store *postgres.Store
}

// NewEdgeService constructs a new EdgeService instance.
func NewEdgeService(store *postgres.Store) *EdgeService {
	return &EdgeService{store: store}
}

// ListPendingEdges returns edges with handshake_status = 'pending_confirmation'
// filtered to groups owned by the caller (or all groups if platform admin).
func (s *EdgeService) ListPendingEdges(ctx context.Context, actor domain.Actor, filterGroupID *uuid.UUID) (*gen.PendingEdgesResponse, error) {
	var items []gen.PendingEdge

	if actor.Role == domain.RolePlatformAdmin {
		if filterGroupID != nil && *filterGroupID != uuid.Nil {
			rows, err := s.store.Queries().ListPendingEdgesForGroup(ctx, *filterGroupID)
			if err != nil {
				return nil, fmt.Errorf("failed to list pending edges for group: %w", err)
			}
			items = make([]gen.PendingEdge, len(rows))
			for i, r := range rows {
				items[i] = mapPendingEdge(
					r.ID, r.EdgeType, r.HandshakeStatus, r.CreatedAt, r.UpdatedAt, r.CreatedBy,
					r.SourceCiID, r.SourceCiName, r.SourceCiClass, r.SourceCiEnvironment,
					r.SourceOwnerGroupID, r.SourceOwnerGroupName, r.SourceDepartmentName, r.SourceTechnicalContact,
					r.TargetCiID, r.TargetCiName, r.TargetCiClass, r.TargetCiEnvironment,
					r.TargetOwnerGroupID, r.TargetOwnerGroupName, r.TargetDepartmentName, r.TargetTechnicalContact,
				)
			}
		} else {
			rows, err := s.store.Queries().ListAllPendingEdges(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to list all pending edges: %w", err)
			}
			items = make([]gen.PendingEdge, len(rows))
			for i, r := range rows {
				items[i] = mapPendingEdge(
					r.ID, r.EdgeType, r.HandshakeStatus, r.CreatedAt, r.UpdatedAt, r.CreatedBy,
					r.SourceCiID, r.SourceCiName, r.SourceCiClass, r.SourceCiEnvironment,
					r.SourceOwnerGroupID, r.SourceOwnerGroupName, r.SourceDepartmentName, r.SourceTechnicalContact,
					r.TargetCiID, r.TargetCiName, r.TargetCiClass, r.TargetCiEnvironment,
					r.TargetOwnerGroupID, r.TargetOwnerGroupName, r.TargetDepartmentName, r.TargetTechnicalContact,
				)
			}
		}
	} else {
		// Non-admin: restrict to caller's groups
		if filterGroupID != nil && *filterGroupID != uuid.Nil {
			if !actor.BelongsToOwnerGroup(*filterGroupID) {
				return nil, domain.ErrForbidden
			}
			rows, err := s.store.Queries().ListPendingEdgesForGroup(ctx, *filterGroupID)
			if err != nil {
				return nil, fmt.Errorf("failed to list pending edges for group: %w", err)
			}
			items = make([]gen.PendingEdge, len(rows))
			for i, r := range rows {
				items[i] = mapPendingEdge(
					r.ID, r.EdgeType, r.HandshakeStatus, r.CreatedAt, r.UpdatedAt, r.CreatedBy,
					r.SourceCiID, r.SourceCiName, r.SourceCiClass, r.SourceCiEnvironment,
					r.SourceOwnerGroupID, r.SourceOwnerGroupName, r.SourceDepartmentName, r.SourceTechnicalContact,
					r.TargetCiID, r.TargetCiName, r.TargetCiClass, r.TargetCiEnvironment,
					r.TargetOwnerGroupID, r.TargetOwnerGroupName, r.TargetDepartmentName, r.TargetTechnicalContact,
				)
			}
		} else {
			groupIDs := actor.OwnerGroupIDs
			if len(groupIDs) == 0 && actor.PrimaryOwnerGroupID != nil {
				groupIDs = []uuid.UUID{*actor.PrimaryOwnerGroupID}
			}
			if len(groupIDs) == 0 {
				return &gen.PendingEdgesResponse{Items: []gen.PendingEdge{}, Total: 0}, nil
			}

			rows, err := s.store.Queries().ListPendingEdgesForGroups(ctx, groupIDs)
			if err != nil {
				return nil, fmt.Errorf("failed to list pending edges for groups: %w", err)
			}
			items = make([]gen.PendingEdge, len(rows))
			for i, r := range rows {
				items[i] = mapPendingEdge(
					r.ID, r.EdgeType, r.HandshakeStatus, r.CreatedAt, r.UpdatedAt, r.CreatedBy,
					r.SourceCiID, r.SourceCiName, r.SourceCiClass, r.SourceCiEnvironment,
					r.SourceOwnerGroupID, r.SourceOwnerGroupName, r.SourceDepartmentName, r.SourceTechnicalContact,
					r.TargetCiID, r.TargetCiName, r.TargetCiClass, r.TargetCiEnvironment,
					r.TargetOwnerGroupID, r.TargetOwnerGroupName, r.TargetDepartmentName, r.TargetTechnicalContact,
				)
			}
		}
	}

	return &gen.PendingEdgesResponse{
		Items: items,
		Total: len(items),
	}, nil
}

// ConfirmEdge marks an edge as confirmed by the target CI's owner group lead or platform admin.
func (s *EdgeService) ConfirmEdge(ctx context.Context, actor domain.Actor, edgeID uuid.UUID) (*gen.EdgeResponse, error) {
	edge, err := s.store.Queries().GetEdgeWithDetails(ctx, edgeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to fetch edge: %w", err)
	}

	// RBAC check: Viewer cannot mutate, and caller must belong to target CI's owner group
	if actor.Role == domain.RoleViewer {
		return nil, domain.ErrForbidden
	}
	if !actor.BelongsToOwnerGroup(edge.TargetOwnerGroupID) {
		return nil, domain.ErrForbidden
	}

	// State machine check
	if edge.HandshakeStatus == sqlcgen.HandshakeStatusEnumConfirmed {
		return nil, fmt.Errorf("%w: edge is already confirmed", domain.ErrConflict)
	}
	if edge.HandshakeStatus == sqlcgen.HandshakeStatusEnumRejected {
		return nil, fmt.Errorf("%w: cannot confirm an edge that has been rejected", domain.ErrConflict)
	}

	now := time.Now().UTC()
	var updatedEdge sqlcgen.CiEdge

	err = s.store.WithAuditTx(ctx, actor, func(tx pgx.Tx, q *sqlcgen.Queries) error {
		var uErr error
		updatedEdge, uErr = q.UpdateEdgeHandshake(ctx, sqlcgen.UpdateEdgeHandshakeParams{
			ID:              edgeID,
			HandshakeStatus: sqlcgen.HandshakeStatusEnumConfirmed,
			ConfirmedBy:     pgtype.UUID{Bytes: actor.ID, Valid: true},
			ConfirmedAt:     pgtype.Timestamptz{Time: now, Valid: true},
		})
		if uErr != nil {
			return fmt.Errorf("failed to update edge handshake: %w", uErr)
		}

		diffMap := map[string]interface{}{
			"action":          "confirm_edge",
			"previous_status": string(edge.HandshakeStatus),
			"new_status":      "confirmed",
			"confirmed_by":    actor.ID.String(),
		}
		diffJSON, _ := json.Marshal(diffMap)

		_, uErr = q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
			ID:                    uuid.New(),
			EntityType:            "ci_edge",
			EntityID:              edgeID,
			AffectedOwnerGroupIds: []uuid.UUID{edge.SourceOwnerGroupID, edge.TargetOwnerGroupID},
			ActorID:               actor.ID,
			Action:                sqlcgen.AuditActionEnumUpdate,
			Diff:                  diffJSON,
			CreatedAt:             now,
		})
		if uErr != nil {
			return fmt.Errorf("failed to write audit log: %w", uErr)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return mapEdgeToResponse(updatedEdge), nil
}

// FlagEdgeMismatch marks an edge as flagged for mismatch by the target CI's owner group lead or platform admin.
func (s *EdgeService) FlagEdgeMismatch(ctx context.Context, actor domain.Actor, edgeID uuid.UUID, reason *string) (*gen.EdgeResponse, error) {
	edge, err := s.store.Queries().GetEdgeWithDetails(ctx, edgeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to fetch edge: %w", err)
	}

	// RBAC check: Viewer cannot mutate, and caller must belong to target CI's owner group
	if actor.Role == domain.RoleViewer {
		return nil, domain.ErrForbidden
	}
	if !actor.BelongsToOwnerGroup(edge.TargetOwnerGroupID) {
		return nil, domain.ErrForbidden
	}

	// State machine check
	if edge.HandshakeStatus == sqlcgen.HandshakeStatusEnumRejected {
		return nil, fmt.Errorf("%w: cannot flag mismatch on an edge that has been rejected", domain.ErrConflict)
	}

	now := time.Now().UTC()
	var updatedEdge sqlcgen.CiEdge

	err = s.store.WithAuditTx(ctx, actor, func(tx pgx.Tx, q *sqlcgen.Queries) error {
		var uErr error
		updatedEdge, uErr = q.UpdateEdgeHandshake(ctx, sqlcgen.UpdateEdgeHandshakeParams{
			ID:              edgeID,
			HandshakeStatus: sqlcgen.HandshakeStatusEnumFlaggedMismatch,
			ConfirmedBy:     pgtype.UUID{Valid: false},
			ConfirmedAt:     pgtype.Timestamptz{Valid: false},
		})
		if uErr != nil {
			return fmt.Errorf("failed to flag edge mismatch: %w", uErr)
		}

		diffMap := map[string]interface{}{
			"action":          "flag_edge_mismatch",
			"previous_status": string(edge.HandshakeStatus),
			"new_status":      "flagged_mismatch",
		}
		if reason != nil && *reason != "" {
			diffMap["reason"] = *reason
		}
		diffJSON, _ := json.Marshal(diffMap)

		_, uErr = q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
			ID:                    uuid.New(),
			EntityType:            "ci_edge",
			EntityID:              edgeID,
			AffectedOwnerGroupIds: []uuid.UUID{edge.SourceOwnerGroupID, edge.TargetOwnerGroupID},
			ActorID:               actor.ID,
			Action:                sqlcgen.AuditActionEnumUpdate,
			Diff:                  diffJSON,
			CreatedAt:             now,
		})
		if uErr != nil {
			return fmt.Errorf("failed to write audit log: %w", uErr)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return mapEdgeToResponse(updatedEdge), nil
}

// RejectEdge marks an edge as rejected by the target CI's owner group lead or platform admin.
func (s *EdgeService) RejectEdge(ctx context.Context, actor domain.Actor, edgeID uuid.UUID, reason *string) (*gen.EdgeResponse, error) {
	edge, err := s.store.Queries().GetEdgeWithDetails(ctx, edgeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to fetch edge: %w", err)
	}

	// RBAC check: Viewer cannot mutate, and caller must belong to target CI's owner group
	if actor.Role == domain.RoleViewer {
		return nil, domain.ErrForbidden
	}
	if !actor.BelongsToOwnerGroup(edge.TargetOwnerGroupID) {
		return nil, domain.ErrForbidden
	}

	// State machine check
	if edge.HandshakeStatus == sqlcgen.HandshakeStatusEnumRejected {
		return nil, fmt.Errorf("%w: edge is already rejected", domain.ErrConflict)
	}

	now := time.Now().UTC()
	var updatedEdge sqlcgen.CiEdge

	err = s.store.WithAuditTx(ctx, actor, func(tx pgx.Tx, q *sqlcgen.Queries) error {
		var uErr error
		updatedEdge, uErr = q.UpdateEdgeHandshake(ctx, sqlcgen.UpdateEdgeHandshakeParams{
			ID:              edgeID,
			HandshakeStatus: sqlcgen.HandshakeStatusEnumRejected,
			ConfirmedBy:     pgtype.UUID{Valid: false},
			ConfirmedAt:     pgtype.Timestamptz{Valid: false},
		})
		if uErr != nil {
			return fmt.Errorf("failed to reject edge: %w", uErr)
		}

		diffMap := map[string]interface{}{
			"action":          "reject_edge",
			"previous_status": string(edge.HandshakeStatus),
			"new_status":      "rejected",
		}
		if reason != nil && *reason != "" {
			diffMap["reason"] = *reason
		}
		diffJSON, _ := json.Marshal(diffMap)

		_, uErr = q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
			ID:                    uuid.New(),
			EntityType:            "ci_edge",
			EntityID:              edgeID,
			AffectedOwnerGroupIds: []uuid.UUID{edge.SourceOwnerGroupID, edge.TargetOwnerGroupID},
			ActorID:               actor.ID,
			Action:                sqlcgen.AuditActionEnumUpdate,
			Diff:                  diffJSON,
			CreatedAt:             now,
		})
		if uErr != nil {
			return fmt.Errorf("failed to write audit log: %w", uErr)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return mapEdgeToResponse(updatedEdge), nil
}

func mapPendingEdge(
	id uuid.UUID,
	edgeType sqlcgen.EdgeTypeEnum,
	handshakeStatus sqlcgen.HandshakeStatusEnum,
	createdAt time.Time,
	updatedAt time.Time,
	createdBy uuid.UUID,
	sourceCiID uuid.UUID,
	sourceCiName string,
	sourceCiClass sqlcgen.CiClassEnum,
	sourceCiEnv sqlcgen.EnvironmentEnum,
	sourceOwnerGroupID uuid.UUID,
	sourceOwnerGroupName string,
	sourceDeptName string,
	sourceTechContact string,
	targetCiID uuid.UUID,
	targetCiName string,
	targetCiClass sqlcgen.CiClassEnum,
	targetCiEnv sqlcgen.EnvironmentEnum,
	targetOwnerGroupID uuid.UUID,
	targetOwnerGroupName string,
	targetDeptName string,
	targetTechContact string,
) gen.PendingEdge {
	return gen.PendingEdge{
		Id:              id,
		EdgeType:        gen.PendingEdgeEdgeType(edgeType),
		HandshakeStatus: gen.PendingEdgeHandshakeStatus(handshakeStatus),
		CreatedAt:       createdAt,
		UpdatedAt:       &updatedAt,
		CreatedBy:       &createdBy,
		SourceCi: gen.EdgeCIPeer{
			CiId:             sourceCiID,
			Name:             sourceCiName,
			CiClass:          gen.EdgeCIPeerCiClass(sourceCiClass),
			Environment:      gen.EdgeCIPeerEnvironment(sourceCiEnv),
			OwnerGroupId:     sourceOwnerGroupID,
			OwnerGroupName:   sourceOwnerGroupName,
			DepartmentName:   sourceDeptName,
			TechnicalContact: sourceTechContact,
		},
		TargetCi: gen.EdgeCIPeer{
			CiId:             targetCiID,
			Name:             targetCiName,
			CiClass:          gen.EdgeCIPeerCiClass(targetCiClass),
			Environment:      gen.EdgeCIPeerEnvironment(targetCiEnv),
			OwnerGroupId:     targetOwnerGroupID,
			OwnerGroupName:   targetOwnerGroupName,
			DepartmentName:   targetDeptName,
			TechnicalContact: targetTechContact,
		},
	}
}

func mapEdgeToResponse(edge sqlcgen.CiEdge) *gen.EdgeResponse {
	var confirmedBy *uuid.UUID
	if edge.ConfirmedBy.Valid {
		id := uuid.UUID(edge.ConfirmedBy.Bytes)
		confirmedBy = &id
	}
	var confirmedAt *time.Time
	if edge.ConfirmedAt.Valid {
		t := edge.ConfirmedAt.Time
		confirmedAt = &t
	}

	return &gen.EdgeResponse{
		Id:              edge.ID,
		SourceCiId:      edge.SourceCiID,
		TargetCiId:      edge.TargetCiID,
		EdgeType:        gen.EdgeResponseEdgeType(edge.EdgeType),
		HandshakeStatus: gen.EdgeResponseHandshakeStatus(edge.HandshakeStatus),
		CreatedBy:       edge.CreatedBy,
		ConfirmedBy:     confirmedBy,
		ConfirmedAt:     confirmedAt,
		CreatedAt:       edge.CreatedAt,
		UpdatedAt:       edge.UpdatedAt,
	}
}
