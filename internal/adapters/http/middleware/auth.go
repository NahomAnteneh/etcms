package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	"github.com/org/etcms-backend/internal/adapters/postgres/gen"
	"github.com/org/etcms-backend/internal/domain"
)

type contextKey string

const (
	actorContextKey contextKey = "etcms.actor"
)

// AuthConfig configures the authentication and authorization middleware.
type AuthConfig struct {
	AppEnv             string
	AllowDevAuthHeader bool
	JWTSecret          []byte
}

// Validate validates that security settings are safe for the active environment.
// Specifically, ALLOW_DEV_AUTH_HEADER=true in production/staging environments
// causes server startup to immediately fail.
func (c *AuthConfig) Validate() error {
	isDevOrTest := c.AppEnv == "development" || c.AppEnv == "test"
	if !isDevOrTest && c.AllowDevAuthHeader {
		return fmt.Errorf("security violation: ALLOW_DEV_AUTH_HEADER=true is strictly prohibited in %q environment", c.AppEnv)
	}
	return nil
}

// ContextWithActor injects the authenticated Actor into context.
func ContextWithActor(ctx context.Context, actor domain.Actor) context.Context {
	return context.WithValue(ctx, actorContextKey, actor)
}

// ActorFromContext extracts the authenticated Actor from context.
func ActorFromContext(ctx context.Context) (domain.Actor, bool) {
	actor, ok := ctx.Value(actorContextKey).(domain.Actor)
	return actor, ok
}

// WriteProblemDetails writes an RFC 9457 Problem Details JSON response.
func WriteProblemDetails(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"title":  title,
		"status": status,
		"detail": detail,
	})
}

// Authenticator provides authentication middleware.
type Authenticator struct {
	config AuthConfig
	store  *postgres.Store
}

// NewAuthenticator creates a new Authenticator.
func NewAuthenticator(config AuthConfig, store *postgres.Store) (*Authenticator, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	return &Authenticator{
		config: config,
		store:  store,
	}, nil
}

// Middleware returns an HTTP middleware that extracts credentials and injects Actor into request context.
func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		isDevOrTest := a.config.AppEnv == "development" || a.config.AppEnv == "test"

		var actor *domain.Actor

		// 1. Check X-Dev-User-ID header if running in development or test
		if isDevOrTest && a.config.AllowDevAuthHeader {
			devUserIDStr := r.Header.Get("X-Dev-User-ID")
			if devUserIDStr != "" {
				devUserID, err := uuid.Parse(devUserIDStr)
				if err == nil {
					act, err := a.resolveActorByID(ctx, devUserID)
					if err == nil {
						actor = act
					}
				}
			}
		}

		// 2. Check Authorization Bearer header
		if actor == nil {
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				token := strings.TrimPrefix(authHeader, "Bearer ")
				act, err := a.resolveBearerToken(ctx, token)
				if err == nil {
					actor = act
				}
			}
		}

		// 3. Check X-Intake-Token header (intake wizard access)
		if actor == nil {
			intakeToken := r.Header.Get("X-Intake-Token")
			if intakeToken != "" && a.store != nil {
				hash := sha256.Sum256([]byte(intakeToken))
				tokenHash := hex.EncodeToString(hash[:])
				row, err := a.store.Queries().GetInvitationByTokenHash(ctx, tokenHash)
				if err == nil && row.ExpiresAt.After(time.Now().UTC()) && row.InvitationStatus != gen.InvitationStatusEnumExpired {
					actor = &domain.Actor{
						ID:            row.InvitationID,
						Email:         row.TeamLeadEmail,
						Name:          row.TeamLeadName,
						Role:          domain.RoleTeamLead,
						OwnerGroupIDs: []uuid.UUID{row.OwnerGroupID},
					}
				}
			}
		}

		if actor != nil {
			ctx = ContextWithActor(ctx, *actor)
		}

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireAuth enforces that an authenticated actor is present in the context.
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, ok := ActorFromContext(r.Context())
		if !ok {
			WriteProblemDetails(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireRoles enforces that the authenticated actor has at least one of the specified roles.
func RequireRoles(roles ...domain.Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			actor, ok := ActorFromContext(r.Context())
			if !ok {
				WriteProblemDetails(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
				return
			}
			if !actor.HasRole(roles...) {
				WriteProblemDetails(w, http.StatusForbidden, "Forbidden", "Insufficient permissions")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (a *Authenticator) resolveActorByID(ctx context.Context, userID uuid.UUID) (*domain.Actor, error) {
	if a.store == nil {
		return &domain.Actor{
			ID:    userID,
			Email: "dev@example.com",
			Name:  "Dev User",
			Role:  domain.RolePlatformAdmin,
		}, nil
	}

	user, err := a.store.Queries().GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}

	groupIDs, err := a.store.Queries().GetUserOwnerGroupIDs(ctx, userID)
	if err != nil && !errors.Is(err, context.Canceled) {
		groupIDs = nil
	}

	var primaryGroupID *uuid.UUID
	if user.PrimaryOwnerGroupID.Valid {
		id := uuid.UUID(user.PrimaryOwnerGroupID.Bytes)
		primaryGroupID = &id
	}

	return &domain.Actor{
		ID:                  user.ID,
		Email:               user.Email,
		Name:                user.Name,
		Role:                domain.Role(user.Role),
		PrimaryOwnerGroupID: primaryGroupID,
		OwnerGroupIDs:       groupIDs,
	}, nil
}

func (a *Authenticator) resolveBearerToken(ctx context.Context, token string) (*domain.Actor, error) {
	// Simple dev token resolution: if token is a valid UUID, treat it as user ID
	if parsedUUID, err := uuid.Parse(token); err == nil {
		return a.resolveActorByID(ctx, parsedUUID)
	}

	return nil, errors.New("unsupported token format")
}

// UserRoleToDomain maps SQL user_role_enum to domain.Role.
func UserRoleToDomain(r gen.UserRoleEnum) domain.Role {
	return domain.Role(r)
}
