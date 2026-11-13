package handler

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/http/middleware"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	"github.com/org/etcms-backend/internal/domain"
	"github.com/org/etcms-backend/internal/service"
)

// Server implements gen.StrictServerInterface.
type Server struct {
	store         *postgres.Store
	intakeService *service.IntakeService
	edgeService   *service.EdgeService
	ciService     *service.CIService
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

	return gen.GetCurrentUser200JSONResponse{
		Id:                  actor.ID,
		Email:               openapi_types.Email(actor.Email),
		Name:                actor.Name,
		Role:                gen.UserRole(actor.Role),
		PrimaryOwnerGroupId: actor.PrimaryOwnerGroupID,
		OwnerGroupIds:       actor.OwnerGroupIDs,
		CreatedAt:           time.Now().UTC(),
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

	resp, err := s.intakeService.CreateCampaign(ctx, actor, service.CreateCampaignInput{
		Title:         request.Body.Title,
		Deadline:      request.Body.Deadline,
		OwnerGroupIDs: request.Body.OwnerGroupIds,
	})
	if err != nil {
		if errors.Is(err, service.ErrInvalidDeadline) ||
			errors.Is(err, service.ErrNoOwnerGroups) ||
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

	resp, err := s.intakeService.SearchCIs(ctx, request.Params)
	if err != nil {
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
		if errors.Is(err, domain.ErrInvalidEdge) {
			return gen.CreateEdge400ApplicationProblemPlusJSONResponse{
				Title:  "Bad Request",
				Status: 400,
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
