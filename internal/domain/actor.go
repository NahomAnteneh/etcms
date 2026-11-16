package domain

import (
	"github.com/google/uuid"
)

// Role defines the authorization level of an actor.
type Role string

const (
	RoleViewer        Role = "viewer"
	RoleTeamLead      Role = "team_lead"
	RolePlatformAdmin Role = "platform_admin"
)

// Actor represents the authenticated principal performing an operation.
type Actor struct {
	ID                  uuid.UUID
	Email               string
	Name                string
	Role                Role
	PrimaryOwnerGroupID *uuid.UUID
	OwnerGroupIDs       []uuid.UUID
	CustomRoleID        *uuid.UUID
	CustomRoleName      *string
	Permissions         []string
}

// HasRole checks if the actor possesses at least one of the specified roles.
func (a Actor) HasRole(roles ...Role) bool {
	for _, r := range roles {
		if a.Role == r {
			return true
		}
	}
	return false
}

// HasPermission checks whether the actor possesses a specific granular capability,
// or is a platform admin / has the admin:all super-permission.
func (a Actor) HasPermission(permission string) bool {
	if a.Role == RolePlatformAdmin {
		return true
	}
	for _, p := range a.Permissions {
		if p == "admin:all" || p == permission {
			return true
		}
	}
	return false
}

// BelongsToOwnerGroup checks whether the actor belongs to the specified owner group,
// or is a platform admin (who has superuser privileges across all groups).
func (a Actor) BelongsToOwnerGroup(groupID uuid.UUID) bool {
	if a.Role == RolePlatformAdmin {
		return true
	}
	for _, id := range a.OwnerGroupIDs {
		if id == groupID {
			return true
		}
	}
	return false
}
