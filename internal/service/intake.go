package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	sqlcgen "github.com/org/etcms-backend/internal/adapters/postgres/gen"
	"github.com/org/etcms-backend/internal/domain"
)

var (
	ErrCampaignNotFound  = errors.New("campaign not found")
	ErrTokenNotFound     = errors.New("invitation token not found")
	ErrTokenExpired      = errors.New("invitation token has expired")
	ErrInvalidDeadline   = errors.New("campaign deadline must be in the future")
	ErrNoOwnerGroups     = errors.New("at least one owner group must be specified")
	ErrOwnerGroupNotFound = errors.New("owner group not found")
)

// IntakeService orchestrates intake campaigns, invitations, and progress metrics.
type IntakeService struct {
	store *postgres.Store
}

// NewIntakeService creates a new IntakeService.
func NewIntakeService(store *postgres.Store) *IntakeService {
	return &IntakeService{
		store: store,
	}
}

// GenerateSecureToken generates a 32-byte cryptographically secure random token
// and its lowercase hex SHA-256 hash.
func GenerateSecureToken() (rawToken string, tokenHash string, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", fmt.Errorf("failed to generate random bytes: %w", err)
	}
	rawToken = hex.EncodeToString(buf)
	h := sha256.Sum256([]byte(rawToken))
	tokenHash = hex.EncodeToString(h[:])
	return rawToken, tokenHash, nil
}

// HashToken computes the SHA-256 hex string of a raw token.
func HashToken(rawToken string) string {
	h := sha256.Sum256([]byte(rawToken))
	return hex.EncodeToString(h[:])
}

// CreateCampaignInput holds parameters for campaign creation.
type CreateCampaignInput struct {
	Title         string
	Deadline      time.Time
	OwnerGroupIDs []uuid.UUID
}

// CreateCampaign creates an intake campaign, generates tokenized magic links for each owner group,
// and returns the campaign with invitation URLs.
func (s *IntakeService) CreateCampaign(ctx context.Context, actor domain.Actor, input CreateCampaignInput) (*gen.CampaignResponse, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, domain.ErrForbidden
	}

	if input.Title == "" {
		return nil, fmt.Errorf("title cannot be empty")
	}

	now := time.Now().UTC()
	if !input.Deadline.After(now) {
		return nil, ErrInvalidDeadline
	}

	if len(input.OwnerGroupIDs) == 0 {
		return nil, ErrNoOwnerGroups
	}

	campaignID := uuid.New()
	var invitations []gen.CampaignInvitation

	err := s.store.WithAuditTx(ctx, actor, func(tx pgx.Tx, q *sqlcgen.Queries) error {
		// 1. Create intake_campaigns row
		campaignRow, err := q.CreateIntakeCampaign(ctx, sqlcgen.CreateIntakeCampaignParams{
			ID:        campaignID,
			Title:     input.Title,
			Status:    sqlcgen.CampaignStatusEnumActive,
			Deadline:  input.Deadline,
			CreatedBy: actor.ID,
			CreatedAt: now,
		})
		if err != nil {
			return fmt.Errorf("failed to create intake campaign: %w", err)
		}

		// 2. Generate invitations and initial draft submissions for each owner group
		for _, groupID := range input.OwnerGroupIDs {
			og, err := q.GetOwnerGroupByID(ctx, groupID)
			if err != nil {
				return fmt.Errorf("%w: %s", ErrOwnerGroupNotFound, groupID)
			}

			rawToken, tokenHash, err := GenerateSecureToken()
			if err != nil {
				return err
			}

			invitationID := uuid.New()
			invRow, err := q.CreateIntakeInvitation(ctx, sqlcgen.CreateIntakeInvitationParams{
				ID:             invitationID,
				CampaignID:     campaignRow.ID,
				OwnerGroupID:   og.ID,
				TokenHash:      tokenHash,
				TeamLeadEmail:  og.TeamLeadEmail,
				Status:         sqlcgen.InvitationStatusEnumSent,
				ExpiresAt:      input.Deadline,
				CreatedAt:      now,
			})
			if err != nil {
				return fmt.Errorf("failed to create intake invitation: %w", err)
			}

			// Create initial draft submission
			submissionID := uuid.New()
			_, err = q.CreateIntakeSubmission(ctx, sqlcgen.CreateIntakeSubmissionParams{
				ID:           submissionID,
				InvitationID: invRow.ID,
				OwnerGroupID: og.ID,
				Status:       sqlcgen.SubmissionStatusEnumDraft,
				Payload:      []byte("{}"),
				LockVersion:  1,
				CreatedAt:    now,
				UpdatedAt:    now,
			})
			if err != nil {
				return fmt.Errorf("failed to create intake submission draft: %w", err)
			}

			invitations = append(invitations, gen.CampaignInvitation{
				InvitationId:   invRow.ID,
				OwnerGroupId:   og.ID,
				OwnerGroupName: og.Name,
				DepartmentName: og.DepartmentName,
				TeamLeadName:   og.TeamLeadName,
				TeamLeadEmail:  openapi_types.Email(og.TeamLeadEmail),
				InvitationUrl:  fmt.Sprintf("/intake/%s", rawToken),
				ExpiresAt:      invRow.ExpiresAt,
			})
		}

		// 3. Log audit event
		auditDiff, _ := json.Marshal(map[string]interface{}{
			"title":           input.Title,
			"deadline":        input.Deadline,
			"invitation_count": len(invitations),
		})
		_, err = q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
			ID:                    uuid.New(),
			EntityType:            "intake_campaign",
			EntityID:              campaignRow.ID,
			AffectedOwnerGroupIds: input.OwnerGroupIDs,
			ActorID:               actor.ID,
			Action:                sqlcgen.AuditActionEnumCreate,
			Diff:                  auditDiff,
			CreatedAt:             now,
		})
		return err
	})

	if err != nil {
		return nil, err
	}

	return &gen.CampaignResponse{
		Id:          campaignID,
		Title:       input.Title,
		Status:      gen.CampaignResponseStatusActive,
		Deadline:    input.Deadline,
		CreatedAt:   now,
		Invitations: invitations,
	}, nil
}

// GetCampaignProgress computes real-time campaign progress broken down by department.
func (s *IntakeService) GetCampaignProgress(ctx context.Context, campaignID uuid.UUID) (*gen.CampaignProgressResponse, error) {
	campaign, err := s.store.Queries().GetCampaignByID(ctx, campaignID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCampaignNotFound
		}
		return nil, fmt.Errorf("failed to fetch campaign: %w", err)
	}

	deptRows, err := s.store.Queries().GetCampaignDepartmentProgress(ctx, campaignID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch department progress: %w", err)
	}

	var totalInvitations, totalSent, totalOpened, totalSubmitted, totalOverdue int
	departments := make([]gen.DepartmentProgress, len(deptRows))

	for i, d := range deptRows {
		inv := int(d.TotalInvitations)
		sent := int(d.SentCount)
		opened := int(d.OpenedCount)
		sub := int(d.SubmittedCount)
		overdue := int(d.OverdueCount)

		totalInvitations += inv
		totalSent += sent
		totalOpened += opened
		totalSubmitted += sub
		totalOverdue += overdue

		departments[i] = gen.DepartmentProgress{
			DepartmentName:   d.DepartmentName,
			TotalInvitations: inv,
			SentCount:        sent,
			OpenedCount:      opened,
			SubmittedCount:   sub,
			OverdueCount:     overdue,
		}
	}

	return &gen.CampaignProgressResponse{
		CampaignId:       campaign.ID,
		Title:            campaign.Title,
		Status:           gen.CampaignProgressResponseStatus(campaign.Status),
		Deadline:         campaign.Deadline,
		TotalInvitations: totalInvitations,
		TotalSent:        totalSent,
		TotalOpened:      totalOpened,
		TotalSubmitted:   totalSubmitted,
		TotalOverdue:     totalOverdue,
		Departments:      departments,
	}, nil
}

// ResolveToken resolves a magic link token, verifying expiration, fetching existing group CIs, and updating status.
func (s *IntakeService) ResolveToken(ctx context.Context, rawToken string) (*gen.IntakeContextResponse, error) {
	tokenHash := HashToken(rawToken)

	row, err := s.store.Queries().GetInvitationByTokenHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrTokenNotFound
		}
		return nil, fmt.Errorf("failed to resolve token: %w", err)
	}

	now := time.Now().UTC()
	if row.ExpiresAt.Before(now) || row.InvitationStatus == sqlcgen.InvitationStatusEnumExpired {
		return nil, ErrTokenExpired
	}

	// Update invitation access time and transition from 'sent' to 'opened'
	_ = s.store.Queries().UpdateInvitationAccess(ctx, sqlcgen.UpdateInvitationAccessParams{
		ID:             row.InvitationID,
		LastAccessedAt: pgtype.Timestamptz{Time: now, Valid: true},
	})

	var draftPayload map[string]interface{}
	if len(row.SubmissionPayload) > 0 {
		_ = json.Unmarshal(row.SubmissionPayload, &draftPayload)
	}

	lockVersion := 1
	if row.SubmissionLockVersion.Valid {
		lockVersion = int(row.SubmissionLockVersion.Int32)
	}

	status := gen.Opened
	if row.InvitationStatus == sqlcgen.InvitationStatusEnumSubmitted {
		status = gen.Submitted
	}

	// Retrieve existing active CIs owned by this owner group
	activeCIRows, err := s.store.Queries().GetActiveCIsByOwnerGroup(ctx, row.OwnerGroupID)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve active CIs for group: %w", err)
	}

	existingCIs := make([]gen.CIEnvelope, 0, len(activeCIRows))
	for _, ciRow := range activeCIRows {
		existingCIs = append(existingCIs, mapActiveCIRowToCIEnvelope(ciRow))
	}

	return &gen.IntakeContextResponse{
		InvitationId:   row.InvitationID,
		CampaignId:     row.CampaignID,
		CampaignTitle:  row.CampaignTitle,
		Deadline:       row.CampaignDeadline,
		OwnerGroupId:   row.OwnerGroupID,
		OwnerGroupName: row.OwnerGroupName,
		DepartmentName: row.DepartmentName,
		TeamLeadName:   row.TeamLeadName,
		TeamLeadEmail:  openapi_types.Email(row.TeamLeadEmail),
		Status:         status,
		DraftPayload:   &draftPayload,
		LockVersion:    lockVersion,
		ExistingCis:    existingCIs,
	}, nil
}

// SaveDraft auto-saves a draft submission with optimistic concurrency control via If-Match.
func (s *IntakeService) SaveDraft(ctx context.Context, rawToken string, ifMatchHeader string, payload map[string]interface{}) (*gen.SaveDraftResponse, error) {
	if err := domain.ValidateAntiITAM(payload); err != nil {
		return nil, err
	}

	cleaned := strings.Trim(strings.TrimSpace(ifMatchHeader), "\"")
	if strings.HasPrefix(cleaned, "W/") {
		cleaned = strings.Trim(strings.TrimPrefix(cleaned, "W/"), "\"")
	}
	expectedLockVersion, err := strconv.Atoi(cleaned)
	if err != nil {
		return nil, domain.ErrInvalidIfMatch
	}

	tokenHash := HashToken(rawToken)
	row, err := s.store.Queries().GetInvitationByTokenHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrTokenNotFound
		}
		return nil, fmt.Errorf("failed to lookup token: %w", err)
	}

	now := time.Now().UTC()
	if row.ExpiresAt.Before(now) || row.InvitationStatus == sqlcgen.InvitationStatusEnumExpired {
		return nil, ErrTokenExpired
	}

	if row.InvitationStatus == sqlcgen.InvitationStatusEnumSubmitted {
		return nil, domain.ErrSubmissionNotDraft
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal draft payload: %w", err)
	}

	updatedSub, err := s.store.Queries().UpdateIntakeDraft(ctx, sqlcgen.UpdateIntakeDraftParams{
		InvitationID: row.InvitationID,
		Payload:      payloadBytes,
		LockVersion:  int32(expectedLockVersion),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Query submission to provide exact error reason
			sub, subErr := s.store.Queries().GetSubmissionByInvitationID(ctx, row.InvitationID)
			if subErr == nil {
				if sub.Status != sqlcgen.SubmissionStatusEnumDraft {
					return nil, domain.ErrSubmissionNotDraft
				}
				if sub.LockVersion != int32(expectedLockVersion) {
					return nil, domain.ErrLockVersionMismatch
				}
			}
			return nil, domain.ErrLockVersionMismatch
		}
		return nil, fmt.Errorf("failed to update draft: %w", err)
	}

	return &gen.SaveDraftResponse{
		InvitationId: row.InvitationID,
		LockVersion:  int(updatedSub.LockVersion),
		UpdatedAt:    updatedSub.UpdatedAt,
		Payload:      payload,
	}, nil
}

// SearchCIs performs trigram and prefix search against the active CI catalog.
func (s *IntakeService) SearchCIs(ctx context.Context, params gen.SearchCIsParams) (*gen.CISearchResponse, error) {
	ciSvc := NewCIService(s.store)
	return ciSvc.SearchCIs(ctx, params)
}

func mapActiveCIRowToCIEnvelope(ci sqlcgen.GetActiveCIsByOwnerGroupRow) gen.CIEnvelope {
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

func mapSearchRowToCIEnvelope(ci sqlcgen.SearchCIsRow) gen.CIEnvelope {
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

var validCIClasses = map[string]sqlcgen.CiClassEnum{
	"business_service": sqlcgen.CiClassEnumBusinessService,
	"application":      sqlcgen.CiClassEnumApplication,
	"database":         sqlcgen.CiClassEnumDatabase,
	"vm_cluster":       sqlcgen.CiClassEnumVmCluster,
	"physical_host":    sqlcgen.CiClassEnumPhysicalHost,
	"network_firewall": sqlcgen.CiClassEnumNetworkFirewall,
}

var validEnvironments = map[string]sqlcgen.EnvironmentEnum{
	"prod":    sqlcgen.EnvironmentEnumProd,
	"dr":      sqlcgen.EnvironmentEnumDr,
	"staging": sqlcgen.EnvironmentEnumStaging,
}

var validCriticalityTiers = map[string]sqlcgen.CriticalityTierEnum{
	"tier_0": sqlcgen.CriticalityTierEnumTier0,
	"tier_1": sqlcgen.CriticalityTierEnumTier1,
	"tier_2": sqlcgen.CriticalityTierEnumTier2,
	"tier_3": sqlcgen.CriticalityTierEnumTier3,
}

var validEdgeTypes = map[string]sqlcgen.EdgeTypeEnum{
	"depends_on":  sqlcgen.EdgeTypeEnumDependsOn,
	"hosted_on":   sqlcgen.EdgeTypeEnumHostedOn,
	"connects_to": sqlcgen.EdgeTypeEnumConnectsTo,
	"reads_from":  sqlcgen.EdgeTypeEnumReadsFrom,
}

type ParsedService struct {
	CiID             *uuid.UUID
	Name             string
	CiClass          sqlcgen.CiClassEnum
	Environment      sqlcgen.EnvironmentEnum
	CriticalityTier  sqlcgen.CriticalityTierEnum
	TechnicalContact string
	PrimaryEndpoint  *string
	ItamExternalRef  *string
	ClassMetadata    map[string]string
}

type ParsedDependency struct {
	SourceCIName string
	TargetCIID   uuid.UUID
	EdgeType     sqlcgen.EdgeTypeEnum
}

// validateIntakePayload enforces the strict 10-field envelope and dependency structure.
func validateIntakePayload(payload map[string]interface{}) ([]ParsedService, []ParsedDependency, map[string][]string) {
	nodeErrors := make(map[string][]string)

	var rawServices []interface{}
	if sList, ok := payload["services"].([]interface{}); ok {
		rawServices = sList
	} else if aList, ok := payload["applications"].([]interface{}); ok {
		rawServices = aList
	} else if cList, ok := payload["cis"].([]interface{}); ok {
		rawServices = cList
	}

	if len(rawServices) == 0 {
		nodeErrors["services"] = []string{"at least one service or application must be declared"}
	}

	parsedServices := make([]ParsedService, 0, len(rawServices))
	serviceNames := make(map[string]struct{})

	for idx, item := range rawServices {
		sMap, ok := item.(map[string]interface{})
		if !ok {
			nodeErrors[fmt.Sprintf("item_%d", idx+1)] = []string{"service item must be a JSON object"}
			continue
		}

		name, _ := sMap["name"].(string)
		name = strings.TrimSpace(name)
		itemKey := name
		if itemKey == "" {
			itemKey = fmt.Sprintf("item_%d", idx+1)
		}

		var errorsForItem []string
		if name == "" {
			errorsForItem = append(errorsForItem, "name is required")
		} else if len(name) > 160 {
			errorsForItem = append(errorsForItem, "name cannot exceed 160 characters")
		}

		ciClassStr, _ := sMap["ci_class"].(string)
		ciClass, ok := validCIClasses[ciClassStr]
		if !ok {
			errorsForItem = append(errorsForItem, fmt.Sprintf("invalid ci_class %q", ciClassStr))
		}

		envStr, _ := sMap["environment"].(string)
		env, ok := validEnvironments[envStr]
		if !ok {
			errorsForItem = append(errorsForItem, fmt.Sprintf("invalid environment %q", envStr))
		}

		tierStr, _ := sMap["criticality_tier"].(string)
		tier, ok := validCriticalityTiers[tierStr]
		if !ok {
			errorsForItem = append(errorsForItem, fmt.Sprintf("invalid criticality_tier %q", tierStr))
		}

		contact, _ := sMap["technical_contact"].(string)
		contact = strings.TrimSpace(contact)
		if contact == "" {
			errorsForItem = append(errorsForItem, "technical_contact is required")
		} else if len(contact) > 160 {
			errorsForItem = append(errorsForItem, "technical_contact cannot exceed 160 characters")
		}

		var primaryEndpoint *string
		if ep, ok := sMap["primary_endpoint"].(string); ok && ep != "" {
			if len(ep) > 255 {
				errorsForItem = append(errorsForItem, "primary_endpoint cannot exceed 255 characters")
			} else {
				primaryEndpoint = &ep
			}
		}

		var itamRef *string
		if itam, ok := sMap["itam_external_ref"].(string); ok && itam != "" {
			if len(itam) > 512 {
				errorsForItem = append(errorsForItem, "itam_external_ref cannot exceed 512 characters")
			} else {
				itamRef = &itam
			}
		}

		classMeta := make(map[string]string)
		if metaRaw, exists := sMap["class_metadata"]; exists {
			if metaMap, ok := metaRaw.(map[string]interface{}); ok {
				if len(metaMap) > 2 {
					errorsForItem = append(errorsForItem, fmt.Sprintf("class_metadata exceeds maximum of 2 keys: %d keys provided", len(metaMap)))
				}
				for k, v := range metaMap {
					if strVal, ok := v.(string); ok {
						classMeta[k] = strVal
					} else {
						classMeta[k] = fmt.Sprint(v)
					}
				}
			} else {
				errorsForItem = append(errorsForItem, "class_metadata must be a JSON object with at most 2 keys")
			}
		}

		var ciUUID *uuid.UUID
		if idStr, ok := sMap["ci_id"].(string); ok && idStr != "" {
			if parsed, err := uuid.Parse(idStr); err == nil && parsed != uuid.Nil {
				ciUUID = &parsed
			}
		}

		if len(errorsForItem) > 0 {
			nodeErrors[itemKey] = errorsForItem
		} else {
			serviceNames[strings.ToLower(name)] = struct{}{}
			parsedServices = append(parsedServices, ParsedService{
				CiID:             ciUUID,
				Name:             name,
				CiClass:          ciClass,
				Environment:      env,
				CriticalityTier:  tier,
				TechnicalContact: contact,
				PrimaryEndpoint:  primaryEndpoint,
				ItamExternalRef:  itamRef,
				ClassMetadata:    classMeta,
			})
		}
	}

	var rawDeps []interface{}
	if dList, ok := payload["dependencies"].([]interface{}); ok {
		rawDeps = dList
	} else if eList, ok := payload["edges"].([]interface{}); ok {
		rawDeps = eList
	}

	parsedDeps := make([]ParsedDependency, 0, len(rawDeps))
	for idx, item := range rawDeps {
		dMap, ok := item.(map[string]interface{})
		if !ok {
			nodeErrors[fmt.Sprintf("dependency_%d", idx+1)] = []string{"dependency item must be a JSON object"}
			continue
		}

		srcName, _ := dMap["source_ci_name"].(string)
		srcName = strings.TrimSpace(srcName)
		if srcName == "" && len(parsedServices) == 1 {
			srcName = parsedServices[0].Name
		}
		depKey := srcName
		if depKey == "" {
			depKey = fmt.Sprintf("dependency_%d", idx+1)
		}

		var depErrors []string
		if srcName != "" {
			if _, exists := serviceNames[strings.ToLower(srcName)]; !exists {
				depErrors = append(depErrors, fmt.Sprintf("source_ci_name %q does not match any declared service in submission", srcName))
			}
		} else {
			depErrors = append(depErrors, "source_ci_name is required for dependency")
		}

		targetStr, _ := dMap["target_ci_id"].(string)
		targetUUID, err := uuid.Parse(targetStr)
		if err != nil || targetUUID == uuid.Nil {
			depErrors = append(depErrors, "target_ci_id must be a valid non-nil UUID")
		}

		edgeTypeStr, _ := dMap["edge_type"].(string)
		edgeType, ok := validEdgeTypes[edgeTypeStr]
		if !ok {
			depErrors = append(depErrors, fmt.Sprintf("invalid edge_type %q; must be depends_on, hosted_on, connects_to, or reads_from", edgeTypeStr))
		}

		if len(depErrors) > 0 {
			nodeErrors[depKey] = append(nodeErrors[depKey], depErrors...)
		} else {
			parsedDeps = append(parsedDeps, ParsedDependency{
				SourceCIName: srcName,
				TargetCIID:   targetUUID,
				EdgeType:     edgeType,
			})
		}
	}

	return parsedServices, parsedDeps, nodeErrors
}

// SubmitIntake validates and atomically publishes an intake submission into an approved baseline.
func (s *IntakeService) SubmitIntake(ctx context.Context, rawToken string, idempotencyKey string, explicitPayload *map[string]interface{}) (*gen.BaselineResponse, bool, error) {
	if explicitPayload != nil {
		if err := domain.ValidateAntiITAM(*explicitPayload); err != nil {
			return nil, false, err
		}
	}

	tokenHash := HashToken(rawToken)

	// Peek at invitation to ensure token exists and is valid before starting audit tx
	invRow, err := s.store.Queries().GetInvitationByTokenHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, ErrTokenNotFound
		}
		return nil, false, fmt.Errorf("failed to lookup token: %w", err)
	}

	now := time.Now().UTC()
	if invRow.ExpiresAt.Before(now) || invRow.InvitationStatus == sqlcgen.InvitationStatusEnumExpired {
		return nil, false, ErrTokenExpired
	}

	// Ensure publisher user exists in users table so WithAuditTx has a valid actor_id FK
	pubUser, err := s.store.Queries().EnsureTeamLeadUser(ctx, sqlcgen.EnsureTeamLeadUserParams{
		ID:                  uuid.New(),
		Email:               invRow.TeamLeadEmail,
		Name:                invRow.TeamLeadName,
		PrimaryOwnerGroupID: pgtype.UUID{Bytes: invRow.OwnerGroupID, Valid: true},
	})
	if err != nil {
		return nil, false, fmt.Errorf("failed to ensure publisher user: %w", err)
	}

	actor := domain.Actor{
		ID:            pubUser.ID,
		Email:         pubUser.Email,
		Name:          pubUser.Name,
		Role:          domain.RoleTeamLead,
		OwnerGroupIDs: []uuid.UUID{invRow.OwnerGroupID},
	}

	var resultBaseline *gen.BaselineResponse
	var isReplay bool

	err = s.store.WithAuditTx(ctx, actor, func(tx pgx.Tx, q *sqlcgen.Queries) error {
		// 1. Acquire row lock on intake_submissions FOR UPDATE
		sub, err := q.GetSubmissionByTokenHashForUpdate(ctx, tokenHash)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrTokenNotFound
			}
			return fmt.Errorf("failed to lock submission: %w", err)
		}

		if sub.ExpiresAt.Before(now) || sub.InvitationStatus == sqlcgen.InvitationStatusEnumExpired {
			return ErrTokenExpired
		}

		// If already finalized, check for existing baseline (idempotent retry)
		if sub.SubmissionStatus == sqlcgen.SubmissionStatusEnumApproved || sub.SubmissionStatus == sqlcgen.SubmissionStatusEnumSubmitted {
			existingBaseline, err := q.GetBaselineByCampaignAndGroup(ctx, sqlcgen.GetBaselineByCampaignAndGroupParams{
				CampaignID:   pgtype.UUID{Bytes: sub.CampaignID, Valid: true},
				OwnerGroupID: sub.OwnerGroupID,
			})
			if err == nil {
				var snapshotMap map[string]interface{}
				_ = json.Unmarshal(existingBaseline.Snapshot, &snapshotMap)

				ciCount := 0
				if c, ok := snapshotMap["ci_count"].(float64); ok {
					ciCount = int(c)
				}
				edgeCount := 0
				if e, ok := snapshotMap["edge_count"].(float64); ok {
					edgeCount = int(e)
				}

				resultBaseline = &gen.BaselineResponse{
					BaselineId:       existingBaseline.ID,
					CampaignId:       sub.CampaignID,
					OwnerGroupId:     sub.OwnerGroupID,
					VersionTag:       existingBaseline.VersionTag,
					PublishedAt:      existingBaseline.PublishedAt,
					PublishedBy:      existingBaseline.PublishedBy,
					CiCount:          ciCount,
					EdgeCount:        edgeCount,
					PendingEdgeCount: 0,
					Snapshot:         &snapshotMap,
				}
				isReplay = true
				return nil
			}
			return domain.ErrConflict
		}

		// Determine active payload
		var activePayload map[string]interface{}
		if explicitPayload != nil && len(*explicitPayload) > 0 {
			activePayload = *explicitPayload
		} else if len(sub.SubmissionPayload) > 0 {
			_ = json.Unmarshal(sub.SubmissionPayload, &activePayload)
		}

		// Anti-ITAM check on active payload
		if err := domain.ValidateAntiITAM(activePayload); err != nil {
			return err
		}

		// 2. Pre-flight envelope validation
		services, deps, nodeErrors := validateIntakePayload(activePayload)

		// 3. Search-First Dependency Linking & Pre-check Target CI Existence
		for _, dep := range deps {
			targetCI, err := q.GetCIByID(ctx, dep.TargetCIID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					nodeErrors[dep.SourceCIName] = append(nodeErrors[dep.SourceCIName], fmt.Sprintf("target_ci_id %s not found in catalog", dep.TargetCIID))
				} else {
					return fmt.Errorf("failed to verify target CI: %w", err)
				}
			} else {
				if strings.EqualFold(targetCI.Name, dep.SourceCIName) {
					nodeErrors[dep.SourceCIName] = append(nodeErrors[dep.SourceCIName], "self-dependency is forbidden: source and target cannot be the same CI")
				}
			}
		}

		// If any validation errors exist, abort before writing anything to cis
		if len(nodeErrors) > 0 {
			return &domain.ValidationError{
				Message:    "Intake envelope validation failed on declared services or dependencies",
				NodeErrors: nodeErrors,
			}
		}

		// 4. Atomic Database Publication
		ciNameToID := make(map[string]uuid.UUID)
		createdCIs := make([]sqlcgen.Ci, 0, len(services))

		for _, svc := range services {
			ciID := uuid.New()
			if svc.CiID != nil {
				ciID = *svc.CiID
			}

			metaJSON, _ := json.Marshal(svc.ClassMetadata)
			var epText pgtype.Text
			if svc.PrimaryEndpoint != nil {
				epText = pgtype.Text{String: *svc.PrimaryEndpoint, Valid: true}
			}
			var itamText pgtype.Text
			if svc.ItamExternalRef != nil {
				itamText = pgtype.Text{String: *svc.ItamExternalRef, Valid: true}
			}

			upsertedCI, err := q.UpsertCI(ctx, sqlcgen.UpsertCIParams{
				CiID:             ciID,
				Name:             svc.Name,
				CiClass:          svc.CiClass,
				Environment:      svc.Environment,
				LifecycleState:   sqlcgen.LifecycleStateEnumInService,
				CriticalityTier:  svc.CriticalityTier,
				OwnerGroupID:     sub.OwnerGroupID,
				TechnicalContact: svc.TechnicalContact,
				PrimaryEndpoint:  epText,
				LastVerifiedAt:   now,
				ItamExternalRef:  itamText,
				ClassMetadata:    metaJSON,
				CreatedAt:        now,
				UpdatedAt:        now,
			})
			if err != nil {
				return fmt.Errorf("failed to upsert CI %q: %w", svc.Name, err)
			}

			ciNameToID[strings.ToLower(svc.Name)] = upsertedCI.CiID
			createdCIs = append(createdCIs, upsertedCI)

			ciDiff, _ := json.Marshal(map[string]interface{}{
				"name":             upsertedCI.Name,
				"ci_class":         upsertedCI.CiClass,
				"environment":      upsertedCI.Environment,
				"criticality_tier": upsertedCI.CriticalityTier,
				"lifecycle_state":  upsertedCI.LifecycleState,
			})
			_, _ = q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
				ID:                    uuid.New(),
				EntityType:            "ci",
				EntityID:              upsertedCI.CiID,
				AffectedOwnerGroupIds: []uuid.UUID{sub.OwnerGroupID},
				ActorID:               pubUser.ID,
				Action:                sqlcgen.AuditActionEnumCreate,
				Diff:                  ciDiff,
				CreatedAt:             now,
			})
		}

		// Insert dependencies into ci_edges
		createdEdges := make([]sqlcgen.CiEdge, 0, len(deps))
		pendingEdgeCount := 0

		for _, dep := range deps {
			sourceID := ciNameToID[strings.ToLower(dep.SourceCIName)]
			targetCI, err := q.GetCIByID(ctx, dep.TargetCIID)
			if err != nil {
				return fmt.Errorf("failed to get target CI: %w", err)
			}

			var handshakeStatus sqlcgen.HandshakeStatusEnum
			var confirmedBy pgtype.UUID
			var confirmedAt pgtype.Timestamptz

			if targetCI.OwnerGroupID == sub.OwnerGroupID {
				handshakeStatus = sqlcgen.HandshakeStatusEnumConfirmed
				confirmedBy = pgtype.UUID{Bytes: pubUser.ID, Valid: true}
				confirmedAt = pgtype.Timestamptz{Time: now, Valid: true}
			} else {
				handshakeStatus = sqlcgen.HandshakeStatusEnumPendingConfirmation
				pendingEdgeCount++
			}

			edge, err := q.UpsertEdge(ctx, sqlcgen.UpsertEdgeParams{
				ID:              uuid.New(),
				SourceCiID:      sourceID,
				TargetCiID:      dep.TargetCIID,
				EdgeType:        dep.EdgeType,
				HandshakeStatus: handshakeStatus,
				CreatedBy:       pubUser.ID,
				ConfirmedBy:     confirmedBy,
				ConfirmedAt:     confirmedAt,
				CreatedAt:       now,
				UpdatedAt:       now,
			})
			if err != nil {
				return fmt.Errorf("failed to upsert edge: %w", err)
			}
			createdEdges = append(createdEdges, edge)

			affectedGroups := []uuid.UUID{sub.OwnerGroupID}
			if targetCI.OwnerGroupID != sub.OwnerGroupID {
				affectedGroups = append(affectedGroups, targetCI.OwnerGroupID)
			}

			edgeDiff, _ := json.Marshal(map[string]interface{}{
				"source_ci_id":     sourceID,
				"target_ci_id":     dep.TargetCIID,
				"edge_type":        dep.EdgeType,
				"handshake_status": handshakeStatus,
			})
			_, _ = q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
				ID:                    uuid.New(),
				EntityType:            "edge",
				EntityID:              edge.ID,
				AffectedOwnerGroupIds: affectedGroups,
				ActorID:               pubUser.ID,
				Action:                sqlcgen.AuditActionEnumCreate,
				Diff:                  edgeDiff,
				CreatedAt:             now,
			})
		}

		// Finalize invitation and submission
		if err := q.FinalizeIntakeSubmission(ctx, sqlcgen.FinalizeIntakeSubmissionParams{
			ID:          sub.SubmissionID,
			SubmittedAt: pgtype.Timestamptz{Time: now, Valid: true},
		}); err != nil {
			return fmt.Errorf("failed to finalize submission: %w", err)
		}

		if err := q.FinalizeIntakeInvitation(ctx, sub.InvitationID); err != nil {
			return fmt.Errorf("failed to finalize invitation: %w", err)
		}

		// Persist immutable snapshot in baselines
		snapshot := map[string]interface{}{
			"campaign_id":      sub.CampaignID.String(),
			"owner_group_id":   sub.OwnerGroupID.String(),
			"owner_group_name": sub.OwnerGroupName,
			"department_name":  sub.DepartmentName,
			"published_by":     pubUser.Email,
			"published_at":     now.Format(time.RFC3339),
			"version_tag":      "v1.0",
			"ci_count":         len(createdCIs),
			"edge_count":       len(createdEdges),
			"payload":          activePayload,
		}
		snapshotBytes, _ := json.Marshal(snapshot)

		baselineID := uuid.New()
		baseline, err := q.CreateBaseline(ctx, sqlcgen.CreateBaselineParams{
			ID:           baselineID,
			CampaignID:   pgtype.UUID{Bytes: sub.CampaignID, Valid: true},
			OwnerGroupID: sub.OwnerGroupID,
			VersionTag:   "v1.0",
			Snapshot:     snapshotBytes,
			PublishedBy:  pubUser.ID,
			PublishedAt:  now,
		})
		if err != nil {
			return fmt.Errorf("failed to create baseline: %w", err)
		}

		bDiff, _ := json.Marshal(map[string]interface{}{
			"version_tag": "v1.0",
			"ci_count":    len(createdCIs),
			"edge_count":  len(createdEdges),
		})
		_, _ = q.CreateAuditLog(ctx, sqlcgen.CreateAuditLogParams{
			ID:                    uuid.New(),
			EntityType:            "baseline",
			EntityID:              baseline.ID,
			AffectedOwnerGroupIds: []uuid.UUID{sub.OwnerGroupID},
			ActorID:               pubUser.ID,
			Action:                sqlcgen.AuditActionEnumCreate,
			Diff:                  bDiff,
			CreatedAt:             now,
		})

		resultBaseline = &gen.BaselineResponse{
			BaselineId:       baseline.ID,
			CampaignId:       sub.CampaignID,
			OwnerGroupId:     sub.OwnerGroupID,
			VersionTag:       "v1.0",
			PublishedAt:      now,
			PublishedBy:      pubUser.ID,
			CiCount:          len(createdCIs),
			EdgeCount:        len(createdEdges),
			PendingEdgeCount: pendingEdgeCount,
			Snapshot:         &snapshot,
		}

		return nil
	})

	if err != nil {
		return nil, false, err
	}

	return resultBaseline, isReplay, nil
}
