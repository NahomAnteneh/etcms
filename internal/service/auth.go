package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
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
	"golang.org/x/crypto/bcrypt"
)

// AuthService manages user credential authentication and session tokens.
type AuthService struct {
	store *postgres.Store
}

// NewAuthService creates a new AuthService.
func NewAuthService(store *postgres.Store) *AuthService {
	return &AuthService{store: store}
}

// Login verifies credentials and issues a cryptographic session token.
func (s *AuthService) Login(ctx context.Context, email, password, userAgent, ipAddress string) (*gen.LoginResponse, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || password == "" {
		return nil, fmt.Errorf("%w: email and password are required", domain.ErrBadParam)
	}

	user, err := s.store.Queries().GetUserByEmailForAuth(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: invalid email or password", domain.ErrUnauthorized)
		}
		return nil, fmt.Errorf("failed to lookup user: %w", err)
	}

	if user.Status != "active" {
		return nil, fmt.Errorf("%w: user account is %s", domain.ErrForbidden, user.Status)
	}

	if user.PasswordHash == "" {
		return nil, fmt.Errorf("%w: account has no password set; contact an administrator", domain.ErrUnauthorized)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, fmt.Errorf("%w: invalid email or password", domain.ErrUnauthorized)
	}

	// Generate 32-byte cryptographically secure random token (64 hex characters)
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, fmt.Errorf("failed to generate secure token: %w", err)
	}
	rawToken := hex.EncodeToString(tokenBytes)

	// Hash token with SHA-256 for persistent database storage
	h := sha256.Sum256([]byte(rawToken))
	tokenHash := hex.EncodeToString(h[:])

	sessionID := uuid.New()
	expiresAt := time.Now().UTC().Add(24 * time.Hour)

	var ua pgtype.Text
	if userAgent != "" {
		ua = pgtype.Text{String: userAgent, Valid: true}
	}
	var ip pgtype.Text
	if ipAddress != "" {
		ip = pgtype.Text{String: ipAddress, Valid: true}
	}

	session, err := s.store.Queries().CreateUserSession(ctx, sqlcgen.CreateUserSessionParams{
		ID:        sessionID,
		UserID:    user.ID,
		Token:     tokenHash, // Store SHA-256 hash in database
		ExpiresAt: expiresAt,
		UserAgent: ua,
		IpAddress: ip,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to persist user session: %w", err)
	}

	// Resolve user group memberships
	groupIDs, _ := s.store.Queries().GetUserOwnerGroupIDs(ctx, user.ID)

	var primaryGroupID *uuid.UUID
	if user.PrimaryOwnerGroupID.Valid {
		id := uuid.UUID(user.PrimaryOwnerGroupID.Bytes)
		primaryGroupID = &id
	}

	var customRoleID *uuid.UUID
	var customRoleName *string
	var permissions *[]string
	if user.CustomRoleID.Valid {
		cID := uuid.UUID(user.CustomRoleID.Bytes)
		customRoleID = &cID
		cr, err := s.store.Queries().GetCustomRoleByID(ctx, cID)
		if err == nil {
			customRoleName = &cr.Name
			p := make([]string, len(cr.Permissions))
			copy(p, cr.Permissions)
			permissions = &p
		}
	}

	userModel := gen.User{
		Id:                    user.ID,
		Email:                 openapi_types.Email(user.Email),
		Name:                  user.Name,
		Role:                  gen.UserRole(user.Role),
		PrimaryOwnerGroupId:   primaryGroupID,
		OwnerGroupIds:         groupIDs,
		CustomRoleId:          customRoleID,
		CustomRoleName:        customRoleName,
		CustomRolePermissions: permissions,
		Status:                &user.Status,
		CreatedAt:             user.CreatedAt,
		UpdatedAt:             &user.UpdatedAt,
	}

	return &gen.LoginResponse{
		Token:     rawToken,
		ExpiresAt: session.ExpiresAt,
		User:      userModel,
	}, nil
}

// Logout terminates an active session.
func (s *AuthService) Logout(ctx context.Context, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	h := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(h[:])
	_ = s.store.Queries().DeleteSessionByToken(ctx, tokenHash)
	return s.store.Queries().DeleteSessionByToken(ctx, token)
}

// ListSessions returns all active sessions (Admin only).
func (s *AuthService) ListSessions(ctx context.Context, actor *domain.Actor) ([]gen.UserSessionResponse, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: viewing active sessions requires platform_admin", domain.ErrForbidden)
	}

	rows, err := s.store.Queries().ListUserSessions(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to query sessions: %w", err)
	}

	sessions := make([]gen.UserSessionResponse, 0, len(rows))
	for _, r := range rows {
		var ua *string
		if r.UserAgent.Valid {
			ua = &r.UserAgent.String
		}
		var ip *string
		if r.IpAddress.Valid {
			ip = &r.IpAddress.String
		}

		tokenPreview := "sha256:"
		if len(r.Token) >= 8 {
			tokenPreview += r.Token[:8] + "..."
		} else {
			tokenPreview += "***"
		}

		sessions = append(sessions, gen.UserSessionResponse{
			Id:             r.ID,
			UserId:         r.UserID,
			UserEmail:      openapi_types.Email(r.UserEmail),
			UserName:       r.UserName,
			Token:          tokenPreview,
			ExpiresAt:      r.ExpiresAt,
			CreatedAt:      r.CreatedAt,
			LastActivityAt: r.LastActivityAt,
			UserAgent:      ua,
			IpAddress:      ip,
		})
	}

	return sessions, nil
}

// DeleteSession terminates a session by ID (Admin only).
func (s *AuthService) DeleteSession(ctx context.Context, actor *domain.Actor, sessionID uuid.UUID) error {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return fmt.Errorf("%w: terminating sessions requires platform_admin", domain.ErrForbidden)
	}

	return s.store.Queries().DeleteSessionByID(ctx, sessionID)
}
