-- name: GetUserByID :one
SELECT id, email, name, role, primary_owner_group_id, created_at
FROM users
WHERE id = $1;

-- name: GetUserByEmail :one
SELECT id, email, name, role, primary_owner_group_id, created_at
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
