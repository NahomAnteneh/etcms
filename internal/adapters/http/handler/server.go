package handler

import (
	"context"
	"errors"
	"time"

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

	return gen.GetIntakeInvitation200JSONResponse(*resp), nil
}
