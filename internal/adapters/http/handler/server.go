package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/http/middleware"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	"github.com/org/etcms-backend/internal/domain"
	"github.com/org/etcms-backend/internal/service"
	"github.com/org/etcms-backend/internal/worker"
)

// Server implements gen.StrictServerInterface.
type Server struct {
	store         *postgres.Store
	intakeService *service.IntakeService
	edgeService   *service.EdgeService
	ciService     *service.CIService
	digestService *service.DigestService
	auditService  *service.AuditService
	healthService *service.HealthService
	roleService   *service.RoleService
	adminService  *service.AdminManagementService
	authService   *service.AuthService
	scheduler     *worker.DigestScheduler
	version       string
}

// NewServer creates a new Server instance.
func NewServer(store *postgres.Store, version string) *Server {
	if version == "" {
		version = "3.0.0"
	}
	return &Server{
		store:         store,
		intakeService: service.NewIntakeService(store),
		edgeService:   service.NewEdgeService(store),
		ciService:     service.NewCIService(store),
		digestService: service.NewDigestService(store),
		auditService:  service.NewAuditService(store),
		healthService: service.NewHealthService(store),
		roleService:   service.NewRoleService(store),
		adminService:  service.NewAdminManagementService(store),
		authService:   service.NewAuthService(store),
		scheduler:     worker.NewDigestScheduler(store, nil),
		version:       version,
	}
}

// GetHealthz handles liveness probes.
func (s *Server) GetHealthz(ctx context.Context, request gen.GetHealthzRequestObject) (gen.GetHealthzResponseObject, error) {
	return gen.GetHealthz200JSONResponse{
		Status:    gen.Ok,
		Version:   s.version,
		Timestamp: time.Now().UTC(),
	}, nil
}

// GetReadyz handles readiness probes by verifying database connectivity.
func (s *Server) GetReadyz(ctx context.Context, request gen.GetReadyzRequestObject) (gen.GetReadyzResponseObject, error) {
	if s.store == nil || s.store.Pool() == nil {
		return gen.GetReadyz503ApplicationProblemPlusJSONResponse{
			Title:  "Database Not Configured",
			Status: 503,
			Detail: "Database connection pool is nil",
		}, nil
	}

	if err := s.store.Pool().Ping(ctx); err != nil {
		return gen.GetReadyz503ApplicationProblemPlusJSONResponse{
			Title:  "Database Unavailable",
			Status: 503,
			Detail: err.Error(),
		}, nil
	}

	return gen.GetReadyz200JSONResponse{
		Status:    gen.Ready,
		Database:  gen.Connected,
		Timestamp: time.Now().UTC(),
	}, nil
}

// GetCurrentUser returns the profile of the currently authenticated actor.
func (s *Server) GetCurrentUser(ctx context.Context, request gen.GetCurrentUserRequestObject) (gen.GetCurrentUserResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.GetCurrentUser401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	var perms *[]string
	if len(actor.Permissions) > 0 {
		pCopy := make([]string, len(actor.Permissions))
		copy(pCopy, actor.Permissions)
		perms = &pCopy
	}

	return gen.GetCurrentUser200JSONResponse{
		Id:                    actor.ID,
		Email:                 openapi_types.Email(actor.Email),
		Name:                  actor.Name,
		Role:                  gen.UserRole(actor.Role),
		PrimaryOwnerGroupId:   actor.PrimaryOwnerGroupID,
		OwnerGroupIds:         actor.OwnerGroupIDs,
		CustomRoleId:          actor.CustomRoleID,
		CustomRoleName:        actor.CustomRoleName,
		CustomRolePermissions: perms,
		CreatedAt:             time.Now().UTC(),
	}, nil
}

// ListOwnerGroups lists all owner groups in alphabetical order.
func (s *Server) ListOwnerGroups(ctx context.Context, request gen.ListOwnerGroupsRequestObject) (gen.ListOwnerGroupsResponseObject, error) {
	_, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ListOwnerGroups401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	rows, err := s.store.Queries().ListOwnerGroups(ctx)
	if err != nil {
		return nil, err
	}

	groups := make([]gen.OwnerGroup, len(rows))
	for i, r := range rows {
		groups[i] = gen.OwnerGroup{
			Id:             r.ID,
			Name:           r.Name,
			Slug:           r.Slug,
			DepartmentName: r.DepartmentName,
			TeamLeadName:   r.TeamLeadName,
			TeamLeadEmail:  openapi_types.Email(r.TeamLeadEmail),
			CreatedAt:      r.CreatedAt,
		}
	}

	return gen.ListOwnerGroups200JSONResponse(groups), nil
}

// ListIntakeCampaigns lists decentralized intake campaigns.
func (s *Server) ListIntakeCampaigns(ctx context.Context, request gen.ListIntakeCampaignsRequestObject) (gen.ListIntakeCampaignsResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ListIntakeCampaigns401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if !actor.HasRole(domain.RolePlatformAdmin) {
		return gen.ListIntakeCampaigns403ApplicationProblemPlusJSONResponse{
			Title:  "Forbidden",
			Status: 403,
			Detail: "Only platform_admin may list intake campaigns",
		}, nil
	}

	campaigns, err := s.intakeService.ListCampaigns(ctx, &actor)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.ListIntakeCampaigns403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "Insufficient permissions",
			}, nil
		}
		return nil, err
	}

	return gen.ListIntakeCampaigns200JSONResponse(campaigns), nil
}

// CreateIntakeCampaign creates a decentralized intake campaign with magic links for team leads.
func (s *Server) CreateIntakeCampaign(ctx context.Context, request gen.CreateIntakeCampaignRequestObject) (gen.CreateIntakeCampaignResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.CreateIntakeCampaign401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if !actor.HasRole(domain.RolePlatformAdmin) {
		return gen.CreateIntakeCampaign403ApplicationProblemPlusJSONResponse{
			Title:  "Forbidden",
			Status: 403,
			Detail: "Only platform_admin may launch intake campaigns",
		}, nil
	}

	if request.Body == nil {
		return gen.CreateIntakeCampaign400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Missing request body",
		}, nil
	}

	trimmedTitle := strings.TrimSpace(request.Body.Title)
	if trimmedTitle == "" {
		return gen.CreateIntakeCampaign400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Campaign title is required",
		}, nil
	}

	if len([]rune(trimmedTitle)) > 255 {
		return gen.CreateIntakeCampaign400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Campaign title cannot exceed 255 characters",
		}, nil
	}

	if len(request.Body.OwnerGroupIds) == 0 {
		return gen.CreateIntakeCampaign400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "At least one owner group must be specified",
		}, nil
	}

	resp, err := s.intakeService.CreateCampaign(ctx, actor, service.CreateCampaignInput{
		Title:         trimmedTitle,
		Deadline:      request.Body.Deadline,
		OwnerGroupIDs: request.Body.OwnerGroupIds,
	})
	if err != nil {
		if errors.Is(err, service.ErrInvalidDeadline) ||
			errors.Is(err, service.ErrNoOwnerGroups) ||
			errors.Is(err, service.ErrEmptyTitle) ||
			errors.Is(err, service.ErrTitleTooLong) ||
			errors.Is(err, service.ErrOwnerGroupNotFound) {
			return gen.CreateIntakeCampaign422ApplicationProblemPlusJSONResponse{
				Title:  "Unprocessable Entity",
				Status: 422,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.CreateIntakeCampaign403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "Insufficient permissions",
			}, nil
		}
		return nil, err
	}

	return gen.CreateIntakeCampaign201JSONResponse(*resp), nil
}

// GetIntakeCampaign retrieves a single intake campaign by ID.
func (s *Server) GetIntakeCampaign(ctx context.Context, request gen.GetIntakeCampaignRequestObject) (gen.GetIntakeCampaignResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.GetIntakeCampaign401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if !actor.HasRole(domain.RolePlatformAdmin) {
		return gen.GetIntakeCampaign403ApplicationProblemPlusJSONResponse{
			Title:  "Forbidden",
			Status: 403,
			Detail: "Only platform_admin may view intake campaign details",
		}, nil
	}

	campaign, err := s.intakeService.GetCampaign(ctx, &actor, request.Id)
	if err != nil {
		if errors.Is(err, service.ErrCampaignNotFound) {
			return gen.GetIntakeCampaign404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Intake campaign not found",
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.GetIntakeCampaign403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "Insufficient permissions",
			}, nil
		}
		return nil, err
	}

	return gen.GetIntakeCampaign200JSONResponse(*campaign), nil
}

// UpdateIntakeCampaign updates intake campaign status, title, or deadline.
func (s *Server) UpdateIntakeCampaign(ctx context.Context, request gen.UpdateIntakeCampaignRequestObject) (gen.UpdateIntakeCampaignResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.UpdateIntakeCampaign401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if !actor.HasRole(domain.RolePlatformAdmin) {
		return gen.UpdateIntakeCampaign403ApplicationProblemPlusJSONResponse{
			Title:  "Forbidden",
			Status: 403,
			Detail: "Only platform_admin may update intake campaigns",
		}, nil
	}

	if request.Body == nil {
		return gen.UpdateIntakeCampaign400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body cannot be empty",
		}, nil
	}

	resp, err := s.intakeService.UpdateCampaign(ctx, &actor, request.Id, *request.Body)
	if err != nil {
		if errors.Is(err, service.ErrCampaignNotFound) {
			return gen.UpdateIntakeCampaign404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Intake campaign not found",
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.UpdateIntakeCampaign403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "Insufficient permissions",
			}, nil
		}
		if errors.Is(err, service.ErrEmptyTitle) || errors.Is(err, service.ErrTitleTooLong) {
			return gen.UpdateIntakeCampaign400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, err
	}

	return gen.UpdateIntakeCampaign200JSONResponse(*resp), nil
}

// DeleteIntakeCampaign deletes an intake campaign and cascades to its invitations and submissions.
func (s *Server) DeleteIntakeCampaign(ctx context.Context, request gen.DeleteIntakeCampaignRequestObject) (gen.DeleteIntakeCampaignResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.DeleteIntakeCampaign401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if !actor.HasRole(domain.RolePlatformAdmin) {
		return gen.DeleteIntakeCampaign403ApplicationProblemPlusJSONResponse{
			Title:  "Forbidden",
			Status: 403,
			Detail: "Only platform_admin may delete intake campaigns",
		}, nil
	}

	err := s.intakeService.DeleteCampaign(ctx, &actor, request.Id)
	if err != nil {
		if errors.Is(err, service.ErrCampaignNotFound) {
			return gen.DeleteIntakeCampaign404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Intake campaign not found",
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.DeleteIntakeCampaign403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "Insufficient permissions",
			}, nil
		}
		return nil, err
	}

	return gen.DeleteIntakeCampaign204Response{}, nil
}

// GetCampaignProgress retrieves progress metrics for a campaign broken down by department.
func (s *Server) GetCampaignProgress(ctx context.Context, request gen.GetCampaignProgressRequestObject) (gen.GetCampaignProgressResponseObject, error) {
	_, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.GetCampaignProgress401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	resp, err := s.intakeService.GetCampaignProgress(ctx, request.Id)
	if err != nil {
		if errors.Is(err, service.ErrCampaignNotFound) {
			return gen.GetCampaignProgress404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Intake campaign not found",
			}, nil
		}
		return nil, err
	}

	return gen.GetCampaignProgress200JSONResponse(*resp), nil
}

// GetIntakeInvitation resolves a magic link token to retrieve intake context.
func (s *Server) GetIntakeInvitation(ctx context.Context, request gen.GetIntakeInvitationRequestObject) (gen.GetIntakeInvitationResponseObject, error) {
	resp, err := s.intakeService.ResolveToken(ctx, request.Token)
	if err != nil {
		if errors.Is(err, service.ErrTokenNotFound) {
			return gen.GetIntakeInvitation404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Intake invitation token not found",
			}, nil
		}
		if errors.Is(err, service.ErrTokenExpired) {
			return gen.GetIntakeInvitation401ApplicationProblemPlusJSONResponse{
				Title:  "Unauthorized",
				Status: 401,
				Detail: "Intake invitation token has expired",
			}, nil
		}
		if errors.Is(err, service.ErrCampaignClosed) {
			return gen.GetIntakeInvitation401ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 401,
				Detail: "Data collection request is closed",
			}, nil
		}
		return nil, err
	}

	return gen.GetIntakeInvitation200JSONResponse{
		Body: *resp,
		Headers: gen.GetIntakeInvitation200ResponseHeaders{
			ETag: fmt.Sprintf("\"%d\"", resp.LockVersion),
		},
	}, nil
}

// SaveIntakeDraft auto-saves a draft submission with optimistic concurrency control.
func (s *Server) SaveIntakeDraft(ctx context.Context, request gen.SaveIntakeDraftRequestObject) (gen.SaveIntakeDraftResponseObject, error) {
	if request.Body == nil {
		return gen.SaveIntakeDraft400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Missing request body",
		}, nil
	}

	resp, err := s.intakeService.SaveDraft(ctx, request.Token, request.Params.IfMatch, request.Body.Payload)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidIfMatch) {
			return gen.SaveIntakeDraft400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: "If-Match header must be a valid integer lock version",
			}, nil
		}
		if errors.Is(err, service.ErrTokenNotFound) {
			return gen.SaveIntakeDraft404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Intake invitation token not found",
			}, nil
		}
		if errors.Is(err, service.ErrTokenExpired) {
			return gen.SaveIntakeDraft401ApplicationProblemPlusJSONResponse{
				Title:  "Unauthorized",
				Status: 401,
				Detail: "Intake invitation token has expired",
			}, nil
		}
		if errors.Is(err, service.ErrCampaignClosed) {
			return gen.SaveIntakeDraft400ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 400,
				Detail: "Data collection request is closed and cannot accept changes",
			}, nil
		}
		if errors.Is(err, domain.ErrLockVersionMismatch) {
			return gen.SaveIntakeDraft412ApplicationProblemPlusJSONResponse{
				Title:  "Precondition Failed",
				Status: 412,
				Detail: "Lock version conflict; draft was modified by another session",
			}, nil
		}
		if errors.Is(err, domain.ErrUnapprovedITAMField) {
			return gen.SaveIntakeDraft422ApplicationProblemPlusJSONResponse{
				Title:  "Unprocessable Entity",
				Status: 422,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrSubmissionNotDraft) {
			return gen.SaveIntakeDraft422ApplicationProblemPlusJSONResponse{
				Title:  "Unprocessable Entity",
				Status: 422,
				Detail: "Intake submission has already been submitted and cannot be modified",
			}, nil
		}
		return nil, err
	}

	return gen.SaveIntakeDraft200JSONResponse{
		Body: *resp,
		Headers: gen.SaveIntakeDraft200ResponseHeaders{
			ETag: fmt.Sprintf("\"%d\"", resp.LockVersion),
		},
	}, nil
}

// SearchCIs performs catalog search for configuration items.
func (s *Server) SearchCIs(ctx context.Context, request gen.SearchCIsRequestObject) (gen.SearchCIsResponseObject, error) {
	_, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.SearchCIs401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	resp, err := s.ciService.SearchCIs(ctx, request.Params)
	if err != nil {
		if errors.Is(err, domain.ErrBadParam) {
			return gen.SearchCIs400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, err
	}

	return gen.SearchCIs200JSONResponse(*resp), nil
}

// SubmitIntake submits an intake draft and atomically publishes an approved baseline.
func (s *Server) SubmitIntake(ctx context.Context, request gen.SubmitIntakeRequestObject) (gen.SubmitIntakeResponseObject, error) {
	idempotencyKey := ""
	if request.Params.IdempotencyKey != nil {
		idempotencyKey = *request.Params.IdempotencyKey
	}

	var explicitPayload *map[string]interface{}
	if request.Body != nil && request.Body.Payload != nil {
		explicitPayload = request.Body.Payload
	}

	resp, isExisting, err := s.intakeService.SubmitIntake(ctx, request.Token, idempotencyKey, explicitPayload)
	if err != nil {
		var valErr *domain.ValidationError
		if errors.As(err, &valErr) {
			return gen.SubmitIntake422ApplicationProblemPlusJSONResponse{
				Title:      "Unprocessable Entity",
				Status:     422,
				Detail:     valErr.Message,
				NodeErrors: &valErr.NodeErrors,
			}, nil
		}
		if errors.Is(err, domain.ErrUnapprovedITAMField) {
			return gen.SubmitIntake422ApplicationProblemPlusJSONResponse{
				Title:  "Unprocessable Entity",
				Status: 422,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, service.ErrTokenNotFound) {
			return gen.SubmitIntake404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Intake invitation token not found",
			}, nil
		}
		if errors.Is(err, service.ErrTokenExpired) {
			return gen.SubmitIntake401ApplicationProblemPlusJSONResponse{
				Title:  "Unauthorized",
				Status: 401,
				Detail: "Intake invitation token has expired",
			}, nil
		}
		if errors.Is(err, service.ErrCampaignClosed) {
			return gen.SubmitIntake400ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 400,
				Detail: "Data collection request is closed and cannot accept submissions",
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.SubmitIntake409ApplicationProblemPlusJSONResponse{
				Title:  "Conflict",
				Status: 409,
				Detail: "Intake submission has already been approved or published",
			}, nil
		}
		return nil, err
	}

	if isExisting {
		return gen.SubmitIntake200JSONResponse(*resp), nil
	}
	return gen.SubmitIntake201JSONResponse(*resp), nil
}

// ListPendingEdges returns edges with handshake_status = 'pending_confirmation' targeting caller's groups.
func (s *Server) ListPendingEdges(ctx context.Context, request gen.ListPendingEdgesRequestObject) (gen.ListPendingEdgesResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ListPendingEdges401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	var groupFilter *uuid.UUID
	if request.Params.OwnerGroupId != nil {
		id := *request.Params.OwnerGroupId
		groupFilter = &id
	}

	res, err := s.edgeService.ListPendingEdges(ctx, actor, groupFilter)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.ListPendingEdges403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "You do not have permission to view pending edges for this owner group",
			}, nil
		}
		return nil, fmt.Errorf("failed to list pending edges: %w", err)
	}

	return gen.ListPendingEdges200JSONResponse(*res), nil
}

// ConfirmEdge confirms a pending cross-boundary edge handshake.
func (s *Server) ConfirmEdge(ctx context.Context, request gen.ConfirmEdgeRequestObject) (gen.ConfirmEdgeResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ConfirmEdge401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	edgeID := request.Id
	res, err := s.edgeService.ConfirmEdge(ctx, actor, edgeID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.ConfirmEdge404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Edge not found",
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.ConfirmEdge403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "Only members of the target CI owner group or platform administrators may confirm edges",
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.ConfirmEdge409ApplicationProblemPlusJSONResponse{
				Title:  "Conflict",
				Status: 409,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to confirm edge: %w", err)
	}

	return gen.ConfirmEdge200JSONResponse(*res), nil
}

// FlagEdgeMismatch flags an edge mismatch on a pending or cross-boundary edge.
func (s *Server) FlagEdgeMismatch(ctx context.Context, request gen.FlagEdgeMismatchRequestObject) (gen.FlagEdgeMismatchResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.FlagEdgeMismatch401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	var reason *string
	if request.Body != nil && request.Body.Reason != nil {
		reason = request.Body.Reason
	}

	edgeID := request.Id
	res, err := s.edgeService.FlagEdgeMismatch(ctx, actor, edgeID, reason)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.FlagEdgeMismatch404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Edge not found",
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.FlagEdgeMismatch403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "Only members of the target CI owner group or platform administrators may flag edge mismatches",
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.FlagEdgeMismatch409ApplicationProblemPlusJSONResponse{
				Title:  "Conflict",
				Status: 409,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to flag edge mismatch: %w", err)
	}

	return gen.FlagEdgeMismatch200JSONResponse(*res), nil
}

// RejectEdge rejects a cross-boundary edge handshake.
func (s *Server) RejectEdge(ctx context.Context, request gen.RejectEdgeRequestObject) (gen.RejectEdgeResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.RejectEdge401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	var reason *string
	if request.Body != nil && request.Body.Reason != nil {
		reason = request.Body.Reason
	}

	edgeID := request.Id
	res, err := s.edgeService.RejectEdge(ctx, actor, edgeID, reason)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.RejectEdge404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Edge not found",
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.RejectEdge403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "Only members of the target CI owner group or platform administrators may reject edges",
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.RejectEdge409ApplicationProblemPlusJSONResponse{
				Title:  "Conflict",
				Status: 409,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to reject edge: %w", err)
	}

	return gen.RejectEdge200JSONResponse(*res), nil
}

// CreateCI creates a single configuration item post-baseline.
func (s *Server) CreateCI(ctx context.Context, request gen.CreateCIRequestObject) (gen.CreateCIResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.CreateCI401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil {
		return gen.CreateCI400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body cannot be empty",
		}, nil
	}

	res, err := s.ciService.CreateCI(ctx, actor, *request.Body)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.CreateCI404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.CreateCI403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "You do not have permission to create configuration items for this owner group",
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.CreateCI409ApplicationProblemPlusJSONResponse{
				Title:  "Conflict",
				Status: 409,
				Detail: err.Error(),
			}, nil
		}
		var valErr *domain.ValidationError
		if errors.As(err, &valErr) {
			return gen.CreateCI422ApplicationProblemPlusJSONResponse{
				Title:  "Unprocessable Entity",
				Status: 422,
				Detail: valErr.Message,
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.CreateCI400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to create CI: %w", err)
	}

	return gen.CreateCI201JSONResponse(*res), nil
}

// CreateEdge creates a single dependency edge post-baseline.
func (s *Server) CreateEdge(ctx context.Context, request gen.CreateEdgeRequestObject) (gen.CreateEdgeResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.CreateEdge401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil {
		return gen.CreateEdge400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body cannot be empty",
		}, nil
	}

	res, err := s.edgeService.CreateEdge(ctx, actor, *request.Body)
	if err != nil {
		var valErr *domain.ValidationError
		if errors.As(err, &valErr) || errors.Is(err, domain.ErrInvalidEdge) {
			return gen.CreateEdge422ApplicationProblemPlusJSONResponse{
				Title:  "Unprocessable Entity",
				Status: 422,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) {
			return gen.CreateEdge404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.CreateEdge403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "You do not have permission to declare dependencies for this source CI",
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.CreateEdge409ApplicationProblemPlusJSONResponse{
				Title:  "Conflict",
				Status: 409,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to create edge: %w", err)
	}

	return gen.CreateEdge201JSONResponse(*res), nil
}

// DeleteEdge soft-disconnects an edge by removing it from the graph and writing an audit trail.
func (s *Server) DeleteEdge(ctx context.Context, request gen.DeleteEdgeRequestObject) (gen.DeleteEdgeResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.DeleteEdge401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	edgeID := request.Id
	err := s.edgeService.DeleteEdge(ctx, actor, edgeID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.DeleteEdge404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Edge not found",
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.DeleteEdge403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "Only members of the source or target CI owner groups or platform administrators may disconnect edges",
			}, nil
		}
		return nil, fmt.Errorf("failed to delete edge: %w", err)
	}

	return gen.DeleteEdge204Response{}, nil
}

// GetCIDetail retrieves aggregated detail for a configuration item.
func (s *Server) GetCIDetail(ctx context.Context, request gen.GetCIDetailRequestObject) (gen.GetCIDetailResponseObject, error) {
	_, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.GetCIDetail401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	detail, err := s.ciService.GetCIDetail(ctx, request.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.GetCIDetail404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.GetCIDetail400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, err
	}

	return gen.GetCIDetail200JSONResponse(*detail), nil
}

// GetUpwardImpact traverses upward impact graph for a configuration item.
func (s *Server) GetUpwardImpact(ctx context.Context, request gen.GetUpwardImpactRequestObject) (gen.GetUpwardImpactResponseObject, error) {
	_, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.GetUpwardImpact401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	includeRetired := false
	if request.Params.IncludeRetired != nil {
		includeRetired = *request.Params.IncludeRetired
	}

	resp, err := s.ciService.GetUpwardImpact(ctx, request.Id, includeRetired)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.GetUpwardImpact404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.GetUpwardImpact400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, err
	}

	return gen.GetUpwardImpact200JSONResponse(*resp), nil
}

// GetDownwardDependencies traverses downward dependency graph for a configuration item.
func (s *Server) GetDownwardDependencies(ctx context.Context, request gen.GetDownwardDependenciesRequestObject) (gen.GetDownwardDependenciesResponseObject, error) {
	_, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.GetDownwardDependencies401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	includeRetired := false
	if request.Params.IncludeRetired != nil {
		includeRetired = *request.Params.IncludeRetired
	}

	resp, err := s.ciService.GetDownwardDependencies(ctx, request.Id, includeRetired)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.GetDownwardDependencies404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.GetDownwardDependencies400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, err
	}

	return gen.GetDownwardDependencies200JSONResponse(*resp), nil
}

// UpdateCI updates an existing configuration item with domain-restricted RBAC, volatile stamping, and diff auditing.
func (s *Server) UpdateCI(ctx context.Context, request gen.UpdateCIRequestObject) (gen.UpdateCIResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.UpdateCI401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil {
		return gen.UpdateCI400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body cannot be empty",
		}, nil
	}

	res, err := s.ciService.UpdateCI(ctx, actor, request.Id, *request.Body)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.UpdateCI404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.UpdateCI403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: "You do not have permission to update configuration items for this owner group",
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.UpdateCI422ApplicationProblemPlusJSONResponse{
				Title:  "Conflict",
				Status: 422,
				Detail: err.Error(),
			}, nil
		}
		var valErr *domain.ValidationError
		if errors.As(err, &valErr) {
			return gen.UpdateCI422ApplicationProblemPlusJSONResponse{
				Title:  "Unprocessable Entity",
				Status: 422,
				Detail: valErr.Message,
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.UpdateCI400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to update CI: %w", err)
	}

	return gen.UpdateCI200JSONResponse(*res), nil
}

// CreateCIFlag reports a data-quality flag on a configuration item.
func (s *Server) CreateCIFlag(ctx context.Context, request gen.CreateCIFlagRequestObject) (gen.CreateCIFlagResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.CreateCIFlag401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil {
		return gen.CreateCIFlag400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body cannot be empty",
		}, nil
	}

	res, err := s.ciService.CreateCIFlag(ctx, actor, request.Id, *request.Body)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.CreateCIFlag404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		var valErr *domain.ValidationError
		if errors.As(err, &valErr) {
			return gen.CreateCIFlag422ApplicationProblemPlusJSONResponse{
				Title:  "Unprocessable Entity",
				Status: 422,
				Detail: valErr.Message,
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.CreateCIFlag400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to create CI flag: %w", err)
	}

	return gen.CreateCIFlag201JSONResponse(*res), nil
}

// VerifyCI explicitly verifies configuration item operational accuracy.
func (s *Server) VerifyCI(ctx context.Context, request gen.VerifyCIRequestObject) (gen.VerifyCIResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.VerifyCI401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	res, err := s.ciService.VerifyCI(ctx, &actor, request.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.VerifyCI404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.VerifyCI403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to verify CI: %w", err)
	}

	return gen.VerifyCI200JSONResponse(*res), nil
}

// RetireCI retires a configuration item with upstream dependency safety check.
func (s *Server) RetireCI(ctx context.Context, request gen.RetireCIRequestObject) (gen.RetireCIResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.RetireCI401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	force := false
	if request.Params.Force != nil {
		force = *request.Params.Force
	}

	res, err := s.ciService.RetireCI(ctx, &actor, request.Id, force)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.RetireCI404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.RetireCI403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		var conflictErr *domain.ConflictError
		if errors.As(err, &conflictErr) {
			deps := make([]struct {
				CiClass     string                                    `json:"ci_class"`
				CiId        openapi_types.UUID                        `json:"ci_id"`
				Environment gen.ProblemDetailsDependentCisEnvironment `json:"environment"`
				Name        string                                    `json:"name"`
			}, len(conflictErr.DependentCIs))
			for i, d := range conflictErr.DependentCIs {
				deps[i] = struct {
					CiClass     string                                    `json:"ci_class"`
					CiId        openapi_types.UUID                        `json:"ci_id"`
					Environment gen.ProblemDetailsDependentCisEnvironment `json:"environment"`
					Name        string                                    `json:"name"`
				}{
					CiId:        d.CIID,
					Name:        d.Name,
					CiClass:     string(d.CIClass),
					Environment: gen.ProblemDetailsDependentCisEnvironment(d.Environment),
				}
			}
			return gen.RetireCI409ApplicationProblemPlusJSONResponse{
				Title:        "Conflict",
				Status:       409,
				Detail:       conflictErr.Message,
				DependentCis: &deps,
			}, nil
		}
		return nil, fmt.Errorf("failed to retire CI: %w", err)
	}

	return gen.RetireCI200JSONResponse(*res), nil
}

// GetActiveDigest retrieves the active digest cycle and queued CIs for the caller's owner group.
func (s *Server) GetActiveDigest(ctx context.Context, request gen.GetActiveDigestRequestObject) (gen.GetActiveDigestResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.GetActiveDigest401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	res, err := s.digestService.GetActiveDigest(ctx, &actor, request.Params.OwnerGroupId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.GetActiveDigest404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrForbidden) {
			return gen.GetActiveDigest403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to get active digest: %w", err)
	}

	return gen.GetActiveDigest200JSONResponse(*res), nil
}

// TriggerDigestRun manually triggers a digest scheduler evaluation pass.
func (s *Server) TriggerDigestRun(ctx context.Context, request gen.TriggerDigestRunRequestObject) (gen.TriggerDigestRunResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.TriggerDigestRun401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if !actor.HasRole(domain.RolePlatformAdmin) {
		return gen.TriggerDigestRun403ApplicationProblemPlusJSONResponse{
			Title:  "Forbidden",
			Status: 403,
			Detail: "Only platform_admin may manually trigger digest cycles",
		}, nil
	}

	now := time.Now().UTC()
	if err := s.scheduler.RunOnce(ctx, now); err != nil {
		return nil, fmt.Errorf("failed to run digest cycle evaluation: %w", err)
	}

	groups, err := s.store.Queries().ListAllOwnerGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list owner groups: %w", err)
	}

	return gen.TriggerDigestRun200JSONResponse{
		Status:          "completed",
		CyclesProcessed: len(groups),
		Timestamp:       now,
	}, nil
}

// ExportAuditLogs streams immutable audit logs in CSV or NDJSON format with formula injection protection.
func (s *Server) ExportAuditLogs(ctx context.Context, request gen.ExportAuditLogsRequestObject) (gen.ExportAuditLogsResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ExportAuditLogs401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	reader, contentType, disposition, err := s.auditService.ExportAuditLogs(ctx, &actor, request.Params)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.ExportAuditLogs403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.ExportAuditLogs400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to export audit logs: %w", err)
	}

	if contentType == "application/x-ndjson" {
		return gen.ExportAuditLogs200ApplicationxNdjsonResponse{
			Body: reader,
			Headers: gen.ExportAuditLogs200ResponseHeaders{
				ContentDisposition: disposition,
			},
		}, nil
	}

	return gen.ExportAuditLogs200TextcsvResponse{
		Body: reader,
		Headers: gen.ExportAuditLogs200ResponseHeaders{
			ContentDisposition: disposition,
		},
	}, nil
}

// GetCIAuditLogs retrieves a cursor-paginated timeline of audit log entries for a configuration item.
func (s *Server) GetCIAuditLogs(ctx context.Context, request gen.GetCIAuditLogsRequestObject) (gen.GetCIAuditLogsResponseObject, error) {
	_, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.GetCIAuditLogs401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	res, err := s.auditService.GetCIAuditLogs(ctx, request.Id, request.Params)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.GetCIAuditLogs404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.GetCIAuditLogs400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to get CI audit logs: %w", err)
	}

	return gen.GetCIAuditLogs200JSONResponse(*res), nil
}

// GetHealthMetrics retrieves CMDB governance health metrics.
func (s *Server) GetHealthMetrics(ctx context.Context, request gen.GetHealthMetricsRequestObject) (gen.GetHealthMetricsResponseObject, error) {
	_, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.GetHealthMetrics401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Params.OwnerGroupId != nil && *request.Params.OwnerGroupId != uuid.Nil {
		_, err := s.store.Queries().GetOwnerGroupByID(ctx, *request.Params.OwnerGroupId)
		if err != nil {
			return gen.GetHealthMetrics404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: "Owner group not found",
			}, nil
		}
	}

	res, err := s.healthService.GetHealthMetrics(ctx, request.Params.OwnerGroupId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.GetHealthMetrics404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to get health metrics: %w", err)
	}

	return gen.GetHealthMetrics200JSONResponse(*res), nil
}

// ListCustomRoles retrieves all custom roles and permissions.
func (s *Server) ListCustomRoles(ctx context.Context, request gen.ListCustomRolesRequestObject) (gen.ListCustomRolesResponseObject, error) {
	_, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ListCustomRoles401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	roles, err := s.roleService.ListCustomRoles(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list custom roles: %w", err)
	}

	return gen.ListCustomRoles200JSONResponse(roles), nil
}

// CreateCustomRole creates a new custom named role.
func (s *Server) CreateCustomRole(ctx context.Context, request gen.CreateCustomRoleRequestObject) (gen.CreateCustomRoleResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.CreateCustomRole401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil {
		return gen.CreateCustomRole400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body is required",
		}, nil
	}

	role, err := s.roleService.CreateCustomRole(ctx, &actor, *request.Body)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.CreateCustomRole403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.CreateCustomRole400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to create custom role: %w", err)
	}

	return gen.CreateCustomRole201JSONResponse(*role), nil
}

// DeleteCustomRole deletes a custom role.
func (s *Server) DeleteCustomRole(ctx context.Context, request gen.DeleteCustomRoleRequestObject) (gen.DeleteCustomRoleResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.DeleteCustomRole401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	err := s.roleService.DeleteCustomRole(ctx, &actor, request.Id)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.DeleteCustomRole403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.DeleteCustomRole400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to delete custom role: %w", err)
	}

	return gen.DeleteCustomRole204Response{}, nil
}

// ListAdminUsers lists all users with their role assignments.
func (s *Server) ListAdminUsers(ctx context.Context, request gen.ListAdminUsersRequestObject) (gen.ListAdminUsersResponseObject, error) {
	_, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ListAdminUsers401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	users, err := s.roleService.ListUsersWithRoles(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}

	return gen.ListAdminUsers200JSONResponse(users), nil
}

// CreateAdminUser creates a user with custom role assignment.
func (s *Server) CreateAdminUser(ctx context.Context, request gen.CreateAdminUserRequestObject) (gen.CreateAdminUserResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.CreateAdminUser401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil {
		return gen.CreateAdminUser400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body is required",
		}, nil
	}

	user, err := s.roleService.CreateAdminUser(ctx, &actor, *request.Body)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.CreateAdminUser403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.CreateAdminUser400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to create admin user: %w", err)
	}

	return gen.CreateAdminUser201JSONResponse(*user), nil
}

// UpdateAdminUser updates a user account.
func (s *Server) UpdateAdminUser(ctx context.Context, request gen.UpdateAdminUserRequestObject) (gen.UpdateAdminUserResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.UpdateAdminUser401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil {
		return gen.UpdateAdminUser400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body is required",
		}, nil
	}

	user, err := s.roleService.UpdateAdminUser(ctx, &actor, request.Id, *request.Body)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.UpdateAdminUser403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) {
			return gen.UpdateAdminUser404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.UpdateAdminUser400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to update user: %w", err)
	}

	return gen.UpdateAdminUser200JSONResponse(*user), nil
}

// DeleteAdminUser deletes a user account.
func (s *Server) DeleteAdminUser(ctx context.Context, request gen.DeleteAdminUserRequestObject) (gen.DeleteAdminUserResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.DeleteAdminUser401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	err := s.roleService.DeleteAdminUser(ctx, &actor, request.Id)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.DeleteAdminUser403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) {
			return gen.DeleteAdminUser404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.DeleteAdminUser400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to delete user: %w", err)
	}

	return gen.DeleteAdminUser204Response{}, nil
}

// ResetUserPassword resets a user's password.
func (s *Server) ResetUserPassword(ctx context.Context, request gen.ResetUserPasswordRequestObject) (gen.ResetUserPasswordResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ResetUserPassword401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil || request.Body.NewPassword == "" {
		return gen.ResetUserPassword400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "New password is required",
		}, nil
	}

	err := s.roleService.ResetUserPassword(ctx, &actor, request.Id, request.Body.NewPassword)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.ResetUserPassword403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) || errors.Is(err, domain.ErrBadParam) {
			return gen.ResetUserPassword400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to reset password: %w", err)
	}

	msg := "Password reset successfully"
	return gen.ResetUserPassword200JSONResponse{
		Message: &msg,
	}, nil
}

// Login authenticates user credentials and creates a session.
func (s *Server) Login(ctx context.Context, request gen.LoginRequestObject) (gen.LoginResponseObject, error) {
	if request.Body == nil || request.Body.Email == "" || request.Body.Password == "" {
		return gen.Login400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Email and password are required",
		}, nil
	}

	userAgent := ""
	ipAddress := ""
	if clientInfo, ok := middleware.ClientInfoFromContext(ctx); ok {
		userAgent = clientInfo.UserAgent
		ipAddress = clientInfo.IPAddress
	}

	resp, err := s.authService.Login(ctx, string(request.Body.Email), request.Body.Password, userAgent, ipAddress)
	if err != nil {
		if errors.Is(err, domain.ErrUnauthorized) {
			return gen.Login401ApplicationProblemPlusJSONResponse{
				Title:  "Unauthorized",
				Status: 401,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.Login400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("login failed: %w", err)
	}

	return gen.Login200JSONResponse(*resp), nil
}

// Logout terminates the active authenticated session.
func (s *Server) Logout(ctx context.Context, request gen.LogoutRequestObject) (gen.LogoutResponseObject, error) {
	token, ok := middleware.AuthTokenFromContext(ctx)
	if !ok || token == "" {
		return gen.Logout401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Active session token required",
		}, nil
	}

	if err := s.authService.Logout(ctx, token); err != nil {
		return nil, fmt.Errorf("failed to logout: %w", err)
	}

	msg := "Logged out successfully"
	return gen.Logout200JSONResponse{
		Message: &msg,
	}, nil
}

// ListSessions lists active sessions for the current user or enterprise (admin).
func (s *Server) ListSessions(ctx context.Context, request gen.ListSessionsRequestObject) (gen.ListSessionsResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ListSessions401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	sessions, err := s.authService.ListSessions(ctx, &actor)
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions: %w", err)
	}

	return gen.ListSessions200JSONResponse(sessions), nil
}

// DeleteSession revokes an active session by session ID.
func (s *Server) DeleteSession(ctx context.Context, request gen.DeleteSessionRequestObject) (gen.DeleteSessionResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.DeleteSession401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if err := s.authService.DeleteSession(ctx, &actor, request.Id); err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.DeleteSession401ApplicationProblemPlusJSONResponse{
				Title:  "Unauthorized",
				Status: 401,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to delete session: %w", err)
	}

	return gen.DeleteSession204Response{}, nil
}

// RevertAuditLog undoes or reverts an audit mutation.
func (s *Server) RevertAuditLog(ctx context.Context, request gen.RevertAuditLogRequestObject) (gen.RevertAuditLogResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.RevertAuditLog401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	res, err := s.auditService.RevertAuditLog(ctx, &actor, request.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return gen.RevertAuditLog404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.RevertAuditLog400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to revert audit log: %w", err)
	}

	return gen.RevertAuditLog200JSONResponse(*res), nil
}

// CreateOwnerGroup creates a new owner group.
func (s *Server) CreateOwnerGroup(ctx context.Context, request gen.CreateOwnerGroupRequestObject) (gen.CreateOwnerGroupResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.CreateOwnerGroup401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil {
		return gen.CreateOwnerGroup400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body is required",
		}, nil
	}

	slug := ""
	if request.Body.Slug != nil {
		slug = *request.Body.Slug
	}

	res, err := s.adminService.CreateOwnerGroup(ctx, &actor, service.CreateOwnerGroupRequestDTO{
		Name:           request.Body.Name,
		Slug:           slug,
		DepartmentName: request.Body.DepartmentName,
		TeamLeadName:   request.Body.TeamLeadName,
		TeamLeadEmail:  string(request.Body.TeamLeadEmail),
	})
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.CreateOwnerGroup403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.CreateOwnerGroup400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to create owner group: %w", err)
	}

	return gen.CreateOwnerGroup201JSONResponse{
		Id:             res.ID,
		Name:           res.Name,
		Slug:           res.Slug,
		DepartmentName: res.DepartmentName,
		TeamLeadName:   res.TeamLeadName,
		TeamLeadEmail:  openapi_types.Email(res.TeamLeadEmail),
		CreatedAt:      res.CreatedAt,
	}, nil
}

// UpdateOwnerGroup updates an existing owner group.
func (s *Server) UpdateOwnerGroup(ctx context.Context, request gen.UpdateOwnerGroupRequestObject) (gen.UpdateOwnerGroupResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.UpdateOwnerGroup401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil {
		return gen.UpdateOwnerGroup400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body is required",
		}, nil
	}

	slug := ""
	if request.Body.Slug != nil {
		slug = *request.Body.Slug
	}

	res, err := s.adminService.UpdateOwnerGroup(ctx, &actor, request.Id, service.UpdateOwnerGroupRequestDTO{
		Name:           request.Body.Name,
		Slug:           slug,
		DepartmentName: request.Body.DepartmentName,
		TeamLeadName:   request.Body.TeamLeadName,
		TeamLeadEmail:  string(request.Body.TeamLeadEmail),
	})
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.UpdateOwnerGroup403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) {
			return gen.UpdateOwnerGroup404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.UpdateOwnerGroup400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to update owner group: %w", err)
	}

	return gen.UpdateOwnerGroup200JSONResponse{
		Id:             res.ID,
		Name:           res.Name,
		Slug:           res.Slug,
		DepartmentName: res.DepartmentName,
		TeamLeadName:   res.TeamLeadName,
		TeamLeadEmail:  openapi_types.Email(res.TeamLeadEmail),
		CreatedAt:      res.CreatedAt,
	}, nil
}

// DeleteOwnerGroup deletes an owner group.
func (s *Server) DeleteOwnerGroup(ctx context.Context, request gen.DeleteOwnerGroupRequestObject) (gen.DeleteOwnerGroupResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.DeleteOwnerGroup401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	err := s.adminService.DeleteOwnerGroup(ctx, &actor, request.Id)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.DeleteOwnerGroup403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) {
			return gen.DeleteOwnerGroup404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.DeleteOwnerGroup400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to delete owner group: %w", err)
	}

	return gen.DeleteOwnerGroup204Response{}, nil
}

// ListCIClasses lists all CI class definitions.
func (s *Server) ListCIClasses(ctx context.Context, request gen.ListCIClassesRequestObject) (gen.ListCIClassesResponseObject, error) {
	_, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ListCIClasses401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	res, err := s.adminService.ListCIClasses(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list CI classes: %w", err)
	}

	classes := make([]gen.CIClassDefinition, len(res))
	for i, c := range res {
		classes[i] = gen.CIClassDefinition{
			Id:          c.ID,
			Label:       c.Label,
			Category:    c.Category,
			Description: c.Description,
			Icon:        c.Icon,
			IsSystem:    c.IsSystem,
			Attributes:  c.Attributes,
			FormFields:  &c.FormFields,
			CreatedAt:   c.CreatedAt,
			UpdatedAt:   c.UpdatedAt,
		}
	}

	return gen.ListCIClasses200JSONResponse(classes), nil
}

// CreateCIClass registers a custom CI class.
func (s *Server) CreateCIClass(ctx context.Context, request gen.CreateCIClassRequestObject) (gen.CreateCIClassResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.CreateCIClass401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil {
		return gen.CreateCIClass400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body is required",
		}, nil
	}

	category := ""
	if request.Body.Category != nil {
		category = *request.Body.Category
	}
	desc := ""
	if request.Body.Description != nil {
		desc = *request.Body.Description
	}
	icon := ""
	if request.Body.Icon != nil {
		icon = *request.Body.Icon
	}
	var attrs []string
	if request.Body.Attributes != nil {
		attrs = *request.Body.Attributes
	}
	var formFields []gen.CIFormField
	if request.Body.FormFields != nil {
		formFields = *request.Body.FormFields
	}

	res, err := s.adminService.CreateCIClass(ctx, &actor, service.CreateCIClassRequestDTO{
		ID:          request.Body.Id,
		Label:       request.Body.Label,
		Category:    category,
		Description: desc,
		Icon:        icon,
		Attributes:  attrs,
		FormFields:  formFields,
	})
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.CreateCIClass403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.CreateCIClass400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to create CI class: %w", err)
	}

	return gen.CreateCIClass201JSONResponse{
		Id:          res.ID,
		Label:       res.Label,
		Category:    res.Category,
		Description: res.Description,
		Icon:        res.Icon,
		IsSystem:    res.IsSystem,
		Attributes:  res.Attributes,
		FormFields:  &res.FormFields,
		CreatedAt:   res.CreatedAt,
		UpdatedAt:   res.UpdatedAt,
	}, nil
}

// UpdateCIClass updates a custom CI class definition.
func (s *Server) UpdateCIClass(ctx context.Context, request gen.UpdateCIClassRequestObject) (gen.UpdateCIClassResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.UpdateCIClass401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if request.Body == nil {
		return gen.UpdateCIClass400ApplicationProblemPlusJSONResponse{
			Title:  "Bad Request",
			Status: 400,
			Detail: "Request body is required",
		}, nil
	}

	category := ""
	if request.Body.Category != nil {
		category = *request.Body.Category
	}
	desc := ""
	if request.Body.Description != nil {
		desc = *request.Body.Description
	}
	icon := ""
	if request.Body.Icon != nil {
		icon = *request.Body.Icon
	}
	var attrs []string
	if request.Body.Attributes != nil {
		attrs = *request.Body.Attributes
	}
	var formFields []gen.CIFormField
	if request.Body.FormFields != nil {
		formFields = *request.Body.FormFields
	}

	res, err := s.adminService.UpdateCIClass(ctx, &actor, request.Id, service.UpdateCIClassRequestDTO{
		Label:       request.Body.Label,
		Category:    category,
		Description: desc,
		Icon:        icon,
		Attributes:  attrs,
		FormFields:  formFields,
	})
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.UpdateCIClass403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) {
			return gen.UpdateCIClass404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.UpdateCIClass400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to update CI class: %w", err)
	}

	return gen.UpdateCIClass200JSONResponse{
		Id:          res.ID,
		Label:       res.Label,
		Category:    res.Category,
		Description: res.Description,
		Icon:        res.Icon,
		IsSystem:    res.IsSystem,
		Attributes:  res.Attributes,
		FormFields:  &res.FormFields,
		CreatedAt:   res.CreatedAt,
		UpdatedAt:   res.UpdatedAt,
	}, nil
}

// DeleteCIClass deletes a custom CI class.
func (s *Server) DeleteCIClass(ctx context.Context, request gen.DeleteCIClassRequestObject) (gen.DeleteCIClassResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.DeleteCIClass401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if err := s.adminService.DeleteCIClass(ctx, &actor, request.Id); err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.DeleteCIClass403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.DeleteCIClass409ApplicationProblemPlusJSONResponse{
				Title:  "Cannot Delete CI Class in Use",
				Status: 409,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) {
			return gen.DeleteCIClass404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to delete CI class: %w", err)
	}

	return gen.DeleteCIClass204Response{}, nil
}

// ListCategories handles GET /api/v1/admin/categories
func (s *Server) ListCategories(ctx context.Context, request gen.ListCategoriesRequestObject) (gen.ListCategoriesResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ListCategories401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	cats, err := s.adminService.ListCategories(ctx, &actor)
	if err != nil {
		return nil, fmt.Errorf("failed to list categories: %w", err)
	}

	resp := make(gen.ListCategories200JSONResponse, len(cats))
	for i, c := range cats {
		resp[i] = gen.CategoryDefinition{
			Id:          c.ID,
			Name:        c.Name,
			Description: c.Description,
			Icon:        c.Icon,
			Color:       c.Color,
			ClassCount:  int(c.ClassCount),
			CiCount:     int(c.CICount),
			CreatedAt:   c.CreatedAt,
			UpdatedAt:   c.UpdatedAt,
		}
	}
	return resp, nil
}

// CreateCategory handles POST /api/v1/admin/categories
func (s *Server) CreateCategory(ctx context.Context, request gen.CreateCategoryRequestObject) (gen.CreateCategoryResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.CreateCategory401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	desc := ""
	if request.Body.Description != nil {
		desc = *request.Body.Description
	}
	icon := "Layers"
	if request.Body.Icon != nil && *request.Body.Icon != "" {
		icon = *request.Body.Icon
	}
	color := "cyan"
	if request.Body.Color != nil && *request.Body.Color != "" {
		color = *request.Body.Color
	}

	cat, err := s.adminService.CreateCategory(ctx, &actor, service.CreateCategoryRequestDTO{
		ID:          request.Body.Id,
		Name:        request.Body.Name,
		Description: desc,
		Icon:        icon,
		Color:       color,
	})
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.CreateCategory403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.CreateCategory409ApplicationProblemPlusJSONResponse{
				Title:  "Conflict",
				Status: 409,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.CreateCategory400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to create category: %w", err)
	}

	return gen.CreateCategory201JSONResponse{
		Id:          cat.ID,
		Name:        cat.Name,
		Description: cat.Description,
		Icon:        cat.Icon,
		Color:       cat.Color,
		ClassCount:  int(cat.ClassCount),
		CiCount:     int(cat.CICount),
		CreatedAt:   cat.CreatedAt,
		UpdatedAt:   cat.UpdatedAt,
	}, nil
}

// UpdateCategory handles PUT /api/v1/admin/categories/{id}
func (s *Server) UpdateCategory(ctx context.Context, request gen.UpdateCategoryRequestObject) (gen.UpdateCategoryResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.UpdateCategory401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	desc := ""
	if request.Body.Description != nil {
		desc = *request.Body.Description
	}
	icon := "Layers"
	if request.Body.Icon != nil && *request.Body.Icon != "" {
		icon = *request.Body.Icon
	}
	color := "cyan"
	if request.Body.Color != nil && *request.Body.Color != "" {
		color = *request.Body.Color
	}

	cat, err := s.adminService.UpdateCategory(ctx, &actor, request.Id, service.UpdateCategoryRequestDTO{
		Name:        request.Body.Name,
		Description: desc,
		Icon:        icon,
		Color:       color,
	})
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.UpdateCategory403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) {
			return gen.UpdateCategory404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.UpdateCategory400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to update category: %w", err)
	}

	return gen.UpdateCategory200JSONResponse{
		Id:          cat.ID,
		Name:        cat.Name,
		Description: cat.Description,
		Icon:        cat.Icon,
		Color:       cat.Color,
		ClassCount:  int(cat.ClassCount),
		CiCount:     int(cat.CICount),
		CreatedAt:   cat.CreatedAt,
		UpdatedAt:   cat.UpdatedAt,
	}, nil
}

// DeleteCategory handles DELETE /api/v1/admin/categories/{id}
func (s *Server) DeleteCategory(ctx context.Context, request gen.DeleteCategoryRequestObject) (gen.DeleteCategoryResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.DeleteCategory401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if err := s.adminService.DeleteCategory(ctx, &actor, request.Id); err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.DeleteCategory403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.DeleteCategory409ApplicationProblemPlusJSONResponse{
				Title:  "Cannot Delete Category with Active Dependencies",
				Status: 409,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) {
			return gen.DeleteCategory404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to delete category: %w", err)
	}

	return gen.DeleteCategory204Response{}, nil
}

// ListRelationshipTypes handles GET /api/v1/admin/relationship-types
func (s *Server) ListRelationshipTypes(ctx context.Context, request gen.ListRelationshipTypesRequestObject) (gen.ListRelationshipTypesResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.ListRelationshipTypes401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	rels, err := s.adminService.ListRelationshipTypes(ctx, &actor)
	if err != nil {
		return nil, fmt.Errorf("failed to list relationship types: %w", err)
	}

	resp := make(gen.ListRelationshipTypes200JSONResponse, len(rels))
	for i, r := range rels {
		resp[i] = gen.RelationshipTypeDefinition{
			Id:           r.ID,
			Label:        r.Label,
			ReverseLabel: r.ReverseLabel,
			Description:  r.Description,
			Color:        r.Color,
			EdgeCount:    int(r.EdgeCount),
			CreatedAt:    r.CreatedAt,
			UpdatedAt:    r.UpdatedAt,
		}
	}
	return resp, nil
}

// CreateRelationshipType handles POST /api/v1/admin/relationship-types
func (s *Server) CreateRelationshipType(ctx context.Context, request gen.CreateRelationshipTypeRequestObject) (gen.CreateRelationshipTypeResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.CreateRelationshipType401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	desc := ""
	if request.Body.Description != nil {
		desc = *request.Body.Description
	}
	rev := ""
	if request.Body.ReverseLabel != nil {
		rev = *request.Body.ReverseLabel
	}
	color := "cyan"
	if request.Body.Color != nil && *request.Body.Color != "" {
		color = *request.Body.Color
	}

	rel, err := s.adminService.CreateRelationshipType(ctx, &actor, service.CreateRelationshipTypeRequestDTO{
		ID:           request.Body.Id,
		Label:        request.Body.Label,
		ReverseLabel: rev,
		Description:  desc,
		Color:        color,
	})
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.CreateRelationshipType403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.CreateRelationshipType409ApplicationProblemPlusJSONResponse{
				Title:  "Conflict",
				Status: 409,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.CreateRelationshipType400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to create relationship type: %w", err)
	}

	return gen.CreateRelationshipType201JSONResponse{
		Id:           rel.ID,
		Label:        rel.Label,
		ReverseLabel: rel.ReverseLabel,
		Description:  rel.Description,
		Color:        rel.Color,
		EdgeCount:    int(rel.EdgeCount),
		CreatedAt:    rel.CreatedAt,
		UpdatedAt:    rel.UpdatedAt,
	}, nil
}

// UpdateRelationshipType handles PUT /api/v1/admin/relationship-types/{id}
func (s *Server) UpdateRelationshipType(ctx context.Context, request gen.UpdateRelationshipTypeRequestObject) (gen.UpdateRelationshipTypeResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.UpdateRelationshipType401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	desc := ""
	if request.Body.Description != nil {
		desc = *request.Body.Description
	}
	rev := ""
	if request.Body.ReverseLabel != nil {
		rev = *request.Body.ReverseLabel
	}
	color := "cyan"
	if request.Body.Color != nil && *request.Body.Color != "" {
		color = *request.Body.Color
	}

	rel, err := s.adminService.UpdateRelationshipType(ctx, &actor, request.Id, service.UpdateRelationshipTypeRequestDTO{
		Label:        request.Body.Label,
		ReverseLabel: rev,
		Description:  desc,
		Color:        color,
	})
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.UpdateRelationshipType403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) {
			return gen.UpdateRelationshipType404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrBadParam) {
			return gen.UpdateRelationshipType400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to update relationship type: %w", err)
	}

	return gen.UpdateRelationshipType200JSONResponse{
		Id:           rel.ID,
		Label:        rel.Label,
		ReverseLabel: rel.ReverseLabel,
		Description:  rel.Description,
		Color:        rel.Color,
		EdgeCount:    int(rel.EdgeCount),
		CreatedAt:    rel.CreatedAt,
		UpdatedAt:    rel.UpdatedAt,
	}, nil
}

// DeleteRelationshipType handles DELETE /api/v1/admin/relationship-types/{id}
func (s *Server) DeleteRelationshipType(ctx context.Context, request gen.DeleteRelationshipTypeRequestObject) (gen.DeleteRelationshipTypeResponseObject, error) {
	actor, ok := middleware.ActorFromContext(ctx)
	if !ok {
		return gen.DeleteRelationshipType401ApplicationProblemPlusJSONResponse{
			Title:  "Unauthorized",
			Status: 401,
			Detail: "Authentication required",
		}, nil
	}

	if err := s.adminService.DeleteRelationshipType(ctx, &actor, request.Id); err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			return gen.DeleteRelationshipType403ApplicationProblemPlusJSONResponse{
				Title:  "Forbidden",
				Status: 403,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrConflict) {
			return gen.DeleteRelationshipType409ApplicationProblemPlusJSONResponse{
				Title:  "Cannot Delete Relationship Type in Use",
				Status: 409,
				Detail: err.Error(),
			}, nil
		}
		if errors.Is(err, domain.ErrNotFound) {
			return gen.DeleteRelationshipType404ApplicationProblemPlusJSONResponse{
				Title:  "Not Found",
				Status: 404,
				Detail: err.Error(),
			}, nil
		}
		return nil, fmt.Errorf("failed to delete relationship type: %w", err)
	}

	return gen.DeleteRelationshipType204Response{}, nil
}

// CreateOwnerGroupHTTP handles POST /api/v1/owner-groups
func (s *Server) CreateOwnerGroupHTTP(w http.ResponseWriter, r *http.Request) {
	actor, ok := middleware.ActorFromContext(r.Context())
	if !ok {
		middleware.WriteProblemDetails(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	var req service.CreateOwnerGroupRequestDTO
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", "Malformed request body")
		return
	}

	res, err := s.adminService.CreateOwnerGroup(r.Context(), &actor, req)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			middleware.WriteProblemDetails(w, http.StatusForbidden, "Forbidden", err.Error())
			return
		}
		if errors.Is(err, domain.ErrBadParam) {
			middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", err.Error())
			return
		}
		middleware.WriteProblemDetails(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(res)
}

// UpdateOwnerGroupHTTP handles PUT /api/v1/owner-groups/{id}
func (s *Server) UpdateOwnerGroupHTTP(w http.ResponseWriter, r *http.Request) {
	actor, ok := middleware.ActorFromContext(r.Context())
	if !ok {
		middleware.WriteProblemDetails(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	idStr := chi.URLParam(r, "id")
	groupID, err := uuid.Parse(idStr)
	if err != nil {
		middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", "Invalid owner group UUID")
		return
	}

	var req service.UpdateOwnerGroupRequestDTO
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", "Malformed request body")
		return
	}

	res, err := s.adminService.UpdateOwnerGroup(r.Context(), &actor, groupID, req)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			middleware.WriteProblemDetails(w, http.StatusForbidden, "Forbidden", err.Error())
			return
		}
		if errors.Is(err, domain.ErrNotFound) {
			middleware.WriteProblemDetails(w, http.StatusNotFound, "Not Found", err.Error())
			return
		}
		if errors.Is(err, domain.ErrBadParam) {
			middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", err.Error())
			return
		}
		middleware.WriteProblemDetails(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(res)
}

// DeleteOwnerGroupHTTP handles DELETE /api/v1/owner-groups/{id}
func (s *Server) DeleteOwnerGroupHTTP(w http.ResponseWriter, r *http.Request) {
	actor, ok := middleware.ActorFromContext(r.Context())
	if !ok {
		middleware.WriteProblemDetails(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	idStr := chi.URLParam(r, "id")
	groupID, err := uuid.Parse(idStr)
	if err != nil {
		middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", "Invalid owner group UUID")
		return
	}

	if err := s.adminService.DeleteOwnerGroup(r.Context(), &actor, groupID); err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			middleware.WriteProblemDetails(w, http.StatusForbidden, "Forbidden", err.Error())
			return
		}
		if errors.Is(err, domain.ErrBadParam) {
			middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", err.Error())
			return
		}
		middleware.WriteProblemDetails(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ListCIClassesHTTP handles GET /api/v1/admin/ci-classes
func (s *Server) ListCIClassesHTTP(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.ActorFromContext(r.Context())
	if !ok {
		middleware.WriteProblemDetails(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	res, err := s.adminService.ListCIClasses(r.Context())
	if err != nil {
		middleware.WriteProblemDetails(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(res)
}

// CreateCIClassHTTP handles POST /api/v1/admin/ci-classes
func (s *Server) CreateCIClassHTTP(w http.ResponseWriter, r *http.Request) {
	actor, ok := middleware.ActorFromContext(r.Context())
	if !ok {
		middleware.WriteProblemDetails(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	var req service.CreateCIClassRequestDTO
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", "Malformed request body")
		return
	}

	res, err := s.adminService.CreateCIClass(r.Context(), &actor, req)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			middleware.WriteProblemDetails(w, http.StatusForbidden, "Forbidden", err.Error())
			return
		}
		if errors.Is(err, domain.ErrBadParam) {
			middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", err.Error())
			return
		}
		middleware.WriteProblemDetails(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(res)
}

// UpdateCIClassHTTP handles PUT /api/v1/admin/ci-classes/{id}
func (s *Server) UpdateCIClassHTTP(w http.ResponseWriter, r *http.Request) {
	actor, ok := middleware.ActorFromContext(r.Context())
	if !ok {
		middleware.WriteProblemDetails(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	classID := chi.URLParam(r, "id")
	if classID == "" {
		middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", "Class ID is required")
		return
	}

	var req service.UpdateCIClassRequestDTO
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", "Malformed request body")
		return
	}

	res, err := s.adminService.UpdateCIClass(r.Context(), &actor, classID, req)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			middleware.WriteProblemDetails(w, http.StatusForbidden, "Forbidden", err.Error())
			return
		}
		if errors.Is(err, domain.ErrNotFound) {
			middleware.WriteProblemDetails(w, http.StatusNotFound, "Not Found", err.Error())
			return
		}
		if errors.Is(err, domain.ErrBadParam) {
			middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", err.Error())
			return
		}
		middleware.WriteProblemDetails(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(res)
}

// DeleteCIClassHTTP handles DELETE /api/v1/admin/ci-classes/{id}
func (s *Server) DeleteCIClassHTTP(w http.ResponseWriter, r *http.Request) {
	actor, ok := middleware.ActorFromContext(r.Context())
	if !ok {
		middleware.WriteProblemDetails(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	classID := chi.URLParam(r, "id")
	if classID == "" {
		middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", "Class ID is required")
		return
	}

	if err := s.adminService.DeleteCIClass(r.Context(), &actor, classID); err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			middleware.WriteProblemDetails(w, http.StatusForbidden, "Forbidden", err.Error())
			return
		}
		middleware.WriteProblemDetails(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}





