package service

import (
	"context"
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
	"golang.org/x/crypto/bcrypt"
)

// RoleService manages custom named roles, permissions, and administrative user assignments.
type RoleService struct {
	store *postgres.Store
}

// NewRoleService creates a new RoleService instance.
func NewRoleService(store *postgres.Store) *RoleService {
	return &RoleService{store: store}
}

// ListCustomRoles retrieves all custom named roles ordered by system roles first, then alphabetical.
func (s *RoleService) ListCustomRoles(ctx context.Context) ([]gen.CustomRole, error) {
	rows, err := s.store.Queries().ListCustomRoles(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list custom roles: %w", err)
	}

	roles := make([]gen.CustomRole, 0, len(rows))
	for _, r := range rows {
		roles = append(roles, gen.CustomRole{
			Id:          r.ID,
			Name:        r.Name,
			Description: r.Description,
			Permissions: r.Permissions,
			IsSystem:    r.IsSystem,
			CreatedAt:   r.CreatedAt,
			UpdatedAt:   r.UpdatedAt,
		})
	}
	return roles, nil
}

// CreateCustomRole creates a new custom named role with granular permissions.
func (s *RoleService) CreateCustomRole(ctx context.Context, actor *domain.Actor, req gen.CreateCustomRoleRequest) (*gen.CustomRole, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: role creation requires platform_admin", domain.ErrForbidden)
	}

	if req.Name == "" {
		return nil, fmt.Errorf("%w: role name cannot be empty", domain.ErrBadParam)
	}

	desc := ""
	if req.Description != nil {
		desc = *req.Description
	}

	role, err := s.store.Queries().CreateCustomRole(ctx, sqlcgen.CreateCustomRoleParams{
		ID:          uuid.New(),
		Name:        req.Name,
		Description: desc,
		Permissions: req.Permissions,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create custom role: %w", err)
	}

	return &gen.CustomRole{
		Id:          role.ID,
		Name:        role.Name,
		Description: role.Description,
		Permissions: role.Permissions,
		IsSystem:    role.IsSystem,
		CreatedAt:   role.CreatedAt,
		UpdatedAt:   role.UpdatedAt,
	}, nil
}

// DeleteCustomRole removes a custom role if it is not a protected system role.
func (s *RoleService) DeleteCustomRole(ctx context.Context, actor *domain.Actor, roleID uuid.UUID) error {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return fmt.Errorf("%w: role deletion requires platform_admin", domain.ErrForbidden)
	}

	role, err := s.store.Queries().GetCustomRoleByID(ctx, roleID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: role not found", domain.ErrNotFound)
		}
		return fmt.Errorf("failed to fetch custom role: %w", err)
	}

	if role.IsSystem {
		return fmt.Errorf("%w: cannot delete system protected role", domain.ErrBadParam)
	}

	if err := s.store.Queries().DeleteCustomRole(ctx, roleID); err != nil {
		return fmt.Errorf("failed to delete custom role: %w", err)
	}
	return nil
}

// ListUsersWithRoles retrieves all registered users with custom role details.
func (s *RoleService) ListUsersWithRoles(ctx context.Context) ([]gen.AdminUserResponse, error) {
	rows, err := s.store.Queries().ListUsersWithRoles(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list users with roles: %w", err)
	}

	users := make([]gen.AdminUserResponse, 0, len(rows))
	for _, r := range rows {
		var primaryGroup *uuid.UUID
		if r.PrimaryOwnerGroupID.Valid {
			id := uuid.UUID(r.PrimaryOwnerGroupID.Bytes)
			primaryGroup = &id
		}
		var customRoleID *uuid.UUID
		if r.CustomRoleID.Valid {
			id := uuid.UUID(r.CustomRoleID.Bytes)
			customRoleID = &id
		}
		var ownerGroupName *string
		if r.OwnerGroupName.Valid {
			s := r.OwnerGroupName.String
			ownerGroupName = &s
		}
		var customRoleName *string
		if r.CustomRoleName.Valid {
			s := r.CustomRoleName.String
			customRoleName = &s
		}
		var perms *[]string
		if len(r.CustomRolePermissions) > 0 {
			p := make([]string, len(r.CustomRolePermissions))
			copy(p, r.CustomRolePermissions)
			perms = &p
		}

		users = append(users, gen.AdminUserResponse{
			Id:                    r.ID,
			Email:                 openapi_types.Email(r.Email),
			Name:                  r.Name,
			Role:                  string(r.Role),
			PrimaryOwnerGroupId:   primaryGroup,
			OwnerGroupName:        ownerGroupName,
			CustomRoleId:          customRoleID,
			CustomRoleName:        customRoleName,
			CustomRolePermissions: perms,
			CreatedAt:             r.CreatedAt,
		})
	}
	return users, nil
}

// CreateAdminUser registers a new user account with assigned custom role and password hash.
func (s *RoleService) CreateAdminUser(ctx context.Context, actor *domain.Actor, req gen.CreateAdminUserRequest) (*gen.AdminUserResponse, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: user registration requires platform_admin", domain.ErrForbidden)
	}

	if req.Email == "" || req.Name == "" {
		return nil, fmt.Errorf("%w: name and email are required", domain.ErrBadParam)
	}

	rawPassword := "Password123!"
	if req.Password != nil && *req.Password != "" {
		rawPassword = *req.Password
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(rawPassword), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	status := "active"
	if req.Status != nil && *req.Status != "" {
		status = *req.Status
	}

	userID := uuid.New()
	userRole := sqlcgen.UserRoleEnum(req.Role)

	var pog pgtype.UUID
	if req.PrimaryOwnerGroupId != nil {
		pog = pgtype.UUID{Bytes: *req.PrimaryOwnerGroupId, Valid: true}
	}
	var crg pgtype.UUID
	if req.CustomRoleId != nil {
		crg = pgtype.UUID{Bytes: *req.CustomRoleId, Valid: true}
	}

	row, err := s.store.Queries().CreateUserWithPassword(ctx, sqlcgen.CreateUserWithPasswordParams{
		ID:                  userID,
		Email:               string(req.Email),
		Name:                req.Name,
		Role:                userRole,
		PrimaryOwnerGroupID: pog,
		CustomRoleID:        crg,
		PasswordHash:        string(hash),
		Status:              status,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	if req.PrimaryOwnerGroupId != nil {
		_, _ = s.store.Pool().Exec(ctx, 
			"INSERT INTO user_owner_groups (user_id, owner_group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
			userID, *req.PrimaryOwnerGroupId,
		)
	}

	return s.mapUserRowToAdminResponse(ctx, row.ID, row.Email, row.Name, string(row.Role), row.PrimaryOwnerGroupID, row.CustomRoleID, row.Status, row.CreatedAt, row.UpdatedAt)
}

// UpdateAdminUser updates an existing user account's name, role, boundary, or status.
func (s *RoleService) UpdateAdminUser(ctx context.Context, actor *domain.Actor, userID uuid.UUID, req gen.UpdateAdminUserRequest) (*gen.AdminUserResponse, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: user update requires platform_admin", domain.ErrForbidden)
	}

	if req.Name == "" {
		return nil, fmt.Errorf("%w: name is required", domain.ErrBadParam)
	}

	var pog pgtype.UUID
	if req.PrimaryOwnerGroupId != nil {
		pog = pgtype.UUID{Bytes: *req.PrimaryOwnerGroupId, Valid: true}
	}
	var crg pgtype.UUID
	if req.CustomRoleId != nil {
		crg = pgtype.UUID{Bytes: *req.CustomRoleId, Valid: true}
	}
	status := "active"
	if req.Status != nil && *req.Status != "" {
		status = *req.Status
	}

	row, err := s.store.Queries().UpdateUser(ctx, sqlcgen.UpdateUserParams{
		ID:                  userID,
		Name:                req.Name,
		Role:                sqlcgen.UserRoleEnum(req.Role),
		PrimaryOwnerGroupID: pog,
		CustomRoleID:        crg,
		Status:              status,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: user not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to update user: %w", err)
	}

	if req.PrimaryOwnerGroupId != nil {
		_, _ = s.store.Pool().Exec(ctx, 
			"INSERT INTO user_owner_groups (user_id, owner_group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
			userID, *req.PrimaryOwnerGroupId,
		)
	}

	return s.mapUserRowToAdminResponse(ctx, row.ID, row.Email, row.Name, string(row.Role), row.PrimaryOwnerGroupID, row.CustomRoleID, row.Status, row.CreatedAt, row.UpdatedAt)
}

// DeleteAdminUser deletes a user account after validating the actor is admin and not self-deleting.
func (s *RoleService) DeleteAdminUser(ctx context.Context, actor *domain.Actor, userID uuid.UUID) error {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return fmt.Errorf("%w: user deletion requires platform_admin", domain.ErrForbidden)
	}

	if actor.ID == userID {
		return fmt.Errorf("%w: administrators cannot delete their own account", domain.ErrBadParam)
	}

	// Delete active sessions first
	_ = s.store.Queries().DeleteAllUserSessions(ctx, userID)

	if err := s.store.Queries().DeleteUser(ctx, userID); err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}
	return nil
}

// ResetUserPassword resets a user's password.
func (s *RoleService) ResetUserPassword(ctx context.Context, actor *domain.Actor, userID uuid.UUID, newPassword string) error {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return fmt.Errorf("%w: password reset requires platform_admin", domain.ErrForbidden)
	}

	if len(newPassword) < 6 {
		return fmt.Errorf("%w: password must be at least 6 characters long", domain.ErrBadParam)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	if err := s.store.Queries().UpdateUserPassword(ctx, sqlcgen.UpdateUserPasswordParams{
		ID:           userID,
		PasswordHash: string(hash),
	}); err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	// Invalidate sessions on password reset
	_ = s.store.Queries().DeleteAllUserSessions(ctx, userID)
	return nil
}

func (s *RoleService) mapUserRowToAdminResponse(ctx context.Context, id uuid.UUID, email, name, role string, primaryOwnerGroupID, customRoleID pgtype.UUID, status string, createdAt, updatedAt time.Time) (*gen.AdminUserResponse, error) {
	var roleName *string
	var permissions *[]string
	if customRoleID.Valid {
		cID := uuid.UUID(customRoleID.Bytes)
		cr, err := s.store.Queries().GetCustomRoleByID(ctx, cID)
		if err == nil {
			roleName = &cr.Name
			p := make([]string, len(cr.Permissions))
			copy(p, cr.Permissions)
			permissions = &p
		}
	}

	var ogName *string
	var primaryGroup *uuid.UUID
	if primaryOwnerGroupID.Valid {
		pID := uuid.UUID(primaryOwnerGroupID.Bytes)
		primaryGroup = &pID
		og, err := s.store.Queries().GetOwnerGroupByID(ctx, pID)
		if err == nil {
			ogName = &og.Name
		}
	}

	var cRoleID *uuid.UUID
	if customRoleID.Valid {
		id := uuid.UUID(customRoleID.Bytes)
		cRoleID = &id
	}

	return &gen.AdminUserResponse{
		Id:                    id,
		Email:                 openapi_types.Email(email),
		Name:                  name,
		Role:                  role,
		PrimaryOwnerGroupId:   primaryGroup,
		OwnerGroupName:        ogName,
		CustomRoleId:          cRoleID,
		CustomRoleName:        roleName,
		CustomRolePermissions: permissions,
		Status:                &status,
		CreatedAt:             createdAt,
		UpdatedAt:             &updatedAt,
	}, nil
}
