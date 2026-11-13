package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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

// ResolveToken resolves a magic link token, verifying expiration and updating status.
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
	}, nil
}
