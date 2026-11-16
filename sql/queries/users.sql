-- name: GetUserByID :one
SELECT id, email, name, role, primary_owner_group_id, custom_role_id, status, created_at, updated_at
FROM users
WHERE id = $1;

-- name: GetUserByEmail :one
SELECT id, email, name, role, primary_owner_group_id, custom_role_id, status, created_at, updated_at
FROM users
WHERE email = $1;

-- name: GetUserByEmailForAuth :one
SELECT id, email, name, role, password_hash, status, primary_owner_group_id, custom_role_id, created_at, updated_at
FROM users
WHERE email = $1;

-- name: GetUserOwnerGroupIDs :many
SELECT owner_group_id
FROM user_owner_groups
WHERE user_id = $1;

-- name: ListOwnerGroups :many
SELECT id, name, slug, department_name, team_lead_name, team_lead_email, created_at
FROM owner_groups
ORDER BY name ASC;

-- name: GetOwnerGroupByID :one
SELECT id, name, slug, department_name, team_lead_name, team_lead_email, created_at
FROM owner_groups
WHERE id = $1;

-- name: CreateAuditLog :one
INSERT INTO audit_logs (
    id,
    entity_type,
    entity_id,
    affected_owner_group_ids,
    actor_id,
    action,
    diff,
    created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING id, entity_type, entity_id, affected_owner_group_ids, actor_id, action, diff, created_at;

-- name: EnsureTeamLeadUser :one
INSERT INTO users (id, email, name, role, primary_owner_group_id, status, created_at, updated_at)
VALUES ($1, $2, $3, 'team_lead', $4, 'active', now(), now())
ON CONFLICT (email) DO UPDATE
SET name = EXCLUDED.name,
    primary_owner_group_id = COALESCE(users.primary_owner_group_id, EXCLUDED.primary_owner_group_id),
    updated_at = now()
RETURNING id, email, name, role, primary_owner_group_id, status, created_at, updated_at;

-- name: ListUsersWithRoles :many
SELECT 
    u.id, 
    u.email, 
    u.name, 
    u.role, 
    u.primary_owner_group_id, 
    og.name AS owner_group_name,
    u.custom_role_id,
    cr.name AS custom_role_name,
    COALESCE(cr.permissions, '{}'::text[]) AS custom_role_permissions,
    u.status,
    u.created_at,
    u.updated_at
FROM users u
LEFT JOIN owner_groups og ON u.primary_owner_group_id = og.id
LEFT JOIN custom_roles cr ON u.custom_role_id = cr.id
ORDER BY u.created_at ASC;

-- name: CreateUserWithRole :one
INSERT INTO users (id, email, name, role, primary_owner_group_id, custom_role_id, status, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, 'active', now(), now())
RETURNING id, email, name, role, primary_owner_group_id, custom_role_id, status, created_at, updated_at;

-- name: CreateUserWithPassword :one
INSERT INTO users (id, email, name, role, primary_owner_group_id, custom_role_id, password_hash, status, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
RETURNING id, email, name, role, primary_owner_group_id, custom_role_id, status, created_at, updated_at;

-- name: UpdateUser :one
UPDATE users
SET name = $2,
    role = $3,
    primary_owner_group_id = $4,
    custom_role_id = $5,
    status = $6,
    updated_at = now()
WHERE id = $1
RETURNING id, email, name, role, primary_owner_group_id, custom_role_id, status, created_at, updated_at;

-- name: UpdateUserPassword :exec
UPDATE users
SET password_hash = $2,
    updated_at = now()
WHERE id = $1;

-- name: DeleteUser :exec
DELETE FROM users
WHERE id = $1;

-- name: CreateUserSession :one
INSERT INTO user_sessions (
    id, user_id, token, expires_at, user_agent, ip_address, created_at, last_activity_at
) VALUES (
    $1, $2, $3, $4, $5, $6, now(), now()
)
RETURNING id, user_id, token, expires_at, user_agent, ip_address, created_at, last_activity_at;

-- name: GetSessionByToken :one
SELECT 
    s.id AS session_id,
    s.token,
    s.expires_at,
    s.created_at AS session_created_at,
    s.last_activity_at,
    s.user_agent,
    s.ip_address,
    u.id AS user_id,
    u.email,
    u.name,
    u.role,
    u.status,
    u.primary_owner_group_id,
    u.custom_role_id,
    cr.name AS custom_role_name,
    COALESCE(cr.permissions, '{}'::text[]) AS custom_role_permissions
FROM user_sessions s
JOIN users u ON s.user_id = u.id
LEFT JOIN custom_roles cr ON u.custom_role_id = cr.id
WHERE s.token = $1 AND s.expires_at > now() AND u.status = 'active';

-- name: TouchSessionActivity :exec
UPDATE user_sessions
SET last_activity_at = now()
WHERE token = $1;

-- name: DeleteSessionByToken :exec
DELETE FROM user_sessions
WHERE token = $1;

-- name: ListUserSessions :many
SELECT 
    s.id,
    s.user_id,
    u.email AS user_email,
    u.name AS user_name,
    s.token,
    s.expires_at,
    s.created_at,
    s.last_activity_at,
    s.user_agent,
    s.ip_address
FROM user_sessions s
JOIN users u ON s.user_id = u.id
ORDER BY s.last_activity_at DESC;

-- name: DeleteSessionByID :exec
DELETE FROM user_sessions
WHERE id = $1;

-- name: DeleteAllUserSessions :exec
DELETE FROM user_sessions
WHERE user_id = $1;
