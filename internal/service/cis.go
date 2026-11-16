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
	lifecycleState := ""
	if params.LifecycleState != nil {
		lifecycleState = string(*params.LifecycleState)
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
		Query:          query,
		LifecycleState: lifecycleState,
		CiClass:        ciClass,
		Environment:    environment,
		OwnerGroupID:   ownerGroupID,
		HasCursor:      hasCursor,
		LastScore:      lastScore,
		LastName:       lastName,
		LastCiID:       lastCIID,
		LimitVal:       fetchLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to search CIs: %w", err)
	}

	totalCount, err := s.store.Queries().CountSearchCIs(ctx, sqlcgen.CountSearchCIsParams{
		Query:          query,
		LifecycleState: lifecycleState,
		CiClass:        ciClass,
		Environment:    environment,
		OwnerGroupID:   ownerGroupID,
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
		CiClass:          string(ci.CiClass),
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
	// 1. RBAC Check: Viewers cannot create CIs
	if actor.Role == domain.RoleViewer {
		return nil, domain.ErrForbidden
	}

	// Resolve OwnerGroupID: default to creator's owner group if not specified
	var ownerGroupID uuid.UUID
	if req.OwnerGroupId != nil && *req.OwnerGroupId != uuid.Nil {
		ownerGroupID = *req.OwnerGroupId
	} else if actor.PrimaryOwnerGroupID != nil && *actor.PrimaryOwnerGroupID != uuid.Nil {
		ownerGroupID = *actor.PrimaryOwnerGroupID
	} else if len(actor.OwnerGroupIDs) > 0 {
		ownerGroupID = actor.OwnerGroupIDs[0]
	} else {
		// Fallback for platform admin or users with unassigned owner groups: query primary active owner group
		ogs, ogErr := s.store.Queries().ListOwnerGroups(ctx)
		if ogErr == nil && len(ogs) > 0 {
			ownerGroupID = ogs[0].ID
		}
	}

	if ownerGroupID == uuid.Nil {
		return nil, fmt.Errorf("%w: owner group could not be determined", domain.ErrBadParam)
	}

	if !actor.BelongsToOwnerGroup(ownerGroupID) {
		return nil, domain.ErrForbidden
	}

	// 2. Validate owner group exists
	og, err := s.store.Queries().GetOwnerGroupByID(ctx, ownerGroupID)
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

	// Resolve TechnicalContact: default to creator's email if not specified
	var techContact string
	if req.TechnicalContact != nil && strings.TrimSpace(*req.TechnicalContact) != "" {
		techContact = strings.TrimSpace(*req.TechnicalContact)
	} else if actor.Email != "" {
		techContact = actor.Email
	} else {
		return nil, fmt.Errorf("%w: technical_contact cannot be empty", domain.ErrBadParam)
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
			CiClass:          req.CiClass,
			Environment:      sqlcgen.EnvironmentEnum(req.Environment),
			LifecycleState:   sqlcgen.LifecycleStateEnumInService,
			CriticalityTier:  sqlcgen.CriticalityTierEnum(req.CriticalityTier),
			OwnerGroupID:     ownerGroupID,
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
		CiClass:          string(createdCI.CiClass),
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

// UpdateCI updates a configuration item with domain-restricted RBAC, volatile-only verification stamping, and diff auditing.
func (s *CIService) UpdateCI(ctx context.Context, actor domain.Actor, ciID uuid.UUID, req gen.UpdateCIRequest) (*gen.CIEnvelope, error) {
	// 1. Fetch existing CI
	existingCI, err := s.store.Queries().GetCIByID(ctx, ciID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: CI not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to fetch CI: %w", err)
	}

	// 2. Domain RBAC: actor must belong to existingCI.OwnerGroupID or be platform_admin
	if actor.Role != domain.RolePlatformAdmin && !actor.BelongsToOwnerGroup(existingCI.OwnerGroupID) {
		return nil, domain.ErrForbidden
	}

	// 3. Disallow retiring CIs via PATCH (retirement must use POST .../retire)
	if req.LifecycleState != nil && *req.LifecycleState == gen.UpdateCIRequestLifecycleStateRetired {
		return nil, &domain.ValidationError{
			Message: "cannot retire CI via PATCH; retirement must use POST /api/v1/cis/{id}/retire",
		}
	}

	// 4. Validate class_metadata if provided
	metaJSON := existingCI.ClassMetadata
	if req.ClassMetadata != nil {
		var mErr error
		metaJSON, mErr = json.Marshal(*req.ClassMetadata)
		if mErr != nil {
			return nil, &domain.ValidationError{
				Message: "invalid class_metadata format",
			}
		}
	}

	// 5. Track diff and determine whether volatile fields were modified
	oldValues := make(map[string]interface{})
	newValues := make(map[string]interface{})
	isVolatileChanged := false

	name := existingCI.Name
	if req.Name != nil && *req.Name != "" && *req.Name != existingCI.Name {
		oldValues["name"] = existingCI.Name
		newValues["name"] = *req.Name
		name = *req.Name
	}

	ciClass := existingCI.CiClass
	if req.CiClass != nil && *req.CiClass != existingCI.CiClass {
		oldValues["ci_class"] = existingCI.CiClass
		newValues["ci_class"] = *req.CiClass
		ciClass = *req.CiClass
	}

	env := existingCI.Environment
	if req.Environment != nil && string(*req.Environment) != string(existingCI.Environment) {
		oldValues["environment"] = string(existingCI.Environment)
		newValues["environment"] = string(*req.Environment)
		env = sqlcgen.EnvironmentEnum(*req.Environment)
	}

	lifecycleState := existingCI.LifecycleState
	if req.LifecycleState != nil && string(*req.LifecycleState) != string(existingCI.LifecycleState) {
		oldValues["lifecycle_state"] = string(existingCI.LifecycleState)
		newValues["lifecycle_state"] = string(*req.LifecycleState)
		lifecycleState = sqlcgen.LifecycleStateEnum(*req.LifecycleState)
	}

	// Volatile 1: Criticality Tier
	critTier := existingCI.CriticalityTier
	if req.CriticalityTier != nil && string(*req.CriticalityTier) != string(existingCI.CriticalityTier) {
		isVolatileChanged = true
		oldValues["criticality_tier"] = string(existingCI.CriticalityTier)
		newValues["criticality_tier"] = string(*req.CriticalityTier)
		critTier = sqlcgen.CriticalityTierEnum(*req.CriticalityTier)
	}

	// Volatile 2: Owner Group ID
	ownerGroupID := existingCI.OwnerGroupID
	affectedGroups := []uuid.UUID{existingCI.OwnerGroupID}
	if req.OwnerGroupId != nil && *req.OwnerGroupId != existingCI.OwnerGroupID {
		_, ogErr := s.store.Queries().GetOwnerGroupByID(ctx, *req.OwnerGroupId)
		if ogErr != nil {
			if errors.Is(ogErr, pgx.ErrNoRows) {
				return nil, fmt.Errorf("%w: target owner group not found", domain.ErrNotFound)
			}
			return nil, fmt.Errorf("failed to query new owner group: %w", ogErr)
		}
		isVolatileChanged = true
		oldValues["owner_group_id"] = existingCI.OwnerGroupID.String()
		newValues["owner_group_id"] = req.OwnerGroupId.String()
		ownerGroupID = *req.OwnerGroupId
		affectedGroups = append(affectedGroups, ownerGroupID)
	}

	// Volatile 3: Technical Contact
	techContact := existingCI.TechnicalContact
	if req.TechnicalContact != nil && *req.TechnicalContact != existingCI.TechnicalContact {
		isVolatileChanged = true
		oldValues["technical_contact"] = existingCI.TechnicalContact
		newValues["technical_contact"] = *req.TechnicalContact
		techContact = *req.TechnicalContact
	}

	// Volatile 4: Primary Endpoint
	primaryEndpoint := existingCI.PrimaryEndpoint
	if req.PrimaryEndpoint != nil {
		oldEp := ""
		if existingCI.PrimaryEndpoint.Valid {
			oldEp = existingCI.PrimaryEndpoint.String
		}
		newEp := *req.PrimaryEndpoint
		if newEp != oldEp {
			isVolatileChanged = true
			oldValues["primary_endpoint"] = oldEp
			newValues["primary_endpoint"] = newEp
			if newEp != "" {
				primaryEndpoint = pgtype.Text{String: newEp, Valid: true}
			} else {
				primaryEndpoint = pgtype.Text{Valid: false}
			}
		}
	}

	// Cosmetic: ITAM External Ref
	itamRef := existingCI.ItamExternalRef
	if req.ItamExternalRef != nil {
		oldRef := ""
		if existingCI.ItamExternalRef.Valid {
			oldRef = existingCI.ItamExternalRef.String
		}
		newRef := *req.ItamExternalRef
		if newRef != oldRef {
			oldValues["itam_external_ref"] = oldRef
			newValues["itam_external_ref"] = newRef
			if newRef != "" {
				itamRef = pgtype.Text{String: newRef, Valid: true}
			} else {
				itamRef = pgtype.Text{Valid: false}
			}
		}
	}

	// Cosmetic: Class Metadata
	if req.ClassMetadata != nil && string(metaJSON) != string(existingCI.ClassMetadata) {
		oldValues["class_metadata"] = string(existingCI.ClassMetadata)
		newValues["class_metadata"] = string(metaJSON)
	}

	// 6. Stamping Rule: Volatile modification stamps last_verified_at = now(); cosmetic modification only touches updated_at
	now := time.Now().UTC()
	newUpdatedAt := now
	newLastVerifiedAt := existingCI.LastVerifiedAt
	if isVolatileChanged {
		newLastVerifiedAt = now
	}

	// 7. Execute update inside WithAuditTx
	var updatedRow sqlcgen.UpdateCIRow
	diffJSON, _ := json.Marshal(map[string]interface{}{
		"old_values": oldValues,
		"new_values": newValues,
	})

	err = s.store.WithAuditTx(ctx, actor, func(tx pgx.Tx, q *sqlcgen.Queries) error {
		var uErr error
		updatedRow, uErr = q.UpdateCI(ctx, sqlcgen.UpdateCIParams{
			CiID:             ciID,
			Name:             name,
			CiClass:          ciClass,
			Environment:      env,
			LifecycleState:   lifecycleState,
			CriticalityTier:  critTier,
			OwnerGroupID:     ownerGroupID,
			TechnicalContact: techContact,
			PrimaryEndpoint:  primaryEndpoint,
			LastVerifiedAt:   newLastVerifiedAt,
			ItamExternalRef:  itamRef,
			ClassMetadata:    metaJSON,
			UpdatedAt:        newUpdatedAt,
		})
		if uErr != nil {
			var pgErr *pgconn.PgError
			if errors.As(uErr, &pgErr) && pgErr.Code == "23505" {
				return fmt.Errorf("%w: active CI with name '%s', class '%s', and environment '%s' already exists", domain.ErrConflict, name, ciClass, env)
			}
			return fmt.Errorf("failed to update CI: %w", uErr)
		}

		_, aErr := q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
			ID:                    uuid.New(),
			EntityType:            "ci",
			EntityID:              ciID,
			AffectedOwnerGroupIds: affectedGroups,
			ActorID:               actor.ID,
			Action:                sqlcgen.AuditActionEnumUpdate,
			Diff:                  diffJSON,
			CreatedAt:             now,
		})
		if aErr != nil {
			return fmt.Errorf("failed to write audit log: %w", aErr)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	res := mapUpdateCIRowToEnvelope(updatedRow)
	return &res, nil
}

// CreateCIFlag allows any authenticated user to report a data-quality flag on a CI.
func (s *CIService) CreateCIFlag(ctx context.Context, actor domain.Actor, ciID uuid.UUID, req gen.CreateCIFlagRequest) (*gen.CIFlagResponse, error) {
	trimmedReason := strings.TrimSpace(req.Reason)
	if len(trimmedReason) < 5 {
		return nil, &domain.ValidationError{
			Message: "reason must be at least 5 characters",
		}
	}

	// Verify CI exists
	ci, err := s.store.Queries().GetCIByID(ctx, ciID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: CI not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to fetch CI: %w", err)
	}

	now := time.Now().UTC()
	flagID := uuid.New()
	var createdFlag sqlcgen.CiFlag

	err = s.store.WithAuditTx(ctx, actor, func(tx pgx.Tx, q *sqlcgen.Queries) error {
		var fErr error
		createdFlag, fErr = q.CreateCIFlag(ctx, sqlcgen.CreateCIFlagParams{
			ID:        flagID,
			CiID:      ciID,
			FlaggedBy: actor.ID,
			Reason:    trimmedReason,
			CreatedAt: now,
		})
		if fErr != nil {
			return fmt.Errorf("failed to insert CI flag: %w", fErr)
		}

		diffData := map[string]interface{}{
			"flag_id": flagID.String(),
			"reason":  trimmedReason,
		}
		if req.FlagType != nil {
			diffData["flag_type"] = *req.FlagType
		}
		diffJSON, _ := json.Marshal(diffData)

		_, aErr := q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
			ID:                    uuid.New(),
			EntityType:            "ci",
			EntityID:              ciID,
			AffectedOwnerGroupIds: []uuid.UUID{ci.OwnerGroupID},
			ActorID:               actor.ID,
			Action:                sqlcgen.AuditActionEnumFlag,
			Diff:                  diffJSON,
			CreatedAt:             now,
		})
		if aErr != nil {
			return fmt.Errorf("failed to write audit log: %w", aErr)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	var resAt *time.Time
	if createdFlag.ResolvedAt.Valid {
		resAt = &createdFlag.ResolvedAt.Time
	}
	var resBy *openapi_types.UUID
	if createdFlag.ResolvedBy.Valid {
		resBy = (*openapi_types.UUID)(&createdFlag.ResolvedBy.Bytes)
	}

	return &gen.CIFlagResponse{
		Id:         createdFlag.ID,
		CiId:       createdFlag.CiID,
		FlaggedBy:  createdFlag.FlaggedBy,
		Reason:     createdFlag.Reason,
		Status:     gen.CIFlagResponseStatus(createdFlag.Status),
		CreatedAt:  createdFlag.CreatedAt,
		ResolvedAt: resAt,
		ResolvedBy: resBy,
	}, nil
}

func mapUpdateCIRowToEnvelope(u sqlcgen.UpdateCIRow) gen.CIEnvelope {
	var primaryEndpoint *string
	if u.PrimaryEndpoint.Valid {
		primaryEndpoint = &u.PrimaryEndpoint.String
	}
	var itamRef *string
	if u.ItamExternalRef.Valid {
		itamRef = &u.ItamExternalRef.String
	}
	classMetadata := make(map[string]string)
	if len(u.ClassMetadata) > 0 {
		_ = json.Unmarshal(u.ClassMetadata, &classMetadata)
	}

	return gen.CIEnvelope{
		CiId:             &u.CiID,
		Name:             u.Name,
		CiClass:          string(u.CiClass),
		Environment:      gen.CIEnvelopeEnvironment(u.Environment),
		LifecycleState:   gen.CIEnvelopeLifecycleState(u.LifecycleState),
		CriticalityTier:  gen.CIEnvelopeCriticalityTier(u.CriticalityTier),
		OwnerGroupId:     u.OwnerGroupID,
		TechnicalContact: u.TechnicalContact,
		PrimaryEndpoint:  primaryEndpoint,
		ItamExternalRef:  itamRef,
		LastVerifiedAt:   &u.LastVerifiedAt,
		ClassMetadata:    classMetadata,
		CreatedAt:        &u.CreatedAt,
		UpdatedAt:        &u.UpdatedAt,
		Ownership: &gen.OwnershipHeader{
			OwnerGroupId:     u.OwnerGroupID,
			OwnerGroupName:   u.OwnerGroupName,
			DepartmentName:   u.DepartmentName,
			TechnicalContact: u.TechnicalContact,
			TeamLeadName:     u.TeamLeadName,
			TeamLeadEmail:    openapi_types.Email(u.TeamLeadEmail),
		},
	}
}


// GetUpwardImpact performs cycle-safe upward impact traversal following target_ci_id -> source_ci_id dependencies.
func (s *CIService) GetUpwardImpact(ctx context.Context, startCIID uuid.UUID, includeRetired bool) (*gen.UpwardImpactResponse, error) {
	// 1. Verify Start CI exists
	_, err := s.store.Queries().GetCIByID(ctx, startCIID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: CI not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to fetch starting CI: %w", err)
	}

	// 2. Fetch reachable upstream nodes
	nodes, err := s.store.Queries().GetUpwardImpactNodes(ctx, sqlcgen.GetUpwardImpactNodesParams{
		StartCiID:      startCIID,
		IncludeRetired: includeRetired,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to query upward impact nodes: %w", err)
	}

	// 3. Fetch connecting subgraph edges
	edges, err := s.store.Queries().GetUpwardImpactEdges(ctx, sqlcgen.GetUpwardImpactEdgesParams{
		StartCiID:      startCIID,
		IncludeRetired: includeRetired,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to query upward impact edges: %w", err)
	}

	// 4. Fetch sibling infrastructure dependencies for reachable applications
	siblings, err := s.store.Queries().GetSiblingDependencies(ctx, sqlcgen.GetSiblingDependenciesParams{
		StartCiID:      startCIID,
		IncludeRetired: includeRetired,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to query sibling dependencies: %w", err)
	}

	// 5. Partition nodes and compute highest criticality tier
	impactedApps := make([]gen.CIEnvelope, 0)
	impactedServices := make([]gen.CIEnvelope, 0)
	allEnvelopes := make([]gen.CIEnvelope, 0, len(nodes))

	var highestTier *gen.UpwardImpactResponseHighestCriticalityTier
	bestRank := 99
	bestTierStr := ""

	for _, n := range nodes {
		env := mapUpwardNodeToEnvelope(n)
		allEnvelopes = append(allEnvelopes, env)

		switch string(n.CiClass) {
		case string(sqlcgen.CiClassEnumApplication):
			impactedApps = append(impactedApps, env)
		case string(sqlcgen.CiClassEnumBusinessService):
			impactedServices = append(impactedServices, env)
		default:
			// Non-application / non-business-service classes
		}

		rank := criticalityRank(n.CriticalityTier)
		if rank < bestRank {
			bestRank = rank
			bestTierStr = string(n.CriticalityTier)
		}
	}

	if bestTierStr != "" {
		t := gen.UpwardImpactResponseHighestCriticalityTier(bestTierStr)
		highestTier = &t
	}

	// 6. Map sibling dependencies
	siblingEnvelopes := make([]gen.CIEnvelope, 0, len(siblings))
	for _, sib := range siblings {
		siblingEnvelopes = append(siblingEnvelopes, mapSiblingToEnvelope(sib))
	}

	// 7. Map edges
	graphEdges := make([]gen.GraphEdge, 0, len(edges))
	for _, e := range edges {
		graphEdges = append(graphEdges, gen.GraphEdge{
			Id:              e.ID,
			SourceCiId:      e.SourceCiID,
			TargetCiId:      e.TargetCiID,
			EdgeType:        string(e.EdgeType),
			HandshakeStatus: gen.GraphEdgeHandshakeStatus(e.HandshakeStatus),
		})
	}

	return &gen.UpwardImpactResponse{
		CiId:                      startCIID,
		HighestCriticalityTier:    highestTier,
		ImpactedApplications:      impactedApps,
		ImpactedBusinessServices:  impactedServices,
		SharedSiblingDependencies: siblingEnvelopes,
		Nodes:                     &allEnvelopes,
		Edges:                     graphEdges,
	}, nil
}

func criticalityRank(tier sqlcgen.CriticalityTierEnum) int {
	switch tier {
	case sqlcgen.CriticalityTierEnumTier0:
		return 0
	case sqlcgen.CriticalityTierEnumTier1:
		return 1
	case sqlcgen.CriticalityTierEnumTier2:
		return 2
	case sqlcgen.CriticalityTierEnumTier3:
		return 3
	default:
		return 4
	}
}

func mapUpwardNodeToEnvelope(n sqlcgen.GetUpwardImpactNodesRow) gen.CIEnvelope {
	var primaryEndpoint *string
	if n.PrimaryEndpoint.Valid {
		primaryEndpoint = &n.PrimaryEndpoint.String
	}
	var itamRef *string
	if n.ItamExternalRef.Valid {
		itamRef = &n.ItamExternalRef.String
	}
	classMetadata := make(map[string]string)
	if len(n.ClassMetadata) > 0 {
		_ = json.Unmarshal(n.ClassMetadata, &classMetadata)
	}

	return gen.CIEnvelope{
		CiId:             &n.CiID,
		Name:             n.Name,
		CiClass:          string(n.CiClass),
		Environment:      gen.CIEnvelopeEnvironment(n.Environment),
		LifecycleState:   gen.CIEnvelopeLifecycleState(n.LifecycleState),
		CriticalityTier:  gen.CIEnvelopeCriticalityTier(n.CriticalityTier),
		OwnerGroupId:     n.OwnerGroupID,
		TechnicalContact: n.TechnicalContact,
		PrimaryEndpoint:  primaryEndpoint,
		ItamExternalRef:  itamRef,
		LastVerifiedAt:   &n.LastVerifiedAt,
		ClassMetadata:    classMetadata,
		CreatedAt:        &n.CreatedAt,
		UpdatedAt:        &n.UpdatedAt,
		Ownership: &gen.OwnershipHeader{
			OwnerGroupId:     n.OwnerGroupID,
			OwnerGroupName:   n.OwnerGroupName,
			DepartmentName:   n.DepartmentName,
			TechnicalContact: n.TechnicalContact,
			TeamLeadName:     n.TeamLeadName,
			TeamLeadEmail:    openapi_types.Email(n.TeamLeadEmail),
		},
	}
}

func mapSiblingToEnvelope(s sqlcgen.GetSiblingDependenciesRow) gen.CIEnvelope {
	var primaryEndpoint *string
	if s.PrimaryEndpoint.Valid {
		primaryEndpoint = &s.PrimaryEndpoint.String
	}
	var itamRef *string
	if s.ItamExternalRef.Valid {
		itamRef = &s.ItamExternalRef.String
	}
	classMetadata := make(map[string]string)
	if len(s.ClassMetadata) > 0 {
		_ = json.Unmarshal(s.ClassMetadata, &classMetadata)
	}

	return gen.CIEnvelope{
		CiId:             &s.CiID,
		Name:             s.Name,
		CiClass:          string(s.CiClass),
		Environment:      gen.CIEnvelopeEnvironment(s.Environment),
		LifecycleState:   gen.CIEnvelopeLifecycleState(s.LifecycleState),
		CriticalityTier:  gen.CIEnvelopeCriticalityTier(s.CriticalityTier),
		OwnerGroupId:     s.OwnerGroupID,
		TechnicalContact: s.TechnicalContact,
		PrimaryEndpoint:  primaryEndpoint,
		ItamExternalRef:  itamRef,
		LastVerifiedAt:   &s.LastVerifiedAt,
		ClassMetadata:    classMetadata,
		CreatedAt:        &s.CreatedAt,
		UpdatedAt:        &s.UpdatedAt,
		Ownership: &gen.OwnershipHeader{
			OwnerGroupId:     s.OwnerGroupID,
			OwnerGroupName:   s.OwnerGroupName,
			DepartmentName:   s.DepartmentName,
			TechnicalContact: s.TechnicalContact,
			TeamLeadName:     s.TeamLeadName,
			TeamLeadEmail:    openapi_types.Email(s.TeamLeadEmail),
		},
	}
}

// GetDownwardDependencies traverses downward outgoing dependencies for a CI and identifies shared dependencies.
func (s *CIService) GetDownwardDependencies(ctx context.Context, startCIID uuid.UUID, includeRetired bool) (*gen.DownwardDependenciesResponse, error) {
	// 1. Verify start CI exists
	_, err := s.store.Queries().GetCIByID(ctx, startCIID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: CI not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to fetch CI: %w", err)
	}

	// 2. Fetch downstream nodes
	nodes, err := s.store.Queries().GetDownwardDependencyNodes(ctx, sqlcgen.GetDownwardDependencyNodesParams{
		StartCiID:      startCIID,
		IncludeRetired: includeRetired,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to query downward dependency nodes: %w", err)
	}

	// 3. Fetch connecting subgraph edges
	edges, err := s.store.Queries().GetDownwardDependencyEdges(ctx, sqlcgen.GetDownwardDependencyEdgesParams{
		StartCiID:      startCIID,
		IncludeRetired: includeRetired,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to query downward dependency edges: %w", err)
	}


	// 4. Map edges and compute in-degree from distinct immediate parents within the reachable subgraph
	incomingParents := make(map[uuid.UUID]map[uuid.UUID]struct{})
	graphEdges := make([]gen.GraphEdge, 0, len(edges))
	for _, e := range edges {
		graphEdges = append(graphEdges, gen.GraphEdge{
			Id:              e.ID,
			SourceCiId:      e.SourceCiID,
			TargetCiId:      e.TargetCiID,
			EdgeType:        string(e.EdgeType),
			HandshakeStatus: gen.GraphEdgeHandshakeStatus(e.HandshakeStatus),
		})

		if _, exists := incomingParents[e.TargetCiID]; !exists {
			incomingParents[e.TargetCiID] = make(map[uuid.UUID]struct{})
		}
		incomingParents[e.TargetCiID][e.SourceCiID] = struct{}{}
	}

	// 5. Construct downward dependency nodes & calculate is_shared_dependency
	depNodes := make([]gen.DownwardDependencyNode, 0, len(nodes))
	sharedDeps := make([]gen.DownwardDependencyNode, 0)

	for _, n := range nodes {
		inDegree := len(incomingParents[n.CiID])
		isShared := inDegree >= 2

		depNode := gen.DownwardDependencyNode{
			Ci:                 mapDownwardNodeToEnvelope(n),
			Depth:              int(n.Depth),
			IsSharedDependency: isShared,
			SubgraphInDegree:   inDegree,
		}
		depNodes = append(depNodes, depNode)
		if isShared {
			sharedDeps = append(sharedDeps, depNode)
		}
	}

	return &gen.DownwardDependenciesResponse{
		CiId:               startCIID,
		Edges:              graphEdges,
		Nodes:              depNodes,
		SharedDependencies: &sharedDeps,
		TotalDependencies:  len(depNodes),
	}, nil
}

func mapDownwardNodeToEnvelope(n sqlcgen.GetDownwardDependencyNodesRow) gen.CIEnvelope {
	var primaryEndpoint *string
	if n.PrimaryEndpoint.Valid {
		primaryEndpoint = &n.PrimaryEndpoint.String
	}
	var itamRef *string
	if n.ItamExternalRef.Valid {
		itamRef = &n.ItamExternalRef.String
	}
	classMetadata := make(map[string]string)
	if len(n.ClassMetadata) > 0 {
		_ = json.Unmarshal(n.ClassMetadata, &classMetadata)
	}

	return gen.CIEnvelope{
		CiId:             &n.CiID,
		Name:             n.Name,
		CiClass:          string(n.CiClass),
		Environment:      gen.CIEnvelopeEnvironment(n.Environment),
		LifecycleState:   gen.CIEnvelopeLifecycleState(n.LifecycleState),
		CriticalityTier:  gen.CIEnvelopeCriticalityTier(n.CriticalityTier),
		OwnerGroupId:     n.OwnerGroupID,
		TechnicalContact: n.TechnicalContact,
		PrimaryEndpoint:  primaryEndpoint,
		ItamExternalRef:  itamRef,
		LastVerifiedAt:   &n.LastVerifiedAt,
		ClassMetadata:    classMetadata,
		CreatedAt:        &n.CreatedAt,
		UpdatedAt:        &n.UpdatedAt,
		Ownership: &gen.OwnershipHeader{
			OwnerGroupId:     n.OwnerGroupID,
			OwnerGroupName:   n.OwnerGroupName,
			DepartmentName:   n.DepartmentName,
			TechnicalContact: n.TechnicalContact,
			TeamLeadName:     n.TeamLeadName,
			TeamLeadEmail:    openapi_types.Email(n.TeamLeadEmail),
		},
	}
}

// VerifyCI explicitly verifies a CI's operational accuracy, resolves open flags, and marks digest items actioned.
func (s *CIService) VerifyCI(ctx context.Context, actor *domain.Actor, id uuid.UUID) (*gen.CIEnvelope, error) {
	ci, err := s.store.Queries().GetCIByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: CI not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to fetch CI: %w", err)
	}

	if !actor.BelongsToOwnerGroup(ci.OwnerGroupID) {
		return nil, fmt.Errorf("%w: caller does not belong to owner group %s", domain.ErrForbidden, ci.OwnerGroupID)
	}

	var envelope *gen.CIEnvelope
	err = s.store.WithAuditTx(ctx, *actor, func(tx pgx.Tx, q *sqlcgen.Queries) error {
		now := time.Now().UTC()

		verifiedRow, err := q.VerifyCI(ctx, sqlcgen.VerifyCIParams{
			CiID:       id,
			VerifiedAt: now,
		})
		if err != nil {
			return fmt.Errorf("failed to verify CI: %w", err)
		}

		err = q.ResolveCIFlagsForCI(ctx, sqlcgen.ResolveCIFlagsForCIParams{
			CiID:       id,
			ResolvedAt: pgtype.Timestamptz{Time: now, Valid: true},
			ResolvedBy: pgtype.UUID{Bytes: actor.ID, Valid: true},
		})
		if err != nil {
			return fmt.Errorf("failed to resolve CI flags: %w", err)
		}

		err = q.ActionDigestItemsForCI(ctx, sqlcgen.ActionDigestItemsForCIParams{
			CiID:       id,
			ActionedAt: pgtype.Timestamptz{Time: now, Valid: true},
			ActionType: pgtype.Text{String: "verify", Valid: true},
		})
		if err != nil {
			return fmt.Errorf("failed to action digest items: %w", err)
		}

		diffMap := map[string]any{
			"last_verified_at": map[string]any{
				"old": ci.LastVerifiedAt,
				"new": verifiedRow.LastVerifiedAt,
			},
		}
		diffBytes, _ := json.Marshal(diffMap)

		_, err = q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
			ID:                    uuid.New(),
			EntityType:            "ci",
			EntityID:              id,
			AffectedOwnerGroupIds: []uuid.UUID{ci.OwnerGroupID},
			ActorID:               actor.ID,
			Action:                "verify",
			Diff:                  diffBytes,
			CreatedAt:             now,
		})
		if err != nil {
			return fmt.Errorf("failed to create audit log for CI verification: %w", err)
		}

		env := mapVerifyCIRowToEnvelope(verifiedRow)
		envelope = &env
		return nil
	})
	if err != nil {
		return nil, err
	}

	return envelope, nil
}

// RetireCI transitions a CI to retired status, enforcing upstream dependency checks unless force=true (admin only).
func (s *CIService) RetireCI(ctx context.Context, actor *domain.Actor, id uuid.UUID, force bool) (*gen.CIEnvelope, error) {
	ci, err := s.store.Queries().GetCIByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: CI not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to fetch CI: %w", err)
	}

	if !actor.BelongsToOwnerGroup(ci.OwnerGroupID) {
		return nil, fmt.Errorf("%w: caller does not belong to owner group %s", domain.ErrForbidden, ci.OwnerGroupID)
	}

	if force {
		if !actor.HasRole(domain.RolePlatformAdmin) {
			return nil, fmt.Errorf("%w: force retirement is strictly restricted to platform_admin", domain.ErrForbidden)
		}
	} else {
		dependents, err := s.store.Queries().GetActiveUpstreamDependents(ctx, id)
		if err != nil {
			return nil, fmt.Errorf("failed to check upstream dependents: %w", err)
		}
		if len(dependents) > 0 {
			depList := make([]domain.DependentCI, len(dependents))
			for i, d := range dependents {
				depList[i] = domain.DependentCI{
					CIID:        d.CiID,
					Name:        d.Name,
					CIClass:     string(d.CiClass),
					Environment: string(d.Environment),
				}
			}
			return nil, &domain.ConflictError{
				Message:      fmt.Sprintf("cannot retire CI %s (%s): %d active dependent CIs exist", ci.Name, id, len(dependents)),
				DependentCIs: depList,
			}
		}
	}

	var envelope *gen.CIEnvelope
	err = s.store.WithAuditTx(ctx, *actor, func(tx pgx.Tx, q *sqlcgen.Queries) error {
		now := time.Now().UTC()

		retiredRow, err := q.RetireCI(ctx, sqlcgen.RetireCIParams{
			CiID:      id,
			RetiredAt: now,
		})
		if err != nil {
			return fmt.Errorf("failed to retire CI: %w", err)
		}

		err = q.ActionDigestItemsForCI(ctx, sqlcgen.ActionDigestItemsForCIParams{
			CiID:       id,
			ActionedAt: pgtype.Timestamptz{Time: now, Valid: true},
			ActionType: pgtype.Text{String: "retire", Valid: true},
		})
		if err != nil {
			return fmt.Errorf("failed to action digest items: %w", err)
		}

		diffMap := map[string]any{
			"lifecycle_state": map[string]any{
				"old": ci.LifecycleState,
				"new": "retired",
			},
			"force": force,
		}
		diffBytes, _ := json.Marshal(diffMap)

		_, err = q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
			ID:                    uuid.New(),
			EntityType:            "ci",
			EntityID:              id,
			AffectedOwnerGroupIds: []uuid.UUID{ci.OwnerGroupID},
			ActorID:               actor.ID,
			Action:                "retire",
			Diff:                  diffBytes,
			CreatedAt:             now,
		})
		if err != nil {
			return fmt.Errorf("failed to create audit log for CI retirement: %w", err)
		}

		env := mapRetireCIRowToEnvelope(retiredRow)
		envelope = &env
		return nil
	})
	if err != nil {
		return nil, err
	}

	return envelope, nil
}

func mapVerifyCIRowToEnvelope(u sqlcgen.VerifyCIRow) gen.CIEnvelope {
	var primaryEndpoint *string
	if u.PrimaryEndpoint.Valid {
		primaryEndpoint = &u.PrimaryEndpoint.String
	}
	var itamRef *string
	if u.ItamExternalRef.Valid {
		itamRef = &u.ItamExternalRef.String
	}
	classMetadata := make(map[string]string)
	if len(u.ClassMetadata) > 0 {
		_ = json.Unmarshal(u.ClassMetadata, &classMetadata)
	}

	return gen.CIEnvelope{
		CiId:             &u.CiID,
		Name:             u.Name,
		CiClass:          string(u.CiClass),
		Environment:      gen.CIEnvelopeEnvironment(u.Environment),
		LifecycleState:   gen.CIEnvelopeLifecycleState(u.LifecycleState),
		CriticalityTier:  gen.CIEnvelopeCriticalityTier(u.CriticalityTier),
		OwnerGroupId:     u.OwnerGroupID,
		TechnicalContact: u.TechnicalContact,
		PrimaryEndpoint:  primaryEndpoint,
		ItamExternalRef:  itamRef,
		LastVerifiedAt:   &u.LastVerifiedAt,
		ClassMetadata:    classMetadata,
		CreatedAt:        &u.CreatedAt,
		UpdatedAt:        &u.UpdatedAt,
		Ownership: &gen.OwnershipHeader{
			OwnerGroupId:     u.OwnerGroupID,
			OwnerGroupName:   u.OwnerGroupName,
			DepartmentName:   u.DepartmentName,
			TechnicalContact: u.TechnicalContact,
			TeamLeadName:     u.TeamLeadName,
			TeamLeadEmail:    openapi_types.Email(u.TeamLeadEmail),
		},
	}
}

func mapRetireCIRowToEnvelope(u sqlcgen.RetireCIRow) gen.CIEnvelope {
	var primaryEndpoint *string
	if u.PrimaryEndpoint.Valid {
		primaryEndpoint = &u.PrimaryEndpoint.String
	}
	var itamRef *string
	if u.ItamExternalRef.Valid {
		itamRef = &u.ItamExternalRef.String
	}
	classMetadata := make(map[string]string)
	if len(u.ClassMetadata) > 0 {
		_ = json.Unmarshal(u.ClassMetadata, &classMetadata)
	}

	return gen.CIEnvelope{
		CiId:             &u.CiID,
		Name:             u.Name,
		CiClass:          string(u.CiClass),
		Environment:      gen.CIEnvelopeEnvironment(u.Environment),
		LifecycleState:   gen.CIEnvelopeLifecycleState(u.LifecycleState),
		CriticalityTier:  gen.CIEnvelopeCriticalityTier(u.CriticalityTier),
		OwnerGroupId:     u.OwnerGroupID,
		TechnicalContact: u.TechnicalContact,
		PrimaryEndpoint:  primaryEndpoint,
		ItamExternalRef:  itamRef,
		LastVerifiedAt:   &u.LastVerifiedAt,
		ClassMetadata:    classMetadata,
		CreatedAt:        &u.CreatedAt,
		UpdatedAt:        &u.UpdatedAt,
		Ownership: &gen.OwnershipHeader{
			OwnerGroupId:     u.OwnerGroupID,
			OwnerGroupName:   u.OwnerGroupName,
			DepartmentName:   u.DepartmentName,
			TechnicalContact: u.TechnicalContact,
			TeamLeadName:     u.TeamLeadName,
			TeamLeadEmail:    openapi_types.Email(u.TeamLeadEmail),
		},
	}
}


