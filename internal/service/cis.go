package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	sqlcgen "github.com/org/etcms-backend/internal/adapters/postgres/gen"
	"github.com/org/etcms-backend/internal/domain"
)

// CIService manages post-baseline Configuration Item lifecycles.
type CIService struct {
	store *postgres.Store
}

// NewCIService creates a new CIService instance.
func NewCIService(store *postgres.Store) *CIService {
	return &CIService{store: store}
}

// CreateCI creates a single configuration item post-baseline with strict envelope and owner RBAC validation.
func (s *CIService) CreateCI(ctx context.Context, actor domain.Actor, req gen.CreateCIRequest) (*gen.CIEnvelope, error) {
	// 1. RBAC Check: Viewers cannot create CIs; caller must belong to owner group
	if actor.Role == domain.RoleViewer {
		return nil, domain.ErrForbidden
	}
	if !actor.BelongsToOwnerGroup(req.OwnerGroupId) {
		return nil, domain.ErrForbidden
	}

	// 2. Validate owner group exists
	og, err := s.store.Queries().GetOwnerGroupByID(ctx, req.OwnerGroupId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: owner group not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to query owner group: %w", err)
	}

	// 3. Envelope validation
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("%w: name cannot be empty", domain.ErrBadParam)
	}
	techContact := strings.TrimSpace(req.TechnicalContact)
	if techContact == "" {
		return nil, fmt.Errorf("%w: technical_contact cannot be empty", domain.ErrBadParam)
	}

	if req.ClassMetadata != nil && len(*req.ClassMetadata) > 2 {
		return nil, &domain.ValidationError{
			Message: "class_metadata cannot exceed 2 keys",
		}
	}

	var metaJSON []byte
	if req.ClassMetadata != nil {
		metaJSON, _ = json.Marshal(req.ClassMetadata)
	} else {
		metaJSON = []byte("{}")
	}

	var epText pgtype.Text
	if req.PrimaryEndpoint != nil && *req.PrimaryEndpoint != "" {
		epText = pgtype.Text{String: *req.PrimaryEndpoint, Valid: true}
	}
	var itamText pgtype.Text
	if req.ItamExternalRef != nil && *req.ItamExternalRef != "" {
		itamText = pgtype.Text{String: *req.ItamExternalRef, Valid: true}
	}

	now := time.Now().UTC()
	ciID := uuid.New()
	var createdCI sqlcgen.Ci

	err = s.store.WithAuditTx(ctx, actor, func(tx pgx.Tx, q *sqlcgen.Queries) error {
		var cErr error
		createdCI, cErr = q.CreateCI(ctx, sqlcgen.CreateCIParams{
			CiID:             ciID,
			Name:             name,
			CiClass:          sqlcgen.CiClassEnum(req.CiClass),
			Environment:      sqlcgen.EnvironmentEnum(req.Environment),
			LifecycleState:   sqlcgen.LifecycleStateEnumInService,
			CriticalityTier:  sqlcgen.CriticalityTierEnum(req.CriticalityTier),
			OwnerGroupID:     req.OwnerGroupId,
			TechnicalContact: techContact,
			PrimaryEndpoint:  epText,
			LastVerifiedAt:   now,
			ItamExternalRef:  itamText,
			ClassMetadata:    metaJSON,
			CreatedAt:        now,
			UpdatedAt:        now,
		})
		if cErr != nil {
			var pgErr *pgconn.PgError
			if errors.As(cErr, &pgErr) && pgErr.Code == "23505" {
				return fmt.Errorf("%w: active CI with name '%s', class '%s', and environment '%s' already exists", domain.ErrConflict, name, req.CiClass, req.Environment)
			}
			return fmt.Errorf("failed to create CI: %w", cErr)
		}

		diffJSON, _ := json.Marshal(map[string]interface{}{
			"action":            "create_ci",
			"name":              createdCI.Name,
			"ci_class":          string(createdCI.CiClass),
			"environment":       string(createdCI.Environment),
			"criticality_tier":  string(createdCI.CriticalityTier),
			"owner_group_id":    createdCI.OwnerGroupID.String(),
			"technical_contact": createdCI.TechnicalContact,
		})

		_, cErr = q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
			ID:                    uuid.New(),
			EntityType:            "ci",
			EntityID:              ciID,
			AffectedOwnerGroupIds: []uuid.UUID{createdCI.OwnerGroupID},
			ActorID:               actor.ID,
			Action:                sqlcgen.AuditActionEnumCreate,
			Diff:                  diffJSON,
			CreatedAt:             now,
		})
		if cErr != nil {
			return fmt.Errorf("failed to write audit log: %w", cErr)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	classMetaMap := make(map[string]string)
	if len(createdCI.ClassMetadata) > 0 {
		_ = json.Unmarshal(createdCI.ClassMetadata, &classMetaMap)
	}

	var primaryEndpoint *string
	if createdCI.PrimaryEndpoint.Valid {
		primaryEndpoint = &createdCI.PrimaryEndpoint.String
	}
	var itamRef *string
	if createdCI.ItamExternalRef.Valid {
		itamRef = &createdCI.ItamExternalRef.String
	}

	return &gen.CIEnvelope{
		CiId:             &createdCI.CiID,
		Name:             createdCI.Name,
		CiClass:          gen.CIEnvelopeCiClass(createdCI.CiClass),
		Environment:      gen.CIEnvelopeEnvironment(createdCI.Environment),
		LifecycleState:   gen.CIEnvelopeLifecycleState(createdCI.LifecycleState),
		CriticalityTier:  gen.CIEnvelopeCriticalityTier(createdCI.CriticalityTier),
		OwnerGroupId:     createdCI.OwnerGroupID,
		TechnicalContact: createdCI.TechnicalContact,
		PrimaryEndpoint:  primaryEndpoint,
		ItamExternalRef:  itamRef,
		LastVerifiedAt:   &createdCI.LastVerifiedAt,
		ClassMetadata:    classMetaMap,
		CreatedAt:        &createdCI.CreatedAt,
		UpdatedAt:        &createdCI.UpdatedAt,
		Ownership: &gen.OwnershipHeader{
			OwnerGroupId:     og.ID,
			OwnerGroupName:   og.Name,
			DepartmentName:   og.DepartmentName,
			TechnicalContact: createdCI.TechnicalContact,
			TeamLeadName:     og.TeamLeadName,
			TeamLeadEmail:    openapi_types.Email(og.TeamLeadEmail),
		},
	}, nil
}
