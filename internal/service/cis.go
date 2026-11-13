package service

import (
	"context"
	"encoding/base64"
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

// SearchCursor holds the pagination keyset for deterministic catalog search ordering.
type SearchCursor struct {
	Score float32   `json:"s"`
	Name  string    `json:"n"`
	CIID  uuid.UUID `json:"id"`
}

func encodeSearchCursor(score float32, name string, ciID uuid.UUID) string {
	c := SearchCursor{
		Score: score,
		Name:  name,
		CIID:  ciID,
	}
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeSearchCursor(raw string) (*SearchCursor, error) {
	if raw == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid cursor encoding", domain.ErrBadParam)
	}
	var c SearchCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("%w: invalid cursor payload", domain.ErrBadParam)
	}
	if c.CIID == uuid.Nil {
		return nil, fmt.Errorf("%w: invalid cursor CI ID", domain.ErrBadParam)
	}
	return &c, nil
}

// CIService manages post-baseline Configuration Item lifecycles.
type CIService struct {
	store *postgres.Store
}

// NewCIService creates a new CIService instance.
func NewCIService(store *postgres.Store) *CIService {
	return &CIService{store: store}
}

// SearchCIs performs hybrid prefix and trigram similarity search against the active CI catalog with deterministic keyset pagination.
func (s *CIService) SearchCIs(ctx context.Context, params gen.SearchCIsParams) (*gen.CISearchResponse, error) {
	query := ""
	if params.Q != nil {
		query = *params.Q
	}
	ciClass := ""
	if params.CiClass != nil {
		ciClass = string(*params.CiClass)
	}
	environment := ""
	if params.Environment != nil {
		environment = string(*params.Environment)
	}
	ownerGroupID := uuid.Nil
	if params.OwnerGroupId != nil {
		ownerGroupID = *params.OwnerGroupId
	}
	limit := int32(20)
	if params.Limit != nil && *params.Limit > 0 {
		limit = int32(*params.Limit)
	}

	var hasCursor bool
	var lastScore float32
	var lastName string
	var lastCIID uuid.UUID

	if params.Cursor != nil && *params.Cursor != "" {
		cur, err := decodeSearchCursor(*params.Cursor)
		if err != nil {
			return nil, err
		}
		if cur != nil {
			hasCursor = true
			lastScore = cur.Score
			lastName = cur.Name
			lastCIID = cur.CIID
		}
	}

	// Fetch limit + 1 to detect next page
	fetchLimit := limit + 1

	rows, err := s.store.Queries().SearchCIs(ctx, sqlcgen.SearchCIsParams{
		Query:        query,
		CiClass:      ciClass,
		Environment:  environment,
		OwnerGroupID: ownerGroupID,
		HasCursor:    hasCursor,
		LastScore:    lastScore,
		LastName:     lastName,
		LastCiID:     lastCIID,
		LimitVal:     fetchLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to search CIs: %w", err)
	}

	totalCount, err := s.store.Queries().CountSearchCIs(ctx, sqlcgen.CountSearchCIsParams{
		Query:        query,
		CiClass:      ciClass,
		Environment:  environment,
		OwnerGroupID: ownerGroupID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to count search CIs: %w", err)
	}

	var nextCursor *string
	if int32(len(rows)) > limit {
		lastItem := rows[limit-1]
		enc := encodeSearchCursor(lastItem.Score, lastItem.Name, lastItem.CiID)
		nextCursor = &enc
		rows = rows[:limit]
	}

	results := make([]gen.CISearchResult, 0, len(rows))
	for _, r := range rows {
		envelope := mapSearchRowToCIEnvelope(r)
		var ownership gen.OwnershipHeader
		if envelope.Ownership != nil {
			ownership = *envelope.Ownership
		}
		results = append(results, gen.CISearchResult{
			Ci:        envelope,
			Ownership: ownership,
			Score:     r.Score,
		})
	}

	return &gen.CISearchResponse{
		Items:      results,
		Total:      int(totalCount),
		NextCursor: nextCursor,
	}, nil
}

// GetCIDetail aggregates CI envelope, pinned ownership, graph summaries, and verification status.
func (s *CIService) GetCIDetail(ctx context.Context, id uuid.UUID) (*gen.CIDetailResponse, error) {
	// 1. Fetch CI with owner group details
	ci, err := s.store.Queries().GetCIByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: CI not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to fetch CI: %w", err)
	}

	// 2. Fetch Aggregates
	aggs, err := s.store.Queries().GetCIDetailAggregates(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch CI aggregates: %w", err)
	}

	// 3. Map envelope & pinned ownership
	envelope := mapGetCIByIDRowToEnvelope(ci)

	// 4. Stale check: last_verified_at < now - 60 days
	isStale := time.Since(ci.LastVerifiedAt) > 60*24*time.Hour

	var highestTier *gen.CIUpwardSummaryHighestCriticalityTier
	if aggs.HighestCriticalityTier != "" {
		tier := gen.CIUpwardSummaryHighestCriticalityTier(aggs.HighestCriticalityTier)
		highestTier = &tier
	}

	var ownership gen.OwnershipHeader
	if envelope.Ownership != nil {
		ownership = *envelope.Ownership
	}

	return &gen.CIDetailResponse{
		Ci:        envelope,
		Ownership: ownership,
		VerificationStatus: gen.CIVerificationStatus{
			LastVerifiedAt:   ci.LastVerifiedAt,
			IsStale:          isStale,
			PendingEdgeCount: int(aggs.PendingEdgeCount),
			OpenFlagCount:    int(aggs.OpenFlagCount),
		},
		UpwardSummary: gen.CIUpwardSummary{
			DirectDependentCount:   int(aggs.DirectDependentCount),
			TotalUpstreamCount:     int(aggs.TotalUpstreamCount),
			HighestCriticalityTier: highestTier,
		},
		DownwardSummary: gen.CIDownwardSummary{
			DirectDependencyCount: int(aggs.DirectDependencyCount),
			TotalDownstreamCount:  int(aggs.TotalDownstreamCount),
		},
	}, nil
}

func mapGetCIByIDRowToEnvelope(ci sqlcgen.GetCIByIDRow) gen.CIEnvelope {
	var primaryEndpoint *string
	if ci.PrimaryEndpoint.Valid {
		primaryEndpoint = &ci.PrimaryEndpoint.String
	}
	var itamRef *string
	if ci.ItamExternalRef.Valid {
		itamRef = &ci.ItamExternalRef.String
	}
	classMetadata := make(map[string]string)
	if len(ci.ClassMetadata) > 0 {
		_ = json.Unmarshal(ci.ClassMetadata, &classMetadata)
	}

	return gen.CIEnvelope{
		CiId:             &ci.CiID,
		Name:             ci.Name,
		CiClass:          gen.CIEnvelopeCiClass(ci.CiClass),
		Environment:      gen.CIEnvelopeEnvironment(ci.Environment),
		LifecycleState:   gen.CIEnvelopeLifecycleState(ci.LifecycleState),
		CriticalityTier:  gen.CIEnvelopeCriticalityTier(ci.CriticalityTier),
		OwnerGroupId:     ci.OwnerGroupID,
		TechnicalContact: ci.TechnicalContact,
		PrimaryEndpoint:  primaryEndpoint,
		ItamExternalRef:  itamRef,
		LastVerifiedAt:   &ci.LastVerifiedAt,
		ClassMetadata:    classMetadata,
		CreatedAt:        &ci.CreatedAt,
		UpdatedAt:        &ci.UpdatedAt,
		Ownership: &gen.OwnershipHeader{
			OwnerGroupId:     ci.OwnerGroupID,
			OwnerGroupName:   ci.OwnerGroupName,
			DepartmentName:   ci.DepartmentName,
			TechnicalContact: ci.TechnicalContact,
			TeamLeadName:     ci.TeamLeadName,
			TeamLeadEmail:    openapi_types.Email(ci.TeamLeadEmail),
		},
	}
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
